/**
 * 会话级内容溯源与敏感数据流追踪。
 *
 * 只保存必要的短期匹配值用于后续外发检测；审计日志只记录标签和来源 ID，
 * 不记录秘密正文。
 */

import * as crypto from 'crypto';

export type ContentSourceType =
  | 'user_input'
  | 'external_resource'
  | 'memory'
  | 'mcp_response'
  | 'tool_description';

export type TrustLevel = 'trusted' | 'untrusted' | 'quarantined';

export interface ContentProvenance {
  id: string;
  sessionId: string;
  sourceType: ContentSourceType;
  origin: string;
  trustLevel: TrustLevel;
  contentHash: string;
  createdAt: number;
}

interface SensitiveValue {
  label: string;
  sourceId: string;
  value: string;
}

export interface SensitiveFlowMatch {
  label: string;
  sourceId: string;
}

export class ProvenanceTracker {
  private sources = new Map<string, ContentProvenance[]>();
  private sensitiveValues = new Map<string, SensitiveValue[]>();

  recordSource(
    sessionId: string,
    sourceType: ContentSourceType,
    origin: string,
    content: string,
    trustLevel: TrustLevel = 'untrusted'
  ): ContentProvenance {
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const source: ContentProvenance = {
      id: `src_${Date.now()}_${contentHash.slice(0, 10)}`,
      sessionId,
      sourceType,
      origin,
      trustLevel,
      contentHash,
      createdAt: Date.now(),
    };
    const records = this.sources.get(sessionId) ?? [];
    records.push(source);
    this.sources.set(sessionId, records.slice(-200));
    return source;
  }

  markQuarantined(sessionId: string, sourceId: string): void {
    const source = (this.sources.get(sessionId) ?? []).find(item => item.id === sourceId);
    if (source) source.trustLevel = 'quarantined';
  }

  /**
   * 从安全读取结果中提取敏感值。只在进程内短时保存，供之后的外发/子 Agent
   * 调用比对；不会将 value 写入审计日志。
   */
  recordSensitiveContent(sessionId: string, sourceId: string, content: string, pathHint?: string): string[] {
    const labels = new Set<string>();
    const values: SensitiveValue[] = [];
    const add = (label: string, value: string) => {
      const trimmed = value.trim();
      if (trimmed.length < 6 || trimmed.length > 4096) return;
      labels.add(label);
      values.push({ label, sourceId, value: trimmed });
    };

    if (/\.env(?:\.|$)|credentials|id_rsa|\.pem|\.key/i.test(pathHint ?? '')) {
      add('sensitive-file', content);
    }
    for (const match of content.matchAll(/(?:^|\n)\s*[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*=\s*([^\n#]+)/g)) {
      add('credential', match[1]);
    }
    for (const match of content.matchAll(/(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g)) {
      add('credential', match[0]);
    }

    if (values.length > 0) {
      const existing = this.sensitiveValues.get(sessionId) ?? [];
      const merged = [...existing, ...values].slice(-50);
      this.sensitiveValues.set(sessionId, merged);
    }
    return [...labels];
  }

  findSensitiveFlow(sessionId: string, outgoingContent: string): SensitiveFlowMatch[] {
    const matches: SensitiveFlowMatch[] = [];
    for (const item of this.sensitiveValues.get(sessionId) ?? []) {
      if (outgoingContent.includes(item.value)) {
        matches.push({ label: item.label, sourceId: item.sourceId });
      }
    }
    return [...new Map(matches.map(item => [`${item.label}:${item.sourceId}`, item])).values()];
  }

  getSources(sessionId: string): ContentProvenance[] {
    return [...(this.sources.get(sessionId) ?? [])];
  }

  clearSession(sessionId: string): void {
    this.sources.delete(sessionId);
    this.sensitiveValues.delete(sessionId);
  }
}
