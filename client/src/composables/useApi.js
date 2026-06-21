import { useAuth } from './useAuth'

const API = '/api'

function authHeaders() {
  const { sessionToken } = useAuth()
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${sessionToken.value || ''}`,
  }
}

export async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...opts.headers },
  })
  const data = await res.json()
  if (res.status === 401) {
    window.location.reload()
    return
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export function useApi() {
  return {
    getMe: () => apiFetch('/me'),
    getMarkets: () => apiFetch('/markets'),
    getMarketsHistory: () => apiFetch('/markets-history'),
    getMarket: (id) => apiFetch(`/markets/${id}`),
    getMarketHistory: (id) => apiFetch(`/markets/${id}/history`),
    createMarket: (body) => apiFetch('/markets', { method: 'POST', body: JSON.stringify(body) }),
    placeBet: (marketId, optionId, amount) =>
      apiFetch(`/markets/${marketId}/bets`, { method: 'POST', body: JSON.stringify({ optionId, amount }) }),
    trade: (marketId, optionId, side, amount) =>
      apiFetch(`/markets/${marketId}/trade`, { method: 'POST', body: JSON.stringify({ optionId, side, amount }) }),
    getPositions: (marketId) => apiFetch(`/markets/${marketId}/positions`),
    castVote: (marketId, optionId) =>
      apiFetch(`/markets/${marketId}/votes`, { method: 'POST', body: JSON.stringify({ optionId }) }),
    resolveMarket: (marketId, optionId) =>
      apiFetch(`/markets/${marketId}/resolve`, { method: 'POST', body: JSON.stringify({ optionId }) }),
    addOption: (marketId, label) =>
      apiFetch(`/markets/${marketId}/options`, { method: 'POST', body: JSON.stringify({ label }) }),
    getRecentPayouts: () => apiFetch('/me/recent-payouts'),
    acknowledgePayouts: () => apiFetch('/me/acknowledge-payouts', { method: 'POST' }),
    getBalanceHistory: () => apiFetch('/me/balance-history'),
    getLeaderboard: (page = 1) => apiFetch(`/leaderboard?page=${page}`),
    toggleHidden: (marketId, hidden) =>
      apiFetch(`/markets/${marketId}/hidden`, { method: 'PATCH', body: JSON.stringify({ hidden }) }),
    updateClosesAt: (marketId, closesAt) =>
      apiFetch(`/markets/${marketId}/closes-at`, { method: 'PATCH', body: JSON.stringify({ closesAt }) }),
    setMarketIcon: (marketId, iconUrl) =>
      apiFetch(`/markets/${marketId}/icon`, { method: 'PATCH', body: JSON.stringify({ iconUrl }) }),
    reopenMarket: (marketId) =>
      apiFetch(`/markets/${marketId}/reopen`, { method: 'POST' }),
    updateMarketTags: (marketId, tags) =>
      apiFetch(`/markets/${marketId}/tags`, { method: 'PATCH', body: JSON.stringify({ tags }) }),
    getIconGallery: () => apiFetch('/markets/icon-gallery'),
    uploadIcon: (imageBase64) =>
      apiFetch('/upload/icon', { method: 'POST', body: JSON.stringify({ imageBase64 }) }),
    setFeaturedTags: (tags) =>
      apiFetch('/guild-settings/featured-tags', { method: 'PATCH', body: JSON.stringify({ tags }) }),
    getModMarkets: () => apiFetch('/mod/markets'),
    getMarketShares: (marketId) => apiFetch(`/mod/markets/${marketId}/shares`),
    getModLog: () => apiFetch('/mod/log'),
    getModUsers: () => apiFetch('/mod/users'),
    updateMarketTitle: (marketId, title) =>
      apiFetch(`/markets/${marketId}/title`, { method: 'PATCH', body: JSON.stringify({ title }) }),
    updateMarketDescription: (marketId, description) =>
      apiFetch(`/markets/${marketId}/description`, { method: 'PATCH', body: JSON.stringify({ description }) }),
    updateOptionLabel: (marketId, optionId, label) =>
      apiFetch(`/markets/${marketId}/options/${optionId}/label`, { method: 'PATCH', body: JSON.stringify({ label }) }),
    giveGrist: (discordId, amount) =>
      apiFetch('/mod/give-grist', { method: 'POST', body: JSON.stringify({ discordId, amount }) }),
    getWidgetConfig: () => apiFetch('/widget-config'),
    setMarketFixture: (marketId, fixtureId, sport = 'football') =>
      apiFetch(`/markets/${marketId}/fixture`, { method: 'PATCH', body: JSON.stringify({ fixtureId, sport }) }),
    searchFixtures: (date, sport = 'football') => {
      const endpoint = sport === 'football' ? 'fixtures' : 'games'
      return apiFetch(`/sports-proxy/${sport}/${endpoint}?date=${date}`)
    },
  }
}
