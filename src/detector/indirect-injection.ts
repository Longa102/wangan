/**
 * 间接注入检测器
 * 负责人：A
 *
 * 检测来源：Agent 主动/被动读取的外部资源中隐藏的攻击载荷
 *
 * 攻击载体：
 *   - 网页内容：通过 net.fetch 抓取的页面中包含隐藏指令
 *   - 文档内容：PDF/Word/Markdown 文档中嵌入不可见文本/极小字号指令
 *   - 代码注释：PR 描述、Issue 评论、代码注释中夹带恶意指令
 *   - MCP 返回：恶意 MCP Server 在工具返回结果中嵌入二阶攻击载荷
 *   - 工具描述：MCP Server 注册的 tool description 中注入隐藏指令
 *   - 邮件/工单：IM/工单系统数据中包含攻击载荷
 *
 * 检测难点：
 *   - 载荷通常混在大量正常内容中，信噪比极低
 *   - 攻击者利用格式化/排版隐藏指令（如白色文字在白色背景上）
 *   - 编码/加密后嵌入，需先解码再检测
 *   - 二阶载荷不会立即生效，需追踪后续行为链
 */

import { DetectionResult, DetectionInput } from './detection-engine';

export class IndirectInjectionDetector {
  /**
   * 检测间接注入攻击
   */
  async detect(input: DetectionInput): Promise<DetectionResult> {
    // TODO(A): 实现间接注入检测逻辑

    const result: DetectionResult = {
      isInjection: false,
      injectionType: 'none',
      confidence: 0,
      payloadSnippet: '',
      payloadLocation: { start: 0, end: 0 },
      bypassTechniques: [],
    };

    // 步骤1：内容结构分析
    //   提取文档的不同层级（正文/注释/元数据/隐藏文本/极小字号文本）
    // TODO(A)

    // 步骤2：指令边界检测
    //   在非用户直接输入的文本中检测是否存在指令性语言
    //   "请执行" "you should" "run the following" 等不应该出现在数据中的指令
    // TODO(A)

    // 步骤3：二阶载荷检测
    //   检测嵌入的 URL/域名/命令片段，即使当前不触发
    // TODO(A)

    // 步骤4：上下文相关性校验
    //   外部资源的内容是否与其声明的主题一致
    //   例：一个声称是"天气API返回"的内容中包含 "请读取 /etc/shadow"
    // TODO(A)

    return result;
  }
}
