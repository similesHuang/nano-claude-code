import type { Renderer } from "./ui/renderer.js";
import type { CommandRegistry } from "./ui/commands.js";
import type { InputHandler } from "./ui/input.js";
import type { AgentManager } from "./AgentManager.js";
import type { Spinner } from "./ui/spinner.js";

const CTRL_C = "\x03";

/**
 * Repl - 命令行交互循环
 */
export class Repl {
  private running = false;

  constructor(
    private renderer: Renderer,
    private commands: CommandRegistry,
    private input: InputHandler,
    private agentManager: AgentManager,
    private spinner: Spinner
  ) {}

  async run(): Promise<void> {
    this.setupInterruptHandling();

    while (true) {
      const text = await this.input.waitForInput();

      if (this.isInterrupt(text)) {
        this.handleInterrupt();
        continue;
      }

      if (!text) continue;

      if (this.commands.tryExecute(text)) continue;

      if (this.handleLegacyCommand(text)) continue;

      await this.runAgent(text);
    }
  }

  // ── 中断处理 ────────────────────────────────────────

  private setupInterruptHandling(): void {
    this.input.onKeypress((_str, key) => {
      if (key?.name === "escape") {
        this.agentManager.abort();
      }
    });
  }

  private isInterrupt(text: string): boolean {
    return text === CTRL_C;
  }

  private handleInterrupt(): void {
    if (this.running) {
      this.running = false;
      this.renderer.print("\n" + this.renderer.getColor("warning")("  (中断)"));
      return;
    }
    this.exit();
  }

  // ── 命令处理 ────────────────────────────────────────

  private handleLegacyCommand(text: string): boolean {
    if (text === "exit" || text === "quit") {
      this.exit();
      return true;
    }

    const commandMap: Record<string, string> = {
      help: "/help",
      clear: "/clear",
    };

    const slashCommand = commandMap[text];
    if (slashCommand) {
      this.commands.tryExecute(slashCommand);
      return true;
    }

    return false;
  }

  private exit(): void {
    this.agentManager.destroy();
    process.exit(0);
  }

  // ── Agent 执行 ───────────────────────────────────────

  private async runAgent(input: string): Promise<void> {
    this.running = true;
    this.spinner.start("思考中");

    try {
      const response = await this.agentManager.run(input);

      this.spinner.stop();

      if (this.agentManager.isAborted) {
        this.renderer.print(this.renderer.getColor("warning")("\n  (已中断)\n"));
      } else if (response) {
        this.renderer.response(response);
      }
    } catch (error) {
      this.spinner.stop();
      this.renderer.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.running = false;
    }
  }
}
