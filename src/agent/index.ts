import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, ToolExecutionResult, AgentCallbacks } from "./types";
import { TASK_TOOL, TOOLS, executeTool } from "./tools";
import { todoManager, skillsSystem, CompactSystem } from "./systems";
import { PermissionManager, HookManager } from "./extensions";
import { getDataDir } from "../config/paths.js";

/**
 * AgentLoop - 核心 AI 代理循环
 *
 * 同时支持主代理和子代理两种模式：
 * - 主代理：可派发子代理、todo nag 提醒
 * - 子代理：轻量模式，独立上下文，完成后返回摘要即丢弃
 */
export class AgentLoop {
  private client: Anthropic;
  private model: string;
  private systemPrompt: string;
  private maxTokens: number;
  private temperature: number;
  private maxIterations: number;
  private isSubAgent: boolean;
  private callbacks: AgentCallbacks;
  private messages: Anthropic.MessageParam[] = [];
  private tools: Anthropic.Tool[];
  private readonly NAG_THRESHOLD: number = 3;
  private skillsInitialized: boolean = false;
  private compactSystem: CompactSystem;
  private permissionManager: PermissionManager;
  private hookManager: HookManager;

  constructor(config: AgentConfig, callbacks: AgentCallbacks = {}) {
    this.model = config.model;
    this.isSubAgent = config.isSubAgent ?? false;
    this.systemPrompt = this.getDefaultSystemPrompt(this.isSubAgent);
    this.maxTokens = config.maxTokens || 8000;
    this.temperature = config.temperature ?? 0.7;
    this.maxIterations = config.maxIterations || (this.isSubAgent ? 30 : 50);
    this.callbacks = callbacks;

    // 初始化 Anthropic 客户端
    const clientConfig: any = {};
    if (config.apiKey) clientConfig.apiKey = config.apiKey;
    if (config.baseUrl) clientConfig.baseURL = config.baseUrl;

    this.client = new Anthropic(clientConfig);
    this.compactSystem = new CompactSystem(getDataDir(), config.compact);
    this.permissionManager = new PermissionManager(config.permissionMode ?? "default");
    this.hookManager = new HookManager();

    // 构建工具列表：子代理不需要 task 工具（避免无限递归）
    this.tools = this.isSubAgent ? [...TOOLS] : [...TOOLS, TASK_TOOL];
  }

  private getDefaultSystemPrompt(isSubAgent: boolean): string {
    if (isSubAgent) {
      return `You are a coding subagent at ${process.cwd()}. Complete the given task efficiently using available tools. Return only a summary of what you accomplished.`;
    }

    return `You are a coding agent at ${process.cwd()}. You can use tools to interact with the system and solve tasks. Act efficiently and explain your reasoning when necessary.

For complex multi-step tasks, ALWAYS use the todo tool to plan BEFORE acting:
1. Create a todo list with all steps as "pending"
2. Mark one step "in_progress", do the work, then mark it "completed"
3. Repeat until all steps are done
Never skip the planning phase or mark tasks completed before actually doing them.`;
  }

  /**
   * 运行 agent loop
   */
  async run(userMessage: string): Promise<string> {
    // 首次运行时初始化 hook 系统和技能系统
    if (!this.isSubAgent && !this.skillsInitialized) {
      this.skillsInitialized = true;
      await this.hookManager.init();
      await this.hookManager.runHooks("SessionStart", { tool_name: "", tool_input: {} });
      await skillsSystem.init();
      if (skillsSystem.hasSkills()) {
        const catalog = skillsSystem.describeCatalog();
        this.systemPrompt += `\nUse load_skill when a task needs specialized instructions before you act.\nSkills available:\n${catalog}\nIMPORTANT: After loading a skill, if it contains executable commands (e.g. lines starting with "执行命令", or code blocks marked with "exec"), you MUST execute them using the bash tool.\n`;
      }
    }

    this.messages.push({
      role: "user",
      content: userMessage,
    });

    try {
      await this.agentLoop();
      return this.extractFinalResponse();
    } catch (error) {
      this.callbacks.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * 核心循环逻辑
   */
  private async agentLoop(): Promise<void> {
    let iteration = 0;

    while (iteration < this.maxIterations) {
      iteration++;

      this.messages = this.compactSystem.microCompact(this.messages);

      if (this.compactSystem.shouldAutoCompact(this.messages)) {
        this.messages = await this.compactSystem.compactHistory(
          this.messages,
          (messages) => this.summarizeHistory(messages),
        );
      }

      const response = await this.client.messages.create({
        model: this.model,
        system: this.systemPrompt,
        messages: this.messages,
        tools: this.tools,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      this.messages.push({
        role: "assistant",
        content: response.content,
      });

      if (response.stop_reason !== "tool_use") {
        break;
      }

      try {
        const { results: toolResults, usedTodo, manualCompact, compactFocus } = await this.executeTools(response.content);

        this.messages.push({
          role: "user",
          content: toolResults,
        });

        if (manualCompact) {
          this.messages = await this.compactSystem.compactHistory(
            this.messages,
            (messages) => this.summarizeHistory(messages),
            compactFocus,
          );
          continue;
        }

        // todo nag 只在主代理中生效
        if (!this.isSubAgent) {
          if (usedTodo) {
            todoManager.resetNag();
          } else {
            todoManager.incrementRound();
          }

          if (todoManager.shouldNag(this.NAG_THRESHOLD)) {
            this.messages.push({
              role: "user",
              content: "<reminder>Update your todos.</reminder>",
            });
            todoManager.resetNag();
          }
        }
      } catch (error) {
        const errorResults = this.createErrorToolResults(response.content, error);
        this.messages.push({
          role: "user",
          content: errorResults,
        });
      }
    }
  }

  /**
   * 执行所有工具调用
   */
  private async executeTools(
    content: Array<Anthropic.ContentBlock>,
  ): Promise<{ results: ToolExecutionResult[]; usedTodo: boolean; manualCompact: boolean; compactFocus?: string }> {
    const results: ToolExecutionResult[] = [];
    let usedTodo = false;
    let manualCompact = false;
    let compactFocus: string | undefined;

    for (const block of content) {
      if (block.type !== "tool_use") continue;

      if (todoManager.isTodoTool(block.name)) {
        usedTodo = true;
      }

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
        let output: string;
        let toolInput = (block.input as Record<string, any>) ?? {};

        // -- PreToolUse hooks --
        const hookCtx = { tool_name: block.name, tool_input: { ...toolInput } };
        const preHook = await this.hookManager.runHooks("PreToolUse", hookCtx);

        if (preHook.blocked) {
          output = `Tool blocked by hook: ${preHook.blockReason ?? "Blocked by PreToolUse hook"}`;
          // 注入 hook 消息
          for (const msg of preHook.messages) {
            results.push({ type: "tool_result", tool_use_id: block.id, content: `[Hook]: ${msg}` });
          }
          results.push({ type: "tool_result", tool_use_id: block.id, content: output, is_error: true });
          continue;
        }

        // hook 可能修改了 tool_input
        if (preHook.updatedInput) {
          toolInput = preHook.updatedInput as Record<string, any>;
        }

        // -- 权限管线 --
        const decision = this.permissionManager.check(block.name, toolInput);

        if (decision.behavior === "deny") {
          // 直接拒绝，让 LLM 知道
          this.callbacks.onPermissionDenied?.(block.name, decision.reason);
          output = `Permission denied: ${decision.reason}`;
        } else if (decision.behavior === "ask") {
          // 询问用户
          const answer = await this.callbacks.onPermissionAsk?.(
            block.name,
            toolInput,
            decision.reason,
          );

          if (answer === "always") {
            this.permissionManager.addAlwaysAllow(block.name);
            output = await this.executeSingleTool(block.name, toolInput);
          } else if (answer === "y") {
            this.permissionManager.recordApproval();
            output = await this.executeSingleTool(block.name, toolInput);
          } else {
            // 用户拒绝 or 没有注册回调 → 默认拒绝
            const circuitBreak = this.permissionManager.recordDenial();
            output = `Permission denied by user for ${block.name}`;
            if (circuitBreak) {
              output += " (连续多次拒绝，建议切换到 plan 模式)";
            }
          }
        } else {
          // allow
          output = await this.executeSingleTool(block.name, toolInput);
        }

        // -- PostToolUse hooks --
        const postCtx = { tool_name: block.name, tool_input: toolInput, tool_output: output };
        const postHook = await this.hookManager.runHooks("PostToolUse", postCtx);
        for (const msg of postHook.messages) {
          output += `\n[Hook note]: ${msg}`;
        }
         
        // 大工具结果先写磁盘再返回路径，避免占用上下文
        output = await this.compactSystem.persistLargeOutput(block.id, output);

        const isError = output.startsWith("Error:");
        this.callbacks.onToolResult?.(block.name, output, isError);

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
          is_error: isError,
        });
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

    return { results, usedTodo, manualCompact, compactFocus };
  }

  /**
   * 执行单个工具调用（权限检查已通过后调用）
   */
  private async executeSingleTool(name: string, input: any): Promise<string> {
    this.callbacks.onToolCall?.(name, input);

    if (name === "task") {
      const { prompt } = input as { prompt: string; description?: string };
      return this.runSubAgent(prompt);
    }

    return executeTool(name, input);
  }

  private async summarizeHistory(messages: Anthropic.MessageParam[]): Promise<string> {
    const conversation = JSON.stringify(messages).slice(0, 80000);
    const prompt = [
      "Summarize this coding-agent conversation so work can continue.",
      "Preserve:",
      "1. The current goal",
      "2. Important findings and decisions",
      "3. Files read or changed",
      "4. Remaining work",
      "5. User constraints and preferences",
      "Be compact but concrete.",
      "",
      conversation,
    ].join("\n");

    const response = await this.client.messages.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    });

    const summary = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return summary || "Summary unavailable.";
  }

  /**
   * 派发子代理
   */
  private async runSubAgent(prompt: string): Promise<string> {
    const subAgent = new AgentLoop(
      {
        model: this.model,
        apiKey: undefined,
        maxTokens: this.maxTokens,
        isSubAgent: true,
      },
      {} // 子代理不需要回调
    );

    return subAgent.run(prompt);
  }

  /**
   * 为所有 tool_use 创建错误响应
   */
  private createErrorToolResults(
    content: Array<Anthropic.ContentBlock>,
    error: unknown,
  ): ToolExecutionResult[] {
    const results: ToolExecutionResult[] = [];
    const errorMessage = error instanceof Error ? error.message : String(error);

    for (const block of content) {
      if (block.type === "tool_use") {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: ${errorMessage}`,
          is_error: true,
        });
      }
    }

    return results;
  }

  /**
   * 提取最终响应（文本部分）
   */
  private extractFinalResponse(): string {
    const lastMessage = this.messages[this.messages.length - 1];

    if (!lastMessage || lastMessage.role !== "assistant") {
      return "";
    }

    const content = lastMessage.content;

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    }

    return "";
  }

  getMessages(): Anthropic.MessageParam[] {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [];
  }

  setMessages(messages: Anthropic.MessageParam[]): void {
    this.messages = [...messages];
  }
}
