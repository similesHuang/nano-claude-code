import type Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import * as path from "path";
import type { CompactConfig } from "../types";

const DEFAULT_CONTEXT_LIMIT = 50000;
const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 3;
const DEFAULT_PERSIST_THRESHOLD = 30000;
const DEFAULT_PREVIEW_CHARS = 2000;

export class CompactSystem {
  private hasCompacted = false;
  private lastSummary = "";
  private recentFiles: string[] = [];
  private readonly dataDir: string;
  private readonly transcriptDir: string;
  private readonly toolResultsDir: string;
  private readonly contextLimit: number;
  private readonly keepRecentToolResults: number;
  private readonly persistThreshold: number;
  private readonly previewChars: number;

  constructor(dataDir: string, config: CompactConfig = {}) {
    this.dataDir = dataDir;
    this.transcriptDir = path.join(this.dataDir, "transcripts");
    this.toolResultsDir = path.join(this.dataDir, "tool-results");
    this.contextLimit = config.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
    this.keepRecentToolResults =
      config.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS;
    this.persistThreshold = config.persistThreshold ?? DEFAULT_PERSIST_THRESHOLD;
    this.previewChars = config.previewChars ?? DEFAULT_PREVIEW_CHARS;
  }

  estimateContextSize(messages: Anthropic.MessageParam[]): number {
    return JSON.stringify(messages).length;
  }

  shouldAutoCompact(messages: Anthropic.MessageParam[]): boolean {
    return this.estimateContextSize(messages) > this.contextLimit;
  }

  trackRecentFile(filePath: string): void {
    if (!filePath) return;

    const normalized = filePath.trim();
    if (!normalized) return;

    const existingIndex = this.recentFiles.indexOf(normalized);
    if (existingIndex >= 0) {
      this.recentFiles.splice(existingIndex, 1);
    }

    this.recentFiles.push(normalized);
    if (this.recentFiles.length > 5) {
      this.recentFiles = this.recentFiles.slice(-5);
    }
  }

  // 第一层：压缩大的tool结果，超过阈值则写磁盘并返回路径
  async persistLargeOutput(toolUseId: string, output: string): Promise<string> {
    if (output.length <= this.persistThreshold) {
      return output;
    }

    await fs.mkdir(this.toolResultsDir, { recursive: true });

    const safeId = toolUseId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const storedPath = path.join(this.toolResultsDir, `${safeId}.txt`);

    try {
      await fs.access(storedPath);
    } catch {
      await fs.writeFile(storedPath, output, "utf-8");
    }

    const preview = output.slice(0, this.previewChars);
    const relPath = path.relative(this.dataDir, storedPath);

    return [
      "<persisted-output>",
      `Full output cached at: ~/.nano-claude-code/${relPath}`,
      "Preview:",
      preview,
      "</persisted-output>",
    ].join("\n");
  }
  
  // 第二层：微压缩，只保留最近三个工具的结果
  microCompact(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    const toolResults: Array<{ messageIndex: number; blockIndex: number }> = [];

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const message = messages[messageIndex] as any;
      const content = message?.content;

      if (message?.role !== "user" || !Array.isArray(content)) {
        continue;
      }

      for (let blockIndex = 0; blockIndex < content.length; blockIndex++) {
        const block = content[blockIndex];
        if (block && typeof block === "object" && block.type === "tool_result") {
          toolResults.push({ messageIndex, blockIndex });
        }
      }
    }

    if (toolResults.length <= this.keepRecentToolResults) {
      return messages;
    }

    const targets = toolResults.slice(0, -this.keepRecentToolResults);

    for (const target of targets) {
      const message = messages[target.messageIndex] as any;
      const block = message?.content?.[target.blockIndex] as any;
      const content = block?.content;

      if (typeof content !== "string" || content.length <= 120) {
        continue;
      }

      block.content = "[Earlier tool result compacted. Re-run the tool if you need full detail.]";
    }

    return messages;
  }
  // 第三层：压缩历史对话
  async compactHistory(
    messages: Anthropic.MessageParam[],
    summarizeHistory: (messages: Anthropic.MessageParam[]) => Promise<string>,
    focus?: string,
  ): Promise<Anthropic.MessageParam[]> {
    const transcriptPath = await this.writeTranscript(messages);

    let summary = await summarizeHistory(messages);

    if (focus?.trim()) {
      summary += `\n\nFocus to preserve next: ${focus.trim()}`;
    }

    if (this.recentFiles.length > 0) {
      const recentLines = this.recentFiles.map((item) => `- ${item}`).join("\n");
      summary += `\n\nRecent files to reopen if needed:\n${recentLines}`;
    }

    summary += `\n\nFull transcript saved at: ${transcriptPath}`;

    this.hasCompacted = true;
    this.lastSummary = summary;
    return [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "This conversation was compacted so the agent can continue working.",
              "",
              summary,
            ].join("\n"),
          },
        ],
      },
    ];
  }

  getLastSummary(): string {
    return this.lastSummary;
  }

  hasCompactedOnce(): boolean {
    return this.hasCompacted;
  }

  private async writeTranscript(messages: Anthropic.MessageParam[]): Promise<string> {
    await fs.mkdir(this.transcriptDir, { recursive: true });
    const filePath = path.join(this.transcriptDir, `transcript_${Date.now()}.jsonl`);

    const lines = messages.map((message) => JSON.stringify(message));
    await fs.writeFile(filePath, lines.join("\n") + "\n", "utf-8");
    return filePath;
  }

  /**
   * 清理 tool-results 缓存目录
   */
  clearToolResults(): void {
    try {
      if (fsSync.existsSync(this.toolResultsDir)) {
        const files = fsSync.readdirSync(this.toolResultsDir);
        for (const file of files) {
          fsSync.unlinkSync(path.join(this.toolResultsDir, file));
        }
      }
    } catch {
      // ignore cache clear error
    }
  }
}
