#!/bin/bash
# PostToolUse hook demo — 工具执行后注入摘要消息
# 退出码 2 → inject message

echo "✅ Tool '${HOOK_TOOL_NAME}' completed. Output length: ${#HOOK_TOOL_OUTPUT} chars" >&2
exit 2
