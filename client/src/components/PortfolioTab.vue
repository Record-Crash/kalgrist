<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useApi } from '../composables/useApi'
import GristIcon from './GristIcon.vue'
import chartXkcd from '../vendor/chart.xkcd-src/src/index.js'

const { getMe, getBalanceHistory } = useApi()

const bets = ref([])
const positions = ref([])
const balanceHistory = ref([])
const stats = ref(null)
const loading = ref(true)
const error = ref(null)
const pieFlowRef = ref(null)
const pieTagRef = ref(null)

const PIE_COLORS = ['#48bb78', '#e94560', '#f6ad55', '#63b3ed', '#b794f4', '#76e4f7', '#fc8181', '#fbd38d']

function renderPieFlow() {
  console.log('[pie] pieFlowRef:', pieFlowRef.value, 'stats:', stats.value)
  if (!pieFlowRef.value || !stats.value) return
  const s = stats.value
  const won = Math.round(s.total_won)
  const pending = Math.round(s.pending_wagered)
  const lost = Math.max(0, Math.round(s.total_wagered - s.pending_wagered - s.total_won))
  console.log('[pie flow] won:', won, 'lost:', lost, 'pending:', pending)
  if (won + lost + pending === 0) return
  const labels = []
  const data = []
  const colors = []
  if (won > 0)     { labels.push('Won');     data.push(won);     colors.push('#48bb78') }
  if (lost > 0)    { labels.push('Lost');    data.push(lost);    colors.push('#e94560') }
  if (pending > 0) { labels.push('Pending'); data.push(pending); colors.push('#f6ad55') }
  console.log('[pie flow] rendering with labels:', labels, 'data:', data)
  console.log('[pie flow] svg parent width:', pieFlowRef.value.parentElement?.clientWidth)
  pieFlowRef.value.innerHTML = ''
  try {
    new chartXkcd.Pie(pieFlowRef.value, {
      data: { labels, datasets: [{ data }] },
      options: {
        innerRadius: 0.5,
        height: 320,
        dataColors: colors,
        strokeColor: 'rgba(255,255,255,0.15)',
        backgroundColor: 'transparent',
        showLegend: false,
        fontFamily: '"Courier New", Courier, monospace',
        legendPosition: chartXkcd.config.positionType.downLeft,
        tooltipBackgroundColor: '#333333',
        tooltipBackgroundOpacity: 0.9,
        tooltipFontColor: 'white',
        tooltipBorderColor: 'rgba(255,255,255,0.25)',
        tooltipBorderWidth: 1,
        tooltipValueSuffix: ' grist',
      },
    })
    console.log('[pie flow] rendered ok')
  } catch (e) {
    console.error('[pie flow] error:', e)
  }
}

function renderPieTag() {
  console.log('[pie tag] pieTagRef:', pieTagRef.value, 'tag_breakdown:', stats.value?.tag_breakdown)
  if (!pieTagRef.value || !stats.value?.tag_breakdown?.length) return
  const MAX = 7
  const rows = stats.value.tag_breakdown.slice(0, MAX)
  if (stats.value.tag_breakdown.length > MAX) {
    const rest = stats.value.tag_breakdown.slice(MAX).reduce((s, t) => s + t.wagered, 0)
    rows.push({ tag: 'other', wagered: rest })
  }
  console.log('[pie tag] rows:', rows)
  pieTagRef.value.innerHTML = ''
  try {
    new chartXkcd.Pie(pieTagRef.value, {
      data: {
        labels: rows.map(r => r.tag),
        datasets: [{ data: rows.map(r => Math.round(r.wagered)) }],
      },
      options: {
        innerRadius: 0.5,
        height: 320,
        dataColors: PIE_COLORS,
        strokeColor: 'rgba(255,255,255,0.15)',
        backgroundColor: 'transparent',
        showLegend: false,
        fontFamily: '"Courier New", Courier, monospace',
        legendPosition: chartXkcd.config.positionType.downLeft,
        tooltipBackgroundColor: '#333333',
        tooltipBackgroundOpacity: 0.9,
        tooltipFontColor: 'white',
        tooltipBorderColor: 'rgba(255,255,255,0.25)',
        tooltipBorderWidth: 1,
        tooltipValueSuffix: ' grist',
      },
    })
    console.log('[pie tag] rendered ok')
  } catch (e) {
    console.error('[pie tag] error:', e)
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [data, history] = await Promise.all([getMe(), getBalanceHistory()])
    bets.value = data.bets || []
    positions.value = data.positions || []
    balanceHistory.value = history || []
    stats.value = data.stats || null
    loading.value = false
    await nextTick()
    renderPieFlow()
    renderPieTag()
  } catch (err) {
    error.value = err.message
    loading.value = false
  }
}

// Group bets and positions by market
const portfolioMarkets = computed(() => {
  const map = new Map()

  for (const bet of bets.value) {
    const key = bet.market_id
    if (!map.has(key)) {
      map.set(key, { id: key, title: bet.title, status: bet.status, type: 'parimutuel', bets: [], positions: [] })
    }
    map.get(key).bets.push(bet)
  }

  for (const pos of positions.value) {
    const key = pos.market_id
    if (!map.has(key)) {
      map.set(key, { id: key, title: pos.title, status: pos.status, type: 'cpmm', bets: [], positions: [] })
    }
    map.get(key).positions.push(pos)
  }

  return [...map.values()]
})

const activeMarkets = computed(() => portfolioMarkets.value.filter(m => m.status === 'open'))
const pastMarkets = computed(() => portfolioMarkets.value.filter(m => m.status !== 'open'))

function totalBet(market) {
  return market.bets.reduce((s, b) => s + parseFloat(b.amount), 0)
}

function totalShares(market) {
  return market.positions.reduce((s, p) => s + parseFloat(p.shares), 0)
}

function potentialPayout(market) {
  if (market.type === 'cpmm') {
    return market.positions.reduce((s, p) => s + parseFloat(p.shares), 0)
  }
  return market.bets.reduce((s, b) => s + parseFloat(b.potential_payout ?? b.amount), 0)
}

function netCost(market) {
  if (market.type === 'cpmm') {
    return market.positions.reduce((s, p) => s + parseFloat(p.net_cost ?? 0), 0)
  }
  return totalBet(market)
}

function winRatePct(s) {
  if (!s || s.markets_participated === 0) return null
  return Math.round((s.markets_won / s.markets_participated) * 100)
}

function signedNum(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(0)
}

const reasonLabels = {
  bet_place: 'Bet placed',
  bet_payout: 'Payout',
  bet_refund: 'Refund',
  grist_earn: 'Earned',
}

function historyLabel(entry) {
  return reasonLabels[entry.reason] || entry.reason
}

function historySign(entry) {
  return parseFloat(entry.amount) >= 0 ? '+' : ''
}

onMounted(load)
</script>

<template>
  <div>
    <div v-if="loading" class="empty-state">Loading...</div>
    <div v-else-if="error" class="empty-state">{{ error }}</div>
    <div v-else>
      <!-- Stats summary -->
      <div v-if="stats" class="bet-section">
        <h3 class="section-title">Stats</h3>

        <!-- Pie charts -->
        <div class="pie-row">
          <div class="pie-wrap pixel-corners">
            <div class="pie-title">Grist Flow</div>
            <svg ref="pieFlowRef"></svg>
          </div>
          <div class="pie-wrap pixel-corners" v-if="stats.tag_breakdown?.length">
            <div class="pie-title">Wagered By Tag</div>
            <svg ref="pieTagRef"></svg>
          </div>
        </div>

        <!-- Stat cards -->
        <div class="stats-grid">
          <div class="stat-card pixel-corners">
            <div class="stat-label">Total Wagered</div>
            <div class="stat-value">{{ stats.total_wagered.toFixed(0) }} <GristIcon /></div>
          </div>
          <div class="stat-card pixel-corners">
            <div class="stat-label">Pending</div>
            <div class="stat-value">{{ stats.pending_wagered.toFixed(0) }} <GristIcon /></div>
          </div>
          <div class="stat-card pixel-corners">
            <div class="stat-label">Total Won</div>
            <div class="stat-value positive">+{{ stats.total_won.toFixed(0) }} <GristIcon /></div>
            <div class="stat-sub">{{ stats.total_won_resolves.toFixed(0) }} from resolution</div>
          </div>
          <div class="stat-card pixel-corners">
            <div class="stat-label">Net Profit</div>
            <div class="stat-value" :class="stats.net_profit >= 0 ? 'positive' : 'negative'">
              {{ signedNum(stats.net_profit) }} <GristIcon />
            </div>
          </div>
          <div class="stat-card pixel-corners" style="grid-column: span 2">
            <div class="stat-label">Win Rate</div>
            <div class="stat-value">
              <template v-if="winRatePct(stats) !== null">{{ winRatePct(stats) }}%
                <span class="stat-sub">({{ stats.markets_won }}/{{ stats.markets_participated }} markets)</span>
              </template>
              <template v-else>—</template>
            </div>
          </div>
        </div>
      </div>

      <!-- Active positions -->
      <div v-if="activeMarkets.length" class="bet-section">
        <h3 class="section-title">Active Positions</h3>
        <div class="bet-list">
          <div v-for="market in activeMarkets" :key="market.id" class="bet-card pixel-corners">
            <div class="bet-header">
              <span class="bet-title">{{ market.title }}</span>
              <span class="bet-amount" v-if="market.type === 'parimutuel'">{{ totalBet(market).toFixed(0) }} <GristIcon /></span>
              <span class="bet-amount" v-else>{{ totalShares(market).toFixed(2) }} shares</span>
            </div>
            <!-- CPMM positions -->
            <div v-if="market.positions.length" class="bet-positions">
              <div v-for="pos in market.positions" :key="pos.option_id" class="bet-position">
                <span class="pos-label">{{ pos.option_label }}</span>
                <span class="pos-shares">{{ parseFloat(pos.shares).toFixed(2) }} shares</span>
              </div>
            </div>
            <!-- Parimutuel bets -->
            <div v-if="market.bets.length" class="bet-positions">
              <div v-for="bet in market.bets" :key="bet.id" class="bet-position">
                <span class="pos-label">{{ bet.option_label }}</span>
                <span class="pos-shares">{{ parseFloat(bet.amount).toFixed(0) }} <GristIcon /></span>
              </div>
            </div>
            <!-- Potential payout -->
            <div class="payout-hint">
              If win: <strong>{{ potentialPayout(market).toFixed(0) }} <GristIcon /></strong>
              <span :class="(potentialPayout(market) - netCost(market)) >= 0 ? 'positive' : 'negative'">
                ({{ signedNum(potentialPayout(market) - netCost(market)) }})
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Past positions -->
      <div v-if="pastMarkets.length" class="bet-section">
        <h3 class="section-title">Past Positions</h3>
        <div class="bet-list">
          <div v-for="market in pastMarkets" :key="market.id" class="bet-card pixel-corners">
            <div class="bet-header">
              <span class="bet-title">{{ market.title }}</span>
              <span class="bet-status" :class="market.status">{{ market.status }}</span>
            </div>
            <div v-if="market.positions.length" class="bet-positions">
              <div v-for="pos in market.positions" :key="pos.option_id" class="bet-position">
                <span class="pos-label">{{ pos.option_label }}</span>
                <span class="pos-shares">{{ parseFloat(pos.shares).toFixed(2) }} shares</span>
              </div>
            </div>
            <div v-if="market.bets.length" class="bet-positions">
              <div v-for="bet in market.bets" :key="bet.id" class="bet-position">
                <span class="pos-label">{{ bet.option_label }}</span>
                <span class="pos-shares">{{ parseFloat(bet.amount).toFixed(0) }} <GristIcon /></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!activeMarkets.length && !pastMarkets.length" class="empty-state">
        You haven't placed any bets yet.
      </div>

      <!-- Balance history -->
      <div v-if="balanceHistory.length" class="bet-section">
        <h3 class="section-title">Balance History</h3>
        <div class="history-list">
          <div v-for="entry in balanceHistory" :key="entry.created_at + entry.reason" class="history-row">
            <div class="history-info">
              <span class="history-label">{{ historyLabel(entry) }}</span>
              <span class="history-market" v-if="entry.market_title">{{ entry.market_title }}</span>
            </div>
            <span
              class="history-amount"
              :class="parseFloat(entry.amount) >= 0 ? 'positive' : 'negative'"
            >{{ historySign(entry) }}{{ parseFloat(entry.amount).toFixed(0) }}</span>
          </div>
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

.bet-section {
  margin-bottom: 20px;
}

.section-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--muted);
  letter-spacing: 1px;
  font-weight: normal;
  margin: 0 0 8px;
}

.bet-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bet-card {
  background: var(--surface);
  padding: 12px;
}

.bet-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 6px;
}

.bet-title {
  font-size: 0.85rem;
  font-weight: 600;
  flex: 1;
}

.bet-amount {
  font-size: 0.8rem;
  color: var(--accent);
  font-weight: 600;
  white-space: nowrap;
  margin-left: 8px;
}

.bet-status {
  margin-left: 8px;
  font-size: 0.65rem;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.bet-status.resolved { color: #48bb78; }
.bet-status.cancelled { color: #e94560; }

.bet-positions {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.bet-position {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--muted);
}

.pos-label {
  flex: 1;
}

.pos-shares {
  color: var(--text);
  font-weight: 500;
}

/* Pie charts */
.pie-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 8px;
}

.pie-wrap {
  background: var(--surface);
  padding: 8px;
}

.pie-title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  margin-bottom: 4px;
}

.pie-wrap svg {
  width: 100%;
  display: block;
}

/* Stats grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.stat-card {
  background: var(--surface);
  padding: 10px 12px;
}

.stat-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 3px;
}

.stat-sub {
  font-size: 0.65rem;
  color: var(--muted);
  font-weight: 400;
  margin-left: 2px;
}

.stat-card > .stat-sub {
  margin-left: 0;
  margin-top: 3px;
  display: block;
}

/* Potential payout hint */
.payout-hint {
  font-size: 0.7rem;
  color: var(--muted);
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.payout-hint strong {
  color: var(--text);
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

/* Balance history */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--surface);
}

.history-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.history-row:last-child {
  border-bottom: none;
}

.history-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-label {
  font-size: 0.8rem;
  color: var(--text);
}

.history-market {
  font-size: 0.7rem;
  color: var(--muted);
}

.history-amount {
  font-size: 0.85rem;
  font-weight: 700;
  white-space: nowrap;
  margin-left: 12px;
}
.positive { color: #48bb78; }
.negative { color: #e94560; }
.history-amount.positive { color: #48bb78; }
.history-amount.negative { color: #e94560; }
</style>
