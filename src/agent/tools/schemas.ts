import type Anthropic from "@anthropic-ai/sdk";
/**
 * subagent 工具定义 - 只在主代理中注册
 */
export const SUBAGENT_TOOL: Anthropic.Tool = {
  name: "subagent",
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
    name: "task_create",
    description: "Create a persistent task that survives context compression and persists across sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        subject: { type: "string", description: "Brief task title" },
        description: { type: "string", description: "Detailed task description" },
      },
      required: ["subject"],
    },
  },
  {
    name: "task_update",
    description: "Update a task's status, owner, or dependencies. Completed tasks are automatically removed from other tasks' blockedBy lists.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "integer", description: "ID of the task to update" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "deleted"],
          description: "New status for the task",
        },
        owner: { type: "string", description: "Set when a teammate claims the task" },
        addBlockedBy: {
          type: "array",
          items: { type: "integer" },
          description: "Task IDs that must complete before this task can start",
        },
        addBlocks: {
          type: "array",
          items: { type: "integer" },
          description: "Task IDs that this task blocks (bidirectional: also updates their blockedBy)",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "task_list",
    description: "List all tasks with status summary and dependency info.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "task_get",
    description: "Get full details of a task by ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "integer", description: "ID of the task to retrieve" },
      },
      required: ["task_id"],
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
    name: "background_run",
    description: "Run a command in a background thread. Returns [bg:taskId] immediately — after this tool result, immediately call check_background with that task_id (in the same response turn) to get the full output. Do NOT return the task_id to the user and move on; you MUST follow up to retrieve results.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to run in background",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "check_background",
    description: "Check background task result. Pass the task_id from background_run to get full stdout/stderr. If task is still running, you will see [running] — wait and check again. Always check immediately after background_run returns.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: {
          type: "string",
          description: "Task ID from background_run (e.g. b8jtqmv1). Omit to list all running tasks.",
        },
      },
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
