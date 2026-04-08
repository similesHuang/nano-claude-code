import { runBash } from "./bash";
import { runRead, runWrite, runEdit } from "./file";
import { todoManager, skillsSystem } from "../scheduler";
import Anthropic from "@anthropic-ai/sdk";


/**
 * task 工具定义 - 只在主代理中注册
 */
export const TASK_TOOL: Anthropic.Tool = {
  name: "task",
  description: "Spawn a subagent with fresh context to handle a subtask. The subagent shares the filesystem but has its own isolated conversation history. Use this to delegate complex or independent subtasks.",
  input_schema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        description: "The task description for the subagent",
      },
      description: {
        type: "string",
        description: "Brief description of the subtask",
      },
    },
    required: ["prompt"],
  },
};

/**
 * 工具定义数组 - Anthropic API 格式
 * 一眼看到所有可用工具
 */
export const TOOLS = [
  {
    name: "bash",
    description: "Run a shell command. Use this to interact with the system, files, and execute programs.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file from the filesystem.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The path to the file to read",
        },
        limit: {
          type: "integer",
          description: "Optional: Limit output to first N lines",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The path where to write the file",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace exact text in a file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The path to the file to edit",
        },
        old_text: {
          type: "string",
          description: "The exact text to find and replace",
        },
        new_text: {
          type: "string",
          description: "The new text to replace with",
        },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "todo",
    description: "Update task list. Track progress on multi-step tasks. Mark in_progress before starting, completed when done.",
    input_schema: {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          description: "Array of todo items",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique identifier for the task" },
              text: { type: "string", description: "Task description" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Task status: pending (not started), in_progress (currently working on), completed (done)",
              },
            },
            required: ["id", "text", "status"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "load_skill",
    description: "Load the full body of a named skill into the current context. Use this when a task needs specialized instructions before you act.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The name of the skill to load",
        },
      },
      required: ["name"],
    },
  },
];

/**
 * Dispatch Map - 工具名称到处理函数的映射
 * 清晰展示所有工具的路由关系
 */
const TOOL_HANDLERS: Record<
  string,
  (input: any) => Promise<string>
> = {
  bash: (input) => runBash(input.command),
  read_file: (input) => runRead(input.path, input.limit),
  write_file: (input) => runWrite(input.path, input.content),
  edit_file: (input) => runEdit(input.path, input.old_text, input.new_text),
  todo: (input) => Promise.resolve(todoManager.update(input.items)),
  load_skill: (input) => Promise.resolve(skillsSystem.loadSkill(input.name)),
};

/**
 * 执行工具调用
 */
export async function executeTool(
  name: string,
  input: any,
): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  
  if (!handler) {
    return `Error: Unknown tool '${name}'`;
  }
  
  try {
    return await handler(input);
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}
