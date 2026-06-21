<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAuth } from './composables/useAuth'
import { useApi } from './composables/useApi'
import { useDragScroll } from './composables/useDragScroll'
import MarketsTab from './components/MarketsTab.vue'
import PortfolioTab from './components/PortfolioTab.vue'
import LeaderboardTab from './components/LeaderboardTab.vue'
import HistoryTab from './components/HistoryTab.vue'
import CreditsTab from './components/CreditsTab.vue'
import BetModal from './components/BetModal.vue'
import GristInfoModal from './components/GristInfoModal.vue'
import PayoutPopup from './components/PayoutPopup.vue'
import MarketGraph from './components/MarketGraph.vue'
import ModTab from './components/ModTab.vue'
import TagBar from './components/TagBar.vue'

const { ready, error, user } = useAuth()
const { getMe, getMarkets, getRecentPayouts, acknowledgePayouts } = useApi()

const activeTab = ref('markets')
const balance = ref(null)
const marketEnabled = ref(true)
const isMod = ref(false)
const betMarket = ref(null)
const showGristInfo = ref(false)
const recentPayouts = ref(null)
const featuredTags = ref([])
const activeTag = ref(null)
const navEl = ref(null)
let isInitialLoad = true
useDragScroll(navEl)

// Balance animation
const displayBalance = ref(null)
const balanceAnimClass = ref('')
let balanceAnimTimer = null

watch(balance, (newVal, oldVal) => {
  if (newVal === null) { displayBalance.value = null; return }
  if (oldVal === null) { displayBalance.value = newVal; return }
  const delta = newVal - oldVal
  if (Math.abs(delta) < 0.01) { displayBalance.value = newVal; return }
  clearTimeout(balanceAnimTimer)
  if (delta > 0) {
    // Count up one by one
    const steps = Math.min(Math.ceil(delta), 30)
    const step = delta / steps
    let i = 0
    let current = parseFloat(oldVal)
    balanceAnimClass.value = 'balance-up'
    const tick = () => {
      i++
      current = Math.min(current + step, newVal)
      displayBalance.value = Math.round(current * 100) / 100
      if (i < steps) {
        balanceAnimTimer = setTimeout(tick, 60)
      } else {
        displayBalance.value = newVal
        setTimeout(() => { balanceAnimClass.value = '' }, 400)
      }
    }
    tick()
  } else {
    displayBalance.value = newVal
    balanceAnimClass.value = 'balance-down'
    balanceAnimTimer = setTimeout(() => { balanceAnimClass.value = '' }, 900)
  }
})

// Small viewport: show a featured market graph
const viewportWidth = ref(window.innerWidth)
const viewportHeight = ref(window.innerHeight)
const isSmallViewport = computed(() => viewportWidth.value < 400 && viewportHeight.value < 400)
const miniMarket = ref(null)

function onResize() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}

const tabs = computed(() => [
  { key: 'markets', label: 'Markets' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'history', label: 'History' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'credits', label: 'Credits' },
  ...(isMod.value ? [{ key: 'mod', label: 'Mod' }] : []),
])

const colors = ['#1cb3f2', '#48bb78', '#f59e0b', '#a78bfa', '#ec4899']

async function loadBalance() {
  try {
    const data = await getMe()
    balance.value = data.balance
    isMod.value = data.isMod ?? false
    marketEnabled.value = data.marketEnabled ?? true
    featuredTags.value = data.featuredTags ?? []
    if (!isInitialLoad) {
      acknowledgePayouts().catch(() => {})
    }
    isInitialLoad = false
  } catch {
    balance.value = null
  }
}

async function checkPayouts() {
  try {
    const payouts = await getRecentPayouts()
    if (payouts.length > 0) {
      recentPayouts.value = payouts
    }
  } catch {}
}

async function loadMiniMarket() {
  try {
    const markets = await getMarkets()
    if (markets.length) {
      // Pick the visible market with most grist in pool
      const visible = markets.filter(m => !m.hidden)
      const pool = visible.length ? visible : markets
      miniMarket.value = pool.reduce((best, m) => (m.total_grist ?? 0) > (best.total_grist ?? 0) ? m : best, pool[0])
    }
  } catch {}
}

function openBet(market) {
  betMarket.value = market
}

function closeBet() {
  betMarket.value = null
}

function onBetPlaced() {
  // betMarket.value = null
  loadBalance()
}

function onMarketCreated() {
  activeTab.value = 'markets'
}

watch(ready, (isReady) => {
  if (isReady && !error.value) {
    loadBalance()
    loadMiniMarket()
    checkPayouts()
  }
})

let balancePoll = null
onMounted(() => {
  window.addEventListener('resize', onResize)
  balancePoll = setInterval(loadBalance, 60000)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  clearInterval(balancePoll)
})
</script>

<template>
  <div id="app">
    <!-- Error state -->
    <div v-if="error" class="error-screen">
      <h2>Not Available</h2>
      <p>{{ error }}</p>
    </div>

    <!-- Main app -->
    <template v-else-if="ready">
      <!-- Small viewport: just show the featured graph -->
      <div v-if="isSmallViewport" class="mini-view">
        <div class="mini-header">
          <h1 class="mini-title">Kalgrist</h1>
        </div>
        <div v-if="miniMarket" class="mini-market">
          <div class="mini-market-title">{{ miniMarket.title }}</div>
          <MarketGraph :market="miniMarket" :colors="colors" :compact="true" defaultRange="live" />
          <div class="mini-options">
            <span
              v-for="(opt, i) in miniMarket.options"
              :key="opt.id"
              class="mini-opt"
              :style="{ color: colors[i % colors.length] }"
            >{{ opt.label }}</span>
          </div>
        </div>
        <div v-else class="empty-state">No markets</div>
      </div>

      <!-- Normal view -->
      <template v-else>
        <header>
          <div class="header-top">
            <h1><img src="./assets/grist.png" alt="" class="title-grist-icon" />Kalgrist</h1>
            <div class="header-right">
              <div id="balance-display" class="pixel-corners" :class="balanceAnimClass" @click="showGristInfo = true" style="cursor: pointer;">
                {{ displayBalance != null ? displayBalance : (balance != null ? balance : 'loading...') }}
                <img src="./assets/grist.png" alt="" class="grist-icon" />
              </div>
            </div>
          </div>
          <nav ref="navEl" class="header-nav">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="tab"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key; betMarket = null; activeTag = null"
            >{{ tab.label }}</button>
          </nav>
        </header>

        <TagBar
          v-if="activeTab === 'markets' && featuredTags.length"
          :featuredTags="featuredTags"
          :activeTag="activeTag"
          @change="activeTag = $event; betMarket = null"
        />

        <main :class="{ 'main--bet': betMarket }">
          <BetModal
            v-if="betMarket"
            :market="betMarket"
            :isMod="isMod"
            :balance="balance"
            @close="closeBet"
            @placed="onBetPlaced"
          />
          <template v-else>
            <div v-if="!marketEnabled && activeTab !== 'leaderboard' && activeTab !== 'credits'" class="market-disabled-notice">
              The prediction market is not enabled on this server yet.<br>
              An admin can enable it with <code>/setup enable_market:True</code>.
            </div>
            <template v-else>
              <MarketsTab v-if="activeTab === 'markets'" :isMod="isMod" :activeTag="activeTag" @open-bet="openBet" />
              <PortfolioTab v-if="activeTab === 'portfolio'" />
              <HistoryTab v-if="activeTab === 'history'" />
            </template>
            <LeaderboardTab v-if="activeTab === 'leaderboard'" />
            <CreditsTab v-if="activeTab === 'credits'" />
            <ModTab
              v-if="activeTab === 'mod'"
              :initialFeaturedTags="featuredTags"
              @created="onMarketCreated"
              @tags-updated="featuredTags = $event"
            />
          </template>
        </main>

        <GristInfoModal
          v-if="showGristInfo"
          @close="showGristInfo = false"
        />

        <PayoutPopup
          v-if="recentPayouts"
          :payouts="recentPayouts"
          @close="acknowledgePayouts().catch(() => {}); recentPayouts = null"
        />
      </template>
    </template>

    <!-- Loading -->
    <div v-else class="error-screen">
      <p>Connecting...</p>
    </div>
  </div>
</template>

<style>
@font-face {
    font-family: 'TYPOSTUCK';
    src: url('./fonts/TYPOSTUCK.woff2') format('woff2'),
        url('./fonts/TYPOSTUCK.woff') format('woff');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
}

:root {
  --bg: #0a0c0f;
  --surface: #00adff0a;
  --accent: #1cb3f2;
  --accent-hover: #4dc4f5;
  --text: #eee;
  --muted: #999;
  --border: #2a2a4a;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

* { margin: 0; padding: 0; box-sizing: border-box; font-family: Courier, serif;}

html { scrollbar-gutter: stable; }

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: var(--font);
  margin: 0;
  min-height: 100vh;
  display: flex;
  justify-content: center;
}

#app {
  width: 100%;
  max-width: 1920px;
  min-height: 100vh;
  background-color: var(--bg);
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 0 auto;
}

header {
  padding: 8px 16px 0;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg);
}

@media (max-width: 767px) {
  header { padding-top: 64px; }
}

.header-top {
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  padding: 4px 0;
}

.header-right {
  position: absolute;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

header h1 {
  font-family: "TYPOSTUCK", sans-serif;
  font-weight: 400;
  font-size: 3.4rem;
  color: var(--accent);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.title-grist-icon {
  width: 44px;
  height: 44px;
  object-fit: contain;
}

.header-nav {
  display: flex;
  justify-content: center;
  overflow-x: auto;
  scrollbar-width: none;
  cursor: grab;
}
.header-nav::-webkit-scrollbar { display: none; }

#balance-display {
  background: rgba(28, 179, 242, 0.1);
  color: var(--accent);
  padding: 4px 10px;
  font-size: 0.85rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.grist-icon {
  width: 14px;
  height: 14px;
  object-fit: contain;
}


.tab {
  padding: 8px 10px;
  cursor: pointer;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 600;
  background: none;
  border: none;
  white-space: nowrap;
  font-family: inherit;
}
.tab.active { color: var(--text); }
.tab:hover:not(.active) { color: var(--text); }

main {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  padding-bottom: 40px;
  width: 100%;
  max-width: 1650px;
  margin: 0 auto;
}

main.main--bet {
  padding: 0;
  padding-bottom: 0;
}

@media (min-width: 768px) {
  main:not(.main--bet) { padding: 24px; }
}

.tab-section-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--muted);
  letter-spacing: 1px;
  margin: 16px 0 8px;
  font-weight: normal;
}

.card {
  background: var(--surface);
  padding: 12px;
  margin-bottom: 10px;
}
.card:last-child { margin-bottom: 0; }

.form-group { margin-bottom: 12px; }
.form-group label {
  display: block;
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 4px;
}

.form-control {
  width: 100%;
  background: var(--surface);
  padding: 8px 12px;
  color: var(--text);
  box-sizing: border-box;
  font-family: inherit;
  font-size: 0.9rem;
  appearance: none;
  border: 1px solid var(--border);
}
.form-control:focus { outline: none; border-color: var(--accent); }

textarea.form-control { height: 60px; resize: none; }

select.form-control {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

.btn {
  background: var(--accent);
  color: white;
  padding: 10px;
  border: none;
  width: 100%;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.9rem;
  font-family: inherit;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}
.btn:hover { background: var(--accent-hover); }

.error-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 80px;
  text-align: center;
  color: var(--muted);
}
.error-screen h2 { color: var(--text); margin-bottom: 12px; }

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

/* Small viewport mini view */
.mini-view {
  padding: 8px;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.mini-header {
  text-align: center;
  margin-bottom: 4px;
}

.mini-title {
  font-family: "TYPOSTUCK", sans-serif;
  font-weight: 400;
  font-size: 1.2rem;
  color: var(--accent);
}

.mini-market {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.mini-market-title {
  font-size: 0.7rem;
  font-weight: 600;
  margin-bottom: 4px;
  text-align: center;
}

.mini-options {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 0.6rem;
  font-weight: 600;
}

.pixel-corners,
.pixel-corners--wrapper {
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
    0px 14px);
  position: relative;
}
.pixel-corners {
  border: 2px solid transparent;
}
.pixel-corners--wrapper {
  width: fit-content;
  height: fit-content;
}
.pixel-corners--wrapper .pixel-corners {
  display: block;
  clip-path: polygon(2px 14px,
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
    2px calc(100% - 14px));
}
.pixel-corners::after,
.pixel-corners--wrapper::after {
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
  background: var(--border);
  display: block;
  pointer-events: none;
}
.pixel-corners::after {
  margin: -2px;
}

/* Balance animation */
@keyframes balance-up-pulse {
  0% { transform: scale(1); }
  40% { transform: scale(1.18); color: #48bb78; }
  100% { transform: scale(1); }
}
@keyframes balance-down-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}
#balance-display.balance-up {
  animation: balance-up-pulse 0.4s ease;
  color: #48bb78;
}
#balance-display.balance-down {
  animation: balance-down-shake 0.5s ease;
  color: #e94560;
}

.market-disabled-notice {
  text-align: center;
  color: var(--muted);
  padding: 48px 20px;
  font-size: 0.9rem;
  line-height: 1.6;
}
.market-disabled-notice code {
  background: rgba(28,179,242,0.1);
  color: var(--accent);
  padding: 2px 6px;
  font-size: 0.85rem;
}
</style>
