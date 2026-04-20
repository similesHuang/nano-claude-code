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
    await this.loadFromDir(this.privateMemoryDir);
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

