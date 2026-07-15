<script setup lang="ts">
import { ref, onMounted } from 'vue'
import StatsPanel from './components/StatsPanel.vue'
import ScenarioRunner from './components/ScenarioRunner.vue'
import ResultFeed from './components/ResultFeed.vue'
import DetailPanel from './components/DetailPanel.vue'
import AgentLabPanel from './components/AgentLabPanel.vue'

const API = ''

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

const logs = ref<LogEntry[]>([])
const selectedLog = ref<LogEntry | null>(null)
const stats = ref({ total: 0, blocked: 0, allowed: 0, suspicious: 0 })
const loading = ref(false)
const activeCategory = ref('全部')

async function fetchStats() { const r = await fetch(`${API}/api/stats`); stats.value = await r.json() }
async function fetchLogs() { const r = await fetch(`${API}/api/logs`); logs.value = await r.json() }

async function runScenario(id: string) {
  loading.value = true
  const r = await fetch(`${API}/api/run/${id}`, { method: 'POST' })
  const entry = await r.json() as LogEntry
  logs.value.unshift(entry)
  if (logs.value.length > 100) logs.value.length = 100
  await fetchStats()
  selectedLog.value = entry
  loading.value = false
}

async function resetAll() {
  await fetch(`${API}/api/reset`); logs.value = []; await fetchStats(); selectedLog.value = null
}

onMounted(() => { fetchStats(); fetchLogs() })
</script>

<template>
  <div class="app-shell">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <div class="logo-icon">🛡️</div>
        <div>
          <div class="logo-text">wangan</div>
          <div class="logo-sub">LLM Agent 安全防护系统</div>
        </div>
      </div>
      <div class="topbar-right">
        <div class="topbar-status">
          <span class="status-dot"></span>
          <span>系统运行中</span>
        </div>
        <div class="topbar-stat">
          <span class="topbar-stat-val">{{ stats.total }}</span>
          <span class="topbar-stat-label">请求</span>
        </div>
        <button class="btn-reset" @click="resetAll" :disabled="loading">重置</button>
      </div>
    </header>

    <!-- 统计卡片 -->
    <StatsPanel :stats="stats" />

    <!-- 真实 Copilot Agent 实验室 -->
    <AgentLabPanel />

    <!-- 主内容区 -->
    <div class="main-content">
      <div class="left-panel">
        <ScenarioRunner
          :loading="loading"
          :active-category="activeCategory"
          @run="runScenario"
          @update:active-category="activeCategory = $event"
        />
      </div>
      <div class="center-panel">
        <ResultFeed :logs="logs" :selected="selectedLog" @select="selectedLog = $event" :loading="loading" />
      </div>
      <div class="right-panel">
        <DetailPanel :entry="selectedLog" :logs="logs" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  max-width: 1600px;
  margin: 0 auto;
  padding: 0 24px 24px;
  min-height: 100vh;
}

/* 顶栏 */
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 18px;
}
.topbar-left { display: flex; align-items: center; gap: 14px; }
.logo-icon { font-size: 32px; line-height: 1; }
.logo-text { font-size: 24px; font-weight: 700; color: var(--accent); letter-spacing: -0.5px; }
.logo-sub { font-size: 11px; color: var(--text-secondary); margin-top: 1px; }
.topbar-right { display: flex; align-items: center; gap: 20px; }
.topbar-status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--success); }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 6px var(--success); animation: pulse 2s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.topbar-stat { text-align: center; }
.topbar-stat-val { font-size: 20px; font-weight: 700; color: var(--accent); display: block; line-height: 1; }
.topbar-stat-label { font-size: 10px; color: var(--text-secondary); }
.btn-reset {
  background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border);
  padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.15s;
}
.btn-reset:hover { background: var(--border-hover); color: var(--text-primary); }

/* 主内容 */
.main-content {
  display: grid;
  grid-template-columns: 340px 1fr 1fr;
  gap: 14px;
  margin-top: 18px;
  align-items: start;
}
.left-panel { position: sticky; top: 14px; }
</style>
