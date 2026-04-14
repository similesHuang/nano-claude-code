#!/bin/bash
# PreToolUse hook demo — 修改工具输入（结构化 JSON 输出）
# 退出码 0 + JSON stdout → 可注入 updatedInput 和 additionalContext
#
# 示例：给 file 工具的输入自动追加注释头

if [[ "$HOOK_TOOL_NAME" == "file" ]]; then
  cat <<'EOF'
{
  "additionalContext": "⚠️ File operation detected — please ensure backups exist."
}
EOF
  exit 0
fi

exit 0
