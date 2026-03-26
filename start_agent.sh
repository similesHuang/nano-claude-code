#!/bin/bash

# 快速开始脚本
echo "🚀 Agent Loop 快速开始"
echo ""

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "📝 创建 .env 文件..."
    cp .env.example .env
    echo "⚠️  请编辑 .env 文件，填入你的 ANTHROPIC_API_KEY"
    echo ""
    exit 1
fi

# 检查环境变量
if ! grep -q "ANTHROPIC_API_KEY=sk-" .env 2>/dev/null; then
    echo "⚠️  请在 .env 文件中配置你的 ANTHROPIC_API_KEY"
    echo ""
    exit 1
fi

echo "✅ 环境配置正常"
echo ""
echo "选择运行模式："
echo "  1) 交互模式（REPL）"
echo "  2) 扩展工具示例"
echo "  3) 单次任务"
echo ""
read -p "请选择 (1-3): " choice

case $choice in
    1)
        echo ""
        echo "🤖 启动交互模式..."
        npm run agent
        ;;
    2)
        echo ""
        echo "🔧 运行扩展工具示例..."
        tsx src/agent/example_extended.ts
        ;;
    3)
        echo ""
        read -p "请输入任务: " task
        npm run agent:oneshot "$task"
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac
