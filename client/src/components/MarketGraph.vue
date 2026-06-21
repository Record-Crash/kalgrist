<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import chartXkcd from '../vendor/chart.xkcd-src/src/index.js'
import { useApi } from '../composables/useApi'

const props = defineProps({
  market: Object,
  colors: Array,
  compact: { type: Boolean, default: false },
  defaultRange: { type: String, default: 'all' },
})

const { getMarketHistory } = useApi()
const svgRef = ref(null)
const points = ref([])
let chartInstance = null

const RANGES = [
  { key: 'live', label: 'Live', ms: 60 * 60 * 1000 },
  { key: '1d',   label: '1D',   ms: 24 * 60 * 60 * 1000 },
  { key: '1w',   label: '1W',   ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'all',  label: 'ALL',  ms: null },
]
const activeRange = ref(props.defaultRange)

// Unique ID per instance to avoid chart.xkcd internal conflicts
const chartId = `xkcd-${Math.random().toString(36).slice(2)}`

function filterPoints(rawPoints, windowMs) {
  if (!windowMs) return rawPoints
  const cutoff = Date.now() - windowMs
  return rawPoints.filter(p => new Date(p.t).getTime() >= cutoff)
}

function buildTimeSeries(rawPoints, options, windowMs, steps = 20) {
  const times = rawPoints.map(p => new Date(p.t).getTime())
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const span = tMax - tMin

  const timeSteps = steps === 1
    ? [tMin]
    : Array.from({ length: steps }, (_, i) => tMin + (i / (steps - 1)) * span)

  // Label format based on the selected window
  let fmt
  if (!windowMs || windowMs > 7 * 24 * 60 * 60 * 1000) {
    fmt = { month: 'short', day: 'numeric' }
  } else if (windowMs > 24 * 60 * 60 * 1000) {
    fmt = { weekday: 'short', hour: '2-digit', minute: '2-digit' }
  } else if (span < 5 * 60 * 1000) {
    fmt = { hour: '2-digit', minute: '2-digit', second: '2-digit' }
  } else {
    fmt = { hour: '2-digit', minute: '2-digit' }
  }
  const labels = timeSteps.map(t => new Date(t).toLocaleString([], fmt))

  const datasets = options.map((opt, index) => {
    const data = timeSteps.map(t => {
      let last = null
      for (const p of rawPoints) {
        if (new Date(p.t).getTime() <= t) last = p
        else break
      }
      if (!last) return 0
      const v = last.pcts?.[opt.id]
      return (v !== undefined && v !== null) ? Number(v) : 0
    })
    return { label: opt.label, data, color: props.colors?.[index] }
  })

  return { labels, datasets }
}

function renderChart() {
  if (!svgRef.value || points.value.length < 2) return

  const chartHeight = props.compact ? 120 : 220;
  const range = RANGES.find(r => r.key === activeRange.value)
  const filtered = filterPoints(points.value, range.ms)
  const visible = filtered.length >= 2 ? filtered : points.value

  const options = props.market.options || []
  const { labels, datasets } = buildTimeSeries(visible, options, range.ms)

  svgRef.value.innerHTML = ''

  // Initialize chart.xkcd Line chart
  chartInstance = new chartXkcd.Line(svgRef.value, {
    data: {
      labels: labels,
      datasets: datasets,
    },
    options: {
      // Layout
      height: chartHeight,
      margin: { top: 8, right: 8, bottom: 24, left: 36 },
      backgroundColor: 'transparent',
      // Colors & strokes
      strokeColor: 'white',
      dataColors: props.colors,
      // Legend
      showLegend: false,
      // Axes
      axisFontSize: 11,
      fontFamily: '"Courier New", Courier, monospace',
      xTickCount: props.compact ? 3 : 5,
      yMin: 0,
      yMax: 100,
      yTickValues: props.compact ? [0, 50, 100] : [0, 25, 50, 75, 100],
      showYAxisLine: false,
      showXAxisLine: false,
      // Grid lines
      gridLines: props.compact ? [0, 50, 100] : [0, 25, 50, 75, 100],
      gridLineColor: 'rgba(255,255,255,0.15)',
      gridLineDash: '4,4',
      gridLineWidth: 1,
      // Tooltip
      tooltipBackgroundColor: '#333333',
      tooltipBackgroundOpacity: 0.9,
      tooltipFontColor: 'white',
      tooltipBorderColor: 'rgba(255,255,255,0.25)',
      tooltipBorderWidth: 1,
      tooltipValueSuffix: '%',
      // Style
      unxkcdify: false,
    }
  })
}

async function fetchHistory() {
  try {
    const data = await getMarketHistory(props.market.id)
    console.log(`[MarketGraph ${chartId}] fetched history for market id=${props.market.id}:`, data)
    if (data?.points) {
      points.value = data.points
      await nextTick()
      renderChart()
    }
  } catch (e) {
    console.error("History fetch error:", e)
  }
}

let poll = null
onMounted(() => {
  fetchHistory()
  poll = setInterval(fetchHistory, 5000)
  window.addEventListener('resize', renderChart)
})

onUnmounted(() => {
  if (poll) clearInterval(poll)
  window.removeEventListener('resize', renderChart)
})

watch(() => props.market.id, () => {
  points.value = []
  fetchHistory()
})
</script>

<template>
  <div class="xkcd-wrapper" :class="{ compact }">
    <div v-if="!compact" class="range-tabs">
      <button
        v-for="r in RANGES"
        :key="r.key"
        class="range-btn"
        :class="{ active: activeRange === r.key }"
        @click.stop="activeRange = r.key; renderChart()"
      >{{ r.label }}</button>
    </div>
    <svg :id="chartId" ref="svgRef" class="xkcd-chart"></svg>
  </div>
</template>

<style scoped>
.xkcd-wrapper {
  width: 100%;
  background: transparent;
  overflow: hidden;
}

.xkcd-wrapper.compact {
  height: 120px;
}

.xkcd-wrapper:not(.compact) {
  height: 248px; /* 24px tabs + 4px gap + 220px chart */
}

.range-tabs {
  display: flex;
  gap: 4px;
  height: 24px;
  margin-bottom: 4px;
}

.range-btn {
  background: transparent;
  border: 1px solid var(--border, #444);
  color: var(--text-muted, #888);
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  padding: 0 8px;
  cursor: pointer;
  line-height: 1;
  transition: color 0.1s, border-color 0.1s;
}

.range-btn:hover {
  color: var(--text, #eee);
  border-color: var(--text, #eee);
}

.range-btn.active {
  color: var(--accent, #1cb3f2);
  border-color: var(--accent, #1cb3f2);
}

.xkcd-chart {
  width: 100%;
  height: 100%; /* Force SVG to fill the wrapper */
  background: transparent;

  /* Use crisp-edges only if pixelated is too harsh; standard rendering often looks better for xkcd */
  image-rendering: auto; 
  
  font-family: 'Courier New', Courier, monospace !important;
}

/* Force internal XKCD elements to use Courier */
.xkcd-chart :deep(text) {
  font-family: 'Courier New', Courier, monospace !important;
  fill: currentColor; /* Inherit color for dark/light mode compatibility */
}

/* Remove the white background typically generated by chart.xkcd internal containers */
.xkcd-chart :deep(rect) {
  fill: transparent !important;
}

/* Smooth the "staircase" while keeping the jittery geometry */
.xkcd-chart :deep(path) {
  shape-rendering: geometricPrecision;
}
</style>