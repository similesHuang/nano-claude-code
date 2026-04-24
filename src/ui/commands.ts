import type { Renderer } from "./renderer";

export interface SlashCommand {
  name: string;
  description: string;
  handler: (args: string) => boolean | void;
}

/**
 * 斜杠命令注册表
 */
export class CommandRegistry {
  private commands: SlashCommand[] = [];

  register(cmd: SlashCommand): void {
    // 检查是否已存在同名命令
    const exists = this.commands.some((c) => c.name === cmd.name);
    if (exists) {
      return;
    }
    this.commands.push(cmd);
  }

  tryExecute(input: string): boolean {
    if (!input.startsWith("/")) return false;

    const spaceIdx = input.indexOf(" ");
    const name = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

    const cmd = this.commands.find((c) => c.name === name);
    if (!cmd) return false;

    cmd.handler(args);
    return true;
  }

  getAll(): SlashCommand[] {
    return this.commands;
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
    onCompact: (focus?: string) => Promise<void>;
  }
): void {
  const commands: SlashCommand[] = [
    {
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
    },
    {
      name: "/exit",
      description: "退出程序",
      handler: () => {
        context.onExit();
        return true;
      },
    },
    {
      name: "/clear",
      description: "清空当前对话",
      handler: () => {
        context.onClear();
        return true;
      },
    },
    {
      name: "/compact",
      description: "压缩当前对话上下文 (可选: /compact <focus>)",
      handler: (args) => {
        context.onCompact(args || undefined);
        return true;
      },
    },
    {
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
    },
  ];

  commands.forEach((cmd) => registry.register(cmd));
}
