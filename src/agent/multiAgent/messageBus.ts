import * as fs from "fs";
import * as path from "path";

export type MessageType =
  | "message"
  | "broadcast"
  | "shutdown_request"
  | "shutdown_response";

export interface TeamMessage {
  type: MessageType;
  from: string;
  content: string;
  timestamp: number;
  [key: string]: any;
}

/**
 * MessageBus — JSONL 文件收件箱
 *
 * 每个 teammate 对应一个 <name>.jsonl 文件。
 * send() 追加写入，read_inbox() 读取并清空（drain）。
 */
export class MessageBus {
  constructor(private inboxDir: string) {
    fs.mkdirSync(inboxDir, { recursive: true });
  }

  send(
    sender: string,
    to: string,
    content: string,
    type: MessageType = "message",
  ): string {
    const msg: TeamMessage = {
      type,
      from: sender,
      content,
      timestamp: Date.now(),
    };
    const file = path.join(this.inboxDir, `${to}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(msg) + "\n", "utf8");
    return `Sent ${type} to ${to}`;
  }

  readInbox(name: string): TeamMessage[] {
    const file = path.join(this.inboxDir, `${name}.jsonl`);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    const messages = lines.map((l) => JSON.parse(l) as TeamMessage);
    fs.writeFileSync(file, "", "utf8"); // drain
    return messages;
  }

  broadcast(sender: string, content: string, names: string[]): string {
    let count = 0;
    for (const name of names) {
      if (name !== sender) {
        this.send(sender, name, content, "broadcast");
        count++;
      }
    }
    return `Broadcast to ${count} teammates`;
  }
}
