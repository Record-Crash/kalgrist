import { createApp } from 'vue'
import App from './App.vue'
import { useAuth } from './composables/useAuth'

// Cache bust: if the server has a newer build, hard reload to get fresh assets.
// Retries every 5s until the server is reachable (handles cold starts / restarts).
async function checkVersion() {
  if (import.meta.env.DEV) return true
  while (true) {
    try {
      const res = await fetch('/api/version')
      if (res.ok) {
        const { buildId } = await res.json()
        if (buildId && typeof __BUILD_ID__ !== 'undefined' && buildId !== __BUILD_ID__) {
          location.reload()
          return false
        }
        return true
      }
    } catch {}
    await new Promise(r => setTimeout(r, 5000))
  }
}

checkVersion().then((current) => {
  if (!current) return // reloading
  const app = createApp(App)
  app.mount('#app')

  const { initAuth } = useAuth()
  initAuth()
})
