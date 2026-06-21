import { ref, readonly } from 'vue'

const user = ref(null)    // { id, username }
const guild = ref(null)   // { id }
const ready = ref(false)
const error = ref(null)
const sessionToken = ref(null)

let discordSdk = null

async function initAuth() {
  let isDiscordEmbed = false
  try {
    isDiscordEmbed = window.self !== window.top
  } catch {
    isDiscordEmbed = true // cross-origin means we're in an iframe
  }
  console.log('[auth] isDiscordEmbed:', isDiscordEmbed)

  if (!isDiscordEmbed) {
    error.value = 'This app only works inside Discord. Launch it from a voice or text channel activity.'
    ready.value = true
    return
  }

  try {
    console.log('[auth] importing @discord/embedded-app-sdk...')
    const { DiscordSDK } = await import('@discord/embedded-app-sdk')
    console.log('[auth] SDK imported successfully')
    const clientId = document.querySelector('meta[name="discord-client-id"]')?.content || ''
    console.log('[auth] clientId:', clientId)
    discordSdk = new DiscordSDK(clientId)
    await discordSdk.ready()
    console.log('[auth] SDK ready')

    const { code } = await discordSdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify', 'guilds'],
    })

    const tokenRes = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, guildId: discordSdk.guildId }),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`)
    }

    const tokenData = await tokenRes.json()

    if (!tokenData.access_token) {
      throw new Error(tokenData.error || 'Token exchange failed')
    }

    const authResult = await discordSdk.commands.authenticate({
      access_token: tokenData.access_token,
    })

    sessionToken.value = tokenData.session_token
    user.value = { id: authResult.user.id, username: authResult.user.username }
    guild.value = { id: discordSdk.guildId }
  } catch (err) {
    console.error('[auth] Discord auth failed:', err)
    console.error('[auth] Error name:', err.name, 'message:', err.message)
    console.error('[auth] Stack:', err.stack)
    error.value = err.message || 'Authentication failed'
  }

  ready.value = true
}

export function useAuth() {
  return {
    user: readonly(user),
    guild: readonly(guild),
    ready: readonly(ready),
    error: readonly(error),
    sessionToken: readonly(sessionToken),
    initAuth,
  }
}
