import dotenv from 'dotenv';
dotenv.config({ override: true });
import type { AgentConfig } from '../agent/types';
import chalk from 'chalk';

/**
 * Agent 配置
 * 从环境变量读取配置，并提供默认值
 */
export const agentConfig: AgentConfig = {
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
    onToolCall: (toolName: string) => {
      console.log(chalk.blue(`🔧 使用工具: ${toolName}`));
    },
    onError: (error: Error) => {
      console.error(chalk.red(`❌ 错误: ${error.message}`));
    },
  },
};
