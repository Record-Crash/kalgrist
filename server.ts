import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { Client, GatewayIntentBits, Partials, REST, Routes, ActivityType } from 'discord.js';
import config from './src/config.js';
import { setClient } from './src/bot/client.js';
import * as usersDb from './src/db/users.js';
import { handleMessage, handleReaction } from './src/bot/currency.js';
import { handleMessage as handleCensor } from './src/bot/censor.js';
import { handleInteraction } from './src/bot/commands.js';
import { registerCommands } from './src/bot/register.js';
import api from './src/server/api.js';
import { sessions } from './src/server/sessions.js';

import { migrate } from './src/db/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Run DB Migrations
  if (process.env.DATABASE_URL) {
    try {
      await migrate();
    } catch (e) {
      console.error("DB Migration Error:", e.message);
    }
  } else {
    console.warn("DATABASE_URL is not set, skipping DB migrations.");
  }

  app.use(express.json());

  // Token exchange for Discord Activity SDK
  app.post('/api/token', async (req, res) => {
    const { code, guildId } = req.body;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    try {
      const params = new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
      });

      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        return res.status(400).json({ error: tokenData.error_description || 'Token exchange failed' });
      }

      // Verify identity via Discord API
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) {
        return res.status(400).json({ error: 'Failed to verify Discord identity' });
      }
      const discordUser = await userRes.json();

      // Verify user is actually a member of the claimed guild
      if (guildId) {
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (!guildsRes.ok) {
          return res.status(400).json({ error: 'Failed to verify guild membership' });
        }
        const guilds = await guildsRes.json();
        if (!guilds.some((g: { id: string }) => g.id === guildId)) {
          return res.status(403).json({ error: 'You are not a member of this server' });
        }
      }

      // Create a session token tied to verified identity
      const sessionToken = crypto.randomUUID();
      sessions.set(sessionToken, {
        discordId: discordUser.id,
        username: discordUser.username,
        guildId: guildId || null,
      });

      res.json({ access_token: tokenData.access_token, session_token: sessionToken });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Version check (public, no auth)
  app.get('/api/version', (req, res) => {
    const distPath = path.join(process.cwd(), 'dist');
    try {
      const buildId = fs.readFileSync(path.join(distPath, 'build-id.txt'), 'utf-8').trim();
      res.json({ buildId });
    } catch {
      res.json({ buildId: null });
    }
  });

  // API routes FIRST
  app.use('/api', api);

  // Uploaded icons
  const uploadsPath = path.join(process.cwd(), 'uploads');
  fs.mkdirSync(uploadsPath, { recursive: true });
  app.use('/uploads', express.static(uploadsPath, { maxAge: '30d' }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    // Serve index.html with no-cache headers for all non-asset routes
    const sendIndex = (req, res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    };

    // Explicitly handle root (with or without query strings) before static middleware
    app.get('/', sendIndex);

    // Static assets (JS/CSS with content hashes) can be cached long-term
    app.use(express.static(distPath, {
      maxAge: '1y',
      immutable: true,
      index: false, // don't serve index.html from static middleware
    }));

    // SPA fallback for any other routes
    app.get('*', sendIndex);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Start HTTP server immediately
startServer();

// Start Discord Bot
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Reaction],
});

client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user?.tag}`);
  setClient(client);
  client.user?.setActivity('Beta 0.1.0', { type: ActivityType.Playing });
  const guildIds = client.guilds.cache.map(g => g.id);
  await registerCommands(guildIds);
});

client.on('guildCreate', async (guild) => {
  await registerCommands([guild.id]);
});

// Ban tracking: hide banned users, unhide on unban or rejoin
client.on('guildBanAdd', async (ban) => {
  try {
    await usersDb.setHidden(ban.user.id, ban.guild.id, true);
  } catch (err) {
    console.error('[ban] Failed to hide user:', (err as Error).message);
  }
});

client.on('guildBanRemove', async (ban) => {
  try {
    await usersDb.setHidden(ban.user.id, ban.guild.id, false);
  } catch (err) {
    console.error('[unban] Failed to unhide user:', (err as Error).message);
  }
});


client.on('error', err => console.error('[discord]', err));

client.on('messageCreate', (msg) => {
  handleCensor(msg).catch(err => console.error('[censor]', err));
  handleMessage(msg);
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  handleReaction(reaction, user);
});

client.on('interactionCreate', (interaction) => {
  handleInteraction(interaction).catch(err => console.error('[interaction]', err));
});

// Entry Point commands (type 4) may not be emitted via interactionCreate in all discord.js versions.
// Catch them on the raw gateway packet to guarantee we respond with LAUNCH_ACTIVITY within the 3s window.
const rest = new REST({ version: '10' }).setToken(config.discord.token || '');
client.on('raw', async (packet) => {
  if (packet.t !== 'INTERACTION_CREATE') return;
  if (packet.d?.data?.type !== 4) return; // 4 = PRIMARY_ENTRY_POINT
  try {
    await rest.post(Routes.interactionCallback(packet.d.id, packet.d.token), {
      body: { type: 12 }, // LAUNCH_ACTIVITY
    });
  } catch (err) {
    console.error('[activity] Failed to respond to Entry Point interaction:', err.message);
  }
});

if (config.discord.token) {
  client.login(config.discord.token).catch(err => {
    console.error('Bot login failed:', err.message);
    console.error('HTTP server is still running.');
  });
} else {
  console.log("No DISCORD_TOKEN provided, skipping bot login.");
}
