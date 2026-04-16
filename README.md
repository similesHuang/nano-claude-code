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

### 项目结构

```
src/
├── index.ts                 # 入口文件
├── agent/
│   ├── index.ts            # AgentLoop 主循环（支持主代理/子代理模式）
│   ├── tools/               # 工具层
│   │   ├── bash.ts         # Shell 命令执行
│   │   ├── file.ts         # 文件读写
│   │   └── index.ts        # 工具注册与分发
│   ├── systems/            # 系统层
│   │   ├── todoManager.ts  # Todo 任务管理
│   │   ├── skillsSystem.ts # 技能加载系统
│   │   ├── compactSystem.ts# 对话历史压缩
│   │   └── errorRecovery.ts# 错误恢复
│   └── extensions/         # 扩展层
│       ├── memorySystem.ts # 持久化记忆
│       ├── permissionManager.ts # 权限管理
│       ├── hookManager.ts  # 钩子系统
│       └── systemPromptBuilder.ts # System Prompt 动态构建
├── ui/                     # 终端 UI 层
└── config/                 # 配置层
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm 或 yarn

### 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd nano-claude-code

# 2. 安装依赖
npm install

# 3. 构建项目
npm run build

# 4. 设置 API Key
export ANTHROPIC_API_KEY="your-api-key"

# 5. 运行
node dist/index.js
```

### 使用方法

```bash
# 基本用法
node dist/index.js "帮我创建一个 React 组件"

# 指定工作目录
cd /path/to/project && node dist/index.js "审查代码"

# 带选项运行
node dist/index.js --verbose "修复 bug"
```

### 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `ANTHROPIC_API_KEY` | 是 | Anthropic API 密钥 |
| `CLAUDE_MODEL` | 是 | 指定模型` |
| `ANTHROPIC_BASE_URL` | 是 | - |

## 功能详解

### 工具系统

| 工具 | 说明 |
|------|------|
| `Bash` | 执行 Shell 命令（120s 超时，50MB 输出限制） |
| `Read` | 读取文件内容 |
| `Write` | 写入文件内容 |
| `Edit` | 编辑文件（精确替换） |
| `Task` | 创建和管理任务 |

### 权限管理

权限分为三级：
- **allow** - 自动执行
- **ask** - 询问确认（默认）
- **deny** - 拒绝执行

连续拒绝将触发熔断机制。

### 记忆系统

- **私有记忆** (`private`) - 存储在 `~/.nano-claude-code/memory/private/`
- **团队记忆** (`team`) - 存储在项目目录的 `.memory/` 下

### 技能系统

加载自定义技能：
```
/skill tomato-and-egg
```

技能文件存储在：
- 全局：`~/.nano-claude-code/skills/`
- 项目级：`PROJECT/.claude/skills/`

## 配置

配置文件位置：`~/.nano-claude-code/config.json`

```json
{
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 8192,
  "temperature": 0.7,
  "permissionMode": "ask"
}
```

## 开发

```bash
# 类型检查
npm run typecheck

# 代码格式化
npm run format

# 运行测试
npm test

# 监听模式构建
npm run build:watch
```

## License

MIT
