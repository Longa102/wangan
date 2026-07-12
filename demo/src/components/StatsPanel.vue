<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ stats: { total: number; blocked: number; allowed: number; suspicious: number } }>()

const cards = computed(() => [
  { label: '总请求数', value: props.stats.total, icon: '📊', color: 'var(--accent)', bg: '#1a2332' },
  { label: '已阻断', value: props.stats.blocked, icon: '🚫', color: 'var(--danger)', bg: 'var(--danger-bg)' },
  { label: '待确认', value: props.stats.suspicious, icon: '⚠️', color: 'var(--warning)', bg: 'var(--warning-bg)' },
  { label: '已放行', value: props.stats.allowed, icon: '✅', color: 'var(--success)', bg: 'var(--success-bg)' },
])

const blockedRate = computed(() =>
  props.stats.total > 0 ? (props.stats.blocked / props.stats.total * 100).toFixed(0) : '0'
)
</script>

<template>
  <div class="stats-row">
    <div
      v-for="card in cards" :key="card.label"
      class="stat-card"
      :style="{ '--card-color': card.color, '--card-bg': card.bg }"
    >
      <div class="stat-icon">{{ card.icon }}</div>
      <div class="stat-body">
        <div class="stat-value">{{ card.value }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </div>
    </div>
    <div class="stat-card rate-card">
      <div class="rate-ring" :style="{ '--rate': blockedRate }">
        <svg viewBox="0 0 36 36" class="ring-svg">
          <path class="ring-bg" d="M18 2a16 16 0 1 1 0 32 16 16 0 1 1 0-32" />
          <path class="ring-fill" :stroke-dasharray="`${blockedRate}, 100`" d="M18 2a16 16 0 1 1 0 32 16 16 0 1 1 0-32" />
        </svg>
        <span class="ring-text">{{ blockedRate }}%</span>
      </div>
      <div class="stat-label">阻断率</div>
    </div>
  </div>
</template>

<style scoped>
.stats-row { display: flex; gap: 12px; margin-top: 14px; }
.stat-card {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.stat-card:hover { border-color: var(--card-color); box-shadow: 0 0 12px color-mix(in srgb, var(--card-color) 10%, transparent); }
.stat-icon { font-size: 28px; line-height: 1; opacity: 0.9; }
.stat-body { flex: 1; }
.stat-value { font-size: 30px; font-weight: 700; color: var(--card-color); line-height: 1.1; }
.stat-label { font-size: 11px; color: var(--text-secondary); margin-top: 4px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }

/* 圆环阻断率 */
.rate-card { justify-content: center; flex-direction: column; align-items: center; gap: 8px; }
.rate-ring { position: relative; width: 56px; height: 56px; }
.ring-svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: var(--border); stroke-width: 3; }
.ring-fill { fill: none; stroke: var(--danger); stroke-width: 3; stroke-linecap: round; }
.ring-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: var(--danger); }
</style>
