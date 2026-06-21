ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS modlog_channel_id TEXT;

CREATE TABLE IF NOT EXISTS banned_words (
  id         SERIAL PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  word       TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(guild_id, word)
);
