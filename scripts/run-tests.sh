#!/bin/bash
# 测试执行脚本
# 负责人：C
# 用法：bash scripts/run-tests.sh [unit|integration|adversarial|all]

set -e

MODE=${1:-all}

echo "=== MCP Security Proxy - 测试执行 (mode: $MODE) ==="

run_unit() {
    echo "[单元测试] 各检测模块独立功能验证"
    npx jest tests/unit/ --verbose
}

run_integration() {
    echo "[集成测试] 代理全链路拦截流程验证"
    npx jest tests/integration/ --verbose
}

run_adversarial() {
    echo "[对抗测试] 7类绕过手法对抗样本验证"
    npx jest tests/adversarial/ --verbose
}

case $MODE in
    unit)
        run_unit
        ;;
    integration)
        run_integration
        ;;
    adversarial)
        run_adversarial
        ;;
    all)
        run_unit
        run_integration
        run_adversarial
        ;;
    *)
        echo "未知模式: $MODE"
        echo "用法: bash scripts/run-tests.sh [unit|integration|adversarial|all]"
        exit 1
        ;;
esac

echo "=== 测试完成 ==="
