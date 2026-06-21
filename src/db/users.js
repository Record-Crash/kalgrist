import { pool } from "./pool.js";

async function getOrCreate(discordId, guildId, username = null, avatarUrl = null, nickname = null) {
  const { rows } = await pool.query(
    `INSERT INTO users (discord_id, guild_id, username, avatar_url, nickname)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_id, guild_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, users.username),
       avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
       nickname = COALESCE(EXCLUDED.nickname, users.nickname)
     RETURNING *`,
    [discordId, guildId, username, avatarUrl, nickname]
  );
  return rows[0];
}

async function addBalance(userId, amount, reason, refId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2',
      [amount, userId]
    );
    await client.query(
      'INSERT INTO currency_log (user_id, amount, reason, ref_id) VALUES ($1, $2, $3, $4)',
      [userId, amount, reason, refId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getBalance(discordId, guildId) {
  const { rows } = await pool.query(
    'SELECT balance FROM users WHERE discord_id = $1 AND guild_id = $2',
    [discordId, guildId]
  );
  return rows[0]?.balance ?? 0;
}

async function getLeaderboard(guildId, limit = 10, offset = 0) {
  const { rows } = await pool.query(
    'SELECT discord_id, username, nickname, avatar_url, balance FROM users WHERE guild_id = $1 AND hidden = false ORDER BY balance DESC LIMIT $2 OFFSET $3',
    [guildId, limit, offset]
  );
  return rows;
}

async function countLeaderboard(guildId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) AS total FROM users WHERE guild_id = $1 AND hidden = false',
    [guildId]
  );
  return parseInt(rows[0].total, 10);
}

async function setHidden(discordId, guildId, hidden) {
  await pool.query(
    'UPDATE users SET hidden = $1 WHERE discord_id = $2 AND guild_id = $3',
    [hidden, discordId, guildId]
  );
}

async function acknowledgePayouts(userId) {
  await pool.query(
    'UPDATE users SET last_payout_notified_at = NOW() WHERE id = $1',
    [userId]
  );
}

export {  getOrCreate, addBalance, getBalance, getLeaderboard, countLeaderboard, setHidden, acknowledgePayouts  };
