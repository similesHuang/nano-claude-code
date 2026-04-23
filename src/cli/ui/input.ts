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
  private prevHintCount = 0;

  constructor(renderer: Renderer, commands: CommandRegistry, prompt?: string) {
    this.renderer = renderer;
    this.commands = commands;
    this.prompt = prompt ?? renderer.getColor("primary")(">") + " ";
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
  setupTerminal(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }
    readline.emitKeypressEvents(process.stdin);
  }

  /**
   * 等待一次用户输入提交（Enter 键）
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
          this.removeKeypressListener(onKeypress);
          this.clearHints();
          process.stdout.write("\r\x1b[2K\x1b[J\n");
          resolve("\x03");
          return;
        }

        // Enter（非 Shift）→ 提交
        if (this.isEnterKey(key) && !key.shift) {
          this.removeKeypressListener(onKeypress);
          this.acceptSelectedHint();
          this.clearHints();
          this.renderer.print("");

          const value = this.editor.getValue().trim();
          if (value) {
            this.editor.pushHistory(this.editor.getValue());
          }

          resolve(value);
          return;
        }

        // Tab → 接受当前补全选中项
        if (key.name === "tab" && this.hintMatches.length > 0) {
          this.acceptSelectedHint(true);
          this.clearHints();
          this.renderLine();
          return;
        }

        // 补全菜单中 ↑↓ 切换选中项
        if (this.hintMatches.length > 0 && this.handleHintNavigation(key)) {
          return;
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
        const key = str.toLowerCase();
        if (validKeys.includes(key)) {
          this.removeKeypressListener(onKeypress);
          resolve(key);
        }
      };
      process.stdin.on("keypress", onKeypress);
    });
  }

  // ── 私有辅助方法 ────────────────────────────────────

  private removeKeypressListener(listener: (...args: any[]) => void): void {
    process.stdin.removeListener("keypress", listener);
  }

  private isEnterKey(key: any): boolean {
    return key.name === "enter" || key.name === "return";
  }

  private acceptSelectedHint(addSpace = false): void {
    if (this.hintMatches.length > 0 && this.hintIndex >= 0) {
      const selected = this.hintMatches[this.hintIndex];
      if (selected) {
        this.replaceEditorContent(selected.name + (addSpace ? " " : ""));
      }
    }
  }

  private replaceEditorContent(text: string): void {
    this.editor.clear();
    for (const char of text) {
      this.editor.insert(char);
    }
  }

  private handleHintNavigation(key: any): boolean {
    if (key.name === "up") {
      this.hintIndex = (this.hintIndex - 1 + this.hintMatches.length) % this.hintMatches.length;
      this.renderWithHints();
      return true;
    }
    if (key.name === "down") {
      this.hintIndex = (this.hintIndex + 1) % this.hintMatches.length;
      this.renderWithHints();
      return true;
    }
    return false;
  }

  private handleEdit(str: string | undefined, key: any): void {
    // 快捷键处理
    if (key.ctrl) {
      this.handleCtrlKey(key);
      return;
    }

    // 历史导航（仅在无补全时）
    if (this.hintMatches.length === 0 && this.handleHistoryNavigation(key)) {
      return;
    }

    // 方向键
    if (key.name === "left") {
      this.editor.moveCursorLeft();
      return;
    }
    if (key.name === "right") {
      this.editor.moveCursorRight();
      return;
    }

    // 删除
    if (key.name === "backspace") {
      this.editor.delete();
      return;
    }
    if (key.name === "delete") {
      this.editor.deleteForward();
      return;
    }

    // Shift+Enter → 换行
    if (key.shift && this.isEnterKey(key)) {
      this.editor.insert("\n");
      return;
    }

    // 普通字符
    if (str && !key.meta) {
      this.editor.insert(str);
    }
  }

  private handleCtrlKey(key: any): void {
    switch (key.name) {
      case "u":
        this.editor.clear();
        break;
      case "l":
        process.stdout.write("\x1b[2J");
        this.renderer.print("");
        break;
      case "a":
        this.editor.moveToStart();
        break;
      case "e":
        this.editor.moveToEnd();
        break;
    }
  }

  private handleHistoryNavigation(key: any): boolean {
    if (key.name === "up") {
      const prev = this.editor.prevHistory();
      if (prev !== null) {
        this.replaceEditorContent(prev);
      }
      return true;
    }
    if (key.name === "down") {
      const next = this.editor.nextHistory();
      if (next !== null) {
        this.replaceEditorContent(next);
      }
      return true;
    }
    return false;
  }

  private updateHints(): void {
    const buffer = this.editor.getValue();
    // 只要输入 / 就显示所有命令
    if (buffer === "/") {
      this.hintMatches = this.commands.getAll().map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
      }));
      this.hintIndex = 0;
    } else {
      this.hintMatches = [];
      this.hintIndex = 0;
    }
  }

  private renderLine(): void {
    const buffer = this.editor.getValue();
    const cursor = this.editor.getCursorPos();
    const before = buffer.slice(0, cursor);
    const after = buffer.slice(cursor);
    const neutral = this.renderer.getColor("neutral");

    process.stdout.write(`\r\x1b[2K${this.prompt}${neutral(before)}${chalk.dim(after)}`);
  }

  private renderWithHints(): void {
    if (this.hintMatches.length > 0) {
      this.renderer.commandHints(
        this.hintMatches,
        this.hintIndex,
        this.editor.getValue(),
        this.prompt
      );
      this.prevHintCount = this.hintMatches.length;
    } else {
      this.clearHints();
      this.renderLine();
    }
  }

  private clearHints(): void {
    if (this.prevHintCount > 0) {
      this.renderer.clearHints(this.prevHintCount);
      this.prevHintCount = 0;
    }
    this.hintMatches = [];
    this.hintIndex = 0;
  }
}
