/**
 * TodoManager - 任务状态管理器
 *
 * 跟踪多步骤任务的进度，支持三种状态：
 * - pending: 待处理
 * - in_progress: 进行中（只能有一个）
 * - completed: 已完成
 */
export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
}

export class TodoManager {
  private items: TodoItem[] = [];
  private roundsSinceUpdate: number = 0;

  /**
   * 更新任务列表
   */
  update(items: TodoItem[]): string {
    // 验证限制
    if (items.length > 20) {
      throw new Error("Max 20 todos allowed");
    }

    // 验证每个项目
    const validated: TodoItem[] = [];
    let inProgressCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const text = item.text?.trim();
      const status = item.status?.toLowerCase();
      const id = item.id?.toString() || String(i + 1);

      if (!text) {
        throw new Error(`Item ${id}: text required`);
      }

      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`Item ${id}: invalid status '${status}'`);
      }

      if (status === "in_progress") {
        inProgressCount++;
      }

      validated.push({ id, text, status: status as TodoItem["status"] });
    }

    if (inProgressCount > 1) {
      throw new Error("Only one task can be in_progress at a time");
    }

    this.items = validated;
    this.roundsSinceUpdate = 0; // 重置计数器
    return this.render();
  }

  /**
   * 渲染任务列表为可视化字符串
   */
  render(): string {
    if (this.items.length === 0) {
      return "No todos.";
    }

    const lines: string[] = [];
    for (const item of this.items) {
      const marker = {
        pending: "🕘",
        in_progress: "🔄",
        completed: "✅",
      }[item.status];
      lines.push(`${marker} #${item.id}: ${item.text}`);
    }

    const done = this.items.filter((t) => t.status === "completed").length;
    lines.push(`\n(${done}/${this.items.length} completed)`);

    return lines.join("\n");
  }

  /**
   * 增加未更新计数（用于 nag reminder）
   */
  incrementRound(): void {
    this.roundsSinceUpdate++;
  }

  /**
   * 是否需要提醒更新：达到轮次阈值 + 有未完成任务
   */
  shouldNag(threshold: number = 3): boolean {
    return this.roundsSinceUpdate >= threshold && this.hasIncompleteTasks();
  }

  /**
   * 是否存在未完成的任务
   */
  hasIncompleteTasks(): boolean {
    return this.items.some((item) => item.status !== "completed");
  }

  /**
   * 重置 nag 计数器
   */
  resetNag(): void {
    this.roundsSinceUpdate = 0;
  }

  /**
   * 获取当前任务列表
   */
  getItems(): TodoItem[] {
    return [...this.items];
  }

  /**
   * 清空任务列表
   */
  clear(): void {
    this.items = [];
    this.roundsSinceUpdate = 0;
  }

  /**
   * 检查某个工具是否是 todo 工具
   */
  isTodoTool(toolName: string): boolean {
    return toolName === "todo";
  }
}
