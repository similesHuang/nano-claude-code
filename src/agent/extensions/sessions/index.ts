import type Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import * as path from "path";

/**
 * 会话元数据
 */
export interface SessionMeta {
  label: string;
  created_at: string;
  last_active: string;
  message_count: number;
}

/**
 * JSONL 记录类型
 */
interface TranscriptRecord {
  type: "user" | "assistant" | "tool_use" | "tool_result";
  content?: any;
  tool_use_id?: string;
  name?: string;
  input?: any;
  ts: number;
}

/**
 * SessionStore -- 基于 JSONL 的会话持久化
 *
 * 写入时追加 (append), 读取时重放 (replay)。
 * 每个会话对应一个 .jsonl 文件，索引文件跟踪元数据。
 */
export class SessionStore {
  private readonly baseDir: string;
  private readonly indexPath: string;
  private index: Record<string, SessionMeta> = {};
  currentSessionId: string | null = null;

  constructor(agentId: string, sessionsRoot: string) {
    this.baseDir = path.join(sessionsRoot, agentId, "sessions");
    this.indexPath = path.join(sessionsRoot, agentId, "sessions.json");
    this.index = this.loadIndexSync();
  }

  // ── 初始化 ─────────────────────────────────────────

  private loadIndexSync(): Record<string, SessionMeta> {
    try {
      if (fsSync.existsSync(this.indexPath)) {
        return JSON.parse(fsSync.readFileSync(this.indexPath, "utf-8"));
      }
    } catch {
      // ignore
    }
    return {};
  }

  private async saveIndex(): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(this.index, null, 2),
      "utf-8",
    );
  }

  private sessionPath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.jsonl`);
  }

  // ── 会话管理 ─────────────────────────────────────────

  async createSession(label = ""): Promise<string> {
    await fs.mkdir(this.baseDir, { recursive: true });

    const sessionId = this.generateId();
    const now = new Date().toISOString();

    this.index[sessionId] = {
      label,
      created_at: now,
      last_active: now,
      message_count: 0,
    };
    await this.saveIndex();

    // 创建空 JSONL 文件
    await fs.writeFile(this.sessionPath(sessionId), "", "utf-8");
    this.currentSessionId = sessionId;
    return sessionId;
  }

  /**
   * 从 JSONL 重建 API 格式的 messages[]
   */
  async loadSession(sessionId: string): Promise<Anthropic.MessageParam[]> {
    const filePath = this.sessionPath(sessionId);
    try {
      await fs.access(filePath);
    } catch {
      return [];
    }
    this.currentSessionId = sessionId;
    return this.rebuildHistory(filePath);
  }

  /**
   * 恢复最近的会话，如果没有则创建新会话
   */
  async resumeOrCreate(): Promise<{ sessionId: string; messages: Anthropic.MessageParam[] }> {
    const sessions = this.listSessions();
    if (sessions.length > 0) {
      const [sessionId] = sessions[0];
      const messages = await this.loadSession(sessionId);
      return { sessionId, messages };
    }
    const sessionId = await this.createSession("initial");
    return { sessionId, messages: [] };
  }

  // ── 写入 ──────────────────────────────────────────

  /**
   * 保存用户或助手消息
   */
  async saveTurn(role: "user" | "assistant", content: any): Promise<void> {
    if (!this.currentSessionId) return;
    await this.appendRecord({
      type: role,
      content,
      ts: Date.now(),
    });
  }

  /**
   * 保存工具调用和结果
   */
  async saveToolResult(
    toolUseId: string,
    name: string,
    toolInput: any,
    result: string,
  ): Promise<void> {
    if (!this.currentSessionId) return;
    const ts = Date.now();
    await this.appendRecord({
      type: "tool_use",
      tool_use_id: toolUseId,
      name,
      input: toolInput,
      ts,
    });
    await this.appendRecord({
      type: "tool_result",
      tool_use_id: toolUseId,
      content: result,
      ts,
    });
  }

  private async appendRecord(record: TranscriptRecord): Promise<void> {
    if (!this.currentSessionId) return;

    await fs.mkdir(this.baseDir, { recursive: true });
    const filePath = this.sessionPath(this.currentSessionId);
    await fs.appendFile(
      filePath,
      JSON.stringify(record) + "\n",
      "utf-8",
    );

    // 更新索引
    if (this.index[this.currentSessionId]) {
      this.index[this.currentSessionId].last_active = new Date().toISOString();
      this.index[this.currentSessionId].message_count += 1;
      await this.saveIndex();
    }
  }

  // ── 查询 ──────────────────────────────────────────

  listSessions(): [string, SessionMeta][] {
    return Object.entries(this.index).sort(
      (a, b) => (b[1].last_active || "").localeCompare(a[1].last_active || ""),
    );
  }

  // ── JSONL 重建 ────────────────────────────────────────

  /**
   * 从 JSONL 行重建 Anthropic API 格式的消息列表
   *
   * 规则:
   *   - user/assistant 消息交替
   *   - tool_use 块属于 assistant 消息
   *   - tool_result 块属于 user 消息
   */
  private async rebuildHistory(filePath: string): Promise<Anthropic.MessageParam[]> {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n");
    const messages: Anthropic.MessageParam[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      let record: TranscriptRecord;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.type === "user") {
        messages.push({ role: "user", content: record.content });
      } else if (record.type === "assistant") {
        let content = record.content;
        if (typeof content === "string") {
          content = [{ type: "text" as const, text: content }];
        }
        messages.push({ role: "assistant", content });
      } else if (record.type === "tool_use") {
        const block = {
          type: "tool_use" as const,
          id: record.tool_use_id!,
          name: record.name!,
          input: record.input,
        };
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant" && Array.isArray(last.content)) {
          (last.content as any[]).push(block);
        } else {
          messages.push({ role: "assistant", content: [block] });
        }
      } else if (record.type === "tool_result") {
        const resultBlock = {
          type: "tool_result" as const,
          tool_use_id: record.tool_use_id!,
          content: record.content,
        };
        const last = messages[messages.length - 1];
        if (
          last &&
          last.role === "user" &&
          Array.isArray(last.content) &&
          (last.content as any[])[0]?.type === "tool_result"
        ) {
          (last.content as any[]).push(resultBlock);
        } else {
          messages.push({ role: "user", content: [resultBlock] });
        }
      }
    }

    return messages;
  }

  // ── 工具函数 ──────────────────────────────────────────

  private generateId(): string {
    const hex = () => Math.random().toString(16).slice(2, 8);
    return hex() + hex();
  }
}
