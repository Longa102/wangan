/**
 * 时序分析器
 * 负责人：C
 *
 * 职责：
 *   - 按时间线排列全量调用记录
 *   - 计算每个步骤的时间间隔
 *   - 标记时间线上的异常节点
 *
 * 输出：
 *   - 时序瀑布图（Waterfall Chart）
 *   - 异常步骤高亮标记
 *   - 攻击窗口标注
 */

import { ToolCallRecord } from './call-graph';

export interface TimelineEntry {
  timestamp: number;
  record: ToolCallRecord;
  stepIndex: number;
  durationFromPrevious?: number;       // 与上一步的时间间隔（ms）
  isAnomalous: boolean;
  annotation?: string;                 // 分析标注
}

export interface Timeline {
  entries: TimelineEntry[];
  totalSteps: number;
  totalDuration: number;               // 总耗时（ms）
  anomalousSteps: number;
  attackWindow?: {                     // 攻击窗口（从首次异常到最后异常）
    start: number;
    end: number;
    duration: number;
  };
}

export class TimelineAnalyzer {
  /**
   * 构建时序链路
   * @param records 全量调用记录（按时间排序）
   */
  build(records: ToolCallRecord[]): Timeline {
    // TODO(C): 构建时序链路

    // 步骤1：按时间戳排序
    // TODO(C)

    // 步骤2：计算步骤间时间间隔
    // TODO(C)

    // 步骤3：标记异常步骤
    //   被标记为 isSuspicious 的记录在时间线上高亮
    // TODO(C)

    // 步骤4：计算攻击窗口
    //   从第一个异常步骤到最后一个异常步骤的时间范围
    // TODO(C)

    throw new Error('Not implemented');
  }

  /**
   * 生成时序瀑布图文本表示（ASCII）
   * 用于终端快速查看
   */
  renderWaterfall(timeline: Timeline): string {
    // TODO(C): 生成 ASCII 瀑布图
    throw new Error('Not implemented');
  }

  /**
   * 导出为 JSON 格式（供前端图表库消费）
   * 前端可用 ECharts / Chart.js 渲染交互式瀑布图
   */
  exportToJson(timeline: Timeline): string {
    return JSON.stringify(timeline, null, 2);
  }
}
