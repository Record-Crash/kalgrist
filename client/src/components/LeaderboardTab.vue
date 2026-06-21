<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import GristIcon from './GristIcon.vue'

const { getLeaderboard } = useApi()

const entries = ref([])
const loading = ref(true)
const error = ref(null)
const page = ref(1)
const totalPages = ref(1)

async function load(p = 1) {
  loading.value = true
  error.value = null
  try {
    const data = await getLeaderboard(p)
    entries.value = data.entries
    page.value = data.page
    totalPages.value = Math.ceil(data.total / data.pageSize)
  } catch (err) {
    error.value = err.message
  }
  loading.value = false
}

onMounted(() => load(1))
</script>

<template>
  <div>
    <div v-if="loading" class="empty-state">Loading...</div>
    <div v-else-if="error" class="empty-state">{{ error }}</div>
    <div v-else-if="entries.length === 0" class="empty-state">No users yet.</div>
    <div v-else class="leaderboard">
      <div
        v-for="(entry, i) in entries"
        :key="entry.discord_id"
        class="lb-row pixel-corners"
      >
        <span class="lb-rank">#{{ (page - 1) * 20 + i + 1 }}</span>
        <img
          v-if="entry.avatar_url"
          :src="entry.avatar_url"
          class="lb-avatar"
          alt=""
        />
        <span class="lb-name">{{ entry.nickname || entry.username || entry.discord_id }}</span>
        <span class="lb-balance">{{ entry.balance }} <GristIcon /></span>
      </div>
      <div v-if="totalPages > 1" class="lb-pagination">
        <button class="lb-page-btn" :disabled="page <= 1" @click="load(page - 1)">‹</button>
        <span class="lb-page-info">{{ page }} / {{ totalPages }}</span>
        <button class="lb-page-btn" :disabled="page >= totalPages" @click="load(page + 1)">›</button>
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

.leaderboard {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  padding: 10px 14px;
}

.lb-rank {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent);
  min-width: 30px;
}

.lb-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

.lb-name {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 600;
}

.lb-balance {
  font-size: 0.85rem;
  color: var(--muted);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 2px;
}

.lb-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 0 4px;
}

.lb-page-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 4px 10px;
  font-size: 1rem;
  cursor: pointer;
  font-family: inherit;
}
.lb-page-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.lb-page-btn:not(:disabled):hover {
  border-color: var(--accent);
}

.lb-page-info {
  font-size: 0.8rem;
  color: var(--muted);
}
</style>
