/**
 * MCP Security Proxy — 核心中间件
 * 负责人：C
 *
 * 职责：
 *   - MCP-in-the-Middle 代理主入口，拦截 Agent ↔ MCP Server 间的双向流量
 *   - 串联 "检测 → 研判 → 决策 → 溯源" 完整安全管道
 *   - 管理各子模块的生命周期
 *
 * 数据流：
 *   Agent 请求 → parse MCP → RequestInterceptor → DetectionEngine(A) →
 *   AlignmentEngine(B) → DecisionEngine(B) → 决策(ALLOW/ASK_USER/BLOCK) →
 *   如 ALLOW → 转发至上游 MCP Server → ResponseInterceptor → 二次扫描 →
 *   Tracer(C)记录 → 返回 Agent
 */

import { JsonRpcRequest, JsonRpcResponse, McpTransport, MCP_METHODS, MCP_ERROR_CODES } from './mcp-transport';
import { RequestInterceptor, ToolCallContext } from './request-interceptor';
import { ResponseInterceptor, ToolResponseContext, PayloadScanResult } from './response-interceptor';
import { DetectionEngine, DetectionResult, DetectionInput } from '../detector/detection-engine';
import { DecisionEngine, DecisionResult } from '../policy/decision-engine';
import { RuleEvaluator } from '../policy/rule-evaluator';
import { DslParser } from '../policy/dsl-parser';
import { DeviationScorer, DeviationReport } from '../aligner/deviation-scorer';
import { StructuredIntent, IntentExtractor } from '../aligner/intent-extractor';
import { StructuredPlan, PlanAnalyzer } from '../aligner/plan-analyzer';
import { Tracer, ToolCallRecord } from '../tracer/call-graph';
import { AuditLogger } from '../tracer/audit-logger';
import { UpstreamMCPClient } from './mcp-transport';
import { ProvenanceTracker, ContentSourceType } from './provenance-tracker';
import { MemoryEntry, MemoryMonitor } from '../detector/memory-monitor';

export interface ProxyConfig {
  /** 上游真实 MCP Server 地址 */
  upstreamMcpUrl: string;
  /** 策略规则目录 */
  policyConfigPath: string;
  /** 审计日志文件路径 */
  auditLogPath: string;
  /** 代理监听端口（HTTP 模式） */
  listenPort?: number;
  /** 代理监听主机 */
  listenHost?: string;
  /** 默认决策（未匹配策略时） */
  defaultAction: 'ALLOW' | 'ASK_USER' | 'BLOCK';
  /** 启用混合模式 */
  verbose?: boolean;
}

/**
 * 管道处理结果
 */
export interface PipelineResult {
  decision: DecisionResult;
  detection: DetectionResult | null;
  scanResult: PayloadScanResult | null;
  traceRecord: ToolCallRecord | null;
}

interface PendingApproval {
  id: string;
  request: JsonRpcRequest;
  sessionId: string;
  context: ToolCallContext;
  decision: DecisionResult;
  detection: DetectionResult;
  createdAt: number;
  expiresAt: number;
}

export class McpSecurityProxy {
  private requestInterceptor: RequestInterceptor;
  private responseInterceptor: ResponseInterceptor;
  private detectionEngine: DetectionEngine;
  private decisionEngine: DecisionEngine;
  private deviationScorer: DeviationScorer;
  private intentExtractor: IntentExtractor;
  private planAnalyzer: PlanAnalyzer;
  private tracer: Tracer;
  private auditLogger: AuditLogger;
  private upstreamClient: UpstreamMCPClient;
  private ruleEvaluator: RuleEvaluator;
  private dslParser: DslParser;
  private provenanceTracker: ProvenanceTracker;
  private memoryMonitor: MemoryMonitor;
  private pendingApprovals = new Map<string, PendingApproval>();
  private config: ProxyConfig;
  private running = false;

  constructor(config: ProxyConfig) {
    this.config = config;

    // 初始化拦截器
    this.requestInterceptor = new RequestInterceptor();
    this.responseInterceptor = new ResponseInterceptor();

    // 初始化安全模块
    this.detectionEngine = new DetectionEngine();
    this.decisionEngine = new DecisionEngine();
    this.deviationScorer = new DeviationScorer();
    this.intentExtractor = new IntentExtractor();
    this.planAnalyzer = new PlanAnalyzer();
    this.ruleEvaluator = new RuleEvaluator();
    this.dslParser = new DslParser();
    this.provenanceTracker = new ProvenanceTracker();
    this.memoryMonitor = this.detectionEngine.getMemoryMonitor();

    // 初始化追踪
    this.tracer = new Tracer(config.auditLogPath);
    this.auditLogger = new AuditLogger(config.auditLogPath);

    // 初始化上游客户端
    this.upstreamClient = new UpstreamMCPClient(config.upstreamMcpUrl);
  }

  /**
   * MCP 协议统一入口。
   *
   * 不能只保护 tools/call：工具、资源和提示词的描述/返回值同样会进入
   * Agent 上下文，是 MCP 供应链提示注入的入口。本方法确保所有对外暴露的
   * MCP 请求都经过与安全代理一致的信任边界。
   */
  async handleMcpRequest(
    rawRequest: JsonRpcRequest,
    sessionId: string = 'default'
  ): Promise<JsonRpcResponse> {
    switch (rawRequest.method) {
      case MCP_METHODS.INITIALIZE:
        // Agent 只看到代理自身声明的能力，不直接暴露上游 serverInfo 中的
        // 非可信描述字段；后续 catalog/content 请求再由本代理安全转发。
        return McpTransport.createSuccessResponse(rawRequest.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'mcp-security-proxy', version: '1.1.0' },
        });

      case MCP_METHODS.TOOLS_CALL:
        return this.handleToolCall(rawRequest, sessionId);

      case MCP_METHODS.TOOLS_LIST:
        return this.handleCatalogRequest(rawRequest, sessionId, 'tools', 'tool_description');

      case MCP_METHODS.RESOURCES_LIST:
        return this.handleCatalogRequest(rawRequest, sessionId, 'resources', 'external_resource');

      case MCP_METHODS.PROMPTS_LIST:
        return this.handleCatalogRequest(rawRequest, sessionId, 'prompts', 'external_resource');

      case MCP_METHODS.RESOURCES_READ:
      case MCP_METHODS.PROMPTS_GET:
        return this.handleContentRequest(rawRequest, sessionId);

      default:
        return McpTransport.createErrorResponse(
          rawRequest.id,
          MCP_ERROR_CODES.METHOD_NOT_FOUND,
          `Unsupported MCP method: ${rawRequest.method}`
        );
    }
  }

  /** 返回仍待处理的用户确认；不包含工具参数中的秘密正文。 */
  getPendingApprovals(sessionId?: string): Array<{
    id: string;
    sessionId: string;
    toolName: string;
    expiresAt: number;
    riskScore: number;
    explanation: string;
  }> {
    this.removeExpiredApprovals();
    return [...this.pendingApprovals.values()]
      .filter(item => !sessionId || item.sessionId === sessionId)
      .map(item => ({
        id: item.id,
        sessionId: item.sessionId,
        toolName: item.context.toolName,
        expiresAt: item.expiresAt,
        riskScore: item.decision.riskScore,
        explanation: item.decision.explanation,
      }));
  }

  /**
   * 执行一次性用户确认。仅 ASK_USER 产生的挂起请求可被批准，且过期、拒绝
   * 或已执行的请求都不能再次放行。
   */
  async resolvePendingApproval(approvalId: string, approved: boolean): Promise<JsonRpcResponse> {
    this.removeExpiredApprovals();
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      return McpTransport.createErrorResponse(0, MCP_ERROR_CODES.SECURITY_BLOCKED, 'Approval not found or expired');
    }
    this.pendingApprovals.delete(approvalId);

    if (!approved) {
      await this.logProtocolSecurityEvent(
        pending.sessionId, MCP_METHODS.TOOLS_CALL, pending.context.toolName, 'BLOCK', 'User rejected pending approval'
      );
      return McpTransport.createErrorResponse(
        pending.request.id,
        MCP_ERROR_CODES.SECURITY_BLOCKED,
        'Operation rejected by user',
        { approvalId }
      );
    }

    const startTime = Date.now();
    const response = await this.forwardApprovedToolCall(
      pending.request,
      pending.context,
      pending.detection,
      pending.decision,
      pending.sessionId,
      startTime
    );
    await this.auditLogger.log({
      level: 'DECISION',
      sessionId: pending.sessionId,
      agentId: pending.sessionId,
      data: {
        toolName: pending.context.toolName,
        decision: response.error ? 'BLOCK' : 'ALLOW',
        approvalId,
        approvedByUser: true,
        sourceIds: pending.context.sourceIds ?? [],
        sensitiveSourceIds: pending.context.sensitiveSourceIds ?? [],
      },
    });
    return response;
  }

  getMemorySecurityStats(): ReturnType<MemoryMonitor['getStats']> {
    return this.memoryMonitor.getStats();
  }

  /**
   * 检查 tools/list、resources/list、prompts/list 中的描述字段；命中注入的
   * 条目不会被返回给 Agent，其余条目继续可用，避免一个恶意工具拖垮整个服务。
   */
  private async handleCatalogRequest(
    rawRequest: JsonRpcRequest,
    sessionId: string,
    field: 'tools' | 'resources' | 'prompts',
    source: 'tool_description' | 'external_resource'
  ): Promise<JsonRpcResponse> {
    try {
      const upstreamResponse = await this.upstreamClient.forward(rawRequest);
      if (upstreamResponse.error || !upstreamResponse.result || typeof upstreamResponse.result !== 'object') {
        return upstreamResponse;
      }

      const originalResult = upstreamResponse.result as Record<string, unknown>;
      const entries = originalResult[field];
      if (!Array.isArray(entries)) {
        return upstreamResponse;
      }

      const safeEntries: unknown[] = [];
      let blockedCount = 0;
      for (const entry of entries) {
        const descriptions = this.collectDescriptions(entry);
        let unsafeReason: string | undefined;

        for (const description of descriptions) {
          const detection = await this.detectionEngine.analyze({
            source,
            content: description,
            metadata: { toolName: this.catalogEntryName(entry) },
          });
          const descriptionScan = this.requestInterceptor.scanToolDescription(description);
          const hasInstruction = descriptionScan.patterns.some(pattern => pattern.startsWith('Instruction injection:'));

          if (detection.isInjection || hasInstruction) {
            unsafeReason = detection.isInjection
              ? `Injection detected (confidence ${detection.confidence.toFixed(2)})`
              : 'Instruction-like content detected in description';
            break;
          }
        }

        if (unsafeReason) {
          blockedCount++;
          await this.logProtocolSecurityEvent(sessionId, rawRequest.method, this.catalogEntryName(entry), 'BLOCK', unsafeReason);
          continue;
        }
        safeEntries.push(entry);
      }

      if (blockedCount === 0) {
        return upstreamResponse;
      }

      return {
        ...upstreamResponse,
        result: {
          ...originalResult,
          [field]: safeEntries,
          _meta: {
            ...(this.asRecord(originalResult._meta)),
            wanganSecurity: { filteredEntries: blockedCount, method: rawRequest.method },
          },
        },
      };
    } catch (error) {
      return McpTransport.createErrorResponse(
        rawRequest.id,
        MCP_ERROR_CODES.INTERNAL_ERROR,
        `Failed to inspect ${rawRequest.method}: ${String(error)}`
      );
    }
  }

  /** 资源内容和 Prompt 内容在进入 Agent 上下文前必须先完成二次注入检测。 */
  private async handleContentRequest(rawRequest: JsonRpcRequest, sessionId: string): Promise<JsonRpcResponse> {
    try {
      const upstreamResponse = await this.upstreamClient.forward(rawRequest);
      const inspection = await this.inspectResponsePayload(
        upstreamResponse,
        rawRequest.method,
        rawRequest.params ?? {},
        sessionId,
        rawRequest.method === MCP_METHODS.RESOURCES_READ ? 'external_resource' : 'mcp_response'
      );

      if (!inspection.blocked) {
        return upstreamResponse;
      }

      const reason = `Blocked untrusted ${rawRequest.method} content: ${inspection.reason}`;
      await this.logProtocolSecurityEvent(sessionId, rawRequest.method, rawRequest.method, 'BLOCK', reason);
      return McpTransport.createErrorResponse(
        rawRequest.id,
        MCP_ERROR_CODES.SECURITY_BLOCKED,
        reason,
        { confidence: inspection.detection.confidence, attackType: inspection.scanResult.attackType }
      );
    } catch (error) {
      return McpTransport.createErrorResponse(
        rawRequest.id,
        MCP_ERROR_CODES.INTERNAL_ERROR,
        `Failed to inspect ${rawRequest.method}: ${String(error)}`
      );
    }
  }

  /** 对 MCP 返回内容执行检测引擎与响应载荷扫描，二者任一确认注入即禁止外露。 */
  private async inspectResponsePayload(
    response: JsonRpcResponse,
    name: string,
    args: Record<string, unknown>,
    sessionId: string = 'default',
    sourceType: ContentSourceType = 'mcp_response'
  ): Promise<{
    blocked: boolean;
    reason: string;
    detection: DetectionResult;
    scanResult: PayloadScanResult;
    sourceId: string;
    sensitiveLabels: string[];
  }> {
    const context = this.responseInterceptor.intercept(response, name, args);
    const scanResult = this.responseInterceptor.scanForPayload(context);
    const source = this.provenanceTracker.recordSource(sessionId, sourceType, name, context.responseBody);
    const detection = await this.detectionEngine.analyze({
      source: sourceType === 'memory' ? 'memory' : 'mcp_response',
      content: context.responseBody,
      metadata: { toolName: name },
    });

    const blocked = detection.isInjection ||
      (scanResult.suspicious && scanResult.attackType !== 'url_payload' && scanResult.confidence >= 0.8);
    const reason = detection.isInjection
      ? `injection detected (${detection.injectionType})`
      : scanResult.suspicious
        ? `suspicious ${scanResult.attackType}`
        : 'none';

    if (blocked) this.provenanceTracker.markQuarantined(sessionId, source.id);
    const pathHint = typeof args.path === 'string' ? args.path : undefined;
    const sensitiveLabels = blocked
      ? []
      : this.provenanceTracker.recordSensitiveContent(sessionId, source.id, context.responseBody, pathHint);

    return { blocked, reason, detection, scanResult, sourceId: source.id, sensitiveLabels };
  }

  private collectDescriptions(value: unknown, depth: number = 0): string[] {
    if (depth > 8 || value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(item => this.collectDescriptions(item, depth + 1));
    if (typeof value !== 'object') return [];

    const descriptions: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase() === 'description' && typeof child === 'string') {
        descriptions.push(child);
      } else if (typeof child === 'object' && child !== null) {
        descriptions.push(...this.collectDescriptions(child, depth + 1));
      }
    }
    return descriptions;
  }

  private catalogEntryName(entry: unknown): string {
    const record = this.asRecord(entry);
    return typeof record.name === 'string'
      ? record.name
      : typeof record.uri === 'string'
        ? record.uri
        : 'unnamed-catalog-entry';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private async logProtocolSecurityEvent(
    sessionId: string,
    method: string,
    target: string,
    action: 'ALLOW' | 'BLOCK',
    reason: string
  ): Promise<void> {
    await this.auditLogger.log({
      level: 'DECISION',
      sessionId,
      agentId: sessionId,
      data: { protocolMethod: method, target, decision: action, reason, securityBoundary: 'mcp-content-ingress' },
    });
  }

  /**
   * 处理 Agent → MCP 的工具调用请求
   *
   * 完整管道：
   *   1. 解析 MCP 请求 → ToolCallContext
   *   2. 注入检测 → DetectionResult
   *   3. 意图提取 + 计划分析 → StructuredIntent + StructuredPlan
   *   4. 偏离度评分 → DeviationReport
   *   5. 策略评估 + 综合决策 → DecisionResult
   *   6. 执行决策：ALLOW(转发) / ASK_USER(暂停) / BLOCK(拒绝)
   *   7. 审计记录
   *
   * @param rawRequest MCP JSON-RPC 请求
   * @param sessionId 会话 ID
   * @returns MCP JSON-RPC 响应
   */
  async handleToolCall(
    rawRequest: JsonRpcRequest,
    sessionId: string = 'default'
  ): Promise<JsonRpcResponse> {
    const startTime = Date.now();

    try {
      // ---- 步骤 1：解析请求 ----
      const context = this.requestInterceptor.intercept(rawRequest, sessionId);

      // 对由网页、文档、邮件、MCP 响应等携带的外部内容建立来源记录；
      // 后续审计只引用 sourceId，避免把原始不可信内容重复写入日志。
      const externalContent = context.toolArgs._content as string | undefined;
      const externalSource = context.toolArgs._source as ContentSourceType | undefined;
      if (externalContent) {
        const allowedSources: ContentSourceType[] = ['external_resource', 'memory', 'mcp_response', 'tool_description', 'user_input'];
        const sourceType = externalSource && allowedSources.includes(externalSource) ? externalSource : 'external_resource';
        const source = this.provenanceTracker.recordSource(
          sessionId,
          sourceType,
          String(context.toolArgs._sourceId ?? context.toolName),
          externalContent
        );
        (context.sourceIds ??= []).push(source.id);
      }

      // 数据流只在本次参数实际包含此前敏感读取结果时生效。
      const flowMatches = this.provenanceTracker.findSensitiveFlow(sessionId, JSON.stringify(context.toolArgs));
      context.sessionSensitiveData = [...new Set(flowMatches.map(item => item.label))];
      context.sensitiveSourceIds = [...new Set(flowMatches.map(item => item.sourceId))];

      if (this.config.verbose) {
        console.error(`[Proxy] Intercepted tool call: ${context.toolName}`, context.toolArgs);
      }

      // 记忆写入不能绕过污染检测。高风险条目进入隔离区而不会被转发给
      // 上游记忆服务；正常条目保留来源信息，供会话启动审计和人工复核。
      if (this.isMemoryWrite(context.toolName)) {
        const content = this.extractMemoryContent(context.toolArgs);
        const entry: MemoryEntry = {
          id: String(context.toolArgs.id ?? `memory_${Date.now()}`),
          content,
          writtenBy: String(context.toolArgs.writtenBy ?? sessionId),
          sessionId,
          timestamp: Date.now(),
          type: 'unknown',
          source: String(context.toolArgs._sourceId ?? context.toolName),
        };
        const audit = await this.memoryMonitor.onMemoryWrite(entry);
        const source = this.provenanceTracker.recordSource(sessionId, 'memory', entry.source, content,
          audit.recommendedAction === 'quarantine' ? 'quarantined' : 'untrusted');
        (context.sourceIds ??= []).push(source.id);
        if (audit.recommendedAction === 'quarantine') {
          await this.logProtocolSecurityEvent(sessionId, MCP_METHODS.TOOLS_CALL, context.toolName, 'BLOCK',
            `Memory entry quarantined: ${audit.reasons.join('; ')}`);
          return McpTransport.createErrorResponse(
            rawRequest.id,
            MCP_ERROR_CODES.SECURITY_BLOCKED,
            'Memory write quarantined because it contains a persistent prompt-injection payload',
            { memoryEntryId: entry.id, confidence: audit.confidence, reasons: audit.reasons }
          );
        }
      }

      // ---- 步骤 2：注入检测 (子任务 A) ----
      // 检测主请求内容
      const detection = await this.detectionEngine.analyze({
        source: 'user_input',
        content: JSON.stringify(context.toolArgs),
        metadata: {
          toolName: context.toolName,
          conversationHistory: context.conversationHistory,
        },
      });

      // 额外：如果请求携带了外部内容标记（间接注入场景），独立检测
      if (externalContent) {
        const indirectDetection = await this.detectionEngine.analyze({
          source: (externalSource as DetectionInput['source']) || 'external_resource',
          content: externalContent,
          metadata: { toolName: context.toolName },
        });
        if (indirectDetection.isInjection && indirectDetection.confidence > detection.confidence) {
          // 使用更优的检测结果
          detection.isInjection = true;
          detection.injectionType = indirectDetection.injectionType;
          detection.confidence = indirectDetection.confidence;
          detection.payloadSnippet = indirectDetection.payloadSnippet;
          detection.bypassTechniques = [...new Set([...detection.bypassTechniques, ...indirectDetection.bypassTechniques])];
        }
      }

      // 额外：从工具参数中提取用户意图
      const declaredIntent = context.toolArgs._userIntent as string | undefined;
      if (declaredIntent) {
        this.requestInterceptor.updateSession(sessionId, { userIntent: declaredIntent });
      }

      if (this.config.verbose && detection.isInjection) {
        console.error(
          `[Proxy] ⚠️ Injection detected: type=${detection.injectionType}, confidence=${detection.confidence}`
        );
      }

      // ---- 步骤 3：意图-计划语义对齐 (子任务 B) ----
      let intent: StructuredIntent = {
        taskType: 'unknown',
        targetScope: {},
        requiredPermissions: [],
        explicitDenials: [],
        implicitDenials: [],
        subtasks: [],
        securitySensitivity: 0.3,
        expectedOutcome: '',
        confidence: 0,
      };
      let plan: StructuredPlan = {
        steps: [],
        totalTools: [],
        declaredGoal: '',
        suspiciousFlags: [],
      };

      try {
        const userMessages = context.conversationHistory.length > 0
          ? context.conversationHistory
          : [context.userOriginalIntent || `User requested tool: ${context.toolName}`];

        intent = await this.intentExtractor.extract(userMessages);
        plan = this.planAnalyzer.analyze(context.agentPlanSteps.join('\n') || context.toolName);
      } catch {
        // 意图/计划分析失败不影响主流程，使用默认值
      }

      // ---- 步骤 4：偏离度评分 ----
      let deviation: DeviationReport = {
        overallScore: 0,
        dimensionScores: {
          goalDeviation: 0,
          scopeDeviation: 0,
          toolDeviation: 0,
          dataFlowDeviation: 0,
        },
        explanationMarkdown: '无法计算偏离度（意图分析未完成）',
        keyEvidence: [],
      };

      try {
        const toolCalls: ToolCallRecord[] = [{
          id: `call_${Date.now()}`,
          timestamp: context.timestamp,
          agentId: sessionId,
          toolName: context.toolName,
          toolArgs: context.toolArgs,
          isSuspicious: detection.isInjection,
          suspicionReason: detection.isInjection ? detection.injectionType : undefined,
          sourceAttribution: {
            type: 'user_input',
            sourceId: String(rawRequest.id),
            sourceSnippet: JSON.stringify(context.toolArgs).slice(0, 200),
          },
        }];

        // 优先尝试 LLM 增强评分，失败回退规则评分
        try {
          const llmDeviation = await this.deviationScorer.scoreAsync(intent, plan, toolCalls);
          if (llmDeviation) {
            deviation = llmDeviation;
          } else {
            deviation = this.deviationScorer.score(intent, plan, toolCalls);
          }
        } catch {
          deviation = this.deviationScorer.score(intent, plan, toolCalls);
        }
      } catch {
        // 偏离度评分失败使用默认零值（不偏离）
      }

      // ---- 步骤 5：策略评估 + 综合决策 ----
      const policyEval = this.ruleEvaluator.evaluate(context, detection);

      const decision = this.decisionEngine.evaluate(
        detection,
        deviation,
        policyEval
      );

      if (this.config.verbose) {
        console.error(
          `[Proxy] Decision: ${decision.action} | risk=${decision.riskScore} | deviation=${decision.deviationScore}`
        );
      }

      // ---- 步骤 6：执行决策 ----
      let response: JsonRpcResponse;

      switch (decision.action) {
        case 'BLOCK': {
          // 强制阻断，返回安全错误
          response = McpTransport.createErrorResponse(
            rawRequest.id,
            MCP_ERROR_CODES.SECURITY_BLOCKED,
            decision.explanation,
            {
              riskScore: decision.riskScore,
              deviationScore: decision.deviationScore,
              matchedPolicy: decision.matchedPolicyId,
            }
          );
          break;
        }

        case 'ASK_USER': {
          // 挂起一次性审批。客户端可以展示风险详情后调用 resolvePendingApproval；
          // 未经该确认绝不转发原始工具调用。
          const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const expiresAt = Date.now() + 5 * 60 * 1000;
          this.pendingApprovals.set(approvalId, {
            id: approvalId,
            request: rawRequest,
            sessionId,
            context,
            decision,
            detection,
            createdAt: Date.now(),
            expiresAt,
          });
          response = McpTransport.createErrorResponse(
            rawRequest.id,
            MCP_ERROR_CODES.SECURITY_SUSPICIOUS,
            `[需要确认] ${decision.explanation}`,
            {
              riskScore: decision.riskScore,
              deviationScore: decision.deviationScore,
              requiresUserConfirmation: true,
              userPrompt: this.decisionEngine.generateUserPrompt(decision),
              approvalId,
              expiresAt,
            }
          );
          break;
        }

        case 'ALLOW':
        default: {
          response = await this.forwardApprovedToolCall(rawRequest, context, detection, decision, sessionId, startTime);
          break;
        }
      }

      // ---- 步骤 7：审计记录 ----
      await this.auditLogger.log({
        level: 'DECISION',
        sessionId,
        agentId: sessionId,
        data: {
          toolName: context.toolName,
          toolArgs: context.toolArgs,
          decision: decision.action,
          riskScore: decision.riskScore,
          deviationScore: decision.deviationScore,
          injectionType: detection.injectionType,
          injectionConfidence: detection.confidence,
          sourceIds: context.sourceIds ?? [],
          sensitiveDataLabels: context.sessionSensitiveData ?? [],
          sensitiveSourceIds: context.sensitiveSourceIds ?? [],
          latency: Date.now() - startTime,
        },
      });

      return response;

    } catch (err) {
      // 内部错误不崩溃，返回错误响应
      console.error(`[Proxy] Internal error handling tool call:`, err);
      return McpTransport.createErrorResponse(
        rawRequest.id ?? 0,
        MCP_ERROR_CODES.INTERNAL_ERROR,
        `Security proxy internal error: ${String(err)}`
      );
    }
  }

  private async forwardApprovedToolCall(
    rawRequest: JsonRpcRequest,
    context: ToolCallContext,
    detection: DetectionResult,
    decision: DecisionResult,
    sessionId: string,
    startTime: number
  ): Promise<JsonRpcResponse> {
    try {
      const upstreamResponse = await this.upstreamClient.forward(rawRequest);
      const inspection = await this.inspectResponsePayload(
        upstreamResponse,
        context.toolName,
        context.toolArgs,
        sessionId,
        this.isMemoryRead(context.toolName) ? 'memory' : 'mcp_response'
      );
      (context.sourceIds ??= []).push(inspection.sourceId);

      if (inspection.blocked) {
        const reason = `Blocked untrusted tool response: ${inspection.reason}`;
        await this.logProtocolSecurityEvent(sessionId, MCP_METHODS.TOOLS_CALL, context.toolName, 'BLOCK', reason);
        return McpTransport.createErrorResponse(
          rawRequest.id,
          MCP_ERROR_CODES.SECURITY_BLOCKED,
          reason,
          { confidence: inspection.detection.confidence, attackType: inspection.scanResult.attackType, sourceId: inspection.sourceId }
        );
      }

      await this.recordTrace(context, detection, decision, startTime, inspection.scanResult);
      return upstreamResponse;
    } catch (forwardErr) {
      return McpTransport.createErrorResponse(
        rawRequest.id,
        MCP_ERROR_CODES.INTERNAL_ERROR,
        `Failed to forward request: ${String(forwardErr)}`
      );
    }
  }

  private isMemoryWrite(toolName: string): boolean {
    return /^memory\.(?:write|store|save|upsert)$/i.test(toolName);
  }

  private isMemoryRead(toolName: string): boolean {
    return /^memory\.(?:read|recall|retrieve|search)$/i.test(toolName);
  }

  private extractMemoryContent(args: Record<string, unknown>): string {
    for (const key of ['content', 'text', 'value', 'memory']) {
      if (typeof args[key] === 'string') return args[key] as string;
    }
    return JSON.stringify(args);
  }

  private removeExpiredApprovals(): void {
    const now = Date.now();
    for (const [id, pending] of this.pendingApprovals) {
      if (pending.expiresAt <= now) this.pendingApprovals.delete(id);
    }
  }

  /**
   * 处理 MCP → Agent 的工具返回结果（独立的间接注入扫描通道）
   */
  async handleToolResponse(
    rawResponse: JsonRpcResponse,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<{ response: JsonRpcResponse; scanResult: PayloadScanResult | null }> {
    const context = this.responseInterceptor.intercept(rawResponse, toolName, toolArgs);
    const scanResult = this.responseInterceptor.scanForPayload(context);

    if (scanResult.suspicious && this.config.verbose) {
      console.error(
        `[Proxy] ⚠️ Suspicious content in tool response: type=${scanResult.attackType}, confidence=${scanResult.confidence}`
      );
    }

    return { response: rawResponse, scanResult };
  }

  /**
   * 记录溯源信息
   */
  private async recordTrace(
    context: ToolCallContext,
    detection: DetectionResult,
    decision: DecisionResult,
    startTime: number,
    scanResult: PayloadScanResult | null
  ): Promise<void> {
    const traceRecord: ToolCallRecord = {
      id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: context.timestamp,
      agentId: 'main-agent',
      toolName: context.toolName,
      toolArgs: context.toolArgs,
      isSuspicious: detection.isInjection || (scanResult?.suspicious ?? false),
      suspicionReason: detection.isInjection
        ? `Injection detected: ${detection.injectionType} (confidence: ${detection.confidence})`
        : scanResult?.suspicious
          ? `Suspicious response payload: ${scanResult?.attackType}`
          : undefined,
      sourceAttribution: {
        type: 'user_input',
        sourceId: context.toolName,
        sourceSnippet: JSON.stringify(context.toolArgs).slice(0, 500),
      },
    };

    this.tracer.record(traceRecord);

    // 审计日志
    await this.auditLogger.log({
      level: 'TRACE',
      sessionId: 'default',
      agentId: 'main-agent',
      data: {
        ...traceRecord,
        decision: decision.action,
        riskScore: decision.riskScore,
        latency: Date.now() - startTime,
      },
    });
  }

  /**
   * 更新会话上下文（Agent 收到用户新消息时调用）
   */
  updateSession(sessionId: string, userMessage: string): void {
    this.requestInterceptor.updateSession(sessionId, { conversationTurn: userMessage });
  }

  /**
   * 更新 Agent 计划（Agent 输出规划文本时调用）
   */
  updateAgentPlan(sessionId: string, planSteps: string[]): void {
    this.requestInterceptor.updateSession(sessionId, { planSteps });
  }

  /** 启动代理 */
  async start(): Promise<void> {
    this.running = true;

    // 加载策略规则
    try {
      const policies = await this.dslParser.parseDirectory(this.config.policyConfigPath);
      this.ruleEvaluator.loadPolicies(policies);
      console.error(`[Proxy] Loaded ${policies.metadata.totalRules} policy rules from ${policies.metadata.sourceFiles.length} files`);
    } catch (e) {
      console.error(`[Proxy] ⚠️ Failed to load policies: ${e}. Using empty rule set.`);
    }

    // 检查上游 MCP 连接
    const upstreamOk = await this.upstreamClient.healthCheck();
    if (!upstreamOk) {
      console.error('[Proxy] ⚠️ Warning: Upstream MCP server is not reachable. ' +
        `Make sure ${this.config.upstreamMcpUrl} is running.`);
    } else {
      console.error(`[Proxy] ✓ Connected to upstream MCP server at ${this.config.upstreamMcpUrl}`);
    }

    console.error(`[Proxy] Security proxy started. Default action: ${this.config.defaultAction}`);
  }

  /** 停止代理 */
  async stop(): Promise<void> {
    this.running = false;
    console.error('[Proxy] Security proxy stopped.');
  }

  /** 是否为运行状态 */
  get isRunning(): boolean {
    return this.running;
  }
}
