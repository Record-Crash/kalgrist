# Kalgrist

**Prediction markets for your Discord server.** Members earn a play money
called **grist** by chatting, then bet it on the outcomes of community-created
markets. Beta 0.1.0.

Originally built by **Nero**.

---

## What it is

One Node process runs two things at once:

1. **A Discord bot** ([discord.js](https://discord.js.org/)) — awards grist for
   messages and reactions, serves slash commands, censors banned words, and
   tracks bans.
2. **A Discord Activity** — a Vue 3 web app that loads inside Discord's embedded
   Activities panel, where users browse markets, bet, and view leaderboards. It
   is served by an Express server in the same process.

### Architecture

| Layer          | Tech                                   | Location                  |
| -------------- | -------------------------------------- | ------------------------- |
| Entry point    | Express + discord.js, run via `tsx`    | `server.ts`               |
| Bot logic      | currency, commands, censor, register   | `src/bot/`                |
| HTTP API       | Express router (~40 endpoints)         | `src/server/api.js`       |
| DB access      | raw SQL over `pg`                      | `src/db/`                 |
| Pricing engine | CPMM automated market maker            | `src/db/amm.js`           |
| Frontend       | Vue 3 + Vite                           | `client/`                 |
| Database       | PostgreSQL (schema auto-created)       | `src/db/migrate.js`       |

**Auth:** The frontend runs inside Discord, obtains an OAuth `code`, and POSTs it
to `/api/token`. The server exchanges it with Discord, verifies the user is a
member of the claimed guild, and issues a session token (held **in memory** —
restarting the server logs everyone out). Every `/api` call is gated by that
token and checked against `ALLOWED_GUILD_IDS`.

**Market types:**
- `cpmm` (default) — a constant-product automated market maker. Prices move as
  users buy/sell shares; positions can be exited early by selling.
- `parimutuel` (legacy) — pooled betting paid out on resolution. Older markets only.

---

## Requirements

- **Node.js 20+** (discord.js 14 + Vite 6 need Node 18 at minimum)
- **PostgreSQL 12+**
- **A Discord application** configured with a bot and an Activity

---

## Discord application setup

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create an application → note the **Client ID** and **Client Secret**.
2. Add a **Bot** → note the **token**. Enable these **Privileged Gateway Intents**:
   - **Message Content** (read messages to award grist)
   - **Server Members** (mod checks, nicknames)
3. Under **Activities**, enable the embedded activity and set its URL mapping /
   root to your public **HTTPS** URL (this becomes `ACTIVITY_URL`). Discord
   Activities must be served over public HTTPS — `localhost` only works inside
   Discord's local testing.
4. Invite the bot with the `bot` and `applications.commands` scopes.

---

## Configuration

Copy `.env.example` to `.env` and fill it in:

```ini
DISCORD_TOKEN=          # bot token
DISCORD_CLIENT_ID=      # application/client id
DISCORD_CLIENT_SECRET=  # oauth secret
DATABASE_URL=           # postgresql://user:pass@host:5432/dbname
PORT=3000               # HTTP port (optional, defaults to 3000)
ACTIVITY_URL=           # https://your-domain.com  (no trailing slash)
ALLOWED_GUILD_IDS=      # comma-separated guild IDs allowed to use the market
GAME_ADMIN=             # comma-separated Discord user IDs with admin powers
API_SPORTS_WIDGET_KEY=  # optional — only for the sports-fixtures feature
NODE_ENV=production     # 'production' serves the built frontend from dist/
```

A guild is locked out of the web app unless its ID appears in
`ALLOWED_GUILD_IDS`. Even when allowed, markets start **disabled per guild**
(`market_enabled` defaults to `false`) until a server admin runs `/setup`.

Optional currency-tuning vars (defaults shown) are read in `src/config.js`:

```ini
CURRENCY_BASE_REWARD=1
CURRENCY_MESSAGE_COOLDOWN_MS=5000
CURRENCY_MAX_LENGTH_MULTIPLIER=3
CURRENCY_REACTION_BONUS=0.5
```

---

## Database

The schema is created **automatically on startup** by `migrate()` in
`src/db/migrate.js`, which is idempotent (`CREATE TABLE IF NOT EXISTS` /
`ADD COLUMN IF NOT EXISTS`). You normally do not run migrations by hand.

> The `migrations/` folder and `migrations/run.js` are **legacy and non-functional**
> (CommonJS against ESM modules). Ignore them; the live schema is in
> `src/db/migrate.js`.

### Restoring from a dump

To restore an existing database (e.g. when migrating servers), restore the dump
**before** the first app start. The startup migration sees the tables already
exist and only fills in any missing columns — no data is touched.

```bash
# create role + database
sudo -u postgres psql <<'SQL'
CREATE ROLE kalgrist WITH LOGIN PASSWORD 'strong-password';
CREATE DATABASE kalgrist OWNER kalgrist;
SQL

# plain SQL dump (text):
psql "postgresql://kalgrist:strong-password@localhost:5432/kalgrist" < dump.sql

# custom/binary dump (pg_dump -Fc):
# pg_restore -d "postgresql://kalgrist:...@localhost:5432/kalgrist" --no-owner dump.sql
```

---

## Running

```bash
git clone --recurse-submodules https://github.com/Record-Crash/kalgrist.git
cd kalgrist
# if you forgot --recurse-submodules:
git submodule update --init --recursive

npm install
npm --prefix client install   # the frontend has its own package.json
```

### Development (hot reload)

```bash
npm run dev
```

Vite middleware serves the client; no build step needed.

### Production

In production there is a **single** process: Express serves the pre-built
client from `dist/` and runs the bot — no Vite dev server. (In development,
`npm run dev` additionally runs Vite as middleware for hot reload.)

```bash
npm run build                 # builds client/ → dist/
NODE_ENV=production npm start
```

The server listens on `PORT` (default 3000) on `0.0.0.0`. Because Discord
Activities require public HTTPS, run a reverse proxy with TLS (e.g. Caddy or
nginx) in front, and run the app under a process manager (systemd, pm2, …).
Point `ACTIVITY_URL` and the Discord Activity URL mapping at that public domain.

---

## Slash commands

Registered per-guild on join (`src/bot/register.js`). Includes `/balance`,
`/leaderboard`, `/setup`, and the mod-only `/market` group (`create`, `resolve`,
`reopen`, `icon`, …). Most management is also available through the Activity UI.

---

## Known rough edges

- **Sessions are in-memory** (`src/server/sessions.js`) — a restart logs everyone
  out. Consider Redis/DB-backed sessions before scaling.
- **chart.xkcd submodule** points at Nero's personal fork
  (`github.com/nerodoescode/chart.xkcd`). A vendored copy is committed under
  `client/src/vendor/chart.xkcd/`, so the build works even if the fork disappears.

---

## Credits

See `client/src/CREDITS.md` for the full list of libraries and tools.
