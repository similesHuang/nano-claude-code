import type { PermissionMode } from "../agent/extensions/index.js";
import { PERMISSION_MODES } from "../agent/extensions/index.js";
import { Renderer } from "./ui/renderer.js";
import { Spinner } from "./ui/spinner.js";
import { InputHandler } from "./ui/input.js";
import { CommandRegistry, registerBuiltinCommands } from "./ui/commands.js";
import { AgentInstance } from "./component/agentInstance.js";
import { CallbacksFactory } from "./component/callbacks.js";
import { Template } from "./component/template.js";
import { getAgentConfig } from "../config/agent.js";
import { saveConfigFile } from "../uitls/index.js";
import * as readline from "readline";
/**
 * CliApp - CLI 主应用协调者
 */
export class App {
  private readonly renderer = new Renderer();
  private readonly spinner: Spinner;
  private readonly commands = new CommandRegistry();
  private readonly input: InputHandler;
  private readonly agentInstance = new AgentInstance();
  private readonly callbacksFactory: CallbacksFactory;
  private readonly template: Template;
  private permissionMode: PermissionMode = "default";

  constructor() {
    this.spinner = new Spinner(this.renderer.getTheme());
    this.input = new InputHandler(this.renderer, this.commands);
    this.callbacksFactory = new CallbacksFactory(
      this.spinner,
      this.renderer,
      this.input,
    );
    this.template = new Template(
      this.renderer,
      this.commands,
      this.input,
      this.agentInstance,
      this.spinner,
    );
    this.registerCommands();
  }

  async start(): Promise<void> {
    this.input.setupTerminal();
    this.setupSignalHandler();

    const ok = await this.ensureConfig();
    if (!ok) return;

    this.agentInstance.createAgent(
      this.callbacksFactory.create(),
      this.permissionMode,
    );
    this.renderer.banner();

    await this.template.run();
  }

  // ── 命令注册 ────────────────────────────────────────

  private registerCommands(): void {
    registerBuiltinCommands(this.commands, this.renderer, {
      getPermissionMode: () => this.permissionMode,
      setPermissionMode: (m) => {
        this.permissionMode = m as PermissionMode;
        this.agentInstance.setPermissionMode(this.permissionMode);
      },
      permissionModes: PERMISSION_MODES,
      onExit: () => this.exit(),
      onClear: () => {
        this.agentInstance.clearConversation();
        this.renderer.print(this.renderer.getColor("muted")("  对话已清空\n"));
      },
      onCompact: async (focus?: string) => {
        this.spinner.start("压缩中");
        try {
          const msg = await this.agentInstance.compactConversation(focus);
          this.spinner.stop();
          this.renderer.print(
            this.renderer.getColor("muted")(`  ${msg} (focus: ${focus})\n`),
          );
        } catch (err) {
          this.spinner.stop();
          this.renderer.error(
            `压缩失败: ${err instanceof Error ? err.message : String(err)}`,
          );
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

  // ── 环境监测 ────────────────────────────────────────
  private async ensureConfig(): Promise<boolean> {
    const config = getAgentConfig();
    const missing: { apiKey?: true; baseUrl?: true; model?: true } = {};
    if (!config.apiKey) missing.apiKey = true;
    if (!config.baseUrl) missing.baseUrl = true;
    if (!config.model) missing.model = true;

    if (Object.keys(missing).length === 0) return true;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (query: string): Promise<string> =>
      new Promise((resolve) => rl.question(query, resolve));

    this.renderer.warning("检测到配置缺失，请输入以下信息：\n");

    const input: { apiKey?: string; baseUrl?: string; model?: string } = {};

    if (missing.apiKey) {
      const apiKey = await question(
        `  ${this.renderer.getColor("info")("ANTHROPIC_API_KEY")}: `,
      );
      if (!apiKey.trim()) {
        this.renderer.error("API Key 不能为空");
        rl.close();
        return false;
      }
      input.apiKey = apiKey.trim();
    }

    if (missing.baseUrl) {
      const baseUrl = await question(
        `  ${this.renderer.getColor("info")("ANTHROPIC_BASE_URL")}: `,
      );
      if (!baseUrl.trim()) {
        this.renderer.error("Base URL 不能为空");
        rl.close();
        return false;
      }
      input.baseUrl = baseUrl.trim();
    }

    if (missing.model) {
      const model = await question(
        `  ${this.renderer.getColor("info")("CLAUDE_MODEL")}: `,
      );
      if (!model.trim()) {
        this.renderer.error("Model 不能为空");
        rl.close();
        return false;
      }
      input.model = model.trim();
    }

    rl.close();

    saveConfigFile({
      ...config,
      ...input,
    });

    this.renderer.success("配置已保存到 ~/.nano-claude-code/config.json\n");
    return true;
  }

  // ── 退出 ───────────────────────────────────────────

  private exit(): void {
    this.agentInstance.destroy();
    this.renderer.print(this.renderer.getColor("muted")("\n  👋 再见!\n"));
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  }
}
