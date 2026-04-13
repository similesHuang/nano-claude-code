import { exec } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";

// -- Hook 事件类型 --
export type HookEvent = "SessionStart" | "PreToolUse" | "PostToolUse";
export const HOOK_EVENTS: HookEvent[] = ["SessionStart", "PreToolUse", "PostToolUse"];

// -- 退出码约定 --
// 0 → continue（静默通过）
// 1 → block（阻止工具执行）
// 2 → inject（注入消息到上下文）

const HOOK_TIMEOUT = 30_000; // 30s

// -- 类型定义 --
export interface HookDefinition {
  command: string;
  matcher?: string; // 工具名称过滤，"*" 匹配所有
}

export interface HookConfig {
  hooks?: Partial<Record<HookEvent, HookDefinition[]>>;
}

export interface HookResult {
  blocked: boolean;
  blockReason?: string;
  messages: string[];
  updatedInput?: Record<string, unknown>;
}

// -- HookManager --
export class HookManager {
  private hooks: Record<HookEvent, HookDefinition[]> = {
    SessionStart: [],
    PreToolUse: [],
    PostToolUse: [],
  };
  private workdir: string;
  private trustMarker: string;
  private sdkMode: boolean;

  constructor(workdir?: string, sdkMode?: boolean) {
    this.workdir = workdir ?? process.cwd();
    this.trustMarker = path.join(this.workdir, ".claude", ".claude_trusted");
    this.sdkMode = sdkMode ?? false;
  }

  /**
   * 从 .hooks.json 加载配置
   */
  async init(configPath?: string): Promise<void> {
    const cfgPath = configPath ?? path.join(this.workdir, ".hooks.json");
    try {
      const raw = await fs.readFile(cfgPath, "utf-8");
      const config: HookConfig = JSON.parse(raw);

      for (const event of HOOK_EVENTS) {
        const defs = config.hooks?.[event];
        if (Array.isArray(defs)) {
          this.hooks[event] = defs.filter(
            (d) => typeof d.command === "string" && d.command.trim(),
          );
        }
      }
    } catch {
      // 配置不存在或解析失败 → 静默跳过
    }
  }

  /**
   * 是否有任何事件注册了 hook
   */
  hasHooks(): boolean {
    return HOOK_EVENTS.some((e) => this.hooks[e].length > 0);
  }

  /**
   * 执行指定事件的所有 hook
   *
   * context 由调用方按事件类型填充：
   *   - tool_name: 工具名称
   *   - tool_input: 工具输入（JSON）
   *   - tool_output: 工具输出（仅 PostToolUse）
   */
  async runHooks(
    event: HookEvent,
    context?: { tool_name?: string; tool_input?: Record<string, unknown>; tool_output?: string },
  ): Promise<HookResult> {
    const result: HookResult = { blocked: false, messages: [] };

    if (!this.checkWorkspaceTrust()) return result;

    const hooks = this.hooks[event];
    if (hooks.length === 0) return result;

    for (const hookDef of hooks) {
      // matcher 过滤
      if (hookDef.matcher && context?.tool_name) {
        if (hookDef.matcher !== "*" && hookDef.matcher !== context.tool_name) {
          continue;
        }
      }

      const env = this.buildEnv(event, context);

      try {
        const { exitCode, stdout, stderr } = await this.execCommand(hookDef.command, env);

        if (exitCode === 0) {
          // 尝试解析结构化 stdout
          this.parseStructuredOutput(stdout, context, result);
        } else if (exitCode === 1) {
          // Block
          result.blocked = true;
          result.blockReason = stderr.trim() || "Blocked by hook";
        } else if (exitCode === 2) {
          // Inject message
          const msg = stderr.trim();
          if (msg) result.messages.push(msg);
        }
      } catch {
        // 超时或执行失败 → 静默跳过，不阻塞主流程
      }

      // 一旦被 block，后续 hook 不再执行
      if (result.blocked) break;
    }

    return result;
  }

  // -- 私有方法 --

  private checkWorkspaceTrust(): boolean {
    if (this.sdkMode) return true;
    try {
      // 同步检查文件存在性（hook 不频繁，可接受）
      require("fs").accessSync(this.trustMarker);
      return true;
    } catch {
      return false;
    }
  }

  private buildEnv(
    event: HookEvent,
    context?: { tool_name?: string; tool_input?: Record<string, unknown>; tool_output?: string },
  ): Record<string, string> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (!context) return env;

    env.HOOK_EVENT = event;
    env.HOOK_TOOL_NAME = context.tool_name ?? "";
    env.HOOK_TOOL_INPUT = JSON.stringify(context.tool_input ?? {}).slice(0, 10_000);

    if (context.tool_output !== undefined) {
      env.HOOK_TOOL_OUTPUT = context.tool_output.slice(0, 10_000);
    }

    return env;
  }

  private execCommand(
    command: string,
    env: Record<string, string>,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = exec(command, {
        cwd: this.workdir,
        env,
        timeout: HOOK_TIMEOUT,
        maxBuffer: 1024 * 1024, // 1MB
      }, (error, stdout, stderr) => {
        if (error && error.killed) {
          reject(new Error(`Hook timeout (${HOOK_TIMEOUT}ms)`));
          return;
        }
        resolve({
          exitCode: error?.code ?? 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      });

      // 防止子进程引用阻止 Node 退出
      child.unref();
    });
  }

  private parseStructuredOutput(
    stdout: string,
    context: { tool_name?: string; tool_input?: Record<string, unknown>; tool_output?: string } | undefined,
    result: HookResult,
  ): void {
    const trimmed = stdout.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed);

      if (parsed.updatedInput && context) {
        context.tool_input = parsed.updatedInput;
        result.updatedInput = parsed.updatedInput;
      }

      if (typeof parsed.additionalContext === "string" && parsed.additionalContext) {
        result.messages.push(parsed.additionalContext);
      }
    } catch {
      // stdout 不是 JSON → 正常情况，忽略
    }
  }
}
