import * as path from "path";
import * as os from "os";

/**
 * 全局数据目录：~/.nano-claude-code/
 * 用于存放不应污染用户项目的内部产物（转录、工具缓存、全局技能等）
 */
export function getDataDir(): string {
  return path.join(os.homedir(), ".nano-claude-code");
}
