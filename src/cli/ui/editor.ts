/**
 * ReadlineEditor - 命令行编辑器
 *
 * 提供类似 readline 的编辑功能
 */
export class ReadlineEditor {
  private history: string[] = [];
  private historyIndex: number = -1;
  private input: string = '';
  private cursorPos: number = 0;

  /**
   * 添加到历史
   */
  pushHistory(command: string) {
    if (command.trim() && this.history[this.history.length - 1] !== command) {
      this.history.push(command);
    }
    this.historyIndex = -1;
  }

  /**
   * 获取上一条历史（从最近往最旧）
   */
  prevHistory(): string | null {
    if (this.history.length === 0) return null;

    if (this.historyIndex === -1) {
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    }

    return this.history[this.historyIndex];
  }

  /**
   * 获取下一条历史（从最旧往最近）
   */
  nextHistory(): string | null {
    if (this.historyIndex === -1) return null;

    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      return this.history[this.historyIndex];
    } else {
      this.historyIndex = -1;
      return '';
    }
  }

  /**
   * 插入字符
   */
  insert(char: string) {
    const before = this.input.slice(0, this.cursorPos);
    const after = this.input.slice(this.cursorPos);
    this.input = before + char + after;
    this.cursorPos++;
  }

  /**
   * 删除字符
   */
  delete(): boolean {
    if (this.cursorPos > 0) {
      const before = this.input.slice(0, this.cursorPos - 1);
      const after = this.input.slice(this.cursorPos);
      this.input = before + after;
      this.cursorPos--;
      return true;
    }
    return false;
  }

  /**
   * 删除光标后的字符
   */
  deleteForward(): boolean {
    if (this.cursorPos < this.input.length) {
      const before = this.input.slice(0, this.cursorPos);
      const after = this.input.slice(this.cursorPos + 1);
      this.input = before + after;
      return true;
    }
    return false;
  }

  /**
   * 移动光标
   */
  moveCursorLeft(): boolean {
    if (this.cursorPos > 0) {
      this.cursorPos--;
      return true;
    }
    return false;
  }

  moveCursorRight(): boolean {
    if (this.cursorPos < this.input.length) {
      this.cursorPos++;
      return true;
    }
    return false;
  }

  moveToStart() {
    this.cursorPos = 0;
  }

  moveToEnd() {
    this.cursorPos = this.input.length;
  }

  /**
   * 清空输入
   */
  clear() {
    this.input = '';
    this.cursorPos = 0;
  }

  /**
   * 获取当前输入
   */
  getValue(): string {
    return this.input;
  }

  /**
   * 获取光标位置
   */
  getCursorPos(): number {
    return this.cursorPos;
  }

  /**
   * 获取历史
   */
  getHistory(): string[] {
    return [...this.history];
  }
}
