import { pool } from './pool.js';

async function addWord(guildId, word) {
  await pool.query(
    `INSERT INTO banned_words (guild_id, word) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [guildId, word.toLowerCase()]
  );
}

async function listWords(guildId) {
  const { rows } = await pool.query(
    `SELECT word FROM banned_words WHERE guild_id = $1 ORDER BY word`,
    [guildId]
  );
  return rows.map(r => r.word);
}

export { addWord, listWords };
