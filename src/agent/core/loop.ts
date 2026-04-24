import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, AgentOptions, ToolExecutionResult, AgentCallbacks } from "./types.js";
import { TOOLS } from "../tools/index.js";
import { AgentState } from "./state.js";
import { ExtensionBuilder, Extensions } from "./extensionBuilder";
import { AgentControl } from "./control.js";

/**
 * AgentLoop - 核心 AI 代理循环
 *
 */
export class AgentLoop {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly maxIterations: number;
  private readonly callbacks: AgentCallbacks;

  // 状态聚合
  private readonly state: AgentState;

  // 扩展能力（由 ExtensionBuilder 创建）
  private readonly extensions: Extensions;

  // 公共 API
  private readonly _control: AgentControl;

  // 标记首次运行初始化
  private skillsInitialized = false;

  // 子代理专用工具集（覆盖默认 TOOLS）
  private readonly customTools?: Anthropic.Tool[];

  constructor(
    config: AgentConfig,
    callbacks: AgentCallbacks = {},
    options: AgentOptions = {},
  ) {
    this.model = config.model || 'claude-sonnet-4.6';
    this.maxTokens = config.maxTokens || 8000;
    this.temperature = config.temperature ?? 0.7;
    this.maxIterations = config.maxIterations || 50;
    this.callbacks = callbacks;
    this.customTools = options.tools;

    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });

    this.state = new AgentState();

    const builder = new ExtensionBuilder();
    this.extensions = builder.build(config, callbacks, options);

    this.state.systemPrompt = this.extensions.promptBuilder.build();

    this._control = new AgentControl({
      state: this.state,
      extensions: this.extensions,
      summarizeHistory: (msgs) => this.summarizeHistory(msgs),
    });
  }

  // ── 公共 API ─────────────────────────────────────────

  get control(): AgentControl {
    return this._control;
  }

  // ── 运行入口 ─────────────────────────────────────────

  async run(userMessage: string): Promise<string> {
    this.state.aborted = false;

    await this.initializeIfNeeded(userMessage);

    this.state.systemPrompt = this.extensions.promptBuilder.build();

    this.state.messages.push({
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
   * subAgent 入口 — 跳过初始化（技能、记忆、hook），直接运行
   * 独立的 system prompt + 过滤后的工具集
   */
  async subAgentRun(prompt: string, system: string): Promise<string> {
    this.state.aborted = false;
    this.state.systemPrompt = system;
    this.state.messages.push({ role: "user", content: prompt });

    try {
      await this.agentLoop();
      return this.extractFinalResponse();
    } catch (error) {
      this.callbacks.onError?.(error as Error);
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // ── 核心循环 ─────────────────────────────────────────

  private async agentLoop(): Promise<void> {
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      await this.compactMessagesIfNeeded();

      const response = await this.callLLM();

      if (this.state.aborted || !response) {
        this.handleAbortedOrFailedResponse(response);
        break;
      }

      if (this.extensions.errorRecovery.handleMaxTokens(response, this.state.messages)) {
        continue;
      }

      this.state.messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        break;
      }

      await this.executeToolsOrHandleError(response.content);
    }
  }

  // ── LLM 调用 ─────────────────────────────────────────

  private async callLLM(): Promise<Anthropic.Message | null> {
    return this.extensions.errorRecovery.callWithRetry(
      async () => {
        await this.injectBackgroundNotifications();

        const stream = this.client.messages.stream({
          model: this.model,
          system: this.state.systemPrompt,
          messages: this.state.messages,
          tools: this.customTools ?? [...TOOLS],
          max_tokens: this.maxTokens,
          temperature: this.temperature,
        });

        this.state.currentStream = stream;
        return stream.finalMessage() as Promise<Anthropic.Message>;
      },
      this.state.messages,
      (msgs) => this.extensions.compactSystem.compactHistory(msgs, (m) => this.summarizeHistory(m)),
    );
  }

  private async injectBackgroundNotifications(): Promise<void> {
    const notifs = await this.extensions.asyncTask.drainNotifications();
    if (notifs.length === 0) return;

    const text = notifs
      .map((n) => `[bg:${n.taskId}] ${n.status}: ${n.preview} (output_file=${n.outputFile})`)
      .join("\n");

    this.state.messages.push({
      role: "user",
      content: `<background-results>\n${text}\n</background-results>`,
    });
  }

  private handleAbortedOrFailedResponse(response: Anthropic.Message | null): void {
    if (!this.state.aborted && !response) {
      const err = new Error(
        `API 调用失败，请检查 .env 配置：模型名称(CLAUDE_MODEL)、API密钥(ANTHROPIC_API_KEY) 和 baseUrl(ANTHROPIC_BASE_URL) 是否正确，当前模型: ${this.model}`,
      );
      this.callbacks.onError?.(err);
      throw err;
    }
  }

  // ── 工具执行 ─────────────────────────────────────────

  private async executeToolsOrHandleError(content: Array<Anthropic.ContentBlock>): Promise<void> {
    try {
      const { results, manualCompact, compactFocus } =
        await this.extensions.toolPipeline.executeAll(content);

      this.state.messages.push({ role: "user", content: results });

      if (manualCompact) {
        this.state.messages = await this.extensions.compactSystem.compactHistory(
          this.state.messages,
          (msgs) => this.summarizeHistory(msgs),
          compactFocus,
        );
      }
    } catch (error) {
      const errorResults = this.createErrorToolResults(content, error);
      this.state.messages.push({ role: "user", content: errorResults });
    }
  }

  private createErrorToolResults(
    content: Array<Anthropic.ContentBlock>,
    error: unknown,
  ): ToolExecutionResult[] {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: `Error: ${errorMessage}`,
        is_error: true,
      }));
  }

  // ── 上下文压缩 ────────────────────────────────────────

  private async compactMessagesIfNeeded(): Promise<void> {
    this.state.messages = this.extensions.compactSystem.microCompact(this.state.messages);

    if (this.extensions.compactSystem.shouldAutoCompact(this.state.messages)) {
      this.state.messages = await this.extensions.compactSystem.compactHistory(
        this.state.messages,
        (msgs) => this.summarizeHistory(msgs),
      );
    }
  }

  // ── 历史摘要 ─────────────────────────────────────────

  private async summarizeHistory(messages: Anthropic.MessageParam[]): Promise<string> {
    const conversation = JSON.stringify(messages).slice(0, 80000);
    const prompt = [
      "Summarize this coding-agent conversation so work can continue.",
      "Preserve: 1. The current goal 2. Important findings and decisions 3. Files read or changed 4. Remaining work 5. User constraints and preferences",
      "Be compact but concrete.",
      "",
      conversation,
    ].join("\n");

    const response = await this.client.messages.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    });

    return this.extractText(response) || "Summary unavailable.";
  }

  // ── Dream 整理 ───────────────────────────────────────

  private tryDreamConsolidate(): void {
    const summarize = async (prompt: string): Promise<string> => {
      const response = await this.client.messages.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4000,
      });
      return this.extractText(response);
    };

    this.extensions.dreamConsolidator
      .consolidate(summarize, this.extensions.memorySystem)
      .then((log) => {
        if (log.some((l) => l.includes("Phase"))) {
          this.extensions.memorySystem.init().catch(() => {});
        }
      })
      .catch(() => {});
  }

  // ── 初始化 ───────────────────────────────────────────

  private async initializeIfNeeded(userMessage: string): Promise<void> {
    if (this.skillsInitialized) return;
    this.skillsInitialized = true;

    await this.extensions.hookManager.init();
    await this.extensions.hookManager.runHooks("SessionStart", { tool_name: "", tool_input: {} });
    await this.extensions.memorySystem.init();
    await this.extensions.dreamConsolidator.incrementSession();
    this.tryDreamConsolidate();
    await this.extensions.skillsSystem.init();
    this.extensions.promptBuilder.markSkillsReady();

    this.handleMemorySuppressionPattern(userMessage);
  }

  private handleMemorySuppressionPattern(userMessage: string): void {
    const suppressPattern = /忽略(之前的?)?(记忆|memory)|ignore\s+memor|don'?t\s+use\s+memor|without\s+memor/i;
    if (suppressPattern.test(userMessage)) {
      this.extensions.memorySystem.suppressMemories();
    } else if (this.extensions.memorySystem.isSuppressed()) {
      this.extensions.memorySystem.restoreMemories();
    }
  }

  // ── 工具函数 ─────────────────────────────────────────

  private extractText(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  private extractFinalResponse(): string {
    const lastMessage = this.state.messages[this.state.messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") return "";

    const content = lastMessage.content;
    if (typeof content === "string") return content;

    if (Array.isArray(content)) {
      return content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    }

    return "";
  }
}