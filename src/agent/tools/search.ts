import { promises as fs } from "fs";
import * as path from "path";

/**
 * 常见需要忽略的目录（与 listFiles 共享逻辑）
 */
const SKIP_DIRS = new Set([
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
  "coverage",
  "vendor",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "target",
  "out",
]);

/**
 * 在项目文件中搜索内容（类似 grep -rn）
 *
 * @param pattern    搜索模式（字符串或正则）
 * @param dir        搜索目录（默认 cwd）
 * @param include    文件扩展名过滤，如 "ts,js,json"
 * @param maxResults 最大结果数（默认 30）
 */
export async function runSearch(
  pattern: string,
  dir?: string,
  include?: string,
  maxResults: number = 30,
): Promise<string> {
  try {
    const rootDir = path.resolve(dir ?? ".");
    const cwd = process.cwd();

    if (!rootDir.startsWith(cwd)) {
      return "Error: Can only search within the current directory";
    }

    if (!pattern || pattern.trim() === "") {
      return "Error: search pattern is required";
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch {
      // 如果不是合法正则，按纯文本处理
      regex = new RegExp(escapeRegex(pattern), "i");
    }

    const allowedExts = include
      ? new Set(include.split(",").map((e) => (e.startsWith(".") ? e : `.${e}`).trim()))
      : null;

    const results: string[] = [];
    let totalMatches = 0;
    let filesSearched = 0;
    const MAX_FILES = 2000; // 防止搜索太多文件

    async function walk(currentDir: string): Promise<void> {
      if (totalMatches >= maxResults || filesSearched >= MAX_FILES) return;

      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (totalMatches >= maxResults || filesSearched >= MAX_FILES) return;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
          await walk(fullPath);
        } else if (entry.isFile()) {
          // 跳过二进制/大文件
          if (isBinaryExtension(entry.name)) continue;
          if (allowedExts && !allowedExts.has(path.extname(entry.name))) continue;

          filesSearched++;
          await searchInFile(fullPath, regex, path.relative(cwd, fullPath), results, maxResults, totalMatches);
          totalMatches = results.length;
        }
      }
    }

    await walk(rootDir);

    if (results.length === 0) {
      return `No matches found for "${pattern}" (searched ${filesSearched} files)`;
    }

    const header = `Found ${results.length} matches for "${pattern}" (searched ${filesSearched} files):`;
    const body = results.join("\n");
    const footer = totalMatches >= maxResults ? `\n... (limited to ${maxResults} results, refine pattern or use include to narrow down)` : "";

    return `${header}\n${body}${footer}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

async function searchInFile(
  filePath: string,
  regex: RegExp,
  relativePath: string,
  results: string[],
  maxResults: number,
  currentCount: number,
): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    // 跳过大文件（> 1MB）
    if (stat.size > 1024 * 1024) return;

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (currentCount + results.length >= maxResults) return;

      if (regex.test(lines[i])) {
        results.push(`${relativePath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
  } catch {
    // 读取失败（二进制、权限等），静默跳过
  }
}

function isBinaryExtension(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return [
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
    ".exe", ".dll", ".so", ".dylib", ".o", ".a",
    ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".flac",
    ".pyc", ".pyo", ".class", ".jar",
    ".lock",  // 大型 lock 文件一般不需要搜索
  ].includes(ext);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
