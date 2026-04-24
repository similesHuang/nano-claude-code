import { AgentLoop } from "../../agent/index.js";
import type { AgentCallbacks } from "../../agent/index.js";
import type { PermissionMode } from "../../agent/extensions/index.js";
import { getAgentConfig, getCompactConfig } from "../../config/agent.js";

/**
 * Agent 生命周期管理
 */
export class AgentInstance {
  private agent: AgentLoop | null = null;

  createAgent(
    callbacks: AgentCallbacks,
    permissionMode: PermissionMode = "default",
  ): AgentLoop {
    if (!this.agent) {
      const config = getAgentConfig();
      const compact = getCompactConfig();
      this.agent = new AgentLoop(config, callbacks, {
        permissionMode,
        compact,
      });
    }
    return this.agent;
  }

  async run(input: string): Promise<string> {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    return this.agent.run(input);
  }

  abort(): void {
    this.agent?.control.abort();
  }

  destroy(): void {
    this.agent?.control.destroy();
  }

  clearConversation(): void {
    this.agent?.control.clearConversation();
  }

  async compactConversation(focus?: string): Promise<string> {
    if (!this.agent) {
      return "No active conversation.";
    }
    return this.agent.control.compactConversation(focus);
  }

  setPermissionMode(mode: PermissionMode): void {
    this.agent?.control.setPermissionMode(mode);
  }

  get isAborted(): boolean {
    return this.agent?.control.isAborted ?? false;
  }
}
