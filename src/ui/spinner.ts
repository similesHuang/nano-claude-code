import chalk from "chalk";
import { ThemeConfig, defaultTheme } from "./theme";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private currentFrame = 0;
  private text = "";
  private interval: NodeJS.Timeout | null = null;
  private started = false;
  private theme: ThemeConfig;

  constructor(theme?: ThemeConfig) {
    this.theme = theme || defaultTheme;
  }

  private c(name: keyof ThemeConfig["colors"]): any {
    return (chalk as any)[this.theme.colors[name]] || chalk.white;
  }

  start(text = "加载中...") {
    if (this.started) this.stop();

    this.text = text;
    this.started = true;
    this.currentFrame = 0;

    const colorFn = this.c("primary");
    this.interval = setInterval(() => {
      const frame = FRAMES[this.currentFrame % FRAMES.length];
      process.stdout.write(`\x1b[2K\r  ${colorFn(frame)} ${this.text}`);
      this.currentFrame++;
    }, 80);

    return this;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write("\r\x1b[2K");
    this.started = false;
    return this;
  }

  setText(text: string) {
    this.text = text;
  }
}
