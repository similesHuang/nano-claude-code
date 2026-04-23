import type { AgentCallbacks } from "../agent/core/types.js";
import type { Spinner } from "./ui/spinner.js";
import type { Renderer } from "./ui/renderer.js";
import type { InputHandler } from "./ui/input.js";

/**
 * CallbacksFactory - AgentCallbacks 工厂
 *
 * 分离 CLI 与 Agent 的回调绑定逻辑
 */
export class CallbacksFactory {
  constructor(
    private spinner: Spinner,
    private renderer: Renderer,
    private input: InputHandler
  ) {}

  create(): AgentCallbacks {
    return {
      onToolCall: this.handleToolCall.bind(this),
      onToolResult: this.handleToolResult.bind(this),
      onError: this.handleError.bind(this),
      onPermissionDenied: this.handlePermissionDenied.bind(this),
      onPermissionAsk: this.handlePermissionAsk.bind(this),
    };
  }

  // ── 工具回调 ────────────────────────────────────────

  private handleToolCall(name: string, toolInput: any): void {
    this.spinner.stop();

    const summary = this.renderer.formatToolSummary(name, toolInput);
    this.renderer.toolCall(name, summary);

    this.spinner.start("执行中");
  }

  private handleToolResult(name: string, output: string, isError: boolean): void {
    this.spinner.stop();
    this.renderer.toolResult(name, output, isError);
    this.spinner.start("思考中");
  }

  private handleError(error: Error): void {
    this.spinner.stop();
    this.renderer.error(error.message);
  }

  private handlePermissionDenied(name: string, reason: string): void {
    this.spinner.stop();
    this.renderer.permissionDenied(name, reason);
    this.spinner.start("思考中");
  }

  private async handlePermissionAsk(
    name: string,
    toolInput: any,
    reason: string
  ): Promise<"y" | "n" | "always"> {
    this.spinner.stop();
    this.renderer.permissionAsk(name, toolInput, reason);
    this.renderer.permissionPrompt();

    const key = await this.input.waitForKey(["y", "n", "a"]);
    const answer = key === "a" ? "always" : key === "y" ? "y" : "n";

    this.renderer.print(answer);
    this.spinner.start("执行中");

    return answer;
  }
}
