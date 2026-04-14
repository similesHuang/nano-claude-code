import { promises as fs } from "fs";
import * as path from "path";

/**
 * 常见需要忽略的目录
 */
const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "__pycache__",
  ".cache",
  ".vscode",
  ".idea",
  "coverage",
  ".DS_Store",
  "vendor",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "target",       // rust / java
  "out",          // java / ts
]);

/**
 * 递归列出目录结构（不读取文件内容）
 *
 * @param dir     根目录（默认 cwd）
 * @param depth   最大递归深度（默认 3）
 * @param limit   最大返回条目数（默认 500）
 */
export async function runListFiles(
  dir?: string,
  depth: number = 3,
  limit: number = 500,
): Promise<string> {
  try {
    const rootDir = path.resolve(dir ?? ".");
    const cwd = process.cwd();

    if (!rootDir.startsWith(cwd)) {
      return "Error: Can only list files within the current directory";
    }

    // 尝试读取 .gitignore 获取额外忽略列表
    const extraIgnore = await loadGitignoreNames(rootDir);
    const ignoreSet = new Set([...DEFAULT_IGNORE, ...extraIgnore]);

    const lines: string[] = [];
    let count = 0;
    let truncated = false;

    async function walk(currentDir: string, currentDepth: number, prefix: string): Promise<void> {
      if (truncated) return;

      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return; // 无权限等，跳过
      }

      // 排序：目录在前，文件在后，各自按名称排序
      entries.sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (truncated) return;

        // 跳过隐藏文件（以 . 开头），但保留常用配置文件
        if (entry.name.startsWith(".") && !isImportantDotFile(entry.name)) {
          continue;
        }

        if (ignoreSet.has(entry.name)) continue;

        count++;
        if (count > limit) {
          truncated = true;
          return;
        }

        if (entry.isDirectory()) {
          lines.push(`${prefix}${entry.name}/`);
          if (currentDepth < depth) {
            await walk(path.join(currentDir, entry.name), currentDepth + 1, prefix + "  ");
          }
        } else {
          lines.push(`${prefix}${entry.name}`);
        }
      }
    }

    await walk(rootDir, 1, "");

    const header = `Directory listing of ${path.relative(cwd, rootDir) || "."}  (depth=${depth})`;
    const body = lines.join("\n");
    const footer = truncated ? `\n... (truncated at ${limit} entries, use depth or specific subdirectory to narrow down)` : "";

    return `${header}\n${body}${footer}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

/**
 * 常用的 dot 配置文件保留列表
 */
function isImportantDotFile(name: string): boolean {
  return [
    ".env",
    ".env.local",
    ".env.example",
    ".gitignore",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    ".prettierrc",
    ".prettierrc.js",
    ".editorconfig",
    ".npmrc",
    ".nvmrc",
    ".dockerignore",
    ".babelrc",
    ".tsconfig.json",
  ].includes(name);
}

/**
 * 从 .gitignore 中提取简单的目录/文件名忽略项
 * （只处理简单的名称，不处理 glob 模式）
 */
async function loadGitignoreNames(rootDir: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(rootDir, ".gitignore"), "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter((line) => line && !line.startsWith("#") && !line.includes("*") && !line.includes("/"));
  } catch {
    return [];
  }
}
