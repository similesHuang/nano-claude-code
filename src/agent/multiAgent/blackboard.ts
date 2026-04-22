import * as fs from "fs";
import * as path from "path";

export type Stage = "researching" | "coding" | "reviewing" | "done";

export interface ReviewReport {
  correctness: number;
  performance: number;
  readability: number;
  suggestions: string[];
}

export interface BlackBoardData {
  taskId: string;
  stage: Stage;
  artifacts: {
    research?: string;
    code?: string;
    codePath?: string;
    review?: ReviewReport;
  };
  messages: TeamMessage[];
  timestamp: number;
}

export interface TeamMessage {
  type: string;
  from: string;
  content: string;
  timestamp: number;
}

/**
 * BlackBoard — 共享任务状态的黑板
 *
 * 所有 agent 读写同一个 JSON 文件，
 * 通过 stage 字段驱动工作流，
 */
export class BlackBoard {
  private filePath: string;
  private _taskId: string;

  constructor(_boardDir: string, taskId: string) {
    fs.mkdirSync(_boardDir, { recursive: true });
    this._taskId = taskId;
    this.filePath = path.join(_boardDir, `${taskId}.json`);
    // 初始化空黑板
    if (!fs.existsSync(this.filePath)) {
      this.write(this.empty());
    }
  }

  read(): BlackBoardData {
    if (!fs.existsSync(this.filePath)) {
      return this.empty();
    }
    return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
  }

  write(board: BlackBoardData): void {
    board.timestamp = Date.now();
    fs.writeFileSync(this.filePath, JSON.stringify(board, null, 2), "utf8");
  }

  appendMessage(from: string, content: string): void {
    const board = this.read();
    board.messages.push({ type: "message", from, content, timestamp: Date.now() });
    this.write(board);
  }

  private empty(): BlackBoardData {
    return {
      taskId: this._taskId,
      stage: "researching",
      artifacts: {},
      messages: [],
      timestamp: Date.now(),
    };
  }

  // 读取后立即更新 stage（原子操作，防止竞态）
  compareAndSwapStage(
    expected: Stage,
    next: Stage,
  ): boolean {
    const board = this.read();
    if (board.stage !== expected) return false;
    board.stage = next;
    this.write(board);
    return true;
  }

  // 读 stage 但不修改（peek）
  peekStage(): Stage {
    const board = this.read();
    return board.stage;
  }

  get taskId(): string {
    return this._taskId;
  }
}