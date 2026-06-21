-- Users: one row per discord user per guild
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  discord_id    TEXT NOT NULL,
  guild_id      TEXT NOT NULL,
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(discord_id, guild_id)
);

-- Audit log for all currency changes
CREATE TABLE IF NOT EXISTS currency_log (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id),
  amount        NUMERIC(12,2) NOT NULL,
  reason        TEXT NOT NULL, -- 'message', 'reaction', 'bet_place', 'bet_payout', 'bet_refund'
  ref_id        TEXT,          -- optional reference (message id, market id, etc.)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prediction markets
CREATE TABLE IF NOT EXISTS markets (
  id                SERIAL PRIMARY KEY,
  guild_id          TEXT NOT NULL,
  creator_id        INT NOT NULL REFERENCES users(id),
  title             TEXT NOT NULL,
  description       TEXT,
  resolution_method TEXT NOT NULL CHECK (resolution_method IN ('creator', 'moderator', 'vote')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'resolved', 'cancelled')),
  closes_at         TIMESTAMPTZ,         -- when betting closes
  resolved_option   INT,                 -- winning option id (set on resolution)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

-- Options for each market (e.g. Yes/No, or multiple choices)
CREATE TABLE IF NOT EXISTS market_options (
  id            SERIAL PRIMARY KEY,
  market_id     INT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  position      INT NOT NULL DEFAULT 0  -- display order
);

-- Individual bets
CREATE TABLE IF NOT EXISTS bets (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id),
  market_id     INT NOT NULL REFERENCES markets(id),
  option_id     INT NOT NULL REFERENCES market_options(id),
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track message reward cooldowns (in-memory is fine, but this survives restarts)
CREATE TABLE IF NOT EXISTS message_cooldowns (
  discord_id    TEXT NOT NULL,
  guild_id      TEXT NOT NULL,
  last_reward   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(discord_id, guild_id)
);

-- Resolution votes (for vote-based markets)
CREATE TABLE IF NOT EXISTS resolution_votes (
  id            SERIAL PRIMARY KEY,
  market_id     INT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(id),
  option_id     INT NOT NULL REFERENCES market_options(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(market_id, user_id) -- one vote per user per market
);

CREATE INDEX IF NOT EXISTS idx_users_discord_guild ON users(discord_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_markets_guild_status ON markets(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_bets_market ON bets(market_id);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id);
