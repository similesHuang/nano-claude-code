import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * 执行 shell 命令
 */
export async function runBash(command: string): Promise<string> {
    
    const dangerousPatterns = [
      "rm -rf /",
      "sudo",
      "shutdown",
      "reboot",
      "> /dev/",
      "mkfs",
      "dd if=",
    ];
    
    if (dangerousPatterns.some(pattern => command.includes(pattern))) {
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
