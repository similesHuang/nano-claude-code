import type { PermissionMode } from "../agent/extensions/index.js";
import { PERMISSION_MODES } from "../agent/extensions/index.js";
import { Renderer } from "../ui/renderer.js";
import { Spinner } from "../ui/spinner.js";
import { InputHandler } from "../ui/input.js";
import { CommandRegistry, registerBuiltinCommands } from "../ui/commands.js";
import { AgentManager } from "./component/agentInstance.js";
import { CallbacksFactory } from "./component/callbacks.js";
import { Template } from "./component/template.js";

/**
 * CliApp - CLI 主应用协调者
 */
export class App {
  private readonly renderer = new Renderer();
  private readonly spinner: Spinner;
  private readonly commands = new CommandRegistry();
  private readonly input: InputHandler;
  private readonly agentManager = new AgentManager();
  private readonly callbacksFactory: CallbacksFactory;
  private readonly template: Template;

  private permissionMode: PermissionMode = "default";

  constructor() {
    this.spinner = new Spinner(this.renderer.getTheme());
    this.input = new InputHandler(this.renderer, this.commands);
    this.callbacksFactory = new CallbacksFactory(this.spinner, this.renderer, this.input);
    this.template = new Template(this.renderer, this.commands, this.input, this.agentManager, this.spinner);

    this.registerCommands();
  }

  async start(): Promise<void> {
    this.input.setupTerminal();
    this.setupSignalHandler();

    this.agentManager.createAgent(this.callbacksFactory.create(), this.permissionMode);
    this.renderer.banner();

    await this.template.run();
  }

  // ── 命令注册 ────────────────────────────────────────

  private registerCommands(): void {
    registerBuiltinCommands(this.commands, this.renderer, {
      getPermissionMode: () => this.permissionMode,
      setPermissionMode: (m) => {
        this.permissionMode = m as PermissionMode;
        this.agentManager.setPermissionMode(this.permissionMode);
      },
      permissionModes: PERMISSION_MODES,
      onExit: () => this.exit(),
      onClear: () => {
        this.agentManager.clearConversation();
        this.renderer.print(this.renderer.getColor("muted")("  对话已清空\n"));
      },
      onCompact: async (focus?: string) => {
        this.spinner.start("压缩中");
        try {
          const msg = await this.agentManager.compactConversation(focus);
          this.spinner.stop();
          this.renderer.print(this.renderer.getColor("muted")(`  ${msg} (focus: ${focus})\n`));
        } catch (err) {
          this.spinner.stop();
          this.renderer.error(`压缩失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });
  }

  // ── 信号处理 ────────────────────────────────────────

  private setupSignalHandler(): void {
    process.on("SIGINT", () => {
      this.exit();
    });
  }

  // ── 退出 ───────────────────────────────────────────

  private exit(): void {
    this.agentManager.destroy();
    this.renderer.print(this.renderer.getColor("muted")("\n  👋 再见!\n"));
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  }
}
