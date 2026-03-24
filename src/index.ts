#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';

const program = new Command();

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
  .command('interactive')
  .alias('i')
  .description('进入交互模式')
  .action(async () => {
    console.log(chalk.blue('🤖 进入交互模式\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: '请输入你的名字:',
        default: '开发者'
      },
      {
        type: 'list',
        name: 'action',
        message: '选择你要执行的操作:',
        choices: [
          { name: '查看项目信息', value: 'info' },
          { name: '运行代码检查', value: 'lint' },
          { name: '退出', value: 'exit' }
        ]
      }
    ]);

    console.log(chalk.yellow(`\n你好, ${answers.name}!`));

    switch (answers.action) {
      case 'info':
        console.log(chalk.cyan('\n📦 nano-claude-code'));
        console.log(chalk.cyan('版本: 1.0.0'));
        console.log(chalk.cyan('描述: coding agent'));
        break;
      case 'lint':
        console.log(chalk.green('\n✅ 代码检查完成，没有发现错误!'));
        break;
      case 'exit':
        console.log(chalk.gray('\n👋 再见!'));
        break;
    }
  });

program
  .command('ask')
  .description('问答模式')
  .action(async () => {
    const { question } = await inquirer.prompt([
      {
        type: 'input',
        name: 'question',
        message: '你想问什么:',
      }
    ]);

    console.log(chalk.magenta(`\n🤔 你问的是: ${question}`));
    console.log(chalk.cyan('💡 这是一个示例回答，实际项目中可以接入 AI API'));
  });

// 如果没有提供命令，显示帮助信息
if (process.argv.length === 2) {
  program.help();
}

program.parse();
