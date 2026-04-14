import { promises as fs, accessSync } from "fs";
import * as path from "path";

// -- 记忆类型 --
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

// -- 边界1: 作用域 --
export const MEMORY_SCOPES = ["private", "team"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

// -- 边界2: 反馈情感 --
export const MEMORY_SENTIMENTS = ["positive", "negative", "neutral"] as const;
export type MemorySentiment = (typeof MEMORY_SENTIMENTS)[number];

const MAX_INDEX_LINES = 200;

/**
 * 根据类型推断默认作用域
 * - user → private（个人偏好不应强加团队）
 * - feedback → private（除非明确是团队规则）
 * - project / reference → team（项目事实和资源指引通常团队共享）
 */
function inferScope(type: MemoryType, explicitScope?: string): MemoryScope {
  if (explicitScope && MEMORY_SCOPES.includes(explicitScope as MemoryScope)) {
    return explicitScope as MemoryScope;
  }
  return type === "user" || type === "feedback" ? "private" : "team";
}

// -- 边界3: 易过时内容识别 --
const EPHEMERAL_PATTERNS = [
  /\bcurrent\s+branch\b/i,
  /\bcurrent(ly)?\s+(working|doing|task)\b/i,
  /\bthis\s+week\b/i,
  /\btoday\b/i,
  /\bPR\s*#?\d+/i,
  /\bissue\s*#?\d+/i,
  /\bsprint\s+\d+/i,
  /\bcommit\s+[0-9a-f]{7,}/i,
  /\b(api[_-]?key|password|secret|token)\b/i,
];

// -- 类型定义 --
export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  scope: MemoryScope;
  sentiment: MemorySentiment;
  content: string;
  file: string;
  storageDir: string;
}

/**
 * MemorySystem - 跨会话持久化记忆
 *
 * 6 条生产级边界：
 *
 * 1. 作用域（scope）: private 只属于当前用户，team 团队共享
 *    - user/feedback 默认 private；project/reference 默认 team
 *    - 不把个人偏好误写成团队规范，也不把团队规范锁在私有记忆里
 *
 * 2. 正反馈（sentiment）: 不只存"你做错了"，也存"这样做是对的"
 *    - positive: 被用户确认有效的做法
 *    - negative: 被用户纠正的错误
 *    - neutral: 中性事实陈述
 *
 * 3. 存储守卫（guard）: 即使用户要求存，也拒绝易过时内容
 *    - 当前分支名、PR 编号、本周任务…这些太容易过时
 *    - 密钥凭据绝不存储
 *    - 返回警告，建议提取真正值得长期留下的信息
 *
 * 4. 漂移核对（drift）: memory 是方向提示，不是永久真理
 *    - prompt 中标注记忆来源和时效性提醒
 *    - 模型应先读当前文件再下结论
 *
 * 5. 静默模式（suppress）: 用户说"忽略记忆"时按空处理
 *    - suppressMemories() 让本轮 buildPromptSection 返回空
 *    - restoreMemories() 恢复
 *
 * 6. 引用验证（verify）: 推荐路径/函数/URL 前要再验证
 *    - reference 类型在 prompt 中附带验证提醒
 */
export class MemorySystem {
  private teamMemoryDir: string;
  private privateMemoryDir: string;
  private memories: Map<string, MemoryEntry> = new Map();
  private suppressed = false;

  constructor(teamMemoryDir: string, privateMemoryDir?: string) {
    this.teamMemoryDir = teamMemoryDir;
    // backward-compatible: if private dir is omitted, keep single-dir behavior
    this.privateMemoryDir = privateMemoryDir ?? teamMemoryDir;
  }

  // ========================
  // 初始化
  // ========================

  async init(): Promise<void> {
    this.memories.clear();

    await this.loadFromDir(this.teamMemoryDir);
    if (this.privateMemoryDir !== this.teamMemoryDir) {
      await this.loadFromDir(this.privateMemoryDir);
    }
  }

  private async loadFromDir(dir: string): Promise<void> {
    try {
      await fs.access(dir);
    } catch {
      return;
    }

    try {
      const entries = await fs.readdir(dir);
      for (const fileName of entries.sort()) {
        if (!fileName.endsWith(".md") || fileName === "MEMORY.md") continue;

        const filePath = path.join(dir, fileName);

        try {
          const raw = await fs.readFile(filePath, "utf-8");
          const parsed = this.parseFrontmatter(raw);
          if (!parsed) continue;

          const name = parsed.meta.name || path.basename(fileName, ".md");
          const memType = parsed.meta.type as MemoryType;
          if (!MEMORY_TYPES.includes(memType)) continue;

          this.memories.set(name, {
            name,
            description: parsed.meta.description || "",
            type: memType,
            scope: inferScope(memType, parsed.meta.scope),
            sentiment: (MEMORY_SENTIMENTS.includes(parsed.meta.sentiment as MemorySentiment)
              ? parsed.meta.sentiment
              : "neutral") as MemorySentiment,
            content: parsed.body,
            file: fileName,
            storageDir: dir,
          });
        } catch {
          // 跳过无法解析的文件
        }
      }
    } catch {
      return;
    }
  }

  // ========================
  // 边界5: 静默模式
  // ========================

  suppressMemories(): void {
    this.suppressed = true;
  }

  restoreMemories(): void {
    this.suppressed = false;
  }

  isSuppressed(): boolean {
    return this.suppressed;
  }

  // ========================
  // Prompt 构建（含边界4漂移提醒 + 边界6验证提示）
  // ========================

  buildPromptSection(): string {
    // 边界5: 用户明确要求忽略记忆时，返回空
    if (this.suppressed || this.memories.size === 0) return "";

    const sections: string[] = [
      "# Memories (persistent across sessions)",
      "",
      // 边界4: 漂移核对提醒
      "> These memories are directional hints, NOT verified truths.",
      "> Before acting on a memory that references a specific path, function, URL, or config,",
      "> re-read the current source to confirm it still holds. If reality conflicts, trust what you observe now.",
      "",
    ];

    for (const memType of MEMORY_TYPES) {
      const typed = [...this.memories.values()].filter((m) => m.type === memType);
      if (typed.length === 0) continue;

      sections.push(`## [${memType}]`);
      for (const mem of typed) {
        const tags: string[] = [];
        if (mem.scope !== "private") tags.push(`scope:${mem.scope}`);
        if (mem.sentiment !== "neutral") tags.push(`sentiment:${mem.sentiment}`);
        const tagStr = tags.length > 0 ? ` (${tags.join(", ")})` : "";

        sections.push(`### ${mem.name}: ${mem.description}${tagStr}`);
        if (mem.content.trim()) {
          sections.push(mem.content.trim());
        }

        // 边界6: reference 类型附带验证提醒
        if (memType === "reference") {
          sections.push("_⚠ Verify this reference still exists before recommending it to the user._");
        }

        sections.push("");
      }
    }

    return sections.join("\n");
  }

  // ========================
  // 保存（含边界3存储守卫）
  // ========================

  async saveMemory(
    name: string,
    description: string,
    type: MemoryType,
    content: string,
    scope?: MemoryScope,
    sentiment?: MemorySentiment,
  ): Promise<string> {
    if (!MEMORY_TYPES.includes(type)) {
      return `Error: type must be one of ${MEMORY_TYPES.join(", ")}`;
    }

    // 边界3: 存储守卫 — 检测易过时/敏感内容
    const guardWarning = this.guardContent(name, description, content);
    if (guardWarning) {
      return guardWarning;
    }

    const safeName = name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    if (!safeName) {
      return "Error: invalid memory name";
    }

    const resolvedScope = inferScope(type, scope);
    const resolvedSentiment: MemorySentiment =
      sentiment && MEMORY_SENTIMENTS.includes(sentiment) ? sentiment : "neutral";
    const targetDir = this.getDirByScope(resolvedScope);

    await fs.mkdir(targetDir, { recursive: true });

    const frontmatter = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      `type: ${type}`,
      `scope: ${resolvedScope}`,
      `sentiment: ${resolvedSentiment}`,
      "---",
      content,
      "",
    ].join("\n");

    const fileName = `${safeName}.md`;
    const filePath = path.join(targetDir, fileName);
    await fs.writeFile(filePath, frontmatter, "utf-8");

    this.memories.set(name, {
      name,
      description,
      type,
      scope: resolvedScope,
      sentiment: resolvedSentiment,
      content,
      file: fileName,
      storageDir: targetDir,
    });

    await this.rebuildIndexes();

    return `Saved memory '${name}' [${type}, ${resolvedScope}, ${resolvedSentiment}] to ${fileName}`;
  }

  async deleteMemory(name: string): Promise<string> {
    const entry = this.memories.get(name);
    if (!entry) {
      const known = [...this.memories.keys()].sort().join(", ") || "(none)";
      return `Error: unknown memory '${name}'. Available: ${known}`;
    }

    const filePath = path.join(entry.storageDir, entry.file);
    try {
      await fs.unlink(filePath);
    } catch {
      // 文件已不存在，也算成功
    }

    this.memories.delete(name);
    await this.rebuildIndexes();

    return `Deleted memory '${name}'`;
  }

  listMemories(): string {
    if (this.memories.size === 0) {
      return "(no memories)";
    }

    const lines: string[] = [];
    for (const [name, mem] of this.memories) {
      lines.push(`  [${mem.type}|${mem.scope}|${mem.sentiment}] ${name}: ${mem.description}`);
    }
    return lines.join("\n");
  }

  count(): number {
    return this.memories.size;
  }

  // ========================
  // 私有方法
  // ========================

  /**
   * 边界3: 存储守卫
   *
   * 即使用户要求保存，以下内容也不应直接存入 memory：
   * - 易过时信息（当前分支、PR 编号、本周任务等）
   * - 密钥凭据
   *
   * 返回 null 表示通过，否则返回拒绝理由。
   */
  private guardContent(name: string, description: string, content: string): string | null {
    const combined = `${name} ${description} ${content}`;

    for (const pattern of EPHEMERAL_PATTERNS) {
      const match = combined.match(pattern);
      if (match) {
        // 密钥类 → 硬拒绝
        if (/\b(api[_-]?key|password|secret|token)\b/i.test(match[0])) {
          return `Error: Refused to store memory — detected potential secret/credential ("${match[0]}"). Secrets must NEVER be stored in memory.`;
        }

        // 易过时类 → 软拒绝 + 引导
        return [
          `Warning: This memory contains ephemeral content ("${match[0]}") that is likely to become stale.`,
          `Instead of saving it directly, consider:`,
          `  - Extracting the non-obvious, long-lasting insight behind it`,
          `  - Storing it in a task tracker, git commit, or code comment instead`,
          `If you still want to save, rephrase the content to remove time-sensitive details and try again.`,
        ].join("\n");
      }
    }

    return null;
  }

  private async rebuildIndexes(): Promise<void> {
    await this.rebuildIndexForDir(this.teamMemoryDir, "team");
    if (this.privateMemoryDir !== this.teamMemoryDir) {
      await this.rebuildIndexForDir(this.privateMemoryDir, "private");
    }
  }

  private async rebuildIndexForDir(dir: string, scope: MemoryScope): Promise<void> {
    const lines: string[] = ["# Memory Index", ""];

    for (const [name, mem] of this.memories) {
      if (mem.scope !== scope) continue;
      lines.push(`- ${name}: ${mem.description} [${mem.type}|${mem.scope}]`);
      if (lines.length >= MAX_INDEX_LINES) {
        lines.push(`... (truncated at ${MAX_INDEX_LINES} lines)`);
        break;
      }
    }

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "MEMORY.md"), lines.join("\n") + "\n", "utf-8");
  }

  private getDirByScope(scope: MemoryScope): string {
    return scope === "private" ? this.privateMemoryDir : this.teamMemoryDir;
  }

  private parseFrontmatter(
    text: string,
  ): { meta: Record<string, string>; body: string } | null {
    const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)/);
    if (!match) return null;

    const meta: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }

    return { meta, body: match[2].trim() };
  }
}

// ================================================================
// DreamConsolidator - 会话间记忆智能整理
// ================================================================

/**
 * 合并指令 — LLM 返回的结构化结果
 */
export interface ConsolidationAction {
  action: "keep" | "merge" | "delete";
  names: string[];         // 涉及的记忆名称
  mergedName?: string;     // merge 时的新名称
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
 *
 * 4 阶段流水线：
 * 1. Orient  — 扫描索引，理解记忆结构
 * 2. Gather  — 读取全部记忆正文
 * 3. Consolidate — LLM 决策：合并重复、删除过时、保留有效
 * 4. Prune   — 执行决策，重建索引，限制在 200 行以内
 */
export class DreamConsolidator {
  // -- 门控参数 --
  static readonly COOLDOWN_SECONDS = 86400;      // 24h 冷却
  static readonly SCAN_THROTTLE_SECONDS = 600;    // 10min 扫描节流
  static readonly MIN_SESSION_COUNT = 5;          // 至少 5 次会话
  static readonly MIN_MEMORY_COUNT = 5;           // 至少 5 条记忆才值得整理
  static readonly LOCK_STALE_SECONDS = 3600;      // 锁超过 1h 视为过期

  private memoryDir: string;
  private lockFile: string;
  private enabled = true;
  private mode: "default" | "plan" = "default";
  private lastConsolidationTime = 0;
  private lastScanTime = 0;
  private sessionCount = 0;
  private stateFile: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.lockFile = path.join(this.memoryDir, ".dream_lock");
    this.stateFile = path.join(this.memoryDir, ".dream_state.json");
  }

  /**
   * 加载上次整理状态（时间戳、会话计数）
   */
  async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.stateFile, "utf-8");
      const state = JSON.parse(raw);
      this.lastConsolidationTime = state.lastConsolidationTime ?? 0;
      this.sessionCount = state.sessionCount ?? 0;
    } catch {
      // 首次运行，无历史状态
    }
  }

  /**
   * 持久化整理状态
   */
  private async saveState(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.writeFile(
      this.stateFile,
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

    // Gate 2: 记忆目录是否存在且有文件
    let memoryFiles: string[];
    try {
      const entries = await fs.readdir(this.memoryDir);
      memoryFiles = entries.filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
    } catch {
      return { canRun: false, reason: "Gate 2: memory directory does not exist" };
    }

    if (memoryFiles.length === 0) {
      return { canRun: false, reason: "Gate 2: no memory files found" };
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

    // Gate 7: PID 锁（无其他进程在整理）
    if (!await this.acquireLock()) {
      return { canRun: false, reason: "Gate 7: lock held by another process" };
    }

    return { canRun: true, reason: "All 7 gates passed" };
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
      const indexContent = await this.readIndexOrBuild(memorySystem);

      // Phase 2: Gather — 读取各条记忆文件的完整正文
      log.push("[Dream] Phase 2/4: Gather — reading all memory files");
      const allMemories = await this.gatherMemories();

      if (allMemories.length === 0) {
        log.push("[Dream] No memories to consolidate");
        return log;
      }

      // Phase 3: Consolidate — LLM 决策合并、删除、保留
      log.push("[Dream] Phase 3/4: Consolidate — LLM decision");
      const prompt = this.buildConsolidationPrompt(indexContent, allMemories);
      const llmResponse = await summarize(prompt);
      const actions = this.parseActions(llmResponse);

      if (actions.length === 0) {
        log.push("[Dream] LLM returned no actions, memories unchanged");
      } else {
        // Phase 4: Prune — 执行决策，重建索引，限制 200 行
        log.push("[Dream] Phase 4/4: Prune — executing actions");
        const actionLog = await this.executeActions(actions, memorySystem);
        log.push(...actionLog);
      }

      this.lastConsolidationTime = Date.now() / 1000;
      await this.saveState();
    } finally {
      await this.releaseLock();
    }

    log.push(`[Dream] Consolidation complete: ${log.length} steps`);
    return log;
  }

  // ========================
  // 私有方法
  // ========================

  private async readIndexOrBuild(memorySystem: MemorySystem): Promise<string> {
    try {
      return await fs.readFile(path.join(this.memoryDir, "MEMORY.md"), "utf-8");
    } catch {
      return memorySystem.listMemories();
    }
  }

  private async gatherMemories(): Promise<Array<{ fileName: string; raw: string }>> {
    const results: Array<{ fileName: string; raw: string }> = [];

    let entries: string[];
    try {
      entries = await fs.readdir(this.memoryDir);
    } catch {
      return results;
    }

    for (const fileName of entries.sort()) {
      if (!fileName.endsWith(".md") || fileName === "MEMORY.md") continue;

      try {
        const raw = await fs.readFile(path.join(this.memoryDir, fileName), "utf-8");
        results.push({ fileName, raw });
      } catch {
        // 跳过不可读文件
      }
    }

    return results;
  }

  private buildConsolidationPrompt(
    index: string,
    memories: Array<{ fileName: string; raw: string }>,
  ): string {
    const memoryDump = memories
      .map((m) => `=== ${m.fileName} ===\n${m.raw}`)
      .join("\n\n");

    return [
      "You are a memory consolidation agent. Your job is to review stored memories and decide which to keep, merge, or delete.",
      "",
      "Rules:",
      "- MERGE memories that cover the same topic or overlap significantly. Combine their contents into one richer entry.",
      "- DELETE memories that are stale (reference outdated branches, old PRs, obsolete facts) or duplicate.",
      "- KEEP memories that are still relevant and unique.",
      "- Preserve the frontmatter fields: name, description, type, scope, sentiment.",
      "- When merging, pick the most appropriate type/scope/sentiment from the originals.",
      "- Do NOT invent new information. Only reorganize what exists.",
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
  ): Promise<string[]> {
    const log: string[] = [];

    for (const action of actions) {
      switch (action.action) {
        case "keep":
          log.push(`  keep: ${action.names.join(", ")} — ${action.reason}`);
          break;

        case "delete":
          for (const name of action.names) {
            const result = await memorySystem.deleteMemory(name);
            log.push(`  delete: ${name} — ${action.reason} (${result})`);
          }
          break;

        case "merge": {
          if (!action.mergedName || !action.mergedContent) {
            log.push(`  merge: skipped (missing mergedName/mergedContent)`);
            break;
          }

          // 先删除旧的
          for (const name of action.names) {
            await memorySystem.deleteMemory(name);
          }

          // 再保存合并后的
          const result = await memorySystem.saveMemory(
            action.mergedName,
            action.mergedDescription || "",
            (action.mergedType as MemoryType) || "project",
            action.mergedContent,
            action.mergedScope as MemoryScope | undefined,
            action.mergedSentiment as MemorySentiment | undefined,
          );
          log.push(`  merge: ${action.names.join(" + ")} → ${action.mergedName} — ${action.reason} (${result})`);
          break;
        }
      }
    }

    return log;
  }

  // -- PID 锁 --

  private async acquireLock(): Promise<boolean> {
    const now = Date.now() / 1000;

    try {
      accessSync(this.lockFile);
      // 锁文件存在 → 检查是否过期
      const lockData = await fs.readFile(this.lockFile, "utf-8");
      const [pidStr, timeStr] = lockData.trim().split(":");
      const pid = parseInt(pidStr, 10);
      const lockTime = parseFloat(timeStr);

      // 锁超时 → 移除
      if (now - lockTime > DreamConsolidator.LOCK_STALE_SECONDS) {
        await fs.unlink(this.lockFile);
      } else {
        // 检查 PID 是否仍存活
        try {
          process.kill(pid, 0);
          return false; // 进程还活着，锁有效
        } catch {
          // 进程已死，移除锁
          await fs.unlink(this.lockFile);
        }
      }
    } catch {
      // 锁文件不存在或损坏，都可以继续
    }

    // 写入新锁
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      await fs.writeFile(this.lockFile, `${process.pid}:${now}`, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      const lockData = await fs.readFile(this.lockFile, "utf-8");
      const pidStr = lockData.trim().split(":")[0];
      if (parseInt(pidStr, 10) === process.pid) {
        await fs.unlink(this.lockFile);
      }
    } catch {
      // 锁文件不存在或不属于自己，忽略
    }
  }
}
