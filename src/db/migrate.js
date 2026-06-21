import { pool } from './pool.js';

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        discord_id VARCHAR(255) NOT NULL,
        guild_id VARCHAR(255) NOT NULL,
        balance INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (discord_id, guild_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS markets (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        creator_id INT REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        resolution_method VARCHAR(50) NOT NULL,
        closes_at TIMESTAMP,
        status VARCHAR(50) DEFAULT 'open',
        resolved_option INT,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS market_options (
        id SERIAL PRIMARY KEY,
        market_id INT REFERENCES markets(id),
        label VARCHAR(255) NOT NULL,
        position INT NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bets (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        market_id INT REFERENCES markets(id),
        option_id INT REFERENCES market_options(id),
        amount INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS currency_log (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        amount FLOAT NOT NULL,
        reason VARCHAR(255) NOT NULL,
        ref_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS resolution_votes (
        market_id INT REFERENCES markets(id),
        user_id INT REFERENCES users(id),
        option_id INT REFERENCES market_options(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (market_id, user_id)
      );
    `);

    // Add username/avatar columns to users (Task 2)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    `);

    // Guild settings table (Task 6)
    await client.query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id VARCHAR(255) PRIMARY KEY,
        mod_role_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Channel multipliers table (Task 7)
    await client.query(`
      CREATE TABLE IF NOT EXISTS channel_multipliers (
        guild_id VARCHAR(255) NOT NULL,
        channel_id VARCHAR(255) NOT NULL,
        multiplier FLOAT NOT NULL DEFAULT 1.0,
        PRIMARY KEY (guild_id, channel_id)
      );
    `);

    // CPMM migration
    await client.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS market_type VARCHAR(10) DEFAULT 'cpmm';
    `);
    await client.query(`
      UPDATE markets SET market_type = 'parimutuel' WHERE market_type IS NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS amm_pools (
        market_id INT REFERENCES markets(id),
        option_id INT REFERENCES market_options(id),
        shares NUMERIC(18,6) NOT NULL,
        PRIMARY KEY (market_id, option_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        user_id INT REFERENCES users(id),
        market_id INT REFERENCES markets(id),
        option_id INT REFERENCES market_options(id),
        shares NUMERIC(18,6) NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, market_id, option_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        market_id INT REFERENCES markets(id),
        option_id INT REFERENCES market_options(id),
        side VARCHAR(4) NOT NULL,
        shares NUMERIC(18,6) NOT NULL,
        cost NUMERIC(18,6) NOT NULL,
        price_before NUMERIC(10,6) NOT NULL,
        price_after NUMERIC(10,6) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tags column for markets
    await client.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
    `);

    // Guild-level market enable/disable (default false - disabled for new guilds)
    await client.query(`
      ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS market_enabled BOOLEAN DEFAULT false;
    `);

    // Channel where bot announces new markets
    await client.query(`
      ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS market_channel_id TEXT;
    `);

    // Whitelist of channels where /leaderboard can be used (empty = all channels allowed)
    await client.query(`
      ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS leaderboard_channel_ids TEXT[] DEFAULT '{}';
    `);

    // Icon URL for markets
    await client.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS icon_url TEXT;
    `);

    // Hidden flag for markets (mods can hide a market from regular users)
    await client.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT false;
    `);

    // Hidden flag for users (banned/left members)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT false;
    `);

    // Nickname (server-specific display name)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;
    `);

    // Featured tags for the tag bar (ordered list of tag names)
    await client.query(`
      ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS featured_tags TEXT[] DEFAULT '{}';
    `);

    // Track when user last saw payout notifications (so popup only shows new payouts)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_payout_notified_at TIMESTAMP;
    `);

    // API-Sports fixture ID linked to this market
    await client.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS fixture_id INTEGER;
    `);

    // Sport for the linked fixture (e.g. 'football', 'baseball')
    await client.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'football';
    `);

    // Mod action audit log
    await client.query(`
      CREATE TABLE IF NOT EXISTS mod_log (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        discord_id VARCHAR(255) NOT NULL,
        action VARCHAR(100) NOT NULL,
        detail TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS mod_log_guild_idx ON mod_log (guild_id, created_at DESC);
    `);

    // Modlog channel for censor and mod action embeds
    await client.query(`
      ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS modlog_channel_id TEXT;
    `);

    // Channels excluded from grist earning and message censoring
    await client.query(`
      ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS excluded_channel_ids TEXT[] DEFAULT '{}';
    `);

    // Banned words for message censor
    await client.query(`
      CREATE TABLE IF NOT EXISTS banned_words (
        id SERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        word TEXT NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, word)
      );
    `);

    await client.query('COMMIT');
    console.log('Database migrated successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed', err);
    throw err;
  } finally {
    client.release();
  }
}
