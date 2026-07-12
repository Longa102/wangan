#!/bin/bash
# 环境初始化脚本
# 负责人：C
# 用法：bash scripts/setup.sh

set -e

echo "=== MCP Security Proxy - 环境初始化 ==="

# 1. 安装 Node.js 依赖
echo "[1/4] 安装 Node.js 依赖..."
npm install

# 2. 安装 Python 依赖（如使用 Python 模型推理）
echo "[2/4] 安装 Python 依赖..."
pip install -r requirements.txt

# 3. 创建必要的目录
echo "[3/4] 创建运行时目录..."
mkdir -p logs models data

# 4. 复制配置文件
echo "[4/4] 初始化本地配置..."
if [ ! -f config/local.yaml ]; then
    cp config/default.yaml config/local.yaml
    echo "  ✓ config/local.yaml 已创建，请编辑填入 API Key 等配置"
else
    echo "  - config/local.yaml 已存在，跳过"
fi

echo "=== 初始化完成 ==="
echo "下一步："
echo "  1. 编辑 config/local.yaml 填入配置"
echo "  2. 运行 npm start 启动代理"
echo "  3. 运行 npm test  执行测试"
