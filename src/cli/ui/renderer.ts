import chalk from "chalk";
import { marked, type Renderer as MarkedRenderer } from "marked";
import TerminalRenderer from "marked-terminal";
import { ThemeConfig, defaultTheme } from "./theme";
import { HintList, type HintItem } from "./hintList";

// ── 常量定义 ────────────────────────────────────────

const DIVIDER_LENGTH = 100;
const DIVIDER_CHAR = "┄";
const INDENT = "  ";
const TREE_BRANCH = "└";
const ARROW = "▸";

const ICONS = {
  success: "✔",
  error: "✗",
  warning: "⚠",
  question: "?",
} as const;

// ── 类型定义 ────────────────────────────────────────

type ColorName = keyof ThemeConfig["colors"];
type ToolInput = Record<string, unknown>;
type ChalkFunction = typeof chalk;

/**
 * Renderer - 终端输出渲染器
 *
 * 现代 CLI 风格：清晰层次、Markdown 渲染、语法高亮
 */
export class Renderer {
  private readonly theme: ThemeConfig;

  constructor(theme: ThemeConfig = defaultTheme) {
    this.theme = theme;
    this.configureMarked();
  }

  private configureMarked(): void {
    marked.setOptions({
      renderer: new TerminalRenderer({
        colors: this.theme.colors,
        reflow: true,
        width: 80,
      }) as unknown as MarkedRenderer,
    });
  }

  getTheme(): ThemeConfig {
    return this.theme;
  }

  /** 获取主题颜色对应的 chalk 函数 */
  private color(name: ColorName): ChalkFunction {
    const colorName = this.theme.colors[name];
    return (chalk as unknown as Record<string, ChalkFunction>)[colorName] ?? chalk.white;
  }

  /** 公共方法：获取主题颜色 */
  getColor(name: ColorName): ChalkFunction {
    return this.color(name);
  }

  // ── 基础输出 ────────────────────────────────────────

  print(msg: string): void {
    console.log(msg);
  }

  private printDivider(): void {
    this.print(`${INDENT}${this.color("muted")(DIVIDER_CHAR.repeat(DIVIDER_LENGTH))}`);
  }

  // ── Banner ─────────────────────────────────────────

  banner(): void {
    const primary = this.color("primary");
    const muted = this.color("muted");

    const asciiArt = [
      "/*",
      " *      _______        _______",
      " *     | ~   ~ |  ~'  | _   _ |  ~.  ",
      " *   ,~| <> <> |~`  ,~|<a   a>|~'",
      " *  `~  |   ^   |  `~  |   L `,|",
      " *     | \\---/ |      | /---\\ |",
      " *      \\ \"\"\" /        \\'~~~'/",
      " *       `---'          `---'",
      " */",
    ];

    this.print("");
    asciiArt.forEach((line) => this.print(primary(line)));
    this.print("");
    this.print(muted(" /help 获取命令提示"));
    this.print("");
  }


  // ── Agent 回复（Markdown 渲染） ──────────────────────

  response(text: string): void {
    const output = marked.parse(text) as string;
     this.print(`\n${output}`);
  }

  // ── 工具执行 ───────────────────────────────────────

  toolCall(toolName: string, summary: string): void {
    const info = this.color("info");
    const muted = this.color("muted");

    this.printDivider();
    this.print(`${INDENT}${info(ARROW)} ${info(toolName)} ${muted("·")} ${summary}`);
  }

  toolResult(_toolName: string, output: string, isError: boolean): void {
    const muted = this.color("muted");
    const branch = `${INDENT}  ${muted(TREE_BRANCH)}`;

    if (isError) {
      const firstLine = output.split("\n")[0].slice(0, 80);
      this.print(`${branch} ${this.color("error")(ICONS.error)} ${firstLine}`);
    } else {
      this.print(`${branch} ${this.color("success")(ICONS.success)} Done`);
    }

    this.printDivider();
  }

  // ── 权限提示 ───────────────────────────────────────

  permissionAsk(toolName: string, _toolInput: ToolInput, reason: string): void {
    const warning = this.color("warning");
    const info = this.color("info");
    const muted = this.color("muted");
    const primary = this.color("primary");

    this.print("");
    process.stdout.write(`${INDENT}${warning(ICONS.warning)} 权限请求: ${info(toolName)} ${primary("?")} ${primary("Allow")} ${muted("(y/n/always)")}`);

    if (reason) {
      process.stdout.write(`  ${muted(reason)} `);
      
    }
  }
  
  userAnswer(answer: "y" | "n" | "always"): void {
    const muted = this.color("primary");
    process.stdout.write(`${muted(answer)}\n`);
  }
  
  permissionDenied(toolName: string, reason: string): void {
    const error = this.color("error");
    const muted = this.color("muted");

    this.print("");
    this.print(`${INDENT}${error(ICONS.error)} 权限拒绝: ${toolName}`);

    if (reason) {
      this.print(`${INDENT}  ${muted(reason)}`);
    }
  }

  // ── 反馈消息 ───────────────────────────────────────

  error(message: string): void {
    const error = this.color("error");
    this.print("");
    this.print(`${INDENT}${error(ICONS.error)} ${message}`);
    this.print("");
  }

  warning(message: string): void {
    const warning = this.color("warning");
    this.print("");
    this.print(`${INDENT}${warning(ICONS.warning)} ${message}`);
    this.print("");
  }

  success(message: string): void {
    const success = this.color("success");
    this.print("");
    this.print(`${INDENT}${success(ICONS.success)} ${message}`);
    this.print("");
  }

  info(message: string): void {
    const muted = this.color("muted");
    this.print(`${INDENT}${muted(message)}`);
  }

  // ── 工具摘要 ───────────────────────────────────────

  formatToolSummary(toolName: string, toolInput: ToolInput): string {
    if (!toolInput || typeof toolInput !== "object") {
      return "";
    }

    // 优先字段提取
    const summary = this.extractPreferredField(toolInput);
    if (summary) {
      return summary;
    }

    // 特殊工具处理
    const specialSummary = this.formatSpecialTool(toolName, toolInput);
    if (specialSummary) {
      return specialSummary;
    }

    // 通用格式化
    return this.formatGenericToolInput(toolInput);
  }

  private extractPreferredField(toolInput: ToolInput): string {
    const preferredFields = [
      "command",
      "path",
      "filePath",
      "description",
      "prompt",
      "query",
      "name",
      "id",
    ] as const;

    for (const key of preferredFields) {
      const value = toolInput[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    return "";
  }

  private formatSpecialTool(toolName: string, toolInput: ToolInput): string {
    switch (toolName) {
      case "task_list":
        return "listing tasks";

      case "task_create":
        return typeof toolInput.subject === "string" ? toolInput.subject : "new task";

      case "task_update": {
        const parts = [`#${toolInput.task_id}`];
        if (toolInput.status) {
          parts.push(String(toolInput.status));
        }
        return parts.join(" ");
      }

      case "task_get":
        return `#${toolInput.task_id}`;

      default:
        if (Array.isArray(toolInput.items)) {
          return `${toolInput.items.length} items`;
        }
        return "";
    }
  }

  private formatGenericToolInput(toolInput: ToolInput): string {
    return Object.entries(toolInput)
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 2)
      .map(([key, value]) => this.formatKeyValue(key, value))
      .join(" ");
  }

  private formatKeyValue(key: string, value: unknown): string {
    if (typeof value === "string") {
      return `${key}=${value.slice(0, 24)}`;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return `${key}=${value}`;
    }

    if (Array.isArray(value)) {
      return `${key}=[${value.length}]`;
    }

    if (typeof value === "object" && value !== null) {
      return `${key}={...}`;
    }

    return key;
  }

  // ── 命令补全 ───────────────────────────────────────

  commandHints(
    matches: Array<{ name: string; description: string }>,
    selectedIndex: number,
    inputLine: string,
    prompt: string
  ): void {
    // 清除当前行并重绘输入
    process.stdout.write(`\r\x1b[2K${prompt}${this.color("neutral")(inputLine)}`);

    if (matches.length === 0) {
      return;
    }

    // 渲染提示列表
    const hints: HintItem[] = matches.map((m) => ({
      name: m.name,
      description: m.description,
    }));

    const hintList = new HintList(hints, { selectedIndex }, this.theme);
    const lines = hintList.render();

    lines.forEach((line) => {
      process.stdout.write(`\n\x1b[2K${line}`);
    });

    // 光标回到输入位置
    process.stdout.write(`\x1b[${matches.length}A`);
    const cursorColumn = this.stripAnsiCodes(prompt).length + inputLine.length + 1;
    process.stdout.write(`\r\x1b[${cursorColumn}C`);
  }

  clearHints(lineCount: number): void {
    if (lineCount <= 0) {
      return;
    }
    process.stdout.write("\n\x1b[J\x1b[A");
  }

  /** 移除 ANSI 转义码 */
  private stripAnsiCodes(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
  }
}
