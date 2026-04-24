import chalk from "chalk";
import { ThemeConfig } from "./theme/index";

// ── 类型定义 ────────────────────────────────────────

export interface HintItem {
  name: string;
  description?: string;
}

export interface HintListOptions {
  selectedIndex?: number;
  maxItems?: number;
}

// ── 常量定义 ────────────────────────────────────────

const DEFAULT_MAX_ITEMS = 6;
const SELECTED_PREFIX = "›";
const UNSELECTED_PREFIX = " ";
const INDENT = "  ";

type ChalkFunction = typeof chalk;

/**
 * HintList 组件 - 命令补全列表
 */
export class HintList {
  private readonly items: HintItem[];
  private readonly options: Required<HintListOptions>;
  private readonly theme: ThemeConfig;

  constructor(
    items: HintItem[] = [],
    options: HintListOptions = {},
    theme: ThemeConfig
  ) {
    this.items = items;
    this.theme = theme;
    this.options = {
      selectedIndex: options.selectedIndex ?? 0,
      maxItems: options.maxItems ?? DEFAULT_MAX_ITEMS,
    };
  }

  /** 获取主题颜色对应的 chalk 函数 */
  private color(name: keyof ThemeConfig["colors"]): ChalkFunction {
    const colorName = this.theme.colors[name];
    return (chalk as unknown as Record<string, ChalkFunction>)[colorName] ?? chalk.white;
  }

  private formatItem(item: HintItem, isSelected: boolean): string {
    const prefix = isSelected ? SELECTED_PREFIX : UNSELECTED_PREFIX;
    const neutral = this.color("neutral");
    const muted = this.color("muted");

    let line = `${INDENT}${prefix} ${neutral(item.name)}`;

    if (item.description) {
      line += `  ${muted(item.description)}`;
    }

    return isSelected ? this.color("primary")(line) : line;
  }

  render(): string[] {
    const visibleItems = this.items.slice(0, this.options.maxItems);
    return visibleItems.map((item, index) =>
      this.formatItem(item, index === this.options.selectedIndex)
    );
  }
}
