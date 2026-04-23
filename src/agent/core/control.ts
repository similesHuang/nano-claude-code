import type Anthropic from "@anthropic-ai/sdk";
import type { PermissionMode } from "../extensions/permission/index.js";
import type { AgentState } from "./state.js";
import type { Extensions } from "./extensionBuilder.js";

/**
 * AgentControlConfig - 简化后的依赖注入
 *
 * 从 11 个分散回调 → 3 个核心依赖
 */
export interface AgentControlConfig {
  state: AgentState;
  extensions: Extensions;
  summarizeHistory: (messages: Anthropic.MessageParam[]) => Promise<string>;
}

/**
 * AgentControl - 公共 API（供 CLI 调用）
 *
 * 生命周期控制与会话管理接口，与核心循环解耦
 */
export class AgentControl {
  private readonly config: AgentControlConfig;

  constructor(config: AgentControlConfig) {
    this.config = config;
  }

  // ── 中断控制 ────────────────────────────────────────

  abort(): void {
    this.config.state.aborted = true;
    this.config.state.currentStream?.abort();
  }

  get isAborted(): boolean {
    return this.config.state.aborted;
  }

  // ── 会话管理 ────────────────────────────────────────

  clearConversation(): void {
    const { state, extensions } = this.config;

    state.messages = [];
    extensions.taskManager.clear();

    if (extensions.memorySystem.isSuppressed()) {
      extensions.memorySystem.restoreMemories();
    }
    state.systemPrompt = extensions.promptBuilder.build();
  }

  async compactConversation(focus?: string): Promise<string> {
    const { state, extensions } = this.config;

    if (state.messages.length === 0) {
      return "No conversation to compact.";
    }

    const compacted = await extensions.compactSystem.compactHistory(
      state.messages,
      (msgs) => this.config.summarizeHistory(msgs),
      focus,
    );
    state.messages = compacted;
    return "Conversation compacted.";
  }

  // ── 权限管理 ────────────────────────────────────────

  setPermissionMode(mode: PermissionMode): void {
    this.config.extensions.permissionManager.mode = mode;
  }

  // ── 资源清理 ────────────────────────────────────────

  destroy(): void {
    const { taskManager, asyncTask, compactSystem } = this.config.extensions;
    taskManager.pruneCompletedChains();
    asyncTask.clearTasksCache();
    compactSystem.clearToolResults();
  }
}