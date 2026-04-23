import type Anthropic from "@anthropic-ai/sdk";
import type { ToolExecutionResult, ToolOutput, AgentCallbacks } from "./core/types.js";
import type { ToolRegistry } from "./tools/index.js";
import type { PermissionManager } from "./extensions/permission/index.js";
import type { HookManager } from "./extensions/hooks/index.js";
import type { CompactSystem } from "./extensions/compact/index.js";

/**
 * ToolPipeline - 工具执行管线
 *
 * 职责：按顺序执行工具调用，串联 hooks → 权限检查 → 执行 → 后处理。
 * 从 AgentLoop 中抽离，使主循环只关注编排逻辑。
 */
export class ToolPipeline {
  constructor(
    private toolRegistry: ToolRegistry,
    private permissionManager: PermissionManager,
    private hookManager: HookManager,
    private compactSystem: CompactSystem,
    private callbacks: AgentCallbacks,
  ) {}

  /**
   * 执行响应中所有 tool_use 块
   */
  async executeAll(
    content: Array<Anthropic.ContentBlock>,
  ): Promise<{
    results: ToolExecutionResult[];
    manualCompact: boolean;
    compactFocus?: string;
  }> {
    const results: ToolExecutionResult[] = [];
    let manualCompact = false;
    let compactFocus: string | undefined;

    for (const block of content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "compact") {
        manualCompact = true;
        const focus = (block.input as { focus?: string })?.focus;
        if (typeof focus === "string" && focus.trim()) {
          compactFocus = focus;
        }
      }

      if (
        (block.name === "read_file" || block.name === "write_file" || block.name === "edit_file") &&
        typeof (block.input as { path?: string })?.path === "string"
      ) {
        this.compactSystem.trackRecentFile((block.input as { path: string }).path);
      }

      try {
        const result = await this.executeSingle(block);
        results.push(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: ${errorMessage}`,
          is_error: true,
        });
      }
    }

    return { results, manualCompact, compactFocus };
  }

  /**
   * 执行单个工具调用（hooks → 权限 → 执行 → 后处理）
   */
  private async executeSingle(
    block: Anthropic.ToolUseBlock,
  ): Promise<ToolExecutionResult> {
    let toolInput = (block.input as Record<string, any>) ?? {};

    // ── PreToolUse hooks ──
    const hookCtx = { tool_name: block.name, tool_input: { ...toolInput } };
    const preHook = await this.hookManager.runHooks("PreToolUse", hookCtx);

    if (preHook.blocked) {
      const hookMessages = preHook.messages.map(
        (msg: string) => `[Hook]: ${msg}`,
      );
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: [...hookMessages, `Tool blocked by hook: ${preHook.blockReason ?? "Blocked by PreToolUse hook"}`].join("\n"),
        is_error: true,
      };
    }

    if (preHook.updatedInput) {
      toolInput = preHook.updatedInput as Record<string, any>;
    }

    // ── 权限管线 ──
    const { output, isError } = await this.checkPermissionAndRun(
      block.name, toolInput,
    );

    // ── PostToolUse hooks ──
    let finalOutput = output;
    const postCtx = { tool_name: block.name, tool_input: toolInput, tool_output: output };
    const postHook = await this.hookManager.runHooks("PostToolUse", postCtx);
    for (const msg of postHook.messages) {
      finalOutput += `\n[Hook note]: ${msg}`;
    }

    // ── 大输出持久化 ──
    finalOutput = await this.compactSystem.persistLargeOutput(block.id, finalOutput);

    this.callbacks.onToolResult?.(block.name, finalOutput, isError);

    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: finalOutput,
      is_error: isError,
    };
  }

  /**
   * 权限检查 + 执行
   */
  private async checkPermissionAndRun(
    name: string,
    toolInput: Record<string, any>,
  ): Promise<ToolOutput> {
    const decision = this.permissionManager.check(name, toolInput);

    if (decision.behavior === "deny") {
      this.callbacks.onPermissionDenied?.(name, decision.reason);
      return { output: `Permission denied: ${decision.reason}`, isError: true };
    }

    if (decision.behavior === "ask") {
      const answer = await this.callbacks.onPermissionAsk?.(name, toolInput, decision.reason);

      if (answer === "always") {
        this.permissionManager.addAlwaysAllow(name);
        return this.invokeHandler(name, toolInput);
      }

      if (answer === "y") {
        this.permissionManager.recordApproval();
        return this.invokeHandler(name, toolInput);
      }

      // 用户拒绝
      const circuitBreak = this.permissionManager.recordDenial();
      let msg = `Permission denied by user for ${name}`;
      if (circuitBreak) {
        msg += " (连续多次拒绝，建议切换到 plan 模式)";
      }
      return { output: msg, isError: true };
    }

    // allow
    return this.invokeHandler(name, toolInput);
  }

  /**
   * 调用处理器
   */
  private async invokeHandler(
    name: string,
    toolInput: Record<string, any>,
  ): Promise<ToolOutput> {
    this.callbacks.onToolCall?.(name, toolInput);
    return this.toolRegistry.execute(name, toolInput);
  }
}
