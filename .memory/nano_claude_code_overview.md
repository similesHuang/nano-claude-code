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
**主循环**: `src/agent/core/loop.ts` — `AgentLoop` 类，初始化所有扩展
**核心入口**: `src/agent/index.ts` — 导出 `createAgent()` 工厂函数

### 完整模块结构（43个TypeScript文件）

**src/agent/core/** — Agent 核心
- `loop.ts`: AgentLoop 主循环（初始化所有扩展）
- `types.ts`: 类型定义

**src/agent/tools/** — 工具层
- `bash.ts`: Shell 命令执行（支持后台任务）
- `file.ts`: 文件读写
- `task.ts`: 任务管理（仅主代理可用）
- `index.ts`: 工具注册与 executeTool 分发

**src/agent/runtime/** — 运行时系统
- `asyncTask.ts`: 后台任务管理
- `taskManager.ts`: Todo 任务管理（createTask/updateTask/listTasks）
- `contextManager.ts`: 上下文管理（持久化大工具输出到磁盘）
- `index.ts`: 运行时导出

**src/agent/extensions/** — 扩展层（10个扩展）
- `memory/`: 持久化记忆系统（team: .memory/，private: dataDir/memory/private/）
- `permission/`: 工具权限管控（allow/ask/deny 三级熔断机制）
- `hook/`: 钩子系统（PreToolUse/PostToolUse/SessionStart）
- `schedule/`: 定时任务系统（基于 cron 表达式）
- `skill/`: 技能加载系统（从 .claude/skills/ 加载）
- `compact/`: 对话历史压缩（micro compact + auto compact）
- `retry/`: API 错误重试与 max_tokens 续写
- `promptBuilder/`: 动态构建 system prompt
- `dream/`: 后台异步记忆整理（fire-and-forget）
- `index.ts`: 扩展导出

**src/agent/subAgents/** — 子代理模式
- `index.ts`: 子代理工厂，支持独立 system prompt

**src/ui/** — 终端 UI 层
- `index.ts`: UI 导出
- 命令、动画、编辑器、输入、渲染等模块

**src/config/** — 配置层
- `index.ts`: 配置管理
- `paths.ts`: 路径配置

### 关键设计

1. **子代理模式**: 子代理不含 `task` 工具，防止无限递归
2. **上下文管理**: 大工具输出持久化到磁盘，避免上下文膨胀
3. **权限熔断**: 权限连续拒绝触发熔断，建议切换 plan 模式
4. **Dream 机制**: 后台异步整理记忆，不阻塞主流程
5. **Pipeline 模式**: 工具执行通过 toolPipeline.ts 统一调度

### 核心特性

- 工具执行（Bash + 文件读写 + 后台任务）
- 任务管理（Todo + nag 提醒）
- 记忆系统（私有/团队）
- 权限管控（allow/ask/deny）
- 技能扩展（skillSystem）
- 上下文压缩（compactSystem）
- 错误恢复（retrySystem）
- 后台任务（asyncTask）
- 定时任务（scheduleSystem）
- 钩子系统（hookSystem）

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

### 项目特点

- 基于 Claude Code 理念，轻量级实现
- 支持主代理和子代理两种模式
- 完善的扩展系统，便于二次开发
- 重视上下文管理，避免溢出
