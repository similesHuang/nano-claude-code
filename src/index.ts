#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { AgentLoop } from './agent';
import type { AgentConfig } from './agent/types';

const program = new Command();

// 创建 Agent 实例的工厂函数
function createAgent(): AgentLoop {
  const config: AgentConfig = {
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    systemPrompt: `You are a helpful coding assistant. You can use tools to interact with the file system and execute commands to help the user with their tasks.`,
    maxTokens: 8000,
    temperature: 0.7,
    maxIterations: 50,
    hooks: {
      onBeforeCall: () => {
        console.log(chalk.gray('🤔 思考中...'));
      },
      onToolCall: (toolName, input) => {
        console.log(chalk.blue(`🔧 使用工具: ${toolName}`));
      },
      onError: (error) => {
        console.error(chalk.red(`❌ 错误: ${error.message}`));
      },
    },
  };
  return new AgentLoop(config);
}

program
  .name('nano-claude-code')
  .description('coding agent CLI')
  .version('1.0.0');

program
  .command('hello')
  .description('打招呼命令')
  .option('-n, --name <name>', '你的名字', '用户')
  .action(async (options) => {
    console.log(chalk.green(`你好, ${options.name}! 欢迎使用 nano-claude-code`));
  });

program
  .command('chat')
  .description('进入 AI 对话模式 - 持续与 Agent 对话')
  .action(async () => {
    console.log(chalk.blue('🤖 AI 对话模式\n'));
    console.log(chalk.gray('输入你的问题，或输入 "exit" 退出\n'));

    const agent = createAgent();

    while (true) {
      const { message } = await inquirer.prompt([
        {
          type: 'input',
          name: 'message',
          message: chalk.cyan('你:'),
        }
      ]);

      if (message.toLowerCase() === 'exit') {
        console.log(chalk.gray('\n👋 再见!'));
        break;
      }

      try {
        const response = await agent.run(message);
        console.log(chalk.green('\n🤖 Agent:'));
        console.log(response);
        console.log('');
      } catch (error) {
        console.error(chalk.red('\n❌ 出错了:'), error);
      }
    }
  });

program
  .command('interactive')
  .alias('i')
  .description('进入交互模式')
  .action(async () => {
    console.log(chalk.blue('🤖 进入交互模式\n'));

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '选择你要执行的操作:',
        choices: [
          { name: 'AI 问答 (ask)', value: 'ask' },
          { name: 'AI 对话 (chat)', value: 'chat' },
          { name: '查看项目信息', value: 'info' },
          { name: '退出', value: 'exit' }
        ]
      }
    ]);

    switch (answers.action) {
      case 'ask': {
        const { question } = await inquirer.prompt([
          { type: 'input', name: 'question', message: '你想问什么:' }
        ]);
        console.log(chalk.magenta(`\n🤔 问题: ${question}\n`));
        try {
          const agent = createAgent();
          const response = await agent.run(question);
          console.log(chalk.green('\n🤖 回答:'));
          console.log(response);
        } catch (error) {
          console.error(chalk.red('\n❌ 出错了:'), error);
        }
        break;
      }
      case 'chat': {
        console.log(chalk.blue('\n🤖 AI 对话模式\n'));
        console.log(chalk.gray('输入你的问题，或输入 "exit" 退出\n'));
        const agent = createAgent();
        while (true) {
          const { message } = await inquirer.prompt([
            { type: 'input', name: 'message', message: chalk.cyan('你:') }
          ]);
          if (message.toLowerCase() === 'exit') {
            console.log(chalk.gray('\n👋 退出对话模式'));
            break;
          }
          try {
            const response = await agent.run(message);
            console.log(chalk.green('\n🤖 Agent:'));
            console.log(response);
            console.log('');
          } catch (error) {
            console.error(chalk.red('\n❌ 出错了:'), error);
          }
        }
        break;
      }
      case 'info':
        console.log(chalk.cyan('\n📦 nano-claude-code'));
        console.log(chalk.cyan('版本: 1.0.0'));
        console.log(chalk.cyan('描述: coding agent'));
        break;
      case 'exit':
        console.log(chalk.gray('\n👋 再见!'));
        break;
    }
  });

program
  .command('ask')
  .description('问答模式 - 使用 AI Agent 回答问题')
  .argument('[question]', '你想问的问题')
  .action(async (question) => {
    // 如果没有提供问题参数，交互式询问
    if (!question) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'question',
          message: '你想问什么:',
        }
      ]);
      question = answers.question;
    }

    console.log(chalk.magenta(`\n🤔 问题: ${question}\n`));

    try {
      const agent = createAgent();
      const response = await agent.run(question);
      console.log(chalk.green('\n🤖 回答:'));
      console.log(response);
    } catch (error) {
      console.error(chalk.red('\n❌ 出错了:'), error);
      process.exit(1);
    }
  });

// 如果没有提供命令，显示帮助信息
if (process.argv.length === 2) {
  program.help();
}

program.parse();
