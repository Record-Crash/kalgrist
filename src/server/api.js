import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import config from "../config.js";
import {  getClient, isBotInGuild  } from "../bot/client.js";
import { createMarket } from "../marketService.js";
import { sessions } from "./sessions.js";
import * as users from "../db/users.js";
import * as markets from "../db/markets.js";
import * as bets from "../db/bets.js";
import * as votes from "../db/votes.js";
import * as guildSettings from "../db/guild_settings.js";
import { buyShares, sellShares, getPrice, applyBuy, applySell } from "../db/amm.js";
import { pool as dbPool } from "../db/pool.js";
import * as modLog from "../db/mod_log.js";

function logMod(req, action, detail) {
  modLog.insert(req.guildId, req.discordId, action, detail).catch(err =>
    console.error('[mod-log] failed to write:', err.message)
  );
}

const router = express.Router();
router.use(express.json());

// ── API-Sports proxy (no auth required — key lives server-side) ──────────────

// Simple in-memory cache: key → { data, expiresAt }
const proxyCache = new Map();

const WIDGET_CDN = 'https://widgets.api-sports.io/3.1.0';
// Browser-visible prefix (full path) used in rewritten JS
const WIDGET_ASSET_BROWSER = '/api/sports-widget-assets';
// Router-relative prefix (router is mounted at /api)
const WIDGET_ASSET_ROUTE = '/sports-widget-assets';

// Rewrite all CDN references so sub-modules also go through our proxy
// Also strip Google Fonts injection which Discord's CSP blocks and may crash the init chain
function rewriteWidgetUrls(text) {
  return text
    .replaceAll(WIDGET_CDN + '/', WIDGET_ASSET_BROWSER + '/')
    .replaceAll('fonts.googleapis.com', 'localhost/__blocked_font__');
}

// Entry point: widgets.js with internal URLs rewritten
router.get('/sports-widget.js', async (req, res) => {
  const cached = proxyCache.get('widget.js');
  if (cached && cached.expiresAt > Date.now()) {
    res.set('Content-Type', 'application/javascript');
    return res.send(cached.data);
  }
  try {
    const response = await fetch(`${WIDGET_CDN}/widgets.js`);
    const text = rewriteWidgetUrls(await response.text());
    proxyCache.set('widget.js', { data: text, expiresAt: Date.now() + 3_600_000 });
    res.set('Content-Type', 'application/javascript');
    res.send(text);
  } catch (err) {
    res.status(502).send(`console.error('[widget] failed to load: ${err.message}')`);
  }
});

// Sub-modules and assets (chunks, CSS, etc.) — also rewrite any nested CDN refs
router.get(`${WIDGET_ASSET_ROUTE}/*`, async (req, res) => {
  const assetPath = req.path.slice(WIDGET_ASSET_ROUTE.length);
  const cacheKey = `asset:${assetPath}`;
  const cached = proxyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.set('Content-Type', cached.contentType);
    return res.send(cached.data);
  }
  try {
    const response = await fetch(`${WIDGET_CDN}${assetPath}`);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const text = rewriteWidgetUrls(await response.text());
    proxyCache.set(cacheKey, { data: text, contentType, expiresAt: Date.now() + 3_600_000 });
    res.set('Content-Type', contentType);
    res.send(text);
  } catch (err) {
    res.status(502).send(`/* failed: ${err.message} */`);
  }
});

// Proxy media.api-sports.io images with 24-hour cache
router.get('/sports-media/*', async (req, res) => {
  const imagePath = req.path.slice('/sports-media'.length);
  const cacheKey = `media:${imagePath}`;
  const cached = proxyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(cached.data);
  }
  try {
    const response = await fetch(`https://media.api-sports.io${imagePath}`);
    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    proxyCache.set(cacheKey, { data: buffer, contentType, expiresAt: Date.now() + 86_400_000 });
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(502).end();
  }
});

// Proxy API-Sports APIs with 60-second cache — sport-specific base URLs
const SPORT_BASE_URLS = {
  football:   'https://v3.football.api-sports.io',
  baseball:   'https://v1.baseball.api-sports.io',
  basketball: 'https://v1.basketball.api-sports.io',
  handball:   'https://v1.handball.api-sports.io',
  hockey:     'https://v1.hockey.api-sports.io',
  volleyball: 'https://v1.volleyball.api-sports.io',
  rugby:      'https://v1.rugby.api-sports.io',
  afl:        'https://v1.afl.api-sports.io',
  nfl:        'https://v1.american-football.api-sports.io',
  nba:        'https://v2.nba.api-sports.io',
};

async function proxySports(sport, path, query, res) {
  const baseUrl = SPORT_BASE_URLS[sport];
  if (!baseUrl) return res.status(400).json({ error: `Unknown sport: ${sport}` });
  const qs = new URLSearchParams(query).toString();
  const apiUrl = `${baseUrl}${path}${qs ? '?' + qs : ''}`;
  console.log('[sports-proxy] →', apiUrl);
  const cacheKey = `${sport}:${path}?${qs}`;
  const cached = proxyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[sports-proxy] cache hit');
    return res.json(cached.data);
  }
  try {
    const response = await fetch(apiUrl, {
      headers: { 'x-apisports-key': config.apiSports.widgetKey },
    });
    const data = await response.json();
    console.log('[sports-proxy] response status:', response.status, '| errors:', data.errors);
    proxyCache.set(cacheKey, { data, expiresAt: Date.now() + 60_000 });
    res.json(data);
  } catch (err) {
    console.error('[sports-proxy] error:', err.message);
    res.status(502).json({ error: err.message });
  }
}

// Sport-specific proxy: /sports-proxy/:sport/...
router.use('/sports-proxy/:sport', (req, res) => {
  proxySports(req.params.sport, req.path, req.query, res);
});

// Legacy catch-all (widget uses data-url-football pointing here) — defaults to football
router.use('/sports-proxy', (req, res) => {
  proxySports('football', req.path, req.query, res);
});

async function isUserMod(discordId, guildId) {
  try {
    const client = getClient();
    const guild = client?.guilds?.cache?.get(guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(discordId);
    const settings = await guildSettings.getSettings(guildId);
    const hasModRole = settings?.mod_role_id && member.roles.cache.has(settings.mod_role_id);
    const hasManageGuild = member.permissions.has('ManageGuild');
    return !!(hasModRole || hasManageGuild);
  } catch {
    return false;
  }
}

router.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing session token' });
  }

  const session = sessions.get(auth.slice(7));
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const { discordId, username, guildId } = session;
  if (!guildId) {
    return res.status(400).json({ error: 'No guild associated with session' });
  }
  if (!config.discord.allowedGuilds.includes(guildId)) {
    return res.status(403).json({ error: 'This server is not enabled for the prediction market' });
  }
  if (!isBotInGuild(guildId)) {
    return res.status(403).json({ error: 'The bot must be added to this server first' });
  }
  req.discordId = discordId;
  req.discordUsername = username;
  req.guildId = guildId;
  next();
});

// Widget config — proxy URLs only, key never leaves the server
router.get('/widget-config', (req, res) => {
  res.json({ apiSportsKey: 'proxied' });
});

// Get current user balance
router.get('/me', async (req, res) => {
  try {
    // Fetch guild nickname from Discord bot cache
    let nickname = null;
    try {
      const botClient = getClient();
      const guild = botClient?.guilds?.cache?.get(req.guildId);
      if (guild) {
        const member = await guild.members.fetch(req.discordId);
        nickname = member?.nickname ?? null;
      }
    } catch {}

    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername, null, nickname);
    const userBets = await bets.getByUser(user.id);

    // Compute potential payouts for parimutuel bets
    const marketIds = [...new Set(userBets.map(b => b.market_id))];
    const poolMap = {};
    if (marketIds.length > 0) {
      await Promise.all(marketIds.map(async (mid) => {
        const [{ rows: optPools }, { rows: totals }] = await Promise.all([
          dbPool.query('SELECT option_id, COALESCE(SUM(amount),0) AS opt_total FROM bets WHERE market_id=$1 GROUP BY option_id', [mid]),
          dbPool.query('SELECT COALESCE(SUM(amount),0) AS total FROM bets WHERE market_id=$1', [mid]),
        ]);
        poolMap[mid] = {
          total: parseFloat(totals[0].total),
          byOption: Object.fromEntries(optPools.map(r => [r.option_id, parseFloat(r.opt_total)])),
        };
      }));
    }
    const betsWithPayout = userBets.map(b => {
      const pd = poolMap[b.market_id];
      const optPool = pd?.byOption?.[b.option_id] ?? 0;
      if (!pd || optPool === 0) return { ...b, potential_payout: parseFloat(b.amount) };
      return {
        ...b,
        potential_payout: Math.round((parseFloat(b.amount) / optPool) * pd.total * 100) / 100,
      };
    });

    const [posResult, statsResult, pendingResult, tagResult, winRateResult, isMod, settings] = await Promise.all([
      dbPool.query(
        `SELECT p.market_id, p.option_id, p.shares, m.title, mo.label AS option_label, m.status,
          COALESCE(
            SUM(CASE WHEN t.side='buy' THEN t.cost ELSE 0 END) -
            SUM(CASE WHEN t.side='sell' THEN t.cost ELSE 0 END),
          0) AS net_cost
         FROM positions p
         JOIN markets m ON m.id = p.market_id
         JOIN market_options mo ON mo.id = p.option_id
         LEFT JOIN trades t ON t.user_id=p.user_id AND t.market_id=p.market_id AND t.option_id=p.option_id
         WHERE p.user_id=$1 AND p.shares > 0
         GROUP BY p.market_id, p.option_id, p.shares, m.title, mo.label, m.status, m.created_at
         ORDER BY m.created_at DESC`,
        [user.id]
      ),
      dbPool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN reason IN ('bet_place','trade_buy') THEN ABS(amount) ELSE 0 END), 0) AS total_wagered,
           COALESCE(SUM(CASE WHEN reason IN ('bet_payout','trade_sell') THEN amount ELSE 0 END), 0) AS total_won,
           COALESCE(SUM(CASE WHEN reason='bet_payout' THEN amount ELSE 0 END), 0) AS total_won_resolves
         FROM currency_log WHERE user_id=$1`,
        [user.id]
      ),
      dbPool.query(
        `SELECT COALESCE(
           SUM(CASE WHEN cl.reason IN ('bet_place','trade_buy') THEN ABS(cl.amount)
                    WHEN cl.reason='trade_sell' THEN -cl.amount ELSE 0 END), 0
         ) AS pending_wagered
         FROM currency_log cl
         JOIN markets m ON m.id::TEXT = cl.ref_id
         WHERE cl.user_id=$1 AND m.status='open'`,
        [user.id]
      ),
      dbPool.query(
        `SELECT COALESCE(NULLIF(m.tags[1], ''), 'untagged') AS tag,
                SUM(ABS(cl.amount)) AS wagered
         FROM currency_log cl
         JOIN markets m ON m.id::TEXT = cl.ref_id
         WHERE cl.user_id=$1 AND cl.reason IN ('bet_place','trade_buy')
         GROUP BY tag
         ORDER BY wagered DESC`,
        [user.id]
      ),
      dbPool.query(
        `WITH participated AS (
           SELECT DISTINCT b.market_id FROM bets b JOIN markets m ON m.id=b.market_id WHERE b.user_id=$1 AND m.status='resolved'
           UNION
           SELECT DISTINCT t.market_id FROM trades t JOIN markets m ON m.id=t.market_id WHERE t.user_id=$1 AND m.status='resolved'
         ),
         won AS (
           SELECT DISTINCT m.id AS market_id
           FROM currency_log cl JOIN markets m ON m.id::TEXT=cl.ref_id
           WHERE cl.user_id=$1 AND cl.reason='bet_payout' AND m.status='resolved'
         )
         SELECT
           (SELECT COUNT(*) FROM participated) AS markets_participated,
           (SELECT COUNT(*) FROM won w WHERE EXISTS(SELECT 1 FROM participated p WHERE p.market_id=w.market_id)) AS markets_won`,
        [user.id]
      ),
      isUserMod(req.discordId, req.guildId),
      guildSettings.getSettings(req.guildId),
    ]);

    const sr = statsResult.rows[0];
    const wr = winRateResult.rows[0];
    const totalWon = parseFloat(sr.total_won);
    const totalWagered = parseFloat(sr.total_wagered);
    const pendingWagered = parseFloat(pendingResult.rows[0].pending_wagered);
    const stats = {
      total_wagered: totalWagered,
      total_won: totalWon,
      total_won_resolves: parseFloat(sr.total_won_resolves),
      pending_wagered: pendingWagered,
      net_profit: totalWon - totalWagered,
      markets_participated: parseInt(wr.markets_participated, 10),
      markets_won: parseInt(wr.markets_won, 10),
      tag_breakdown: tagResult.rows.map(r => ({ tag: r.tag, wagered: parseFloat(r.wagered) })),
    };

    res.json({
      balance: user.balance,
      bets: betsWithPayout,
      positions: posResult.rows,
      isMod,
      marketEnabled: settings?.market_enabled ?? false,
      featuredTags: settings?.featured_tags ?? [],
      stats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function attachMarketData(m) {
  if (m.market_type === 'cpmm') {
    const [poolRes, statsRes] = await Promise.all([
      dbPool.query(
        `SELECT ap.option_id, ap.shares
         FROM amm_pools ap
         JOIN market_options mo ON mo.id = ap.option_id
         WHERE ap.market_id = $1
         ORDER BY mo.position`,
        [m.id]
      ),
      dbPool.query(
        `SELECT COALESCE(SUM(cost), 0) AS total_grist, COUNT(DISTINCT user_id) AS participant_count
         FROM trades WHERE market_id = $1 AND side = 'buy'`,
        [m.id]
      ),
    ]);
    const poolArr = poolRes.rows.map(r => parseFloat(r.shares));
    const pool = poolRes.rows.map((r, i) => ({
      option_id: r.option_id,
      price: poolArr.length > 1 ? getPrice(poolArr, i) : 0,
      percentage: poolArr.length > 1 ? Math.round(getPrice(poolArr, i) * 100) : 0,
      poolShares: r.shares,
    }));
    return {
      ...m,
      pool,
      total_grist: parseFloat(statsRes.rows[0].total_grist),
      participant_count: parseInt(statsRes.rows[0].participant_count, 10),
    };
  }
  const [poolData, statsRes] = await Promise.all([
    markets.getPoolByOption(m.id),
    dbPool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_grist, COUNT(DISTINCT user_id) AS participant_count
       FROM bets WHERE market_id = $1`,
      [m.id]
    ),
  ]);
  return {
    ...m,
    pool: poolData,
    total_grist: parseFloat(statsRes.rows[0].total_grist),
    participant_count: parseInt(statsRes.rows[0].participant_count, 10),
  };
}

// List open markets (with pool data); mods see hidden markets too
router.get('/markets', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    const list = await markets.listOpen(req.guildId, mod);
    const withPool = await Promise.all(list.map(attachMarketData));
    res.json(withPool);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List resolved/cancelled markets (history)
router.get('/markets-history', async (req, res) => {
  try {
    const list = await markets.listResolved(req.guildId);
    const withPool = await Promise.all(list.map(attachMarketData));
    res.json(withPool);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Icon gallery — all distinct icon URLs used in this guild (mod only)
// Must be declared before /markets/:id to avoid Express treating 'icon-gallery' as an id param
router.get('/markets/icon-gallery', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can view icon gallery' });
    const urls = await markets.getIconGallery(req.guildId);
    res.json(urls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get market details
router.get('/markets/:id', async (req, res) => {
  try {
    const market = await markets.getById(parseInt(req.params.id, 10));
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Not found' });
    res.json(await attachMarketData(market));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create market
router.post('/markets', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can create markets' });
    const { title, description, resolutionMethod, closesAt, options, tags } = req.body;
    if (!title || !options || options.length < 2) {
      return res.status(400).json({ error: 'Title and at least 2 options required' });
    }
    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
    const parsedTags = Array.isArray(tags) ? tags.map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    const market = await createMarket(
      req.guildId, user.id, title, description || null,
      resolutionMethod || 'creator', closesAt || null, options, parsedTags
    );
    logMod(req, 'create_market', `Created market #${market.id} "${title}"`);
    res.status(201).json(market);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Market bet/trade history (for graph)
router.get('/markets/:id/history', async (req, res) => {
  try {
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Not found' });

    const optionIds = market.options.map(o => o.id);
    const points = [];

    if (market.market_type === 'cpmm') {
      const { rows } = await dbPool.query(
        `SELECT option_id, side, shares, cost, created_at
         FROM trades WHERE market_id = $1 ORDER BY created_at ASC`,
        [marketId]
      );
      // Replay pool from initial state to get all option prices after every trade
      let poolArr = Array(optionIds.length).fill(100);
      for (const trade of rows) {
        const optionIndex = optionIds.indexOf(trade.option_id);
        if (trade.side === 'buy') {
          poolArr = applyBuy(poolArr, optionIndex, parseFloat(trade.cost)).newPool;
        } else {
          poolArr = applySell(poolArr, optionIndex, parseFloat(trade.shares)).newPool;
        }
        const pcts = {};
        for (let i = 0; i < optionIds.length; i++) {
          pcts[optionIds[i]] = Math.round(getPrice(poolArr, i) * 100);
        }
        points.push({ t: trade.created_at, pcts });
      }
    } else {
      const betHistory = await bets.getHistory(marketId);
      const running = {};
      for (const id of optionIds) running[id] = 0;
      for (const bet of betHistory) {
        running[bet.option_id] = (running[bet.option_id] || 0) + parseFloat(bet.amount);
        const total = Object.values(running).reduce((s, v) => s + v, 0);
        const pcts = {};
        for (const id of optionIds) {
          pcts[id] = total > 0 ? Math.round((running[id] / total) * 100) : 0;
        }
        points.push({ t: bet.created_at, pcts });
      }
    }

    res.json({ optionIds, points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user's positions for a market
router.get('/markets/:id/positions', async (req, res) => {
  try {
    const market = await markets.getById(parseInt(req.params.id, 10));
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Not found' });
    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
    const { rows } = await dbPool.query(
      `SELECT p.option_id, p.shares,
        COALESCE(
          SUM(CASE WHEN t.side = 'buy' THEN t.cost END) /
          NULLIF(SUM(CASE WHEN t.side = 'buy' THEN t.shares END), 0),
          0
        ) AS avg_cost_per_share
       FROM positions p
       LEFT JOIN trades t ON t.user_id = p.user_id AND t.market_id = p.market_id AND t.option_id = p.option_id
       WHERE p.user_id = $1 AND p.market_id = $2
       GROUP BY p.option_id, p.shares`,
      [user.id, parseInt(req.params.id, 10)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trade endpoint (CPMM buy/sell)
router.post('/markets/:id/trade', async (req, res) => {
  try {
    const { optionId, side, amount } = req.body;
    if (!optionId || !side || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid optionId, side (buy|sell), and positive amount required' });
    }
    if (side !== 'buy' && side !== 'sell') {
      return res.status(400).json({ error: 'side must be buy or sell' });
    }
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    if (market.status !== 'open') return res.status(400).json({ error: 'Market is not open' });
    if (market.closes_at && new Date(market.closes_at) < new Date()) {
      return res.status(400).json({ error: 'Betting has closed' });
    }
    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
    let result;
    if (side === 'buy') {
      result = await buyShares(user.id, marketId, optionId, parseFloat(amount));
    } else {
      result = await sellShares(user.id, marketId, optionId, parseFloat(amount));
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Place bet
router.post('/markets/:id/bets', async (req, res) => {
  try {
    const { optionId, amount } = req.body;
    if (!optionId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid optionId and positive amount required' });
    }
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    if (market.status !== 'open') return res.status(400).json({ error: 'Market is not open' });
    if (market.closes_at && new Date(market.closes_at) < new Date()) {
      return res.status(400).json({ error: 'Betting has closed' });
    }
    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
    const bet = await bets.placeBet(user.id, marketId, optionId, amount);
    res.status(201).json(bet);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Vote on resolution
router.post('/markets/:id/votes', async (req, res) => {
  try {
    const { optionId } = req.body;
    const market = await markets.getById(parseInt(req.params.id, 10));
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
    await votes.castVote(market.id, user.id, optionId);
    const tally = await votes.getTally(parseInt(req.params.id, 10));
    res.json({ tally });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Balance history for current user
router.get('/me/balance-history', async (req, res) => {
  try {
    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
    const { rows } = await dbPool.query(
      `SELECT cl.amount, cl.reason, cl.ref_id, cl.created_at, m.title AS market_title
       FROM currency_log cl
       LEFT JOIN markets m ON m.id = CAST(cl.ref_id AS BIGINT)
       WHERE cl.user_id = $1
       ORDER BY cl.created_at DESC
       LIMIT 50`,
      [user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recent payouts for current user (for login popup)
router.get('/me/recent-payouts', async (req, res) => {
  try {
    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
    // Use last_payout_notified_at as cutoff; fall back to 24h for users who haven't acknowledged yet
    const since = user.last_payout_notified_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { rows } = await dbPool.query(
      `SELECT cl.amount, cl.reason, cl.created_at, m.title
       FROM currency_log cl
       LEFT JOIN markets m ON m.id = CAST(cl.ref_id AS BIGINT)
       WHERE cl.user_id = $1 AND cl.reason IN ('bet_payout', 'bet_refund')
         AND cl.created_at > $2
       ORDER BY cl.created_at DESC
       LIMIT 5`,
      [user.id, since]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark payouts as seen (user dismissed popup or is actively online)
router.post('/me/acknowledge-payouts', async (req, res) => {
  try {
    const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
    await users.acknowledgePayouts(user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve market (mod or creator)
router.post('/markets/:id/resolve', async (req, res) => {
  try {
    const { optionId } = req.body;
    if (!optionId) return res.status(400).json({ error: 'optionId required' });

    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    if (market.status !== 'open' && market.status !== 'closed') {
      return res.status(400).json({ error: 'Market is already resolved or cancelled' });
    }

    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) {
      const user = await users.getOrCreate(req.discordId, req.guildId, req.discordUsername);
      if (market.creator_id !== user.id) {
        return res.status(403).json({ error: 'You do not have permission to resolve this market' });
      }
    }

    await markets.resolve(marketId, optionId);
    let payouts;
    if (market.market_type === 'cpmm') {
      payouts = await bets.payoutCpmm(marketId, optionId);
    } else {
      payouts = await bets.payoutWinners(marketId, optionId);
    }
    const winLabel = market.options.find(o => o.id === optionId)?.label ?? optionId;
    logMod(req, 'resolve_market', `Resolved #${marketId} "${market.title}" → "${winLabel}"`);
    res.json({ ok: true, payouts: payouts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add option to a market (mod only)
router.post('/markets/:id/options', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can add options' });

    const { label } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ error: 'Label required' });

    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    if (market.status !== 'open') return res.status(400).json({ error: 'Market is not open' });

    const option = await markets.addOption(marketId, label.trim());
    logMod(req, 'add_option', `Added option "${label.trim()}" to #${marketId} "${market.title}"`);
    res.status(201).json(option);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle market hidden status (mod only)
router.patch('/markets/:id/hidden', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can hide markets' });
    const { hidden } = req.body;
    if (typeof hidden !== 'boolean') return res.status(400).json({ error: 'hidden must be a boolean' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    await markets.setHidden(marketId, hidden);
    logMod(req, 'set_hidden', `${hidden ? 'Hid' : 'Unhid'} #${marketId} "${market.title}"`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update market end time (mod only)
router.patch('/markets/:id/closes-at', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can edit end time' });
    const { closesAt } = req.body;
    const date = closesAt ? new Date(closesAt) : null;
    if (closesAt && isNaN(date?.getTime())) return res.status(400).json({ error: 'Invalid date' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    await markets.setClosesAt(marketId, date);
    logMod(req, 'set_closes_at', `Set close time of #${marketId} "${market.title}" to ${date ? date.toISOString() : 'none'}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;
    const [lb, total] = await Promise.all([
      users.getLeaderboard(req.guildId, pageSize, offset),
      users.countLeaderboard(req.guildId),
    ]);
    res.json({ entries: lb, total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get guild settings (featured tags, etc.) — readable by all users
router.get('/guild-settings', async (req, res) => {
  try {
    const settings = await guildSettings.getSettings(req.guildId);
    res.json({ featuredTags: settings?.featured_tags ?? [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update featured tags (mod only)
router.patch('/guild-settings/featured-tags', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can configure tags' });
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
    await guildSettings.setFeaturedTags(req.guildId, tags.map(t => String(t).trim().toLowerCase()).filter(Boolean));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload icon from base64 (mod only) — decodes and saves to /uploads/
router.post('/upload/icon', express.json({ limit: '512kb' }), async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can upload icons' });

    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

    const match = imageBase64.match(/^data:(image\/[\w+]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: 'Invalid image data URL' });

    const [, mimeType, b64] = match;
    const ext = mimeType.split('/')[1].replace('jpeg', 'jpg').replace('+xml', '');
    const buffer = Buffer.from(b64, 'base64');

    const uploadsDir = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);

    res.json({ url: `/uploads/${filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set market icon URL (mod only)
router.patch('/markets/:id/icon', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can set market icons' });
    const { iconUrl } = req.body;
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    await markets.setIcon(marketId, iconUrl ?? null);
    logMod(req, 'set_icon', `${iconUrl ? 'Set' : 'Cleared'} icon of #${marketId} "${market.title}"`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reopen a resolved market (mod only)
router.post('/markets/:id/reopen', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can reopen markets' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    if (market.status !== 'resolved') return res.status(400).json({ error: 'Market is not resolved' });
    const rolled = await bets.rollbackPayouts(marketId);
    await markets.reopen(marketId);
    logMod(req, 'reopen_market', `Reopened #${marketId} "${market.title}" (rolled back ${rolled} payouts)`);
    res.json({ ok: true, rolled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set market fixture ID (mod only)
router.patch('/markets/:id/fixture', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can set market fixtures' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    const fixtureId = req.body.fixtureId ? parseInt(req.body.fixtureId, 10) : null;
    const sport = req.body.sport || 'football';
    await markets.setFixtureId(marketId, fixtureId, sport);
    logMod(req, 'set_fixture', fixtureId
      ? `Linked #${marketId} "${market.title}" to fixture ${fixtureId} (${sport})`
      : `Unlinked fixture from #${marketId} "${market.title}"`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update market tags (mod only)
router.patch('/markets/:id/tags', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can update tags' });
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    const cleaned = tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
    await markets.updateTags(marketId, cleaned);
    logMod(req, 'update_tags', `Updated tags of #${marketId} "${market.title}" to [${cleaned.join(', ')}]`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List ALL markets for mods (all statuses)
router.get('/mod/markets', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can list all markets' });
    const list = await markets.listAll(req.guildId);
    const withPool = await Promise.all(list.map(attachMarketData));
    res.json(withPool);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get position breakdown per option for a market (mod only; admin sees per-user breakdown)
// Shows grist invested + implied probability (from pool), not raw shares (which are misleading in CPMM)
router.get('/mod/markets/:id/shares', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can view shares' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });

    const isAdmin = !!(process.env.ADMIN_DISCORD_ID && req.discordId === process.env.ADMIN_DISCORD_ID);

    // Fetch pool shares to compute implied probabilities
    const { rows: poolRows } = await dbPool.query(
      `SELECT ap.option_id, ap.shares AS pool_shares
       FROM amm_pools ap
       JOIN market_options mo ON mo.id = ap.option_id
       WHERE ap.market_id = $1
       ORDER BY mo.position`,
      [marketId]
    );
    const poolMap = {};
    if (poolRows.length > 1) {
      const invSum = poolRows.reduce((s, r) => s + 1 / parseFloat(r.pool_shares), 0);
      for (const r of poolRows) {
        poolMap[r.option_id] = Math.round((1 / parseFloat(r.pool_shares)) / invSum * 100);
      }
    }

    // Fetch net grist + total held shares per option — LEFT JOIN so options with zero trades still appear
    const { rows: gristRows } = await dbPool.query(
      `SELECT mo.id AS option_id, mo.label AS option_label,
              COALESCE(SUM(CASE WHEN t.side = 'buy'  THEN t.cost ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN t.side = 'sell' THEN t.cost ELSE 0 END), 0) AS net_grist,
              COALESCE((SELECT SUM(p.shares) FROM positions p WHERE p.market_id = $1 AND p.option_id = mo.id), 0) AS total_shares,
              COUNT(DISTINCT t.user_id) FILTER (WHERE t.side = 'buy') AS buyer_count
       FROM market_options mo
       LEFT JOIN trades t ON t.option_id = mo.id AND t.market_id = $1
       WHERE mo.market_id = $1
       GROUP BY mo.id, mo.label
       ORDER BY mo.label`,
      [marketId]
    );

    // Build base options list (merge grist data + probability)
    const baseOptions = gristRows.map(r => ({
      option_id: r.option_id,
      option_label: r.option_label,
      net_grist: Math.round(parseFloat(r.net_grist)),
      total_shares: parseFloat(parseFloat(r.total_shares).toFixed(2)),
      buyer_count: parseInt(r.buyer_count),
      probability: poolMap[r.option_id] ?? null,
    }));

    if (!isAdmin) {
      return res.json({ isAdmin: false, options: baseOptions });
    }

    // Admin: also fetch per-user grist invested
    const { rows: userRows } = await dbPool.query(
      `SELECT t.option_id,
              u.discord_id, COALESCE(u.nickname, u.username) AS display_name,
              COALESCE(SUM(CASE WHEN t.side = 'buy'  THEN t.cost ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN t.side = 'sell' THEN t.cost ELSE 0 END), 0) AS net_grist,
              p.shares
       FROM trades t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN positions p ON p.user_id = t.user_id AND p.market_id = t.market_id AND p.option_id = t.option_id
       WHERE t.market_id = $1
       GROUP BY t.option_id, u.discord_id, u.nickname, u.username, p.shares
       HAVING COALESCE(p.shares, 0) > 0
       ORDER BY t.option_id, net_grist DESC`,
      [marketId]
    );

    const holdersByOption = {};
    for (const r of userRows) {
      if (!holdersByOption[r.option_id]) holdersByOption[r.option_id] = [];
      holdersByOption[r.option_id].push({
        discord_id: r.discord_id,
        display_name: r.display_name,
        net_grist: Math.round(parseFloat(r.net_grist)),
        shares: parseFloat(r.shares),
      });
    }

    const adminOptions = baseOptions.map(o => ({ ...o, holders: holdersByOption[o.option_id] ?? [] }));
    res.json({ isAdmin: true, options: adminOptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update market title (mod only)
router.patch('/markets/:id/title', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can update market title' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    logMod(req, 'update_title', `Renamed #${marketId} from "${market.title}" to "${title.trim()}"`);
    await markets.updateTitle(marketId, title.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update market description (mod only)
router.patch('/markets/:id/description', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can update market description' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    await markets.updateDescription(marketId, req.body.description ?? null);
    logMod(req, 'update_description', `Updated description of #${marketId} "${market.title}"`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update an option label (mod only)
router.patch('/markets/:id/options/:optionId/label', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can update option labels' });
    const marketId = parseInt(req.params.id, 10);
    const market = await markets.getById(marketId);
    if (!market || market.guild_id !== req.guildId) return res.status(404).json({ error: 'Market not found' });
    const optionId = parseInt(req.params.optionId, 10);
    if (!market.options.find(o => o.id === optionId)) return res.status(404).json({ error: 'Option not found' });
    const { label } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: 'Label is required' });
    const oldLabel = market.options.find(o => o.id === optionId)?.label ?? optionId;
    await markets.updateOptionLabel(optionId, label.trim());
    logMod(req, 'update_option_label', `Renamed option "${oldLabel}" → "${label.trim()}" on #${marketId} "${market.title}"`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mod action log (mod only)
router.get('/mod/log', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can view the log' });
    const entries = await modLog.list(req.guildId);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List users for give-grist (mod only)
router.get('/mod/users', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can list users' });
    const { rows } = await dbPool.query(
      `SELECT discord_id, username, nickname, balance
       FROM users WHERE guild_id = $1 AND hidden = false
       ORDER BY balance DESC LIMIT 200`,
      [req.guildId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Give grist to a user (mod only)
router.post('/mod/give-grist', async (req, res) => {
  try {
    const mod = await isUserMod(req.discordId, req.guildId);
    if (!mod) return res.status(403).json({ error: 'Only moderators can give grist' });
    const { discordId, amount } = req.body;
    if (!discordId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'discordId and positive amount required' });
    }
    const user = await users.getOrCreate(discordId, req.guildId);
    await users.addBalance(user.id, parseFloat(amount), 'mod_give', req.discordId);
    const displayName = user.nickname || user.username || discordId;
    logMod(req, 'give_grist', `Gave ${amount} grist to ${displayName}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
