/**
 * 用户意图提取器
 * 负责人：B
 *
 * 职责：
 *   - 从用户原始对话中提取结构化的任务意图
 *   - 意图表示包含：目标任务类型、操作对象范围、权限边界、预期结果
 *
 * 为什么需要结构化意图？
 *   - 自然语言表达的意图边界模糊，无法直接与工具调用做精确对比
 *   - 需要将 "帮我看下这个PR" 这类模糊请求解析为：
 *     { action: "read", target: "PR_files", scope: "current_repo", forbidden: ["write","push","delete"] }
 *
 * 提取维度：
 *   1. 任务类型：read / write / execute / analyze / review / deploy / ...
 *   2. 操作范围：指定文件/目录/仓库/网络域
 *   3. 权限需求：最小必要权限集合
 *   4. 显式排除：用户明确说"不要"的操作
 */

export interface StructuredIntent {
  taskType: string;                    // 任务类型
  targetScope: {                       // 操作范围
    files?: string[];
    directories?: string[];
    repos?: string[];
    domains?: string[];
    tools?: string[];
  };
  requiredPermissions: string[];       // 最小必要权限
  explicitDenials: string[];           // 用户明确禁止的操作
  expectedOutcome: string;             // 预期结果描述
  confidence: number;                  // 意图提取置信度
}

export class IntentExtractor {
  /**
   * 从用户消息中提取结构化意图
   * @param userMessages 用户的多轮对话消息
   * @returns 结构化的意图表示
   */
  async extract(userMessages: string[]): Promise<StructuredIntent> {
    // TODO(B): 实现意图提取

    // 步骤1：任务类型分类
    //   read / write / execute / analyze / review / deploy / ask / ...
    //   可微调一个小型分类模型，或用 LLM few-shot
    // TODO(B)

    // 步骤2：操作目标提取（NER / 实体识别）
    //   识别用户消息中的文件名、路径、URL、仓库名等实体
    // TODO(B)

    // 步骤3：权限边界推断
    //   根据任务类型推理最小必要权限
    //   例："review PR" → 需要 read:files + read:comments，不需要 write/push
    // TODO(B)

    // 步骤4：显式排除识别
    //   匹配 "不要" "别" "don't" "never" "禁止" 等否定表达
    // TODO(B)

    throw new Error('Not implemented');
  }

  /**
   * 任务类型分类
   * 负责人：B — 需要根据实际业务场景扩充
   */
  private static readonly TASK_TYPE_SCHEMA = [
    'read',        // 读取/查看类
    'write',       // 写入/修改类
    'execute',     // 执行/运行类
    'analyze',     // 分析/检查类（静态分析，不执行）
    'review',      // 代码检视类
    'deploy',      // 部署类
    'delete',      // 删除类
    'query',       // 查询/问答类
  ];
}
