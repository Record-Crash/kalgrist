import { pool } from "./pool.js";

async function getSettings(guildId) {
  const { rows } = await pool.query(
    'SELECT * FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return rows[0] || null;
}

async function setModRole(guildId, modRoleId) {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, mod_role_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET mod_role_id = EXCLUDED.mod_role_id`,
    [guildId, modRoleId]
  );
}

async function getChannelMultiplier(guildId, channelId) {
  const { rows } = await pool.query(
    'SELECT multiplier FROM channel_multipliers WHERE guild_id = $1 AND channel_id = $2',
    [guildId, channelId]
  );
  return rows[0]?.multiplier ?? 1.0;
}

async function setChannelMultiplier(guildId, channelId, multiplier) {
  await pool.query(
    `INSERT INTO channel_multipliers (guild_id, channel_id, multiplier)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, channel_id) DO UPDATE SET multiplier = EXCLUDED.multiplier`,
    [guildId, channelId, multiplier]
  );
}

async function listChannelMultipliers(guildId) {
  const { rows } = await pool.query(
    'SELECT channel_id, multiplier FROM channel_multipliers WHERE guild_id = $1 ORDER BY multiplier DESC',
    [guildId]
  );
  return rows;
}

async function setMarketEnabled(guildId, enabled) {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, market_enabled)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET market_enabled = EXCLUDED.market_enabled`,
    [guildId, enabled]
  );
}

async function setMarketChannel(guildId, channelId) {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, market_channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET market_channel_id = EXCLUDED.market_channel_id`,
    [guildId, channelId]
  );
}

async function setLeaderboardChannels(guildId, channelIds) {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, leaderboard_channel_ids)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET leaderboard_channel_ids = EXCLUDED.leaderboard_channel_ids`,
    [guildId, channelIds]
  );
}

async function setFeaturedTags(guildId, tags) {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, featured_tags) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET featured_tags = EXCLUDED.featured_tags`,
    [guildId, tags]
  );
}

async function addExcludedChannel(guildId, channelId) {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, excluded_channel_ids)
     VALUES ($1, ARRAY[$2]::TEXT[])
     ON CONFLICT (guild_id) DO UPDATE
     SET excluded_channel_ids = array_append(
       array_remove(guild_settings.excluded_channel_ids, $2), $2
     )`,
    [guildId, channelId]
  );
}

async function removeExcludedChannel(guildId, channelId) {
  await pool.query(
    `UPDATE guild_settings SET excluded_channel_ids = array_remove(excluded_channel_ids, $2)
     WHERE guild_id = $1`,
    [guildId, channelId]
  );
}

async function setModlogChannel(guildId, channelId) {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, modlog_channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET modlog_channel_id = EXCLUDED.modlog_channel_id`,
    [guildId, channelId]
  );
}

export { getSettings, setModRole, getChannelMultiplier, setChannelMultiplier, listChannelMultipliers, setMarketEnabled, setMarketChannel, setLeaderboardChannels, setFeaturedTags, setModlogChannel, addExcludedChannel, removeExcludedChannel };
