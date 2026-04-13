import type { Renderer } from "./renderer";

export interface SlashCommand {
  name: string;
  description: string;
  handler: (args: string) => boolean | void; // return true = handled, skip agent
}

/**
 * 斜杠命令注册表
 * 职责：注册、匹配、执行命令；提供 / 补全候选
 */
export class CommandRegistry {
  private commands: Map<string, SlashCommand> = new Map();

  register(cmd: SlashCommand) {
    this.commands.set(cmd.name, cmd);
  }

  /**
   * 尝试执行输入。如果是斜杠命令则执行并返回 true，否则返回 false
   */
  tryExecute(input: string): boolean {
    if (!input.startsWith("/")) return false;

    const spaceIdx = input.indexOf(" ");
    const name = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

    const cmd = this.commands.get(name);
    if (!cmd) return false;

    cmd.handler(args);
    return true;
  }

  /**
   * 根据前缀返回匹配的命令列表（用于 / 补全提示）
   */
  getCompletions(prefix: string): Array<{ name: string; description: string }> {
    if (!prefix.startsWith("/")) return [];

    const results: Array<{ name: string; description: string }> = [];
    for (const cmd of this.commands.values()) {
      if (cmd.name.startsWith(prefix)) {
        results.push({ name: cmd.name, description: cmd.description });
      }
    }
    return results;
  }

  /**
   * 获取所有命令（用于 /help 展示）
   */
  getAll(): SlashCommand[] {
    return [...this.commands.values()];
  }
}

/**
 * 注册内置命令
 */
export function registerBuiltinCommands(
  registry: CommandRegistry,
  renderer: Renderer,
  context: {
    getPermissionMode: () => string;
    setPermissionMode: (mode: string) => void;
    permissionModes: readonly string[];
    onExit: () => void;
    onClear: () => void;
  },
) {
  registry.register({
    name: "/help",
    description: "显示帮助信息",
    handler: () => {
      renderer.print("");
      renderer.info("快捷键:");
      renderer.info("  Enter          发送消息");
      renderer.info("  Shift+Enter    换行输入");
      renderer.info("  ↑ / ↓          历史记录");
      renderer.info("  ← / →          移动光标");
      renderer.info("  Ctrl+A / E     行首 / 行尾");
      renderer.info("  Ctrl+U         清空输入");
      renderer.info("  Ctrl+C         退出");
      renderer.print("");
      renderer.info("命令:");
      for (const cmd of registry.getAll()) {
        renderer.info(`  ${cmd.name.padEnd(14)} ${cmd.description}`);
      }
      renderer.print("");
      return true;
    },
  });

  registry.register({
    name: "/exit",
    description: "退出程序",
    handler: () => {
      context.onExit();
      return true;
    },
  });

  registry.register({
    name: "/clear",
    description: "清空当前对话",
    handler: () => {
      context.onClear();
      return true;
    },
  });

  registry.register({
    name: "/mode",
    description: "切换权限模式 (default|plan|auto)",
    handler: (args) => {
      const modes = context.permissionModes;
      if (args && modes.includes(args)) {
        context.setPermissionMode(args);
        renderer.success(`[权限模式已切换: ${args}]`);
      } else {
        renderer.info(`用法: /mode <${modes.join("|")}>`);
        renderer.info(`当前: ${context.getPermissionMode()}`);
      }
      return true;
    },
  });
}
