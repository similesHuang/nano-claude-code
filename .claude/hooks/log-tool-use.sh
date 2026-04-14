#!/bin/bash
# PreToolUse hook demo — 记录工具调用日志
# 退出码 0 → 静默通过（continue）

LOG_FILE="${PWD}/.claude/hooks/tool-usage.log"
echo "[$(date '+%H:%M:%S')] PRE  | tool=${HOOK_TOOL_NAME} input=${HOOK_TOOL_INPUT:0:200}" >> "$LOG_FILE"
exit 0
