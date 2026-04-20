import { spawn, ChildProcess } from "child_process";
import AsyncLock from "async-lock";

interface TaskInfo {
  id: string;
  status: "running" | "completed" | "timeout" | "error";
  command: string;
  startedAt: number;
  finishedAt: number | null;
  result: string;
  resultPreview: string;
}

export interface TaskNotification {
  taskId: string;
  status: string;
  command: string;
  preview: string;
  outputFile: string;
}

const STALL_THRESHOLD_MS = 45 * 1000;
const TASK_TIMEOUT_MS = 300 * 1000;

export class AsyncTask {
  private workDir: string;
  private tasks: Map<string, TaskInfo> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private notificationQueue: TaskNotification[] = []; // 已完成任务的通知队列
  private lock = new AsyncLock();

  constructor(workDir: string = process.cwd()) {
    this.workDir = workDir;
  }

  private preview(output: string, limit = 500): string {
    const compact = (output || "(no output)").replace(/\s+/g, " ").trim();
    return compact.length > limit ? compact.slice(0, limit) : compact;
  }

  run(command: string): string {
    const taskId = Math.random().toString(36).slice(2, 10);

    const child = spawn(command, {
      shell: true,
      cwd: this.workDir,
    });

    let output = "";
    child.stdout?.on("data", (data) => {
      output += data.toString();
    });
    child.stderr?.on("data", (data) => {
      output += data.toString();
    });

    this.lock.acquire("tasks", () => {
      this.tasks.set(taskId, {
        id: taskId,
        status: "running",
        command,
        startedAt: Date.now(),
        finishedAt: null,
        result: "",
        resultPreview: "",
      });
      this.processes.set(taskId, child);
    });

    child.on("close", (code) => {
      this.finish(taskId, output.trim(), code === 0 ? "completed" : "error");
    });
    child.on("error", (err) => {
      this.finish(taskId, `Error: ${err.message}`, "error");
    });

    setTimeout(() => {
      this.lock.acquire("tasks", () => {
        const info = this.tasks.get(taskId);
        if (info && info.status === "running") {
          child.kill();
          this.finish(taskId, "Error: Timeout (300s)", "timeout");
        }
      });
    }, TASK_TIMEOUT_MS);

    return `[bg:${taskId}] Running: ${command.slice(0, 80)}`;
  }

  private finish(taskId: string, result: string, status: TaskInfo["status"]): void {
    this.lock.acquire("tasks", () => {
      const info = this.tasks.get(taskId);
      if (!info) return;

      info.status = status;
      info.result = result;
      info.finishedAt = Date.now();
      info.resultPreview = this.preview(result);

      this.tasks.set(taskId, info);
      this.processes.delete(taskId);

      const notification: TaskNotification = {
        taskId,
        status,
        command: info.command.slice(0, 80),
        preview: info.resultPreview,
        outputFile: "",
      };
      this.notificationQueue.push(notification);
    });
  }

  check(taskId?: string): string {
    if (taskId) {
      const info = this.tasks.get(taskId);
      if (!info) return `Error: Unknown task ${taskId}`;
      return JSON.stringify(
        {
          id: info.id,
          status: info.status,
          command: info.command,
          result_preview: info.resultPreview,
        },
        null,
        2
      );
    }

    const lines: string[] = [];
    for (const [tid, info] of this.tasks) {
      lines.push(
        `${tid}: [${info.status}] ${info.command.slice(0, 60)} -> ${info.resultPreview || "(running)"}`
      );
    }
    return lines.length > 0 ? lines.join("\n") : "No background tasks.";
  }

  drainNotifications(): Promise<TaskNotification[]> {
    return this.lock.acquire("drain", () => {
      const notifs = [...this.notificationQueue];
      this.notificationQueue = [];
      return notifs;
    });
  }
}
