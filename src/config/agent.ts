import dotenv from 'dotenv';
dotenv.config({ override: true });
import type { AgentConfig } from '../agent/types';

/**
 * Agent 配置
 * 从环境变量读取配置，并提供默认值
 */
export const agentConfig: AgentConfig = {
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  maxTokens: 8000,
  temperature: 0.7,
  maxIterations: 50,
};
