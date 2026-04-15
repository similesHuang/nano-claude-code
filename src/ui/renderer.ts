import chalk from "chalk";
import { ThemeConfig, defaultTheme } from "./theme";
import { HintList, type HintItem } from "./components/HintList";

/**
 * Renderer - 终端输出渲染器
 *
 * Gemini CLI 风格：简洁、无边框、plain text
 */
export class Renderer {
  private theme: ThemeConfig;

  constructor(theme?: ThemeConfig) {
    this.theme = theme || defaultTheme;
  }

  private c(name: keyof ThemeConfig["colors"]): any {
    return (chalk as any)[this.theme.colors[name]] || chalk.white;
  }

  print(msg: string) {
    console.log(msg);
  }

  banner() {
    const p = this.c("primary");
    const s = this.c("secondary");
    const m = this.c("muted");

    this.print("");
    this.print(p("  ╭─────────────────────────────────╮"));
    this.print(p("  │") + s("  nano-claude-code ") + m("v1.0.0") + "       " + p("│"));
    this.print(p("  ╰─────────────────────────────────╯"));
    this.print("");
    this.print(m("  Tips:"));
    this.print(m("  1. Ask questions, edit files, or run commands."));
    this.print(m("  2. Be specific for the best results."));
    this.print(m("  3. Create ") + s("CLAUDE.md") + m(" files to customize."));
    this.print(m("  4. ") + s("/help") + m(" for more information."));
    this.print("");
  }

  response(text: string) {
    for (const line of text.split("\n")) {
      this.print(`  ${line}`);
    }
  }

  toolCall(toolName: string, summary: string) {
    const info = this.c("info");
    this.print(`  ${info("⏺")} ${info(toolName)}${chalk.dim("(")}${summary}${chalk.dim(")")}`);
  }

  toolResult(toolName: string, output: string, isError: boolean) {
    if (isError) {
      const firstLine = output.split("\n")[0].slice(0, 100);
      this.print(`  ${chalk.dim("⎿")}  ${this.c("error")("✗")} ${firstLine}`);
    } else {
      this.print(`  ${chalk.dim("⎿")}  ${this.c("success")("✔")} Done`);
    }
  }

  skillLoad(skillName: string, success: boolean) {
    const info = this.c("info");
    this.print(`\n  ${info("⏺")} ${info("Skill")}${chalk.dim("(")}${info(skillName)}${chalk.dim(")")}`);
    if (success) {
      this.print(`  ${chalk.dim("⎿")}  ${this.c("success")("✔")} Loaded`);
    } else {
      this.print(`  ${chalk.dim("⎿")}  ${this.c("error")("✗")} Failed to load`);
    }
  }

  permissionDenied(toolName: string, reason: string) {
    this.print("");
    this.print(`  ${this.c("error")("✗")} Permission denied: ${toolName}`);
    this.print(`    ${chalk.dim(reason)}`);
    this.print("");
  }

  permissionAsk(toolName: string, toolInput: any, reason: string) {
    const preview = JSON.stringify(toolInput, null, 2).slice(0, 200);
    this.print("");
    this.print(`  ${this.c("warning")("⚠")} Permission needed: ${this.c("info")(toolName)}`);
    this.print(`    ${chalk.dim(preview.split("\n").join("\n    "))}`);
    this.print(`    ${chalk.dim(reason)}`);
  }

  permissionPrompt() {
    process.stdout.write(`  ${this.c("primary")("Allow?")} ${chalk.dim("(y/n/always)")} `);
  }

  error(message: string) {
    this.print("");
    this.print(`  ${this.c("error")("✗")} ${message}`);
    this.print("");
  }

  warning(message: string) {
    this.print("");
    this.print(`  ${this.c("warning")("⚠")} ${message}`);
    this.print("");
  }

  info(message: string) {
    this.print(chalk.dim(`  ${message}`));
  }

  success(message: string) {
    this.print("");
    this.print(`  ${this.c("success")("✔")} ${message}`);
    this.print("");
  }

  /**
   * 生成工具调用摘要
   */
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

    if (toolName === "todo" && Array.isArray(toolInput.items)) {
      const markers: Record<string, string> = {
        pending: "○",
        in_progress: "◑",
        completed: "●",
        "not-started": "○",
        "in-progress": "◑",
      };
      const preview = toolInput.items
        .slice(0, 6)
        .map((item: any, i: number) => {
          const status = String(item?.status || "").toLowerCase();
          const marker = markers[status] || "?";
          const text = String(item?.text || item?.title || item?.task || "").trim();
          return `${marker}${text ? text.slice(0, 16) : `item${i + 1}`}`;
        })
        .join(" ");
      const extra = toolInput.items.length > 6 ? ` +${toolInput.items.length - 6}` : "";
      return preview + extra;
    }

    if (Array.isArray(toolInput.items)) {
      return `${toolInput.items.length} items`;
    }

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

  /**
   * 渲染命令补全提示菜单
   */
  commandHints(
    matches: Array<{ name: string; description: string }>,
    selectedIndex: number,
    inputLine: string,
    prompt: string,
  ) {
    process.stdout.write(`\r\x1b[2K${prompt}${chalk.white(inputLine)}`);

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
