import type Anthropic from "@anthropic-ai/sdk";
import type { PermissionMode } from "./extensions/permissionManager";

export interface CompactConfig {
  contextLimit?: number;
  keepRecentToolResults?: number;
  persistThreshold?: number;
  previewChars?: number;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  maxIterations?: number;
  isSubAgent?: boolean;
  compact?: CompactConfig;
  permissionMode?: PermissionMode;
}

/**
 * 回调接口 - 用于 CLI 等外部监听工具执行
 */
export interface AgentCallbacks {
  onToolCall?: (toolName: string, input: any) => void;
  onError?: (error: Error) => void;
  onPermissionAsk?: (toolName: string, toolInput: any, reason: string) => Promise<"y" | "n" | "always">;
  onPermissionDenied?: (toolName: string, reason: string) => void;
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
