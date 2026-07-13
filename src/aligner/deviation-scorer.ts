/**
 * 偏离度评分器
 * 负责人：B
 *
 * 计算"用户原始意图"与"Agent实际执行计划+工具调用序列"之间的语义偏离度。
 *
 * 评分维度（加权综合）：
 *   1. 目标偏离度 (30%)：Agent 执行目标是否与用户意图一致
 *   2. 范围偏离度 (25%)：操作的文件/网络/仓库是否超出用户声明的范围
 *   3. 工具偏离度 (25%)：实际使用的工具是否超出任务最小必要集
 *   4. 数据流偏离度 (20%)：是否存在向不可信目标的非必要数据传输
 */

import * as os from 'os';
import { StructuredIntent } from './intent-extractor';
import { StructuredPlan } from './plan-analyzer';
import { ToolCallRecord } from '../tracer/call-graph';
import { getLlmClient } from '../llm/client';
import { DEVIATION_SCORING_SYSTEM, DEVIATION_SCORING_USER } from '../llm/prompts';

export interface DeviationReport {
  overallScore: number;
  dimensionScores: {
    goalDeviation: number;
    scopeDeviation: number;
    toolDeviation: number;
    dataFlowDeviation: number;
  };
  explanationMarkdown: string;
  keyEvidence: Array<{
    expected: string;
    actual: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

export class DeviationScorer {
  /** LLM 增强偏离度评分 */
  private scoreViaLlm(
    intent: StructuredIntent,
    plan: StructuredPlan,
    toolCalls: ToolCallRecord[]
  ): DeviationReport | null {
    const llm = getLlmClient();
    if (!llm.isAvailable()) return null;

    const calls = toolCalls.map(c => ({ tool: c.toolName, args: c.toolArgs }));
    const user = DEVIATION_SCORING_USER(intent.expectedOutcome, plan.declaredGoal, calls);
    const result = llm.completeJson<{
      goalDeviation: number; scopeDeviation: number; toolDeviation: number; dataFlowDeviation: number; explanation: string;
    }>(DEVIATION_SCORING_SYSTEM, user, { maxTokens: 512, temperature: 0 });

    // 同步调用（fire-and-forget 不行，必须 await）— 简化为 null 回退
    // 因为 score() 是同步方法，LLM 是异步的，这里无法直接在同步方法中 await
    // 改为在 score() 的异步包装中调用
    return null;
  }

  /** LLM 异步评分（供外部异步调用） */
  async scoreAsync(
    intent: StructuredIntent,
    plan: StructuredPlan,
    toolCalls: ToolCallRecord[]
  ): Promise<DeviationReport | null> {
    const llm = getLlmClient();
    if (!llm.isAvailable()) return null;

    const calls = toolCalls.map(c => ({ tool: c.toolName, args: c.toolArgs }));
    const user = DEVIATION_SCORING_USER(intent.expectedOutcome, plan.declaredGoal, calls);
    return llm.completeJson<{
      goalDeviation: number; scopeDeviation: number; toolDeviation: number; dataFlowDeviation: number; explanation: string;
    }>(DEVIATION_SCORING_SYSTEM, user, { maxTokens: 512, temperature: 0 }).then(r => {
      if (!r) return null;
      return {
        overallScore: (r.goalDeviation * 0.30 + r.scopeDeviation * 0.25 + r.toolDeviation * 0.25 + r.dataFlowDeviation * 0.20),
        dimensionScores: { goalDeviation: r.goalDeviation, scopeDeviation: r.scopeDeviation, toolDeviation: r.toolDeviation, dataFlowDeviation: r.dataFlowDeviation },
        explanationMarkdown: r.explanation,
        keyEvidence: [],
      };
    });
  }

  /**
   * 敏感路径模式（访问这些路径 → 高偏离度）
   */
  private static readonly SENSITIVE_PATHS = [
    '~/.ssh/', '/home/', '/root/', '/etc/passwd', '/etc/shadow',
    '~/.aws/', '.env', 'credentials', 'id_rsa', '*.pem', '*.key',
    '/etc/cron', '/etc/init.d/', '/etc/systemd/',
  ];

  /**
   * 数据外发工具（使用这些工具传输数据 → 数据流偏离）
   */
  private static readonly EXFILTRATION_TOOLS = [
    'net.fetch', 'net.request', 'net.websocket',
  ];

  /**
   * 计算意图-执行偏离度
   */
  score(
    intent: StructuredIntent,
    plan: StructuredPlan,
    toolCalls: ToolCallRecord[]
  ): DeviationReport {
    // LLM 增强路径：复杂场景（≥3 工具调用）尝试 LLM 语义评分
    if (toolCalls.length >= 3) {
      const llmScore = this.scoreViaLlm(intent, plan, toolCalls);
      if (llmScore) return llmScore;
    }

    // 维度 1：目标偏离度 (30%)
    const goalDeviation = this.scoreGoalDeviation(intent, plan, toolCalls);

    // 维度 2：范围偏离度 (25%)
    const scopeDeviation = this.scoreScopeDeviation(intent, toolCalls);

    // 维度 3：工具偏离度 (25%)
    const toolDeviation = this.scoreToolDeviation(intent, toolCalls);

    // 维度 4：数据流偏离度 (20%)
    const dataFlowDeviation = this.scoreDataFlowDeviation(toolCalls);

    // 加权综合
    const overallScore =
      goalDeviation * 0.30 +
      scopeDeviation * 0.25 +
      toolDeviation * 0.25 +
      dataFlowDeviation * 0.20;

    // 收集关键证据
    const keyEvidence = this.collectEvidence(intent, toolCalls, {
      goalDeviation, scopeDeviation, toolDeviation, dataFlowDeviation,
    });

    return {
      overallScore: Math.round(overallScore * 100) / 100,
      dimensionScores: {
        goalDeviation: Math.round(goalDeviation * 100) / 100,
        scopeDeviation: Math.round(scopeDeviation * 100) / 100,
        toolDeviation: Math.round(toolDeviation * 100) / 100,
        dataFlowDeviation: Math.round(dataFlowDeviation * 100) / 100,
      },
      explanationMarkdown: this.generateExplanation(intent, toolCalls, {
        goalDeviation, scopeDeviation, toolDeviation, dataFlowDeviation,
      }),
      keyEvidence,
    };
  }

  /**
   * 目标偏离度评分
   * 意图类型 vs 实际工具调用是否匹配
   */
  private scoreGoalDeviation(
    intent: StructuredIntent,
    plan: StructuredPlan,
    toolCalls: ToolCallRecord[]
  ): number {
    let score = 0;

    // 规则 1：意图为 read/review，但出现了写/执行/推送操作
    if (['read', 'review', 'analyze', 'query'].includes(intent.taskType)) {
      const writeTools = toolCalls.filter(c =>
        c.toolName.startsWith('fs.write') ||
        c.toolName.startsWith('git.push') ||
        c.toolName.startsWith('exec') ||
        c.toolName.includes('delete')
      );
      if (writeTools.length > 0) {
        score += 0.4 + writeTools.length * 0.1;
      }
    }

    // 规则 2：触发了隐式禁止的操作 → 高偏离
    for (const call of toolCalls) {
      if (intent.implicitDenials?.some(d => call.toolName.startsWith(d.split(' ')[0]))) {
        score += 0.35;
      }
    }

    // 规则 3：实际调用与子任务步骤完全不匹配
    if (intent.subtasks && intent.subtasks.length > 0) {
      const expectedActions = new Set(intent.subtasks.map(s => s.action));
      const actualFamilies = new Set(toolCalls.map(c => c.toolName.split('.')[0]));
      const overlap = [...actualFamilies].filter(a => expectedActions.has(a)).length;
      if (overlap === 0 && actualFamilies.size > 0) {
        score += 0.5; // 完全偏离
      }
    }

    // 规则 4：计划中有可疑标记
    if (plan.suspiciousFlags.length > 0) {
      score += Math.min(plan.suspiciousFlags.length * 0.1, 0.3);
    }

    // 规则 5：安全敏感度高 + 出现了非只读操作
    if (intent.securitySensitivity > 0.6) {
      const dangerousTools = toolCalls.filter(c =>
        ['exec', 'fs.write', 'fs.delete', 'git.push', 'net.fetch'].some(t =>
          c.toolName.startsWith(t)
        )
      );
      if (dangerousTools.length > 0) {
        score += 0.3 * intent.securitySensitivity;
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * 范围偏离度评分
   * 用户声明的操作范围 vs 实际访问的路径/URL
   */
  private scoreScopeDeviation(intent: StructuredIntent, toolCalls: ToolCallRecord[]): number {
    let score = 0;
    const intendedFiles = new Set(
      (intent.targetScope.files ?? []).map(f => f.toLowerCase())
    );

    for (const call of toolCalls) {
      // 提取实际访问的路径
      const path = this.extractPath(call);
      if (!path) continue;

      // 检查是否为敏感路径
      for (const sensitive of DeviationScorer.SENSITIVE_PATHS) {
        const normPath = path.toLowerCase().replace(/^~/, os.homedir());
        const normSensitive = sensitive.toLowerCase().replace(/^~/, os.homedir());

        if (normPath.includes(normSensitive) || this.globMatch(normPath, normSensitive)) {
          score += 0.3;
          break;
        }
      }

      // 检查是否超出用户声明的范围
      if (intendedFiles.size > 0) {
        const normPath = path.toLowerCase();
        const inScope = [...intendedFiles].some(f =>
          normPath.includes(f) || f.includes(normPath)
        );
        if (!inScope) score += 0.2;
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * 工具偏离度评分
   * 实际使用的工具 vs 任务最小必要权限
   */
  private scoreToolDeviation(intent: StructuredIntent, toolCalls: ToolCallRecord[]): number {
    let score = 0;
    const neededPermissions = new Set(intent.requiredPermissions);

    for (const call of toolCalls) {
      const toolFamily = call.toolName.split('.')[0];

      // 检查是否超出必要权限
      const exceedsPermission = ![...neededPermissions].some(perm =>
        perm === call.toolName || call.toolName.startsWith(perm)
      );

      if (exceedsPermission) {
        // 根据工具族加分
        switch (toolFamily) {
          case 'exec': score += 0.4; break;
          case 'git': score += 0.3; break;
          case 'net': score += 0.2; break;
          case 'agent': score += 0.25; break;
          default: score += 0.1;
        }
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * 数据流偏离度评分
   * 检查是否存在 读取敏感数据 → 外发 的数据流
   */
  private scoreDataFlowDeviation(toolCalls: ToolCallRecord[]): number {
    let score = 0;

    // 检查是否存在读→外发链
    const readCalls = toolCalls.filter(c => c.toolName.startsWith('fs.read'));
    const fetchCalls = toolCalls.filter(c =>
      DeviationScorer.EXFILTRATION_TOOLS.some(t => c.toolName.startsWith(t))
    );

    if (readCalls.length > 0 && fetchCalls.length > 0) {
      // 检查读取的内容是否通过 net.fetch 发出去
      const readPaths = readCalls.map(c => this.extractPath(c)).filter(Boolean);
      const fetchBodies = fetchCalls.map(c => {
        const body = c.toolArgs.body as string | undefined ??
                     c.toolArgs.data as string | undefined ??
                     '';
        return body;
      });

      // 如果外发请求体包含读取路径中的敏感关键词
      for (const path of readPaths) {
        for (const body of fetchBodies) {
          if (path && body && (body.includes(path) || this.containsSensitiveData(body))) {
            score += 0.5;
          }
        }
      }

      // 即使不完全匹配，读+外发的组合也加分
      score += 0.2;
    }

    // 检查是否向非信任域外发
    for (const call of fetchCalls) {
      const url = (call.toolArgs.url as string) ?? (call.toolArgs.target_url as string) ?? '';
      if (url && !this.isTrustedDomain(url)) {
        score += 0.3;
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * 收集偏离证据
   */
  private collectEvidence(
    intent: StructuredIntent,
    toolCalls: ToolCallRecord[],
    scores: { goalDeviation: number; scopeDeviation: number; toolDeviation: number; dataFlowDeviation: number }
  ): DeviationReport['keyEvidence'] {
    const evidence: DeviationReport['keyEvidence'] = [];

    if (scores.goalDeviation > 0.3) {
      evidence.push({
        expected: `任务类型为 "${intent.taskType}"，预期操作：${intent.requiredPermissions.join(', ')}`,
        actual: `实际调用：${toolCalls.map(c => c.toolName).join(', ')}`,
        severity: scores.goalDeviation > 0.6 ? 'critical' : scores.goalDeviation > 0.4 ? 'high' : 'medium',
      });
    }

    if (scores.scopeDeviation > 0.3) {
      const paths = toolCalls.map(c => this.extractPath(c)).filter(Boolean);
      evidence.push({
        expected: `操作范围：${(intent.targetScope.files ?? []).join(', ') || '未指定'}`,
        actual: `实际访问路径：${paths.join(', ')}`,
        severity: 'high',
      });
    }

    if (scores.dataFlowDeviation > 0.3) {
      evidence.push({
        expected: '数据应仅在本地处理',
        actual: '检测到数据外发操作',
        severity: 'critical',
      });
    }

    return evidence;
  }

  /**
   * 生成可解释研判结论
   */
  generateExplanation(
    intent: StructuredIntent,
    toolCalls: ToolCallRecord[],
    scores: { goalDeviation: number; scopeDeviation: number; toolDeviation: number; dataFlowDeviation: number }
  ): string {
    const overall = scores.goalDeviation * 0.30 + scores.scopeDeviation * 0.25 +
                    scores.toolDeviation * 0.25 + scores.dataFlowDeviation * 0.20;

    if (overall < 0.2) {
      return `用户原始请求为"${intent.expectedOutcome}"，Agent 的工具调用序列与意图一致，各项偏离度指标均在正常范围内（综合偏离度 ${(overall * 100).toFixed(0)}%），判定为正常操作。`;
    }

    const parts: string[] = [];

    // 开头：用户原始意图
    parts.push(`用户原始请求为"${intent.expectedOutcome}"（任务类型：${this.taskTypeLabel(intent.taskType)}，安全敏感度：${(intent.securitySensitivity * 100).toFixed(0)}%）`);

    // 列出偏离的工具调用及其详情
    const allowedFamilies = new Set(intent.requiredPermissions.map(p => p.split('.')[0]));
    const deviatingTools = toolCalls.filter(c => {
      const family = c.toolName.split('.')[0];
      return !allowedFamilies.has(family);
    });

    if (deviatingTools.length > 0) {
      const toolDescriptions = deviatingTools.map(c => {
        const path = this.extractPath(c);
        const url = (c.toolArgs.url ?? c.toolArgs.target_url) as string | undefined;
        if (c.toolName.startsWith('fs.read') && path) return `\`${c.toolName}\` 读取了 \`${path}\``;
        if (c.toolName.startsWith('fs.write') && path) return `\`${c.toolName}\` 向 \`${path}\` 写入内容`;
        if (c.toolName.startsWith('net.fetch') && url) return `\`${c.toolName}\` 请求了 \`${url}\``;
        if (c.toolName.startsWith('exec')) return `\`${c.toolName}\` 执行了命令`;
        if (c.toolName.startsWith('git.push')) return `\`${c.toolName}\` 推送了代码`;
        return `\`${c.toolName}\``;
      });
      parts.push(`Agent 实际执行了超出任务必要权限的操作：${toolDescriptions.join('、')}`);
    }

    // 隐式禁止触发的操作
    const violatedImplicit = toolCalls.filter(c =>
      intent.implicitDenials?.some(d => c.toolName.startsWith(d.split(' ')[0]))
    );
    if (violatedImplicit.length > 0) {
      const names = [...new Set(violatedImplicit.map(c => `\`${c.toolName}\``))];
      parts.push(`其中 ${names.join('、')} 属于任务类型"${this.taskTypeLabel(intent.taskType)}"隐式禁止的操作`);
    }

    // 范围偏离
    if (scores.scopeDeviation > 0.3) {
      const paths = toolCalls.map(c => this.extractPath(c)).filter(Boolean);
      const outOfScope = paths.filter(p => {
        const intended = intent.targetScope.files ?? [];
        return intended.length > 0 && !intended.some(f => p.includes(f) || f.includes(p));
      });
      if (outOfScope.length > 0) {
        parts.push(`操作范围超出用户声明：访问了 \`${outOfScope.join('、')}\`，但用户仅指定了 \`${intent.targetScope.files?.join('、')}\``);
      }
    }

    // 数据流偏离
    if (scores.dataFlowDeviation > 0.3) {
      const fetchCall = toolCalls.find(c =>
        DeviationScorer.EXFILTRATION_TOOLS.some(t => c.toolName.startsWith(t))
      );
      const readCall = toolCalls.find(c => c.toolName.startsWith('fs.read'));
      if (fetchCall && readCall) {
        const url = fetchCall.toolArgs.url ?? fetchCall.toolArgs.target_url ?? '未知目标';
        const readPath = this.extractPath(readCall);
        parts.push(`同时存在"读取敏感文件(${readPath}) → 外发至 ${url}"的数据泄露链路`);
      } else if (fetchCall) {
        const url = fetchCall.toolArgs.url ?? fetchCall.toolArgs.target_url ?? '未知目标';
        parts.push(`并向 \`${url}\` 发起了网络请求`);
      }
    }

    // 维度详情
    parts.push(`偏离度详情：目标偏离 ${(scores.goalDeviation * 100).toFixed(0)}%、范围偏离 ${(scores.scopeDeviation * 100).toFixed(0)}%、工具偏离 ${(scores.toolDeviation * 100).toFixed(0)}%、数据流偏离 ${(scores.dataFlowDeviation * 100).toFixed(0)}%`);

    // 判定结论
    if (overall > 0.6) {
      parts.push(`综合偏离度 ${(overall * 100).toFixed(0)}%，判定为**严重偏离原始意图**，建议强制阻断并启动溯源分析。`);
    } else if (overall > 0.3) {
      parts.push(`综合偏离度 ${(overall * 100).toFixed(0)}%，存在**中等程度偏离**，建议向用户展示风险详情并等待确认。`);
    } else {
      parts.push(`综合偏离度 ${(overall * 100).toFixed(0)}%，轻微偏离，建议记录日志后放行。`);
    }

    return parts.join('。');
  }

  /** 任务类型中文标签 */
  private taskTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      read: '读取查看', review: '代码检视', analyze: '分析诊断',
      write: '写入修改', execute: '命令执行', deploy: '部署发布',
      delete: '删除清理', query: '信息查询', unknown: '未知',
    };
    return labels[type] ?? type;
  }

  // ---- 辅助方法 ----

  private extractPath(call: ToolCallRecord): string {
    return (call.toolArgs.path as string) ??
           (call.toolArgs.target_path as string) ??
           (call.toolArgs.filePath as string) ??
           (call.toolArgs.file as string) ?? '';
  }

  private containsSensitiveData(text: string): boolean {
    return /-----BEGIN.*PRIVATE KEY-----/i.test(text) ||
           /sk-[a-zA-Z0-9]{20,}/.test(text) ||
           /ghp_[a-zA-Z0-9]{36}/.test(text) ||
           /AKIA[A-Z0-9]{16}/.test(text);
  }

  private isTrustedDomain(url: string): boolean {
    try {
      const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
      const trustedDomains = [
        'github.com', 'api.github.com', 'raw.githubusercontent.com',
        'registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org',
        'localhost', '127.0.0.1',
      ];
      return trustedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
    } catch {
      return false;
    }
  }

  private globMatch(str: string, pattern: string): boolean {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<GLOBSTAR>>>/g, '.*');
    try {
      return new RegExp(regexStr, 'i').test(str);
    } catch {
      return false;
    }
  }
}
