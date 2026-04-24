# nano-claude-code

> 基于 TypeScript 的轻量级 Claude CLI 编码代理

## 项目概述

`nano-claude-code` 是一个轻量级的 AI 编程助手，模仿 Claude Code 的核心功能。它能够理解自然语言指令，自动执行代码编写、文件操作、Shell 命令等任务。

### 核心特性

- 🔧 **工具执行** - 支持 Bash 命令和文件读写操作
- 📋 **任务管理** - 内置 Todo 任务系统，带 nag 提醒机制
- 💾 **记忆系统** - 支持私有记忆和团队共享记忆
- 🔒 **权限管控** - 三级权限体系（allow/ask/deny）
- 🔌 **技能扩展** - 支持自定义技能加载
- 🧹 **上下文管理** - 自动压缩对话历史，防止上下文膨胀
- 🔄 **错误恢复** - API 错误自动重试与续写
- ⏰ **定时任务** - 支持 cron 表达式定时执行
- 🎨 **子代理模式** - 支持独立 system prompt 的子代理

### 项目结构

```
src/
├── cli/                     # CLI 入口与 UI 层
│   ├── index.ts             # CLI 主入口
│   ├── app.ts               # 应用主逻辑
│   └── ui/                  # 终端 UI 组件
│       ├── commands.ts      # 命令处理
│       ├── editor.ts        # 编辑器交互
│       ├── input.ts         # 用户输入
│       ├── renderer.ts      # 渲染器
│       └── hintList.ts      # 提示列表
├── agent/                   # Agent 核心模块
│   ├── index.ts             # Agent 工厂函数
│   ├── core/                # 核心层
│   │   ├── loop.ts          # AgentLoop 主循环
│   │   ├── types.ts         # 类型定义
│   │   ├── state.ts         # 状态管理
│   │   ├── control.ts       # 控制流
│   │   └── extensionBuilder.ts  # 扩展构建器
│   ├── tools/               # 工具层
│   │   ├── index.ts         # 工具注册与分发
│   │   ├── bash.ts          # Shell 命令执行
│   │   ├── file.ts          # 文件读写操作
│   │   └── schemas.ts       # 工具参数 Schema
│   ├── runtime/             # 运行时系统
│   │   ├── index.ts         # 运行时导出
│   │   ├── taskManager.ts   # Todo 任务管理
│   │   └── asyncTask.ts     # 后台任务管理
│   ├── extensions/          # 扩展层（10个扩展）
│   │   ├── index.ts         # 扩展导出
│   │   ├── memory/          # 记忆系统
│   │   ├── permission/      # 权限管理
│   │   ├── hooks/           # 钩子系统
│   │   ├── skill/           # 技能系统
│   │   ├── compact/         # 上下文压缩
│   │   ├── retry/           # 重试机制
│   │   ├── promptBuilder/   # System Prompt 构建
│   │   └── schedule/        # 定时任务
│   └── subAgents/           # 子代理模式
├── config/                  # 配置层
│   ├── index.ts             # 配置管理
│   ├── agent.ts             # Agent 配置
│   └── paths.ts             # 路径配置
└── toolPipeline.ts          # 工具执行管道
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm 或 yarn

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/similesHuang/nano-claude-code.git
cd nano-claude-code

# 2. 安装依赖
npm install

# 3. 构建项目
npm run build

# 4. 全局安装（可选）
npm link
```

### 运行方式

```bash
# 方式一：直接运行开发模式（无需构建）
npm run dev

# 方式二：使用构建后的代码
node dist/cli/index.js "帮我创建一个 React 组件"

# 方式三：全局安装后使用
nano-claude-code "帮我创建一个 React 组件"

# 方式四：指定工作目录
cd /path/to/project && node dist/cli/index.js "审查代码"

# 方式五：交互模式
node dist/cli/index.js
```

### 环境变量

| 变量名 | 必需 | 说明 | 默认值 |
|--------|------|------|--------|
| `ANTHROPIC_API_KEY` | 是 | Anthropic API 密钥 | - |
| `CLAUDE_MODEL` | 否 | 指定模型 | claude-sonnet-4-20250514 |
| `ANTHROPIC_BASE_URL` | 否 | API 端点 | https://api.anthropic.com |

## 功能详解

### 工具系统

| 工具 | 说明 |
|------|------|
| `Bash` | 执行 Shell 命令（120s 超时，50MB 输出限制） |
| `Read` | 读取文件内容 |
| `Write` | 写入文件内容 |
| `Edit` | 编辑文件（精确替换） |
| `Task` | 创建和管理任务（仅主代理可用） |
| `BackgroundTask` | 后台任务管理 |

### 任务管理

```bash
# 创建任务
/node "创建一个用户登录功能"

/ 状态: pending
# 查看任务列表
/node "查看当前任务"
/task list

# 更新任务状态
/task update 1 --status completed
```

### 权限管理

权限分为三级：
- **allow** - 自动执行，无需确认
- **ask** - 询问确认（默认）
- **deny** - 拒绝执行

连续拒绝将触发熔断机制，提示切换 plan 模式。

### 记忆系统

- **私有记忆** (`private`) - 存储在 `~/.nano-claude-code/memory/private/`
- **团队记忆** (`team`) - 存储在项目目录的 `.memory/` 下

```bash
# 保存记忆
/save_memory name=project_notes content="项目重要信息..." type=project

# 加载记忆
/load_skill skill-name
```

### 技能系统

技能文件存储在：
- 全局：`~/.nano-claude-code/skills/`
- 项目级：`PROJECT/.claude/skills/`

```bash
# 加载技能
/load_skill tomato-and-egg
```

### 子代理模式

支持独立 system prompt 的子代理，用于处理特定任务：
- 子代理不包含 `task` 工具，防止无限递归
- 支持自定义 system prompt 配置

### 定时任务

基于 cron 表达式，支持定时执行任务。

### Hook 系统

支持 PreToolUse、PostToolUse、SessionStart 三种钩子类型。

## 配置

### 全局配置

配置文件位置：`~/.nano-claude-code/config.json`

```json
{
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 8192,
  "temperature": 0.7,
  "permissionMode": "ask",
  "baseURL": "https://api.anthropic.com"
}
```

### 项目级配置

在项目根目录创建 `.claude/` 目录：
- `.claude/skills/` - 项目级技能
- `.claude/config.json` - 项目配置（可选）

## 开发

```bash
# 构建项目
npm run build

# 开发模式（自动构建并运行）
npm run dev

# 监听模式构建
npm run build:watch

# 类型检查（集成在 build 中）
tsc --noEmit
```

## 项目依赖

| 依赖 | 说明 |
|------|------|
| `@anthropic-ai/sdk` | Anthropic API 客户端 |
| `commander` | 命令行解析 |
| `inquirer` | 交互式输入 |
| `chalk` | 终端着色 |
| `marked` | Markdown 渲染 |
| `dotenv` | 环境变量加载 |

## License

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！