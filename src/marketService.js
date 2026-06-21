import * as markets from './db/markets.js';
import * as guildSettings from './db/guild_settings.js';
import { getClient } from './bot/client.js';

/**
 * Creates a market and announces it in the configured channel.
 * Single source of truth used by both the HTTP API and the slash command.
 */
async function createMarket(guildId, userId, title, description, resolution, closesAt, options, tags = []) {
  const market = await markets.create(guildId, userId, title, description, resolution, closesAt, options, tags);

  try {
    const settings = await guildSettings.getSettings(guildId);
    if (settings?.market_channel_id) {
      const client = getClient();
      const channel = await client?.channels?.fetch(settings.market_channel_id);
      if (channel?.isTextBased()) {
        const optList = market.options.map(o => `• ${o.label}`).join('\n');
        await channel.send(`📊 **New Market: ${title}**\n${optList}\nResolution: ${resolution || 'creator'}`);
      }
    }
  } catch (err) {
    console.error('[announcement] failed to post new market:', err.message);
  }

  return market;
}

export { createMarket };
