import { pool } from "./pool.js";

async function castVote(marketId, userId, optionId) {
  await pool.query(
    `INSERT INTO resolution_votes (market_id, user_id, option_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (market_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id`,
    [marketId, userId, optionId]
  );
}

async function getTally(marketId) {
  const { rows } = await pool.query(
    `SELECT option_id, COUNT(*) AS votes
     FROM resolution_votes WHERE market_id = $1
     GROUP BY option_id
     ORDER BY votes DESC`,
    [marketId]
  );
  return rows;
}

export {  castVote, getTally  };
