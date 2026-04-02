import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentConfig,
  ToolExecutionResult,
  AgentHooks,
} from "./types";
import { TOOLS, executeTool } from "./tools";
import { todoManager } from "./scheduler";

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
  private roundsSinceTodoUpdate: number = 0;
  private readonly NAG_THRESHOLD: number = 3;

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

      // 执行工具调用 - 必须确保为所有 tool_use 提供 tool_result
      try {
        const { results: toolResults, usedTodo } = await this.executeTools(response.content);

        // 更新 nag reminder 计数器
        if (usedTodo) {
          this.roundsSinceTodoUpdate = 0;
        } else {
          this.roundsSinceTodoUpdate++;
        }

        // 将工具结果添加到消息历史
        this.messages.push({
          role: "user",
          content: toolResults,
        });

        // 如果超过阈值未更新 todo，在单独的 user 消息中插入提醒
        // 不能和 tool_result 混在同一个消息中，会导致 API 错误
        if (this.roundsSinceTodoUpdate >= this.NAG_THRESHOLD) {
          this.messages.push({
            role: "user",
            content: "<reminder>Update your todos.</reminder>",
          });
          this.roundsSinceTodoUpdate = 0; // 重置以避免重复提醒
        }
      } catch (error) {
        // 如果执行工具时出错，仍然要为所有 tool_use 提供 error 响应
        // 否则会导致 messages 数组状态不一致
        const errorResults = this.createErrorToolResults(response.content, error);
        this.messages.push({
          role: "user",
          content: errorResults,
        });
        console.error("Error executing tools:", error);
      }
    }

    if (iteration >= this.config.maxIterations) {
      console.warn(
        `⚠️ Agent reached max iterations (${this.config.maxIterations})`,
      );
    }
  }

  /**
   * 执行所有工具调用
   * @returns 工具执行结果和是否使用了 todo 工具
   */
  private async executeTools(
    content: Array<Anthropic.ContentBlock>,
  ): Promise<{ results: ToolExecutionResult[]; usedTodo: boolean }> {
    const results: ToolExecutionResult[] = [];
    let usedTodo = false;

    for (const block of content) {
      if (block.type === "tool_use") {
        // 检查是否使用了 todo 工具
        if (todoManager.isTodoTool(block.name)) {
          usedTodo = true;
        }

        try {
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
        } catch (error) {
          // 如果执行单个工具时出错，仍然要返回 tool_result
          // 这样可以继续处理其他工具调用
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Error executing tool ${block.name}:`, errorMessage);
          
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error executing tool: ${errorMessage}`,
            is_error: true,
          });
        }
      }
    }

    return { results, usedTodo };
  }

  /**
   * 为所有 tool_use 创建错误响应
   * 确保即使执行失败，也能维护消息历史的一致性
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
          content: `Error executing tool: ${errorMessage}`,
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
