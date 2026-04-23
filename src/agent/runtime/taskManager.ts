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
const VALID_STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "deleted",
];

const markers: Record<string, string> = {
  pending: "🕘",
  in_progress: "🔄",
  completed: "✅",
  deleted: "🗑️",
};

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
    let max = 0;
    for (const f of this.taskFiles()) {
      const id = parseInt(f.split("_")[1], 10);
      if (!isNaN(id) && id > max) max = id;
    }
    return max;
  }

  private taskFiles(): string[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => /^task_\d+\.json$/.test(f))
        .map((f) => path.join(this.dir, f));
    } catch {
      return [];
    }
  }

  private load(taskId: number): TaskRecord {
    const p = this.taskPath(taskId);
    if (!fs.existsSync(p)) throw new Error(`Task ${taskId} not found`);
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }

  private save(task: TaskRecord): void {
    fs.writeFileSync(this.taskPath(task.id), JSON.stringify(task, null, 2));
  }

  /** 从磁盘加载所有任务，返回 (tasks, id→task map) */
  private loadAll(): { tasks: TaskRecord[]; byId: Map<number, TaskRecord> } {
    const tasks = this.taskFiles()
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(f, "utf-8")));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return { tasks, byId };
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

    if (owner !== undefined) task.owner = owner;

    if (status) {
      if (!VALID_STATUSES.includes(status as TaskStatus)) {
        throw new Error(`Invalid status: ${status}`);
      }
      task.status = status as TaskStatus;
      if (status === "completed" || status === "deleted") {
        this.clearDependency(taskId);
      }
    }

    if (addBlockedBy?.length) {
      task.blockedBy = [...new Set([...task.blockedBy, ...addBlockedBy])];
    }

    if (addBlocks?.length) {
      task.blocks = [...new Set([...task.blocks, ...addBlocks])];
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
    const { tasks } = this.loadAll();
    if (tasks.length === 0) return "No tasks.";

    const lines: string[] = [];
    for (const t of tasks) {
      const marker = markers[t.status] ?? "❓";
      const blocked =
        t.blockedBy.length > 0
          ? ` (blocked by: ${t.blockedBy.join(", ")})`
          : "";
      const owner = t.owner ? ` owner=${t.owner}` : "";
      const desc = t.description ? ` — ${t.description}` : "";
      lines.push(`${marker} #${t.id}: ${t.subject}${desc}${owner}${blocked}`);
    }

    const done = tasks.filter((t) => t.status === "completed").length;
    const active = tasks.filter((t) => t.status !== "deleted").length;
    lines.push(`\n(${done}/${active} completed)`);

    return lines.join("\n");
  }

  // ── 清理已完成链 ──

  /**
   * 删除孤立的已完成任务。
   * 已完成的任务在 clearDependency 后 blockedBy/blocks 均为空，
   * 如果它不被任何未完成任务引用，就是孤立的，可以删除。
   * @returns 被删除的任务 ID 列表
   */
  pruneCompletedChains(): number[] {
    const { tasks, byId } = this.loadAll();

    // 收集所有被未完成任务引用（blockedBy 或 blocks）的已完成任务 ID
    const referenced = new Set<number>();
    for (const t of tasks) {
      if (t.status === "completed") continue;
      for (const id of [...t.blockedBy, ...t.blocks]) {
        if (byId.has(id)) referenced.add(id);
      }
    }

    const toDelete = tasks
      .filter(
        (t) =>
          t.status === "completed" &&
          t.blockedBy.length === 0 &&
          t.blocks.length === 0 &&
          !referenced.has(t.id),
      )
      .map((t) => t.id);

    for (const id of toDelete) {
      const p = this.taskPath(id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    return toDelete;
  }

  // ── 依赖清理 ──

  private clearDependency(completedId: number): void {
    const { byId } = this.loadAll();
    const task = byId.get(completedId);
    if (task && task.blocks.length > 0) {
      task.blocks = [];
      this.save(task);
    }

    for (const [, t] of byId) {
      if (t.blockedBy.includes(completedId)) {
        t.blockedBy = t.blockedBy.filter((id) => id !== completedId);
        this.save(t);
      }
    }
  }

  clear(): void {
    for (const f of this.taskFiles()) fs.unlinkSync(f);
    this.nextId = 1;
  }
}
