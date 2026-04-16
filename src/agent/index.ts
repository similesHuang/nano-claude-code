import Anthropic from "@anthropic-ai/sdk";
import * as path from "path";
import type { AgentConfig, ToolExecutionResult, AgentCallbacks } from "./types.js";
import { SUBAGENT_TOOL, TOOLS, ToolRegistry } from "./tools/index.js";
import { SkillsSystem, CompactSystem } from "./systems/index.js";
import { TaskManager } from "./taskRuntime/taskManager.js";
import { PermissionManager, HookManager, MemorySystem, DreamConsolidator, ErrorRecovery } from "./extensions/index.js";
import { SystemPromptBuilder } from "./extensions/systemPromptBuilder.js";
import { PATHS } from "../config/paths.js";
import type { PermissionMode } from "./extensions/permissionManager.js";
import { ToolPipeline } from "./toolPipeline.js";

/**
 * AgentLoop - 核心 AI 代理循环
 *
 * 同时支持主代理和子代理两种模式：
 * - 主代理：可派发子代理、task 持久化
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
  private skillsInitialized: boolean = false;
  private currentStream: any = null;
  private aborted = false;

  // ── 子系统（实例级，非全局单例） ──
  private compactSystem: CompactSystem;
  private permissionManager: PermissionManager;
  private hookManager: HookManager;
  private memorySystem: MemorySystem;
  private dreamConsolidator: DreamConsolidator;
  private promptBuilder: SystemPromptBuilder;
  private errorRecovery: ErrorRecovery;
  private taskManager: TaskManager;
  private skillsSystem: SkillsSystem;
  private toolRegistry: ToolRegistry;
  private toolPipeline: ToolPipeline;

  constructor(config: AgentConfig, callbacks: AgentCallbacks = {}) {
    this.model = config.model;
    this.isSubAgent = config.isSubAgent ?? false;
    this.maxTokens = config.maxTokens || 8000;
    this.temperature = config.temperature ?? 0.7;
    this.maxIterations = config.maxIterations || (this.isSubAgent ? 30 : 50);
    this.callbacks = callbacks;

    // 初始化 Anthropic 客户端
    const clientConfig: any = {};
    if (config.apiKey) clientConfig.apiKey = config.apiKey;
    if (config.baseUrl) clientConfig.baseURL = config.baseUrl;

    this.client = new Anthropic(clientConfig);

    // ── 子系统初始化（全部实例级所有权） ──
    this.compactSystem = new CompactSystem(PATHS.dataDir, config.compact);
    this.permissionManager = new PermissionManager(config.permissionMode ?? "default");
    this.hookManager = new HookManager();

    const teamMemoryDir = PATHS.teamMemory(process.cwd());
    this.memorySystem = new MemorySystem(teamMemoryDir, PATHS.privateMemory);
    this.dreamConsolidator = new DreamConsolidator(teamMemoryDir, PATHS.privateMemory);

    this.taskManager = new TaskManager(path.join(PATHS.taskDir));
    // 启动时清理已完成的任务链，保持工作图简洁（仅主代理执行，子代理不持久化任务）
    this.taskManager.pruneCompletedChains();
    this.skillsSystem = new SkillsSystem(PATHS.globalSkills, PATHS.projectSkills(process.cwd()));

    this.toolRegistry = new ToolRegistry({
      taskManager: this.taskManager,
      skillsSystem: this.skillsSystem,
      memorySystem: this.memorySystem,
    });

    this.toolPipeline = new ToolPipeline(
      this.toolRegistry,
      this.permissionManager,
      this.hookManager,
      this.compactSystem,
      this.callbacks,
    );

    this.promptBuilder = new SystemPromptBuilder({
      memorySystem: this.memorySystem,
      skillsSystem: this.skillsSystem,
    });
    this.errorRecovery = new ErrorRecovery();
    this.systemPrompt = this.isSubAgent
      ? this.promptBuilder.buildForSubAgent()
      : this.promptBuilder.build();

    // 构建工具列表：子代理不需要 subagent 工具（避免无限递归）
    this.tools = this.isSubAgent ? [...TOOLS] : [...TOOLS, SUBAGENT_TOOL];
  }

  /**
   * 运行 agent loop
   */
  async run(userMessage: string): Promise<string> {
    this.aborted = false;

    // 首次运行时初始化 hook 系统和技能系统
    if (!this.isSubAgent && !this.skillsInitialized) {
      this.skillsInitialized = true;
      await this.hookManager.init();
      await this.hookManager.runHooks("SessionStart", { tool_name: "", tool_input: {} });
      await this.memorySystem.init();
      // Dream: 递增会话计数，尝试后台整理记忆
      await this.dreamConsolidator.incrementSession();
      this.tryDreamConsolidate(); // fire-and-forget
      await this.skillsSystem.init();
      this.promptBuilder.markSkillsReady();
    }

    // 边界5: 用户说"忽略记忆"时，本轮按记忆为空处理
    const suppressPattern = /忽略(之前的?)?(记忆|memory)|ignore\s+memor|don'?t\s+use\s+memor|without\s+memor/i;
    if (suppressPattern.test(userMessage)) {
      this.memorySystem.suppressMemories();
    } else if (this.memorySystem.isSuppressed()) {
      this.memorySystem.restoreMemories();
    }

    this.systemPrompt = this.isSubAgent
      ? this.promptBuilder.buildForSubAgent()
      : this.promptBuilder.build();

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

  // ================================================================
  // 核心循环
  // ================================================================

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

      const response = await this.errorRecovery.callWithRetry(
        () => {
          const stream = this.client.messages.stream({
            model: this.model,
            system: this.systemPrompt,
            messages: this.messages,
            tools: this.tools,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
          });
          this.currentStream = stream;
          return stream.finalMessage() as Promise<Anthropic.Message>;
        },
        this.messages,
        async (msgs) =>
          this.compactSystem.compactHistory(msgs, (m) => this.summarizeHistory(m)),
      );
      this.currentStream = null;

      if (this.aborted || !response) {
        // callWithRetry 返回 null 表示 API 调用失败（模型未配置/无效/网络错误等）
        if (!this.aborted && !response) {
          const err = new Error(
            `API 调用失败，请检查 .env 配置：模型名称(CLAUDE_MODEL)、API密钥(ANTHROPIC_API_KEY) 和 baseUrl(ANTHROPIC_BASE_URL) 是否正确，当前模型: ${this.model}`
          );
          this.callbacks.onError?.(err);
          throw err;
        }
        break;
      }

      // max_tokens → 注入续写消息后重新进入循环
      if (this.errorRecovery.handleMaxTokens(response, this.messages)) {
        continue;
      }

      this.messages.push({
        role: "assistant",
        content: response.content,
      });

      if (response.stop_reason !== "tool_use") {
        break;
      }

      try {
        const { results, manualCompact, compactFocus } =
          await this.toolPipeline.executeAll(
            response.content,
            (prompt) => this.runSubAgent(prompt),
          );

        this.messages.push({
          role: "user",
          content: results,
        });

        if (manualCompact) {
          this.messages = await this.compactSystem.compactHistory(
            this.messages,
            (messages) => this.summarizeHistory(messages),
            compactFocus,
          );
          continue;
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
   * Dream 整理 — fire-and-forget，不阻塞主流程
   */
  private tryDreamConsolidate(): void {
    const summarize = async (prompt: string): Promise<string> => {
      const response = await this.client.messages.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4000,
      });

      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
    };

    this.dreamConsolidator
      .consolidate(summarize, this.memorySystem)
      .then((log) => {
        if (log.length > 0 && log.some((l) => l.includes("Phase"))) {
          this.memorySystem.init().catch(() => {});
        }
      })
      .catch(() => {});
  }

  /**
   * 派发子代理 — 独立实例，不共享 taskManager/skillsSystem/memory
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

  // ================================================================
  // 公共 API（供 CLI 调用）
  // ================================================================

  abort(): void {
    this.aborted = true;
    this.currentStream?.abort();
  }

  get isAborted(): boolean {
    return this.aborted;
  }

  clearConversation(): void {
    this.messages = [];
    this.taskManager.clear();
    if (this.memorySystem.isSuppressed()) {
      this.memorySystem.restoreMemories();
    }
    this.systemPrompt = this.isSubAgent
      ? this.promptBuilder.buildForSubAgent()
      : this.promptBuilder.build();
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionManager.mode = mode;
  }

  async compactConversation(focus?: string): Promise<string> {
    if (this.messages.length === 0) {
      return "No conversation to compact.";
    }
    this.messages = await this.compactSystem.compactHistory(
      this.messages,
      (messages) => this.summarizeHistory(messages),
      focus,
    );
    return "Conversation compacted.";
  }
}
