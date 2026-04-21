import { promises as fs, accessSync } from "fs";
import * as path from "path";

import { MemoryScope, MemorySentiment, MemorySystem, MemoryType } from "./memorySystem";

// ================================================================
// DreamConsolidator - 会话间记忆智能整理
// ================================================================

/**
 * 合并指令 — LLM 返回的结构化结果
 */
export interface ConsolidationAction {
  action: "keep" | "merge" | "delete";
  names: string[]; // 涉及的记忆名称
  mergedName?: string; // merge 时的新名称
  mergedDescription?: string;
  mergedType?: MemoryType;
  mergedScope?: MemoryScope;
  mergedSentiment?: MemorySentiment;
  mergedContent?: string;
  reason: string;
}

/**
 * DreamConsolidator - 记忆整理器
 *
 * 在会话之间（或会话结束时）对累积的记忆做智能合并、去重、裁剪。
 * 类比人类在睡眠中整理白天的记忆碎片 → "Dream"。
 *
 * 设计原则：
 * - 不自动触发，需要满足 7 道门控（gates）全部通过
 * - 通过注入的 summarize 函数调用 LLM，自身不持有 client（低耦合）
 * - PID 锁防止并发整理
 * - 整理结果直接写回 MemorySystem 的目录，由 MemorySystem.init() 重载
 * - 团队记忆和个人记忆分离整理
 *
 * 4 阶段流水线：
 * 1. Orient — 扫描索引，理解记忆结构
 * 2. Gather — 读取全部记忆正文
 * 3. Consolidate — LLM 决策：合并重复、删除过时、保留有效
 * 4. Prune — 执行决策，重建索引，限制在 200 行以内
 */
export class DreamConsolidator {
  // -- 门控参数 --
  static readonly COOLDOWN_SECONDS = 86400; // 24h 冷却
  static readonly SCAN_THROTTLE_SECONDS = 600; // 10min 扫描节流
  static readonly MIN_SESSION_COUNT = 5; // 至少 5 次会话
  static readonly MIN_MEMORY_COUNT = 5; // 至少 5 条记忆才值得整理
  static readonly LOCK_STALE_SECONDS = 3600; // 锁超过 1h 视为过期

  private teamMemoryDir: string;
  private privateMemoryDir: string;
  private teamLockFile: string;
  private privateLockFile: string;
  private teamStateFile: string;
  private enabled = true;
  private mode: "default" | "plan" = "default";
  private lastConsolidationTime = 0;
  private lastScanTime = 0;
  private sessionCount = 0;

  constructor(teamMemoryDir: string, privateMemoryDir: string) {
    this.teamMemoryDir = teamMemoryDir;
    this.privateMemoryDir = privateMemoryDir;
    this.teamLockFile = path.join(this.teamMemoryDir, ".dream_lock");
    this.privateLockFile = path.join(this.privateMemoryDir, ".dream_lock");
    this.teamStateFile = path.join(this.teamMemoryDir, ".dream_state.json");
  }

  /**
   * 加载上次整理状态（时间戳、会话计数）
   */
  async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.teamStateFile, "utf-8");
      const state = JSON.parse(raw);
      this.lastConsolidationTime = state.lastConsolidationTime ?? 0;
      this.sessionCount = state.sessionCount ?? 0;
    } catch {
      // 首次运行，无历史状态
    }
  }

  /**
   * 持久化整理状态（写入团队记忆目录）
   */
  private async saveState(): Promise<void> {
    await fs.mkdir(this.teamMemoryDir, { recursive: true });
    await fs.writeFile(
      this.teamStateFile,
      JSON.stringify({
        lastConsolidationTime: this.lastConsolidationTime,
        sessionCount: this.sessionCount,
      }),
      "utf-8",
    );
  }

  /**
   * 会话开始时调用 — 递增计数
   */
  async incrementSession(): Promise<void> {
    await this.loadState();
    this.sessionCount++;
    await this.saveState();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setMode(mode: "default" | "plan"): void {
    this.mode = mode;
  }

  // ========================
  // 7 道门控（全部通过才允许整理）
  // ========================

  async shouldConsolidate(): Promise<{ canRun: boolean; reason: string }> {
    const now = Date.now() / 1000;

    // Gate 1: 总开关
    if (!this.enabled) {
      return { canRun: false, reason: "Gate 1: consolidation is disabled" };
    }

    // Gate 2: 记忆目录中是否有文件（团队或个人）
    const teamHasFiles = await this.dirHasMemoryFiles(this.teamMemoryDir);
    const privateHasFiles = await this.dirHasMemoryFiles(this.privateMemoryDir);

    if (!teamHasFiles && !privateHasFiles) {
      return { canRun: false, reason: "Gate 2: no memory files found in any directory" };
    }

    // Gate 3: plan 模式不允许整理（只在活跃模式下整理）
    if (this.mode === "plan") {
      return { canRun: false, reason: "Gate 3: plan mode does not allow consolidation" };
    }

    // Gate 4: 24h 冷却
    const timeSinceLast = now - this.lastConsolidationTime;
    if (timeSinceLast < DreamConsolidator.COOLDOWN_SECONDS) {
      const remaining = Math.ceil(DreamConsolidator.COOLDOWN_SECONDS - timeSinceLast);
      return { canRun: false, reason: `Gate 4: cooldown active, ${remaining}s remaining` };
    }

    // Gate 5: 10min 扫描节流
    const timeSinceScan = now - this.lastScanTime;
    if (timeSinceScan < DreamConsolidator.SCAN_THROTTLE_SECONDS) {
      const remaining = Math.ceil(DreamConsolidator.SCAN_THROTTLE_SECONDS - timeSinceScan);
      return { canRun: false, reason: `Gate 5: scan throttle active, ${remaining}s remaining` };
    }

    // Gate 6: 至少经历过足够多的会话
    if (this.sessionCount < DreamConsolidator.MIN_SESSION_COUNT) {
      return {
        canRun: false,
        reason: `Gate 6: only ${this.sessionCount} sessions, need ${DreamConsolidator.MIN_SESSION_COUNT}`,
      };
    }

    // Gate 7: PID 锁（检查团队和个人目录，无其他进程在整理）
    if (!teamHasFiles || !privateHasFiles) {
      // 只有有文件的目录才需要检查锁，避免无文件目录的锁干扰整理
      const teamLocked = teamHasFiles && !(await this.acquireLock(this.teamMemoryDir, this.teamLockFile));
      const privateLocked = privateHasFiles && !(await this.acquireLock(this.privateMemoryDir, this.privateLockFile));

      if (teamLocked || privateLocked) {
        return { canRun: false, reason: "Gate 7: lock held by another process" };
      }
    }

    return { canRun: true, reason: "All 7 gates passed" };
  }

  private async dirHasMemoryFiles(dir: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(dir);
      return entries.some((f) => f.endsWith(".md") && f !== "MEMORY.md");
    } catch {
      return false;
    }
  }

  // ========================
  // 4 阶段整理流水线
  // ========================

  /**
   * 执行整理。
   *
   * @param summarize - 外部注入的 LLM 调用函数（低耦合）
   *   输入是整理 prompt，输出是 JSON 字符串（ConsolidationAction[]）
   * @param memorySystem - 用于写回结果
   */
  async consolidate(
    summarize: (prompt: string) => Promise<string>,
    memorySystem: MemorySystem,
  ): Promise<string[]> {
    const { canRun, reason } = await this.shouldConsolidate();
    if (!canRun) {
      return [`[Dream] Cannot consolidate: ${reason}`];
    }
  
    this.lastScanTime = Date.now() / 1000;
    const log: string[] = [];

    try {
      // Phase 1: Orient — 扫描 MEMORY.md 索引，了解结构和分类
      log.push("[Dream] Phase 1/4: Orient — scanning memory index");
      const { teamIndex, privateIndex } = await this.readIndexOrBuild(memorySystem);

      // Phase 2: Gather — 读取各条记忆文件的完整正文（分离团队/个人）
      log.push("[Dream] Phase 2/4: Gather — reading all memory files");
      const { teamMemories, privateMemories } = await this.gatherMemories();

      // Phase 3: Consolidate — LLM 决策合并、删除、保留（分别处理团队和个人）
      log.push("[Dream] Phase 3/4: Consolidate — LLM decision");

      // 3a: 团队记忆整理
      if (teamMemories.length > 0) {
        log.push(`  [Team] processing ${teamMemories.length} memories`);
        const teamPrompt = this.buildConsolidationPrompt("team", teamIndex, teamMemories);
        const teamResponse = await summarize(teamPrompt);
        const teamActions = this.parseActions(teamResponse);
        if (teamActions.length > 0) {
          const actionLog = await this.executeActions(teamActions, memorySystem, "team");
          log.push(...actionLog.map((l) => `  [Team] ${l}`));
        } else {
          log.push("  [Team] LLM returned no actions, memories unchanged");
        }
      }

      // 3b: 个人记忆整理
      if (privateMemories.length > 0) {
        log.push(`  [Private] processing ${privateMemories.length} memories`);
        const privatePrompt = this.buildConsolidationPrompt("private", privateIndex, privateMemories);
        const privateResponse = await summarize(privatePrompt);
        const privateActions = this.parseActions(privateResponse);
        if (privateActions.length > 0) {
          const actionLog = await this.executeActions(privateActions, memorySystem, "private");
          log.push(...actionLog.map((l) => `  [Private] ${l}`));
        } else {
          log.push("  [Private] LLM returned no actions, memories unchanged");
        }
      }

      this.lastConsolidationTime = Date.now() / 1000;
      await this.saveState();
    } finally {
      await this.releaseLock(this.teamMemoryDir, this.teamLockFile);
      await this.releaseLock(this.privateMemoryDir, this.privateLockFile);
    }

    log.push(`[Dream] Consolidation complete: ${log.length} steps`);
    return log;
  }

  // ========================
  // 私有方法
  // ========================

  private async readIndexOrBuild(
    memorySystem: MemorySystem,
  ): Promise<{ teamIndex: string; privateIndex: string }> {
    const teamIndex = await this.readIndex(this.teamMemoryDir, memorySystem);
    const privateIndex =
      this.privateMemoryDir !== this.teamMemoryDir
        ? await this.readIndex(this.privateMemoryDir, memorySystem)
        : teamIndex;
    return { teamIndex, privateIndex };
  }

  private async readIndex(dir: string, memorySystem: MemorySystem): Promise<string> {
    try {
      const content = await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8");
      return content.trim();
    } catch {
      return memorySystem.listMemories();
    }
  }

  private async gatherMemories(): Promise<{
    teamMemories: Array<{ fileName: string; raw: string; scope: "team" | "private" }>;
    privateMemories: Array<{ fileName: string; raw: string; scope: "team" | "private" }>;
  }> {
    const teamMemories: Array<{ fileName: string; raw: string; scope: "team" | "private" }> = [];
    const privateMemories: Array<{ fileName: string; raw: string; scope: "team" | "private" }> = [];
    const seen = new Set<string>();

    // 收集团队记忆
    await this.collectMemoriesFromDir(this.teamMemoryDir, "team", teamMemories, seen);

    // 收集个人记忆（如果目录不同）
    if (this.privateMemoryDir !== this.teamMemoryDir) {
      await this.collectMemoriesFromDir(this.privateMemoryDir, "private", privateMemories, seen);
    }

    return { teamMemories, privateMemories };
  }

  private async collectMemoriesFromDir(
    dir: string,
    scope: "team" | "private",
    results: Array<{ fileName: string; raw: string; scope: "team" | "private" }>,
    seen: Set<string>,
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const fileName of entries.sort()) {
      if (!fileName.endsWith(".md") || fileName === "MEMORY.md") continue;
      if (seen.has(fileName)) continue;
      seen.add(fileName);

      try {
        const raw = await fs.readFile(path.join(dir, fileName), "utf-8");
        results.push({ fileName, raw, scope });
      } catch {
        // 跳过不可读文件
      }
    }
  }

  private buildConsolidationPrompt(
    scope: "team" | "private",
    index: string,
    memories: Array<{ fileName: string; raw: string }>,
  ): string {
    const memoryDump = memories
      .map((m) => `=== ${m.fileName} ===\n${m.raw}`)
      .join("\n\n");

    const scopeHint =
      scope === "team"
        ? "- Team memories represent shared project context, reference materials, and group conventions."
        : "- Private memories represent personal preferences, feedback, and individual project context.";

    return [
      `You are a memory consolidation agent for ${scope} memories. Your job is to review stored memories and decide which to keep, merge, or delete.`,
      "",
      "Rules:",
      "- MERGE memories that cover the same topic or overlap significantly. Combine their contents into one richer entry.",
      "- DELETE memories that are stale (reference outdated branches, old PRs, obsolete facts) or duplicate.",
      "- KEEP memories that are still relevant and unique.",
      "- Preserve the frontmatter fields: name, description, type, scope, sentiment.",
      "- When merging, pick the most appropriate type/scope/sentiment from the originals.",
      "- Do NOT invent new information. Only reorganize what exists.",
      "- Do NOT change the scope of memories (team stays team, private stays private).",
      scopeHint,
      "",
      `This is a ${scope.toUpperCase()} memory consolidation.`,
      "",
      "Current memory index:",
      index,
      "",
      "Full memory contents:",
      memoryDump,
      "",
      "Respond with a JSON array of actions. Each action is one of:",
      '  {"action":"keep","names":["mem_name"],"reason":"..."}',
      '  {"action":"merge","names":["a","b"],"mergedName":"...","mergedDescription":"...","mergedType":"...","mergedScope":"...","mergedSentiment":"...","mergedContent":"...","reason":"..."}',
      '  {"action":"delete","names":["old_mem"],"reason":"..."}',
      "",
      "Return ONLY the JSON array, no other text.",
    ].join("\n");
  }

  private parseActions(llmResponse: string): ConsolidationAction[] {
    // 提取 JSON 数组（LLM 可能包裹在 ```json ``` 中）
    const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (a: any) =>
          a &&
          typeof a.action === "string" &&
          ["keep", "merge", "delete"].includes(a.action) &&
          Array.isArray(a.names) &&
          a.names.length > 0,
      ) as ConsolidationAction[];
    } catch {
      return [];
    }
  }

  private async executeActions(
    actions: ConsolidationAction[],
    memorySystem: MemorySystem,
    scope: "team" | "private",
  ): Promise<string[]> {
    const log: string[] = [];

    for (const action of actions) {
      switch (action.action) {
        case "keep":
          log.push(`keep: ${action.names.join(", ")} — ${action.reason}`);
          break;

        case "delete":
          for (const name of action.names) {
            const result = await memorySystem.deleteMemory(name);
            log.push(`delete: ${name} — ${action.reason} (${result})`);
          }
          break;

        case "merge": {
          if (!action.mergedName || !action.mergedContent) {
            log.push(`merge: skipped (missing mergedName/mergedContent)`);
            break;
          }

          // 先删除旧的
          for (const name of action.names) {
            await memorySystem.deleteMemory(name);
          }

          // 再保存合并后的（保持原有 scope）
          const result = await memorySystem.saveMemory(
            action.mergedName,
            action.mergedDescription || "",
            (action.mergedType as MemoryType) || "project",
            action.mergedContent,
            scope as MemoryScope, // 保持 scope 不变
            action.mergedSentiment as MemorySentiment | undefined,
          );
          log.push(`merge: ${action.names.join(" + ")} → ${action.mergedName} — ${action.reason} (${result})`);
          break;
        }
      }
    }

    return log;
  }

  // -- PID 锁： 做到多进程互斥 --

  private async acquireLock(dir: string, lockFile: string): Promise<boolean> {
    const now = Date.now() / 1000;

    try {
      accessSync(lockFile);
      // 锁文件存在 → 检查是否过期
      const lockData = await fs.readFile(lockFile, "utf-8");
      const [pidStr, timeStr] = lockData.trim().split(":");
      const pid = parseInt(pidStr, 10);
      const lockTime = parseFloat(timeStr);

      // 锁超时 → 移除
      if (now - lockTime > DreamConsolidator.LOCK_STALE_SECONDS) {
        await fs.unlink(lockFile);
      } else {
        // 检查 PID 是否仍存活
        try {
          process.kill(pid, 0);
          return false; // 进程还活着，锁有效
        } catch {
          // 进程已死，移除锁
          await fs.unlink(lockFile);
        }
      }
    } catch {
      // 锁文件不存在或损坏，都可以继续
    }

    // 写入新锁
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(lockFile, `${process.pid}:${now}`, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  // 释放锁
  private async releaseLock(_dir: string, lockFile: string): Promise<void> {
    try {
      const lockData = await fs.readFile(lockFile, "utf-8");
      const pidStr = lockData.trim().split(":")[0];
      if (parseInt(pidStr, 10) === process.pid) {
        await fs.unlink(lockFile);
      }
    } catch {
      // 锁文件不存在或不属于自己，忽略
    }
  }
}
