import config from "../config.js";
import * as users from "../db/users.js";
import * as guildSettings from "../db/guild_settings.js";
import { pool } from "../db/pool.js";

// In-memory cooldown cache (survives within process, DB is fallback on restart)
const cooldowns = new Map();

function cooldownKey(discordId, guildId) {
  return `${discordId}:${guildId}`;
}

function lengthMultiplier(content) {
  // Diminishing returns: log curve, capped
  const len = content.trim().length;
  if (len <= 5) return 0.5;
  const mult = 1 + Math.log10(len / 10);
  return Math.min(Math.max(mult, 0.5), config.currency.maxLengthMultiplier);
}

function isAllowedGuild(guildId) {
  const { allowedGuilds } = config.discord;
  return allowedGuilds.length > 0 && allowedGuilds.includes(guildId);
}

async function handleMessage(message) {
  if (message.author.bot || !message.guild) return;
  if (!isAllowedGuild(message.guild.id)) return;

  // Threads inherit their parent channel's excluded status
  const channelId = message.channel.isThread() ? message.channel.parentId : message.channel.id;

  const settings = await guildSettings.getSettings(message.guild.id);
  if (settings?.excluded_channel_ids?.includes(channelId)) return;

  const key = cooldownKey(message.author.id, message.guild.id);
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < config.currency.cooldownMs) return;

  cooldowns.set(key, now);

  const user = await users.getOrCreate(
    message.author.id, message.guild.id,
    message.author.username, message.author.displayAvatarURL({ size: 64 })
  );
  const mult = lengthMultiplier(message.content);

  const channelMult = await guildSettings.getChannelMultiplier(message.guild.id, channelId);

  const reward = Math.round(config.currency.baseReward * mult * channelMult * 100) / 100;

  await users.addBalance(user.id, reward, 'message', message.id);
}

async function handleReaction(reaction, reactingUser) {
  if (reactingUser.bot) return;

  const message = reaction.message;
  if (!message.guild || message.author.bot) return;
  if (!isAllowedGuild(message.guild.id)) return;
  // Don't reward self-reactions
  if (message.author.id === reactingUser.id) return;

  const author = await users.getOrCreate(message.author.id, message.guild.id);
  const bonus = config.currency.reactionBonus;

  await users.addBalance(author.id, bonus, 'reaction', message.id);
}

export {  handleMessage, handleReaction  };
