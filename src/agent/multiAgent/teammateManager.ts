import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { MessageBus } from "./messageBus.js";
import { TOOLS } from "../tools/schemas.js";
import { runBash } from "../tools/bash.js";
import { runRead, runWrite, runEdit } from "../tools/file.js";

export type TeammateStatus = "working" | "idle" | "shutdown";

export interface TeamMember {
  name: string;
  role: string;
  status: TeammateStatus;
}

interface TeamConfig {
  teamName: string;
  members: TeamMember[];
}

/**
 * TeammateManager — 持久化命名 Agent 的注册与管理
 *
 * 每个 teammate 运行在独立的 Promise 链（模拟线程），
 * 通过 MessageBus JSONL 收件箱通信。
 * config.json 记录所有 member 状态，可跨会话恢复。
 */
export class TeammateManager {
  private configPath: string;
  private config: TeamConfig;
  private activeLoops: Map<string, Promise<void>> = new Map();

  constructor(
    private teamDir: string,
    private bus: MessageBus,
    private client: Anthropic,
    private model: string,
  ) {
    this.configPath = path.join(teamDir, "config.json");
    this.config = this.loadConfig();
  }

  // ── Config persistence ──────────────────────────────────────────

  private loadConfig(): TeamConfig {
    if (fs.existsSync(this.configPath)) {
      return JSON.parse(fs.readFileSync(this.configPath, "utf8"));
    }
    return { teamName: "default", members: [] };
  }

  private saveConfig(): void {
    fs.mkdirSync(this.teamDir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
  }

  private findMember(name: string): TeamMember | undefined {
    return this.config.members.find((m) => m.name === name);
  }

  // ── Public API ───────────────────────────────────────────────────

  spawn(name: string, role: string, prompt: string): string {
    const existing = this.findMember(name);
    if (existing) {
      if (existing.status === "working") {
        return `Error: '${name}' is currently working`;
      }
      existing.status = "working";
      existing.role = role;
    } else {
      this.config.members.push({ name, role, status: "working" });
    }
    this.saveConfig();

    // 每次 spawn 启动一个独立的 async agent loop
    const loop = this.teammateLoop(name, role, prompt);
    this.activeLoops.set(name, loop);
    loop.catch(() => {}); // prevent unhandled rejection

    return `Spawned '${name}' (role: ${role})`;
  }

  listAll(): string {
    if (this.config.members.length === 0) return "No teammates.";
    const lines = [`Team: ${this.config.teamName}`];
    for (const m of this.config.members) {
      lines.push(`  ${m.name} (${m.role}): ${m.status}`);
    }
    return lines.join("\n");
  }

  memberNames(): string[] {
    return this.config.members.map((m) => m.name);
  }

  // ── Teammate loop (runs in background via Promise) ───────────────

  private async teammateLoop(
    name: string,
    role: string,
    initialPrompt: string,
  ): Promise<void> {
    const sysPrompt =
      `You are '${name}', role: ${role}. ` +
      `Use send_message to communicate with teammates. Complete your task.`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: initialPrompt },
    ];

    const tools = this.buildTeammateTools();

    for (let i = 0; i < 50; i++) {
      // drain inbox into conversation
      const inbox = this.bus.readInbox(name);
      for (const msg of inbox) {
        messages.push({ role: "user", content: JSON.stringify(msg) });
      }

      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({
          model: this.model,
          system: sysPrompt,
          messages,
          tools,
          max_tokens: 8000,
        });
      } catch {
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const output = await this.execTool(name, block.name, block.input as any);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });
      }
      messages.push({ role: "user", content: results });
    }

    const member = this.findMember(name);
    if (member && member.status !== "shutdown") {
      member.status = "idle";
      this.saveConfig();
    }
  }

  // ── Tool execution inside teammate ───────────────────────────────

  private async execTool(
    senderName: string,
    toolName: string,
    input: Record<string, any>,
  ): Promise<string> {
    switch (toolName) {
      case "bash":
        return runBash(input.command);
      case "read_file":
        return runRead(input.path, input.limit);
      case "write_file":
        return runWrite(input.path, input.content);
      case "edit_file":
        return runEdit(input.path, input.old_text, input.new_text);
      case "send_message":
        return this.bus.send(senderName, input.to, input.content, input.msg_type);
      case "read_inbox":
        return JSON.stringify(this.bus.readInbox(senderName), null, 2);
      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  private buildTeammateTools(): Anthropic.Tool[] {
    // teammates 使用 base 工具 + 通信工具
    const base = TOOLS.filter((t) =>
      ["bash", "read_file", "write_file", "edit_file"].includes(t.name),
    );

    const commTools: Anthropic.Tool[] = [
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
            },
          },
          required: ["to", "content"],
        },
      },
      {
        name: "read_inbox",
        description: "Read and drain your own inbox.",
        input_schema: { type: "object" as const, properties: {} },
      },
    ];

    return [...base, ...commTools];
  }
}
