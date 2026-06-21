import { pool } from "./pool.js";
import { initPool } from "./amm.js";

async function create(guildId, creatorId, title, description, resolutionMethod, closesAt, options, tags = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO markets (guild_id, creator_id, title, description, resolution_method, closes_at, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [guildId, creatorId, title, description, resolutionMethod, closesAt, tags]
    );
    const market = rows[0];

    const insertedOptions = [];
    for (let i = 0; i < options.length; i++) {
      const { rows: optRows } = await client.query(
        'INSERT INTO market_options (market_id, label, position) VALUES ($1, $2, $3) RETURNING *',
        [market.id, options[i], i]
      );
      insertedOptions.push(optRows[0]);
    }

    // Initialize AMM pool for new CPMM markets
    const poolShares = initPool(insertedOptions.length);
    for (let i = 0; i < insertedOptions.length; i++) {
      await client.query(
        'INSERT INTO amm_pools (market_id, option_id, shares) VALUES ($1, $2, $3)',
        [market.id, insertedOptions[i].id, poolShares[i]]
      );
    }

    await client.query('COMMIT');
    return { ...market, options: insertedOptions };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listOpen(guildId, includeHidden = false) {
  const hiddenFilter = includeHidden ? '' : ' AND m.hidden = false';
  const { rows } = await pool.query(
    `SELECT m.*, json_agg(json_build_object('id', mo.id, 'label', mo.label, 'position', mo.position) ORDER BY mo.position)
       AS options
     FROM markets m
     JOIN market_options mo ON mo.market_id = m.id
     WHERE m.guild_id = $1 AND m.status = 'open'${hiddenFilter}
     GROUP BY m.id
     ORDER BY m.created_at DESC`,
    [guildId]
  );
  return rows;
}

async function getById(marketId) {
  const { rows } = await pool.query(
    `SELECT m.*, json_agg(json_build_object('id', mo.id, 'label', mo.label, 'position', mo.position) ORDER BY mo.position)
       AS options
     FROM markets m
     JOIN market_options mo ON mo.market_id = m.id
     WHERE m.id = $1
     GROUP BY m.id`,
    [marketId]
  );
  return rows[0] || null;
}

async function getPoolByOption(marketId) {
  const { rows } = await pool.query(
    `SELECT option_id, COALESCE(SUM(amount), 0) AS total
     FROM bets WHERE market_id = $1
     GROUP BY option_id`,
    [marketId]
  );
  return rows;
}

async function setStatus(marketId, status) {
  await pool.query('UPDATE markets SET status = $1 WHERE id = $2', [status, marketId]);
}

async function resolve(marketId, winningOptionId) {
  await pool.query(
    `UPDATE markets SET status = 'resolved', resolved_option = $1, resolved_at = now() WHERE id = $2`,
    [winningOptionId, marketId]
  );
}

async function reopen(marketId) {
  await pool.query(
    `UPDATE markets SET status = 'open', resolved_option = NULL, resolved_at = NULL WHERE id = $1`,
    [marketId]
  );
}

async function setIcon(marketId, iconUrl) {
  await pool.query('UPDATE markets SET icon_url = $1 WHERE id = $2', [iconUrl, marketId]);
}

async function listResolved(guildId) {
  const { rows } = await pool.query(
    `SELECT m.*, json_agg(json_build_object('id', mo.id, 'label', mo.label, 'position', mo.position) ORDER BY mo.position)
       AS options
     FROM markets m
     JOIN market_options mo ON mo.market_id = m.id
     WHERE m.guild_id = $1 AND m.status IN ('resolved', 'cancelled')
     GROUP BY m.id
     ORDER BY m.resolved_at DESC NULLS LAST`,
    [guildId]
  );
  return rows;
}

async function setHidden(marketId, hidden) {
  await pool.query('UPDATE markets SET hidden = $1 WHERE id = $2', [hidden, marketId]);
}

async function setClosesAt(marketId, closesAt) {
  await pool.query('UPDATE markets SET closes_at = $1 WHERE id = $2', [closesAt, marketId]);
}

async function addOption(marketId, label) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      'SELECT COUNT(*) AS count FROM market_options WHERE market_id = $1',
      [marketId]
    );
    const position = parseInt(existing[0].count, 10);

    const { rows: optRows } = await client.query(
      'INSERT INTO market_options (market_id, label, position) VALUES ($1, $2, $3) RETURNING *',
      [marketId, label, position]
    );
    const newOption = optRows[0];

    const { rows: marketRows } = await client.query(
      'SELECT market_type FROM markets WHERE id = $1',
      [marketId]
    );
    if (marketRows[0]?.market_type === 'cpmm') {
      await client.query(
        'INSERT INTO amm_pools (market_id, option_id, shares) VALUES ($1, $2, $3)',
        [marketId, newOption.id, 100]
      );
    }

    await client.query('COMMIT');
    return newOption;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getIconGallery(guildId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT icon_url FROM markets WHERE guild_id = $1 AND icon_url IS NOT NULL`,
    [guildId]
  );
  return rows.map(r => r.icon_url);
}

async function updateTags(marketId, tags) {
  await pool.query('UPDATE markets SET tags = $1 WHERE id = $2', [tags, marketId]);
}

async function setFixtureId(marketId, fixtureId, sport = 'football') {
  await pool.query('UPDATE markets SET fixture_id = $1, sport = $2 WHERE id = $3', [fixtureId ?? null, sport, marketId]);
}

async function listAll(guildId) {
  const { rows } = await pool.query(
    `SELECT m.*, json_agg(json_build_object('id', mo.id, 'label', mo.label, 'position', mo.position) ORDER BY mo.position)
       AS options
     FROM markets m
     JOIN market_options mo ON mo.market_id = m.id
     WHERE m.guild_id = $1
     GROUP BY m.id
     ORDER BY m.created_at DESC`,
    [guildId]
  );
  return rows;
}

async function updateTitle(marketId, title) {
  await pool.query('UPDATE markets SET title = $1 WHERE id = $2', [title, marketId]);
}

async function updateDescription(marketId, description) {
  await pool.query('UPDATE markets SET description = $1 WHERE id = $2', [description, marketId]);
}

async function updateOptionLabel(optionId, label) {
  await pool.query('UPDATE market_options SET label = $1 WHERE id = $2', [label, optionId]);
}

export {  create, listOpen, listAll, listResolved, getById, getPoolByOption, setStatus, resolve, reopen, setIcon, addOption, setHidden, setClosesAt, getIconGallery, updateTags, setFixtureId, updateTitle, updateDescription, updateOptionLabel  };
