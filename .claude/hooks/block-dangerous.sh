#!/bin/bash
# PreToolUse hook demo — 阻止危险命令
# 退出码 1 → 阻止工具执行（block）
#
# 示例：阻止 bash 工具执行包含 rm -rf 的命令

if [[ "$HOOK_TOOL_NAME" == "bash" ]]; then
  INPUT="$HOOK_TOOL_INPUT"
  if echo "$INPUT" | grep -qE 'rm\s+-rf\s+/'; then
    echo "🚫 Blocked: dangerous 'rm -rf /' detected in bash command" >&2
    exit 1
  fi
fi

exit 0
