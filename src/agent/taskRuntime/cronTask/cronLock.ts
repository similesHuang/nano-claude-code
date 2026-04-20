import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../../../config/paths";

export class CronLock {
  private lockPath: string;

  constructor(lockPath?: string) {
    this.lockPath = lockPath || PATHS.cronLockFile;
  }

  /**
   * Try to acquire the cron lock. Returns true on success.
   * If a lock file exists, check whether the PID inside is still alive.
   * If the process is dead the lock is stale and we can take over.
   */
  acquire(): boolean {
    if (fs.existsSync(this.lockPath)) {
      try {
        const storedPid = parseInt(fs.readFileSync(this.lockPath, "utf-8").trim(), 10);
        // PID liveness probe: send signal 0 (no-op) to check existence
        process.kill(storedPid, 0);
        // Process is alive -- lock is held by another session
        return false;
      } catch (e: any) {
        // Stale lock (process dead or PID unparseable) -- remove it
        // ESRCH: process doesn't exist
        // EPERM: process exists but we can't send signal (still considered alive)
        if (e.code === "EPERM") {
          return false;
        }
        // For ESRCH or other errors, treat as stale and proceed to acquire
      }
    }

    const dir = path.dirname(this.lockPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.lockPath, String(process.pid));
    return true;
  }

  /**
   * Remove the lock file if it belongs to this process.
   */
  release(): void {
    try {
      if (fs.existsSync(this.lockPath)) {
        const storedPid = parseInt(fs.readFileSync(this.lockPath, "utf-8").trim(), 10);
        if (storedPid === process.pid) {
          fs.unlinkSync(this.lockPath);
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }
}
