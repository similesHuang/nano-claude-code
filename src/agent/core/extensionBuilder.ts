import * as path from "path";
import { PATHS } from "../../config/paths.js";
import type { AgentConfig } from "./types.js";
import { CompactSystem, PermissionManager, HookManager, MemorySystem, DreamConsolidator, SkillsSystem, ErrorRecovery, SystemPromptBuilder } from "../extensions/index.js";
import { TaskManager } from "../runtime/taskManager.js";
import { AsyncTask } from "../runtime/asyncTask.js";
import { ToolRegistry } from "../tools/index.js";
import { ToolPipeline } from "../toolPipeline.js";
import type { AgentCallbacks } from "./types.js";

/**
 * Extensions - Agent 的能力扩展容器
 */
export interface Extensions {
  compactSystem: CompactSystem;
  permissionManager: PermissionManager;
  hookManager: HookManager;
  memorySystem: MemorySystem;
  dreamConsolidator: DreamConsolidator;
  promptBuilder: SystemPromptBuilder;
  errorRecovery: ErrorRecovery;
  taskManager: TaskManager;
  asyncTask: AsyncTask;
  skillsSystem: SkillsSystem;
  toolRegistry: ToolRegistry;
  toolPipeline: ToolPipeline;
}

/**
 * ExtensionBuilder - Agent 能力扩展的创建封装
 */
export class ExtensionBuilder {
  build(config: AgentConfig, callbacks: AgentCallbacks): Extensions {
    const compactSystem = new CompactSystem(PATHS.dataDir, config.compact);
    const permissionManager = new PermissionManager(config.permissionMode ?? "default");
    const hookManager = new HookManager();

    const teamMemoryDir = PATHS.teamMemory(process.cwd());
    const memorySystem = new MemorySystem(teamMemoryDir, PATHS.privateMemory);
    const dreamConsolidator = new DreamConsolidator(teamMemoryDir, PATHS.privateMemory);

    const taskManager = new TaskManager(path.join(PATHS.taskDir));
    const skillsSystem = new SkillsSystem(PATHS.globalSkills, PATHS.projectSkills(process.cwd()));
    const asyncTask = new AsyncTask(process.cwd(), PATHS.backendTaskDir);

    const subAgentFactory = async (prompt: string) => {
      const { SubAgent } = await import("../extensions/subAgent/index.js");
      const subAgent = new SubAgent({
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        workdir: process.cwd(),
      });
      return subAgent.execute(prompt);
    };

    const toolRegistry = new ToolRegistry({
      taskManager,
      skillsSystem,
      memorySystem,
      asyncTask,
      subAgentFactory,
    });

    const toolPipeline = new ToolPipeline(
      toolRegistry,
      permissionManager,
      hookManager,
      compactSystem,
      callbacks,
    );

    const promptBuilder = new SystemPromptBuilder({
      memorySystem,
      skillsSystem,
    });
    const errorRecovery = new ErrorRecovery();

    return {
      compactSystem,
      permissionManager,
      hookManager,
      memorySystem,
      dreamConsolidator,
      promptBuilder,
      errorRecovery,
      taskManager,
      asyncTask,
      skillsSystem,
      toolRegistry,
      toolPipeline,
    };
  }
}