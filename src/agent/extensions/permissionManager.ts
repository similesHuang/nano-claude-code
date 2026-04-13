import { minimatch } from "minimatch";

// -- 权限模式 --
export type PermissionMode = "default" | "plan" | "auto";
export const PERMISSION_MODES: PermissionMode[] = ["default", "plan", "auto"];

// -- 权限决策 --
export interface PermissionDecision {
  behavior: "allow" | "deny" | "ask";
  reason: string;
}

// -- 权限规则 --
export interface PermissionRule {
  tool: string;         // 工具名称，"*" 匹配所有
  behavior: "allow" | "deny" | "ask";
  path?: string;        // glob 模式匹配文件路径
  content?: string;     // glob 模式匹配 bash 命令内容
}

// 只读工具 & 写工具分组
const READ_ONLY_TOOLS = new Set(["read_file", "load_skill"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file", "bash"]);

// -- Bash 安全校验器 --
interface ValidationFailure {
  name: string;
  pattern: string;
}

const BASH_VALIDATORS: Array<[string, RegExp]> = [
  ["sudo", /\bsudo\b/],
  ["rm_rf", /\brm\s+(-[a-zA-Z]*)?r/],
  ["cmd_substitution", /\$\(/],
  ["ifs_injection", /\bIFS\s*=/],
];

// 严重模式：直接 deny，不可被用户覆盖
const SEVERE_PATTERNS = new Set(["sudo", "rm_rf"]);

class BashSecurityValidator {
  validate(command: string): ValidationFailure[] {
    const failures: ValidationFailure[] = [];
    for (const [name, regex] of BASH_VALIDATORS) {
      if (regex.test(command)) {
        failures.push({ name, pattern: regex.source });
      }
    }
    return failures;
  }

  describeFailures(command: string): string {
    const failures = this.validate(command);
    if (failures.length === 0) return "No issues detected";
    const parts = failures.map((f) => `${f.name} (${f.pattern})`);
    return "Security flags: " + parts.join(", ");
  }
}

// -- 默认规则 --
const DEFAULT_RULES: PermissionRule[] = [
  // 始终拒绝的危险命令
  { tool: "bash", content: "rm -rf /", behavior: "deny" },
  { tool: "bash", content: "sudo *", behavior: "deny" },
  // 允许所有文件读取
  { tool: "read_file", path: "*", behavior: "allow" },
  // 允许非写操作的工具（todo, compact, load_skill）
  { tool: "todo", behavior: "allow" },
  { tool: "compact", behavior: "allow" },
  { tool: "load_skill", behavior: "allow" },
];

// -- 权限管理器 --
export class PermissionManager {
  mode: PermissionMode;
  private rules: PermissionRule[];
  private bashValidator = new BashSecurityValidator();
  private consecutiveDenials = 0;
  private readonly maxConsecutiveDenials = 3;

  constructor(mode: PermissionMode = "default", rules?: PermissionRule[]) {
    if (!PERMISSION_MODES.includes(mode)) {
      throw new Error(`Unknown mode: ${mode}. Choose from ${PERMISSION_MODES}`);
    }
    this.mode = mode;
    this.rules = rules ?? [...DEFAULT_RULES];
  }

  /**
   * 权限管线：bash安全检查 → deny规则 → 模式检查 → allow规则 → ask
   * 返回决策，不执行 I/O —— 调用方负责处理 "ask"
   */
  check(toolName: string, toolInput: Record<string, any>): PermissionDecision {
    // Step 0: Bash 安全校验（最先执行）
    if (toolName === "bash") {
      const command = toolInput.command ?? "";
      const failures = this.bashValidator.validate(command);
      if (failures.length > 0) {
        const hasSevere = failures.some((f) => SEVERE_PATTERNS.has(f.name));
        const desc = this.bashValidator.describeFailures(command);
        if (hasSevere) {
          return { behavior: "deny", reason: `Bash 安全校验: ${desc}` };
        }
        return { behavior: "ask", reason: `Bash 安全标记: ${desc}` };
      }
    }

    // Step 1: Deny 规则（不可绕过，始终最先匹配）
    for (const rule of this.rules) {
      if (rule.behavior !== "deny") continue;
      if (this.ruleMatches(rule, toolName, toolInput)) {
        return { behavior: "deny", reason: `被 deny 规则拦截: ${JSON.stringify(rule)}` };
      }
    }

    // Step 2: 模式检查
    const modeDecision = this.checkMode(toolName);
    if (modeDecision) return modeDecision;

    // Step 3: Allow 规则
    for (const rule of this.rules) {
      if (rule.behavior !== "allow") continue;
      if (this.ruleMatches(rule, toolName, toolInput)) {
        this.consecutiveDenials = 0;
        return { behavior: "allow", reason: `匹配 allow 规则: ${JSON.stringify(rule)}` };
      }
    }

    // Step 4: 兜底 → ask
    return { behavior: "ask", reason: `${toolName} 未匹配任何规则，需要用户确认` };
  }

  /**
   * 记录用户批准：重置连续拒绝计数
   */
  recordApproval(): void {
    this.consecutiveDenials = 0;
  }

  /**
   * 记录用户拒绝：累加连续拒绝计数，返回是否触发断路器
   */
  recordDenial(): boolean {
    this.consecutiveDenials++;
    return this.consecutiveDenials >= this.maxConsecutiveDenials;
  }

  /**
   * 用户选择 "always" 时，追加一条永久 allow 规则
   */
  addAlwaysAllow(toolName: string): void {
    this.rules.push({ tool: toolName, path: "*", behavior: "allow" });
    this.consecutiveDenials = 0;
  }

  /**
   * 获取当前规则列表（只读副本）
   */
  getRules(): ReadonlyArray<PermissionRule> {
    return [...this.rules];
  }

  // -- 私有方法 --

  private checkMode(toolName: string): PermissionDecision | null {
    switch (this.mode) {
      case "plan":
        // Plan 模式：禁止所有写操作，允许读操作
        if (WRITE_TOOLS.has(toolName)) {
          return { behavior: "deny", reason: "Plan 模式: 写操作被禁止" };
        }
        return { behavior: "allow", reason: "Plan 模式: 只读操作通过" };

      case "auto":
        // Auto 模式：读操作自动通过，写操作继续走 allow 规则 → ask
        if (READ_ONLY_TOOLS.has(toolName) || toolName === "read_file") {
          return { behavior: "allow", reason: "Auto 模式: 只读工具自动通过" };
        }
        return null; // 交给后续规则判断

      case "default":
      default:
        return null; // 交给后续规则判断
    }
  }

  private ruleMatches(
    rule: PermissionRule,
    toolName: string,
    toolInput: Record<string, any>,
  ): boolean {
    // 工具名称匹配
    if (rule.tool !== "*" && rule.tool !== toolName) {
      return false;
    }

    // 路径 glob 匹配
    if (rule.path && rule.path !== "*") {
      const path = toolInput.path ?? "";
      if (!minimatch(path, rule.path)) {
        return false;
      }
    }

    // 命令内容 glob 匹配
    if (rule.content) {
      const command = toolInput.command ?? "";
      if (!minimatch(command, rule.content)) {
        return false;
      }
    }

    return true;
  }
}
