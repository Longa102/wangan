/**
 * Agent 计划分析器
 * 负责人：B
 *
 * 职责：
 *   - 分析 Agent 实际生成的执行计划步骤
 *   - 提取每个计划步骤中涉及的工具调用、操作对象、预期效果
 *   - 输出结构化的计划表示，用于与用户意图做对比
 *
 * 输入来源：
 *   - Agent 的 think/reasoning 输出（规划阶段的文本）
 *   - Agent 生成的 tool_call 序列
 *   - 子 Agent 派发记录
 */

export interface PlanStep {
  stepIndex: number;
  description: string;                 // Agent 对这一步的描述
  toolName: string;                    // 计划调用的工具
  toolArgs: Record<string, unknown>;   // 计划传入的参数
  purpose: string;                     // 这一步的目的（Agent自述）
  isSubAgentTask: boolean;             // 是否派发给子Agent
  subAgentId?: string;
}

export interface StructuredPlan {
  steps: PlanStep[];
  totalTools: string[];                // 计划中涉及的所有工具
  declaredGoal: string;                // Agent 声明的总体目标
  suspiciousFlags: string[];           // 计划阶段即发现的异常标记
}

export class PlanAnalyzer {
  /**
   * 分析 Agent 的执行计划
   * @param planText Agent 规划输出的原始文本
   * @returns 结构化的计划表示
   */
  analyze(planText: string): StructuredPlan {
    // TODO(B): 实现计划分析

    // 步骤1：步骤分割
    //   将 Agent 的计划输出拆分为独立步骤
    //   典型的 Agent 会以编号列表或步骤标记输出计划
    // TODO(B)

    // 步骤2：工具调用提取
    //   识别每个步骤中计划使用的工具名和参数
    // TODO(B)

    // 步骤3：目标声明提取
    //   提取 Agent 的总体任务目标声明
    //   用于与用户原始意图做第一层对比
    // TODO(B)

    // 步骤4：计划阶段异常检测
    //   在计划阶段即识别可疑信号：
    //   - 计划访问与用户任务无关的路径
    //   - 计划读取敏感文件
    //   - 计划向外发送数据
    //   - 计划中出现了用户未提及的操作
    // TODO(B)

    throw new Error('Not implemented');
  }

  /**
   * 比对计划目标与用户意图
   * @returns 初步偏离度（在计划阶段，工具尚未执行时）
   */
  compareGoalWithIntent(declaredGoal: string, userIntent: string): number {
    // TODO(B): 语义相似度计算
    // 如果 Agent 声明的目标与用户意图在语义空间中的距离较大 → 提前预警
    throw new Error('Not implemented');
  }
}
