/**
 * 审计日志记录器
 * 负责人：C
 *
 * 职责：
 *   - 结构化 JSON 日志输出
 *   - SQLite 持久化存储（用于长期审计和查询）
 *   - 日志格式统一（子任务 A/B 也使用此格式记录自身日志）
 *
 * 日志类型：
 *   - DETECTION  — 注入检测结果（来自子任务A）
 *   - DECISION   — 策略决策结果（来自子任务B）
 *   - TOOL_CALL  — 工具调用详情（来自代理拦截）
 *   - TRACE      — 溯源链路信息
 *   - ERROR      — 系统错误
 */

export type AuditLogLevel = 'DETECTION' | 'DECISION' | 'TOOL_CALL' | 'TRACE' | 'ERROR';

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  level: AuditLogLevel;
  sessionId: string;
  agentId: string;
  data: Record<string, unknown>;       // 各类型日志的 payload
  metadata: {
    sourceFile?: string;               // 产生日志的源文件
    version: string;
  };
}

export class AuditLogger {
  private logPath: string;
  private db: unknown = null;          // SQLite 连接

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  /**
   * 记录审计日志（同时写入文件和数据库）
   */
  async log(entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'metadata'>): Promise<void> {
    // TODO(C): 日志写入

    const fullEntry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      metadata: { version: '1.0.0' },
      ...entry,
    };

    // 步骤1：写入 JSON 日志文件（行分隔，方便 tail/grep）
    // TODO(C)

    // 步骤2：写入 SQLite（结构化查询）
    // TODO(C)
  }

  /**
   * 按时间范围查询审计日志
   */
  async query(options: {
    startTime?: number;
    endTime?: number;
    level?: AuditLogLevel;
    sessionId?: string;
    agentId?: string;
  }): Promise<AuditLogEntry[]> {
    // TODO(C): SQLite 查询
    throw new Error('Not implemented');
  }

  /**
   * 生成审计报告（Markdown 格式）
   * 用于赛后复盘和交付文档
   */
  async generateReport(sessionId: string): Promise<string> {
    // TODO(C): 汇总一个会话的所有审计日志，生成结构化报告
    throw new Error('Not implemented');
  }

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
