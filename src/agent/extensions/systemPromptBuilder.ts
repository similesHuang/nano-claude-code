import { readFileSync } from "fs";
import * as path from "path";
import * as os from "os";
import type { MemorySystem } from "./memorySystem/memorySystem";
import type { SkillsSystem } from "../systems/skillsSystem";

/**
 * SystemPromptBuilder - 系统提示词流水线构建器
 *
 * 核心思想：系统提示词是一条流水线，不是一个大字符串。
 *
 * 6 个独立段落，各有一个数据源和一个职责：
 *
 *   段落              数据源              变化频率
 *   ─────────────────────────────────────────────
 *   1. core           硬编码              从不变
 *   2. memory         .memory/*.md        每轮可变（save_memory 后）
 *   3. memory guide   硬编码              从不变
 *   4. skills         skills/SKILL.md     会话内稳定
 *   5. CLAUDE.md      磁盘文件链          会话内稳定
 *   6. dynamic ctx    运行时环境          每轮变
 *
 * 不包含 tool listing — Anthropic API 的 tools 参数已经独立传入，
 * 重复注入只会浪费 token。
 *
 * 子代理使用精简提示词，不注入 memory/skills/CLAUDE.md。
 */
export class SystemPromptBuilder {
  private workdir: string;
  private memorySystem: MemorySystem;
  private skillsSystem: SkillsSystem;
  private skillsReady = false;

  constructor(opts: {
    workdir?: string;
    memorySystem: MemorySystem;
    skillsSystem: SkillsSystem;
  }) {
    this.workdir = opts.workdir ?? process.cwd();
    this.memorySystem = opts.memorySystem;
    this.skillsSystem = opts.skillsSystem;
  }

  /** 标记 skills 已完成初始化扫描 */
  markSkillsReady(): void {
    this.skillsReady = true;
  }

  // ================================================================
  // 主入口
  // ================================================================

  /** 构建子代理提示词（精简） */
  buildForSubAgent(): string {
    return `You are a coding subagent at ${this.workdir}. Complete the given task efficiently using available tools. Return only a summary of what you accomplished.`;
  }

  /** 构建主代理提示词（完整流水线） */
  build(): string {
    const sections: string[] = [];

    // 1. core
    sections.push(this.sectionCore());

    // 2. memory
    const mem = this.sectionMemory();
    if (mem) sections.push(mem);

    // 3. memory guide
    sections.push(this.sectionMemoryGuide());

    // 4. skills
    const skills = this.sectionSkills();
    if (skills) sections.push(skills);

    // 5. CLAUDE.md chain
    const claudeMd = this.sectionClaudeMd();
    if (claudeMd) sections.push(claudeMd);

    // 6. dynamic context
    sections.push(this.sectionDynamic());

    return sections.join("\n\n");
  }

  // ================================================================
  // 各段落
  // ================================================================

  /** 段落 1: 核心行为指令 */
  private sectionCore(): string {
    return `You are a coding agent at ${this.workdir}. You can use tools to interact with the system and solve tasks. Act efficiently and explain your reasoning when necessary.

---

## Task tools (task_create / task_update / task_list / task_get)

For complex multi-step work, use tasks to track progress:
- task_create: create a task with subject + description
- task_update: set status=in_progress when you start working, status=completed when done, status=deleted to remove
- task_update: set addBlockedBy=[id] on a task that must wait for another task
- task_update: set addBlocks=[id] on a task that blocks another (bidirectional — the blocked task also gets its blockedBy set)
- task_list: see all tasks at any time; task_get: see full details of one task
- NEVER mark a task completed before the work is actually done

---

## Background tools (background_run / check_background)

When you need to run a long-running command:
- background_run: fires the command immediately and returns [bg:taskId]
- After background_run returns, IMMEDIATELY call check_background with that task_id in the same response turn — do not return the task_id to the user and move on without checking
- If check_background shows [running], check again until it completes
- Example: background_run → check_background → use results

---

## When to use each tool

- bash / read_file / write_file / edit_file: direct file and shell operations
- task_* tools: track multi-step work, dependencies, and ownership
- background_run + check_background: long-running commands that shouldn't block the agent
- compact: manually compress conversation history when it gets too long
- load_skill: pull in specialized instructions for a specific domain
- save_memory: store insights that should survive across sessions`;
  }

  /** 段落 2: 持久化记忆（委托给 MemorySystem） */
  private sectionMemory(): string {
    return this.memorySystem.buildPromptSection();
  }

  /** 段落 3: 记忆使用/存储指导 */
  private sectionMemoryGuide(): string {
    return `When to save memories with save_memory tool:
- User states a preference -> type: user, scope: private
- User corrects you ("don't do X") -> type: feedback, sentiment: negative
- User confirms a practice works well -> type: feedback, sentiment: positive
- You learn a non-obvious project fact -> type: project, scope: team
- You find an external resource pointer -> type: reference, scope: team

Do NOT save:
- Code structure derivable from the repo (function signatures, file layout)
- Ephemeral state (current branch, this week's PRs, today's tasks, commit hashes)
- Secrets or credentials (API keys, passwords, tokens)
- If content contains ephemeral details, extract the lasting insight first.

When using memories:
- Treat them as directional hints, not verified truths.
- Before recommending a path, function, or URL from memory, re-read/verify it first.
- If user says "ignore memory" or "don't use memories", treat memory as empty for this turn.`;
  }

  /** 段落 4: 技能目录 */
  private sectionSkills(): string {
    if (!this.skillsReady || !this.skillsSystem.hasSkills()) return "";

    const catalog = this.skillsSystem.describeCatalog();
    return `Use load_skill when a task needs specialized instructions before you act.
Skills available:
${catalog}
IMPORTANT: After loading a skill, if it contains executable commands (e.g. lines starting with "执行命令", or code blocks marked with "exec"), you MUST execute them using the bash tool.`;
  }

  /** 段落 5: CLAUDE.md 指令链（优先级：用户全局 → 项目根 → 子目录） */
  private sectionClaudeMd(): string {
    const sources: Array<{ label: string; content: string }> = [];

    // 用户全局
    const userClaudeMd = path.join(os.homedir(), ".claude", "CLAUDE.md");
    const userContent = this.tryReadFile(userClaudeMd);
    if (userContent) {
      sources.push({ label: "user global (~/.claude/CLAUDE.md)", content: userContent });
    }

    // 项目根
    const projectClaudeMd = path.join(this.workdir, "CLAUDE.md");
    const projectContent = this.tryReadFile(projectClaudeMd);
    if (projectContent) {
      sources.push({ label: "project root (CLAUDE.md)", content: projectContent });
    }

    // 子目录（如果 cwd 不等于 workdir）
    const cwd = process.cwd();
    if (cwd !== this.workdir) {
      const subdirClaudeMd = path.join(cwd, "CLAUDE.md");
      const subdirContent = this.tryReadFile(subdirClaudeMd);
      if (subdirContent) {
        sources.push({ label: `subdir (${path.basename(cwd)}/CLAUDE.md)`, content: subdirContent });
      }
    }

    if (sources.length === 0) return "";

    const parts = ["# CLAUDE.md instructions"];
    for (const { label, content } of sources) {
      parts.push(`## From ${label}\n${content.trim()}`);
    }
    return parts.join("\n\n");
  }

  /** 段落 6: 动态运行时上下文 */
  private sectionDynamic(): string {
    return `# Dynamic context
Current date: ${new Date().toISOString().slice(0, 10)}
Working directory: ${this.workdir}
Platform: ${os.platform()}`;
  }

  // ================================================================
  // 工具方法
  // ================================================================

  private tryReadFile(filePath: string): string | null {
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }
}