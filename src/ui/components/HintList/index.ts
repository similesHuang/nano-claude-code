import chalk from "chalk";
import { ThemeConfig } from "../../theme";

export interface HintItem {
  name: string;
  description?: string;
}

export interface HintListOptions {
  selectedIndex?: number;
  maxItems?: number;
}

/**
 * HintList 组件 - 命令补全列表
 */
export class HintList {
  private items: HintItem[] = [];
  private options: Required<HintListOptions>;
  private theme: ThemeConfig;

  constructor(items: HintItem[] = [], options: HintListOptions = {}, theme: ThemeConfig) {
    this.items = items;
    this.theme = theme;
    this.options = {
      selectedIndex: options.selectedIndex ?? 0,
      maxItems: options.maxItems ?? 6,
    };
  }

  private formatItem(item: HintItem, isSelected: boolean): string {
    const prefix = isSelected ? "›" : " ";
    let line = `  ${prefix} ${chalk.white(item.name)}`;

    if (item.description) {
      line += `  ${chalk.gray(item.description)}`;
    }

    return isSelected
      ? (chalk as any)[this.theme.colors.primary](line)
      : line;
  }

  render(): string[] {
    const visible = this.items.slice(0, this.options.maxItems);
    return visible.map((item, i) =>
      this.formatItem(item, i === this.options.selectedIndex)
    );
  }
}
