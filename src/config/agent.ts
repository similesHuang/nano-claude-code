import dotenv from "dotenv";
dotenv.config({ override: true, quiet: true });

import { loadConfigFile } from "../uitls";
export interface Config {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  maxIterations?: number;
  compact?: {
    contextLimit:number;
    keepRecentToolResults:number;
    persistThreshold:number;
    previewChars:number;
  };
}
function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const getAgentConfig = (): Config => {
  const useEnv =
    process.env.CLAUDE_MODEL &&
    process.env.ANTHROPIC_API_KEY &&
    process.env.ANTHROPIC_BASE_URL;

  if (useEnv) {
    return {
      model: process.env.CLAUDE_MODEL,
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      maxTokens: getEnvNumber("CLAUDE_MAX_TOKENS", 8000),
      temperature: getEnvNumber("CLAUDE_TEMPERATURE", 0.7),
      maxIterations: getEnvNumber("CLAUDE_MAX_ITERATIONS", 50),
    };
  }

  const fileConfig = loadConfigFile();
  return {
    model: fileConfig.model,
    apiKey: fileConfig.apiKey,
    baseUrl: fileConfig.baseUrl,
    maxTokens: getEnvNumber("CLAUDE_MAX_TOKENS", 8000),
    temperature: getEnvNumber("CLAUDE_TEMPERATURE", 0.7),
    maxIterations: getEnvNumber("CLAUDE_MAX_ITERATIONS", 50),
  };
};

export const getCompactConfig = () => {
   return  {
      contextLimit: getEnvNumber("COMPACT_CONTEXT_LIMIT", 50000),
      keepRecentToolResults: getEnvNumber(
        "COMPACT_KEEP_RECENT_TOOL_RESULTS",
        3,
      ),
      persistThreshold: getEnvNumber("COMPACT_PERSIST_THRESHOLD", 30000),
      previewChars: getEnvNumber("COMPACT_PREVIEW_CHARS", 2000),
    };
}