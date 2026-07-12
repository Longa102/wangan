/**
 * MCP 请求拦截器
 * 负责人：C
 *
 * 职责：
 *   - 截获所有 Agent → MCP Server 的工具调用请求
 *   - 提取请求中的上下文信息（用户输入、计划步骤、工具名、参数）
 *   - 将结构化数据传递给后续检测链
 *
 * 截获点：
 *   - tools/call  — 工具调用请求（核心拦截点）
 *   - tools/list   — 工具列表查询（可用于扫描 MCP Server 提供的工具描述是否含注入）
 *   - prompts/*    — Prompt 模板请求
 *   - resources/*  — 资源读取请求
 */

export interface ToolCallContext {
  toolName: string;
  toolArgs: Record<string, unknown>;
  userOriginalIntent: string;      // 用户原始请求（由上游 Agent 传入）
  agentPlanSteps: string[];        // Agent 当前已执行的计划步骤
  conversationHistory: string[];   // 会话上下文（用于跨轮检测）
  timestamp: number;
}

export class RequestInterceptor {
  /**
   * 拦截并解析工具调用请求
   * @param rawRequest MCP 协议的原始请求 JSON-RPC
   * @returns 结构化的工具调用上下文
   */
  intercept(rawRequest: unknown): ToolCallContext {
    // TODO(C): 解析 MCP JSON-RPC 请求
    // 1. 解析 method 字段，识别请求类型
    // 2. 提取 params 中的工具名、参数
    // 3. 从请求元数据中提取用户意图和 Agent 计划
    throw new Error('Not implemented');
  }

  /**
   * 检查工具描述中是否包含注入载荷
   * （应对 MCP 供应链攻击中的 tool description 注入）
   */
  scanToolDescription(description: string): boolean {
    // TODO(C): 调用子任务A的间接注入检测模块
    throw new Error('Not implemented');
  }
}
