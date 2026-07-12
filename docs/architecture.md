# 整体设计文档

## 1. 系统概述

wangan（"网安"）是一套面向 LLM Agent 的提示注入与工具滥用检测防御系统，采用 **MCP-in-the-Middle** 代理架构，在 Agent 与 MCP Server 之间插入安全代理层，对全量用户输入、外部资源、工具调用请求与响应进行实时语义分析，实现"检测 → 研判 → 阻断 → 溯源"完整安全闭环。

### 1.1 设计目标

- 覆盖 OWASP LLM01（Prompt Injection）三种攻击来源：直接注入、间接注入、记忆污染
- 提供工具调用级别的细粒度语义策略管控
- 输出可解释的研判结论与可视化攻击溯源链路
- 支持即插即用的 MCP 生态集成

## 2. 系统架构

```
┌──────────────┐     ┌──────────────────────────────────────┐     ┌──────────────┐
│  Agent 客户端  │────▶│          MCP Security Proxy          │────▶│  MCP Server  │
│  (Claude Code) │     │                                      │     │  (工具执行)   │
└──────────────┘     │  ┌────────────────────────────────┐   │     └──────────────┘
                      │  │  请求拦截器 → 注入检测(A)        │   │
┌──────────────┐     │  │  → 意图对齐(B) → 策略决策(B)     │   │     ┌──────────────┐
│  外部资源      │────▶│  │  → 三态决策 → 溯源(C)           │◀──│────▶│  子Agent     │
│  (间接注入)   │     │  └────────────────────────────────┘   │     └──────────────┘
└──────────────┘     │                                      │
                      │  ┌────────────────────────────────┐   │
┌──────────────┐     │  │  响应拦截器 → 间接注入扫描        │   │
│  记忆库       │────▶│  │  → 载荷提取 → 溯源标记           │   │
│  (记忆污染)   │     │  └────────────────────────────────┘   │
└──────────────┘     └──────────────────────────────────────┘
```

### 2.2 核心管道数据流

```
Agent请求 → parse JSON-RPC → RequestInterceptor
  → DetectionEngine (A): 三级级联检测
    ├── Tier 1: 规则引擎快速过滤 (< 5ms, 17个关键模式)
    ├── Tier 2: 多检测器综合 (直接+间接+记忆污染, < 100ms)
    └── Tier 3: LLM 深度研判 (Claude API, 按需调用, < 2s)
  → IntentExtractor + PlanAnalyzer (B): 意图-计划提取
  → DeviationScorer (B): 四维度偏离度评分
  → RuleEvaluator (B): 25条策略规则匹配
  → DecisionEngine (B): 三态决策 (ALLOW/ASK_USER/BLOCK)
  → 执行决策:
    ├── ALLOW  → UpstreamMCPClient 转发
    ├── ASK_USER → 返回确认请求
    └── BLOCK  → 返回安全错误 + 溯源记录
  → ResponseInterceptor: 二次载荷扫描
  → Tracer + AuditLogger (C): 全链路记录
```

## 3. 模块设计

### 3.1 代理层 (proxy/)

| 模块 | 文件 | 职责 |
|------|------|------|
| 传输层 | `mcp-transport.ts` | MCP JSON-RPC 2.0 解析/序列化、Stdio/HTTP/Upstream 三种传输适配器 |
| 请求拦截 | `request-interceptor.ts` | 解析 tools/call 请求、会话上下文管理、工具描述扫描 |
| 响应拦截 | `response-interceptor.ts` | 解析 MCP 响应、4层载荷扫描（指令/编码/隐藏/URL） |
| 核心中间件 | `middleware.ts` | 完整安全管道串联、策略加载、子模块生命周期管理 |
| 服务器 | `server.ts` | stdio 模式（Claude Code 集成）+ HTTP 模式（Web Agent 集成） |

### 3.2 检测层 (detector/)

| 模块 | 职责 | 关键技术 |
|------|------|----------|
| `detection-engine.ts` | 三级级联统一入口 | 规则引擎 → 多检测器 → LLM |
| `direct-injection.ts` | 直接注入检测 | 角色伪装/上下文劫持/越权指令（中英日俄多语言） |
| `indirect-injection.ts` | 间接注入检测 | 内容层级提取/指令边界检测/二阶载荷/上下文校验 |
| `memory-poisoning.ts` | 记忆污染检测 | 条件触发/System Prompt注入/跨会话持久化/批量审计 |

### 3.3 策略层 (policy/)

| 模块 | 职责 |
|------|------|
| `dsl-parser.ts` | YAML 策略文件解析、规则校验、优先级排序 |
| `expression-evaluator.ts` | DSL 表达式求值，支持 6 种匹配函数 + AND/OR 组合 |
| `rule-evaluator.ts` | 运行时策略匹配、通配符过滤、风险评分 |
| `decision-engine.ts` | 三态决策矩阵、可解释研判结论生成 |
| `policies/*.yaml` | 25条策略规则：fs(6) + net(4) + exec(6) + git(4) + agent(5) |

### 3.4 语义对齐层 (aligner/)

| 模块 | 职责 |
|------|------|
| `intent-extractor.ts` | 用户意图结构化提取（规则+LLM增强） |
| `plan-analyzer.ts` | Agent 执行计划解析、可疑信号标记 |
| `deviation-scorer.ts` | 四维度偏离度评分（目标30%+范围25%+工具25%+数据流20%） |

### 3.5 溯源层 (tracer/)

| 模块 | 职责 |
|------|------|
| `call-graph.ts` | DAG 构建、攻击溯源、影响范围汇总 |
| `dag-renderer.ts` | Mermaid/DOT/JSON 三种可视化输出 |
| `timeline.ts` | 时序分析、攻击窗口标注 |
| `audit-logger.ts` | JSONL + 控制台审计日志、Markdown 报告生成 |

### 3.6 对抗鲁棒性层 (defense/)

| 模块 | 职责 |
|------|------|
| `unicode-normalizer.ts` | 5步Unicode安全规范化（零宽/控制/NFKC/同形字/RLO） |
| `multilang-detector.ts` | 多语言识别、Emoji语义解码、跨语言注入检测 |
| `obfuscation-analyzer.ts` | 6类混淆还原（编码/注释/大小写/全角/空白/稀释） |

### 3.7 LLM 层 (llm/)

| 模块 | 职责 |
|------|------|
| `client.ts` | Anthropic API 封装、超时/重试、优雅降级 |
| `prompts.ts` | 注入分析/意图提取/偏离度评分三组 Prompt 模板 |

## 4. 关键技术决策

| 决策 | 方案 | 理由 |
|------|------|------|
| 架构模式 | MCP-in-the-Middle | 零侵入、协议标准、双向可见 |
| 检测架构 | 三级级联 | 平衡延迟与准确率：规则<5ms、检测器<100ms、LLM<2s |
| DSL 设计 | YAML + 表达式求值器 | 可读性强、可热加载、6种匹配函数覆盖全部策略场景 |
| 溯源格式 | 调用链 DAG + Mermaid | 标准化、可嵌入 Markdown 文档、支持可视化 |
| LLM 集成 | 可选增强 + 优雅降级 | 无 API key 时自动回退规则引擎，不阻断主流程 |

## 5. 安全设计

- **自身防注入**：LLM Prompt 模板内置安全边界声明，用户输入与系统指令严格分隔
- **故障安全**：所有 LLM 调用有超时（30s），失败回退到规则结果
- **最小权限**：代理本身不存储凭据，通过环境变量读取 API key
- **审计完整性**：所有决策（ALLOW/ASK_USER/BLOCK）均记录审计日志
