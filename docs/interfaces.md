# 接口契约定义
# 负责人：C（定义），A & B（确认）
# 
# 这是三个子任务之间的数据契约文件。
# 在实际开发中，可以将此文件编译为各模块可引用的类型定义。
# 任何接口变更必须三人协商一致后同步更新此文件。

# ---- 子任务A → 子任务B/C 的接口 ----
# DetectionResult {
#   isInjection: boolean;
#   injectionType: "direct" | "indirect" | "memory_poisoning" | "none";
#   confidence: number;
#   payloadSnippet: string;
#   payloadLocation: { start: number; end: number };
#   bypassTechniques: string[];
# }

# ---- 子任务B → 子任务C 的接口 ----
# DecisionResult {
#   action: "ALLOW" | "ASK_USER" | "BLOCK";
#   riskScore: number;
#   deviationScore: number;
#   matchedPolicyId?: string;
#   explanation: string;
# }
