import * as path from "path";
import * as os from "os";

/**
 * 全局数据目录：~/.nano-claude-code/
 * 用于存放不应污染用户项目的内部产物（转录、工具缓存、全局技能等）
 */
export function getDataDir(): string {
  return path.join(os.homedir(), ".nano-claude-code");
}

/**
 * 集中路径契约 — 所有子系统的目录约定在此统一定义
 */
export const PATHS = {
  dataDir: getDataDir(),
  transcripts: path.join(getDataDir(), "transcripts"),
  toolResults: path.join(getDataDir(), "tool-results"),
  privateMemory: path.join(getDataDir(), "memory", "private"),
  globalSkills: path.join(getDataDir(), "skills"),
  teamMemory: (cwd: string) => path.join(cwd, ".memory"),
  projectSkills: (cwd: string) => path.join(cwd, ".claude", "skills"),
  taskDir: path.join(getDataDir(), ".tasks"),
  backendTaskDir: path.join(getDataDir(), "backendTaskcache"),
} as const;
