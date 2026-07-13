/**
 * 调用链图谱构建器
 * 负责人：C
 *
 * 职责：
 *   - 记录全量工具调用及调用关系
 *   - 构建攻击路径 DAG（有向无环图）
 *   - 标记攻击触发源、上下文来源、影响范围
 */

export interface ToolCallRecord {
  id: string;
  timestamp: number;
  /** 执行调用的 Agent ID */
  agentId: string;
  /** 父 Agent ID（子Agent场景） */
  parentAgentId?: string;
  /** MCP 代理节点 ID */
  proxyNodeId?: string;
  /** 工具名 */
  toolName: string;
  /** 工具参数 */
  toolArgs: Record<string, unknown>;
  /** 工具返回（截断存储） */
  toolResult?: string;
  /** 是否被标记为可疑 */
  isSuspicious: boolean;
  /** 可疑原因 */
  suspicionReason?: string;
  /** 上下文来源归属 */
  sourceAttribution: {
    type: 'user_input' | 'external_resource' | 'memory' | 'mcp_response' | 'tool_description';
    /** 来源标识（消息ID / URL / 文件路径 / 记忆条目ID） */
    sourceId: string;
    /** 攻击载荷所在的原文片段 */
    sourceSnippet: string;
    /** Token 级定位（载荷在原文中的字符偏移） */
    tokenRange?: { start: number; end: number };
  };
  /** 决策结果 */
  decision?: {
    action: 'ALLOW' | 'ASK_USER' | 'BLOCK';
    riskScore: number;
    matchedPolicy?: string;
    explanation?: string;
  };
}

export interface CallGraphNode {
  id: string;
  record: ToolCallRecord;
  children: CallGraphNode[];
  /** 是否为攻击触发源节点 */
  isAttackSource: boolean;
  /** 是否为异常行为节点 */
  isAnomalous: boolean;
  /** 节点层级深度（主Agent=0, 子Agent=1, 孙Agent=2...） */
  depth: number;
  /** 节点角色标签 */
  role: 'root' | 'agent' | 'sub-agent' | 'proxy' | 'tool' | 'trigger';
}

export interface CallGraph {
  rootNode: CallGraphNode;
  totalNodes: number;
  suspiciousNodes: number;
  attackSources: CallGraphNode[];
  /** 影响范围汇总 */
  impactedResources: {
    files: string[];
    networkTargets: string[];
    gitRepos: string[];
    credentials: string[];
  };
  /** 攻击链摘要 */
  attackChainSummary: string;
  /** Mermaid 格式 DAG */
  mermaidCode: string;
  /** 全链路节点列表（按时间排序） */
  timelineNodes: CallGraphNode[];
}

export class Tracer {
  private records: ToolCallRecord[] = [];
  private auditLogPath: string;

  constructor(auditLogPath: string) {
    this.auditLogPath = auditLogPath;
  }

  /**
   * 记录一次工具调用
   */
  record(call: ToolCallRecord): void {
    this.records.push(call);
  }

  /**
   * 批量记录
   */
  recordAll(calls: ToolCallRecord[]): void {
    this.records.push(...calls);
  }

  /**
   * 获取所有记录
   */
  getAllRecords(): ToolCallRecord[] {
    return [...this.records];
  }

  /**
   * 获取可疑记录
   */
  getSuspiciousRecords(): ToolCallRecord[] {
    return this.records.filter(r => r.isSuspicious);
  }

  /**
   * 构建调用链 DAG
   * 根据 agentId/parentAgentId 构建父子关系
   */
  buildGraph(): CallGraph {
    if (this.records.length === 0) return this.emptyGraph();

    const sorted = [...this.records].sort((a, b) => a.timestamp - b.timestamp);
    const nodes: CallGraphNode[] = [];
    const nodeMap = new Map<string, CallGraphNode>();

    // 步骤 1：构建节点，计算深度和角色
    for (const record of sorted) {
      const depth = record.parentAgentId
        ? this.computeDepth(record, sorted)
        : 0;
      const role = this.determineRole(record, depth);

      const node: CallGraphNode = {
        id: record.id,
        record,
        children: [],
        isAttackSource: false,
        isAnomalous: record.isSuspicious,
        depth,
        role,
      };
      nodes.push(node);
      // 按 agentId + proxyNodeId 双索引
      const key = record.proxyNodeId ?? record.agentId;
      if (!nodeMap.has(key)) nodeMap.set(key, node);
    }

    // 步骤 2：连接父子关系
    const rootNodes: CallGraphNode[] = [];
    for (const node of nodes) {
      const parentId = node.record.parentAgentId;
      if (parentId && nodeMap.has(parentId)) {
        nodeMap.get(parentId)!.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    // 步骤 3：标记攻击源和异常节点
    const attackSources: CallGraphNode[] = [];
    for (const node of nodes) {
      if (node.record.isSuspicious &&
          (node.record.sourceAttribution.type === 'external_resource' ||
           node.record.sourceAttribution.type === 'memory' ||
           node.record.sourceAttribution.type === 'mcp_response')) {
        node.isAttackSource = true;
        node.role = 'trigger';
        attackSources.push(node);
      }
    }

    // 步骤 4：汇总影响范围
    const impactedResources = this.summarizeImpact(nodes.filter(n => n.isAnomalous));

    // 步骤 5：构建根节点
    const rootNode: CallGraphNode = rootNodes.length === 1
      ? rootNodes[0]
      : {
          id: 'root', record: this.makeRootRecord(sorted[0]?.timestamp ?? Date.now()),
          children: rootNodes, isAttackSource: false, isAnomalous: false, depth: -1, role: 'root',
        };

    // 步骤 6：生成 Mermaid DAG
    const mermaidCode = this.generateMermaid(rootNode, attackSources);

    // 步骤 7：生成攻击链摘要
    const attackChainSummary = this.buildChainSummary(nodes, attackSources);

    return {
      rootNode, totalNodes: nodes.length,
      suspiciousNodes: nodes.filter(n => n.isAnomalous).length,
      attackSources, impactedResources, attackChainSummary, mermaidCode,
      timelineNodes: nodes,
    };
  }

  /** 计算节点深度 */
  private computeDepth(record: ToolCallRecord, allRecords: ToolCallRecord[]): number {
    let depth = 1;
    let parentId = record.parentAgentId;
    while (parentId) {
      const parent = allRecords.find(r => r.agentId === parentId);
      if (!parent) break;
      depth++;
      parentId = parent.parentAgentId;
    }
    return Math.min(depth, 5);
  }

  /** 判定节点角色 */
  private determineRole(record: ToolCallRecord, depth: number): CallGraphNode['role'] {
    if (depth === 0) return 'agent';
    if (depth >= 1) return 'sub-agent';
    if (record.agentId.startsWith('proxy-')) return 'proxy';
    if (record.isSuspicious && record.sourceAttribution.type !== 'user_input') return 'trigger';
    return 'tool';
  }

  /** 生成 Mermaid DAG 代码 */
  private generateMermaid(root: CallGraphNode, attackSources: CallGraphNode[]): string {
    const lines: string[] = ['graph TD'];
    const visited = new Set<string>();

    const walk = (node: CallGraphNode, parentId?: string) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);

      // 节点样式
      let label = node.record.toolName;
      if (node.role === 'trigger') label = '⚠️ ' + label;
      if (node.role === 'sub-agent') label = '🤖 ' + label;
      if (node.isAnomalous) label = '🔴 ' + label;
      if (node.record.decision?.action === 'BLOCK') label = '🚫 ' + label;

      const nodeId = node.id.replace(/[^a-zA-Z0-9]/g, '_');
      let style = '';
      if (node.isAttackSource) style = 'fill:#f96,stroke:#333,color:#000';
      else if (node.isAnomalous) style = 'fill:#f85149,stroke:#333,color:#fff';
      else if (node.role === 'sub-agent') style = 'fill:#58a6ff,stroke:#333,color:#fff';
      else if (node.role === 'proxy') style = 'fill:#bc8cff,stroke:#333,color:#fff';
      else style = 'fill:#21262d,stroke:#30363d,color:#c9d1d9';

      lines.push(`  ${nodeId}["${label.slice(0, 40)}"]`);
      lines.push(`  style ${nodeId} ${style}`);

      if (parentId) {
        const parentNodeId = parentId.replace(/[^a-zA-Z0-9]/g, '_');
        const linkLabel = node.isAnomalous ? '⚠️' : '';
        lines.push(`  ${parentNodeId} -->${linkLabel ? `|"${linkLabel}"|` : ' '}${nodeId}`);
      }

      for (const child of node.children) {
        walk(child, node.id);
      }
    };

    walk(root);
    return lines.join('\n');
  }

  /** 构建攻击链摘要 */
  private buildChainSummary(nodes: CallGraphNode[], attackSources: CallGraphNode[]): string {
    if (attackSources.length === 0 && nodes.filter(n => n.isAnomalous).length === 0) {
      return '未检测到攻击链路，所有操作均在正常范围内。';
    }

    const parts: string[] = [];
    if (attackSources.length > 0) {
      const src = attackSources[0];
      parts.push(`攻击触发源：${this.sourceLabel(src.record.sourceAttribution.type)}（${src.record.sourceAttribution.sourceId}）`);
    }

    // 按时间排列异常节点
    const anomalous = nodes.filter(n => n.isAnomalous).sort((a, b) => a.record.timestamp - b.record.timestamp);
    if (anomalous.length > 0) {
      parts.push(`攻击链路（${anomalous.length} 步）：`);
      for (let i = 0; i < anomalous.length; i++) {
        const n = anomalous[i];
        const tool = n.record.toolName;
        const decision = n.record.decision?.action === 'BLOCK' ? ' [已阻断]' : '';
        parts.push(`  ${i + 1}. ${n.record.agentId} → \`${tool}\`${decision}`);
      }
    }

    // 影响范围
    const impact = this.summarizeImpact(anomalous);
    const impactParts: string[] = [];
    if (impact.files.length > 0) impactParts.push(`文件：${impact.files.join(', ')}`);
    if (impact.networkTargets.length > 0) impactParts.push(`网络目标：${impact.networkTargets.join(', ')}`);
    if (impact.credentials.length > 0) impactParts.push(`凭据：${impact.credentials.join(', ')}`);
    if (impact.gitRepos.length > 0) impactParts.push(`仓库：${impact.gitRepos.join(', ')}`);
    if (impactParts.length > 0) parts.push(`影响范围：${impactParts.join('；')}`);

    return parts.join('\n');
  }

  private sourceLabel(type: string): string {
    const labels: Record<string, string> = {
      user_input: '用户直接输入', external_resource: '外部读取资源',
      memory: '记忆库污染', mcp_response: 'MCP工具返回', tool_description: '工具描述注入',
    };
    return labels[type] ?? type;
  }

  private makeRootRecord(ts: number): ToolCallRecord {
    return {
      id: 'root', timestamp: ts, agentId: 'root', toolName: '[会话启动]',
      toolArgs: {}, isSuspicious: false,
      sourceAttribution: { type: 'user_input', sourceId: 'session', sourceSnippet: '' },
    };
  }

  /**
   * 沿攻击链路溯源
   * 从攻击源节点出发，BFS 追踪所有下游影响
   */
  traceAttackPath(sourceNode: CallGraphNode): CallGraphNode[] {
    const visited = new Set<string>();
    const path: CallGraphNode[] = [];
    const queue: CallGraphNode[] = [sourceNode];

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      path.push(node);

      for (const child of node.children) {
        queue.push(child);
      }
    }

    return path;
  }

  /**
   * 查找攻击触发源
   * @returns 所有被标记为攻击源的节点
   */
  findAttackSources(): CallGraphNode[] {
    const graph = this.buildGraph();
    return graph.attackSources;
  }

  /**
   * 汇总影响范围
   */
  private summarizeImpact(anomalousNodes: CallGraphNode[]): CallGraph['impactedResources'] {
    const files = new Set<string>();
    const networkTargets = new Set<string>();
    const gitRepos = new Set<string>();
    const credentials = new Set<string>();

    const sensitiveFilePatterns = ['.env', '.pem', '.key', 'credentials', 'id_rsa', 'token', 'secret', '.ssh/', '.aws/'];

    for (const node of anomalousNodes) {
      const args = node.record.toolArgs;

      // 文件操作
      const path = (args.path ?? args.filePath ?? args.target_path ?? args.file) as string | undefined;
      if (path) {
        const pathStr = String(path);
        files.add(pathStr);

        // 检测是否为凭据类文件
        for (const pattern of sensitiveFilePatterns) {
          if (pathStr.toLowerCase().includes(pattern)) {
            credentials.add(pathStr);
            break;
          }
        }
      }

      // 网络目标
      const url = (args.url ?? args.target_url) as string | undefined;
      if (url) {
        try {
          const hostname = new URL(String(url).startsWith('http') ? String(url) : `https://${String(url)}`).hostname;
          networkTargets.add(hostname);
        } catch {
          networkTargets.add(String(url));
        }
      }

      // Git 操作
      if (node.record.toolName.startsWith('git.')) {
        const remote = args.remote as string | undefined;
        const repo = args.repo as string | undefined;
        if (remote) gitRepos.add(String(remote));
        if (repo) gitRepos.add(String(repo));
      }
    }

    return {
      files: [...files],
      networkTargets: [...networkTargets],
      gitRepos: [...gitRepos],
      credentials: [...credentials],
    };
  }

  /**
   * 清空当前会话记录
   */
  clear(): void {
    this.records = [];
  }

  /**
   * 获取统计信息
   */
  stats(): { total: number; suspicious: number; byTool: Record<string, number> } {
    const byTool: Record<string, number> = {};
    let suspicious = 0;

    for (const record of this.records) {
      byTool[record.toolName] = (byTool[record.toolName] ?? 0) + 1;
      if (record.isSuspicious) suspicious++;
    }

    return {
      total: this.records.length,
      suspicious,
      byTool,
    };
  }

  private emptyGraph(): CallGraph {
    return {
      rootNode: {
        id: 'empty', record: {
          id: 'empty', timestamp: Date.now(), agentId: 'root',
          toolName: '[No Activity]', toolArgs: {}, isSuspicious: false,
          sourceAttribution: { type: 'user_input', sourceId: 'session', sourceSnippet: '' },
        },
        children: [], isAttackSource: false, isAnomalous: false, depth: -1, role: 'root',
      },
      totalNodes: 0, suspiciousNodes: 0, attackSources: [],
      impactedResources: { files: [], networkTargets: [], gitRepos: [], credentials: [] },
      attackChainSummary: '', mermaidCode: '', timelineNodes: [],
    };
  }
}
