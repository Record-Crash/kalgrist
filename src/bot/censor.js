import { EmbedBuilder } from 'discord.js';
import * as bannedWords from '../db/banned_words.js';
import * as guildSettings from '../db/guild_settings.js';

async function handleMessage(message) {
  if (message.author.bot || !message.guild) return;

  const channelId = message.channel.isThread() ? message.channel.parentId : message.channel.id;
  const settings = await guildSettings.getSettings(message.guild.id);
  if (settings?.excluded_channel_ids?.includes(channelId)) return;

  const words = await bannedWords.listWords(message.guild.id);
  if (words.length === 0) return;

  const content = message.content.toLowerCase();
  const matched = words.find(w => content.includes(w));
  if (!matched) return;

  try {
    await message.delete();
  } catch {
    // Message already deleted or no permission
  }

  if (!settings?.modlog_channel_id) return;

  const logChannel = message.guild.channels.cache.get(settings.modlog_channel_id);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Message Censored')
    .setDescription(`<@${message.author.id}> typed bad word \`${matched}\``)
    .addFields({ name: 'Complete message', value: message.content.slice(0, 1024) || '(empty)' })
    .setTimestamp();

  await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

export { handleMessage };
