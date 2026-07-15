<script setup lang="ts">
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
  id: string; scenario: string; action: string; risk: number; timestamp: number
  injectionType: string; confidence: number; explanation: string
  latency?: number; rawResponse?: unknown; chainTrace?: ChainTrace
}

defineProps<{
  logs: LogEntry[]
  selected: { id: string; timestamp: number } | null
  loading: boolean
}>()
const emit = defineEmits<{ select: [entry: LogEntry] }>()

function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) }
function riskColor(r: number) { return r > 70 ? 'var(--danger)' : r > 30 ? 'var(--warning)' : 'var(--success)' }
const actionIcons: Record<string, string> = { BLOCK: '🚫', ASK_USER: '⚠️', ALLOW: '✅' }
const actionLabels: Record<string, string> = { BLOCK: '阻断', ASK_USER: '询问', ALLOW: '放行' }
</script>

<template>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="panel-title">📋 拦截日志</div>
      <span class="count-badge">{{ logs.length }}</span>
    </div>

    <div v-if="logs.length === 0 && !loading" class="empty">
      <div class="empty-icon">🔍</div>
      <div class="empty-text">点击左侧场景开始检测</div>
    </div>

    <div v-if="loading && logs.length === 0" class="empty">
      <div class="spinner"></div>
      <div class="empty-text">检测管道运行中...</div>
    </div>

    <div class="feed-list" v-if="logs.length > 0">
      <div
        v-for="log in logs" :key="log.id + '-' + log.timestamp"
        class="feed-item animate-in"
        :class="{ selected: selected?.id === log.id && selected?.timestamp === log.timestamp }"
        @click="emit('select', log)"
      >
        <div class="fi-icon">{{ actionIcons[log.action] ?? '❓' }}</div>
        <div class="fi-body">
          <div class="fi-name">{{ log.scenario }}</div>
          <div class="fi-meta">
            <span class="tag" :class="log.action === 'BLOCK' ? 'tag-danger' : log.action === 'ASK_USER' ? 'tag-warn' : 'tag-ok'">
              {{ actionLabels[log.action] }}
            </span>
            <span class="tag tag-risk" :style="{color: riskColor(log.risk)}">
              风险 {{ log.risk }}
            </span>
            <span v-if="log.injectionType !== 'none'" class="tag tag-inj">{{ log.injectionType }}</span>
          </div>
        </div>
        <div class="fi-right">
          <div class="fi-time">{{ fmtTime(log.timestamp) }}</div>
          <div class="fi-conf">{{ (log.confidence * 100).toFixed(0) }}%</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-title { font-size: 14px; font-weight: 600; }
.count-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--bg-tertiary); color: var(--text-secondary); }

.empty { text-align: center; padding: 40px 20px; }
.empty-icon { font-size: 32px; margin-bottom: 8px; }
.empty-text { font-size: 12px; color: var(--text-muted); }

.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px; }
@keyframes spin { to { transform: rotate(360deg); } }

.feed-list { display: flex; flex-direction: column; gap: 3px; max-height: calc(100vh - 340px); overflow-y: auto; }

.feed-item {
  display: flex; align-items: center; gap: 10px; padding: 10px;
  background: var(--bg-tertiary); border: 1px solid transparent; border-radius: 6px;
  cursor: pointer; transition: all 0.15s;
}
.feed-item:hover { border-color: var(--border-hover); }
.feed-item.selected { border-color: var(--accent); background: #1a2332; box-shadow: 0 0 8px rgba(88,166,255,0.1); }
.fi-icon { font-size: 16px; flex-shrink: 0; }
.fi-body { flex: 1; min-width: 0; }
.fi-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fi-meta { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.tag { font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 3px; background: var(--bg-primary); color: var(--text-secondary); letter-spacing: 0.2px; }
.tag-danger { background: var(--danger-bg); color: var(--danger); }
.tag-warn { background: var(--warning-bg); color: var(--warning); }
.tag-ok { background: var(--success-bg); color: var(--success); }
.tag-inj { background: var(--bg-primary); color: var(--purple); }
.tag-risk { background: var(--bg-primary); }
.fi-right { text-align: right; flex-shrink: 0; }
.fi-time { font-size: 10px; color: var(--text-muted); font-family: monospace; }
.fi-conf { font-size: 10px; color: var(--text-secondary); margin-top: 2px; }
</style>
