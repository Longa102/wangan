<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

defineProps<{ loading: boolean; activeCategory: string }>()
const emit = defineEmits<{ run: [id: string]; reset: []; 'update:activeCategory': [cat: string] }>()

interface Scenario { id: string; name: string; category: string; description: string; expectedAction: string }
const scenarios = ref<Scenario[]>([])
const expanded = ref<Record<string, boolean>>({})

onMounted(async () => {
  const r = await fetch('/api/scenarios')
  scenarios.value = await r.json()
  // 默认展开第一个类别
  const cats = [...new Set(scenarios.value.map(s => s.category))]
  for (const c of cats) expanded.value[c] = true
})

const categories = computed(() => {
  const cats = new Map<string, Scenario[]>()
  for (const s of scenarios.value) {
    if (!cats.has(s.category)) cats.set(s.category, [])
    cats.get(s.category)!.push(s)
  }
  return [...cats.entries()]
})

function toggleCat(cat: string) { expanded.value[cat] = !expanded.value[cat] }
function catIcon(cat: string) {
  if (cat.includes('注入')) return '🎯'
  if (cat.includes('策略')) return '📋'
  if (cat.includes('溯源')) return '🔗'
  if (cat.includes('正常')) return '✅'
  if (cat.includes('语义')) return '🧠'
  if (cat.includes('格式')) return '📄'
  if (cat.includes('向量')) return '🔬'
  return '📌'
}

const actionColors: Record<string, {bg:string;label:string}> = {
  BLOCK: { bg: 'var(--danger-bg)', label: '阻断' },
  ASK_USER: { bg: 'var(--warning-bg)', label: '询问' },
  ALLOW: { bg: 'var(--success-bg)', label: '放行' },
}
</script>

<template>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
      <div class="panel-title">🎯 演示场景</div>
      <span class="count-badge">{{ scenarios.length }}</span>
    </div>

    <div class="cat-list">
      <div v-for="[cat, items] in categories" :key="cat" class="cat-group">
        <button class="cat-header" @click="toggleCat(cat)">
          <span class="cat-arrow" :class="{ open: expanded[cat] }">▸</span>
          <span class="cat-icon">{{ catIcon(cat) }}</span>
          <span class="cat-name">{{ cat }}</span>
          <span class="cat-count">{{ items.length }}</span>
        </button>

        <div v-if="expanded[cat]" class="cat-items">
          <button
            v-for="s in items" :key="s.id"
            class="scenario-btn animate-in"
            :disabled="loading"
            @click="emit('run', s.id)"
          >
            <div class="sc-top">
              <span class="sc-name">{{ s.name }}</span>
              <span class="sc-action" :style="{color:actionColors[s.expectedAction]?.label==='阻断'?'var(--danger)':actionColors[s.expectedAction]?.label==='询问'?'var(--warning)':'var(--success)'}">
                {{ actionColors[s.expectedAction]?.label ?? s.expectedAction }}
              </span>
            </div>
            <div class="sc-desc">{{ s.description }}</div>
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading-bar">⏳ 检测管道运行中... Tier1→Tier2→Tier3</div>
  </div>
</template>

<style scoped>
.panel-title { font-size: 14px; font-weight: 600; }
.count-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--bg-tertiary); color: var(--text-secondary); }

.cat-list { display: flex; flex-direction: column; margin-top: 12px; max-height: calc(100vh - 340px); overflow-y: auto; }
.cat-group { margin-bottom: 2px; }

.cat-header {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 10px;
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; font-size: 12px; border-radius: 6px; transition: background 0.15s;
}
.cat-header:hover { background: var(--bg-tertiary); }
.cat-arrow { font-size: 10px; transition: transform 0.2s; width: 14px; }
.cat-arrow.open { transform: rotate(90deg); }
.cat-icon { font-size: 14px; }
.cat-name { font-weight: 600; flex: 1; text-align: left; }
.cat-count { font-size: 10px; color: var(--text-muted); }

.cat-items { padding: 4px 0 8px 22px; display: flex; flex-direction: column; gap: 3px; }

.scenario-btn {
  display: block; width: 100%; text-align: left; padding: 9px 10px;
  background: var(--bg-tertiary); border: 1px solid transparent; border-radius: 6px;
  color: var(--text-primary); cursor: pointer; transition: all 0.15s;
}
.scenario-btn:hover:not(:disabled) { border-color: var(--accent); background: #1a2332; }
.scenario-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.sc-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.sc-name { font-size: 12px; font-weight: 600; flex: 1; }
.sc-action { font-size: 10px; font-weight: 700; white-space: nowrap; }
.sc-desc { font-size: 10px; color: var(--text-secondary); margin-top: 3px; line-height: 1.4; }

.loading-bar {
  margin-top: 10px; padding: 8px 12px; background: var(--warning-bg); border-radius: 6px;
  font-size: 12px; color: var(--warning); text-align: center;
}
</style>
