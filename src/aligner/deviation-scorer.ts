/**
 * 偏离度评分器
 * 负责人：B
 *
 * 职责：
 *   - 计算"用户原始意图"与"Agent实际执行计划+工具调用序列"之间的语义偏离度
 *   - 输出量化评分和可解释的研判结论
 *
 * 评分维度（加权综合）：
 *   1. 目标偏离度 (30%)：Agent 执行目标是否与用户意图一致
 *   2. 范围偏离度 (25%)：操作的文件/网络/仓库是否超出用户声明的范围
 *   3. 工具偏离度 (25%)：实际使用的工具是否超出任务最小必要集
 *   4. 数据流偏离度 (20%)：是否存在向不可信目标的非必要数据传输
 *
 * 偏离度阈值：
 *   < 0.3  → 正常，直接放行
 *   0.3-0.6 → 可疑，需要用户确认
 *   > 0.6  → 异常，强制阻断
 */

import { StructuredIntent } from './intent-extractor';
import { StructuredPlan } from './plan-analyzer';
import { ToolCallRecord } from '../tracer/call-graph';

export interface DeviationReport {
  overallScore: number;                     // 综合偏离度 0-1
  dimensionScores: {
    goalDeviation: number;                  // 目标偏离度
    scopeDeviation: number;                 // 范围偏离度
    toolDeviation: number;                  // 工具偏离度
    dataFlowDeviation: number;              // 数据流偏离度
  };
  explanationMarkdown: string;              // 可解释研判结论（Markdown格式）
  keyEvidence: Array<{
    expected: string;                       // 预期行为
    actual: string;                         // 实际行为
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

export class DeviationScorer {
  /**
   * 计算意图-执行偏离度
   */
  score(
    intent: StructuredIntent,
    plan: StructuredPlan,
    toolCalls: ToolCallRecord[]
  ): DeviationReport {
    // TODO(B): 实现偏离度评分

    // 维度1：目标偏离度
    //   用户说 review PR → Agent 实际执行了 git.push → 高分偏离
    //   使用语义相似度模型计算
    // TODO(B)

    // 维度2：范围偏离度
    //   用户指定操作文件A → Agent 读取了文件B（尤其是 ~/.ssh/ 等敏感路径）
    //   通过路径匹配 + 语义相关性判断
    // TODO(B)

    // 维度3：工具偏离度
    //   用户任务只需 read 权限 → Agent 调用了 write/exec/push
    //   最小权限原则比对
    // TODO(B)

    // 维度4：数据流偏离度
    //   检查：会话内读到的敏感数据 → 是否被传递给了 net.fetch / agent.dispatch
    //   构建数据流图，追踪敏感信息流向
    // TODO(B)

    throw new Error('Not implemented');
  }

  /**
   * 生成可解释研判结论
   * 输出需满足赛题要求，示例：
   * "用户原始请求为读取项目 README 文档，Agent 却调用 fs.read 读取本地 SSH 私钥文件，
   *  并通过 net.fetch 向外部未知域名发起数据传输，判定为间接提示注入引发的工具滥用行为。"
   */
  generateExplanation(report: DeviationReport, intent: StructuredIntent, toolCalls: ToolCallRecord[]): string {
    // TODO(B): 根据偏离度报告生成自然语言解释
    throw new Error('Not implemented');
  }
}
