import dotenv from 'dotenv';
dotenv.config({ override: true, quiet: true });
import type { AgentConfig } from '../agent/types';

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
  compact: {
    contextLimit: getEnvNumber('COMPACT_CONTEXT_LIMIT', 50000),
    keepRecentToolResults: getEnvNumber('COMPACT_KEEP_RECENT_TOOL_RESULTS', 3),
    persistThreshold: getEnvNumber('COMPACT_PERSIST_THRESHOLD', 30000),
    previewChars: getEnvNumber('COMPACT_PREVIEW_CHARS', 2000),
  },
};
