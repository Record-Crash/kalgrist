<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import MarketGraph from './MarketGraph.vue'
import GristIcon from './GristIcon.vue'
import CardGradient from './CardGradient.vue'

const props = defineProps({
  market: Object,
  featured: Boolean,
  isMod: Boolean,
})

const emit = defineEmits(['open-bet'])

const now = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 30000) })
onUnmounted(() => clearInterval(timer))

const timeLeft = computed(() => {
  if (!props.market.closes_at) return null
  const diff = new Date(props.market.closes_at) - now.value
  if (diff <= 0) return 'Ended'
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  if (hours >= 24) return `${Math.floor(hours / 24)}d left`
  if (hours > 0) return `${hours}h ${minutes}m left`
  return `${minutes}m left`
})

const totalGrist = computed(() => props.market.total_grist ?? 0)
const participantCount = computed(() => props.market.participant_count ?? 0)

const isCpmm = computed(() => props.market.market_type === 'cpmm')

const optionPercentages = computed(() => {
  if (!props.market.pool) return {}
  if (isCpmm.value) {
    const map = {}
    for (const p of props.market.pool) {
      map[p.option_id] = p.percentage ?? 0
    }
    return map
  }
  const total = props.market.pool.reduce((sum, p) => sum + parseFloat(p.total || 0), 0)
  if (!total) return {}
  const map = {}
  for (const p of props.market.pool) {
    map[p.option_id] = Math.round((parseFloat(p.total) / total) * 100)
  }
  return map
})

function getPayout(pct) {
  if (!pct || pct === 0) return '—'
  return (100 / pct).toFixed(1) + '×'
}

const colors = ['#1cb3f2', '#48bb78', '#f59e0b', '#a78bfa', '#ec4899']

</script>

<template>
  <!-- Hero / Featured market -->
  <div v-if="featured" class="hero-card pixel-corners" @click="emit('open-bet', market)">
    <CardGradient :options="market.options" :colors="colors" :percentages="optionPercentages" />
    <div class="hero-top">
      <span class="live-badge"><span class="live-dot"></span> LIVE</span>
      <span v-if="isMod && market.hidden" class="hidden-badge">HIDDEN</span>
      <span class="pool-badge">{{ totalGrist.toFixed(0) }} <GristIcon /> · {{ participantCount }} participants</span>
      <span v-if="timeLeft" class="countdown-badge">⏱ {{ timeLeft }}</span>
    </div>
    <div class="hero-title-row">
      <img v-if="market.icon_url" :src="market.icon_url" class="market-icon" />
      <div class="hero-title-block">
        <h2 class="hero-title">{{ market.title }} <span class="market-id">#{{ market.id }}</span></h2>
        <div v-if="market.tags && market.tags.length" class="hero-tags">
          <span v-for="tag in market.tags" :key="tag" class="tag-badge">{{ tag }}</span>
        </div>
      </div>
    </div>
    <div class="hero-graph">
      <MarketGraph :market="market" :colors="colors" defaultRange="1d" />
    </div>
    <div class="hero-options">
      <div
        v-for="(opt, i) in market.options"
        :key="opt.id"
        class="hero-option"
        :style="{ borderLeftColor: colors[i % colors.length] }"
      >
        <span class="hero-opt-label">{{ opt.label }}</span>
        <span class="hero-opt-pct" :style="{ color: colors[i % colors.length] }">
          {{ optionPercentages[opt.id] || 0 }}%
        </span>
      </div>
    </div>
  </div>

  <!-- Standard market card -->
  <div v-else class="market-card pixel-corners" @click="emit('open-bet', market)">
    <CardGradient :options="market.options" :colors="colors" :percentages="optionPercentages" />
    <div class="mc-header">
      <span v-if="isMod && market.hidden" class="hidden-badge hidden-badge--sm">HIDDEN</span>
      <div class="mc-title-row">
        <img v-if="market.icon_url" :src="market.icon_url" class="market-icon market-icon--sm" />
        <h3 class="mc-title">{{ market.title }} <span class="market-id">#{{ market.id }}</span></h3>
      </div>
      <div class="mc-meta">
        <span v-if="timeLeft" class="mc-countdown">⏱ {{ timeLeft }}</span>
        <span class="mc-pool">{{ totalGrist.toFixed(0) }} <GristIcon /> · {{ participantCount }}p</span>
      </div>
    </div>
    <div v-if="market.tags && market.tags.length" class="mc-tags">
      <span v-for="tag in market.tags" :key="tag" class="tag-badge">{{ tag }}</span>
    </div>
    <div class="mc-options">
      <div
        v-for="(opt, i) in market.options"
        :key="opt.id"
        class="mc-option"
      >
        <div class="mc-opt-info">
          <span class="mc-dot" :style="{ background: colors[i % colors.length] }"></span>
          <span class="mc-opt-label">{{ opt.label }}</span>
        </div>
        <div class="mc-opt-stats">
          <span class="mc-opt-pct">{{ optionPercentages[opt.id] || 0 }}%</span>
          <span class="mc-opt-payout">{{ getPayout(optionPercentages[opt.id]) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── Hero card ─── */
.hero-card {
  /* border: 1px solid var(--border);
  border-radius: 12px; */
  padding: 20px;
  cursor: pointer;
  transition: border-color 0.15s;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.hero-card:hover.pixel-corners::after,
.hero-card:hover.pixel-corners--wrapper::after {
  content: "";
  position: absolute;
  clip-path: polygon(0px calc(100% - 14px),
    2px calc(100% - 14px),
    2px calc(100% - 10px),
    4px calc(100% - 10px),
    4px calc(100% - 6px),
    6px calc(100% - 6px),
    6px calc(100% - 4px),
    10px calc(100% - 4px),
    10px calc(100% - 2px),
    14px calc(100% - 2px),
    14px 100%,
    calc(100% - 14px) 100%,
    calc(100% - 14px) calc(100% - 2px),
    calc(100% - 10px) calc(100% - 2px),
    calc(100% - 10px) calc(100% - 4px),
    calc(100% - 6px) calc(100% - 4px),
    calc(100% - 6px) calc(100% - 6px),
    calc(100% - 4px) calc(100% - 6px),
    calc(100% - 4px) calc(100% - 10px),
    calc(100% - 2px) calc(100% - 10px),
    calc(100% - 2px) calc(100% - 14px),
    100% calc(100% - 14px),
    100% 14px,
    calc(100% - 2px) 14px,
    calc(100% - 2px) 10px,
    calc(100% - 4px) 10px,
    calc(100% - 4px) 6px,
    calc(100% - 6px) 6px,
    calc(100% - 6px) 4px,
    calc(100% - 10px) 4px,
    calc(100% - 10px) 2px,
    calc(100% - 14px) 2px,
    calc(100% - 14px) 0px,
    14px 0px,
    14px 2px,
    10px 2px,
    10px 4px,
    6px 4px,
    6px 6px,
    4px 6px,
    4px 10px,
    2px 10px,
    2px 14px,
    0px 14px,
    0px 50%,
    2px 50%,
    2px 14px,
    4px 14px,
    4px 10px,
    6px 10px,
    6px 6px,
    10px 6px,
    10px 4px,
    14px 4px,
    14px 2px,
    calc(100% - 14px) 2px,
    calc(100% - 14px) 4px,
    calc(100% - 10px) 4px,
    calc(100% - 10px) 6px,
    calc(100% - 6px) 6px,
    calc(100% - 6px) 10px,
    calc(100% - 4px) 10px,
    calc(100% - 4px) 14px,
    calc(100% - 2px) 14px,
    calc(100% - 2px) calc(100% - 14px),
    calc(100% - 4px) calc(100% - 14px),
    calc(100% - 4px) calc(100% - 10px),
    calc(100% - 6px) calc(100% - 10px),
    calc(100% - 6px) calc(100% - 6px),
    calc(100% - 10px) calc(100% - 6px),
    calc(100% - 10px) calc(100% - 4px),
    calc(100% - 14px) calc(100% - 4px),
    calc(100% - 14px) calc(100% - 2px),
    14px calc(100% - 2px),
    14px calc(100% - 4px),
    10px calc(100% - 4px),
    10px calc(100% - 6px),
    6px calc(100% - 6px),
    6px calc(100% - 10px),
    4px calc(100% - 10px),
    4px calc(100% - 14px),
    2px calc(100% - 14px),
    2px 50%,
    0px 50%);
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--accent);
  display: block;
  pointer-events: none;
}
.hero-card > :not(canvas),
.market-card > :not(canvas) {
  position: relative;
  z-index: 1;
}

.hero-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.live-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--accent);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.pool-badge {
  font-size: 0.7rem;
  color: var(--muted);
}

.countdown-badge {
  font-size: 0.7rem;
  color: #f59e0b;
  margin-left: auto;
}

.hero-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 16px;
}

.hero-title-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.hero-title {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
}

.hero-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.hero-graph {
  margin-bottom: 16px;
}

.hero-options {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.hero-option {
  flex: 1;
  min-width: 100px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-left: 3px solid;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.hero-opt-label {
  font-size: 0.85rem;
  color: var(--text);
}

.hero-opt-pct {
  font-size: 1.1rem;
  font-weight: 700;
}

/* ─── Standard card ─── */
.market-card {
  /* border: 1px solid var(--border);
  border-radius: 10px;*/
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.15s;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.market-card:hover.pixel-corners::after,
.market-card:hover.pixel-corners--wrapper::after {
  content: "";
  position: absolute;
  clip-path: polygon(0px calc(100% - 14px),
    2px calc(100% - 14px),
    2px calc(100% - 10px),
    4px calc(100% - 10px),
    4px calc(100% - 6px),
    6px calc(100% - 6px),
    6px calc(100% - 4px),
    10px calc(100% - 4px),
    10px calc(100% - 2px),
    14px calc(100% - 2px),
    14px 100%,
    calc(100% - 14px) 100%,
    calc(100% - 14px) calc(100% - 2px),
    calc(100% - 10px) calc(100% - 2px),
    calc(100% - 10px) calc(100% - 4px),
    calc(100% - 6px) calc(100% - 4px),
    calc(100% - 6px) calc(100% - 6px),
    calc(100% - 4px) calc(100% - 6px),
    calc(100% - 4px) calc(100% - 10px),
    calc(100% - 2px) calc(100% - 10px),
    calc(100% - 2px) calc(100% - 14px),
    100% calc(100% - 14px),
    100% 14px,
    calc(100% - 2px) 14px,
    calc(100% - 2px) 10px,
    calc(100% - 4px) 10px,
    calc(100% - 4px) 6px,
    calc(100% - 6px) 6px,
    calc(100% - 6px) 4px,
    calc(100% - 10px) 4px,
    calc(100% - 10px) 2px,
    calc(100% - 14px) 2px,
    calc(100% - 14px) 0px,
    14px 0px,
    14px 2px,
    10px 2px,
    10px 4px,
    6px 4px,
    6px 6px,
    4px 6px,
    4px 10px,
    2px 10px,
    2px 14px,
    0px 14px,
    0px 50%,
    2px 50%,
    2px 14px,
    4px 14px,
    4px 10px,
    6px 10px,
    6px 6px,
    10px 6px,
    10px 4px,
    14px 4px,
    14px 2px,
    calc(100% - 14px) 2px,
    calc(100% - 14px) 4px,
    calc(100% - 10px) 4px,
    calc(100% - 10px) 6px,
    calc(100% - 6px) 6px,
    calc(100% - 6px) 10px,
    calc(100% - 4px) 10px,
    calc(100% - 4px) 14px,
    calc(100% - 2px) 14px,
    calc(100% - 2px) calc(100% - 14px),
    calc(100% - 4px) calc(100% - 14px),
    calc(100% - 4px) calc(100% - 10px),
    calc(100% - 6px) calc(100% - 10px),
    calc(100% - 6px) calc(100% - 6px),
    calc(100% - 10px) calc(100% - 6px),
    calc(100% - 10px) calc(100% - 4px),
    calc(100% - 14px) calc(100% - 4px),
    calc(100% - 14px) calc(100% - 2px),
    14px calc(100% - 2px),
    14px calc(100% - 4px),
    10px calc(100% - 4px),
    10px calc(100% - 6px),
    6px calc(100% - 6px),
    6px calc(100% - 10px),
    4px calc(100% - 10px),
    4px calc(100% - 14px),
    2px calc(100% - 14px),
    2px 50%,
    0px 50%);
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--accent);
  display: block;
  pointer-events: none;
}
.mc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
  gap: 8px;
}

.mc-title-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  flex: 1;
  min-width: 0;
}

.mc-title {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
  min-width: 0;
}

.mc-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-left: 8px;
  flex-shrink: 0;
}

.mc-countdown {
  font-size: 0.65rem;
  color: #f59e0b;
  white-space: nowrap;
}

.mc-pool {
  font-size: 0.7rem;
  color: var(--muted);
  white-space: nowrap;
}

.mc-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.market-icon {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  margin-top: 2px;
}

.market-icon--sm {
  width: 20px;
  height: 20px;
}

.market-id {
  color: var(--muted);
  font-weight: 400;
  font-size: 0.85em;
}

.hidden-badge {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #e94560;
  border: 1px solid #e94560;
  padding: 1px 6px;
  text-transform: uppercase;
}

.hidden-badge--sm {
  font-size: 0.55rem;
  padding: 1px 5px;
  margin-right: 4px;
  flex-shrink: 0;
}

.tag-badge {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 1px 6px;
  opacity: 0.8;
}

.mc-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mc-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 8px 10px;
}

.mc-opt-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mc-opt-label {
  font-size: 0.8rem;
  color: var(--text);
}

.mc-opt-stats {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mc-opt-pct {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
}

.mc-opt-payout {
  font-size: 0.7rem;
  color: var(--muted);
  background: rgba(255,255,255,0.05);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
