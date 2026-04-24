import type Anthropic from "@anthropic-ai/sdk";
import type { PermissionMode } from "../extensions/permission/index";

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
  compact?: CompactConfig;
  permissionMode?: PermissionMode;
  tools?: Anthropic.Tool[];
}

/**
 * 权限应答 — UI 与 Agent 之间的权限交互契约
 */
export type PermissionAnswer = "y" | "n" | "always";

/**
 * 回调接口 - 用于 CLI 等外部监听工具执行
 */
export interface AgentCallbacks {
  onToolCall?: (toolName: string, input: any) => void;
  onToolResult?: (toolName: string, output: string, isError: boolean) => void;
  onError?: (error: Error) => void;
  onPermissionAsk?: (toolName: string, toolInput: any, reason: string) => Promise<PermissionAnswer>;
  onPermissionDenied?: (toolName: string, reason: string) => void;
}

/**
 * 工具执行结果（Anthropic API 格式）
 */
export interface ToolExecutionResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * 工具处理函数的结构化返回值
 */
export interface ToolOutput {
  output: string;
  isError: boolean;
}
