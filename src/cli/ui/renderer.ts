import chalk from "chalk";
import { ThemeConfig, defaultTheme } from "./theme";
import { HintList, type HintItem } from "./components/HintList/index";
import { renderMarkdown } from "./markdown";

/**
 * Renderer - 终端输出渲染器
 *
 * 现代 CLI 风格：清晰层次、Markdown 渲染、语法高亮
 */
export class Renderer {
  private theme: ThemeConfig;

  constructor(theme?: ThemeConfig) {
    this.theme = theme || defaultTheme;
  }

  getTheme(): ThemeConfig {
    return this.theme;
  }

  c(name: keyof ThemeConfig["colors"]): typeof chalk {
    return (chalk as any)[this.theme.colors[name]] || chalk.white;
  }

  // ── 基础输出 ────────────────────────────────────────

  print(msg: string) {
    console.log(msg);
  }

  // ── Banner ─────────────────────────────────────────

  banner() {
    const p = this.c("primary");
    const m = this.c("muted");

    const inuyasha = [
      p("/*"),
      p(" *      _______        _______"),
      p(" *     | ~   ~ |  ~'  | _   _ |  ~.  "),
      p(" *   ,~| <> <> |~`  ,~|<a   a>|~'"),
      p(" *  `~  |   ^   |  `~  |   L `,|"),
      p(" *     | \\---/ |      | /---\\ |"),
      p(" *      \\ \"\"\" /        \\'~~~'/"),
      p(" *       `---'          `---'"),
      p(" */"),
    ];
    this.print("");
    for (const line of inuyasha) this.print(line);
    this.print("");
    this.print(m(" /help 获取命令提示"));
    this.print("");
  }

  // ── 状态栏 ─────────────────────────────────────────

  statusBar(mode: string, model?: string) {
    const m = this.c("muted");
    const parts: string[] = [];
    parts.push(`mode: ${mode}`);
    if (model) parts.push(`model: ${model}`);
    this.print(`  ${m("┄".repeat(50))}`);
    this.print(`  ${m(parts.join("  ·  "))}`);
  }

 
  // ── Agent 回复（Markdown 渲染） ──────────────────────

  response(text: string) {
    const rendered = renderMarkdown(text);
    for (const line of rendered.split("\n")) {
      this.print(`  ${line}`);
    }
  }

  // ── 工具执行 ───────────────────────────────────────

  toolCall(toolName: string, summary: string) {
    const info = this.c("info");
    const m = this.c("muted");
    this.print(`  ${m("┄".repeat(50))}`);
    this.print(`  ${info("▸")} ${info(toolName)} ${m("·")} ${summary}`);
  }

  toolResult(toolName: string, output: string, isError: boolean) {
    const m = this.c("muted");
    if (isError) {
      const firstLine = output.split("\n")[0].slice(0, 80);
      this.print(`    ${m("└")} ${this.c("error")("✗")} ${firstLine}`);
    } else {
      this.print(`    ${m("└")} ${this.c("success")("✔")} Done`);
    }
    this.print(`  ${m("┄".repeat(50))}`);
  }

  skillLoad(skillName: string, success: boolean) {
    const info = this.c("info");
    const m = this.c("muted");
    this.print("");
    this.print(`  ${info("▸")} Skill ${m("·")} ${info(skillName)}`);
    if (success) {
      this.print(`    ${m("└")} ${this.c("success")("✔")} Loaded`);
    } else {
      this.print(`    ${m("└")} ${this.c("error")("✗")} Failed`);
    }
  }

  // ── 权限提示 ───────────────────────────────────────

  permissionAsk(toolName: string, toolInput: any, reason: string) {
    const warn = this.c("warning");
    const info = this.c("info");
    const m = this.c("muted");

    this.print("");
    this.print(`  ${warn("⚠")} 权限请求: ${info(toolName)}`);
    if (reason) {
      this.print(`    ${m(reason)}`);
    }
  }

  permissionDenied(toolName: string, reason: string) {
    const err = this.c("error");
    const m = this.c("muted");
    this.print("");
    this.print(`  ${err("✗")} 权限拒绝: ${toolName}`);
    if (reason) {
      this.print(`    ${m(reason)}`);
    }
  }

  permissionPrompt() {
    const primary = this.c("primary");
    const m = this.c("muted");
    process.stdout.write(`\n  ${primary("?")} ${primary("Allow")} ${m("(y / n / always)")} `);
  }

  // ── 反馈消息 ───────────────────────────────────────

  error(message: string) {
    const err = this.c("error");
    const m = this.c("muted");
    this.print("");
    this.print(`  ${err("✗")} ${message}`);
    this.print("");
  }

  warning(message: string) {
    const warn = this.c("warning");
    this.print("");
    this.print(`  ${warn("⚠")} ${message}`);
    this.print("");
  }

  success(message: string) {
    const ok = this.c("success");
    this.print("");
    this.print(`  ${ok("✔")} ${message}`);
    this.print("");
  }

  info(message: string) {
    const m = this.c("muted");
    this.print(`  ${m(message)}`);
  }

  // ── 工具摘要 ───────────────────────────────────────

  formatToolSummary(toolName: string, toolInput: any): string {
    if (!toolInput || typeof toolInput !== "object") return "";

    const preferredFields = [
      "command", "path", "filePath", "description",
      "prompt", "query", "name", "id",
    ] as const;

    for (const key of preferredFields) {
      const value = toolInput[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    if (toolName === "task_list") return "listing tasks";
    if (toolName === "task_create") return toolInput.subject || "new task";
    if (toolName === "task_update") {
      const parts: string[] = [`#${toolInput.task_id}`];
      if (toolInput.status) parts.push(toolInput.status);
      return parts.join(" ");
    }
    if (toolName === "task_get") return `#${toolInput.task_id}`;
    if (Array.isArray(toolInput.items)) return `${toolInput.items.length} items`;

    return Object.entries(toolInput)
      .filter(([, v]) => v !== undefined && v !== null)
      .slice(0, 2)
      .map(([k, v]) => {
        if (typeof v === "string") return `${k}=${(v as string).slice(0, 24)}`;
        if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
        if (Array.isArray(v)) return `${k}=[${(v as any[]).length}]`;
        if (typeof v === "object") return `${k}={...}`;
        return k;
      })
      .join(" ");
  }

  // ── 命令补全 ───────────────────────────────────────

  commandHints(
    matches: Array<{ name: string; description: string }>,
    selectedIndex: number,
    inputLine: string,
    prompt: string,
  ) {
    process.stdout.write(`\r\x1b[2K${prompt}${this.c("neutral")(inputLine)}`);

    if (matches.length === 0) return;

    const hints: HintItem[] = matches.map((m) => ({
      name: m.name,
      description: m.description,
    }));
    const hintList = new HintList(hints, { selectedIndex }, this.theme);
    const lines = hintList.render();

    for (const line of lines) {
      process.stdout.write(`\n\x1b[2K${line}`);
    }

    process.stdout.write(`\x1b[${matches.length}A`);
    const col = prompt.replace(/\x1b\[[0-9;]*m/g, "").length + inputLine.length + 1;
    process.stdout.write(`\r\x1b[${col}C`);
  }

  clearHints(lineCount: number) {
    if (lineCount <= 0) return;
    process.stdout.write("\n\x1b[J\x1b[A");
  }
}
