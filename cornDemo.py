#!/usr/bin/env python3
"""
cornDemo.py - Cron / Scheduled Tasks (s07 architecture)

定时任务作为独立后台线程运行，不注入 user message，不暴露 cron 工具给 LLM。
执行结果通过 output_queue 在 REPL 主循环中打印。

架构：
  CronScheduler (后台线程每秒 tick)
      ↓
  到期任务 → 直接执行（bash / agent_turn）
      ↓
  output_queue → drain_output() → print
"""
import json
import os
import subprocess
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Queue, Empty
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv(override=True)
if os.getenv("ANTHROPIC_BASE_URL"):
    os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)

WORKDIR = Path.cwd()
client = Anthropic(base_url=os.getenv("ANTHROPIC_BASE_URL"))
MODEL = os.getenv("CLAUDE_MODEL")
SCHEDULED_TASKS_FILE = WORKDIR / ".claude" / "scheduled_tasks.json"
CRON_LOCK_FILE = WORKDIR / ".claude" / "cron.lock"
AUTO_EXPIRY_DAYS = 7
JITTER_MINUTES = [0, 30]
JITTER_OFFSET_MAX = 4


# ---------------------------------------------------------------------------
# ANSI 颜色
# ---------------------------------------------------------------------------
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
DIM = "\033[2m"
RESET = "\033[0m"
BOLD = "\033[1m"


# ---------------------------------------------------------------------------
# PID 锁（防止多进程同时触发同一 cron）
# ---------------------------------------------------------------------------
class CronLock:
    def __init__(self, lock_path: Path = None):
        self._lock_path = lock_path or CRON_LOCK_FILE

    def acquire(self) -> bool:
        if self._lock_path.exists():
            try:
                stored_pid = int(self._lock_path.read_text().strip())
                os.kill(stored_pid, 0)
                return False
            except (ValueError, ProcessLookupError, PermissionError, OSError):
                pass
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock_path.write_text(str(os.getpid()))
        return True

    def release(self):
        try:
            if self._lock_path.exists():
                stored_pid = int(self._lock_path.read_text().strip())
                if stored_pid == os.getpid():
                    self._lock_path.unlink()
        except (ValueError, OSError):
            pass


# ---------------------------------------------------------------------------
# cron 匹配
# ---------------------------------------------------------------------------
def cron_matches(expr: str, dt: datetime) -> bool:
    fields = expr.strip().split()
    if len(fields) != 5:
        return False
    values = [dt.minute, dt.hour, dt.day, dt.month, dt.weekday()]
    cron_dow = (dt.weekday() + 1) % 7
    values[4] = cron_dow
    ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)]
    for field, value, (lo, hi) in zip(fields, values, ranges):
        if not _field_matches(field, value, lo, hi):
            return False
    return True


def _field_matches(field: str, value: int, lo: int, hi: int) -> bool:
    if field == "*":
        return True
    for part in field.split(","):
        step = 1
        if "/" in part:
            part, step_str = part.split("/", 1)
            step = int(step_str)
        if part == "*":
            if (value - lo) % step == 0:
                return True
        elif "-" in part:
            start, end = part.split("-", 1)
            start, end = int(start), int(end)
            if start <= value <= end and (value - start) % step == 0:
                return True
        else:
            if int(part) == value:
                return True
    return False


# ---------------------------------------------------------------------------
# CronJob 数据结构
# ---------------------------------------------------------------------------
class CronJob:
    def __init__(self, id: str, name: str, cron_expr: str, prompt: str,
                 recurring: bool = True, durable: bool = False):
        self.id = id
        self.name = name
        self.cron_expr = cron_expr
        self.prompt = prompt
        self.recurring = recurring
        self.durable = durable
        self.created_at = time.time()
        self.last_fired = 0.0
        self.jitter_offset = self._compute_jitter()

    def _compute_jitter(self) -> int:
        fields = self.cron_expr.strip().split()
        if not fields:
            return 0
        minute_field = fields[0]
        try:
            minute_val = int(minute_field)
            if minute_val in JITTER_MINUTES:
                return (hash(self.cron_expr) % JITTER_OFFSET_MAX) + 1
        except ValueError:
            pass
        return 0


# ---------------------------------------------------------------------------
# CronService（s07 风格：独立后台线程，不注入 user message）
# ---------------------------------------------------------------------------
class CronService:
    """
    调度类型: recurring (repeat) | one-shot (fire once)
    执行结果不注入 user message，直接通过 output_queue 打印
    """
    def __init__(self):
        self.jobs: list[CronJob] = []
        self.output_queue: list[str] = []
        self._queue_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_check_minute = -1
        self._lock = CronLock()

    def start(self):
        self._load_durable()
        self._thread = threading.Thread(target=self._check_loop, daemon=True, name="cron")
        self._thread.start()
        if self.jobs:
            print(f"{DIM}[Cron] Loaded {len(self.jobs)} scheduled tasks{RESET}")

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def create(self, cron_expr: str, prompt: str,
               recurring: bool = True, durable: bool = False) -> str:
        """由外部调用创建任务（不暴露给 LLM）"""
        job_id = str(uuid.uuid4())[:8]
        job = CronJob(job_id, f"job-{job_id}", cron_expr, prompt, recurring, durable)
        self.jobs.append(job)
        if durable:
            self._save_durable()
        mode = "recurring" if recurring else "one-shot"
        store = "durable" if durable else "session"
        return f"Created {job_id} ({mode}, {store}): {cron_expr}"

    def delete(self, job_id: str) -> str:
        before = len(self.jobs)
        self.jobs = [j for j in self.jobs if j.id != job_id]
        if len(self.jobs) < before:
            self._save_durable()
            return f"Deleted {job_id}"
        return f"Job {job_id} not found"

    def list_jobs(self) -> str:
        if not self.jobs:
            return "No scheduled tasks."
        lines = []
        for j in self.jobs:
            age_h = (time.time() - j.created_at) / 3600
            lines.append(f"  {j.id}  {j.cron_expr}  ["
                         f"{'recurring' if j.recurring else 'one-shot'}/"
                         f"{'durable' if j.durable else 'session'}] "
                         f"({age_h:.1f}h old): {j.prompt[:60]}")
        return "\n".join(lines)

    def drain_output(self) -> list[str]:
        with self._queue_lock:
            items = list(self.output_queue)
            self.output_queue.clear()
            return items

    def _check_loop(self):
        while not self._stop_event.is_set():
            now = datetime.now()
            current_minute = now.hour * 60 + now.minute
            if current_minute != self._last_check_minute:
                self._last_check_minute = current_minute
                self._check_tasks(now)
            self._stop_event.wait(timeout=1)

    def _check_tasks(self, now: datetime):
        if not self._lock.acquire():
            return
        try:
            expired = []
            fired_oneshots = []
            for job in self.jobs:
                age_days = (time.time() - job.created_at) / 86400
                if job.recurring and age_days > AUTO_EXPIRY_DAYS:
                    expired.append(job.id)
                    continue

                check_time = now
                if job.jitter_offset:
                    check_time = now - timedelta(minutes=job.jitter_offset)
                if cron_matches(job.cron_expr, check_time):
                    self._execute_job(job)
                    if not job.recurring:
                        fired_oneshots.append(job.id)
                    job.last_fired = time.time()

            if expired or fired_oneshots:
                remove_ids = set(expired) | set(fired_oneshots)
                self.jobs = [j for j in self.jobs if j.id not in remove_ids]
                for tid in expired:
                    print(f"{DIM}[Cron] Auto-expired: {tid}{RESET}")
                for tid in fired_oneshots:
                    print(f"{DIM}[Cron] One-shot completed: {tid}{RESET}")
                self._save_durable()
        finally:
            self._lock.release()

    def _execute_job(self, job: CronJob):
        print(f"{YELLOW}[Cron] Firing: {job.id} ({job.prompt[:50]}){RESET}")
        output = ""
        try:
            response = client.messages.create(
                model=MODEL,
                system=f"You are performing a scheduled background task. Be concise.\nCurrent time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                messages=[{"role": "user", "content": job.prompt}],
                max_tokens=2048,
            )
            text_blocks = [b.text for b in response.content if hasattr(b, "text")]
            output = "".join(text_blocks).strip()
        except Exception as exc:
            output = f"[error: {exc}]"

        with self._queue_lock:
            self.output_queue.append(f"[{job.id}] {output}")

    def _load_durable(self):
        if not SCHEDULED_TASKS_FILE.exists():
            return
        try:
            data = json.loads(SCHEDULED_TASKS_FILE.read_text())
            for d in data:
                job = CronJob(
                    d["id"], d.get("name", d["id"]),
                    d["cron"], d["prompt"],
                    d.get("recurring", True), True,
                )
                job.last_fired = d.get("last_fired", 0)
                self.jobs.append(job)
        except Exception as e:
            print(f"{DIM}[Cron] Load error: {e}{RESET}")

    def _save_durable(self):
        durable = [{
            "id": j.id, "name": j.name, "cron": j.cron_expr,
            "prompt": j.prompt, "recurring": j.recurring,
            "last_fired": j.last_fired,
        } for j in self.jobs if j.durable]
        SCHEDULED_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SCHEDULED_TASKS_FILE.write_text(json.dumps(durable, indent=2) + "\n")


# ---------------------------------------------------------------------------
# 工具实现（不包含 cron 工具 — cron 由系统管理）
# ---------------------------------------------------------------------------
TOOLS = [
    {"name": "bash", "description": "Run a shell command.",
     "input_schema": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}},
    {"name": "read_file", "description": "Read file contents.",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["path"]}},
    {"name": "write_file", "description": "Write content to file.",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}},
    {"name": "edit_file", "description": "Replace exact text in a file.",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}, "old_text": {"type": "string"}, "new_text": {"type": "string"}}, "required": ["path", "old_text", "new_text"]}},
]

TOOL_HANDLERS = {
    "bash":      lambda **kw: run_bash(kw["command"]),
    "read_file": lambda **kw: run_read(kw["path"], kw.get("limit")),
    "write_file":lambda **kw: run_write(kw["path"], kw["content"]),
    "edit_file": lambda **kw: run_edit(kw["path"], kw["old_text"], kw["new_text"]),
}


def safe_path(p: str) -> Path:
    path = (WORKDIR / p).resolve()
    if not path.is_relative_to(WORKDIR):
        raise ValueError(f"Path escapes workspace: {p}")
    return path


def run_bash(command: str) -> str:
    dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"]
    if any(d in command for d in dangerous):
        return "Error: Dangerous command blocked"
    try:
        r = subprocess.run(command, shell=True, cwd=WORKDIR,
                           capture_output=True, text=True, timeout=120)
        out = (r.stdout + r.stderr).strip()
        return out[:50000] if out else "(no output)"
    except subprocess.TimeoutExpired:
        return "Error: Timeout (120s)"


def run_read(path: str, limit: int = None) -> str:
    try:
        lines = safe_path(path).read_text().splitlines()
        if limit and limit < len(lines):
            lines = lines[:limit] + [f"... ({len(lines) - limit} more)"]
        return "\n".join(lines)[:50000]
    except Exception as e:
        return f"Error: {e}"


def run_write(path: str, content: str) -> str:
    try:
        fp = safe_path(path)
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(content)
        return f"Wrote {len(content)} bytes"
    except Exception as e:
        return f"Error: {e}"


def run_edit(path: str, old_text: str, new_text: str) -> str:
    try:
        fp = safe_path(path)
        content = fp.read_text()
        if old_text not in content:
            return f"Error: Text not found in {path}"
        fp.write_text(content.replace(old_text, new_text, 1))
        return f"Edited {path}"
    except Exception as e:
        return f"Error: {e}"


# ---------------------------------------------------------------------------
# Agent Loop（无 user message 注入）
# ---------------------------------------------------------------------------
SYSTEM = f"You are a coding agent at {WORKDIR}. Use tools to solve tasks."


def agent_loop():
    scheduler = CronService()
    scheduler.start()

    messages: list[dict] = []

    print(f"{DIM}[Cron scheduler running. /help for commands]{RESET}")
    print()

    while True:
        # 打印 cron 输出（无 user message 注入）
        for note in scheduler.drain_output():
            print(f"{YELLOW}[cron]{RESET} {note}")

        try:
            user_input = input(f"{CYAN}You > {RESET}").strip()
        except (KeyboardInterrupt, EOFError):
            print(f"\n{DIM}Goodbye.{RESET}")
            break

        if user_input.lower() in ("q", "exit", ""):
            scheduler.stop()
            break

        if user_input.startswith("/"):
            parts = user_input.split(maxsplit=1)
            cmd, arg = parts[0].lower(), parts[1].strip() if len(parts) > 1 else ""

            if cmd == "/help":
                print(f"{DIM}Commands: /cron list | /cron create <cron> <prompt> | /cron delete <id> | /exit{RESET}")
            elif cmd == "/cron":
                if arg == "list":
                    print(scheduler.list_jobs())
                elif arg.startswith("create "):
                    # /cron create "*/5 * * * *" "check status"
                    parts2 = user_input.split(" ", 3)
                    if len(parts2) >= 4:
                        print(scheduler.create(parts2[2], parts2[3]))
                elif arg.startswith("delete "):
                    print(scheduler.delete(arg.split(" ", 1)[1]))
                else:
                    print(scheduler.list_jobs())
            else:
                print(f"{YELLOW}Unknown: {cmd}. /help for commands.{RESET}")
            continue

        # 正常对话
        messages.append({"role": "user", "content": user_input})
        response = client.messages.create(
            model=MODEL, system=SYSTEM, messages=messages,
            tools=TOOLS, max_tokens=8000,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            text = "".join(b.text for b in response.content if hasattr(b, "text"))
            if text:
                print(f"\n{GREEN}Assistant:{RESET} {text}\n")
            continue

        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            handler = TOOL_HANDLERS.get(block.name)
            try:
                output = handler(**(block.input or {})) if handler else f"Unknown: {block.name}"
            except Exception as e:
                output = f"Error: {e}"
            print(f"{DIM}> {block.name}: {str(output)[:200]}{RESET}")
            results.append({
                "type": "tool_result", "tool_use_id": block.id, "content": str(output),
            })
        messages.append({"role": "user", "content": results})


if __name__ == "__main__":
    agent_loop()