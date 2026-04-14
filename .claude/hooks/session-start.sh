#!/bin/bash
# SessionStart hook demo
# 退出码 2 → 注入消息到上下文
echo "📌 Session started at $(date '+%Y-%m-%d %H:%M:%S')" >&2
echo "📌 Working directory: $PWD" >&2
exit 2
