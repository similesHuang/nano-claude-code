import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * 执行 shell 命令
 * 注意：安全校验由 PermissionManager 在上层管线统一处理，
 * 此处仅保留最基础的纵深防御（double-check）。
 */
export async function runBash(command: string): Promise<string> {

    // 纵深防御：即使权限管线被绕过，仍拦截最致命的操作
    if (/\brm\s+(-[a-zA-Z]*)?rf?\s+\/\s*$/.test(command) || /\bsudo\b/.test(command)) {
      return "Error: Dangerous command blocked for safety";
    }
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 120000, // 120s timeout
        maxBuffer: 50 * 1024 * 1024, // 50MB
        cwd: process.cwd(),
      });
      
      const output = (stdout + stderr).trim();
      
      // 限制输出大小
      if (output.length > 50000) {
        return output.slice(0, 50000) + "\n... (output truncated)";
      }
      
      return output || "(no output)";
    } catch (error: any) {
      if (error.killed) {
        return "Error: Command timeout (120s)";
      }
      return `Error: ${error.message}\n${error.stderr || ""}`.trim();
    }
}
