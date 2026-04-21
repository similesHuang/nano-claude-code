import type Anthropic from "@anthropic-ai/sdk";
/**
 * 多 Agent 团队工具定义 - 只在主代理（lead）中注册
 */
export const TEAM_TOOLS: Anthropic.Tool[] = [
  {
    name: "spawn_teammate",
    description:
      "Spawn a persistent named teammate that runs its own agent loop in the background. " +
      "Teammates share the filesystem but have isolated conversation histories. " +
      "Use this to delegate long-running or parallel subtasks. " +
      "Results are delivered via read_inbox().",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Unique teammate name (e.g. 'alice', 'coder')" },
        role: { type: "string", description: "Teammate role description (e.g. 'senior coder')" },
        prompt: { type: "string", description: "Initial task prompt for the teammate" },
      },
      required: ["name", "role", "prompt"],
    },
  },
  {
    name: "list_teammates",
    description: "List all teammates with their name, role, and current status.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "send_message",
    description: "Send a message to a teammate's inbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Teammate name" },
        content: { type: "string", description: "Message content" },
        msg_type: {
          type: "string",
          enum: ["message", "broadcast", "shutdown_request", "shutdown_response"],
          description: "Message type",
        },
      },
      required: ["to", "content"],
    },
  },
  {
    name: "read_inbox",
    description: "Read and drain the lead's own inbox (messages from teammates).",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "broadcast",
    description: "Send a message to all teammates simultaneously.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Message to broadcast" },
      },
      required: ["content"],
    },
  },
];


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
