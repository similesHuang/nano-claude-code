/**
 * 主题系统 - 仅管理颜色配置
 */

export interface ColorSet {
  primary: string;      // 主颜色（cyan）
  secondary: string;    // 辅助颜色（blue）
  success: string;      // 成功（green）
  error: string;        // 错误（red）
  warning: string;      // 警告（yellow）
  info: string;         // 信息（blue）
  muted: string;        // 淡出（gray）
  neutral: string;      // 中性（white）
}

export interface ThemeConfig {
  colors: ColorSet;
}
