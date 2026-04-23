import type Anthropic from "@anthropic-ai/sdk";

/**
 * AgentState - 聚合 AgentLoop 的运行时状态
 *
 * 替代散落的 messages、aborted、currentStream、systemPrompt 字段
 */
export class AgentState {
  messages: Anthropic.MessageParam[] = [];
  aborted = false;
  currentStream: any = null;
  systemPrompt = "";

  reset(): void {
    this.messages = [];
    this.aborted = false;
    this.currentStream = null;
  }
}