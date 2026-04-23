import chalk from "chalk";
import hljs from "highlight.js";

/**
 * 简单的 Markdown 渲染器（纯正则实现，无依赖问题）
 */
export function renderMarkdown(md: string): string {
  let output = md;

  // 代码块 ```lang\ncode\n```
  output = output.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
    const highlighted = hljs.highlight(code.trim(), { language }).value;
    const lines = highlighted.split("\n");
    const lineCount = lines.length;
    const gutter = String(lineCount).length;
    const header = `  ${chalk.dim("─".repeat(gutter + 22))}`;

    const numbered = lines
      .map((line, i) => {
        const num = String(i + 1).padStart(gutter, " ");
        return `  ${chalk.dim(num)} │ ${line}`;
      })
      .join("\n");

    return `\n${header}\n${numbered}\n${header}\n`;
  });

  // 标题
  output = output.replace(/^### (.+)$/gm, (_, t) =>
    `\n${chalk.cyan.bold(`▪▪▪ ${t}`)}\n`);
  output = output.replace(/^## (.+)$/gm, (_, t) =>
    `\n${chalk.cyan.bold(`▪▪ ${t}`)}\n`);
  output = output.replace(/^# (.+)$/gm, (_, t) =>
    `\n${chalk.cyan.bold(`▪ ${t}`)}\n`);

  // 粗体
  output = output.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  output = output.replace(/__(.+?)__/g, (_, t) => chalk.bold(t));

  // 斜体
  output = output.replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t));
  output = output.replace(/_(.+?)_/g, (_, t) => chalk.italic(t));

  // 分割线
  output = output.replace(/^---$/gm, chalk.dim("─".repeat(40)));

  // 引用块
  output = output.replace(/^> (.+)$/gm, (_, t) =>
    `  ${chalk.dim("│")} ${chalk.dim(t)}`);

  // 无序列表
  output = output.replace(/^[\-\*] (.+?)$/gm, (_, t) =>
    `    ${chalk.dim("•")} ${t}`);

  // 有序列表
  output = output.replace(/^\d+\. (.+?)$/gm, (_, t) =>
    `    ${chalk.dim("▪")} ${t}`);

  // 链接 [text](url)
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) =>
    `${chalk.blue.underline(text)} ${chalk.dim(`(${href})`)}`);

  // 行内代码（支持转义的反引号）
  output = output.replace(/`((?:[^`\\]|\\.)+)`/g, (_, code) =>
    chalk.bgBlackBright(` ${code.replace(/\\`/g, "`")} `));

  // 表格（按行处理：正确区分表头和数据行，支持多表格）
  const tableLines: string[] = output.split("\n");
  const processedLines: string[] = [];
  let inTable = false;
  let tableRowCount = 0;

  for (let i = 0; i < tableLines.length; i++) {
    const line = tableLines[i];

    // 检查是否是表格分隔行（全是 -: 等）
    const isSeparator = /^\|[\-\s:]+\|$/.test(line);
    if (isSeparator) {
      inTable = false;
      tableRowCount = 0;
      continue;
    }

    // 检查是否是表格行
    const tableMatch = line.match(/^\|(.+)\|$/);
    if (tableMatch && !isSeparator) {
      const cells = tableMatch[1].split("|").map(c => c.trim()).filter(c => c !== undefined);
      const formatted = cells.map(c => ` ${c} `).join(chalk.dim("│"));
      const isHeader = tableRowCount === 0 && !inTable;

      if (!inTable) {
        inTable = true;
        tableRowCount = 0;
      }
      tableRowCount++;

      if (isHeader) {
        processedLines.push(chalk.bold(formatted));
      } else {
        processedLines.push(chalk.dim("│") + formatted);
      }
    } else {
      inTable = false;
      tableRowCount = 0;
      processedLines.push(line);
    }
  }

  output = processedLines.join("\n");

  // 清理多余空行
  output = output.replace(/\n{3,}/g, "\n\n");

  return output;
}
