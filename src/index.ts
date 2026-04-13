#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import { AgentLoop } from "./agent";
import { agentConfig } from "./config";
import { PERMISSION_MODES, type PermissionMode } from "./agent/extensions";
import {
  Spinner,
  Renderer,
  InputHandler,
  CommandRegistry,
  registerBuiltinCommands,
} from "./ui";

class ClaudeCLI {
  private renderer = new Renderer();
  private spinner = new Spinner();
  private commands = new CommandRegistry();
  private input: InputHandler;
  private permissionMode: PermissionMode = "default";
  private running = false;

  constructor() {
    this.input = new InputHandler(this.renderer, this.commands);

    registerBuiltinCommands(this.commands, this.renderer, {
      getPermissionMode: () => this.permissionMode,
      setPermissionMode: (m) => { this.permissionMode = m as PermissionMode; },
      permissionModes: PERMISSION_MODES,
      onExit: () => this.exit(),
      onClear: () => this.renderer.print(chalk.gray("  对话已清空\n")),
    });
  }

  async start() {
    this.input.setupTerminal();
    process.on("SIGINT", () => {
      if (!this.running) this.exit();
    });

    this.renderer.banner();
    // 启动时显示帮助
    this.commands.tryExecute("/help");
    await this.repl();
  }

  private async repl() {
    while (true) {
      const text = await this.input.waitForInput();

      // Ctrl+C 信号
      if (text === "\x03") {
        if (this.running) {
          this.running = false;
          this.renderer.print("\n" + chalk.yellow("  (中断)"));
          continue;
        }
        this.exit();
      }

      if (!text) continue;

      // 尝试作为斜杠命令执行
      if (this.commands.tryExecute(text)) continue;

      // 兼容旧的无 / 命令
      if (text === "exit" || text === "quit") this.exit();
      if (text === "help") { this.commands.tryExecute("/help"); continue; }
      if (text === "clear") { this.commands.tryExecute("/clear"); continue; }

      await this.runAgent(text);
    }
  }

  private async runAgent(input: string) {
    this.running = true;
    this.spinner.start("思考中");

    try {
      const callbacks = {
        onToolCall: (name: string, toolInput: any) => {
          this.spinner.stop();
          const summary = this.renderer.formatToolSummary(name, toolInput);
          this.renderer.toolCall(name, summary);
          this.spinner.start("执行中");
        },
        onError: (error: Error) => {
          this.spinner.stop();
          this.renderer.error(error.message);
        },
        onPermissionDenied: (name: string, reason: string) => {
          this.spinner.stop();
          this.renderer.permissionDenied(name, reason);
          this.spinner.start("思考中");
        },
        onPermissionAsk: async (
          name: string,
          toolInput: any,
          reason: string,
        ): Promise<"y" | "n" | "always"> => {
          this.spinner.stop();
          this.renderer.permissionAsk(name, toolInput, reason);
          this.renderer.permissionPrompt();

          const ch = await this.input.waitForKey(["y", "n", "a"]);
          const answer = ch === "a" ? "always" : ch === "y" ? "y" : "n";
          this.renderer.print(answer);
          this.spinner.start("执行中");
          return answer;
        },
      };

      const config = { ...agentConfig, permissionMode: this.permissionMode };
      const agent = new AgentLoop(config, callbacks);
      const response = await agent.run(input);

      this.spinner.stop();
      this.renderer.response(response);
    } catch (error) {
      this.spinner.stop();
      this.renderer.error(error instanceof Error ? error.message : String(error));
    }

    this.running = false;
  }

  private exit() {
    this.renderer.print(chalk.gray("\n  👋 再见!\n"));
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  }
}

// CLI 入口
const program = new Command();
program
  .name("nano-claude-code")
  .description("A lightweight Claude AI coding agent")
  .version("1.0.0")
  .action(() => {
    const cli = new ClaudeCLI();
    cli.start().catch((err) => {
      console.error(chalk.red("启动失败:"), err.message);
      process.exit(1);
    });
  });

program.parse();
