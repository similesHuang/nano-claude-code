import { runBash } from "./bash.js";
import { runRead, runWrite, runEdit } from "./file.js";
import type { TodoManager } from "../systems/todoManager.js";
import type { SkillsSystem } from "../systems/skillsSystem.js";
import type { MemorySystem } from "../extensions/memorySystem.js";
import type { ToolOutput } from "../types.js";

export { TOOLS, TASK_TOOL } from "./schemas.js";

/**
 * 工具依赖注入接口
 */
export interface ToolDeps {
  todoManager: TodoManager;
  skillsSystem: SkillsSystem;
  memorySystem: MemorySystem;
}

/**
 * ToolRegistry - 工具路由与执行
 *
 * 通过构造函数注入依赖，消除模块级全局单例。
 * 每个 AgentLoop 实例持有独立的 ToolRegistry，子代理不共享状态。
 */
export class ToolRegistry {
  private handlers: Record<string, (input: any) => Promise<ToolOutput>>;

  constructor(private deps: ToolDeps) {
    this.handlers = {
      bash: async (input) => this.ok(await runBash(input.command)),
      read_file: async (input) => this.ok(await runRead(input.path, input.limit)),
      write_file: async (input) => this.ok(await runWrite(input.path, input.content)),
      edit_file: async (input) => this.ok(await runEdit(input.path, input.old_text, input.new_text)),
      todo: async (input) => this.ok(deps.todoManager.update(input.items)),
      compact: async () => this.ok("Compacting conversation..."),
      load_skill: async (input) => this.ok(deps.skillsSystem.loadSkill(input.name)),
      save_memory: async (input) =>
        this.ok(
          await deps.memorySystem.saveMemory(
            input.name, input.description, input.type,
            input.content, input.scope, input.sentiment,
          ),
        ),
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
}
