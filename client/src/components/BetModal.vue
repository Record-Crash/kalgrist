<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import { useApi } from '../composables/useApi'
import { useGristAnimation } from '../composables/useGristAnimation'
import MarketGraph from './MarketGraph.vue'
import GristParticles from './GristParticles.vue'
import GristIcon from './GristIcon.vue'

const props = defineProps({ market: Object, isMod: Boolean, balance: Number })
const emit = defineEmits(['close', 'placed'])

const { getMarket, placeBet, trade, getPositions, resolveMarket, addOption, toggleHidden, updateClosesAt } = useApi()

const widgetReady = ref(false)
const widgetExpanded = ref(false)
const gameWidgetRef = ref(null)
const widgetHasTabs = ref(false)

watch(gameWidgetRef, (el, _, onCleanup) => {
  widgetHasTabs.value = false
  if (!el) return
  const ro = new ResizeObserver(() => {
    widgetHasTabs.value = el.offsetHeight > 200
  })
  ro.observe(el)
  onCleanup(() => ro.disconnect())
})

async function initWidget() {
  // Intercept fetch + XHR so we can see what the widget requests
  if (!window.__widgetFetchPatched) {
    window.__widgetFetchPatched = true
    const _fetch = window.fetch
    window.fetch = (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url
      console.log('[widget-fetch]', url)
      return _fetch(...args)
    }
    const _open = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      console.log('[widget-xhr]', method, url)
      return _open.call(this, method, url, ...rest)
    }
  }
  console.log('[widget] initWidget called, fixture_id:', props.market.fixture_id)
  const existing = document.querySelector('script[data-api-sports]')
  if (existing) {
    console.log('[widget] script already loaded, showing elements immediately')
    widgetReady.value = true
    await nextTick()
    window.dispatchEvent(new Event('DOMContentLoaded'))
  } else {
    const src = '/api/sports-widget.js'
    console.log('[widget] injecting script, will show elements after load')
    const s = document.createElement('script')
    s.type = 'module'
    s.src = src
    s.setAttribute('data-api-sports', '')
    s.onload = async () => {
      console.log('[widget] script loaded, setting widgetReady')
      widgetReady.value = true
      // Wait for Vue to render the api-sports-widget elements, then kick the
      // widget's DOMContentLoaded initializer which missed its original firing
      await nextTick()
      console.log('[widget] dispatching DOMContentLoaded to trigger widget init')
      window.dispatchEvent(new Event('DOMContentLoaded'))
    }
    s.onerror = (e) => console.error('[widget] script failed to load', e)
    document.head.appendChild(s)
  }
}

const liveMarket = ref(props.market)
const selectedOption = ref(null)
const side = ref('buy') // 'buy' or 'sell'
const amount = ref(10)
const placing = ref(false)
const error = ref(null)
const positions = ref([]) // user's share holdings

const colors = ['#1cb3f2', '#48bb78', '#f59e0b', '#a78bfa', '#ec4899']

const isCpmm = computed(() => liveMarket.value.market_type === 'cpmm')
const origin = window.location.origin

watch([() => liveMarket.value.fixture_id, widgetReady], ([fid, ready]) => {
  console.log('[widget] condition check — fixture_id:', fid, '| widgetReady:', ready, '| showing widget:', !!(fid && ready))
})

// Poll for live data
let poll = null
async function refresh() {
  try {
    const [data, pos] = await Promise.all([
      getMarket(props.market.id),
      getPositions(props.market.id),
    ])
    liveMarket.value = data
    positions.value = pos
  } catch {}
}
onMounted(() => {
  console.log('[widget] BetModal mounted, fixture_id:', props.market.fixture_id)
  refresh()
  poll = setInterval(refresh, 3000)
  if (props.market.fixture_id) {
    initWidget()
  } else {
    console.log('[widget] no fixture_id on market, widget skipped')
  }
})
onUnmounted(() => clearInterval(poll))

const optionPercentages = computed(() => {
  if (!liveMarket.value.pool) return {}
  const map = {}
  if (isCpmm.value) {
    for (const p of liveMarket.value.pool) {
      map[p.option_id] = p.percentage ?? 0
    }
  } else {
    const total = liveMarket.value.pool.reduce((s, p) => s + parseFloat(p.total || 0), 0)
    for (const p of liveMarket.value.pool) {
      map[p.option_id] = total > 0 ? Math.round((parseFloat(p.total) / total) * 100) : 0
    }
  }
  return map
})

function selectOption(opt) {
  selectedOption.value = opt
  side.value = 'buy'
  amount.value = 10
}

function getPositionShares(optId) {
  const pos = positions.value.find(p => p.option_id === optId)
  return pos ? parseFloat(pos.shares) : 0
}

function floorShares(n) {
  return Math.floor(n * 100) / 100
}

function getPositionAvgCost(optId) {
  const pos = positions.value.find(p => p.option_id === optId)
  return pos ? parseFloat(pos.avg_cost_per_share) : 0
}

// Estimate grist back for selling numShares of optId using AMM formula
function sellPriceForShares(optId, numShares) {
  if (!liveMarket.value.pool || !numShares || numShares <= 0) return 0
  const pool = liveMarket.value.pool
  const poolArr = pool.map(p => parseFloat(p.poolShares))
  const optIndex = liveMarket.value.options.findIndex(o => o.id === optId)
  if (optIndex === -1 || poolArr.some(isNaN)) return 0

  try {
    const k = poolArr.reduce((p, v) => p * v, 1)
    const a = poolArr[optIndex] + numShares
    const others = poolArr.filter((_, i) => i !== optIndex)

    let d
    if (others.length === 1) {
      const b = others[0]
      const sum = a + b
      const disc = sum * sum - 4 * (a * b - k)
      d = (sum - Math.sqrt(disc)) / 2
    } else {
      const maxD = Math.min(a, ...others) - 1e-9
      d = maxD * 0.5
      for (let iter = 0; iter < 100; iter++) {
        const ad = a - d
        let prod = 1
        for (const o of others) prod *= (o - d)
        const f = ad * prod - k
        let sumPartials = 0
        for (let j = 0; j < others.length; j++) {
          let partial = 1
          for (let m = 0; m < others.length; m++) {
            if (m !== j) partial *= (others[m] - d)
          }
          sumPartials += partial
        }
        const fp = -prod - ad * sumPartials
        const step = f / fp
        d = d - step
        if (d < 0) d = 0
        if (d > maxD) d = maxD
        if (Math.abs(step) < 1e-10) break
      }
    }
    return d > 0 ? d : 0
  } catch {
    return 0
  }
}

// AMM preview: estimate shares out (buy) or grist back (sell)
const estimate = computed(() => {
  if (!selectedOption.value || !amount.value || !isCpmm.value || !liveMarket.value.pool) return null
  const pool = liveMarket.value.pool
  if (!pool.length) return null
  const poolArr = pool.map(p => parseFloat(p.poolShares))
  const optIndex = liveMarket.value.options.findIndex(o => o.id === selectedOption.value.id)
  if (optIndex === -1 || poolArr.some(isNaN)) return null
  const cost = parseFloat(amount.value)
  if (!cost || cost <= 0) return null

  try {
    if (side.value === 'buy') {
      const k = poolArr.reduce((p, v) => p * v, 1)
      const minted = poolArr.map(p => p + cost)
      const otherProduct = minted.reduce((p, v, i) => i === optIndex ? p : p * v, 1)
      const sharesOut = minted[optIndex] - k / otherProduct
      return { label: 'Est. shares', value: sharesOut.toFixed(2) }
    } else {
      const k = poolArr.reduce((p, v) => p * v, 1)
      const numShares = cost // cost = numShares for sell
      const a = poolArr[optIndex] + numShares
      const others = poolArr.filter((_, i) => i !== optIndex)

      let d
      if (others.length === 1) {
        // n=2: quadratic (a - d)(b - d) = k
        const b = others[0]
        const sum = a + b
        const disc = sum * sum - 4 * (a * b - k)
        d = (sum - Math.sqrt(disc)) / 2
      } else {
        // n>2: Newton's method
        const maxD = Math.min(a, ...others) - 1e-9
        d = maxD * 0.5
        for (let iter = 0; iter < 100; iter++) {
          const ad = a - d
          let prod = 1
          for (const o of others) prod *= (o - d)
          const f = ad * prod - k
          let sumPartials = 0
          for (let j = 0; j < others.length; j++) {
            let partial = 1
            for (let m = 0; m < others.length; m++) {
              if (m !== j) partial *= (others[m] - d)
            }
            sumPartials += partial
          }
          const fp = -prod - ad * sumPartials
          const step = f / fp
          d = d - step
          if (d < 0) d = 0
          if (d > maxD) d = maxD
          if (Math.abs(step) < 1e-10) break
        }
      }
      if (d <= 0) return null
      return { label: 'Est. back', value: d.toFixed(2) }
    }
  } catch {
    return null
  }
})

const selectedPct = computed(() => {
  if (!selectedOption.value) return 0
  return optionPercentages.value[selectedOption.value.id] || 0
})

const timeLeft = computed(() => {
  if (!liveMarket.value.closes_at) return null
  const diff = new Date(liveMarket.value.closes_at) - Date.now()
  if (diff <= 0) return 'Ended'
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  if (hours >= 24) return `Ends in ${Math.floor(hours / 24)}d`
  if (hours > 0) return `Ends in ${hours}h ${minutes}m`
  return `Ends in ${minutes}m`
})

const countdownHovered = ref(false)

const timeLeftDetailed = computed(() => {
  if (!liveMarket.value.closes_at) return null
  const d = new Date(liveMarket.value.closes_at)
  if (d <= Date.now()) return 'Ended'
  const pad = n => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return `${time} · ${date}`
})

const isEnded = computed(() => {
  if (!liveMarket.value.closes_at) return false
  return new Date(liveMarket.value.closes_at) <= new Date()
})

const positionStats = computed(() => {
  if (!selectedOption.value || !isCpmm.value) return null
  const optId = selectedOption.value.id
  const shares = getPositionShares(optId)
  if (shares <= 0) return null
  const avgCost = getPositionAvgCost(optId)
  const sellPerShare = sellPriceForShares(optId, 1)
  const totalCost = avgCost * shares
  const totalValue = sellPriceForShares(optId, shares)
  const pnl = totalValue - totalCost
  const pct = totalCost > 0 ? Math.abs((pnl / totalCost) * 100).toFixed(1) : null
  const isUp = pnl >= 0
  return { shares, avgCost, sellPerShare, totalCost, totalValue, pnl, pct, isUp }
})

async function submitBet() {
  if (!selectedOption.value || !amount.value || onCooldown.value) return
  placing.value = true
  error.value = null

  const balanceEl = document.getElementById('balance-display')
  if (balanceEl && tradeBtnRef.value) {
    if (side.value === 'sell') {
      animateGrist(tradeBtnRef.value, balanceEl, Math.min(amount.value, 8))
    } else {
      animateGrist(balanceEl, tradeBtnRef.value, Math.min(amount.value, 8))
    }
  }

  try {
    if (isCpmm.value) {
      await trade(props.market.id, selectedOption.value.id, side.value, parseFloat(amount.value))
    } else {
      // Parimutuel fallback
      if (side.value === 'buy') {
        await placeBet(props.market.id, selectedOption.value.id, parseFloat(amount.value))
      } else {
        const others = liveMarket.value.options.filter(o => o.id !== selectedOption.value.id)
        const perOption = parseFloat(amount.value) / others.length
        for (const opt of others) {
          await placeBet(props.market.id, opt.id, perOption)
        }
      }
    }
    emit('placed')
  } catch (err) {
    error.value = err.message
  }
  placing.value = false
  onCooldown.value = true

  setTimeout(() => {
    onCooldown.value = false
  }, 1000)
}

const { particles, animateGrist } = useGristAnimation()
const tradeBtnRef = ref(null)
const onCooldown = ref(false)

const presets = [5, 10, 25, 50, 100]
const pctPresets = [0.25, 0.5, 0.75, 1.0]
const activePanel = ref('trade') // 'trade' or 'mod'

// Mod resolve
const resolveOption = ref(null)
const resolving = ref(false)
const resolveError = ref(null)
const resolveSuccess = ref(false)
const resolveExpanded = ref(false)
const resolveConfirmText = ref('')

watch(resolveOption, () => { resolveConfirmText.value = '' })

const resolveConfirmValid = computed(() => {
  if (!resolveOption.value) return false
  return resolveConfirmText.value.trim() === `I will resolve this market as: ${resolveOption.value.label}`
})

async function submitResolve() {
  if (!resolveOption.value || !resolveConfirmValid.value) return
  resolving.value = true
  resolveError.value = null
  try {
    await resolveMarket(liveMarket.value.id, resolveOption.value.id)
    resolveSuccess.value = true
    setTimeout(() => emit('close'), 1500)
  } catch (err) {
    resolveError.value = err.message
  }
  resolving.value = false
}

// Mod add option
const addOptionExpanded = ref(false)
const newOptionLabel = ref('')
const addingOption = ref(false)
const addOptionError = ref(null)
const addOptionSuccess = ref(false)

// Mod hide/unhide market
const hidingMarket = ref(false)
const hideError = ref(null)

async function submitToggleHidden() {
  hidingMarket.value = true
  hideError.value = null
  try {
    await toggleHidden(liveMarket.value.id, !liveMarket.value.hidden)
    liveMarket.value = { ...liveMarket.value, hidden: !liveMarket.value.hidden }
  } catch (err) {
    hideError.value = err.message
  }
  hidingMarket.value = false
}

// Mod edit end time
const editTimeExpanded = ref(false)
const newClosesAt = ref('')
const updatingTime = ref(false)
const updateTimeError = ref(null)
const updateTimeSuccess = ref(false)

watch(editTimeExpanded, (val) => {
  if (val) {
    if (liveMarket.value.closes_at) {
      const d = new Date(liveMarket.value.closes_at)
      const pad = n => String(n).padStart(2, '0')
      newClosesAt.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    } else {
      newClosesAt.value = ''
    }
  }
})

async function submitEditTime() {
  updatingTime.value = true
  updateTimeError.value = null
  updateTimeSuccess.value = false
  try {
    const closesAt = newClosesAt.value ? new Date(newClosesAt.value).toISOString() : null
    await updateClosesAt(liveMarket.value.id, closesAt)
    liveMarket.value = { ...liveMarket.value, closes_at: closesAt }
    updateTimeSuccess.value = true
    setTimeout(() => { updateTimeSuccess.value = false; editTimeExpanded.value = false }, 1500)
  } catch (err) {
    updateTimeError.value = err.message
  }
  updatingTime.value = false
}

async function submitAddOption() {
  if (!newOptionLabel.value.trim() || addingOption.value) return
  addingOption.value = true
  addOptionError.value = null
  addOptionSuccess.value = false
  try {
    await addOption(liveMarket.value.id, newOptionLabel.value.trim())
    newOptionLabel.value = ''
    addOptionSuccess.value = true
    await refresh()
    setTimeout(() => { addOptionSuccess.value = false }, 2000)
  } catch (err) {
    addOptionError.value = err.message
  }
  addingOption.value = false
}
</script>

<template>
  <GristParticles :particles="particles" />
  <div class="modal-container">
    <!-- Header -->
      <div class="modal-header">
        <button class="modal-back" @click="emit('close')">← Back</button>
        <span class="live-badge"><span class="live-dot"></span> LIVE</span>
      </div>

      <div class="modal-title-row">
        <img v-if="liveMarket.icon_url" :src="liveMarket.icon_url" class="modal-market-icon" />
        <div class="modal-title-text">
          <h2 class="modal-title">{{ liveMarket.title }} <span class="modal-market-id">#{{ liveMarket.id }}</span></h2>
          <div v-if="timeLeft" class="modal-countdown" @mouseenter="countdownHovered = true" @mouseleave="countdownHovered = false">⏱ {{ countdownHovered ? timeLeftDetailed : timeLeft }}</div>
        </div>
      </div>

      <div class="modal-body">
        <!-- Left side: Graph + options -->
        <div class="modal-left">

          <!-- API-Sports game widget -->
          <template v-if="liveMarket.fixture_id && widgetReady">
            <api-sports-widget
              data-type="config"
              data-key="proxied"
              :data-sport="liveMarket.sport || 'football'"
              data-theme="GuildMarket"
              data-show-logos="true"
              :data-url-football="origin + '/api/sports-proxy/football/'"
              :data-url-baseball="origin + '/api/sports-proxy/baseball/'"
              :data-url-basketball="origin + '/api/sports-proxy/basketball/'"
              :data-url-hockey="origin + '/api/sports-proxy/hockey/'"
              :data-url-rugby="origin + '/api/sports-proxy/rugby/'"
              :data-url-handball="origin + '/api/sports-proxy/handball/'"
              :data-url-volleyball="origin + '/api/sports-proxy/volleyball/'"
              :data-url-afl="origin + '/api/sports-proxy/afl/'"
              :data-url-nfl="origin + '/api/sports-proxy/nfl/'"
              :data-url-nba="origin + '/api/sports-proxy/nba/'"
              :data-logo-url="origin + '/api/sports-media'"
            ></api-sports-widget>
            <div class="fixture-widget-wrap" :class="{ expanded: widgetExpanded }">
              <api-sports-widget
                ref="gameWidgetRef"
                data-type="game"
                :data-game-id="String(liveMarket.fixture_id)"
                data-refresh="30"
                data-game-tab="events"
              ></api-sports-widget>
            </div>
            <button v-if="widgetHasTabs" class="widget-toggle" @click="widgetExpanded = !widgetExpanded">
              {{ widgetExpanded ? '▲ Hide details' : '▼ Stats / Lineups / Players' }}
            </button>
          </template>

          <div class="modal-graph">
            <MarketGraph :market="liveMarket" :colors="colors" defaultRange="live" />
          </div>

          <div v-if="liveMarket.description" class="modal-description" v-html="marked.parse(liveMarket.description)" />

          <!-- Chances breakdown -->
          <div class="chances-grid">
            <div
              v-for="(opt, i) in liveMarket.options"
              :key="opt.id"
              class="chance-item"
              :class="{ selected: selectedOption?.id === opt.id }"
              @click="selectOption(opt)"
            >
              <div class="chance-color" :style="{ background: colors[i % colors.length] }"></div>
              <div class="chance-info">
                <span class="chance-label">{{ opt.label }}</span>
                <span class="chance-pool" v-if="isCpmm">
                  {{ getPositionShares(opt.id).toFixed(1) }} shares held
                  <template v-if="getPositionShares(opt.id) > 0 && getPositionAvgCost(opt.id) > 0">
                    <span
                      class="chance-pnl-hint"
                      :class="sellPriceForShares(opt.id, 1) >= getPositionAvgCost(opt.id) ? 'pnl-up' : 'pnl-down'"
                    >
                      {{ sellPriceForShares(opt.id, 1) >= getPositionAvgCost(opt.id) ? '▲' : '▼' }}{{ Math.abs(((sellPriceForShares(opt.id, 1) - getPositionAvgCost(opt.id)) / getPositionAvgCost(opt.id)) * 100).toFixed(1) }}%
                    </span>
                  </template>
                </span>
                <span class="chance-pool" v-else>{{ (() => {
                  const p = liveMarket.pool?.find(x => x.option_id === opt.id)
                  return p ? parseFloat(p.total).toFixed(0) : '0'
                })() }} <GristIcon /> bet</span>
              </div>
              <div class="chance-pct" :style="{ color: colors[i % colors.length] }">
                {{ optionPercentages[opt.id] || 0 }}%
              </div>
            </div>
          </div>

        </div>

        <!-- Right side: Trade / Mod tab -->
        <div class="modal-right">
          <!-- Tab bar (mod only) -->
          <div v-if="isMod" class="panel-tabs">
            <button class="panel-tab" :class="{ active: activePanel === 'trade' }" @click="activePanel = 'trade'">Trade</button>
            <button class="panel-tab" :class="{ active: activePanel === 'mod' }" @click="activePanel = 'mod'">Mod</button>
          </div>

          <div v-if="!isMod || activePanel === 'trade'" class="trade-panel">
            <div v-if="isEnded" class="trade-placeholder trade-closed">
              Trading closed
            </div>

            <div v-else-if="!selectedOption" class="trade-placeholder">
              Select an option to trade
            </div>

            <template v-else>
              <div class="trade-option-name">
                {{ selectedOption.label }}
                <span class="trade-option-pct">{{ selectedPct }}%</span>
              </div>

              <!-- Buy / Sell toggle -->
              <div class="side-toggle">
                <button
                  class="side-btn"
                  :class="{ active: side === 'buy', yes: side === 'buy' }"
                  @click="side = 'buy'; amount = 10"
                >Buy</button>
                <button
                  v-if="isCpmm"
                  class="side-btn"
                  :class="{ active: side === 'sell', no: side === 'sell', disabled: getPositionShares(selectedOption.id) <= 0 }"
                  :disabled="getPositionShares(selectedOption.id) <= 0"
                  @click="side = 'sell'; amount = floorShares(getPositionShares(selectedOption.id))"
                >Sell ({{ getPositionShares(selectedOption.id).toFixed(1) }})</button>
                <button
                  v-else
                  class="side-btn"
                  :class="{ active: side === 'sell', no: side === 'sell' }"
                  @click="side = 'sell'; amount = 10"
                >Bet Against</button>
              </div>

              <!-- Position P&L (shown when user holds shares) -->
              <div v-if="positionStats" class="position-pnl">
                <div class="pnl-header">
                  <span class="pnl-title">Your Position</span>
                  <span class="pnl-share-count">{{ positionStats.shares.toFixed(1) }} shares</span>
                </div>
                <div class="pnl-grid">
                  <div class="pnl-col">
                    <div class="pnl-label">Avg. Paid</div>
                    <div class="pnl-main-val">{{ positionStats.avgCost.toFixed(3) }}</div>
                    <div class="pnl-sub-val">Total: {{ positionStats.totalCost.toFixed(2) }}</div>
                  </div>
                  <div class="pnl-divider">→</div>
                  <div class="pnl-col pnl-col--right">
                    <div class="pnl-label">Sell Value</div>
                    <div class="pnl-main-val">{{ positionStats.sellPerShare.toFixed(3) }}</div>
                    <div class="pnl-sub-val">Total: {{ positionStats.totalValue.toFixed(2) }}</div>
                  </div>
                </div>
                <div class="pnl-footer" :class="positionStats.isUp ? 'pnl-up' : 'pnl-down'">
                  <span>{{ positionStats.isUp ? 'Profit' : 'Loss' }}</span>
                  <span>{{ positionStats.isUp ? '+' : '-' }}{{ positionStats.pct ?? '—' }}%</span>
                </div>
              </div>

              <!-- Amount -->
              <div class="amount-section">
                <label class="amount-label">{{ side === 'sell' && isCpmm ? 'Shares to sell' : 'Amount' }}</label>
                <div class="amount-input-wrap">
                  <input
                    type="number"
                    v-model.number="amount"
                    min="1"
                    class="amount-input"
                  />
                  <span class="amount-suffix"><template v-if="side === 'sell' && isCpmm">shares</template><GristIcon v-else /></span>
                </div>
                <div class="amount-presets" v-if="side === 'buy'">
                  <button
                    v-for="p in presets"
                    :key="p"
                    class="preset-btn"
                    :class="{ active: amount === p }"
                    @click="amount = p"
                  >{{ p }}</button>
                </div>
                <div class="amount-presets" v-if="side === 'buy' && balance">
                  <button
                    v-for="pct in pctPresets"
                    :key="pct"
                    class="preset-btn"
                    @click="amount = Math.max(1, Math.floor(balance * pct))"
                  >{{ pct * 100 }}%</button>
                </div>
                <div class="amount-presets" v-if="side === 'sell' && isCpmm">
                  <button
                    class="preset-btn"
                    :class="{ active: amount === floorShares(getPositionShares(selectedOption.id) / 4) }"
                    @click="amount = floorShares(getPositionShares(selectedOption.id) / 4)"
                  >1/4</button>
                  <button
                    class="preset-btn"
                    :class="{ active: amount === floorShares(getPositionShares(selectedOption.id) / 2) }"
                    @click="amount = floorShares(getPositionShares(selectedOption.id) / 2)"
                  >1/2</button>
                  <button
                    class="preset-btn"
                    :class="{ active: amount === floorShares(getPositionShares(selectedOption.id)) }"
                    @click="amount = floorShares(getPositionShares(selectedOption.id))"
                  >All</button>
                </div>
              </div>

              <!-- Estimate / Payout info -->
              <div class="payout-info">
                <template v-if="isCpmm && side === 'buy'">
                  <div class="payout-row">
                    <span>Odds</span>
                    <span class="payout-value">{{ selectedPct }}%</span>
                  </div>
                  <div class="payout-row" v-if="estimate">
                    <span>Payout if correct</span>
                    <span class="payout-value">{{ estimate.value }} <GristIcon /></span>
                  </div>
                </template>
                <template v-if="isCpmm && side === 'sell'">
                  <div class="payout-row" v-if="estimate">
                    <span>Est. Grist</span>
                    <span class="payout-value">{{ estimate.value }} <GristIcon /></span>
                  </div>
                  <div class="payout-row" v-if="positionStats">
                    <span>Grist invested</span>
                    <span class="payout-value">{{ (amount * positionStats.avgCost).toFixed(2) }} <GristIcon /></span>
                  </div>
                  <div class="payout-row" v-if="estimate && positionStats">
                    <span>Difference</span>
                    <span class="payout-value" :class="parseFloat(estimate.value) >= amount * positionStats.avgCost ? 'pnl-up' : 'pnl-down'">
                      {{ parseFloat(estimate.value) - amount * positionStats.avgCost >= 0 ? '+' : '' }}{{ (parseFloat(estimate.value) - amount * positionStats.avgCost).toFixed(2) }} <GristIcon />
                    </span>
                  </div>
                </template>
                <template v-if="!isCpmm">
                  <div class="payout-row">
                    <span>Current odds</span>
                    <span class="payout-value">{{ selectedPct }}%</span>
                  </div>
                </template>
              </div>

              <!-- Submit -->
              <button
                ref="tradeBtnRef"
                class="btn trade-btn"
                :class="{ yes: side === 'buy', no: side === 'sell', cooldown: onCooldown }"
                :disabled="placing || !amount || onCooldown"
                @click="submitBet"
              >
                <template v-if="placing">Placing...</template>
                <template v-else-if="onCooldown">Wait...</template>
                <template v-else-if="side === 'buy'">Buy — {{ amount }} <GristIcon /></template>
                <template v-else>Sell — {{ amount }} shares</template>
              </button>

              <div v-if="error" class="trade-error">{{ error }}</div>
            </template>
          </div>

          <!-- Mod panels -->
          <template v-if="isMod && activePanel === 'mod'">
          <!-- Mod add option panel -->
          <div v-if="liveMarket.status === 'open'" class="add-option-panel">
            <button class="add-option-toggle" @click="addOptionExpanded = !addOptionExpanded">
              + Add Option
              <span class="resolve-chevron">{{ addOptionExpanded ? '▲' : '▼' }}</span>
            </button>
            <div v-if="addOptionExpanded" class="add-option-body">
              <input
                v-model="newOptionLabel"
                class="add-option-input"
                type="text"
                placeholder="New option label…"
                autocomplete="off"
                @keyup.enter="submitAddOption"
              />
              <button
                class="btn add-option-btn"
                :disabled="!newOptionLabel.trim() || addingOption"
                @click="submitAddOption"
              >{{ addingOption ? 'Adding...' : 'Add' }}</button>
              <div v-if="addOptionSuccess" class="add-option-success">Option added!</div>
              <div v-if="addOptionError" class="trade-error">{{ addOptionError }}</div>
            </div>
          </div>

          <!-- Mod hide/unhide panel -->
          <div v-if="liveMarket.status === 'open'" class="hide-panel">
            <button
              class="hide-toggle-btn"
              :class="{ 'hide-btn--hidden': liveMarket.hidden }"
              :disabled="hidingMarket"
              @click="submitToggleHidden"
            >{{ hidingMarket ? '...' : (liveMarket.hidden ? '⬛ Unhide Market' : '⬛ Hide Market') }}</button>
            <div v-if="hideError" class="trade-error">{{ hideError }}</div>
          </div>

          <!-- Mod edit end time panel -->
          <div v-if="liveMarket.status === 'open'" class="edit-time-panel">
            <button class="edit-time-toggle" @click="editTimeExpanded = !editTimeExpanded">
              ⏱ Edit End Time
              <span class="resolve-chevron">{{ editTimeExpanded ? '▲' : '▼' }}</span>
            </button>
            <div v-if="editTimeExpanded" class="edit-time-body">
              <input
                v-model="newClosesAt"
                type="datetime-local"
                class="edit-time-input"
              />
              <div v-if="updateTimeSuccess" class="add-option-success">Updated!</div>
              <template v-else>
                <button class="btn edit-time-btn" :disabled="updatingTime" @click="submitEditTime">
                  {{ updatingTime ? 'Saving...' : 'Save' }}
                </button>
                <div v-if="updateTimeError" class="trade-error">{{ updateTimeError }}</div>
              </template>
            </div>
          </div>

          <!-- Mod resolve panel — collapsed by default -->
          <div v-if="liveMarket.status === 'open'" class="resolve-panel">
            <button class="resolve-toggle" @click="resolveExpanded = !resolveExpanded">
              ⚠ Resolve Market
              <span class="resolve-chevron">{{ resolveExpanded ? '▲' : '▼' }}</span>
            </button>
            <div v-if="resolveExpanded" class="resolve-body">
              <div class="resolve-options">
                <button
                  v-for="opt in liveMarket.options"
                  :key="opt.id"
                  class="resolve-opt-btn"
                  :class="{ selected: resolveOption?.id === opt.id }"
                  @click="resolveOption = opt"
                >{{ opt.label }}</button>
              </div>
              <div v-if="resolveSuccess" class="resolve-success">Resolved!</div>
              <template v-else>
                <div v-if="resolveOption" class="resolve-confirm-wrap">
                  <label class="resolve-confirm-label">
                    Type to confirm:
                    <span class="resolve-confirm-hint">I will resolve this market as: {{ resolveOption.label }}</span>
                  </label>
                  <input
                    v-model="resolveConfirmText"
                    class="resolve-confirm-input"
                    type="text"
                    placeholder="Type the phrase above…"
                    autocomplete="off"
                    spellcheck="false"
                  />
                </div>
                <button
                  class="btn resolve-btn"
                  :disabled="!resolveConfirmValid || resolving"
                  @click="submitResolve"
                >{{ resolving ? 'Resolving...' : 'Resolve' }}</button>
                <div v-if="resolveError" class="trade-error">{{ resolveError }}</div>
              </template>
            </div>
          </div>
          </template>
        </div>
      </div>
    </div>
</template>

<style scoped>
.modal-container {
  padding: 24px 28px;
  box-sizing: border-box;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.modal-back {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.85rem;
  font-family: inherit;
  padding: 4px 0;
}
.modal-back:hover { color: var(--text); }

.live-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--accent);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.5px;
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

.modal-title-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}

.modal-market-icon {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  margin-top: 2px;
}

.modal-title-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-title {
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
}

.modal-market-id {
  color: var(--muted);
  font-weight: 400;
  font-size: 0.85em;
}

.modal-countdown {
  font-size: 0.78rem;
  color: #f59e0b;
  cursor: pointer;
}

.modal-body {
  display: flex;
  gap: 0;
  flex-wrap: wrap;
}

.modal-left {
  flex: 1;
  min-width: 280px;
  padding-right: 24px;
}

.modal-graph {
  margin-bottom: 16px;
}

.modal-description {
  font-size: 0.82rem;
  line-height: 1.5;
  margin: 0 0 16px;
}
.modal-description :deep(p) { margin: 0 0 8px; }
.modal-description :deep(p:last-child) { margin-bottom: 0; }
.modal-description :deep(strong) { color: var(--text); font-weight: 600; }
.modal-description :deep(em) { font-style: italic; }
.modal-description :deep(a) { color: var(--accent); text-decoration: underline; }
.modal-description :deep(ul), .modal-description :deep(ol) { padding-left: 1.2em; margin: 4px 0 8px; }
.modal-description :deep(li) { margin-bottom: 2px; }
.modal-description :deep(code) { font-family: monospace; background: rgba(255,255,255,0.07); padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
.modal-description :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 8px 0; }

.fixture-widget-wrap {
  max-height: 145px;
  overflow: hidden;
  transition: max-height 0.3s ease;
  margin-bottom: 20px;
}
.fixture-widget-wrap.expanded {
  max-height: 800px;
}

.widget-toggle {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.72rem;
  font-family: inherit;
  padding: 4px 0 8px;
  cursor: pointer;
  text-align: center;
  margin-bottom: 12px;
}
.widget-toggle:hover { color: var(--accent); }

.modal-right {
  width: 340px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  padding-left: 24px;
}

/* Chances grid */
.chances-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chance-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.chance-item:hover,
.chance-item.selected {
  border-color: var(--accent);
}

.chance-color {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.chance-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chance-label {
  font-size: 0.85rem;
  font-weight: 600;
}

.chance-pool {
  font-size: 0.7rem;
  color: var(--muted);
}

.chance-pnl-hint {
  margin-left: 4px;
  font-weight: 700;
}

.chance-pct {
  font-size: 1.1rem;
  font-weight: 700;
}

/* Trade panel */
.trade-panel {
  padding: 0;
}

.trade-placeholder {
  color: var(--muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 20px 0;
}

.trade-closed {
  color: #f59e0b;
}

.trade-option-name {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.trade-option-pct {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--accent);
}

/* Side toggle */
.side-toggle {
  display: flex;
  gap: 0;
  margin-bottom: 20px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.side-btn {
  flex: 1;
  padding: 10px;
  border-radius: 0;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  background: transparent;
  border: none;
  border-right: 1px solid var(--border);
  color: var(--muted);
  transition: all 0.15s;
}
.side-btn:last-child {
  border-right: none;
}
.side-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.side-btn.active.yes {
  background: rgba(72, 187, 120, 0.15);
  color: #48bb78;
}
.side-btn.active.no {
  background: rgba(233, 69, 96, 0.15);
  color: #e94560;
}

/* Amount */
.amount-section { margin-bottom: 14px; }

.amount-label {
  display: block;
  font-size: 0.7rem;
  color: var(--muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.amount-input-wrap {
  display: flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}

.amount-input {
  flex: 1;
  padding: 10px 12px;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 1rem;
  font-family: inherit;
  outline: none;
  -moz-appearance: textfield;
}
.amount-input::-webkit-inner-spin-button,
.amount-input::-webkit-outer-spin-button { -webkit-appearance: none; }

.amount-suffix {
  padding: 0 10px;
  font-size: 0.75rem;
  color: var(--muted);
}

.amount-presets {
  display: flex;
  gap: 4px;
}

.preset-btn {
  flex: 1;
  padding: 4px;
  border-radius: 4px;
  font-size: 0.7rem;
  cursor: pointer;
  font-family: inherit;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
}
.preset-btn:hover,
.preset-btn.active {
  border-color: var(--accent);
  color: var(--text);
}

/* Position P&L */
.position-pnl {
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.pnl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.pnl-title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
}

.pnl-share-count {
  font-size: 0.65rem;
  color: var(--muted);
}

.pnl-grid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.pnl-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pnl-col--right {
  text-align: right;
}

.pnl-label {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--muted);
}

.pnl-main-val {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}

.pnl-sub-val {
  font-size: 0.65rem;
  color: var(--muted);
}

.pnl-divider {
  font-size: 0.75rem;
  color: var(--muted);
  padding: 0 6px;
}

.pnl-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 0.75rem;
  font-weight: 700;
}

.pnl-up { color: #48bb78; }
.pnl-down { color: #e94560; }

/* Payout */
.payout-info {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 10px 12px;
  margin-bottom: 14px;
}

.payout-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--muted);
  padding: 4px 0;
}

.payout-value {
  color: var(--text);
  font-weight: 600;
}

/* Mod resolve panel */
.resolve-panel {
  border: 1px solid rgba(233, 69, 96, 0.3);
  margin-top: 10px;
}

.resolve-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(233, 69, 96, 0.07);
  border: none;
  color: #e94560;
  font-size: 0.7rem;
  font-family: inherit;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.resolve-toggle:hover {
  background: rgba(233, 69, 96, 0.13);
}

.resolve-chevron {
  font-size: 0.6rem;
}

.resolve-body {
  padding: 10px 12px 12px;
  background: rgba(233, 69, 96, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.resolve-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.resolve-opt-btn {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, color 0.15s;
}
.resolve-opt-btn:hover {
  border-color: #e94560;
  color: var(--text);
}
.resolve-opt-btn.selected {
  border-color: #e94560;
  color: #e94560;
  background: rgba(233, 69, 96, 0.1);
}

.resolve-confirm-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.resolve-confirm-label {
  font-size: 0.65rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.resolve-confirm-hint {
  color: #e94560;
  font-style: italic;
  font-size: 0.7rem;
  text-transform: none;
  letter-spacing: 0;
  word-break: break-word;
}

.resolve-confirm-input {
  padding: 7px 9px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.8rem;
  font-family: inherit;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.resolve-confirm-input:focus {
  border-color: #e94560;
}

.resolve-btn {
  font-size: 0.8rem;
  background: #e94560;
}
.resolve-btn:hover:not(:disabled) {
  background: #ff5b78;
}
.resolve-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.resolve-success {
  text-align: center;
  color: #48bb78;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 6px 0;
}

/* Trade button */
.trade-btn {
  font-size: 0.95rem;
  padding: 12px;
  letter-spacing: 0.3px;
}
.trade-btn.yes {
  background: #48bb78;
}
.trade-btn.yes:hover {
  background: #38a169;
}
.trade-btn.no {
  background: #e94560;
}
.trade-btn.no:hover {
  background: #ff5b78;
}
.trade-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.trade-btn.cooldown {
  opacity: 0.6;
  cursor: wait;
}

.trade-error {
  color: #e94560;
  font-size: 0.75rem;
  margin-top: 8px;
  text-align: center;
}

/* Mod add option panel */
.add-option-panel {
  border: 1px solid rgba(28, 179, 242, 0.3);
  margin-top: 10px;
}

.add-option-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(28, 179, 242, 0.07);
  border: none;
  color: var(--accent);
  font-size: 0.7rem;
  font-family: inherit;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.add-option-toggle:hover {
  background: rgba(28, 179, 242, 0.13);
}

.add-option-body {
  padding: 10px 12px 12px;
  background: rgba(28, 179, 242, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-option-input {
  padding: 7px 9px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.8rem;
  font-family: inherit;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.add-option-input:focus {
  border-color: var(--accent);
}

.add-option-btn {
  font-size: 0.8rem;
  background: var(--accent);
}
.add-option-btn:hover:not(:disabled) {
  opacity: 0.85;
}
.add-option-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.add-option-success {
  text-align: center;
  color: #48bb78;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 4px 0;
}

/* Hide/unhide panel */
.hide-panel {
  margin-top: 10px;
}

.hide-toggle-btn {
  width: 100%;
  padding: 8px 12px;
  background: rgba(28, 179, 242, 0.07);
  border: 1px solid rgba(28, 179, 242, 0.3);
  color: var(--accent);
  font-size: 0.7rem;
  font-family: inherit;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.hide-toggle-btn:hover:not(:disabled) {
  background: rgba(28, 179, 242, 0.13);
}
.hide-toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hide-btn--hidden {
  background: rgba(233, 69, 96, 0.07);
  border-color: rgba(233, 69, 96, 0.3);
  color: #e94560;
}
.hide-btn--hidden:hover:not(:disabled) {
  background: rgba(233, 69, 96, 0.13);
}

/* Edit end time panel */
.edit-time-panel {
  border: 1px solid rgba(28, 179, 242, 0.3);
  margin-top: 10px;
}

.edit-time-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(28, 179, 242, 0.07);
  border: none;
  color: var(--accent);
  font-size: 0.7rem;
  font-family: inherit;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.edit-time-toggle:hover {
  background: rgba(28, 179, 242, 0.13);
}

.edit-time-body {
  padding: 10px 12px 12px;
  background: rgba(28, 179, 242, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-time-input {
  padding: 7px 9px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.8rem;
  font-family: inherit;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  color-scheme: dark;
}
.edit-time-input:focus {
  border-color: var(--accent);
}

.edit-time-btn {
  font-size: 0.8rem;
  background: var(--accent);
}
.edit-time-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Panel tabs (Trade / Mod) */
.panel-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.panel-tab {
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--muted);
  font-size: 0.8rem;
  font-family: inherit;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.panel-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.panel-tab:hover:not(.active) {
  color: var(--text);
}

/* Responsive */
@media (max-width: 640px) {
  .modal-body {
    flex-direction: column;
  }
  .modal-left {
    min-width: 0;
    padding-right: 0;
    padding-bottom: 20px;
  }
  .modal-right {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border);
    padding-left: 0;
    padding-top: 20px;
  }
  .modal-container {
    padding: 16px;
  }
}

</style>

<style>
api-sports-widget[data-theme="GuildMarket"] {
  --primary-color: #1cb3f2;
  --success-color: #48bb78;
  --warning-color: #f59e0b;
  --danger-color: #e94560;
  --light-color: #999;

  --home-color: #1cb3f2;
  --away-color: #a78bfa;

  --text-color: #eee;
  --text-color-info: #999;

  --background-color: #0a0c0f;

  --primary-font-size: 0.72rem;
  --secondary-font-size: 0.75rem;
  --button-font-size: 0.78rem;
  --title-font-size: 0.82rem;

  --header-text-transform: uppercase;
  --button-text-transform: uppercase;
  --title-text-transform: uppercase;

  --border: 1px solid #2a2a4a;
  --game-height: 2.3rem;
  --league-height: 2.35rem;

  --score-size: 2rem;
  --flag-size: 18px;
  --teams-logo-size: 18px;
  --teams-logo-size-xl: 4rem;
  --hover: rgba(28, 179, 242, 0.08);
}
</style>
