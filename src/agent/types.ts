import type Anthropic from "@anthropic-ai/sdk";

/**
 * Agent 配置
 */
export interface AgentConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  maxIterations?: number; // 防止无限循环
  hooks?: AgentHooks;
}

/**
 * 钩子系统 - 用于扩展和监控
 */
export interface AgentHooks {
  onBeforeCall?: (messages: Anthropic.MessageParam[]) => void | Promise<void>;
  onAfterCall?: (response: Anthropic.Message) => void | Promise<void>;
  onToolCall?: (toolName: string, input: any) => void | Promise<void>;
  onToolResult?: (toolName: string, output: string) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
  onComplete?: () => void | Promise<void>;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
