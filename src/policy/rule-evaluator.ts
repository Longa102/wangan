/**
 * 规则评估器
 * 负责人：B
 *
 * 职责：
 *   - 在运行时将工具调用请求与策略规则集进行匹配
 *   - 执行规则表达式评估（支持路径匹配、参数检查、上下文感知）
 *   - 返回匹配到的最高优先级策略决策
 *
 * 匹配模式：
 *   1. 精确匹配：tool == "fs.write" && target_path == "~/.ssh/authorized_keys"
 *   2. 模式匹配：target_path matches "~/.ssh/**"
 *   3. 上下文匹配：user_original_intent == "code_review" && operation == "push"
 *   4. 语义匹配：request_body contains (session_sensitive_data)
 *
 * 评估流程：
 *   1. 按 tool 过滤候选规则集
 *   2. 按 risk 降序评估每条规则的匹配条件
 *   3. 返回第一个完全匹配的规则（因已按优先级排序）
 */

import { PolicyRule, ParsedPolicySet } from './dsl-parser';
import { ToolCallContext } from '../proxy/request-interceptor';
import { DetectionResult } from '../detector/detection-engine';

export interface EvaluationResult {
  matched: boolean;
  matchedRule?: PolicyRule;
  action: 'ALLOW' | 'ASK_USER' | 'BLOCK';
  riskScore: number;                     // 0-100 量化风险
  message?: string;
  matchedCondition?: string;             // 具体命中的规则条件（用于解释）
}

export class RuleEvaluator {
  private policies: ParsedPolicySet | null = null;

  /**
   * 加载策略集
   */
  loadPolicies(policies: ParsedPolicySet): void {
    this.policies = policies;
  }

  /**
   * 评估工具调用是否命中策略规则
   * @param context 工具调用上下文
   * @param detection 注入检测结果（来自子任务A）
   * @returns 评估结果（包含决策动作）
   */
  evaluate(context: ToolCallContext, detection: DetectionResult): EvaluationResult {
    // TODO(B): 实现规则评估

    if (!this.policies) {
      throw new Error('Policies not loaded. Call loadPolicies() first.');
    }

    // 步骤1：按 tool 过滤候选规则
    //   精确匹配 + 通配符匹配（fs.* 匹配所有 fs.xxx）
    // TODO(B)

    // 步骤2：按优先级排序候选规则
    // TODO(B)

    // 步骤3：逐条评估规则条件
    //   解析 rule 表达式，检查是否匹配
    //   支持的匹配函数：
    //     - matches(path, patterns) — 路径通配符匹配
    //     - contains(field, values)  — 字段包含检查
    //     - equals(field, value)    — 字段等值检查
    //     - in_list(field, values)  — 字段属于列表
    //     - regex_match(field, pattern) — 正则匹配
    //     - semantic_match(field, intent) — 语义匹配（调用LLM）
    // TODO(B)

    // 步骤4：返回第一个命中的规则结果
    // TODO(B)

    return {
      matched: false,
      action: 'ALLOW',
      riskScore: 0,
    };
  }

  /**
   * 计算工具调用的综合风险评分（0-100）
   * 综合 detection.confidence + deviationReport.overallScore + policy.risk
   */
  calculateRiskScore(
    detection: DetectionResult,
    deviationScore: number,
    matchedRule?: PolicyRule
  ): number {
    // TODO(B): 加权风险评分公式
    // risk = detection.confidence * 40 + deviationScore * 40 + policyRiskScore * 20
    throw new Error('Not implemented');
  }
}
