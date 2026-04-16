---
name: nano_claude_code_overview
description: nano-claude-code 项目整体架构概览
type: project
scope: team
sentiment: neutral
---
## nano-claude-code 项目概览

一个基于 TypeScript 的轻量级 Claude CLI 编码代理，模仿 Claude Code 的核心功能。

### 核心架构

**入口**: `src/index.ts`
**主循环**: `src/agent/index.ts` — `AgentLoop` 类，支持主代理和子代理两种模式

### 模块结构

**src/agent/tools/** — 工具层
- `bash.ts`: 执行 shell 命令
- `file.ts`: 文件读写
- `index.ts`: 工具注册与 executeTool 分发

**src/agent/systems/** — 系统层
- `todoManager.ts`: Todo 任务管理 + nag 提醒机制
- `skillsSystem.ts`: 技能加载系统
- `compactSystem.ts`: 对话历史压缩（micro/auto compact）
- `errorRecovery.ts`: API 错误重试与 max_tokens 续写

**src/agent/extensions/** — 扩展层
- `memorySystem.ts`: 持久化记忆（team: .memory/，private: dataDir/memory/private/）
- `permissionManager.ts`: 工具权限管控（allow/ask/deny 三级）
- `hookManager.ts`: PreToolUse / PostToolUse / SessionStart 钩子
- `dreamConsolidator.ts`: 后台异步记忆整理（fire-and-forget）
- `systemPromptBuilder.ts`: 动态构建 system prompt

**src/ui/** — 终端 UI 层
**src/config/** — 配置

### 关键设计
- 子代理不含 `task` 工具，防止无限递归
- 大工具输出持久化到磁盘，避免上下文膨胀
- 权限连续拒绝触发熔断，建议切换 plan 模式
