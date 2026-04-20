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

### 完整模块结构

**src/agent/** — Agent 核心
- `index.ts`: AgentLoop 主循环（支持主代理/子代理模式）
- `taskRuntime/`: 任务运行系统
- `toolPipeline.ts`: 工具管道执行
- `types.ts`: 类型定义

**src/agent/tools/** — 工具层
- `bash.ts`: Shell 命令执行
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
- `commands.ts`, `spinner.ts`, `editor.ts`, `input.ts`, `renderer.ts`
- `theme/`: 主题系统（default.ts, types.ts, index.ts）
- `components/HintList/`: 提示列表组件

**src/config/** — 配置层
- `agent.ts`, `index.ts`, `paths.ts`

### 关键设计

1. **子代理模式**: 子代理不含 `task` 工具，防止无限递归
2. **上下文管理**: 大工具输出持久化到磁盘，避免上下文膨胀
3. **权限熔断**: 权限连续拒绝触发熔断，建议切换 plan 模式
4. **Dream 机制**: 后台异步整理记忆，不阻塞主流程

### 核心特性

- 🔧 工具执行（Bash + 文件读写）
- 📋 任务管理（Todo + nag 提醒）
- 💾 记忆系统（私有/团队）
- 🔒 权限管控（allow/ask/deny）
- 🔌 技能扩展（skillsSystem）
- 🧹 上下文压缩（compactSystem）
- 🔄 错误恢复（errorRecovery）
- 🔙 后台任务（asyncTask + background_run）
- ⏰ 定时任务（scheduled_tasks）

### 项目依赖

- `typescript`, `tsx` — 开发/构建
- `nanospinner` — 终端动画
- `conf` — 配置管理
- `zod` — Schema 验证
- `@anthropic-ai/sdk` — Anthropic API

### 配置文件

- `.memory/` — 团队共享记忆目录
- `.claude/skills/` — 项目级技能目录
- `~/.nano-claude-code/` — 全局配置和私有数据

### CLI 用法

```bash
node dist/index.js "帮我创建一个 React 组件"
```
