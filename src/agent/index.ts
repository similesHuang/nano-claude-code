import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, ToolExecutionResult, AgentCallbacks } from "./types";
import { TASK_TOOL, TOOLS, executeTool } from "./tools";
import { todoManager, skillsSystem, CompactSystem } from "./systems";

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
  private roundsSinceTodoUpdate: number = 0;
  private readonly NAG_THRESHOLD: number = 3;
  private skillsInitialized: boolean = false;
  private compactSystem: CompactSystem;

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
    this.compactSystem = new CompactSystem(process.cwd(), config.compact);

    // 构建工具列表：子代理不需要 task 工具（避免无限递归）
    this.tools = this.isSubAgent ? [...TOOLS] : [...TOOLS, TASK_TOOL];
  }

  private getDefaultSystemPrompt(isSubAgent: boolean): string {
    if (isSubAgent) {
      return `You are a coding subagent at ${process.cwd()}. Complete the given task efficiently using available tools. Return only a summary of what you accomplished.`;
    }

    return `You are a coding agent at ${process.cwd()}. You can use tools to interact with the system and solve tasks. Act efficiently and explain your reasoning when necessary.`;
  }

  /**
   * 运行 agent loop
   */
  async run(userMessage: string): Promise<string> {
    // 首次运行时初始化技能系统，将技能目录追加到系统提示词
    if (!this.isSubAgent && !this.skillsInitialized) {
      this.skillsInitialized = true;
      await skillsSystem.init();
      if (skillsSystem.hasSkills()) {
        const catalog = skillsSystem.describeCatalog();
        this.systemPrompt += `\nUse load_skill when a task needs specialized instructions before you act.\nSkills available:\n${catalog}\n`;
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
            this.roundsSinceTodoUpdate = 0;
          } else {
            this.roundsSinceTodoUpdate++;
          }

          if (this.roundsSinceTodoUpdate >= this.NAG_THRESHOLD) {
            this.messages.push({
              role: "user",
              content: "<reminder>Update your todos.</reminder>",
            });
            this.roundsSinceTodoUpdate = 0;
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

        if (block.name === "task") {
          const { prompt } = block.input as { prompt: string; description?: string };
          this.callbacks.onToolCall?.(block.name, block.input);
          output = await this.runSubAgent(prompt);
        } else {
          this.callbacks.onToolCall?.(block.name, block.input);
          output = await executeTool(block.name, block.input);
        }
         
        // 大工具结果先写磁盘再返回路径，避免占用上下文
        output = await this.compactSystem.persistLargeOutput(block.id, output);

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
          is_error: output.startsWith("Error:"),
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
