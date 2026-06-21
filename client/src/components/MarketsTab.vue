<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useApi } from '../composables/useApi'
import MarketCard from './MarketCard.vue'

const props = defineProps({ isMod: Boolean, activeTag: { type: String, default: null } })
const emit = defineEmits(['open-bet'])
const { getMarkets } = useApi()

const markets = ref([])
const loading = ref(true)
const error = ref(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    markets.value = await getMarkets()
  } catch (err) {
    error.value = err.message
  }
  loading.value = false
}

async function refresh() {
  try {
    markets.value = await getMarkets()
  } catch {}
}

function totalPool(market) {
  return market.total_grist ?? 0
}

const tagFiltered = computed(() => {
  if (!props.activeTag) return markets.value
  return markets.value.filter(m => m.tags && m.tags.includes(props.activeTag))
})
const visibleMarkets = computed(() => tagFiltered.value.filter(m => !m.hidden))
const hiddenMarkets = computed(() => props.isMod ? tagFiltered.value.filter(m => m.hidden) : [])

// Featured = visible market with the most grist in pool
const featuredMarket = computed(() => {
  if (!visibleMarkets.value.length) return null
  return visibleMarkets.value.reduce((best, m) => totalPool(m) > totalPool(best) ? m : best, visibleMarkets.value[0])
})

// Left column: sections of up to 5 markets each
const hotMarkets = computed(() => {
  return [...visibleMarkets.value]
    .filter(m => m.id !== featuredMarket.value?.id)
    .sort((a, b) => totalPool(b) - totalPool(a))
    .slice(0, 5)
})

const closingSoonMarkets = computed(() => {
  return [...visibleMarkets.value]
    .filter(m => m.closes_at && m.id !== featuredMarket.value?.id)
    .sort((a, b) => new Date(a.closes_at) - new Date(b.closes_at))
    .slice(0, 5)
})

// Right column: all visible markets sorted by newest
const newestMarkets = computed(() => {
  return [...visibleMarkets.value]
    .filter(m => m.id !== featuredMarket.value?.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
})

let poll = null
onMounted(() => {
  load()
  poll = setInterval(refresh, 5000)
})
onUnmounted(() => clearInterval(poll))
</script>

<template>
  <div>
    <div v-if="loading" class="empty-state">Loading...</div>
    <div v-else-if="error" class="empty-state">{{ error }}</div>
    <div v-else-if="visibleMarkets.length === 0 && hiddenMarkets.length === 0" class="empty-state">No open markets yet. Create one!</div>
    <div v-else>
      <!-- Featured market (most grist) -->
      <MarketCard
        v-if="featuredMarket"
        :market="featuredMarket"
        :featured="true"
        :isMod="isMod"
        @open-bet="m => emit('open-bet', m)"
      />

      <!-- Two-column layout -->
      <div class="markets-columns">
        <!-- Left: sections -->
        <div class="markets-left">
          <div v-if="hotMarkets.length" class="market-section">
            <h3 class="section-title">Hottest Markets</h3>
            <MarketCard
              v-for="market in hotMarkets"
              :key="market.id"
              :market="market"
              :isMod="isMod"
              @open-bet="m => emit('open-bet', m)"
            />
          </div>

          <div v-if="closingSoonMarkets.length" class="market-section">
            <h3 class="section-title">Closing Soon</h3>
            <MarketCard
              v-for="market in closingSoonMarkets"
              :key="market.id"
              :market="market"
              :isMod="isMod"
              @open-bet="m => emit('open-bet', m)"
            />
          </div>
        </div>

        <!-- Right: newest -->
        <div class="markets-right">
          <h3 class="section-title">Newest</h3>
          <MarketCard
            v-for="market in newestMarkets"
            :key="market.id"
            :market="market"
            :isMod="isMod"
            @open-bet="m => emit('open-bet', m)"
          />
        </div>
      </div>

      <!-- Hidden markets (mod only) -->
      <div v-if="isMod && hiddenMarkets.length" class="market-section hidden-section">
        <h3 class="section-title hidden-title">Hidden Markets</h3>
        <MarketCard
          v-for="market in hiddenMarkets"
          :key="market.id"
          :market="market"
          :isMod="isMod"
          @open-bet="m => emit('open-bet', m)"
        />
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

.markets-columns {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}

.markets-left,
.markets-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.markets-right{
  flex: 0.45;
}

.market-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.section-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--muted);
  letter-spacing: 1px;
  font-weight: normal;
  margin: 0;
}

@media (max-width: 768px) {
  .markets-columns {
    flex-direction: column;
  }
}

.hidden-section {
  margin-top: 24px;
  opacity: 0.6;
}

.hidden-title {
  color: #e94560;
}
</style>
