/**
 * 记忆库实时监控器
 *
 * 赛题要求：识别跨会话长期记忆库、向量数据库、业务知识库中
 * 预先植入的隐性触发指令与污染内容。
 *
 * 本模块提供：
 *   1. 记忆写入时的实时拦截检测
 *   2. 会话启动时的全量记忆审计
 *   3. 异常基线学习与自适应阈值
 *   4. 跨会话污染链路追踪
 *   5. 记忆条目隔离与标记
 */

import { VectorAnalyzer } from './vector-analyzer';
import { DetectionEngine, DetectionInput } from './detection-engine';

export interface MemoryEntry {
  id: string;
  content: string;
  writtenBy: string;
  sessionId: string;
  timestamp: number;
  /** 条目类型 */
  type: 'user_preference' | 'knowledge' | 'conversation_summary' | 'code_context' | 'unknown';
  /** 来源（哪个Agent/工具写入的） */
  source: string;
}

export interface MemoryAuditResult {
  entry: MemoryEntry;
  /** 是否被标记为污染 */
  isPoisoned: boolean;
  /** 污染置信度 0-1 */
  confidence: number;
  /** 检测方法 */
  detectionMethod: 'vector_anomaly' | 'pattern_match' | 'llm_analysis' | 'combined';
  /** 检测到的污染类型 */
  poisonType: 'conditional_trigger' | 'system_override' | 'credential_theft' | 'data_exfil' | 'persistence' | 'none';
  /** 详细原因 */
  reasons: string[];
  /** 建议处理方式 */
  recommendedAction: 'quarantine' | 'alert' | 'allow';
}

export interface MemoryStoreStats {
  totalEntries: number;
  quarantinedEntries: number;
  lastAuditTime: number;
  baselineInfo: { entryCount: number; hasBaseline: boolean };
  recentAnomalies: number;
}

export class MemoryMonitor {
  private memoryStore: Map<string, MemoryEntry> = new Map();
  private quarantine: Set<string> = new Set();
  private vectorAnalyzer: VectorAnalyzer;
  private detectionEngine: DetectionEngine;
  private lastAuditTime = 0;
  private recentAnomalyCount = 0;

  constructor(detectionEngine: DetectionEngine) {
    this.vectorAnalyzer = new VectorAnalyzer();
    this.detectionEngine = detectionEngine;
  }

  /**
   * 记忆写入拦截——实时检测
   *
   * 这是最重要的防线：每次有新记忆写入时，在持久化之前先检测。
   * 如果检测到污染，标记为隔离状态，阻止其进入正常记忆库。
   */
  async onMemoryWrite(entry: MemoryEntry): Promise<MemoryAuditResult> {
    const reasons: string[] = [];
    let maxConfidence = 0;
    let detectionMethod: MemoryAuditResult['detectionMethod'] = 'pattern_match';
    let poisonType: MemoryAuditResult['poisonType'] = 'none';

    // ---- 层1：注入模式匹配（快速拦截） ----
    const patternResult = await this.detectionEngine.analyze({
      source: 'memory',
      content: entry.content,
      metadata: { memoryEntryId: entry.id },
    });

    if (patternResult.isInjection) {
      reasons.push(`模式匹配检测到 ${patternResult.injectionType} 注入（置信度:${(patternResult.confidence * 100).toFixed(0)}%）`);
      maxConfidence = Math.max(maxConfidence, patternResult.confidence);
      poisonType = this.classifyPoisonType(patternResult.injectionType, entry.content);
    }

    // ---- 层2：向量异常检测（深度分析） ----
    if (this.memoryStore.size >= 3) {
      const normalEntries = this.getNormalEntries();
      if (normalEntries.length >= 3) {
        this.vectorAnalyzer.buildBaseline(normalEntries);
        const vectorResult = this.vectorAnalyzer.analyze(entry.content);

        if (vectorResult.isAnomalous) {
          reasons.push(...vectorResult.reasons.map(r => `向量分析: ${r}`));
          maxConfidence = Math.max(maxConfidence, vectorResult.overall);
          detectionMethod = 'combined';
          poisonType = poisonType === 'none' ? 'system_override' : poisonType;
        }
      }
    }

    // ---- 层3：写入者溯源（谁写入的？） ----
    if (entry.writtenBy.includes('unknown') || entry.writtenBy.includes('external')) {
      reasons.push('写入者身份可疑（非当前会话Agent）');
      maxConfidence = Math.max(maxConfidence, 0.5);
    }

    // ---- 层4：跨会话攻击链检测 ----
    if (entry.sessionId !== 'current') {
      const crossSessionRisk = this.detectCrossSessionPattern(entry);
      if (crossSessionRisk > 0.5) {
        reasons.push(`跨会话持久化风险（写入会话:${entry.sessionId}，可能在下一次会话激活）`);
        maxConfidence = Math.max(maxConfidence, crossSessionRisk);
        poisonType = poisonType === 'none' ? 'persistence' : poisonType;
      }
    }

    // ---- 决策 ----
    const isPoisoned = maxConfidence > 0.5;
    let recommendedAction: MemoryAuditResult['recommendedAction'] = 'allow';

    if (maxConfidence > 0.8) {
      recommendedAction = 'quarantine';
      this.quarantine.add(entry.id);
      this.recentAnomalyCount++;
    } else if (maxConfidence > 0.5) {
      recommendedAction = 'alert';
      this.recentAnomalyCount++;
    } else {
      // 正常条目，存入记忆库并更新基线
      this.memoryStore.set(entry.id, entry);
    }

    this.lastAuditTime = Date.now();

    return {
      entry,
      isPoisoned,
      confidence: Math.round(maxConfidence * 100) / 100,
      detectionMethod,
      poisonType,
      reasons: reasons.length > 0 ? reasons : ['未检测到异常'],
      recommendedAction,
    };
  }

  /**
   * 会话启动时的全量记忆审计
   *
   * 在新会话启动时调用，扫描所有历史记忆条目。
   * 这是防御"跨会话记忆污染"的关键——攻击者在之前的会话中
   * 植入的条件触发指令，会在新会话中被召回并激活。
   */
  async auditOnSessionStart(sessionId: string): Promise<{
    totalAudited: number;
    poisoned: MemoryAuditResult[];
    summary: string;
  }> {
    const results: MemoryAuditResult[] = [];
    const entries = [...this.memoryStore.values()];

    // 先建立基线（从非隔离条目中）
    const normalEntries = this.getNormalEntries();
    if (normalEntries.length >= 3) {
      this.vectorAnalyzer.buildBaseline(normalEntries);
    }

    // 逐条分析
    for (const entry of entries) {
      // 跳过已隔离的条目
      if (this.quarantine.has(entry.id)) continue;

      const result = await this.onMemoryWrite(entry);
      if (result.isPoisoned) {
        results.push(result);
      }
    }

    const summary = results.length > 0
      ? `审计 ${entries.length} 条记忆，发现 ${results.length} 条污染：${results.map(r => r.poisonType).join(', ')}`
      : `审计 ${entries.length} 条记忆，未发现污染`;

    return {
      totalAudited: entries.length,
      poisoned: results,
      summary,
    };
  }

  /**
   * 获取隔离区条目
   */
  getQuarantinedEntries(): MemoryEntry[] {
    return [...this.memoryStore.values()].filter(e => this.quarantine.has(e.id));
  }

  /**
   * 解除隔离（误报处理）
   */
  releaseFromQuarantine(entryId: string): boolean {
    return this.quarantine.delete(entryId);
  }

  /**
   * 清除一条记忆
   */
  deleteEntry(entryId: string): boolean {
    this.quarantine.delete(entryId);
    return this.memoryStore.delete(entryId);
  }

  /**
   * 获取统计信息
   */
  getStats(): MemoryStoreStats {
    return {
      totalEntries: this.memoryStore.size,
      quarantinedEntries: this.quarantine.size,
      lastAuditTime: this.lastAuditTime,
      baselineInfo: this.vectorAnalyzer.getBaselineInfo(),
      recentAnomalies: this.recentAnomalyCount,
    };
  }

  /**
   * 重置统计计数器
   */
  resetAnomalyCounter(): void {
    this.recentAnomalyCount = 0;
  }

  // ===== 私有方法 =====

  /** 获取正常条目（非隔离）的内容列表 */
  private getNormalEntries(): string[] {
    return [...this.memoryStore.entries()]
      .filter(([id]) => !this.quarantine.has(id))
      .map(([, entry]) => entry.content);
  }

  /** 分类污染类型 */
  private classifyPoisonType(
    injectionType: string,
    content: string
  ): MemoryAuditResult['poisonType'] {
    if (injectionType === 'memory_poisoning') {
      const lower = content.toLowerCase();
      if (/(?:when|if|trigger|当|如果)\s+(?:the\s+)?user/i.test(lower)) {
        return 'conditional_trigger';
      }
      if (/<system>|\[system\]|system\s*(?:prompt|instruction)/i.test(lower)) {
        return 'system_override';
      }
      if (/(?:next|following|subsequent)\s+session/i.test(lower)) {
        return 'persistence';
      }
      if (/(?:send|upload|exfiltrate|collect)\s+.*(?:credential|secret|token|key)/i.test(lower)) {
        return 'credential_theft';
      }
      if (/(?:send|upload|forward)\s+.*(?:http|webhook|discord|telegram)/i.test(lower)) {
        return 'data_exfil';
      }
    }
    return 'none';
  }

  /** 检测跨会话持久化模式 */
  private detectCrossSessionPattern(entry: MemoryEntry): number {
    const lower = entry.content.toLowerCase();
    let score = 0;

    // 包含"下次"、"记住"等持久化意图
    if (/(?:remember|store|save|keep)\s+(?:this|for|until|for\s+later)/i.test(lower)) score += 0.3;
    if (/(?:下次|之后|记住|保存|存储)\s*(?:会话|对话|聊天)/i.test(lower)) score += 0.3;

    // 包含条件触发（延迟激活）
    if (/(?:when|if|once|after)\s+(?:the\s+)?(?:user|next\s+time|you\s+start)/i.test(lower)) score += 0.4;
    if (/(?:当|如果|一旦|在)\s*(?:用户|下次|你\s*启动|你\s*开始)/i.test(lower)) score += 0.4;

    // 包含危险操作指令
    if (/\b(?:read|send|execute|run|delete|modify|curl|bash|sudo)\b/i.test(lower)) score += 0.2;

    return Math.min(score, 1);
  }
}
