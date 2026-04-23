import chalk from "chalk";
import readline from "readline";
import { ReadlineEditor } from "./editor";
import { Renderer } from "./renderer";
import { CommandRegistry } from "./commands";

/**
 * InputHandler - 终端输入处理
 *
 * 职责：
 *  - 管理 raw mode keypress
 *  - 驱动 ReadlineEditor 编辑状态
 *  - 驱动 / 命令补全提示 UI
 *  - 返回用户提交的输入文本
 *
 * 不感知 agent、权限、回调等上层逻辑
 */
export class InputHandler {
  private editor = new ReadlineEditor();
  private renderer: Renderer;
  private commands: CommandRegistry;
  private prompt: string;

  // 命令补全状态
  private hintMatches: Array<{ name: string; description: string }> = [];
  private hintIndex = 0;
  private prevHintCount = 0; // 上一次渲染的提示行数，用于清除

  constructor(renderer: Renderer, commands: CommandRegistry, prompt?: string) {
    this.renderer = renderer;
    this.commands = commands;
    this.prompt = prompt ?? renderer.c("primary")(">") + " ";
  }

  /**
   * 注册全局按键监听（用于 Escape 等特殊按键）
   */
  onKeypress(handler: (str: string | undefined, key: any) => void): void {
    process.stdin.on("keypress", handler);
  }

  /**
   * 初始化终端 raw mode 和 keypress 事件
   */
  setupTerminal() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }
    readline.emitKeypressEvents(process.stdin);
  }

  /**
   * 等待一次用户输入提交（Enter 键）
   * 返回 trimmed 文本
   */
  waitForInput(): Promise<string> {
    this.editor.clear();
    this.clearHints();
    this.renderLine();

    return new Promise<string>((resolve) => {
      const onKeypress = (str: string | undefined, key: any) => {
        if (str === undefined && !key?.name) return;

        // Ctrl+C → 退出
        if (key.ctrl && key.name === "c") {
          process.stdin.removeListener("keypress", onKeypress);
          this.clearHints();
          // 清除终端显示的 ^C 并换行
          process.stdout.write("\r\x1b[2K\x1b[J\n");
          resolve("\x03"); // 特殊退出信号
          return;
        }

        // Enter（非 Shift）→ 提交
        const isEnter = key.name === "enter" || key.name === "return" || str === "\r";
        if (isEnter && !key.shift) {
          process.stdin.removeListener("keypress", onKeypress);

          // 如果有补全正在选中，先填充命令名
          if (this.hintMatches.length > 0 && this.hintIndex >= 0) {
            const selected = this.hintMatches[this.hintIndex];
            if (selected) {
              this.editor.clear();
              for (const ch of selected.name) this.editor.insert(ch);
            }
          }

          this.clearHints();
          this.renderer.print(""); // 换行
          const value = this.editor.getValue().trim();

          // 记录历史
          if (value) this.editor.pushHistory(this.editor.getValue());

          resolve(value);
          return;
        }

        // Tab → 接受当前补全选中项
        if (key.name === "tab" && this.hintMatches.length > 0) {
          const selected = this.hintMatches[this.hintIndex];
          if (selected) {
            this.editor.clear();
            for (const ch of (selected.name + " ")) this.editor.insert(ch);
            this.clearHints();
            this.renderLine();
          }
          return;
        }

        // 补全菜单中 ↑↓ 切换选中项
        if (this.hintMatches.length > 0) {
          if (key.name === "up") {
            this.hintIndex = (this.hintIndex - 1 + this.hintMatches.length) % this.hintMatches.length;
            this.renderWithHints();
            return;
          }
          if (key.name === "down") {
            this.hintIndex = (this.hintIndex + 1) % this.hintMatches.length;
            this.renderWithHints();
            return;
          }
        }

        // Escape → 关闭补全
        if (key.name === "escape") {
          this.clearHints();
          this.renderLine();
          return;
        }

        // 常规编辑操作
        this.handleEdit(str, key);

        // 编辑后更新补全提示
        this.updateHints();
        this.renderWithHints();
      };

      process.stdin.on("keypress", onKeypress);
    });
  }

  /**
   * 等待单键输入（用于权限确认等场景）
   */
  waitForKey(validKeys: string[]): Promise<string> {
    return new Promise<string>((resolve) => {
      const onKeypress = (str: string | undefined) => {
        if (!str) return;
        const ch = str.toLowerCase();
        if (validKeys.includes(ch)) {
          process.stdin.removeListener("keypress", onKeypress);
          resolve(ch);
        }
      };
      process.stdin.on("keypress", onKeypress);
    });
  }

  // -- 私有方法 --

  private handleEdit(str: string | undefined, key: any) {
    // Ctrl+U → 清空
    if (key.ctrl && key.name === "u") {
      this.editor.clear();
      return;
    }

    // Ctrl+L → 清屏
    if (key.ctrl && key.name === "l") {
      process.stdout.write("\x1b[2J");
      this.renderer.print("");
      return;
    }

    // Ctrl+A → 行首
    if (key.ctrl && key.name === "a") {
      this.editor.moveToStart();
      return;
    }

    // Ctrl+E → 行尾
    if (key.ctrl && key.name === "e") {
      this.editor.moveToEnd();
      return;
    }

    // 历史（仅在无补全时）
    if (this.hintMatches.length === 0) {
      if (key.name === "up") {
        const prev = this.editor.prevHistory();
        if (prev !== null) {
          this.editor.clear();
          for (const ch of prev) this.editor.insert(ch);
        }
        return;
      }
      if (key.name === "down") {
        const next = this.editor.nextHistory();
        if (next !== null) {
          this.editor.clear();
          for (const ch of next) this.editor.insert(ch);
        }
        return;
      }
    }

    // 方向键
    if (key.name === "left") { this.editor.moveCursorLeft(); return; }
    if (key.name === "right") { this.editor.moveCursorRight(); return; }

    // 删除
    if (key.name === "backspace") { this.editor.delete(); return; }
    if (key.name === "delete") { this.editor.deleteForward(); return; }

    // Shift+Enter → 换行
    if (key.shift && (key.name === "enter" || key.name === "return")) {
      this.editor.insert("\n");
      return;
    }

    // 普通字符
    if (str && !key.ctrl && !key.meta) {
      this.editor.insert(str);
    }
  }

  private updateHints() {
    const buf = this.editor.getValue();
    if (buf.startsWith("/") && !buf.includes(" ")) {
      this.hintMatches = this.commands.getCompletions(buf);
      this.hintIndex = 0;
    } else {
      this.hintMatches = [];
      this.hintIndex = 0;
    }
  }

  private renderLine() {
    const buf = this.editor.getValue();
    const cursor = this.editor.getCursorPos();
    const before = buf.slice(0, cursor);
    const after = buf.slice(cursor);
    const neutral = this.renderer.c("neutral");
    process.stdout.write(`\r\x1b[2K${this.prompt}${neutral(before)}${chalk.dim(after)}`);
  }

  private renderWithHints() {
    if (this.hintMatches.length > 0) {
      this.renderer.commandHints(
        this.hintMatches,
        this.hintIndex,
        this.editor.getValue(),
        this.prompt,
      );
      this.prevHintCount = this.hintMatches.length;
    } else {
      this.clearHints();
      this.renderLine();
    }
  }

  private clearHints() {
    if (this.prevHintCount > 0) {
      this.renderer.clearHints(this.prevHintCount);
      this.prevHintCount = 0;
    }
    this.hintMatches = [];
    this.hintIndex = 0;
  }
}
