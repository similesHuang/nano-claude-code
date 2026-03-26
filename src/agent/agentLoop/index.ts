import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentConfig,
  ToolExecutionResult,
  AgentHooks,
} from "../types";
import { TOOLS, executeTool } from "../tools";

/**
 * AgentLoop - 核心 AI 代理循环
 *
 * 这个类实现了基础的 agent loop 模式：
 * 1. 发送消息给 LLM
 * 2. 如果 LLM 返回工具调用，执行工具
 * 3. 将工具结果反馈给 LLM
 * 4. 重复直到 LLM 不再调用工具
 *
 * 扩展性设计：
 * - 工具系统：通过 tools/ 目录注册新工具
 * - 钩子系统：在关键节点注入自定义逻辑
 * - 配置化：所有行为都可以通过配置调整
 */
export class AgentLoop {
  private client: Anthropic;
  private config: AgentConfig & {
    systemPrompt: string;
    maxTokens: number;
    temperature: number;
    maxIterations: number;
    hooks: AgentHooks;
  };
  private messages: Anthropic.MessageParam[] = [];

  constructor(config: AgentConfig) {
    // 合并默认配置
    this.config = {
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      systemPrompt: config.systemPrompt || this.getDefaultSystemPrompt(),
      maxTokens: config.maxTokens || 8000,
      temperature: config.temperature ?? 0.7,
      maxIterations: config.maxIterations || 50,
      hooks: config.hooks || {},
    };

    // 初始化 Anthropic 客户端
    const clientConfig: any = {};
    if (this.config.apiKey) clientConfig.apiKey = this.config.apiKey;
    if (this.config.baseUrl) clientConfig.baseURL = this.config.baseUrl;

    this.client = new Anthropic(clientConfig);
  }

  /**
   * 默认系统提示
   */
  private getDefaultSystemPrompt(): string {
    return `You are a coding agent at ${process.cwd()}. You can use tools to interact with the system and solve tasks. Act efficiently and explain your reasoning when necessary.`;
  }

  /**
   * 运行 agent loop - 核心方法
   * @param userMessage 用户消息
   * @returns 最终的助手回复
   */
  async run(userMessage: string): Promise<string> {
    // 添加用户消息
    this.messages.push({
      role: "user",
      content: userMessage,
    });

    try {
      await this.agentLoop();
      return this.extractFinalResponse();
    } catch (error) {
      await this.config.hooks.onError?.(error as Error);
      throw error;
    } finally {
      await this.config.hooks.onComplete?.();
    }
  }

  /**
   * 核心循环逻辑
   */
  private async agentLoop(): Promise<void> {
    let iteration = 0;

    while (iteration < this.config.maxIterations) {
      iteration++;

      // 钩子：调用前
      await this.config.hooks.onBeforeCall?.(this.messages);

      // 调用 LLM
      const response = await this.client.messages.create({
        model: this.config.model,
        system: this.config.systemPrompt,
        messages: this.messages,
        tools: TOOLS,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      // 钩子：调用后
      await this.config.hooks.onAfterCall?.(response);

      // 将助手响应添加到消息历史
      this.messages.push({
        role: "assistant",
        content: response.content,
      });

      // 检查是否需要继续循环
      if (response.stop_reason !== "tool_use") {
        break;
      }

      // 执行工具调用
      const toolResults = await this.executeTools(response.content);

      // 将工具结果添加到消息历史
      this.messages.push({
        role: "user",
        content: toolResults,
      });
    }

    if (iteration >= this.config.maxIterations) {
      console.warn(
        `⚠️ Agent reached max iterations (${this.config.maxIterations})`,
      );
    }
  }

  /**
   * 执行所有工具调用
   */
  private async executeTools(
    content: Array<Anthropic.ContentBlock>,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const block of content) {
      if (block.type === "tool_use") {
        // 钩子：工具调用前
        await this.config.hooks.onToolCall?.(block.name, block.input);

        // 执行工具 - 使用 dispatch map
        const output = await executeTool(block.name, block.input);
        
        // 打印工具执行结果
        console.log(`> ${block.name}: ${output.slice(0, 200)}`);

        // 钩子：工具调用后
        await this.config.hooks.onToolResult?.(block.name, output);

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
          is_error: output.startsWith("Error:"),
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

    if (lastMessage.role !== "assistant") {
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

  /**
   * 获取完整的消息历史
   */
  getMessages(): Anthropic.MessageParam[] {
    return [...this.messages];
  }

  /**
   * 清空消息历史
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * 设置消息历史（用于恢复对话）
   */
  setMessages(messages: Anthropic.MessageParam[]): void {
    this.messages = [...messages];
  }
}
