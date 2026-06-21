import { pool } from "./pool.js";
import * as users from "./users.js";

async function placeBet(userId, marketId, optionId, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock user row to prevent double-spending
    const { rows: userRows } = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!userRows[0] || parseFloat(userRows[0].balance) < amount) {
      throw new Error('Insufficient balance');
    }

    // Check market is still open
    const { rows: marketRows } = await client.query(
      'SELECT status, closes_at FROM markets WHERE id = $1',
      [marketId]
    );
    if (!marketRows[0] || marketRows[0].status !== 'open') {
      throw new Error('Market is not open');
    }
    if (marketRows[0].closes_at && new Date(marketRows[0].closes_at) < new Date()) {
      throw new Error('Betting has closed');
    }

    // Deduct balance and place bet
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, userId]);
    await client.query(
      'INSERT INTO currency_log (user_id, amount, reason, ref_id) VALUES ($1, $2, $3, $4)',
      [userId, -amount, 'bet_place', String(marketId)]
    );
    const { rows: betRows } = await client.query(
      'INSERT INTO bets (user_id, market_id, option_id, amount) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, marketId, optionId, amount]
    );

    await client.query('COMMIT');
    return betRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getByMarket(marketId) {
  const { rows } = await pool.query(
    'SELECT b.*, u.discord_id FROM bets b JOIN users u ON u.id = b.user_id WHERE b.market_id = $1',
    [marketId]
  );
  return rows;
}

async function getByUser(userId) {
  const { rows } = await pool.query(
    `SELECT b.*, m.title, m.status, mo.label AS option_label
     FROM bets b
     JOIN markets m ON m.id = b.market_id
     JOIN market_options mo ON mo.id = b.option_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return rows;
}

// Pay out winners proportionally from the total pool
async function payoutWinners(marketId, winningOptionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Total pool for this market
    const { rows: poolRows } = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM bets WHERE market_id = $1',
      [marketId]
    );
    const totalPool = parseFloat(poolRows[0].total);
    if (totalPool === 0) {
      await client.query('COMMIT');
      return [];
    }

    // Total bet on winning option
    const { rows: winnerPoolRows } = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM bets WHERE market_id = $1 AND option_id = $2',
      [marketId, winningOptionId]
    );
    const winnerPool = parseFloat(winnerPoolRows[0].total);

    if (winnerPool === 0) {
      // No winners — refund everyone
      const { rows: allBets } = await client.query(
        'SELECT user_id, amount FROM bets WHERE market_id = $1',
        [marketId]
      );
      for (const bet of allBets) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [bet.amount, bet.user_id]);
        await client.query(
          'INSERT INTO currency_log (user_id, amount, reason, ref_id) VALUES ($1, $2, $3, $4)',
          [bet.user_id, bet.amount, 'bet_refund', String(marketId)]
        );
      }
      await client.query('COMMIT');
      return allBets.map(b => ({ userId: b.user_id, payout: parseFloat(b.amount) }));
    }

    // Proportional payout to winners
    const { rows: winningBets } = await client.query(
      'SELECT user_id, amount FROM bets WHERE market_id = $1 AND option_id = $2',
      [marketId, winningOptionId]
    );
    const payouts = [];
    for (const bet of winningBets) {
      const share = parseFloat(bet.amount) / winnerPool;
      const payout = Math.round(share * totalPool * 100) / 100;
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, bet.user_id]);
      await client.query(
        'INSERT INTO currency_log (user_id, amount, reason, ref_id) VALUES ($1, $2, $3, $4)',
        [bet.user_id, payout, 'bet_payout', String(marketId)]
      );
      payouts.push({ userId: bet.user_id, payout });
    }

    await client.query('COMMIT');
    return payouts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getHistory(marketId) {
  const { rows } = await pool.query(
    `SELECT b.option_id, b.amount, b.created_at
     FROM bets b WHERE b.market_id = $1
     ORDER BY b.created_at ASC`,
    [marketId]
  );
  return rows;
}

async function payoutCpmm(marketId, winningOptionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: positions } = await client.query(
      'SELECT user_id, shares FROM positions WHERE market_id = $1 AND option_id = $2 AND shares > 0',
      [marketId, winningOptionId]
    );

    const payouts = [];
    for (const pos of positions) {
      const payout = Math.round(parseFloat(pos.shares) * 100) / 100;
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, pos.user_id]);
      await client.query(
        'INSERT INTO currency_log (user_id, amount, reason, ref_id) VALUES ($1, $2, $3, $4)',
        [pos.user_id, payout, 'bet_payout', String(marketId)]
      );
      payouts.push({ userId: pos.user_id, payout });
    }

    await client.query('COMMIT');
    return payouts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Reverse all bet_payout and bet_refund entries for a market (used when reopening)
async function rollbackPayouts(marketId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: payouts } = await client.query(
      `SELECT user_id, amount FROM currency_log
       WHERE ref_id = $1 AND reason IN ('bet_payout', 'bet_refund')`,
      [String(marketId)]
    );

    for (const p of payouts) {
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [p.amount, p.user_id]);
      await client.query(
        'INSERT INTO currency_log (user_id, amount, reason, ref_id) VALUES ($1, $2, $3, $4)',
        [p.user_id, -parseFloat(p.amount), 'bet_payout_rollback', String(marketId)]
      );
    }

    await client.query('COMMIT');
    return payouts.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export {  placeBet, getByMarket, getByUser, getHistory, payoutWinners, payoutCpmm, rollbackPayouts  };
