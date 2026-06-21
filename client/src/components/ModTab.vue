<script setup>
import { ref, computed, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import CreateTab from './CreateTab.vue'
import ImageCropper from './ImageCropper.vue'

const props = defineProps({
  initialFeaturedTags: { type: Array, default: () => [] },
})
const emit = defineEmits(['created', 'tags-updated'])

const {
  getModMarkets, resolveMarket, reopenMarket, toggleHidden, updateClosesAt,
  setMarketIcon, getIconGallery, updateMarketTags, uploadIcon,
  setFeaturedTags,
  getModUsers, giveGrist,
  setMarketFixture, searchFixtures,
  updateMarketTitle, updateMarketDescription, updateOptionLabel,
  getModLog, getMarketShares,
} = useApi()

// ─── Navigation ───────────────────────────────────────────────
const section = ref('markets') // 'markets' | 'market-detail' | 'create' | 'tags' | 'grist' | 'log'
const detailTab = ref('edit')  // 'edit' | 'shares'

// ─── Markets list ─────────────────────────────────────────────
const markets = ref([])
const loadingMarkets = ref(true)
const showClosed = ref(false)

const visibleMarkets = computed(() =>
  showClosed.value ? markets.value : markets.value.filter(m => m.status === 'open')
)

async function loadMarkets() {
  loadingMarkets.value = true
  try { markets.value = await getModMarkets() } catch {}
  loadingMarkets.value = false
}

// ─── Market detail ────────────────────────────────────────────
const selected = ref(null)
const resolveOptionId = ref(null)
const resolving = ref(false)
const resolveError = ref(null)
const reopening = ref(false)
const togglingHidden = ref(false)

const closesAtEdit = ref('')
const savingCloseTime = ref(false)

const iconUrlEdit = ref('')
const savingIcon = ref(false)
const gallery = ref([])
const galleryLoaded = ref(false)
const showGallery = ref(false)
const cropFile = ref(null)       // File waiting to be cropped
const fileInputEl = ref(null)    // hidden <input type="file">

const titleEdit = ref('')
const savingTitle = ref(false)

const descriptionEdit = ref('')
const savingDescription = ref(false)

const optionLabelsEdit = ref([])
const savingOptionLabel = ref(null)

const tagsEdit = ref([])
const tagInputEdit = ref('')
const savingMarketTags = ref(false)

const fixtureIdEdit = ref('')
const sportEdit = ref('football')
const savingFixture = ref(false)
const fixtureSearchDate = ref(new Date().toISOString().slice(0, 10))
const fixtureSearchQuery = ref('')
const fixtureResults = ref([])
const searchingFixtures = ref(false)
const fixtureSearchError = ref(null)

// ─── Shares tab ───────────────────────────────────────────────
const sharesData = ref(null)   // { isAdmin, options }
const loadingShares = ref(false)

async function loadShares() {
  if (!selected.value) return
  loadingShares.value = true
  sharesData.value = null
  try { sharesData.value = await getMarketShares(selected.value.id) } catch {}
  loadingShares.value = false
}

function switchToShares() {
  detailTab.value = 'shares'
  if (!sharesData.value && !loadingShares.value) loadShares()
}

const filteredFixtureResults = computed(() => {
  const q = fixtureSearchQuery.value.toLowerCase().trim()
  if (!q) return fixtureResults.value
  return fixtureResults.value.filter(r =>
    r.teams.home.name.toLowerCase().includes(q) ||
    r.teams.away.name.toLowerCase().includes(q) ||
    r.league.name.toLowerCase().includes(q) ||
    r.league.country.toLowerCase().includes(q)
  )
})

function openDetail(market) {
  selected.value = market
  resolveOptionId.value = null
  resolveError.value = null
  closesAtEdit.value = market.closes_at
    ? new Date(market.closes_at).toISOString().slice(0, 16)
    : ''
  iconUrlEdit.value = market.icon_url ?? ''
  titleEdit.value = market.title ?? ''
  descriptionEdit.value = market.description ?? ''
  optionLabelsEdit.value = (market.options ?? []).map(o => ({ id: o.id, label: o.label }))
  tagsEdit.value = (market.tags ?? []).map(t => t.toLowerCase())
  tagInputEdit.value = ''
  fixtureIdEdit.value = market.fixture_id != null ? String(market.fixture_id) : ''
  sportEdit.value = market.sport || 'football'
  fixtureResults.value = []
  fixtureSearchQuery.value = ''
  fixtureSearchError.value = null
  showGallery.value = false
  detailTab.value = 'edit'
  sharesData.value = null
  if (!galleryLoaded.value) loadGallery()
  section.value = 'market-detail'
}

async function loadGallery() {
  try {
    gallery.value = await getIconGallery()
    galleryLoaded.value = true
  } catch {}
}

async function doResolve() {
  if (!resolveOptionId.value) return
  resolving.value = true
  resolveError.value = null
  try {
    await resolveMarket(selected.value.id, resolveOptionId.value)
    selected.value = { ...selected.value, status: 'resolved' }
    await loadMarkets()
  } catch (err) {
    resolveError.value = err.message
  }
  resolving.value = false
}

async function doReopen() {
  reopening.value = true
  try {
    await reopenMarket(selected.value.id)
    selected.value = { ...selected.value, status: 'open' }
    await loadMarkets()
  } catch {}
  reopening.value = false
}

async function doToggleHidden() {
  togglingHidden.value = true
  const next = !selected.value.hidden
  try {
    await toggleHidden(selected.value.id, next)
    selected.value = { ...selected.value, hidden: next }
    await loadMarkets()
  } catch {}
  togglingHidden.value = false
}

async function doSaveCloseTime() {
  savingCloseTime.value = true
  const val = closesAtEdit.value ? new Date(closesAtEdit.value).toISOString() : null
  try {
    await updateClosesAt(selected.value.id, val)
    selected.value = { ...selected.value, closes_at: val }
    await loadMarkets()
  } catch {}
  savingCloseTime.value = false
}

async function doSetIcon(url) {
  iconUrlEdit.value = url ?? ''
  savingIcon.value = true
  try {
    await setMarketIcon(selected.value.id, url ?? null)
    selected.value = { ...selected.value, icon_url: url ?? null }
    if (url && !gallery.value.includes(url)) gallery.value.unshift(url)
    await loadMarkets()
  } catch {}
  savingIcon.value = false
  showGallery.value = false
}

async function onCropConfirm(dataUrl) {
  cropFile.value = null
  savingIcon.value = true
  try {
    const { url } = await uploadIcon(dataUrl)
    await doSetIcon(url)
  } catch {}
  savingIcon.value = false
}

function onFileSelected(e) {
  const file = e.target.files[0]
  if (file) cropFile.value = file
  e.target.value = ''  // reset so same file can be re-selected
}

// Normalize non-football sports (which use /games) to the same shape as football /fixtures
function normalizeToFixtureShape(item, sport) {
  if (sport === 'football') return item
  return {
    fixture: { id: item.id, date: item.date },
    league: { name: item.league?.name ?? '', country: item.country?.name ?? item.league?.country ?? '' },
    teams: item.teams,
  }
}

async function doSearchFixtures() {
  searchingFixtures.value = true
  fixtureSearchError.value = null
  fixtureResults.value = []
  try {
    const data = await searchFixtures(fixtureSearchDate.value, sportEdit.value)
    const raw = data.response ?? []
    fixtureResults.value = raw.map(r => normalizeToFixtureShape(r, sportEdit.value))
    if (!fixtureResults.value.length) fixtureSearchError.value = 'No fixtures found for this date.'
  } catch (err) {
    fixtureSearchError.value = err.message
  }
  searchingFixtures.value = false
}

async function pickFixture(fixture) {
  fixtureIdEdit.value = String(fixture.fixture.id)
  await doSaveFixture()
}

async function doSaveFixture() {
  savingFixture.value = true
  const id = fixtureIdEdit.value.trim() ? parseInt(fixtureIdEdit.value.trim(), 10) : null
  try {
    await setMarketFixture(selected.value.id, id, sportEdit.value)
    selected.value = { ...selected.value, fixture_id: id, sport: sportEdit.value }
  } catch {}
  savingFixture.value = false
}

async function doSaveTitle() {
  if (!titleEdit.value.trim()) return
  savingTitle.value = true
  try {
    await updateMarketTitle(selected.value.id, titleEdit.value.trim())
    selected.value = { ...selected.value, title: titleEdit.value.trim() }
    await loadMarkets()
  } catch {}
  savingTitle.value = false
}

async function doSaveDescription() {
  savingDescription.value = true
  try {
    await updateMarketDescription(selected.value.id, descriptionEdit.value || null)
    selected.value = { ...selected.value, description: descriptionEdit.value || null }
  } catch {}
  savingDescription.value = false
}

async function doSaveOptionLabel(opt) {
  if (!opt.label.trim()) return
  savingOptionLabel.value = opt.id
  try {
    await updateOptionLabel(selected.value.id, opt.id, opt.label.trim())
    selected.value = {
      ...selected.value,
      options: selected.value.options.map(o => o.id === opt.id ? { ...o, label: opt.label.trim() } : o),
    }
  } catch {}
  savingOptionLabel.value = null
}

async function doSaveMarketTags() {
  savingMarketTags.value = true
  try {
    await updateMarketTags(selected.value.id, tagsEdit.value)
    selected.value = { ...selected.value, tags: [...tagsEdit.value] }
    await loadMarkets()
  } catch {}
  savingMarketTags.value = false
}

function addMarketTag() {
  const t = tagInputEdit.value.trim().toLowerCase()
  if (t && !tagsEdit.value.includes(t)) tagsEdit.value.push(t)
  tagInputEdit.value = ''
}

// ─── Featured tags ────────────────────────────────────────────
const featuredList = ref([...props.initialFeaturedTags])
const tagAddInput = ref('')
const savingFeatured = ref(false)
const featuredSaved = ref(false)

const allKnownTags = computed(() => {
  const set = new Set()
  for (const m of markets.value) for (const t of (m.tags ?? [])) set.add(t)
  for (const t of featuredList.value) set.add(t)
  return [...set].sort()
})

function addFeaturedTag() {
  const t = tagAddInput.value.trim()
  if (t && !featuredList.value.includes(t)) featuredList.value.push(t)
  tagAddInput.value = ''
}

function moveFeaturedTag(i, dir) {
  const j = i + dir
  if (j < 0 || j >= featuredList.value.length) return
  const tmp = featuredList.value[i]
  featuredList.value[i] = featuredList.value[j]
  featuredList.value[j] = tmp
}

async function saveFeaturedTags() {
  savingFeatured.value = true
  try {
    await setFeaturedTags([...featuredList.value])
    emit('tags-updated', [...featuredList.value])
    featuredSaved.value = true
    setTimeout(() => { featuredSaved.value = false }, 1500)
  } catch {}
  savingFeatured.value = false
}

// ─── Mod log ─────────────────────────────────────────────────
const logEntries = ref([])
const loadingLog = ref(false)

async function loadLog() {
  loadingLog.value = true
  try { logEntries.value = await getModLog() } catch {}
  loadingLog.value = false
}

// ─── Give grist ───────────────────────────────────────────────
const gristUsers = ref([])
const loadingUsers = ref(false)
const gristSearch = ref('')
const gristAmounts = ref({})
const givingGristFor = ref(null)
const gristSuccess = ref(null)

async function loadUsers() {
  loadingUsers.value = true
  try { gristUsers.value = await getModUsers() } catch {}
  loadingUsers.value = false
}

const filteredUsers = computed(() => {
  const q = gristSearch.value.toLowerCase()
  if (!q) return gristUsers.value
  return gristUsers.value.filter(u =>
    (u.username ?? '').toLowerCase().includes(q) ||
    (u.nickname ?? '').toLowerCase().includes(q)
  )
})

async function doGiveGrist(u) {
  const amount = parseFloat(gristAmounts.value[u.discord_id])
  if (!amount || amount <= 0) return
  givingGristFor.value = u.discord_id
  try {
    await giveGrist(u.discord_id, amount)
    gristSuccess.value = u.discord_id
    gristAmounts.value[u.discord_id] = ''
    const found = gristUsers.value.find(x => x.discord_id === u.discord_id)
    if (found) found.balance = parseFloat(found.balance) + amount
    setTimeout(() => { gristSuccess.value = null }, 1500)
  } catch {}
  givingGristFor.value = null
}

function goTo(s) {
  section.value = s
  if (s === 'grist' && !gristUsers.value.length) loadUsers()
  if (s === 'log') loadLog()
}

function onCreated() {
  loadMarkets()
  emit('created')
  section.value = 'markets'
}

onMounted(loadMarkets)
</script>

<template>
  <div class="mod-tab">
    <!-- Sub-navigation -->
    <div class="mod-subnav">
      <button :class="{ active: section === 'markets' || section === 'market-detail' }" @click="goTo('markets')">Markets</button>
      <button :class="{ active: section === 'create' }" @click="goTo('create')">+ New Market</button>
      <button :class="{ active: section === 'tags' }" @click="goTo('tags')">Featured Tags</button>
      <button :class="{ active: section === 'grist' }" @click="goTo('grist')">Give Grist</button>
      <button :class="{ active: section === 'log' }" @click="goTo('log')">Log</button>
    </div>

    <!-- ── Markets list ── -->
    <div v-if="section === 'markets'" class="mod-section">
      <div class="markets-list-header">
        <label class="toggle-label">
          <input type="checkbox" v-model="showClosed" class="toggle-input" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          Show closed markets
        </label>
      </div>
      <div v-if="loadingMarkets" class="mod-empty">Loading...</div>
      <div v-else-if="!visibleMarkets.length" class="mod-empty">No markets yet.</div>
      <div v-else class="market-table">
        <div
          v-for="m in visibleMarkets"
          :key="m.id"
          class="market-row"
          @click="openDetail(m)"
        >
          <img v-if="m.icon_url" :src="m.icon_url" class="row-icon" />
          <div v-else class="row-icon-placeholder" />
          <div class="row-main">
            <span class="row-title">{{ m.title }}</span>
            <span class="row-id">#{{ m.id }}</span>
          </div>
          <div class="row-tags">
            <span v-for="t in (m.tags ?? [])" :key="t" class="tag-chip">{{ t }}</span>
          </div>
          <div class="row-badges">
            <span v-if="m.hidden" class="badge badge--hidden">hidden</span>
            <span class="badge" :class="`badge--${m.status}`">{{ m.status }}</span>
          </div>
          <span class="row-arrow">›</span>
        </div>
      </div>
    </div>

    <!-- ── Market detail ── -->
    <div v-else-if="section === 'market-detail' && selected" class="mod-section mod-section--detail">
      <button class="back-btn" @click="section = 'markets'">← All markets</button>

      <div class="detail-hero">
        <img v-if="selected.icon_url" :src="selected.icon_url" class="detail-hero-icon" />
        <div>
          <div class="detail-hero-title">{{ selected.title }}</div>
          <div class="detail-hero-sub">
            Market #{{ selected.id }}
            <span class="badge" :class="`badge--${selected.status}`" style="margin-left:8px">{{ selected.status }}</span>
            <span v-if="selected.hidden" class="badge badge--hidden" style="margin-left:4px">hidden</span>
          </div>
        </div>
      </div>

      <!-- Detail sub-tabs -->
      <div class="detail-subnav">
        <button :class="{ active: detailTab === 'edit' }" @click="detailTab = 'edit'">Edit</button>
        <button :class="{ active: detailTab === 'shares' }" @click="switchToShares">Shares</button>
      </div>

      <!-- ── Edit tab ── -->
      <div v-if="detailTab === 'edit'" class="detail-grid">
        <!-- Visibility -->
        <div class="detail-card">
          <div class="detail-card-title">Visibility</div>
          <button
            class="action-btn"
            :class="selected.hidden ? 'action-btn--accent' : 'action-btn--danger'"
            :disabled="togglingHidden"
            @click="doToggleHidden"
          >{{ selected.hidden ? 'Show to users' : 'Hide from users' }}</button>
        </div>

        <!-- Close time -->
        <div class="detail-card">
          <div class="detail-card-title">Close time</div>
          <div class="field-row">
            <input type="datetime-local" class="field-input" v-model="closesAtEdit" />
            <button class="action-btn action-btn--accent" :disabled="savingCloseTime" @click="doSaveCloseTime">
              {{ savingCloseTime ? '...' : 'Save' }}
            </button>
          </div>
        </div>

        <!-- Resolve -->
        <div v-if="selected.status === 'open' || selected.status === 'closed'" class="detail-card">
          <div class="detail-card-title">Resolve market</div>
          <div class="field-row">
            <select class="field-input" v-model="resolveOptionId">
              <option :value="null" disabled>Select winning option...</option>
              <option v-for="opt in selected.options" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
            </select>
            <button
              class="action-btn action-btn--danger"
              :disabled="!resolveOptionId || resolving"
              @click="doResolve"
            >{{ resolving ? '...' : 'Resolve' }}</button>
          </div>
          <div v-if="resolveError" class="field-error">{{ resolveError }}</div>
        </div>

        <!-- Reopen -->
        <div v-if="selected.status === 'resolved'" class="detail-card">
          <div class="detail-card-title">Reopen market</div>
          <p class="detail-hint">Rolls back all payouts.</p>
          <button class="action-btn action-btn--danger" :disabled="reopening" @click="doReopen">
            {{ reopening ? 'Reopening...' : 'Reopen & roll back payouts' }}
          </button>
        </div>

        <!-- Title -->
        <div class="detail-card detail-card--wide">
          <div class="detail-card-title">Market title</div>
          <div class="field-row">
            <input class="field-input" v-model="titleEdit" placeholder="Market title..." />
            <button class="action-btn action-btn--accent" :disabled="savingTitle" @click="doSaveTitle">
              {{ savingTitle ? '...' : 'Save' }}
            </button>
          </div>
        </div>

        <!-- Description -->
        <div class="detail-card detail-card--wide">
          <div class="detail-card-title">Description</div>
          <textarea class="field-input field-textarea" v-model="descriptionEdit" placeholder="Optional description..." rows="3"></textarea>
          <div class="field-row" style="margin-top:6px">
            <button class="action-btn action-btn--accent" :disabled="savingDescription" @click="doSaveDescription">
              {{ savingDescription ? '...' : 'Save description' }}
            </button>
          </div>
        </div>

        <!-- Option labels -->
        <div class="detail-card detail-card--wide">
          <div class="detail-card-title">Option labels</div>
          <div v-for="opt in optionLabelsEdit" :key="opt.id" class="field-row" style="margin-top:6px">
            <input class="field-input" v-model="opt.label" @keydown.enter.prevent="doSaveOptionLabel(opt)" />
            <button class="action-btn action-btn--accent" :disabled="savingOptionLabel === opt.id" @click="doSaveOptionLabel(opt)">
              {{ savingOptionLabel === opt.id ? '...' : 'Save' }}
            </button>
          </div>
        </div>

        <!-- Tags -->
        <div class="detail-card detail-card--wide">
          <div class="detail-card-title">Tags</div>
          <div class="chip-list">
            <span v-for="(t, i) in tagsEdit" :key="t" class="tag-edit-chip">
              {{ t }}
              <button class="chip-x" @click="tagsEdit.splice(i, 1)">×</button>
            </span>
          </div>
          <div class="field-row" style="margin-top:8px">
            <input
              class="field-input"
              v-model="tagInputEdit"
              placeholder="Add tag..."
              @keydown.enter.prevent="addMarketTag"
            />
            <button class="action-btn action-btn--ghost" @click="addMarketTag">+</button>
            <button class="action-btn action-btn--accent" :disabled="savingMarketTags" @click="doSaveMarketTags">
              {{ savingMarketTags ? '...' : 'Save tags' }}
            </button>
          </div>
        </div>

        <!-- Fixture -->
        <div class="detail-card detail-card--wide">
          <div class="detail-card-title">
            Game widget
            <span v-if="selected.fixture_id" class="fixture-linked-badge">linked #{{ selected.fixture_id }}</span>
          </div>

          <!-- Search row -->
          <div class="field-row">
            <select class="field-input field-input--sport" v-model="sportEdit">
              <option value="football">Football</option>
              <option value="baseball">Baseball</option>
              <option value="basketball">Basketball</option>
              <option value="hockey">Hockey</option>
              <option value="rugby">Rugby</option>
              <option value="handball">Handball</option>
              <option value="volleyball">Volleyball</option>
              <option value="afl">AFL</option>
              <option value="nfl">NFL</option>
              <option value="nba">NBA</option>
            </select>
            <input type="date" class="field-input" v-model="fixtureSearchDate" />
            <button class="action-btn action-btn--accent" :disabled="searchingFixtures" @click="doSearchFixtures">
              {{ searchingFixtures ? '...' : 'Search' }}
            </button>
            <button v-if="selected.fixture_id" class="action-btn action-btn--ghost" @click="fixtureIdEdit = ''; doSaveFixture()">Unlink</button>
          </div>

          <!-- Error -->
          <div v-if="fixtureSearchError" class="field-error">{{ fixtureSearchError }}</div>

          <!-- Filter + Results -->
          <template v-if="fixtureResults.length">
            <input
              class="field-input"
              v-model="fixtureSearchQuery"
              placeholder="Filter by team or league..."
              style="margin-top:8px"
            />
          </template>

          <div v-if="filteredFixtureResults.length" class="fixture-results">
            <button
              v-for="r in filteredFixtureResults"
              :key="r.fixture.id"
              class="fixture-row"
              :class="{ 'fixture-row--active': selected.fixture_id === r.fixture.id }"
              :disabled="savingFixture"
              @click="pickFixture(r)"
            >
              <span class="fixture-league">{{ r.league.name }} · {{ r.league.country }}</span>
              <span class="fixture-match">{{ r.teams.home.name }} <span class="fixture-vs">vs</span> {{ r.teams.away.name }}</span>
              <span class="fixture-meta">
                {{ new Date(r.fixture.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                · #{{ r.fixture.id }}
              </span>
            </button>
          </div>
        </div>

        <!-- Icon -->
        <div class="detail-card detail-card--wide">
          <div class="detail-card-title">Market icon</div>
          <div class="field-row">
            <input class="field-input" v-model="iconUrlEdit" placeholder="Paste image URL..." />
            <button class="action-btn action-btn--accent" :disabled="savingIcon" @click="doSetIcon(iconUrlEdit || null)">
              {{ savingIcon ? '...' : 'Set' }}
            </button>
            <button v-if="selected.icon_url" class="action-btn action-btn--ghost" @click="doSetIcon(null)">Clear</button>
          </div>
          <div class="field-row" style="margin-top:6px">
            <input ref="fileInputEl" type="file" accept="image/*" style="display:none" @change="onFileSelected" />
            <button class="action-btn action-btn--ghost" :disabled="savingIcon" @click="fileInputEl.click()">
              Upload from computer
            </button>
          </div>
          <button class="gallery-toggle" @click="showGallery = !showGallery">
            {{ showGallery ? 'Hide gallery' : 'Pick from gallery' }}
            <span v-if="galleryLoaded">({{ gallery.length }})</span>
          </button>
          <div v-if="showGallery && gallery.length" class="icon-gallery">
            <img
              v-for="url in gallery"
              :key="url"
              :src="url"
              class="gallery-thumb"
              :class="{ 'gallery-thumb--active': iconUrlEdit === url }"
              @click="doSetIcon(url)"
            />
          </div>
          <div v-if="showGallery && galleryLoaded && !gallery.length" class="mod-empty" style="padding:8px 0">
            No icons used yet.
          </div>
        </div>
      </div>

      <!-- ── Shares tab ── -->
      <div v-else-if="detailTab === 'shares'" class="shares-tab">
        <div v-if="loadingShares" class="mod-empty">Loading...</div>
        <div v-else-if="!sharesData" class="mod-empty">No data.</div>
        <div v-else-if="!sharesData.options.length" class="mod-empty">No trades yet.</div>
        <div v-else class="shares-list">
          <div v-for="opt in sharesData.options" :key="opt.option_id" class="shares-option">
            <div class="shares-option-header">
              <span class="shares-option-label">{{ opt.option_label }}</span>
              <span v-if="opt.probability !== null" class="shares-option-prob">{{ opt.probability }}%</span>
              <span class="shares-option-grist">{{ opt.net_grist }} wagered</span>
              <span class="shares-option-shares">{{ opt.total_shares }} payout if wins</span>
              <span class="shares-holder-count">{{ opt.buyer_count }} buyer{{ opt.buyer_count !== 1 ? 's' : '' }}</span>
            </div>
            <div v-if="sharesData.isAdmin && opt.holders.length" class="shares-holders">
              <div v-for="h in opt.holders" :key="h.discord_id" class="shares-holder-row">
                <span class="shares-holder-name">{{ h.display_name }}</span>
                <span class="shares-holder-amount">{{ h.net_grist }} wagered · {{ h.shares.toFixed(2) }} payout</span>
              </div>
            </div>
          </div>
        </div>
        <button class="action-btn action-btn--ghost" style="margin-top:12px" @click="loadShares">Refresh</button>
      </div>
    </div>

    <!-- ── Create market ── -->
    <div v-else-if="section === 'create'" class="mod-section">
      <CreateTab @created="onCreated" />
    </div>

    <!-- ── Featured tags ── -->
    <div v-else-if="section === 'tags'" class="mod-section">
      <div class="tags-layout">
        <div class="tags-left">
          <div class="section-header">
            <h2 class="section-title">Featured Tags</h2>
            <button class="action-btn action-btn--accent" :disabled="savingFeatured" @click="saveFeaturedTags">
              {{ featuredSaved ? 'Saved!' : savingFeatured ? '...' : 'Save order' }}
            </button>
          </div>
          <p class="detail-hint">These tags appear in the filter bar above the market list, in this order.</p>

          <div v-if="!featuredList.length" class="mod-empty" style="padding:20px 0">No featured tags yet.</div>
          <div v-else class="featured-list">
            <div v-for="(tag, i) in featuredList" :key="tag" class="featured-row">
              <div class="arrow-col">
                <button class="arrow-btn" :disabled="i === 0" @click="moveFeaturedTag(i, -1)">↑</button>
                <button class="arrow-btn" :disabled="i === featuredList.length - 1" @click="moveFeaturedTag(i, 1)">↓</button>
              </div>
              <span class="featured-tag-name">{{ tag }}</span>
              <button class="chip-x" @click="featuredList.splice(i, 1)">×</button>
            </div>
          </div>

          <div class="field-row" style="margin-top:16px">
            <input
              class="field-input"
              v-model="tagAddInput"
              list="known-tags-list"
              placeholder="Tag name..."
              @keydown.enter.prevent="addFeaturedTag"
            />
            <datalist id="known-tags-list">
              <option v-for="t in allKnownTags" :key="t" :value="t" />
            </datalist>
            <button class="action-btn action-btn--accent" @click="addFeaturedTag">Add</button>
          </div>
        </div>

        <div class="tags-right">
          <h3 class="section-title" style="margin-bottom:10px">All tags in use</h3>
          <div v-if="!allKnownTags.length" class="mod-empty" style="padding:12px 0">No tags yet.</div>
          <div class="known-tags-list">
            <button
              v-for="t in allKnownTags"
              :key="t"
              class="known-tag-btn"
              :class="{ 'known-tag-btn--active': featuredList.includes(t) }"
              @click="() => { if (!featuredList.includes(t)) { featuredList.push(t) } }"
            >{{ t }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Mod Log ── -->
    <div v-else-if="section === 'log'" class="mod-section">
      <div class="section-header" style="margin-bottom:12px">
        <h2 class="section-title">Mod Log</h2>
        <button class="action-btn action-btn--ghost" :disabled="loadingLog" @click="loadLog">
          {{ loadingLog ? '...' : 'Refresh' }}
        </button>
      </div>
      <div v-if="loadingLog" class="mod-empty">Loading...</div>
      <div v-else-if="!logEntries.length" class="mod-empty">No actions logged yet.</div>
      <div v-else class="log-table">
        <div v-for="entry in logEntries" :key="entry.id" class="log-row">
          <span class="log-time" :title="new Date(entry.created_at).toLocaleString()">
            {{ new Date(entry.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) }}
            {{ new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
          </span>
          <span class="log-who">{{ entry.mod_name }}</span>
          <span class="log-detail">{{ entry.detail }}</span>
        </div>
      </div>
    </div>

    <!-- ── Give Grist ── -->
    <div v-else-if="section === 'grist'" class="mod-section">
      <div class="section-header" style="margin-bottom:12px">
        <h2 class="section-title">Give Grist</h2>
      </div>
      <input class="field-input" v-model="gristSearch" placeholder="Search by username..." style="margin-bottom:12px;width:100%;max-width:320px" />
      <div v-if="loadingUsers" class="mod-empty">Loading users...</div>
      <div v-else-if="!filteredUsers.length" class="mod-empty">No users found.</div>
      <div v-else class="grist-table">
        <div v-for="u in filteredUsers" :key="u.discord_id" class="grist-row">
          <div class="grist-info">
            <span class="grist-name">{{ u.nickname || u.username || u.discord_id }}</span>
            <span class="grist-balance">{{ u.balance }} grist</span>
          </div>
          <div class="grist-controls">
            <input
              class="grist-amount"
              type="number"
              min="1"
              placeholder="Amount"
              v-model="gristAmounts[u.discord_id]"
              @keydown.enter="doGiveGrist(u)"
            />
            <button
              class="action-btn action-btn--accent"
              :disabled="givingGristFor === u.discord_id"
              @click="doGiveGrist(u)"
            >{{ gristSuccess === u.discord_id ? '✓ Given' : givingGristFor === u.discord_id ? '...' : 'Give' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <ImageCropper
    v-if="cropFile"
    :file="cropFile"
    @confirm="onCropConfirm"
    @cancel="cropFile = null"
  />
</template>

<style scoped>
.mod-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* ─── Sub-navigation ─── */
.mod-subnav {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.mod-subnav::-webkit-scrollbar { display: none; }

.mod-subnav button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 600;
  font-family: inherit;
  padding: 10px 16px;
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
}
.mod-subnav button:hover { color: var(--text); }
.mod-subnav button.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* ─── Section body ─── */
.mod-section {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.mod-section--detail {
  padding: 16px 20px;
}

.mod-empty {
  color: var(--muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 40px 0;
}

.back-btn {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 0.8rem;
  font-family: inherit;
  padding: 0 0 14px;
  display: block;
}
.back-btn:hover { color: var(--accent-hover); }

/* ─── Markets list header ─── */
.markets-list-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.toggle-input {
  display: none;
}

.toggle-track {
  width: 32px;
  height: 18px;
  background: var(--border);
  border-radius: 9px;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle-input:checked + .toggle-track {
  background: var(--accent);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--text);
  border-radius: 50%;
  transition: left 0.2s;
}

.toggle-input:checked + .toggle-track .toggle-thumb {
  left: 16px;
}

/* ─── Market table ─── */
.market-table {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.market-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}
.market-row:hover { background: rgba(255,255,255,0.03); }

.row-icon {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.row-icon-placeholder {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.row-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.row-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-id {
  font-size: 0.72rem;
  color: var(--muted);
  flex-shrink: 0;
}

.row-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.tag-chip {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 1px 5px;
  opacity: 0.7;
}

.row-badges {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}
.row-arrow {
  color: var(--muted);
  font-size: 1.1rem;
  flex-shrink: 0;
}

/* ─── Badges ─── */
.badge {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 2px 6px;
  border: 1px solid currentColor;
}
.badge--open { color: #48bb78; }
.badge--closed { color: #f59e0b; }
.badge--resolved { color: var(--muted); }
.badge--cancelled { color: #e94560; }
.badge--hidden { color: #e94560; }

/* ─── Detail hero ─── */
.detail-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.detail-hero-icon {
  width: 52px;
  height: 52px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}
.detail-hero-title {
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.3;
}
.detail-hero-sub {
  font-size: 0.78rem;
  color: var(--muted);
  margin-top: 4px;
  display: flex;
  align-items: center;
}

/* ─── Detail grid ─── */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.detail-card {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.detail-card--wide {
  grid-column: 1 / -1;
}
.detail-card-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--muted);
  font-weight: 600;
}
.detail-hint {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 0;
}
.field-error {
  font-size: 0.75rem;
  color: #e94560;
}

/* ─── Form fields ─── */
.field-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.field-input {
  flex: 1;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 10px;
  font-family: inherit;
  font-size: 0.82rem;
}
.field-input:focus { outline: none; border-color: var(--accent); }

select.field-input { appearance: none; }

.field-textarea {
  resize: vertical;
  width: 100%;
  min-height: 64px;
  font-family: inherit;
}

/* ─── Action buttons ─── */
.action-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 6px 12px;
  font-size: 0.78rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.action-btn:disabled { opacity: 0.4; cursor: default; }
.action-btn--accent { border-color: var(--accent); color: var(--accent); }
.action-btn--accent:hover:not(:disabled) { background: rgba(28,179,242,0.1); }
.action-btn--danger { border-color: #e94560; color: #e94560; }
.action-btn--danger:hover:not(:disabled) { background: rgba(233,69,96,0.1); }
.action-btn--ghost { border-color: var(--border); color: var(--muted); }
.action-btn--ghost:hover:not(:disabled) { color: var(--text); }

/* ─── Chip / tag edit ─── */
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.tag-edit-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 2px 7px 2px 8px;
}
.chip-x {
  background: none;
  border: none;
  color: currentColor;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
  opacity: 0.6;
}
.chip-x:hover { opacity: 1; }

/* ─── Icon gallery ─── */
.gallery-toggle {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 0.73rem;
  cursor: pointer;
  font-family: inherit;
  padding: 4px 0 0;
  text-align: left;
}
.gallery-toggle:hover { color: var(--accent-hover); }

.icon-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.gallery-thumb {
  width: 52px;
  height: 52px;
  object-fit: cover;
  border-radius: 5px;
  cursor: pointer;
  border: 2px solid transparent;
  opacity: 0.7;
  transition: opacity 0.1s, border-color 0.1s;
}
.gallery-thumb:hover { opacity: 1; border-color: var(--accent); }
.gallery-thumb--active { opacity: 1; border-color: var(--accent); }

/* ─── Featured tags ─── */
.tags-layout {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 24px;
  align-items: start;
}
@media (max-width: 600px) {
  .tags-layout { grid-template-columns: 1fr; }
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.section-title {
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
  margin: 0;
}

.featured-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 12px;
}
.featured-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.arrow-col {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.arrow-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.75rem;
  line-height: 1;
  padding: 2px 4px;
  font-family: inherit;
}
.arrow-btn:disabled { opacity: 0.2; cursor: default; }
.arrow-btn:not(:disabled):hover { color: var(--accent); }
.featured-tag-name {
  flex: 1;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
}

.known-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.known-tag-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 3px 10px;
  font-size: 0.72rem;
  font-family: inherit;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  transition: color 0.1s, border-color 0.1s;
}
.known-tag-btn:hover { color: var(--accent); border-color: var(--accent); }
.known-tag-btn--active {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(28,179,242,0.08);
  cursor: default;
}

/* ─── Mod Log ─── */
.log-table {
  display: flex;
  flex-direction: column;
  font-size: 0.78rem;
}

.log-row {
  display: grid;
  grid-template-columns: 120px 110px 1fr;
  gap: 10px;
  align-items: baseline;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}

.log-time {
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.log-who {
  color: var(--accent);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-detail {
  color: var(--text);
  line-height: 1.4;
}

/* ─── Give Grist ─── */
.grist-table {
  display: flex;
  flex-direction: column;
  max-width: 560px;
}
.grist-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.grist-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.grist-name {
  font-size: 0.85rem;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grist-balance {
  font-size: 0.72rem;
  color: var(--muted);
}
.grist-controls {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}
.grist-amount {
  width: 80px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 5px 8px;
  font-size: 0.82rem;
  font-family: inherit;
}
.grist-amount:focus { outline: none; border-color: var(--accent); }

/* ─── Detail sub-tabs ─── */
.detail-subnav {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.detail-subnav button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 600;
  font-family: inherit;
  padding: 7px 14px;
  cursor: pointer;
  margin-bottom: -1px;
}
.detail-subnav button:hover { color: var(--text); }
.detail-subnav button.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ─── Shares tab ─── */
.shares-tab { padding-top: 4px; }
.shares-list { display: flex; flex-direction: column; gap: 10px; }
.shares-option {
  border: 1px solid var(--border);
  background: var(--surface);
}
.shares-option-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
.shares-option-label {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
}
.shares-option-prob {
  font-size: 0.8rem;
  color: var(--accent);
  font-weight: 700;
  white-space: nowrap;
  min-width: 36px;
  text-align: right;
}
.shares-option-grist {
  font-size: 0.8rem;
  color: var(--text);
  font-weight: 600;
  white-space: nowrap;
}
.shares-option-shares {
  font-size: 0.78rem;
  color: var(--muted);
  white-space: nowrap;
}
.shares-holder-count {
  font-size: 0.72rem;
  color: var(--muted);
  white-space: nowrap;
}
.shares-holders {
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.shares-holder-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 14px;
  font-size: 0.78rem;
  border-bottom: 1px solid var(--border);
}
.shares-holder-row:last-child { border-bottom: none; }
.shares-holder-name { color: var(--text); }
.shares-holder-amount { color: var(--muted); font-variant-numeric: tabular-nums; }

/* ─── Fixture search ─── */
.field-input--sport {
  flex: 0 0 auto;
  width: auto;
}

.fixture-linked-badge {
  margin-left: 8px;
  font-size: 0.65rem;
  color: #48bb78;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}

.fixture-results {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 8px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
}

.fixture-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 12px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: none;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.1s;
}
.fixture-row:last-child { border-bottom: none; }
.fixture-row:hover:not(:disabled) { background: rgba(255,255,255,0.04); }
.fixture-row--active { background: rgba(28,179,242,0.08); }
.fixture-row:disabled { opacity: 0.5; cursor: default; }

.fixture-league {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
}
.fixture-match {
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 600;
}
.fixture-vs {
  color: var(--muted);
  font-weight: 400;
  font-size: 0.75rem;
}
.fixture-meta {
  font-size: 0.68rem;
  color: var(--muted);
}
</style>
