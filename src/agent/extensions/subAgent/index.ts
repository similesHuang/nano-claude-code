import { AgentLoop } from "../../core/loop.js";
import type { AgentConfig, AgentOptions } from "../../core/types.js";
import { TOOLS } from "../../tools/schemas.js";

const MAX_SUB_AGENT_ITERATIONS = 30;

const SUB_AGENT_TOOL_NAMES = ["bash", "read_file", "write_file", "edit_file"] as const;

function buildSubAgentTools() {
  return TOOLS.filter((tool) => SUB_AGENT_TOOL_NAMES.includes(tool.name as (typeof SUB_AGENT_TOOL_NAMES)[number]));
}

/**
 * SubAgentConfig
 */
export interface SubAgentConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  maxIterations?: number;
  workdir: string;
}

/**
 * SubAgent - 子代理，享有独立上下文
 *
 * 复用 AgentLoop 核心循环，自定义：
 * - 过滤后的工具集（无 task_*，禁止递归 spawn）
 * - 独立的 system prompt，指示其完成并总结
 * - fresh messages=[] 实现上下文隔离
 * - 只返回最终文本摘要，上下文随子代理销毁
 *
 *          主代理                          子代理
 *   +------------------+           +-----------------+
 *   | messages=[...]   |  dispatch | messages=[]     |  <-- fresh
 *   |                  |  -------> |                 |
 *   | tool: task       |           | loop + filtered  |
 *   |   prompt="..."   |           | tools            |
 *   |   description="" |           |                 |
 *   |                  |  summary  | return last text |
 *   |   result = "..." | <-------- |                 |
 *   +------------------+           +-----------------+
 */
export class SubAgent {
  private readonly agentLoop: AgentLoop;

  constructor(config: SubAgentConfig) {
    const agentConfig: AgentConfig = {
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      maxTokens: config.maxTokens || 8000,
      temperature: config.temperature ?? 0.7,
      maxIterations: config.maxIterations || MAX_SUB_AGENT_ITERATIONS,
    };

    const options: AgentOptions = {
      tools: buildSubAgentTools(),
    };

    this.agentLoop = new AgentLoop(agentConfig, {
      onError: (error) => {
        console.error(`[subAgent] Error: ${error.message}`);
      },
    }, options);
  }

  /**
   * 执行子代理任务
   * @param prompt 主代理下发的任务描述
   * @returns 摘要（最后文本内容）返回给主代理
   */
  async execute(prompt: string): Promise<string> {
    const system = [
      "You are a coding subagent. Complete the given task, then summarize your findings.",
      `Workdir: ${process.cwd()}`,
      "You only have file system tools (no task, memory, or background tools).",
      "When done, return a concise summary of what you found and did.",
    ].join("\n");

    return this.agentLoop.subAgentRun(prompt, system);
  }
}
