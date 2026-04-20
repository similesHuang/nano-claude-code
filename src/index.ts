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
  private spinner: Spinner;
  private commands = new CommandRegistry();
  private input: InputHandler;
  private permissionMode: PermissionMode = "default";
  private running = false;
  private agent: AgentLoop | null = null;

  constructor() {
    this.spinner = new Spinner(this.renderer.getTheme());
    this.input = new InputHandler(this.renderer, this.commands);

    registerBuiltinCommands(this.commands, this.renderer, {
      getPermissionMode: () => this.permissionMode,
      setPermissionMode: (m) => {
        this.permissionMode = m as PermissionMode;
        this.agent?.setPermissionMode(this.permissionMode);
      },
      permissionModes: PERMISSION_MODES,
      onExit: () => this.exit(),
      onClear: () => {
        this.agent?.clearConversation();
        this.renderer.print(this.renderer.c("muted")("  对话已清空\n"));
      },
      onCompact: async (focus?: string) => {
        const agent = this.agent;
        if (!agent) {
          this.renderer.print(this.renderer.c("muted")("  没有活跃的对话\n"));
          return;
        }
        this.spinner.start("压缩中");
        try {
          await agent.compactConversation(focus);
          this.spinner.stop();
          const msg = focus
            ? `  对话已压缩 (focus: ${focus})\n`
            : "  对话已压缩\n";
          this.renderer.print(this.renderer.c("muted")(msg));
        } catch {
          this.spinner.stop();
          this.renderer.error("压缩失败");
        }
      },
    });
  }

  async start() {
    this.input.setupTerminal();
    process.on("SIGINT", () => {
      if (!this.running) this.exit();
    });

    // 预初始化 agent
    this.getOrCreateAgent();

    this.renderer.banner();
    await this.repl();
  }

  private async repl() {
    while (true) {
      const text = await this.input.waitForInput();

      // Ctrl+C 信号
      if (text === "\x03") {
        if (this.running) {
          this.running = false;
          this.renderer.print("\n" + this.renderer.c("warning")("  (中断)"));
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

    const onKeypress = (_str: string | undefined, key: any) => {
      if (key?.name === "escape") {
        this.agent?.abort();
      }
    };
    process.stdin.on("keypress", onKeypress);

    try {
      const response = await this.agent!.run(input);

      this.spinner.stop();

      if (this.agent!.isAborted) {
        this.renderer.print(this.renderer.c("warning")("\n  (已中断)\n"));
      } else if (response) {
        this.renderer.response(response);
      }
    } catch (error) {
      this.spinner.stop();
      this.renderer.error(error instanceof Error ? error.message : String(error));
    } finally {
      process.stdin.removeListener("keypress", onKeypress);
      this.running = false;
    }
  }

  private getOrCreateAgent(): AgentLoop {
    if (this.agent) {
      return this.agent;
    }

    const callbacks = {
      onToolCall: (name: string, toolInput: any) => {
        this.spinner.stop();
        if (name === "load_skill") {
          const skillName = toolInput?.name || "unknown";
          this.renderer.skillLoad(skillName, true);
        } else {
          const summary = this.renderer.formatToolSummary(name, toolInput);
          this.renderer.toolCall(name, summary);
        }
        this.spinner.start("执行中");
      },
      onToolResult: (name: string, output: string, isError: boolean) => {
        this.spinner.stop();
        this.renderer.toolResult(name, output, isError);
        this.spinner.start("思考中");
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
    this.agent = new AgentLoop(config, callbacks);
    return this.agent;
  }

  private exit() {
    this.agent?.destroy();
    this.renderer.print(this.renderer.c("muted")("\n  👋 再见!\n"));
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
