import * as fs from "fs";
import * as path from "path";

/**
 * 任务记录 — 持久化到磁盘的工作图节点
 *
 * 不是线程、后台槽位或 worker 进程，
 * 而是一个持久化的工作项，带有依赖关系。
 */
export interface TaskRecord {
  id: number;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  blockedBy: number[];
  blocks: number[];
  owner: string;
}

type TaskStatus = TaskRecord["status"];
const VALID_STATUSES: TaskStatus[] = ["pending", "in_progress", "completed", "deleted"];

/**
 * TaskManager — 持久化任务工作图
 *
 * 任务以 JSON 文件持久化在 .tasks/ 目录中，能跨会话存活。
 * 每个任务携带一个小型依赖图：
 * - blockedBy: 必须先完成的前置任务
 * - blocks: 本任务完成后解锁的后续任务
 *
 * 完成一个任务时，自动从所有其他任务的 blockedBy 中移除它。
 */
export class TaskManager {
  private dir: string;
  private nextId: number;


  constructor(tasksDir: string) {
    this.dir = tasksDir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.nextId = this.maxId() + 1;
  }

  // ── 内部 I/O ──

  private taskPath(taskId: number): string {
    return path.join(this.dir, `task_${taskId}.json`);
  }

  private maxId(): number {
    const files = this.taskFiles();
    if (files.length === 0) return 0;
    const ids = files
      .map((f) => parseInt(path.basename(f).split("_")[1], 10))
      .filter((id) => !isNaN(id));
    return ids.length === 0 ? 0 : Math.max(...ids);
  }

  private taskFiles(): string[] {
    try {
      return fs.readdirSync(this.dir)
        .filter((f) => /^task_\d+\.json$/.test(f))
        .map((f) => path.join(this.dir, f));
    } catch {
      return [];
    }
  }

  private load(taskId: number): TaskRecord {
    const p = this.taskPath(taskId);
    if (!fs.existsSync(p)) {
      throw new Error(`Task ${taskId} not found`);
    }
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }

  private save(task: TaskRecord): void {
    fs.writeFileSync(this.taskPath(task.id), JSON.stringify(task, null, 2));
  }

  // ── CRUD 操作 ──

  create(subject: string, description = ""): string {
    const task: TaskRecord = {
      id: this.nextId,
      subject,
      description,
      status: "pending",
      blockedBy: [],
      blocks: [],
      owner: "",
    };
    this.save(task);
    this.nextId++;
    return JSON.stringify(task, null, 2);
  }

  get(taskId: number): string {
    return JSON.stringify(this.load(taskId), null, 2);
  }

  update(
    taskId: number,
    status?: string,
    owner?: string,
    addBlockedBy?: number[],
    addBlocks?: number[],
  ): string {
    const task = this.load(taskId);

    if (owner !== undefined) {
      task.owner = owner;
    }

    if (status) {
      if (!VALID_STATUSES.includes(status as TaskStatus)) {
        throw new Error(`Invalid status: ${status}`);
      }
      task.status = status as TaskStatus;
      // 完成/删除时自动清理依赖
      if (status === "completed" || status === "deleted") {
        this.clearDependency(taskId);
      }
    }

    if (addBlockedBy && addBlockedBy.length > 0) {
      task.blockedBy = [...new Set([...task.blockedBy, ...addBlockedBy])];
    }

    if (addBlocks && addBlocks.length > 0) {
      task.blocks = [...new Set([...task.blocks, ...addBlocks])];
      // 双向：同时更新被阻塞任务的 blockedBy
      for (const blockedId of addBlocks) {
        try {
          const blocked = this.load(blockedId);
          if (!blocked.blockedBy.includes(taskId)) {
            blocked.blockedBy.push(taskId);
            this.save(blocked);
          }
        } catch {
          // 被阻塞的任务不存在，跳过
        }
      }
    }

    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  listAll(): string {
    const tasks: TaskRecord[] = [];
    for (const f of this.taskFiles().sort()) {
      tasks.push(JSON.parse(fs.readFileSync(f, "utf-8")));
    }

    if (tasks.length === 0) return "No tasks.";

    const markers: Record<string, string> = {
      pending: "🕘",
      in_progress: "🔄",
      completed: "✅",
      deleted: "🗑️",
    };

    const lines: string[] = [];
    for (const t of tasks) {
      const marker = markers[t.status] ?? "❓";
      const blocked = t.blockedBy.length > 0 ? ` (blocked by: ${t.blockedBy.join(", ")})` : "";
      const owner = t.owner ? ` owner=${t.owner}` : "";
      const desc = t.description ? ` — ${t.description}` : "";
      lines.push(`${marker} #${t.id}: ${t.subject}${desc}${owner}${blocked}`);
    }

    const done = tasks.filter((t) => t.status === "completed").length;
    const active = tasks.filter((t) => t.status !== "deleted").length;
    lines.push(`\n(${done}/${active} completed)`);

    return lines.join("\n");
  }

  // ── 依赖清理 ──

  private clearDependency(completedId: number): void {
    // 清理完成/删除任务自身的 blocks 引用
    const completedTask = this.load(completedId);
    if (completedTask.blocks.length > 0) {
      completedTask.blocks = [];
      this.save(completedTask);
    }

    // 从其他任务的 blockedBy 中移除
    for (const f of this.taskFiles()) {
      const task: TaskRecord = JSON.parse(fs.readFileSync(f, "utf-8"));
      if (task.blockedBy.includes(completedId)) {
        task.blockedBy = task.blockedBy.filter((id) => id !== completedId);
        this.save(task);
      }
    }
  }


  clear(): void {
    for (const f of this.taskFiles()) {
      fs.unlinkSync(f);
    }
    this.nextId = 1;
  }
}