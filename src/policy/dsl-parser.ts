/**
 * 策略 DSL 解析器
 * 负责人：B
 *
 * 职责：
 *   - 解析 YAML 格式的安全策略定义文件
 *   - 将策略规则编译为可执行的规则评估树
 *   - 支持策略的优先级排序和冲突解决
 *
 * DSL 语法示例（详见 policies/*.yaml）：
 *   policies:
 *     - id: fs-write-sensitive-path-deny
 *       tool: fs.write
 *       rule: target_path matches ("~/.ssh/**", "~/.aws/**", "/etc/cron.*")
 *       action: BLOCK
 *       risk: CRITICAL
 *       message: "拦截：尝试向敏感路径写入文件"
 *
 * 策略优先级：
 *   1. CRITICAL 策略优先于 HIGH/MEDIUM/LOW
 *   2. 同级风险时，BLOCK > ASK_USER > ALLOW
 *   3. 同级同动作时，最近匹配的策略生效
 */

export interface PolicyRule {
  id: string;
  tool: string;                        // 目标工具名（支持通配符，如 "fs.*"）
  rule: string;                        // 规则表达式（DSL 语法）
  action: 'ALLOW' | 'ASK_USER' | 'BLOCK';
  risk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;                     // 触发时展示给用户的消息
  description?: string;                // 策略说明
  enabled: boolean;
}

export interface ParsedPolicySet {
  rules: PolicyRule[];
  metadata: {
    version: string;
    lastUpdated: string;
    totalRules: number;
  };
}

export class DslParser {
  /**
   * 从 YAML 文件解析策略规则
   */
  async parseFile(filePath: string): Promise<ParsedPolicySet> {
    // TODO(B): YAML 文件读取 + 解析
    // 1. 读取 YAML 文件
    // 2. 校验每条规则的语法正确性
    // 3. 检查规则 ID 唯一性
    // 4. 编译为 ParsedPolicySet
    throw new Error('Not implemented');
  }

  /**
   * 从多个 YAML 文件合并策略
   * 按工具类型分文件的策略在加载时合并为全局策略集
   */
  async parseDirectory(dirPath: string): Promise<ParsedPolicySet> {
    // TODO(B): 读取目录下所有 .yaml 文件并合并
    throw new Error('Not implemented');
  }

  /**
   * 校验单条规则表达式的合法性
   * @returns 校验失败时返回错误信息
   */
  validateRule(rule: PolicyRule): { valid: boolean; errors: string[] } {
    // TODO(B): DSL 语法校验
    // - rule 表达式是否合法
    // - tool 名称是否在已知工具列表中
    // - action 是否为有效值
    throw new Error('Not implemented');
  }

  /**
   * 按优先级排序规则
   * 排序键：risk 降序 > action 权重 > rule id 字典序
   */
  sortByPriority(rules: PolicyRule[]): PolicyRule[] {
    // TODO(B): 实现优先级排序
    const actionWeight = { 'BLOCK': 3, 'ASK_USER': 2, 'ALLOW': 1 };
    const riskWeight = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    // ...sort by riskWeight desc, then actionWeight desc
    throw new Error('Not implemented');
  }
}
