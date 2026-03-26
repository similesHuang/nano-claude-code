import { promises as fs } from "fs";
import * as path from "path";

/**
 * 读取文件内容
 */
export async function runRead(filePath: string, limit?: number): Promise<string> {
  try {
    // 安全检查：防止读取敏感文件
    const absolutePath = path.resolve(filePath);
    const cwd = process.cwd();
    
    if (!absolutePath.startsWith(cwd)) {
      return "Error: Can only read files within the current directory";
    }

    const content = await fs.readFile(absolutePath, "utf-8");
    const lines = content.split("\n");
    
    if (limit && limit < lines.length) {
      const truncated = lines.slice(0, limit).join("\n");
      return `${truncated}\n... (${lines.length - limit} more lines)`;
    }
    
    // 限制输出大小
    if (content.length > 50000) {
      return content.slice(0, 50000) + "\n... (file truncated)";
    }
    
    return content;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

/**
 * 写入文件
 */
export async function runWrite(filePath: string, content: string): Promise<string> {
  try {
    const absolutePath = path.resolve(filePath);
    const cwd = process.cwd();
    
    if (!absolutePath.startsWith(cwd)) {
      return "Error: Can only write files within the current directory";
    }

    // 确保目录存在
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(absolutePath, content, "utf-8");
    
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

/**
 * 编辑文件 - 替换文本
 */
export async function runEdit(filePath: string, oldText: string, newText: string): Promise<string> {
  try {
    const absolutePath = path.resolve(filePath);
    const cwd = process.cwd();
    
    if (!absolutePath.startsWith(cwd)) {
      return "Error: Can only edit files within the current directory";
    }

    const content = await fs.readFile(absolutePath, "utf-8");
    
    if (!content.includes(oldText)) {
      return `Error: Text not found in ${filePath}`;
    }
    
    const newContent = content.replace(oldText, newText);
    await fs.writeFile(absolutePath, newContent, "utf-8");
    
    return `Edited ${filePath}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

