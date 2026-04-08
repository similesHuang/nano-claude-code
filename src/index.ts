#!/usr/bin/env node
import chalk from 'chalk';
import readline from 'readline';
import { Command } from 'commander';
import { AgentLoop } from './agent';
import { agentConfig } from './config';
import { Spinner } from './ui/ui';

// ANSI escape codes
const ANSI = {
  clearLine: '\x1b[2K',
  clearScreen: '\x1b[2J',
  cursorHide: '\x1b[?25l',
  cursorShow: '\x1b[?25h',
  cursorUp: (n: number) => `\x1b[${n}A`,
  cursorDown: (n: number) => `\x1b[${n}B`,
  cursorRight: (n: number) => `\x1b[${n}C`,
  cursorLeft: (n: number) => `\x1b[${n}D`,
};

// Input state
interface InputState {
  buffer: string;
  cursor: number;
  history: string[];
  historyIndex: number;
  prompt: string;
}

class ClaudeCLI {
  private state: InputState;

  constructor() {
    this.state = {
      buffer: '',
      cursor: 0,
      history: [],
      historyIndex: -1,
      prompt: chalk.cyan('➜') + ' ',
    };
  }

  async start() {
    this.setupTerminal();
    this.printBanner();
    this.printHelp();
    await this.runREPL();
  }

  private setupTerminal() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }
    readline.emitKeypressEvents(process.stdin);

    process.on('exit', () => {
      process.stdout.write(ANSI.cursorShow);
    });

    process.on('SIGINT', () => {
      this.exit();
    });
  }

  private print(msg: string) {
    console.log(msg);
  }

  private printBanner() {
    this.print(`
${chalk.cyan('    _')}
${chalk.cyan('   (_)___ ____ ____   ____   __  ______  ____')}
${chalk.cyan('   / / __ \\\\_  _ \\\\'  ) + chalk.blue('_  _ ') + chalk.cyan('\\\\  \\ / /\\ \\ / / / ___/ / __ \\')}
${chalk.cyan('  / / /_/ // / // /_\\ \\/  \\ V / / /__  / /_/ /')}
${chalk.cyan(' / /\\____//_/ /_/\\____/\\____/ \\_/ \\___/  \\____/')}

${chalk.gray('─'.repeat(50))}
${chalk.blue('nano-claude-code')} ${chalk.dim('v1.0.0')}
${chalk.gray('─'.repeat(50))}
`);
  }

  private printHelp() {
    this.print(chalk.dim(`
  ${chalk.cyan('Enter')}          发送消息
  ${chalk.cyan('Shift+Enter')}    换行输入
  ${chalk.cyan('↑ / ↓')}          历史记录
  ${chalk.cyan('← / →')}          移动光标
  ${chalk.cyan('Ctrl+A / E')}      行首 / 行尾
  ${chalk.cyan('Ctrl+U')}          清空输入
  ${chalk.cyan('Ctrl+C')}          退出
`));
  }

  private render() {
    const { buffer, cursor, prompt } = this.state;
    const before = buffer.slice(0, cursor);
    const after = buffer.slice(cursor);

    process.stdout.write('\r' + ANSI.clearLine + prompt + chalk.white(before) + chalk.dim(after));
  }

  /**
   * 生成工具调用的摘要信息
   */
  private getToolSummary(toolName: string, toolInput: any): string {
    switch (toolName) {
      case 'bash':
        return chalk.dim(toolInput.command?.slice(0, 50) || '');
      case 'read_file':
        return chalk.dim(toolInput.path || '');
      case 'write_file':
        return chalk.dim(toolInput.path || '');
      case 'edit_file':
        return chalk.dim(toolInput.path || '');
      case 'task':
        return chalk.dim(toolInput.description || toolInput.prompt?.slice(0, 30) || '');
      case 'todo':
        return chalk.dim(`${toolInput.items?.length || 0} items`);
      default:
        return '';
    }
  }

  private async runREPL() {
    let isRunning = false;

    const handleKeypress = (str: string | undefined, key: any) => {
      // 忽略无效输入
      if (str === undefined && !key.name) return;

      const { buffer, cursor, history, historyIndex } = this.state;

      // Ctrl+C - 退出
      if (key.ctrl && key.name === 'c') {
        if (isRunning) {
          isRunning = false;
          this.print('\n' + chalk.yellow('  (中断)'));
        } else {
          this.exit();
        }
        return;
      }

      // Ctrl+U - 清空
      if (key.ctrl && key.name === 'u') {
        this.state.buffer = '';
        this.state.cursor = 0;
        this.render();
        return;
      }

      // Ctrl+L - 清屏
      if (key.ctrl && key.name === 'l') {
        process.stdout.write(ANSI.clearScreen);
        this.print('');
        this.render();
        return;
      }

      // Ctrl+A - 行首
      if (key.ctrl && key.name === 'a') {
        this.state.cursor = 0;
        this.render();
        return;
      }

      // Ctrl+E - 行尾
      if (key.ctrl && key.name === 'e') {
        this.state.cursor = buffer.length;
        this.render();
        return;
      }

      // ↑ - 历史上一条
      if (key.name === 'up') {
        if (history.length === 0) return;
        if (historyIndex < history.length - 1) {
          this.state.historyIndex++;
          this.state.buffer = history[historyIndex];
          this.state.cursor = this.state.buffer.length;
          this.render();
        }
        return;
      }

      // ↓ - 历史下一条
      if (key.name === 'down') {
        if (historyIndex > 0) {
          this.state.historyIndex--;
          this.state.buffer = history[historyIndex];
        } else if (historyIndex === 0) {
          this.state.historyIndex = -1;
          this.state.buffer = '';
        }
        this.state.cursor = this.state.buffer.length;
        this.render();
        return;
      }

      // ← - 左移
      if (key.name === 'left') {
        if (cursor > 0) {
          this.state.cursor--;
          this.render();
        }
        return;
      }

      // → - 右移
      if (key.name === 'right') {
        if (cursor < buffer.length) {
          this.state.cursor++;
          this.render();
        }
        return;
      }

      // Backspace
      if (key.name === 'backspace') {
        if (cursor > 0) {
          this.state.buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
          this.state.cursor--;
          this.render();
        }
        return;
      }

      // Delete
      if (key.name === 'delete') {
        if (cursor < buffer.length) {
          this.state.buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
          this.render();
        }
        return;
      }

      // Shift+Enter - 换行
      if (key.shift && (key.name === 'enter' || key.name === 'return')) {
        this.state.buffer = buffer.slice(0, cursor) + '\n' + buffer.slice(cursor);
        this.state.cursor++;
        this.render();
        return;
      }

      // 普通字符
      if (str && !key.ctrl && !key.meta) {
        this.state.buffer = buffer.slice(0, cursor) + str + buffer.slice(cursor);
        this.state.cursor++;
        this.render();
      }
    };

    // 主循环
    while (true) {
      this.state.buffer = '';
      this.state.cursor = 0;
      this.state.historyIndex = -1;
      this.render();

      // 等待输入
      await new Promise<void>((resolve) => {
        const onKeypress = (str: string | undefined, key: any) => {
          const isEnter = key.name === 'enter' || key.name === 'return' || str === '\r';
          if (isEnter && !key.shift) {
            process.stdin.removeListener('keypress', onKeypress);
            this.print(''); // 换行
            resolve();
          } else {
            handleKeypress(str, key);
          }
        };
        process.stdin.on('keypress', onKeypress);
      });

      const input = this.state.buffer.trim();

      if (!input) continue;

      // 添加到历史
      if (this.state.history[this.state.history.length - 1] !== this.state.buffer) {
        this.state.history.push(this.state.buffer);
      }

      // 命令处理
      if (input === '/exit' || input === 'exit' || input === 'quit') {
        this.exit();
      }

      if (input === '/help' || input === 'help') {
        this.printHelp();
        continue;
      }

      if (input === '/clear' || input === 'clear') {
        this.print(chalk.gray('  对话已清空\n'));
        continue;
      }

      // 运行 Agent
      isRunning = true;
      const spinner = new Spinner();

      try {
        spinner.start('思考中');

        const callbacks = {
          onToolCall: (toolName: string, toolInput: any) => {
            spinner.stop();
            const summary = this.getToolSummary(toolName, toolInput);
            this.print(`\n  ${chalk.magenta('⚡')} ${chalk.blue(toolName)} ${chalk.dim(summary)}`);
            spinner.start('执行中');
          },
          onError: (error: Error) => {
            spinner.stop();
            this.print(chalk.red(`\n  ✗ ${error.message}`));
          },
        };

        const agent = new AgentLoop(agentConfig, callbacks);
        const response = await agent.run(input);

        spinner.stop();

        // 显示响应
        this.print(chalk.gray('\n  ┌─') + chalk.green(' Claude ') + chalk.gray('─'.repeat(32)));
        for (const line of response.split('\n')) {
          this.print(chalk.gray('  │ ') + line);
        }
        this.print(chalk.gray('  └' + '─'.repeat(38)) + '\n');

      } catch (error) {
        spinner.stop();
        this.print(chalk.red(`\n  ✗ ${error instanceof Error ? error.message : String(error)}\n`));
      }

      isRunning = false;
    }
  }

  private exit() {
    this.print(chalk.gray('\n  👋 再见!\n'));
    process.stdout.write(ANSI.cursorShow);
    process.exit(0);
  }
}

// CLI 入口
const program = new Command();

program
  .name('nano-claude-code')
  .description('A lightweight Claude AI coding agent')
  .version('1.0.0')
  .action(() => {
    const cli = new ClaudeCLI();
    cli.start().catch((err) => {
      console.error(chalk.red('启动失败:'), err.message);
      process.exit(1);
    });
  });

program.parse();
