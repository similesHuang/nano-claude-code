import { runBash } from "./bash.js";
import { runRead, runWrite, runEdit } from "./file.js";
import type { TaskManager } from "../taskRuntime/taskManager.js";
import type { SkillsSystem } from "../systems/skillsSystem.js";
import type { MemorySystem } from "../extensions/memorySystem/memorySystem.js";
import type { AsyncTask } from "../taskRuntime/asyncTask.js";
import type { TeammateManager } from "../multiAgent/teammateManager.js";
import type { MessageBus } from "../multiAgent/messageBus.js";
import type { ToolOutput } from "../types.js";

export { TOOLS, TEAM_TOOLS } from "./schemas.js";

/**
 * 工具依赖注入接口
 */
export interface ToolDeps {
  taskManager: TaskManager;
  skillsSystem: SkillsSystem;
  memorySystem: MemorySystem;
  asyncTask: AsyncTask;
  /** 可选：团队模式依赖，不启用时为 undefined */
  teammateManager?: TeammateManager;
  messageBus?: MessageBus;
}

/**
 * ToolRegistry - 工具路由与执行
 *
 * 通过构造函数注入依赖，消除模块级全局单例。
 * 每个 AgentLoop 实例持有独立的 ToolRegistry，子代理不共享状态。
 */
export class ToolRegistry {
  private handlers: Record<string, (input: any) => Promise<ToolOutput>>;

  constructor(deps: ToolDeps) {
    this.handlers = {
      bash: async (input) => this.ok(await runBash(input.command)),
      read_file: async (input) => this.ok(await runRead(input.path, input.limit)),
      write_file: async (input) => this.ok(await runWrite(input.path, input.content)),
      edit_file: async (input) => this.ok(await runEdit(input.path, input.old_text, input.new_text)),
      task_create: async (input) => this.ok(deps.taskManager.create(input.subject, input.description)),
      task_update: async (input) => this.ok(deps.taskManager.update(
        input.task_id, input.status, input.owner, input.addBlockedBy, input.addBlocks,
      )),
      task_list: async () => this.ok(deps.taskManager.listAll()),
      task_get: async (input) => this.ok(deps.taskManager.get(input.task_id)),
      compact: async () => this.ok("Compacting conversation..."),
      load_skill: async (input) => this.ok(deps.skillsSystem.loadSkill(input.name)),
      save_memory: async (input) =>
        this.ok(
          await deps.memorySystem.saveMemory(
            input.name, input.description, input.type,
            input.content, input.scope, input.sentiment,
          ),
        ),
      background_run: async (input) => this.ok(deps.asyncTask.run(input.command)),
      check_background: async (input) => this.ok(deps.asyncTask.check(input.task_id)),

      // ── 团队工具（仅主代理注册，deps 不存在时降级报错） ──
      spawn_teammate: async (input) => {
        if (!deps.teammateManager) return this.err("Team mode not enabled");
        return this.ok(deps.teammateManager.spawn(input.name, input.role, input.prompt));
      },
      list_teammates: async () => {
        if (!deps.teammateManager) return this.err("Team mode not enabled");
        return this.ok(deps.teammateManager.listAll());
      },
      send_message: async (input) => {
        if (!deps.messageBus) return this.err("Team mode not enabled");
        return this.ok(deps.messageBus.send("lead", input.to, input.content, input.msg_type));
      },
      read_inbox: async () => {
        if (!deps.messageBus) return this.err("Team mode not enabled");
        return this.ok(JSON.stringify(deps.messageBus.readInbox("lead"), null, 2));
      },
      broadcast: async (input) => {
        if (!deps.messageBus || !deps.teammateManager) return this.err("Team mode not enabled");
        return this.ok(deps.messageBus.broadcast("lead", input.content, deps.teammateManager.memberNames()));
      },
    };
  }

  /**
   * 执行工具调用，返回结构化结果
   */
  async execute(name: string, input: any): Promise<ToolOutput> {
    const handler = this.handlers[name];

    if (!handler) {
      return { output: `Error: Unknown tool '${name}'`, isError: true };
    }

    try {
      return await handler(input);
    } catch (error: any) {
      return { output: `Error: ${error.message}`, isError: true };
    }
  }

  /** 包装正常输出 — Error: 前缀表示工具自行报告的错误 */
  private ok(output: string): ToolOutput {
    return { output, isError: output.startsWith("Error:") };
  }

  private err(msg: string): ToolOutput {
    return { output: `Error: ${msg}`, isError: true };
  }
}

