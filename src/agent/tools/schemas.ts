import type Anthropic from "@anthropic-ai/sdk";

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
export const TOOLS: Anthropic.Tool[] = [
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
    description: "Manage a structured todo list to plan and track multi-step tasks.\n\nWorkflow:\n1. PLAN FIRST: When receiving a complex task, immediately create a todo list with ALL steps as 'pending'.\n2. EXECUTE IN ORDER: Before starting each step, mark it 'in_progress' (only ONE at a time).\n3. MARK DONE: After completing a step, mark it 'completed' immediately, then move to the next.\n\nDo NOT create a todo with items already marked as completed. Always plan first, then execute step by step.",
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
    name: "compact",
    description: "Summarize earlier conversation so work can continue in a smaller context.",
    input_schema: {
      type: "object" as const,
      properties: {
        focus: {
          type: "string",
          description: "Optional focus to preserve in the summary",
        },
      },
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
  {
    name: "save_memory",
    description: "Save a persistent memory that survives across sessions. Use for: user preferences, confirmed good practices, repeated corrections, non-obvious project facts, external resource pointers. Do NOT use for: code structure derivable from the repo, temporary task state (current branch, this week's PRs), secrets/credentials.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Short identifier (e.g. prefer_tabs, db_schema)",
        },
        description: {
          type: "string",
          description: "One-line summary of what this memory captures",
        },
        type: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "user=preferences, feedback=corrections or confirmed good practices, project=non-obvious project facts, reference=external resource pointers",
        },
        content: {
          type: "string",
          description: "Full memory content (multi-line OK). Must be a long-lasting insight, not ephemeral state.",
        },
        scope: {
          type: "string",
          enum: ["private", "team"],
          description: "private=only this user/agent, team=shared across the project team. Defaults: user/feedback->private, project/reference->team",
        },
        sentiment: {
          type: "string",
          enum: ["positive", "negative", "neutral"],
          description: "positive=confirmed good practice, negative=correction/mistake, neutral=factual. Default: neutral",
        },
      },
      required: ["name", "description", "type", "content"],
    },
  },
];
