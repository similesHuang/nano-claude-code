import chalk from "chalk";

const TOOL_COLORS: Record<string, typeof chalk> = {
  read_file: chalk.blue,
  write_file: chalk.green,
  edit_file: chalk.yellow,
  bash: chalk.magenta,
  todo: chalk.green,
  compact: chalk.cyan,
  load_skill: chalk.cyan,
  task: chalk.red,
};

export class Renderer {
  print(msg: string) {
    console.log(msg);
  }

  banner() {
    this.print(`
${chalk.cyan("    _")}
${chalk.cyan('   (_)___ ____ ____   ____   __  ______  ____')}
${chalk.cyan('   / / __ \\\\_  _ \\\\')}${chalk.blue('_  _ ')}${chalk.cyan('\\\\  \\ / /\\ \\ / / / ___/ / __ \\')}
${chalk.cyan('  / / /_/ // / // /_\\ \\/  \\ V / / /__  / /_/ /')}
${chalk.cyan(' / /\\____//_/ /_/\\____/\\____/ \\_/ \\___/  \\____/')}

${chalk.gray("─".repeat(50))}
${chalk.blue("nano-claude-code")} ${chalk.dim("v1.0.0")}
${chalk.gray("─".repeat(50))}
`);
  }

  response(text: string) {
    this.print(
      chalk.gray("\n  ┌─") + chalk.green(" Claude ") + chalk.gray("─".repeat(32)),
    );
    for (const line of text.split("\n")) {
      this.print(chalk.gray("  │ ") + line);
    }
    this.print(chalk.gray("  └" + "─".repeat(38)) + "\n");
  }

  toolCall(toolName: string, summary: string) {
    this.print(
      `\n  ${chalk.magenta("⚡")} ${chalk.blue(toolName)} ${chalk.dim(summary)}`,
    );
  }

  permissionDenied(toolName: string, reason: string) {
    this.print(
      `  ${chalk.red("⛔")} ${chalk.red(toolName)}: ${chalk.dim(reason)}`,
    );
  }

  permissionAsk(toolName: string, toolInput: any, reason: string) {
    const preview = JSON.stringify(toolInput, null, 0).slice(0, 120);
    this.print(
      `\n  ${chalk.yellow("🔒")} ${chalk.yellow("权限确认")} ${chalk.blue(toolName)}`,
    );
    this.print(`  ${chalk.dim(preview)}`);
    this.print(`  ${chalk.dim(reason)}`);
  }

  permissionPrompt() {
    process.stdout.write(
      `  ${chalk.cyan("允许?")} ${chalk.dim("(y/n/always)")} `,
    );
  }

  error(message: string) {
    this.print(chalk.red(`\n  ✗ ${message}\n`));
  }

  info(message: string) {
    this.print(chalk.dim(`  ${message}`));
  }

  success(message: string) {
    this.print(chalk.green(`  ${message}`));
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
        return value.slice(0, 60);
      }
    }

    if (toolName === "todo" && Array.isArray(toolInput.items)) {
      const markers: Record<string, string> = {
        pending: "🕘", in_progress: "🔄", completed: "✅",
        "not-started": "🕘", "in-progress": "🔄",
      };
      const preview = toolInput.items
        .slice(0, 6)
        .map((item: any, i: number) => {
          const status = String(item?.status || "").toLowerCase();
          const marker = markers[status] || "❔";
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
    // 先写当前输入行
    process.stdout.write(`\r\x1b[2K${prompt}${chalk.white(inputLine)}`);

    if (matches.length === 0) return;

    // 在输入行下方渲染提示列表
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const isSelected = i === selectedIndex;
      const prefix = isSelected ? chalk.cyan("❯") : " ";
      const name = isSelected ? chalk.cyan(m.name) : chalk.white(m.name);
      const desc = chalk.dim(m.description);
      process.stdout.write(`\n\x1b[2K  ${prefix} ${name}  ${desc}`);
    }

    // 光标回到输入行
    if (matches.length > 0) {
      process.stdout.write(`\x1b[${matches.length}A`);
    }
    // 光标定位到输入行末尾
    const col = prompt.replace(/\x1b\[[0-9;]*m/g, "").length + inputLine.length + 1;
    process.stdout.write(`\r\x1b[${col}C`);
  }

  /**
   * 清除命令提示菜单
   */
  clearHints(lineCount: number) {
    if (lineCount <= 0) return;
    // 移动到菜单区域并清除
    for (let i = 0; i < lineCount; i++) {
      process.stdout.write(`\n\x1b[2K`);
    }
    // 回到原位
    process.stdout.write(`\x1b[${lineCount}A`);
  }
}
