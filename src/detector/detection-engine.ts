/**
 * 注入检测引擎 — 统一入口
 * 负责人：A
 *
 * 职责：
 *   - 整合三类注入检测器（直接/间接/记忆污染），提供统一调用接口
 *   - 对输入内容进行多模型级联检测（规则引擎 → 分类模型 → LLM 研判）
 *   - 输出标准化的 DetectionResult 给下游决策模块
 *
 * 检测管道（三级级联）：
 *   1. 规则引擎快速过滤（低延迟，处理明显攻击特征）
 *   2. 本地微调分类模型 DeBERTa-v3（中等延迟，处理语义级攻击）
 *   3. LLM 深度研判（高延迟，处理复杂/模糊的攻击，仅在前两级不确定时调用）
 *
 * 输出接口约定（与子任务 B、C 的契约）：
 *   DetectionResult {
 *     isInjection: boolean;
 *     injectionType: "direct" | "indirect" | "memory_poisoning" | "none";
 *     confidence: number;          // 0-1
 *     payloadSnippet: string;      // 攻击载荷片段
 *     payloadLocation: { start: number; end: number };  // token 级定位
 *     bypassTechniques: string[];  // 检测到的绕过手法
 *   }
 */

import { DirectInjectionDetector } from './direct-injection';
import { IndirectInjectionDetector } from './indirect-injection';
import { MemoryPoisoningDetector } from './memory-poisoning';

export interface DetectionInput {
  source: 'user_input' | 'external_resource' | 'memory' | 'mcp_response' | 'tool_description';
  content: string;
  metadata: {
    url?: string;
    messageId?: string;
    memoryEntryId?: string;
    toolName?: string;
    conversationHistory?: string[];
  };
}

export interface DetectionResult {
  isInjection: boolean;
  injectionType: 'direct' | 'indirect' | 'memory_poisoning' | 'none';
  confidence: number;
  payloadSnippet: string;
  payloadLocation: { start: number; end: number };
  bypassTechniques: string[];
}

export class DetectionEngine {
  private directDetector: DirectInjectionDetector;
  private indirectDetector: IndirectInjectionDetector;
  private memoryDetector: MemoryPoisoningDetector;

  constructor() {
    this.directDetector = new DirectInjectionDetector();
    this.indirectDetector = new IndirectInjectionDetector();
    this.memoryDetector = new MemoryPoisoningDetector();
  }

  /**
   * 三级级联检测主入口
   * 根据 input.source 自动路由到对应的检测器
   */
  async analyze(input: DetectionInput): Promise<DetectionResult> {
    // 预处理阶段：Unicode 规范化 + 对抗鲁棒性预处理（见 src/defense/）
    const normalized = await this.preprocess(input.content);

    // 第一级：规则引擎快速过滤
    const ruleMatch = this.ruleBasedScan(normalized, input.source);
    if (ruleMatch && ruleMatch.confidence > 0.95) {
      return ruleMatch; // 明显攻击，直接返回
    }

    // 第二级：本地分类模型
    const modelResult = await this.modelClassify(normalized, input.source);
    if (modelResult && modelResult.confidence > 0.8) {
      return modelResult;
    }

    // 第三级：LLM 深度研判（仅在前两级不确定时触发）
    return await this.llmDeepAnalyze(normalized, input);
  }

  /** 预处理：对抗鲁棒性规范化 */
  private async preprocess(content: string): Promise<string> {
    // TODO(A): 依次调用 src/defense/ 下的规范化模块
    // 1. unicode-normalizer  — NFKC 归一化 + 零宽字符剥离
    // 2. multilang-detector  — 多语言文本统一表征
    // 3. obfuscation-analyzer — 去除混淆层后还原原始文本
    throw new Error('Not implemented');
  }

  /** 第一级：规则引擎快速匹配 */
  private ruleBasedScan(content: string, source: string): DetectionResult | null {
    // TODO(A): 正则 + 关键词 + 模式匹配
    // - 已知攻击模式指纹匹配
    // - 敏感路径/命令特征识别
    // - 角色伪装句式匹配
    throw new Error('Not implemented');
  }

  /** 第二级：DeBERTa-v3 分类模型 */
  private async modelClassify(content: string, source: string): Promise<DetectionResult | null> {
    // TODO(A): 加载本地微调模型进行二分类/多分类
    throw new Error('Not implemented');
  }

  /** 第三级：LLM 深度语义研判 */
  private async llmDeepAnalyze(content: string, input: DetectionInput): Promise<DetectionResult> {
    // TODO(A): 调用 Claude API 进行深度语义分析
    // 仅在前两级无法确定时调用，控制延迟和成本
    throw new Error('Not implemented');
  }
}
