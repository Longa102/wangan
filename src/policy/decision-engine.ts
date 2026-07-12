/**
 * 策略决策引擎
 * 负责人：B
 *
 * 职责：
 *   - 综合注入检测结果 + 意图偏离度 + 策略规则，输出最终三态决策
 *   - 这是整个管道的决策汇聚点
 *
 * 输入：
 *   - DetectionResult（来自子任务A）—— 有没有攻击
 *   - DeviationReport（来自本模块aligner）—— 意图偏离多少
 *   - EvaluationResult（来自本模块rule-evaluator）—— 策略匹配情况
 *
 * 输出：
 *   - DecisionResult —— ALLOW / ASK_USER / BLOCK + 详细解释
 *
 * 决策矩阵：
 *   | 注入检测 | 偏离度 | 策略匹配    | 决策      |
 *   |---------|--------|------------|----------|
 *   | 无      | <0.3   | 无          | ALLOW    |
 *   | 不确定   | 0.3-0.6| 无/LOW     | ASK_USER |
 *   | 有      | >0.6   | CRITICAL   | BLOCK    |
 *   | 有      | 任意    | HIGH以上    | BLOCK    |
 *   | 不确定   | >0.6   | MEDIUM以上  | BLOCK    |
 */

import { DetectionResult } from '../detector/detection-engine';
import { DeviationReport } from '../aligner/deviation-scorer';
import { EvaluationResult } from './rule-evaluator';

export interface DecisionResult {
  action: 'ALLOW' | 'ASK_USER' | 'BLOCK';
  riskScore: number;                    // 0-100
  deviationScore: number;               // 0-1 意图偏离度
  matchedPolicyId?: string;
  explanation: string;                  // 可解释研判结论（自然语言）
  details: {
    detectionConfidence: number;
    deviationOverall: number;
    policyRisk: string;
  };
}

export class DecisionEngine {
  /**
   * 综合决策主入口
   * 汇聚子任务A和子任务B的结果，输出最终决策
   */
  evaluate(
    detection: DetectionResult,
    deviation: DeviationReport,
    policyEval: EvaluationResult
  ): DecisionResult {
    // TODO(B): 实现综合决策逻辑

    // 步骤1：计算综合风险评分
    //   加权融合三个信号源
    // TODO(B)

    // 步骤2：决策矩阵判定
    //   根据决策矩阵表确定最终动作
    // TODO(B)

    // 步骤3：生成可解释结论
    //   拼接解释文本，格式参考赛题要求
    //   "用户原始请求为读取项目 README 文档，Agent 却调用 fs.read 读取
    //    本地 SSH 私钥文件，并通过 net.fetch 向外部未知域名发起数据传输，
    //    判定为间接提示注入引发的工具滥用行为"
    // TODO(B)

    throw new Error('Not implemented');
  }

  /**
   * 生成询问用户时的风险提示
   * 当 action == ASK_USER 时，构造展示给用户的确认消息
   */
  generateUserPrompt(decision: DecisionResult): string {
    // TODO(B): 生成用户友好的风险提示
    // 包含：操作描述 + 风险等级 + 具体原因 + 确认/拒绝按钮
    throw new Error('Not implemented');
  }
}
