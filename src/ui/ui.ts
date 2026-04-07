import chalk from 'chalk';

type ChalkFunction = typeof chalk;

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const TOOL_COLORS: Record<string, ChalkFunction> = {
  Read: chalk.blue,
  Write: chalk.green,
  Edit: chalk.yellow,
  Bash: chalk.magenta,
  Grep: chalk.cyan,
  Glob: chalk.cyan,
  todo: chalk.green,
  web_search: chalk.cyan,
  web_fetch: chalk.cyan,
};

export class Spinner {
  private currentFrame: number = 0;
  private text: string = '';
  private interval: NodeJS.Timeout | null = null;
  private started: boolean = false;

  start(text: string = '加载中...') {
    if (this.started) {
      this.stop();
    }

    this.text = text;
    this.started = true;
    this.currentFrame = 0;

    this.interval = setInterval(() => {
      const frame = FRAMES[this.currentFrame % FRAMES.length];
      const line = `\r  ${chalk.cyan(frame)} ${this.text}`;

      // 清除当前行并打印新的 spinner
      process.stdout.write('\x1b[2K' + line);
      this.currentFrame++;
    }, 80);

    return this;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // 清除 spinner 行
    process.stdout.write('\r\x1b[2K');
    this.started = false;
    return this;
  }

  setText(text: string) {
    this.text = text;
  }
}

export class UI {
  /**
   * 打印普通消息
   */
  print(message: string) {
    console.log(message);
  }

  /**
   * 打印工具调用
   */
  printToolCall(toolName: string) {
    const color = TOOL_COLORS[toolName] || chalk.gray;
    const icon = this.getToolIcon(toolName);
    console.log(`\n  ${chalk.dim('│')}`);
    console.log(`  ${chalk.dim('├')} ${color(`${icon} ${toolName}`)} ${chalk.dim('→')}`);
  }

  /**
   * 打印工具执行结果
   */
  printToolResult(output: string, _isError: boolean = false) {
    const lines = output.split('\n').slice(0, 5);
    const content = lines.join('\n    ');
    const suffix = output.split('\n').length > 5 ? '...' : '';

    console.log(`    ${chalk.dim(content)}${suffix}`);
  }

  /**
   * 打印 Agent 响应
   */
  printResponse(response: string) {
    const lines = response.split('\n');
    console.log(chalk.gray('\n  ┌─ ' + chalk.green('Claude') + chalk.gray(' ─' + '─'.repeat(30))));
    for (const line of lines) {
      console.log('  ' + chalk.gray('│') + ' ' + line);
    }
    console.log(chalk.gray('  ' + '└' + '─'.repeat(38) + '\n'));
  }

  /**
   * 打印错误
   */
  printError(message: string) {
    console.log(chalk.red(`\n  ✗ 错误: ${message}\n`));
  }

  /**
   * 打印警告
   */
  printWarning(message: string) {
    console.log(chalk.yellow(`\n  ⚠ ${message}\n`));
  }

  /**
   * 打印信息
   */
  printInfo(message: string) {
    console.log(chalk.blue(`\n  ℹ ${message}\n`));
  }

  /**
   * 打印分隔线
   */
  printDivider() {
    console.log(chalk.gray('  ' + '─'.repeat(38)));
  }

  /**
   * 获取工具图标
   */
  private getToolIcon(toolName: string): string {
    const icons: Record<string, string> = {
      Read: '📄',
      Write: '✏️',
      Edit: '📝',
      Bash: '⚡',
      Grep: '🔍',
      Glob: '📁',
      todo: '📋',
      web_search: '🌐',
      web_fetch: '🌍',
    };
    return icons[toolName] || '🔧';
  }
}
