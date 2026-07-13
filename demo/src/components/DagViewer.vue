<script setup lang="ts">
import { computed } from 'vue'

interface ChainNode {
  id: string; agent: string; role: string; tool: string; desc: string
  suspicious: boolean; isAttackSource: boolean; depth: number
  sourceType?: string; sourceId?: string
}

interface ChainTrace {
  nodes: ChainNode[]
  mermaidCode: string
  impacted: { files: string[]; networkTargets: string[]; gitRepos: string[]; credentials: string[] }
}

interface DagLayoutNode {
  x: number; y: number; w: number; h: number
  label: string; sublabel: string; icon: string
  color: string; bg: string; border: string; glow: string
  isDecision: boolean; isAnomaly: boolean
}

const props = defineProps<{ trace: ChainTrace; action: string }>()

const SPACING_Y = 120
const NODE_W = 320; const NODE_H = 80
const SVG_W = 900

const roleColors: Record<string, { color: string; bg: string; border: string; label: string; icon: string }> = {
  trigger:   { color: '#ff9800', bg: '#3d2a00', border: '#ff9800', label: '攻击源', icon: '⚠' },
  agent:     { color: '#58a6ff', bg: '#0d2137', border: '#58a6ff', label: '主Agent', icon: '◉' },
  'sub-agent': { color: '#bc8cff', bg: '#1e1535', border: '#bc8cff', label: '子Agent', icon: '◆' },
  proxy:     { color: '#56d364', bg: '#0d3320', border: '#56d364', label: 'MCP代理', icon: '⬡' },
  tool:      { color: '#8b949e', bg: '#161b22', border: '#30363d', label: '工具调用', icon: '○' },
}

const layout = computed<{ nodes: DagLayoutNode[]; svgH: number }>(() => {
  if (!props.trace?.nodes?.length) return { nodes: [], svgH: 200 }

  const nodes: DagLayoutNode[] = []
  const chainNodes = props.trace.nodes

  // User trigger node
  nodes.push({
    x: SVG_W / 2, y: 50, w: 220, h: 56,
    label: '用户 / 外部触发', sublabel: '', icon: '👤',
    color: '#8b949e', bg: '#161b22', border: '#30363d', glow: '',
    isDecision: false, isAnomaly: false,
  })

  // Chain nodes
  for (let i = 0; i < chainNodes.length; i++) {
    const n = chainNodes[i]
    const style = roleColors[n.role] ?? roleColors.tool
    const isAnomaly = n.suspicious
    const y = 150 + i * SPACING_Y

    nodes.push({
      x: SVG_W / 2, y, w: NODE_W, h: NODE_H,
      label: n.tool || n.agent,
      sublabel: n.desc ? n.desc.slice(0, 45) : '',
      icon: style.icon,
      color: isAnomaly ? '#f85149' : style.color,
      bg: isAnomaly ? '#3d1f1f' : style.bg,
      border: isAnomaly ? '#f85149' : style.border,
      glow: isAnomaly ? 'drop-shadow(0 0 8px rgba(248,81,73,0.4))' : '',
      isDecision: false, isAnomaly,
    })
  }

  // Decision node
  const lastY = 150 + chainNodes.length * SPACING_Y
  const isBlock = props.action === 'BLOCK'
  nodes.push({
    x: SVG_W / 2, y: lastY, w: 240, h: 64,
    label: isBlock ? '🚫 强制阻断' : props.action === 'ASK_USER' ? '⚠️ 待确认' : '✅ 已放行',
    sublabel: `风险评分: ${props.action === 'BLOCK' ? 'HIGH' : 'MEDIUM'}`,
    icon: isBlock ? '🚫' : '⚠️',
    color: isBlock ? '#f85149' : '#d2991d',
    bg: isBlock ? '#3d1f1f' : '#3d2e1f',
    border: isBlock ? '#f85149' : '#d2991d',
    glow: isBlock ? 'drop-shadow(0 0 12px rgba(248,81,73,0.5))' : 'drop-shadow(0 0 8px rgba(210,153,29,0.3))',
    isDecision: true, isAnomaly: isBlock,
  })

  return { nodes, svgH: lastY + 100 }
})

function nodeId(i: number) { return `n${i}` }

const arrows = computed(() => {
  const n = layout.value.nodes
  const result: Array<{ x1:number;y1:number;x2:number;y2:number;color:string;label:string }> = []
  for (let i = 0; i < n.length - 1; i++) {
    const cur = n[i]; const next = n[i+1]
    const isAnomaly = next.isAnomaly
    result.push({
      x1: cur.x, y1: cur.y + cur.h,
      x2: next.x, y2: next.y,
      color: isAnomaly ? '#f85149' : '#30363d',
      label: isAnomaly ? '⚠' : '',
    })
  }
  return result
})
</script>

<template>
  <div class="dag-viewer" v-if="layout.nodes.length > 0">
    <svg :width="SVG_W" :height="layout.svgH" :viewBox="`0 0 ${SVG_W} ${layout.svgH}`" class="dag-svg">
      <defs>
        <marker id="arrowNormal" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#30363d" />
        </marker>
        <marker id="arrowDanger" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#f85149" />
        </marker>
        <filter id="glowRed">
          <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#f85149" flood-opacity="0.5" />
        </filter>
        <filter id="glowBlue">
          <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#58a6ff" flood-opacity="0.3" />
        </filter>
      </defs>

      <!-- 连接线 -->
      <g v-for="(a, i) in arrows" :key="'arrow'+i">
        <line
          :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2"
          :stroke="a.color" stroke-width="2"
          :marker-end="a.color === '#f85149' ? 'url(#arrowDanger)' : 'url(#arrowNormal)'"
          :style="a.color === '#f85149' ? 'filter:drop-shadow(0 0 3px rgba(248,81,73,0.3))' : ''"
        />
        <text v-if="a.label" :x="(a.x1+a.x2)/2 + 12" :y="(a.y1+a.y2)/2" fill="#f85149" font-size="14" text-anchor="start">{{ a.label }}</text>
      </g>

      <!-- 节点 -->
      <g v-for="(n, i) in layout.nodes" :key="nodeId(i)" :filter="n.glow || undefined">
        <rect
          :x="n.x - n.w/2" :y="n.y"
          :width="n.w" :height="n.h"
          :rx="n.isDecision ? 26 : 8" :ry="n.isDecision ? 26 : 8"
          :fill="n.bg" :stroke="n.border" stroke-width="2"
        />
        <text :x="n.x - n.w/2 + 50" :y="n.y + 32" :fill="n.color" font-size="16" font-weight="600">
          {{ n.label.slice(0, 38) }}
        </text>
        <text v-if="n.sublabel" :x="n.x - n.w/2 + 50" :y="n.y + 56" fill="#8b949e" font-size="12">
          {{ n.sublabel.slice(0, 50) }}
        </text>
        <text :x="n.x - n.w/2 + 22" :y="n.y + 36" font-size="24" text-anchor="middle">
          {{ n.icon }}
        </text>
      </g>
    </svg>

    <!-- 图例 -->
    <div class="dag-legend">
      <div class="legend-item"><span class="legend-dot" style="background:#ff9800"></span> 攻击源</div>
      <div class="legend-item"><span class="legend-dot" style="background:#58a6ff"></span> 主Agent</div>
      <div class="legend-item"><span class="legend-dot" style="background:#bc8cff"></span> 子Agent</div>
      <div class="legend-item"><span class="legend-dot" style="background:#f85149"></span> 异常节点</div>
      <div class="legend-item"><span class="legend-dot" style="background:#56d364"></span> MCP代理</div>
    </div>

    <!-- 影响范围摘要 -->
    <div v-if="trace.impacted" class="dag-impact-bar">
      <span v-if="trace.impacted.files.length" class="impact-tag">📁 {{ trace.impacted.files.length }} 文件</span>
      <span v-if="trace.impacted.networkTargets.length" class="impact-tag">🌐 {{ trace.impacted.networkTargets.length }} 网络目标</span>
      <span v-if="trace.impacted.credentials.length" class="impact-tag" style="color:#f85149;border-color:#f85149">🔑 凭据泄露</span>
    </div>
  </div>
</template>

<style scoped>
.dag-viewer {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  overflow: auto;
  max-height: 600px;
}
.dag-svg {
  display: block;
  min-width: 700px;
}
.dag-legend {
  display: flex;
  justify-content: center;
  gap: 18px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.legend-item {
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.dag-impact-bar {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 14px;
}
.impact-tag {
  font-size: 11px;
  padding: 4px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
}
</style>
