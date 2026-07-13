# 部署说明文档

## 1. 环境要求

| 组件 | 版本要求 | 说明 |
|------|----------|------|
| 操作系统 | Linux (Ubuntu 22.04+) / macOS 14+ / Windows 11 | 跨平台支持 |
| Node.js | ≥ 22.0.0 | 代理核心运行时 |
| Python | ≥ 3.12 | ML 模型推理（可选，增强检测精度） |
| 内存 | ≥ 8 GB | 含本地模型推理需求 |
| 磁盘 | ≥ 2 GB | 模型文件 + 日志存储 |
| 网络 | Agent → 代理 → MCP Server 网络可达 | 代理与上下游需互通 |

### 可选依赖

- **Anthropic API Key**：启用 LLM 深度研判（不配置则自动降级为规则模式）
- **Python 依赖**（`requirements.txt`）：启用本地 ML 模型推理

## 2. 安装步骤

### 2.1 克隆项目

```bash
git clone <repo-url>
cd wangan
```

### 2.2 安装 Node.js 依赖

```bash
npm install
```

### 2.3 安装 Python 依赖（可选）

```bash
pip install -r requirements.txt
```

### 2.4 配置文件

```bash
cp config/default.yaml config/local.yaml
```

编辑 `config/local.yaml`，根据实际环境修改以下配置项：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `proxy.upstream_mcp_url` | `http://localhost:9000` | 上游真实 MCP Server 地址 |
| `proxy.listen_port` | `9001` | 安全代理监听端口 |
| `policy.rules_dir` | `./src/policy/policies` | 策略规则文件目录 |
| `policy.default_action` | `ASK_USER` | 默认决策（可选 ALLOW/ASK_USER/BLOCK） |
| `detection.llm.provider` | `anthropic` | LLM 提供商 |
| `detection.llm.model` | `claude-sonnet-5` | LLM 模型 |
| `tracing.audit_log_path` | `./logs/audit.jsonl` | 审计日志路径 |

## 3. 启动方式

### 3.1 stdio 模式（集成 Claude Code）

适用于本地 Agent（Claude Code、Cursor 等），通过标准输入/输出通信。

**配置 Claude Code**（`claude_desktop_config.json` 或 `.mcp.json`）：

```json
{
  "mcpServers": {
    "security-proxy": {
      "command": "node",
      "args": ["dist/proxy/server.js", "--mode", "stdio", "--config", "config/local.yaml"]
    }
  }
}
```

**启动命令**：

```bash
npx ts-node --transpile-only src/proxy/server.ts --mode stdio --config config/local.yaml
```

### 3.2 HTTP 模式（独立部署）

适用于 Web Agent 或远程 Agent，通过 HTTP POST 调用。

```bash
# 编译
npm run build

# 启动
node dist/proxy/server.js --mode http --port 9001 --config config/local.yaml
```

**API 端点**：

```
POST http://127.0.0.1:9001/
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "fs.read",
    "arguments": { "path": "/some/file.txt" }
  }
}
```

**自定义 Headers**：
- `X-Session-Id`：会话标识（用于多轮对话关联）
- `X-User-Intent`：用户意图描述（辅助偏离度分析）

### 3.3 端到端测试

项目内置 Mock 上游 MCP Server，可直接测试：

```bash
# 全程自动：启动 Mock 上游 → 启动代理 → 发攻击请求 → 验证结果
npx ts-node --transpile-only scripts/e2e-test.ts
```

## 4. 策略规则自定义

策略规则位于 `src/policy/policies/*.yaml`，按工具类别分文件：

| 文件 | 覆盖工具 |
|------|----------|
| `fs-policies.yaml` | fs.read, fs.write, fs.delete 等 |
| `net-policies.yaml` | net.fetch, net.request 等 |
| `exec-policies.yaml` | exec, shell, terminal |
| `git-policies.yaml` | git.push, git.commit, git.clone |
| `agent-policies.yaml` | agent.dispatch, agent.send_message |

### 规则语法

```yaml
policies:
  - id: rule-unique-id          # 唯一标识
    tool: fs.write              # 目标工具（支持通配符 fs.*）
    rule: expression            # DSL 表达式（见下文）
    action: BLOCK               # ALLOW | ASK_USER | BLOCK
    risk: CRITICAL              # CRITICAL | HIGH | MEDIUM | LOW
    message: "描述信息"         # 触发时展示的消息
    enabled: true               # 是否启用
```

### DSL 表达式语法

| 函数 | 语法 | 示例 |
|------|------|------|
| `matches` | `field matches ("pattern1", "pattern2")` | `target_path matches ("~/.ssh/**")` |
| `contains` | `field contains ("keyword1", "keyword2")` | `command contains ("curl", "bash")` |
| `not_in` | `field not_in listref` | `target_url not_in trusted_domains_list` |
| `in_list` | `field in_list ("val1", "val2")` | `user_original_intent in_list ("code_review", "review")` |
| `regex_match` | `field regex_match ("pattern")` | `command regex_match ("/dev/tcp/")` |
| `superset_of` | `field superset_of reflist` | `subagent_permissions superset_of parent_agent_permissions` |

支持 `AND` / `OR` 布尔组合：`condition1 AND condition2 OR condition3`

### 风险等级与决策映射

| 风险等级 | 默认决策 | 说明 |
|----------|----------|------|
| CRITICAL | BLOCK | 明显恶意操作（反弹Shell、数据外发、敏感路径写入） |
| HIGH | BLOCK/ASK_USER | 高风险操作（读取敏感文件、非信任域名访问） |
| MEDIUM | ASK_USER | 可疑但不确定（异常子Agent数量、非任务范围操作） |
| LOW | ALLOW | 低风险，记录日志 |

## 5. 日志与监控

### 审计日志

- **文件**：`./logs/audit.jsonl`（JSON Lines 格式，每行一条）
- **级别**：DETECTION / DECISION / TOOL_CALL / TRACE / ERROR
- **查询**：`AuditLogger.query({ sessionId, startTime, endTime, level })`

### 生成审计报告

```typescript
const logger = new AuditLogger('./logs/audit.jsonl');
const report = await logger.generateReport('session-123');
// 输出 Markdown 格式报告
```

## 6. 性能基准

| 操作 | 延迟目标 | 说明 |
|------|----------|------|
| 规则引擎检测 | < 5ms | Tier 1，处理大部分明显攻击 |
| 多检测器综合 | < 100ms | Tier 2，语义级分析 |
| LLM 深度研判 | < 2s | Tier 3，仅在前两级不确定时触发 |
| 代理总延迟 | < 500ms P99 | 包含检测+决策+转发 |
