#!/usr/bin/env node
import inquirer from 'inquirer';
import chalk from 'chalk';
import { AgentLoop } from './agent';
import { agentConfig } from './config';

const COMMANDS: Record<string, string> = {
  '/help':  '显示帮助信息',
  '/clear': '清空对话历史',
  '/exit':  '退出程序',
};

function printHelp() {
  console.log(chalk.gray('\n可用命令:'));
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(chalk.cyan(`  ${cmd.padEnd(10)}`) + chalk.gray(desc));
  }
  console.log('');
}

(async () => {
  console.log(chalk.blue('🤖 nano-claude-code'));
  console.log(chalk.gray('输入 /help 查看可用命令\n'));

  let agent = new AgentLoop(agentConfig);

  while (true) {
    const { message } = await inquirer.prompt([
      { type: 'input', name: 'message', message: chalk.cyan('>') }
    ]);

    const input = message.trim();
    if (!input) continue;

    if (input.startsWith('/')) {
      switch (input) {
        case '/exit':
          console.log(chalk.gray('\n👋 再见!'));
          process.exit(0);
        case '/help':
          printHelp();
          break;
        case '/clear':
          agent = new AgentLoop(agentConfig);
          console.log(chalk.gray('\n对话历史已清空\n'));
          break;
        default:
          console.log(chalk.yellow(`\n未知命令: ${input}，输入 /help 查看可用命令\n`));
      }
      continue;
    }

    try {
      const response = await agent.run(input);
      console.log(chalk.green('\nAgent:'));
      console.log(response);
      console.log('');
    } catch (error) {
      console.error(chalk.red('\n❌ 出错了:'), error);
    }
  }
})();
