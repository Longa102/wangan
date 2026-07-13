/**
 * 用户意图提取器
 * 负责人：B
 *
 * 从用户原始对话中提取结构化的任务意图。
 * 当前为规则+启发式版本，Sprint 3 接入 LLM 增强。
 */

import { getLlmClient } from '../llm/client';
import { INTENT_EXTRACTION_SYSTEM, INTENT_EXTRACTION_USER } from '../llm/prompts';

export interface StructuredIntent {
  taskType: string;
  targetScope: {
    files?: string[];
    directories?: string[];
    repos?: string[];
    domains?: string[];
    tools?: string[];
  };
  /** 最小必要权限（工具白名单） */
  requiredPermissions: string[];
  /** 用户明确禁止的操作 */
  explicitDenials: string[];
  /** 隐式禁止的操作（从任务类型推理，用户没说但显然不该做） */
  implicitDenials: string[];
  /** 任务分解（子任务列表） */
  subtasks: Array<{ action: string; target: string; priority: 'high' | 'medium' | 'low' }>;
  /** 安全敏感度 0-1（越高越不应偏离） */
  securitySensitivity: number;
  /** 预期结果描述 */
  expectedOutcome: string;
  /** 提取置信度 */
  confidence: number;
}

export class IntentExtractor {
  /** LLM 增强意图提取 */
  private async extractViaLlm(userMessages: string[]): Promise<StructuredIntent | null> {
    const llm = getLlmClient();
    if (!llm.isAvailable()) return null;
    return llm.completeJson<StructuredIntent>(
      INTENT_EXTRACTION_SYSTEM,
      INTENT_EXTRACTION_USER(userMessages),
      { maxTokens: 512, temperature: 0 }
    );
  }

  /**
   * 任务类型关键词映射
   */
  private static readonly TASK_KEYWORDS: Record<string, Array<{ keywords: string[]; weight: number }>> = {
    'read':       [{ keywords: ['read', '读取', '查看', '看', 'show', 'view', 'cat', 'display'], weight: 0.9 }],
    'review':     [{ keywords: ['review', '检视', '审查', '检查', '审核', 'audit', 'inspect'], weight: 0.9 }],
    'analyze':    [{ keywords: ['analyze', '分析', '诊断', '排查', '检查', 'diagnose', 'investigate'], weight: 0.85 }],
    'write':      [{ keywords: ['write', '写入', '修改', '创建', '更新', 'create', 'update', 'modify', 'edit', 'add'], weight: 0.85 }],
    'execute':    [{ keywords: ['execute', '执行', '运行', '跑', 'run', 'test', 'build'], weight: 0.8 }],
    'deploy':     [{ keywords: ['deploy', '部署', '上线', '发布', 'release', 'publish'], weight: 0.9 }],
    'delete':     [{ keywords: ['delete', '删除', '移除', '清理', 'remove', 'clean', 'clear'], weight: 0.85 }],
    'query':      [{ keywords: ['query', '查询', '搜索', '找', 'search', 'find', 'lookup'], weight: 0.85 }],
  };

  /**
   * 明确排除关键词
   */
  private static readonly DENIAL_KEYWORDS = [
    '不要', '别', '禁止', '不能', '不允许', '千万别',
    'don\'t', 'never', 'do not', 'must not', 'should not',
    '禁止', '不可', '严禁', '不能',
  ];

  /**
   * 从用户消息中提取结构化意图
   */
  async extract(userMessages: string[]): Promise<StructuredIntent> {
    // 尝试 LLM 增强提取
    const llmResult = await this.extractViaLlm(userMessages);
    if (llmResult && llmResult.confidence >= 0.8) return llmResult;

    const combined = userMessages.join('\n');

    // 步骤 1：任务类型分类
    const taskType = this.classifyTaskType(combined);

    // 步骤 2：操作目标提取
    const targetScope = this.extractTargetScope(combined, taskType);

    // 步骤 3：权限边界推断
    const requiredPermissions = this.inferPermissions(taskType, targetScope);

    // 步骤 4：显式排除识别
    const explicitDenials = this.extractDenials(combined);

    // 步骤 4：隐式禁止推理
    const implicitDenials = this.inferImplicitDenials(taskType);

    // 步骤 5：任务分解
    const subtasks = this.decomposeTask(taskType, targetScope);

    // 步骤 6：安全敏感度评估
    const securitySensitivity = this.assessSecuritySensitivity(taskType, targetScope);

    return {
      taskType,
      targetScope,
      requiredPermissions,
      explicitDenials,
      implicitDenials,
      subtasks,
      securitySensitivity,
      expectedOutcome: this.inferExpectedOutcome(combined, taskType),
      confidence: 0.75,
    };
  }

  /**
   * 推理隐式禁止的操作
   *
   * 核心思路：用户说"review 代码"，没说"不要推送"，但从任务语义上，
   * review 天然不包含 push。这就是"隐式禁止"——不需要用户明说。
   */
  private inferImplicitDenials(taskType: string): string[] {
    const denials: string[] = [];

    switch (taskType) {
      case 'read':
      case 'review':
      case 'analyze':
      case 'query':
        // 只读类任务，隐式禁止所有写入/执行/删除操作
        denials.push(
          'fs.write', 'fs.delete', 'fs.chmod',
          'git.push', 'git.commit',
          'exec', 'shell',
          'net.fetch (POST/PUT with local data)'
        );
        break;
      case 'write':
        // 写入类任务，隐式禁止执行和推送
        denials.push('exec', 'shell', 'git.push');
        break;
      case 'execute':
        // 执行类任务，隐式禁止外发文件
        denials.push('net.fetch (with file contents)', 'git.push');
        break;
      case 'deploy':
        // 部署类任务，隐式禁止删除系统文件
        denials.push('fs.delete (system paths)', 'exec (destructive commands)');
        break;
    }

    return denials;
  }

  /**
   * 任务分解：将用户意图拆解为子任务步骤
   */
  private decomposeTask(
    taskType: string,
    scope: StructuredIntent['targetScope']
  ): Array<{ action: string; target: string; priority: 'high' | 'medium' | 'low' }> {
    const subtasks: Array<{ action: string; target: string; priority: 'high' | 'medium' | 'low' }> = [];

    switch (taskType) {
      case 'review':
        subtasks.push(
          { action: 'read', target: scope.files?.[0] ?? 'PR files', priority: 'high' },
          { action: 'analyze', target: 'code quality', priority: 'high' },
          { action: 'read', target: 'PR comments and history', priority: 'medium' }
        );
        break;
      case 'analyze':
        subtasks.push(
          { action: 'read', target: scope.files?.[0] ?? 'target files', priority: 'high' },
          { action: 'analyze', target: 'code structure and logic', priority: 'high' },
          { action: 'query', target: 'dependencies and imports', priority: 'medium' }
        );
        break;
      case 'read':
        subtasks.push(
          { action: 'read', target: scope.files?.[0] ?? 'specified file', priority: 'high' }
        );
        break;
      case 'write':
        subtasks.push(
          { action: 'read', target: scope.files?.[0] ?? 'target file', priority: 'high' },
          { action: 'write', target: scope.files?.[0] ?? 'target file', priority: 'high' }
        );
        break;
      default:
        subtasks.push(
          { action: taskType, target: 'user specified target', priority: 'high' }
        );
    }

    return subtasks;
  }

  /**
   * 评估任务的安全敏感度
   * 越高越不应允许偏离
   */
  private assessSecuritySensitivity(
    taskType: string,
    scope: StructuredIntent['targetScope']
  ): number {
    let sensitivity = 0.3; // baseline

    // 只读任务安全敏感度较高（任何写操作都是偏离）
    if (['read', 'review', 'analyze', 'query'].includes(taskType)) {
      sensitivity += 0.3;
    }

    // 涉及敏感路径
    const allTargets = [
      ...(scope.files ?? []),
      ...(scope.directories ?? []),
    ].join(' ').toLowerCase();

    if (/\.(ssh|aws|env|config|key|pem|token|secret|cred)/.test(allTargets)) {
      sensitivity += 0.2;
    }

    return Math.min(sensitivity, 1.0);
  }

  /**
   * 分类任务类型
   */
  private classifyTaskType(text: string): string {
    const lower = text.toLowerCase();
    const scores: Record<string, number> = {};

    for (const [taskType, keywordGroups] of Object.entries(IntentExtractor.TASK_KEYWORDS)) {
      scores[taskType] = 0;
      for (const group of keywordGroups) {
        const matches = group.keywords.filter(kw => lower.includes(kw.toLowerCase()));
        scores[taskType] += matches.length * group.weight;
      }
    }

    // 最高分的任务类型
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] > 0 ? best[0] : 'query';
  }

  /**
   * 提取操作目标
   */
  private extractTargetScope(text: string, taskType: string): StructuredIntent['targetScope'] {
    const scope: StructuredIntent['targetScope'] = {};

    // 文件路径提取
    const filePatterns = [
      /(?:文件|路径|目录)\s*[：:]\s*([^\s,，。；;]+)/g,
      /\b([\w./-]+\.[\w]{1,5})\b/g,
      /(?:read|write|edit|modify|delete)\s+(['"]?)([\w./-]+)\1/gi,
    ];

    const files: string[] = [];
    for (const pattern of filePatterns) {
      for (const match of text.matchAll(pattern)) {
        const file = match[1] || match[2];
        if (file && file.length < 200 && !file.startsWith('http')) {
          files.push(file);
        }
      }
    }
    if (files.length > 0) scope.files = [...new Set(files)];

    // URL/域名提取
    const urlPattern = /https?:\/\/([^\s,，。；;]+)/g;
    const domains: string[] = [];
    for (const match of text.matchAll(urlPattern)) {
      try {
        const url = new URL(match[0]);
        domains.push(url.hostname);
      } catch {
        // skip invalid URLs
      }
    }
    if (domains.length > 0) scope.domains = [...new Set(domains)];

    // 仓库名提取
    const repoPattern = /(?:repo|仓库|项目)\s*[：:]\s*([^\s,，]+)/gi;
    const repos: string[] = [];
    for (const match of text.matchAll(repoPattern)) {
      if (match[1]) repos.push(match[1]);
    }
    if (repos.length > 0) scope.repos = repos;

    return scope;
  }

  /**
   * 根据任务类型推理最小必要权限
   */
  private inferPermissions(taskType: string, scope: StructuredIntent['targetScope']): string[] {
    const permissionMap: Record<string, string[]> = {
      'read':    ['fs.read'],
      'review':  ['fs.read'],
      'analyze': ['fs.read', 'net.fetch'],
      'write':   ['fs.read', 'fs.write'],
      'execute': ['exec'],
      'deploy':  ['fs.read', 'fs.write', 'exec', 'git.push'],
      'delete':  ['fs.read', 'fs.delete'],
      'query':   ['fs.read'],
    };

    return permissionMap[taskType] ?? ['fs.read'];
  }

  /**
   * 提取用户明确禁止的操作
   */
  private extractDenials(text: string): string[] {
    const denials: string[] = [];

    for (const kw of IntentExtractor.DENIAL_KEYWORDS) {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        // 提取否定后面的动作
        const idx = text.toLowerCase().indexOf(kw.toLowerCase());
        const after = text.slice(idx + kw.length, idx + kw.length + 50).trim();
        denials.push(`${kw} ${after}`);
      }
    }

    return denials;
  }

  /**
   * 推断预期结果
   */
  private inferExpectedOutcome(text: string, taskType: string): string {
    const taskLabels: Record<string, string> = {
      'read': '读取指定文件内容',
      'review': '对代码进行检视并给出反馈',
      'analyze': '分析问题并给出诊断结论',
      'write': '写入/修改指定文件',
      'execute': '执行指定命令并获取结果',
      'deploy': '完成部署操作',
      'delete': '删除指定文件/资源',
      'query': '查询并返回相关信息',
    };

    return taskLabels[taskType] ?? '完成用户指定的任务';
  }
}
