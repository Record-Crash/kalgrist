<script setup>
import { ref } from 'vue'
import { useDragScroll } from '../composables/useDragScroll'

const props = defineProps({
  featuredTags: { type: Array, default: () => [] },
  activeTag: { type: String, default: null },
})
const emit = defineEmits(['change'])

const barEl = ref(null)
useDragScroll(barEl)
</script>

<template>
  <div ref="barEl" class="tag-bar">
    <button
      class="tag-btn"
      :class="{ active: activeTag === null }"
      @click="emit('change', null)"
    >All</button>
    <button
      v-for="tag in featuredTags"
      :key="tag"
      class="tag-btn"
      :class="{ active: activeTag === tag }"
      @click="emit('change', tag)"
    >{{ tag }}</button>
  </div>
</template>

<style scoped>
.tag-bar {
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
  cursor: grab;
}
.tag-bar::-webkit-scrollbar { display: none; }

.tag-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 3px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: color 0.1s, border-color 0.1s;
}
.tag-btn:hover {
  color: var(--text);
  border-color: var(--accent);
}
.tag-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(28, 179, 242, 0.08);
}
</style>
