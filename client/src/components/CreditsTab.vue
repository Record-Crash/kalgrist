<script setup>
import { marked } from 'marked'
import creditsRaw from '../CREDITS.md?raw'

const html = marked.parse(creditsRaw)
</script>

<template>
  <div class="credits-content" v-html="html" />
</template>

<style scoped>
.credits-content {
  max-width: 600px;
  margin: 0 auto;
  color: var(--text);
  line-height: 1.7;
}

.credits-content :deep(h1) {
  font-family: "TYPOSTUCK", sans-serif;
  font-weight: 400;
  color: var(--accent);
  font-size: 1.8rem;
  margin-bottom: 24px;
}

.credits-content :deep(h2) {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--muted);
  margin: 24px 0 8px;
  font-weight: normal;
}

.credits-content :deep(ul) {
  list-style: none;
  padding: 0;
}

.credits-content :deep(li) {
  padding: 4px 0;
  font-size: 0.9rem;
}

.credits-content :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.credits-content :deep(a:hover) {
  color: var(--accent-hover);
  text-decoration: underline;
}

.credits-content :deep(strong) {
  color: var(--text);
}

.credits-content :deep(p) {
  font-size: 0.9rem;
  margin: 4px 0;
}
</style>
