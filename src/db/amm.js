import { pool } from './pool.js';

// --- Pure math functions ---

function initPool(numOutcomes, liquidity = 100) {
  return Array(numOutcomes).fill(liquidity);
}

function getPrice(poolArr, optionIndex) {
  // Price of outcome i = product of all OTHER pools / sum of all such products
  // Simplification for any N: price[i] = (k / pool[i]) / sum(k / pool[j] for all j)
  // which reduces to: (1/pool[i]) / sum(1/pool[j])
  const invSum = poolArr.reduce((s, p) => s + 1 / p, 0);
  return (1 / poolArr[optionIndex]) / invSum;
}

function applyBuy(poolArr, optionIndex, cost) {
  // k = product of all pool shares
  const k = poolArr.reduce((p, v) => p * v, 1);

  // After minting: each pool[j] += cost
  const minted = poolArr.map(p => p + cost);

  // Product of all OTHER pools after minting (all except optionIndex)
  const otherProduct = minted.reduce((p, v, i) => i === optionIndex ? p : p * v, 1);

  // Solve: (minted[optionIndex] - sharesOut) * otherProduct = k
  const sharesOut = minted[optionIndex] - k / otherProduct;

  const newPool = minted.map((p, i) => i === optionIndex ? p - sharesOut : p);
  return { newPool, sharesOut };
}

function applySell(poolArr, optionIndex, numShares) {
  // k = product of all pool shares
  const k = poolArr.reduce((p, v) => p * v, 1);

  // Selling = reverse of buying: return shares to pool, then burn complete sets for grist.
  // After returning shares: pool[i] += numShares
  // After burning d complete sets: pool[j] -= d for ALL j (including i)
  // Net: pool[i] + numShares - d, pool[j] - d for j≠i
  // Constraint: (pool[i] + numShares - d) * ∏_{j≠i}(pool[j] - d) = k
  // Solve for d (the payout).

  const a = poolArr[optionIndex] + numShares;
  const others = poolArr.filter((_, i) => i !== optionIndex);

  if (others.length === 1) {
    // n=2: quadratic (a - d)(b - d) = k → d² - (a+b)d + (ab - k) = 0
    const b = others[0];
    const sum = a + b;
    const disc = sum * sum - 4 * (a * b - k);
    const d = (sum - Math.sqrt(disc)) / 2;
    const newPool = poolArr.map((p, i) =>
      i === optionIndex ? a - d : p - d
    );
    return { newPool, payout: d };
  }

  // n>2: solve numerically with Newton's method
  // f(d) = (a - d) * ∏(others[j] - d) - k = 0
  const maxD = Math.min(a, ...others) - 1e-9;
  let d = maxD * 0.5; // initial guess

  for (let iter = 0; iter < 100; iter++) {
    const ad = a - d;
    let prod = 1;
    for (const o of others) prod *= (o - d);
    const f = ad * prod - k;

    // f'(d) = -prod + (a-d) * sum_{j}( -∏_{m≠j}(others[m]-d) )
    //       = -prod - (a-d) * sum_{j}( ∏_{m≠j}(others[m]-d) )
    let sumPartials = 0;
    for (let j = 0; j < others.length; j++) {
      let partial = 1;
      for (let m = 0; m < others.length; m++) {
        if (m !== j) partial *= (others[m] - d);
      }
      sumPartials += partial;
    }
    const fp = -prod - ad * sumPartials;

    const step = f / fp;
    d = d - step;
    if (d < 0) d = 0;
    if (d > maxD) d = maxD;
    if (Math.abs(step) < 1e-10) break;
  }

  const newPool = poolArr.map((p, i) =>
    i === optionIndex ? a - d : p - d
  );
  return { newPool, payout: d };
}

function getSharesForCost(poolArr, optionIndex, cost) {
  return applyBuy(poolArr, optionIndex, cost).sharesOut;
}

function getSellReturn(poolArr, optionIndex, numShares) {
  return applySell(poolArr, optionIndex, numShares).payout;
}

// --- DB transaction functions ---

async function buyShares(userId, marketId, optionId, cost) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock user row
    const { rows: userRows } = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!userRows[0] || parseFloat(userRows[0].balance) < cost) {
      throw new Error('Insufficient balance');
    }

    // Check market is open and is CPMM
    const { rows: marketRows } = await client.query(
      'SELECT status, closes_at, market_type FROM markets WHERE id = $1',
      [marketId]
    );
    if (!marketRows[0] || marketRows[0].status !== 'open') throw new Error('Market is not open');
    if (marketRows[0].closes_at && new Date(marketRows[0].closes_at) < new Date()) throw new Error('Betting has closed');
    if (marketRows[0].market_type !== 'cpmm') throw new Error('Use /bets for parimutuel markets');

    // Lock pool rows and read state
    const { rows: poolRows } = await client.query(
      `SELECT ap.option_id, ap.shares
       FROM amm_pools ap
       JOIN market_options mo ON mo.id = ap.option_id
       WHERE ap.market_id = $1
       ORDER BY mo.position
       FOR UPDATE`,
      [marketId]
    );
    if (!poolRows.length) throw new Error('Pool not initialized');

    const poolArr = poolRows.map(r => parseFloat(r.shares));
    const optionIndex = poolRows.findIndex(r => r.option_id === optionId);
    if (optionIndex === -1) throw new Error('Invalid optionId');

    const priceBefore = getPrice(poolArr, optionIndex);
    const { newPool, sharesOut } = applyBuy(poolArr, optionIndex, cost);
    const priceAfter = getPrice(newPool, optionIndex);

    // Deduct grist
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [cost, userId]);
    await client.query(
      'INSERT INTO currency_log (user_id, amount, reason, ref_id) VALUES ($1, $2, $3, $4)',
      [userId, -cost, 'trade_buy', String(marketId)]
    );

    // Update pool
    for (let i = 0; i < poolRows.length; i++) {
      await client.query(
        'UPDATE amm_pools SET shares = $1 WHERE market_id = $2 AND option_id = $3',
        [newPool[i], marketId, poolRows[i].option_id]
      );
    }

    // Upsert position
    await client.query(
      `INSERT INTO positions (user_id, market_id, option_id, shares)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, market_id, option_id)
       DO UPDATE SET shares = positions.shares + $4`,
      [userId, marketId, optionId, sharesOut]
    );

    // Log trade
    const { rows: tradeRows } = await client.query(
      `INSERT INTO trades (user_id, market_id, option_id, side, shares, cost, price_before, price_after)
       VALUES ($1, $2, $3, 'buy', $4, $5, $6, $7) RETURNING *`,
      [userId, marketId, optionId, sharesOut, cost, priceBefore, priceAfter]
    );

    await client.query('COMMIT');
    return { ...tradeRows[0], sharesOut, priceAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function sellShares(userId, marketId, optionId, numShares) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check market is open and CPMM
    const { rows: marketRows } = await client.query(
      'SELECT status, closes_at, market_type FROM markets WHERE id = $1',
      [marketId]
    );
    if (!marketRows[0] || marketRows[0].status !== 'open') throw new Error('Market is not open');
    if (marketRows[0].closes_at && new Date(marketRows[0].closes_at) < new Date()) throw new Error('Betting has closed');
    if (marketRows[0].market_type !== 'cpmm') throw new Error('Use /bets for parimutuel markets');

    // Check user position
    const { rows: posRows } = await client.query(
      'SELECT shares FROM positions WHERE user_id = $1 AND market_id = $2 AND option_id = $3 FOR UPDATE',
      [userId, marketId, optionId]
    );
    if (!posRows[0] || parseFloat(posRows[0].shares) < numShares) {
      throw new Error('Insufficient shares');
    }

    // Lock pool rows
    const { rows: poolRows } = await client.query(
      `SELECT ap.option_id, ap.shares
       FROM amm_pools ap
       JOIN market_options mo ON mo.id = ap.option_id
       WHERE ap.market_id = $1
       ORDER BY mo.position
       FOR UPDATE`,
      [marketId]
    );

    const poolArr = poolRows.map(r => parseFloat(r.shares));
    const optionIndex = poolRows.findIndex(r => r.option_id === optionId);
    if (optionIndex === -1) throw new Error('Invalid optionId');

    const priceBefore = getPrice(poolArr, optionIndex);
    const { newPool, payout } = applySell(poolArr, optionIndex, numShares);
    const priceAfter = getPrice(newPool, optionIndex);

    // Add grist to user
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, userId]);
    await client.query(
      'INSERT INTO currency_log (user_id, amount, reason, ref_id) VALUES ($1, $2, $3, $4)',
      [userId, payout, 'trade_sell', String(marketId)]
    );

    // Update pool
    for (let i = 0; i < poolRows.length; i++) {
      await client.query(
        'UPDATE amm_pools SET shares = $1 WHERE market_id = $2 AND option_id = $3',
        [newPool[i], marketId, poolRows[i].option_id]
      );
    }

    // Update position
    const newShares = parseFloat(posRows[0].shares) - numShares;
    if (newShares <= 0) {
      await client.query(
        'DELETE FROM positions WHERE user_id = $1 AND market_id = $2 AND option_id = $3',
        [userId, marketId, optionId]
      );
    } else {
      await client.query(
        'UPDATE positions SET shares = $1 WHERE user_id = $2 AND market_id = $3 AND option_id = $4',
        [newShares, userId, marketId, optionId]
      );
    }

    // Log trade
    const { rows: tradeRows } = await client.query(
      `INSERT INTO trades (user_id, market_id, option_id, side, shares, cost, price_before, price_after)
       VALUES ($1, $2, $3, 'sell', $4, $5, $6, $7) RETURNING *`,
      [userId, marketId, optionId, numShares, payout, priceBefore, priceAfter]
    );

    await client.query('COMMIT');
    return { ...tradeRows[0], payout, priceAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { initPool, getPrice, getSharesForCost, getSellReturn, applyBuy, applySell, buyShares, sellShares };
