import { pool } from './pool.js';

export async function insert(guildId, discordId, action, detail) {
  await pool.query(
    `INSERT INTO mod_log (guild_id, discord_id, action, detail) VALUES ($1, $2, $3, $4)`,
    [guildId, discordId, action, detail]
  );
}

export async function list(guildId, limit = 200) {
  const { rows } = await pool.query(
    `SELECT ml.id, ml.action, ml.detail, ml.created_at,
            COALESCE(u.nickname, u.username, ml.discord_id) AS mod_name
     FROM mod_log ml
     LEFT JOIN users u ON u.discord_id = ml.discord_id AND u.guild_id = ml.guild_id
     WHERE ml.guild_id = $1
     ORDER BY ml.created_at DESC
     LIMIT $2`,
    [guildId, limit]
  );
  return rows;
}
