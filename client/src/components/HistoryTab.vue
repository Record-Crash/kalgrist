<script setup>
import { ref, computed, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import GristIcon from './GristIcon.vue'

const { getMarketsHistory } = useApi()

const markets = ref([])
const loading = ref(true)
const error = ref(null)

function totalPool(market) {
  return market.total_grist ?? 0
}

function winnerLabel(market) {
  if (!market.resolved_option) return null
  const opt = market.options?.find(o => o.id === market.resolved_option)
  return opt?.label || null
}

function optionPercentages(market) {
  if (!market.pool) return {}
  const map = {}
  if (market.market_type === 'cpmm') {
    for (const p of market.pool) {
      map[p.option_id] = p.percentage ?? 0
    }
  } else {
    const total = market.pool.reduce((s, p) => s + parseFloat(p.total || 0), 0)
    for (const p of market.pool) {
      map[p.option_id] = total > 0 ? Math.round(parseFloat(p.total) / total * 100) : 0
    }
  }
  return map
}

async function load() {
  loading.value = true
  error.value = null
  try {
    markets.value = await getMarketsHistory()
  } catch (err) {
    error.value = err.message
  }
  loading.value = false
}

onMounted(load)

const colors = ['#1cb3f2', '#48bb78', '#f59e0b', '#a78bfa', '#ec4899']
</script>

<template>
  <div>
    <div v-if="loading" class="empty-state">Loading...</div>
    <div v-else-if="error" class="empty-state">{{ error }}</div>
    <div v-else-if="markets.length === 0" class="empty-state">No resolved markets yet.</div>
    <div v-else class="history-list">
      <div
        v-for="market in markets"
        :key="market.id"
        class="history-card pixel-corners"
      >
        <div class="hc-header">
          <h3 class="hc-title">{{ market.title }}</h3>
          <span class="hc-status" :class="market.status">{{ market.status }}</span>
        </div>
        <div class="hc-pool">{{ totalPool(market).toFixed(0) }} <GristIcon /> in pool</div>
        <div v-if="winnerLabel(market)" class="hc-winner">
          Winner: <strong>{{ winnerLabel(market) }}</strong>
        </div>
        <div class="hc-options">
          <div
            v-for="(opt, i) in market.options"
            :key="opt.id"
            class="hc-option"
          >
            <span class="hc-dot" :style="{ background: colors[i % colors.length] }"></span>
            <span class="hc-opt-label">{{ opt.label }}</span>
            <span class="hc-opt-pct">{{ optionPercentages(market)[opt.id] || 0 }}%</span>
          </div>
        </div>
        <div v-if="market.resolved_at" class="hc-date">
          Resolved {{ new Date(market.resolved_at).toLocaleDateString() }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  text-align: center;
  color: var(--muted);
  padding: 40px 20px;
  font-size: 0.9rem;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-card {
  background: var(--surface);
  padding: 14px;
}

.hc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 6px;
}

.hc-title {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.3;
  flex: 1;
  margin: 0;
}

.hc-status {
  font-size: 0.65rem;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 4px;
  margin-left: 8px;
  white-space: nowrap;
}
.hc-status.resolved {
  color: #48bb78;
  background: rgba(72, 187, 120, 0.15);
}
.hc-status.cancelled {
  color: #e94560;
  background: rgba(233, 69, 96, 0.15);
}

.hc-pool {
  font-size: 0.7rem;
  color: var(--muted);
  margin-bottom: 8px;
}

.hc-winner {
  font-size: 0.8rem;
  color: #48bb78;
  margin-bottom: 8px;
}

.hc-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hc-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
}

.hc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.hc-opt-label {
  flex: 1;
  color: var(--text);
}

.hc-opt-pct {
  font-weight: 700;
  color: var(--muted);
}

.hc-date {
  font-size: 0.65rem;
  color: var(--muted);
  margin-top: 8px;
}

@media (min-width: 640px) {
  .history-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
}
</style>
