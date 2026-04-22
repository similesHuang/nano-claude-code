import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { BlackBoard, Stage } from "./blackboard.js";
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
 * 通过 BlackBoard 共享状态协调工作流。
 * stage 字段驱动生命周期：researching → coding → reviewing → done
 */
export class TeammateManager {
  private configPath: string;
  private config: TeamConfig;
  private activeLoops: Map<string, Promise<void>> = new Map();

  constructor(
    private teamDir: string,
    private board: BlackBoard,
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

  findMember(name: string): TeamMember | undefined {
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

    const loop = this.teammateLoop(name, role, prompt);
    this.activeLoops.set(name, loop);
    loop.catch(() => {});

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

  // ── Teammate loop (stage-driven, no inbox polling) ────────────────

  private async teammateLoop(
    name: string,
    role: string,
    initialPrompt: string,
  ): Promise<void> {
    const sysPrompt =
      `You are '${name}', role: ${role}. ` +
      `Monitor the BlackBoard stage to know when to act. ` +
      `Use read_board to check current state. ` +
      `Use write_board to update artifacts. ` +
      `When stage reaches 'done', your work is complete — stop making tool calls.`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: initialPrompt },
    ];

    const tools = this.buildTeammateTools();

    while (true) {
      // 检查 stage 是否已结束
      const stage = this.board.peekStage();
      if (stage === "done") {
        break;
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

      if (response.stop_reason !== "tool_use") {
        // 模型正常结束（无 tool_use），检查是否该退出
        const finalStage = this.board.peekStage();
        if (finalStage === "done" || finalStage === undefined) {
          break;
        }
        continue;
      }

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
    _senderName: string,
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
      case "read_board":
        return JSON.stringify(this.board.read(), null, 2);
      case "write_board":
        return JSON.stringify(this.board.write(input.board), null, 2);
      case "advance_stage": {
        const current = this.board.peekStage();
        const next = input.next_stage as Stage;
        const ok = this.board.compareAndSwapStage(current, next);
        return JSON.stringify({ success: ok, stage: next });
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  private buildTeammateTools(): Anthropic.Tool[] {
    const base = TOOLS.filter((t) =>
      ["bash", "read_file", "write_file", "edit_file"].includes(t.name),
    );

    const boardTools: Anthropic.Tool[] = [
      {
        name: "read_board",
        description: "Read the current BlackBoard state (stage, artifacts, messages).",
        input_schema: { type: "object" as const, properties: {} },
      },
      {
        name: "write_board",
        description: "Write the full BlackBoard state.",
        input_schema: {
          type: "object" as const,
          properties: {
            board: {
              type: "object",
              description: "Complete BlackBoard object to write",
            },
          },
          required: ["board"],
        },
      },
      {
        name: "advance_stage",
        description: "Atomically advance the board stage (only if current stage matches expected).",
        input_schema: {
          type: "object" as const,
          properties: {
            next_stage: {
              type: "string",
              enum: ["researching", "coding", "reviewing", "done"],
              description: "The stage to advance to",
            },
          },
          required: ["next_stage"],
        },
      },
    ];

    return [...base, ...boardTools];
  }
}