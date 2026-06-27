import { createApp } from 'vue'
import App from './App.vue'
import { useAuth } from './composables/useAuth'

// Cache bust: if the server has a newer build, hard reload to get fresh assets.
// Retries every 5s until the server is reachable (handles cold starts / restarts).
// Cache-bust: if the server has a newer build, reload ONCE to fetch fresh assets.
// Never block the UI or loop forever — a failed or stale check must still mount the
// app, otherwise any proxy/network hiccup leaves a blank white screen with no error.
async function checkVersion() {
  if (import.meta.env.DEV) return 'mount'
  try {
    const res = await fetch('/api/version')
    if (!res.ok) return 'mount'
    const { buildId } = await res.json()
    const upToDate = !buildId || typeof __BUILD_ID__ === 'undefined' || buildId === __BUILD_ID__
    if (upToDate) {
      sessionStorage.removeItem('kalgrist_reloaded')
      return 'mount'
    }
    // Stale assets: reload once. Guard with sessionStorage so Discord serving a
    // cached bundle can't trap us in an infinite reload loop.
    if (!sessionStorage.getItem('kalgrist_reloaded')) {
      sessionStorage.setItem('kalgrist_reloaded', '1')
      location.reload()
      return 'reloading'
    }
  } catch { /* network/proxy issue — fall through and mount so the real state shows */ }
  return 'mount'
}

checkVersion().then((status) => {
  if (status === 'reloading') return
  const app = createApp(App)
  app.mount('#app')

  const { initAuth } = useAuth()
  initAuth()
})
