import Anthropic from "@anthropic-ai/sdk";
import * as path from "path";
import type { AgentConfig, ToolExecutionResult, AgentCallbacks } from "./types.js";
import { TOOLS, TEAM_TOOLS, ToolRegistry } from "./tools/index.js";
import { SkillsSystem, CompactSystem } from "./systems/index.js";
import { TaskManager } from "./taskRuntime/taskManager.js";
import { AsyncTask } from "./taskRuntime/asyncTask.js";
import { PermissionManager, HookManager, MemorySystem, DreamConsolidator, ErrorRecovery } from "./extensions/index.js";
import { SystemPromptBuilder } from "./extensions/systemPromptBuilder.js";
import { PATHS } from "../config/paths.js";
import type { PermissionMode } from "./extensions/permissionManager.js";
import { ToolPipeline } from "./toolPipeline.js";
import { MessageBus } from "./multiAgent/messageBus.js";
import { TeammateManager } from "./multiAgent/teammateManager.js";

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
  private callbacks: AgentCallbacks;
  private messages: Anthropic.MessageParam[] = [];
  private tools: Anthropic.Tool[];
  private skillsInitialized: boolean = false;
  private currentStream: any = null;
  private aborted = false;

  // ── 团队模式（可选） ──
  private messageBus?: MessageBus;
  private teammateManager?: TeammateManager;

  // ── 子系统（实例级，非全局单例） ──
  private compactSystem: CompactSystem;
  private permissionManager: PermissionManager;
  private hookManager: HookManager;
  private memorySystem: MemorySystem;
  private dreamConsolidator: DreamConsolidator;
  private promptBuilder: SystemPromptBuilder;
  private errorRecovery: ErrorRecovery;
  private taskManager: TaskManager;
  private asyncTask: AsyncTask;
  private skillsSystem: SkillsSystem;
  private toolRegistry: ToolRegistry;
  private toolPipeline: ToolPipeline;

  constructor(config: AgentConfig, callbacks: AgentCallbacks = {}) {
    this.model = config.model;
    this.maxTokens = config.maxTokens || 8000;
    this.temperature = config.temperature ?? 0.7;
    this.maxIterations = config.maxIterations || 50;
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
    this.skillsSystem = new SkillsSystem(PATHS.globalSkills, PATHS.projectSkills(process.cwd()));
    this.asyncTask = new AsyncTask(process.cwd(),PATHS.backendTaskDir);

    const baseDeps = {
      taskManager: this.taskManager,
      skillsSystem: this.skillsSystem,
      memorySystem: this.memorySystem,
      asyncTask: this.asyncTask,
    };
    // ── 团队模式初始化（仅主代理） ──
    if (config.teamMode) {
      const cwd = process.cwd();
      this.messageBus = new MessageBus(PATHS.teamInbox(cwd));
      this.teammateManager = new TeammateManager(
        PATHS.teamDir(cwd),
        this.messageBus,
        this.client,
        this.model,
      );
    }

    this.toolRegistry = new ToolRegistry({
      ...baseDeps,
      ...(config.teamMode && {
        teammateManager: this.teammateManager,
        messageBus: this.messageBus,
      }),
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
      teamMode:  config.teamMode ?? false,
    });
    this.errorRecovery = new ErrorRecovery();
    this.systemPrompt = this.promptBuilder.build();

    this.tools = config.teamMode
        ? [...TOOLS, ...TEAM_TOOLS]
        : [...TOOLS];
  }

  /**
   * 运行 agent loop
   */
  async run(userMessage: string): Promise<string> {
    this.aborted = false;

    // 首次运行时初始化 hook 系统和技能系统
    if (!this.skillsInitialized) {
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

    this.systemPrompt = this.promptBuilder.build();

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
       async () => {
          // 每次 LLM 调用前注入后台任务完成通知
          const notifs = await this.asyncTask.drainNotifications();
          if (notifs.length > 0) {
            const notifText = notifs
              .map(
                (n) =>
                  `[bg:${n.taskId}] ${n.status}: ${n.preview} (output_file=${n.outputFile})`,
              )
              .join("\n");
            this.messages.push({
              role: "user",
              content: `<background-results>\n${notifText}\n</background-results>`,
            });
          }

          // 团队模式：注入 lead 收件箱里来自 teammates 的消息
          if (this.messageBus) {
            const inbox = this.messageBus.readInbox("lead");
            if (inbox.length > 0) {
              this.messages.push({
                role: "user",
                content: `<inbox>\n${JSON.stringify(inbox, null, 2)}\n</inbox>`,
              });
            }
          }

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
    this.systemPrompt = this.promptBuilder.build();
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionManager.mode = mode;
  }

  /**
   * 退出时清理资源
   */
  destroy(): void {
      this.taskManager.pruneCompletedChains();
      this.asyncTask.clearTasksCache();
      this.compactSystem.clearToolResults();
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
