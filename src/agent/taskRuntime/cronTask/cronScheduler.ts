import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { PATHS } from "../../../config/paths";
import { CronLock } from "./cronLock";

const JITTER_MINUTES = [0, 30];
const JITTER_OFFSET_MAX = 4;
const AUTO_EXPIRY_DAYS = 7;

interface ScheduledTask {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  createdAt: number;
  jitterOffset?: number;
  lastFired?: number;
}

interface MissedTask {
  id: string;
  cron: string;
  prompt: string;
  missedAt: string;
}

/**
 * Check if a 5-field cron expression matches a given datetime.
 * Fields: minute hour day-of-month month day-of-week
 * Supports: * (any), N (step), N (exact), N-M (range), N,M (list)
 */
function cronMatches(expr: string, dt: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }
  const values: [number, number, number, number, number] = [
    dt.getMinutes(),
    dt.getHours(),
    dt.getDate(),
    dt.getMonth() + 1, // JS: 0-11, Cron: 1-12
    (dt.getDay() + 6) % 7, // JS: 0=Sun, 6=Sat; Cron: 0=Mon, 6=Sun
  ];
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  return fields.every((field, i) => fieldMatches(field, values[i], ranges[i][0], ranges[i][1]));
}

function fieldMatches(field: string, value: number, lo: number, _hi: number): boolean {
  if (field === "*") {
    return true;
  }
  const parts = field.split(",");
  for (const part of parts) {
    let step = 1;
    let partField = part;
    if (part.includes("/")) {
      const [p, stepStr] = part.split("/", 2);
      partField = p;
      step = parseInt(stepStr, 10);
    }
    if (partField === "*") {
      if ((value - lo) % step === 0) {
        return true;
      }
    } else if (partField.includes("-")) {
      const [startStr, endStr] = partField.split("-", 2);
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (start <= value && value <= end && (value - start) % step === 0) {
        return true;
      }
    } else {
      if (parseInt(partField, 10) === value) {
        return true;
      }
    }
  }
  return false;
}

export class CronScheduler extends EventEmitter {
  private tasks: ScheduledTask[] = [];
  private queue: ScheduledTask[] = [];
  private stopEvent = false;
  private thread: ReturnType<typeof setInterval> | null = null;
  private lastCheckMinute = -1;
  private cronLock: CronLock;

  constructor() {
    super();
    this.cronLock = new CronLock();
  }

  start(): void {
    this.loadDurable();
    if (this.cronLock.acquire()) {
      this.thread = setInterval(() => this.checkLoop(), 1000);
      const count = this.tasks.length;
      if (count > 0) {
        console.log(`[Cron] Loaded ${count} scheduled tasks`);
      }
    } else {
      console.log("[Cron] Another session holds the lock, scheduler not started");
    }
  }

  stop(): void {
    this.stopEvent = true;
    if (this.thread) {
      clearInterval(this.thread);
      this.thread = null;
    }
    this.cronLock.release();
  }

  create(cronExpr: string, prompt: string, recurring = true, durable = false): string {
    const taskId = this.generateId();
    const now = Date.now();
    const task: ScheduledTask = {
      id: taskId,
      cron: cronExpr,
      prompt,
      recurring,
      durable,
      createdAt: now,
    };
    if (recurring) {
      task.jitterOffset = this.computeJitter(cronExpr);
    }
    this.tasks.push(task);
    if (durable) {
      this.saveDurable();
    }
    const mode = recurring ? "recurring" : "one-shot";
    const store = durable ? "durable" : "session-only";
    return `Created task ${taskId} (${mode}, ${store}): cron=${cronExpr}`;
  }

  delete(taskId: string): string {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    if (this.tasks.length < before) {
      this.saveDurable();
      return `Deleted task ${taskId}`;
    }
    return `Task ${taskId} not found`;
  }

  listTasks(): string {
    if (this.tasks.length === 0) {
      return "No scheduled tasks.";
    }
    return this.tasks
      .map((t) => {
        const mode = t.recurring ? "recurring" : "one-shot";
        const store = t.durable ? "durable" : "session";
        const ageHours = (Date.now() - t.createdAt) / 3600000;
        return `  ${t.id}  ${t.cron}  [${mode}/${store}] (${ageHours.toFixed(1)}h old): ${t.prompt.substring(0, 60)}`;
      })
      .join("\n");
  }

  drainNotifications(): string[] {
    const notifications = this.queue.map((t) => `[Scheduled task ${t.id}]: ${t.prompt}`);
    this.queue = [];
    return notifications;
  }

  detectMissedTasks(): MissedTask[] {
    const now = new Date();
    const missed: MissedTask[] = [];
    for (const task of this.tasks) {
      if (!task.lastFired) continue;
      const lastDt = new Date(task.lastFired);
      const cap = new Date(Math.min(now.getTime(), lastDt.getTime() + 24 * 3600 * 1000));
      let check = new Date(lastDt.getTime() + 60000);
      while (check <= cap) {
        if (cronMatches(task.cron, check)) {
          missed.push({
            id: task.id,
            cron: task.cron,
            prompt: task.prompt,
            missedAt: check.toISOString(),
          });
          break;
        }
        check = new Date(check.getTime() + 60000);
      }
    }
    return missed;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  private computeJitter(cronExpr: string): number {
    const fields = cronExpr.trim().split(/\s+/);
    if (fields.length < 1) return 0;
    const minuteField = fields[0];
    const minuteVal = parseInt(minuteField, 10);
    if (!isNaN(minuteVal) && JITTER_MINUTES.includes(minuteVal)) {
      const hash = cronExpr.split("").reduce((acc, c) => (acc + c.charCodeAt(0)) % 0xffffffff, 0);
      return (hash % JITTER_OFFSET_MAX) + 1;
    }
    return 0;
  }

  private checkLoop(): void {
    if (this.stopEvent) return;
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (currentMinute !== this.lastCheckMinute) {
      this.lastCheckMinute = currentMinute;
      this.checkTasks(now);
    }
  }

  private checkTasks(now: Date): void {
    const expired: string[] = [];
    const firedOneshots: string[] = [];
    for (const task of this.tasks) {
      const ageDays = (Date.now() - task.createdAt) / 86400000;
      if (task.recurring && ageDays > AUTO_EXPIRY_DAYS) {
        expired.push(task.id);
        continue;
      }
      let checkTime = now;
      const jitter = task.jitterOffset || 0;
      if (jitter > 0) {
        checkTime = new Date(now.getTime() - jitter * 60000);
      }
      if (cronMatches(task.cron, checkTime)) {
        this.queue.push(task);
        task.lastFired = Date.now();
        console.log(`[Cron] Fired: ${task.id}`);
        if (!task.recurring) {
          firedOneshots.push(task.id);
        }
      }
    }
    if (expired.length > 0 || firedOneshots.length > 0) {
      const removeIds = new Set([...expired, ...firedOneshots]);
      this.tasks = this.tasks.filter((t) => !removeIds.has(t.id));
      for (const tid of expired) {
        console.log(`[Cron] Auto-expired: ${tid} (older than ${AUTO_EXPIRY_DAYS} days)`);
      }
      for (const tid of firedOneshots) {
        console.log(`[Cron] One-shot completed and removed: ${tid}`);
      }
      this.saveDurable();
    }
  }

  private loadDurable(): void {
    const filePath = PATHS.scheduledTasksFile;
    if (!fs.existsSync(filePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      this.tasks = data.filter((t: any) => t.durable);
    } catch (e) {
      console.log(`[Cron] Error loading tasks: ${e}`);
    }
  }

  private saveDurable(): void {
    const filePath = PATHS.scheduledTasksFile;
    const durable = this.tasks.filter((t) => t.durable);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(durable, null, 2) + "\n");
  }
}
