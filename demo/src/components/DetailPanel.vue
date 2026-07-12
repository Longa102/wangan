<script setup lang="ts">
import { computed, ref } from 'vue'
import DagViewer from './DagViewer.vue'

interface ChainNode {
  id: string; agent: string; role: string; tool: string; desc: string
  suspicious: boolean; isAttackSource: boolean; depth: number
  sourceType?: string; sourceId?: string; sourceSnippet?: string
  tokenRange?: { start: number; end: number }
}
interface ChainTrace {
  nodes: ChainNode[]; mermaidCode: string; summary: string
  impacted: { files: string[]; networkTargets: string[]; gitRepos: string[]; credentials: string[] }
  timeline: Array<{ time: string; nodeId: string; desc: string; suspicious: boolean }>
}
interface LogEntry {
  id: string; scenario: string; action: string; risk: number
  injectionType: string; confidence: number; explanation: string; timestamp: number
  latency?: number; rawResponse?: unknown; chainTrace?: ChainTrace
}

const props = defineProps<{ entry: LogEntry | null; logs: LogEntry[] }>()
const activeTab = ref<'dag' | 'timeline'>('dag')

const actionColors: Record<string, string> = { BLOCK: 'var(--danger)', ASK_USER: 'var(--warning)', ALLOW: 'var(--success)' }
const actionLabels: Record<string, string> = { BLOCK: '已阻断', ASK_USER: '待确认', ALLOW: '已放行' }
const actionBgs: Record<string, string> = { BLOCK: 'var(--danger-bg)', ASK_USER: 'var(--warning-bg)', ALLOW: 'var(--success-bg)' }

const overview = computed(() => {
  const total = props.logs.length
  const blocked = props.logs.filter(l => l.action === 'BLOCK').length
  const allowed = props.logs.filter(l => l.action === 'ALLOW').length
  return {
    total, blocked, allowed,
    blockedRate: total > 0 ? (blocked / total * 100).toFixed(0) : '0',
  }
})

function sourceTypeLabel(t: string) {
  const m: Record<string, string> = { user_input:'用户输入', external_resource:'外部资源', memory:'记忆库', mcp_response:'MCP返回', tool_description:'工具描述' }
  return m[t] ?? t
}
function roleLabel(r: string) {
  return { agent:'主Agent', 'sub-agent':'子Agent', proxy:'MCP代理', trigger:'攻击源', tool:'工具', root:'根' }[r] ?? r
}
function injectionLabel(t: string) {
  return { direct:'直接注入', indirect:'间接注入', memory_poisoning:'记忆污染', none:'无' }[t] ?? t
}
</script>

<template>
  <div class="card" style="min-height:500px">
    <!-- ====== 空状态 ====== -->
    <div v-if="!entry" class="empty-state">
      <div class="empty-hero">
        <div class="empty-logo">🛡️</div>
        <div class="empty-title">wangan 安全防护系统</div>
        <div class="empty-desc">三级级联检测 · 语义分析 · 向量异常 · 全链路溯源</div>
      </div>
      <div class="overview-grid">
        <div class="ov-item">
          <div class="ov-val" style="color:var(--accent)">{{ overview.total }}</div>
          <div class="ov-lbl">总请求</div>
        </div>
        <div class="ov-item">
          <div class="ov-val" style="color:var(--danger)">{{ overview.blockedRate }}%</div>
          <div class="ov-lbl">阻断率</div>
        </div>
        <div class="ov-item">
          <div class="ov-val" style="color:var(--success)">{{ overview.allowed }}</div>
          <div class="ov-lbl">已放行</div>
        </div>
        <div class="ov-item">
          <div class="ov-val" style="font-size:18px;color:var(--text-secondary)">3级+向量</div>
          <div class="ov-lbl">检测管道</div>
        </div>
      </div>
      <div class="pipeline-viz">
        <div class="pipe-step"><span class="pipe-num">T1</span>规则引擎<span class="pipe-time">&lt;5ms</span></div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step"><span class="pipe-num">T2</span>多检测器<span class="pipe-time">&lt;100ms</span></div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step"><span class="pipe-num">T2.5</span>语义+向量<span class="pipe-time">~50ms</span></div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step"><span class="pipe-num">T3</span>LLM研判<span class="pipe-time">按需</span></div>
      </div>
    </div>

    <!-- ====== 详情 ====== -->
    <div v-else class="detail-view">
      <!-- 标题 + 状态 -->
      <div class="detail-header" :style="{borderLeft:'4px solid ' + actionColors[entry.action]}">
        <div>
          <div class="dh-title">{{ entry.scenario }}</div>
          <div class="dh-meta">
            <span class="badge" :class="entry.action==='BLOCK'?'badge-danger':entry.action==='ASK_USER'?'badge-warning':'badge-success'">
              {{ actionLabels[entry.action] }}
            </span>
            <span class="dh-latency">{{ entry.latency ?? 'N/A' }}ms</span>
          </div>
        </div>
        <div class="dh-risk" :style="{color:entry.risk>70?'var(--danger)':entry.risk>30?'var(--warning)':'var(--success)'}">
          <div class="dh-risk-num">{{ entry.risk }}</div>
          <div class="dh-risk-label">风险评分</div>
        </div>
      </div>

      <!-- 指标行 -->
      <div class="metrics-row">
        <div class="metric">
          <div class="metric-label">注入类型</div>
          <div class="metric-val">{{ injectionLabel(entry.injectionType) }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">置信度</div>
          <div class="metric-val" style="color:var(--accent)">{{ (entry.confidence * 100).toFixed(0) }}%</div>
        </div>
        <div class="metric">
          <div class="metric-label">延迟</div>
          <div class="metric-val">{{ entry.latency ?? 'N/A' }}ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">时间</div>
          <div class="metric-val" style="font-size:11px">{{ new Date(entry.timestamp).toLocaleTimeString('zh-CN', {hour12:false}) }}</div>
        </div>
      </div>

      <!-- 研判结论 -->
      <div class="conclusion-box">
        <div class="conclusion-title">📝 研判结论</div>
        <div class="conclusion-text">{{ entry.explanation }}</div>
      </div>

      <!-- 攻击链溯源 -->
      <div v-if="entry.chainTrace" class="chain-section">
        <div class="chain-tabs">
          <button class="chain-tab" :class="{active:activeTab==='dag'}" @click="activeTab='dag';nextTick(renderDag)">
            🔗 攻击路径 DAG
          </button>
          <button class="chain-tab" :class="{active:activeTab==='timeline'}" @click="activeTab='timeline'">
            ⏱ 时序链路
          </button>
        </div>

        <!-- DAG -->
        <div v-if="activeTab==='dag'" class="dag-section">
          <DagViewer :trace="entry.chainTrace" :action="entry.action" />
        </div>

        <!-- 时序 -->
        <div v-if="activeTab==='timeline'" class="timeline-view">
          <div class="tl-track">
            <div v-for="(t, i) in entry.chainTrace.timeline" :key="i" class="tl-node-wrap">
              <div class="tl-node" :class="{sus:t.suspicious}">
                <div class="tl-dot" :class="{sus:t.suspicious}"></div>
                <div class="tl-content">
                  <div class="tl-time">{{ t.time }}</div>
                  <div class="tl-desc">{{ t.desc }}</div>
                </div>
              </div>
              <div v-if="i < entry.chainTrace.timeline.length-1" class="tl-line" :class="{sus:t.suspicious}"></div>
            </div>
          </div>

          <!-- 影响范围 -->
          <div class="impact-section">
            <div class="impact-title">📊 影响范围</div>
            <div class="impact-grid">
              <div v-if="entry.chainTrace.impacted.files.length" class="impact-card">
                <div class="impact-icon">📁</div>
                <div class="impact-info">
                  <div class="impact-label">操作文件</div>
                  <div class="impact-val">{{ entry.chainTrace.impacted.files.join(', ') }}</div>
                </div>
              </div>
              <div v-if="entry.chainTrace.impacted.networkTargets.length" class="impact-card">
                <div class="impact-icon">🌐</div>
                <div class="impact-info">
                  <div class="impact-label">网络目标</div>
                  <div class="impact-val">{{ entry.chainTrace.impacted.networkTargets.join(', ') }}</div>
                </div>
              </div>
              <div v-if="entry.chainTrace.impacted.credentials.length" class="impact-card" style="border-color:var(--danger)">
                <div class="impact-icon">🔑</div>
                <div class="impact-info">
                  <div class="impact-label" style="color:var(--danger)">凭据泄露</div>
                  <div class="impact-val" style="color:var(--danger)">{{ entry.chainTrace.impacted.credentials.join(', ') }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 攻击源详情 -->
        <div v-if="entry.chainTrace.nodes.some(n=>n.sourceType)" class="source-box">
          <div class="source-title">🎯 攻击触发源定位</div>
          <div v-for="n in entry.chainTrace.nodes.filter(n=>n.sourceType)" :key="n.id" class="source-item">
            <div class="source-header">
              <span class="badge badge-warning">{{ roleLabel(n.role) }}</span>
              <span class="source-type">{{ sourceTypeLabel(n.sourceType!) }}</span>
              <code class="source-id">{{ n.sourceId }}</code>
            </div>
            <div class="source-snippet">载荷: "{{ n.sourceSnippet?.slice(0, 150) }}"</div>
            <div v-if="n.tokenRange" class="source-token">
              Token 定位: [{{ n.tokenRange.start }}, {{ n.tokenRange.end }}]
            </div>
          </div>
        </div>
      </div>

      <!-- 无链追踪时的简化DAG -->
      <div v-else class="simple-dag">
        <div class="simple-dag-title">🔗 调用链路</div>
        <div class="simple-dag-flow">
          <div class="sd-node">👤 用户</div>
          <div class="sd-arrow">→</div>
          <div class="sd-node" style="border-color:var(--accent)">🛡️ 代理</div>
          <div class="sd-arrow">→</div>
          <div class="sd-node">🔍 检测</div>
          <div class="sd-arrow">→</div>
          <div v-if="entry.action==='ALLOW'" class="sd-node" style="border-color:var(--success)">✅ 放行</div>
          <div v-else class="sd-node" style="border-color:var(--danger)">🚫 阻断</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 空状态 */
.empty-state { text-align: center; padding: 20px 0; }
.empty-hero { margin-bottom: 24px; }
.empty-logo { font-size: 48px; margin-bottom: 8px; }
.empty-title { font-size: 18px; font-weight: 700; color: var(--accent); }
.empty-desc { font-size: 12px; color: var(--text-secondary); margin-top: 6px; }

.overview-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
.ov-item { background: var(--bg-tertiary); border-radius: 6px; padding: 14px 10px; }
.ov-val { font-size: 24px; font-weight: 700; }
.ov-lbl { font-size: 10px; color: var(--text-secondary); margin-top: 4px; }

.pipeline-viz { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 12px; background: var(--bg-tertiary); border-radius: 6px; }
.pipe-step { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: 500; }
.pipe-num { font-size: 16px; font-weight: 700; color: var(--accent); }
.pipe-time { font-size: 9px; color: var(--text-muted); }
.pipe-arrow { color: var(--text-muted); font-size: 16px; margin: 0 2px; }

/* 详情 */
.detail-view { animation: fadeIn 0.2s ease-out; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.detail-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 14px 16px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 14px; }
.dh-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
.dh-meta { display: flex; align-items: center; gap: 8px; }
.dh-latency { font-size: 10px; color: var(--text-muted); font-family: monospace; }
.dh-risk { text-align: center; }
.dh-risk-num { font-size: 32px; font-weight: 700; line-height: 1; }
.dh-risk-label { font-size: 10px; opacity: 0.7; margin-top: 2px; }

.metrics-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin-bottom: 14px; }
.metric { background: var(--bg-tertiary); border-radius: 6px; padding: 10px; text-align: center; }
.metric-label { font-size: 10px; color: var(--text-muted); }
.metric-val { font-size: 14px; font-weight: 600; margin-top: 3px; color: var(--text-primary); }

.conclusion-box { background: var(--bg-tertiary); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; padding: 14px; margin-bottom: 14px; }
.conclusion-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.conclusion-text { font-size: 13px; color: var(--text-secondary); line-height: 1.7; white-space: pre-wrap; }

/* 链追踪 */
.chain-section { margin-top: 4px; }
.chain-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.chain-tab { background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border); padding: 7px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.15s; }
.chain-tab.active { background: #1a2332; color: var(--accent); border-color: var(--accent); }
.chain-tab:hover:not(.active) { background: var(--border-hover); }

/* DAG */
.dag-wrap { background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 6px; padding: 16px; overflow-x: auto; min-height: 200px; }
.dag-svg :deep(svg) { max-width: 100%; height: auto; display: block; margin: 0 auto; }
.dag-fallback { text-align: center; }
.fallback-label { font-size: 11px; color: var(--warning); margin-bottom: 8px; }
.fallback-code { font-family: monospace; font-size: 11px; color: var(--text-secondary); white-space: pre; text-align: left; }
.dag-loading { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text-muted); font-size: 12px; }
.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 时序 */
.timeline-view { background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 6px; padding: 20px; }
.tl-track { position: relative; }
.tl-node-wrap { position: relative; }
.tl-node { display: flex; gap: 14px; padding: 10px 0; position: relative; }
.tl-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--border-hover); flex-shrink: 0; margin-top: 4px; border: 2px solid var(--bg-tertiary); z-index: 1; }
.tl-dot.sus { background: var(--danger); box-shadow: 0 0 10px var(--danger); }
.tl-content { flex: 1; }
.tl-time { font-size: 11px; color: var(--text-muted); font-family: monospace; }
.tl-desc { font-size: 13px; color: var(--text-primary); margin-top: 2px; }
.tl-line { position: absolute; left: 5px; top: 28px; width: 2px; height: calc(100% - 16px); background: var(--border); }
.tl-line.sus { background: var(--danger); opacity: 0.4; }

/* 影响范围 */
.impact-section { margin-top: 16px; }
.impact-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.impact-grid { display: flex; flex-direction: column; gap: 6px; }
.impact-card { display: flex; gap: 10px; padding: 10px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; }
.impact-icon { font-size: 18px; flex-shrink: 0; margin-top: 2px; }
.impact-label { font-size: 10px; color: var(--text-secondary); }
.impact-val { font-size: 12px; color: var(--text-primary); word-break: break-all; margin-top: 2px; }

/* 攻击源 */
.source-box { background: var(--bg-tertiary); border: 1px solid var(--warning); border-radius: 6px; padding: 14px; margin-top: 12px; }
.source-title { font-size: 13px; font-weight: 600; color: var(--warning); margin-bottom: 10px; }
.source-item { padding: 8px 0; border-bottom: 1px solid var(--border); }
.source-item:last-child { border-bottom: none; }
.source-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.source-type { font-size: 11px; color: var(--text-secondary); }
.source-id { font-size: 10px; color: var(--accent); background: #1a2332; padding: 1px 6px; border-radius: 3px; }
.source-snippet { font-family: monospace; font-size: 11px; color: var(--danger); background: var(--bg-primary); padding: 6px 8px; border-radius: 4px; margin-top: 4px; word-break: break-all; }
.source-token { font-size: 10px; color: var(--text-muted); margin-top: 4px; }

/* 简化DAG */
.simple-dag { background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 6px; padding: 16px; margin-top: 4px; }
.simple-dag-title { font-size: 13px; font-weight: 600; margin-bottom: 12px; }
.simple-dag-flow { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
.sd-node { padding: 8px 14px; border: 1px solid var(--border); border-radius: 20px; font-size: 13px; background: var(--bg-primary); }
.sd-arrow { color: var(--text-muted); font-size: 18px; }
</style>
