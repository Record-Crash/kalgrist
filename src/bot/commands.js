import {  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder  } from "discord.js";
import config from "../config.js";
import * as users from "../db/users.js";
import * as markets from "../db/markets.js";
import { createMarket } from "../marketService.js";
import * as bets from "../db/bets.js";
import * as guildSettings from "../db/guild_settings.js";
import * as bannedWords from "../db/banned_words.js";

// Application emoji (owned by the bot, usable in any guild)
const GRIST = '<:grist:1520392778671067207>';

const commands = [
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your virtual currency balance'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('See the top earners in this server')
    .addIntegerOption(o =>
      o.setName('page')
        .setDescription('Page number (10 entries per page)')
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('market')
    .setDescription('Mod-only market management commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new prediction market')
        .addStringOption(o => o.setName('title').setDescription('Market question').setRequired(true))
        .addStringOption(o => o.setName('options').setDescription('Comma-separated options (e.g. "Yes,No")').setRequired(true))
        .addStringOption(o => o.setName('resolution').setDescription('Resolution method')
          .addChoices(
            { name: 'Moderator resolves', value: 'moderator' },
            { name: 'Community vote', value: 'vote' },
          ).setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Additional details'))
        .addStringOption(o => o.setName('closes').setDescription('When betting closes (e.g. "2h", "1d", "2025-12-31")'))
    )
    .addSubcommand(sub =>
      sub.setName('resolve')
        .setDescription('Resolve a market')
        .addIntegerOption(o => o.setName('market_id').setDescription('Market ID').setRequired(true))
        .addIntegerOption(o => o.setName('option_id').setDescription('Winning option ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reopen')
        .setDescription('Reopen a resolved market and roll back payouts')
        .addIntegerOption(o => o.setName('market_id').setDescription('Market ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('icon')
        .setDescription('Set or remove the icon for a market')
        .addIntegerOption(o => o.setName('market_id').setDescription('Market ID').setRequired(true))
        .addAttachmentOption(o => o.setName('image').setDescription('Icon image (leave blank to remove)'))
    ),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure the prediction market for this server')
    .addRoleOption(o => o.setName('mod_role').setDescription('Role that can give grist and resolve markets').setRequired(true))
    .addBooleanOption(o => o.setName('enable_market').setDescription('Enable the prediction market? (default: false)'))
    .addChannelOption(o =>
      o.setName('market_channel')
        .setDescription('Channel where the bot announces new markets')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption(o =>
      o.setName('leaderboard_channel')
        .setDescription('Channel where /leaderboard can be used (run multiple times to add more)')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption(o =>
      o.setName('modlog_channel')
        .setDescription('Channel where moderation actions are logged')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption(o => o.setName('backfill').setDescription('Calculate last week\'s messages to give initial grist?')),

  new SlashCommandBuilder()
    .setName('channel-multiplier')
    .setDescription('Set grist earning multiplier for a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Channel to set multiplier for').setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildVoice))
    .addNumberOption(o => o.setName('multiplier').setDescription('Multiplier (e.g. 1.5, 0.5)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('give-grist')
    .setDescription('Give grist to a user')
    .addUserOption(o => o.setName('user').setDescription('User to give grist to').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount of grist').setRequired(true)),

  new SlashCommandBuilder()
    .setName('post-play-message')
    .setDescription('Post a Play Now message in a channel')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to post in (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
    ),

  new SlashCommandBuilder()
    .setName('ignore-channel')
    .setDescription('Exclude a channel from grist earning and message censoring (mod only)')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Ignore a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to ignore').setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildVoice))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Unignore a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to unignore').setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildVoice))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all ignored channels')
    ),

  new SlashCommandBuilder()
    .setName('banwords')
    .setDescription('Manage the word censor list (mod only)')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a word to the censor list')
        .addStringOption(o => o.setName('word').setDescription('Word to ban').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all banned words')
    ),

  new SlashCommandBuilder()
    .setName('ping-hsbc')
    .setDescription('Ping the HSBC role (mod only)'),
];

function parseCloses(input) {
  if (!input) return null;
  const match = input.match(/^(\d+)([hmd])$/);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2];
    const ms = { h: 3600000, m: 60000, d: 86400000 }[unit];
    return new Date(Date.now() + val * ms);
  }
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

const LB_PAGE_SIZE = 10;

async function buildLeaderboardMessage(guildId, page) {
  const offset = (page - 1) * LB_PAGE_SIZE;
  const [lb, total] = await Promise.all([
    users.getLeaderboard(guildId, LB_PAGE_SIZE, offset),
    users.countLeaderboard(guildId),
  ]);

  const totalPages = Math.ceil(total / LB_PAGE_SIZE);
  const lines = lb.map((r, i) => `${offset + i + 1}. <@${r.discord_id}> — **${r.balance}** ${GRIST}`);

  const embed = new EmbedBuilder()
    .setTitle('Leaderboard')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Page ${page} of ${totalPages}` });

  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lb:${guildId}:1:f`).setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(isFirst),
    new ButtonBuilder().setCustomId(`lb:${guildId}:${page - 1}:p`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(isFirst),
    new ButtonBuilder().setCustomId(`lb:${guildId}:${page + 1}:n`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(isLast),
    new ButtonBuilder().setCustomId(`lb:${guildId}:${totalPages}:l`).setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(isLast),
  );

  return { embeds: [embed], components: [row], allowedMentions: { parse: [] }, total, totalPages };
}

async function handleInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === 'launch_activity') {
    return interaction.launchActivity();
  }

  if (interaction.isButton() && interaction.customId === 'market_cancel') {
    return interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
  }

  if (interaction.isButton() && interaction.customId.startsWith('market_resolve:')) {
    const [, marketIdStr, optionIdStr] = interaction.customId.split(':');
    const marketId = parseInt(marketIdStr, 10);
    const optionId = parseInt(optionIdStr, 10);

    const resolveGuild = interaction.guild;
    const resolveSettings = await guildSettings.getSettings(resolveGuild.id);
    const resolveHasMod = resolveSettings?.mod_role_id && interaction.member.roles.cache.has(resolveSettings.mod_role_id);
    if (!interaction.member.permissions.has('ManageGuild') && !resolveHasMod) {
      return interaction.update({ content: 'Permission denied.', embeds: [], components: [] });
    }

    const market = await markets.getById(marketId);
    if (!market) return interaction.update({ content: 'Market not found.', embeds: [], components: [] });
    if (market.status !== 'open' && market.status !== 'closed') {
      return interaction.update({ content: 'Market is already resolved or cancelled.', embeds: [], components: [] });
    }

    await markets.resolve(marketId, optionId);
    const payouts = await bets.payoutWinners(marketId, optionId);
    const winLabel = market.options.find(o => o.id === optionId)?.label || optionId;
    return interaction.update({
      content: `Market #${marketId} resolved! Winner: **${winLabel}**\n${payouts.length} payout(s) distributed.`,
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  if (interaction.isButton() && interaction.customId.startsWith('lb:')) {
    const [, guildId, pageStr] = interaction.customId.split(':'); // 4th segment is button role, ignored
    const page = parseInt(pageStr, 10);

    // Enforce the leaderboard channel whitelist for button interactions too
    const lbSettings = await guildSettings.getSettings(guildId);
    const allowedChannels = lbSettings?.leaderboard_channel_ids ?? [];
    if (allowedChannels.length > 0 && !allowedChannels.includes(interaction.channelId)) {
      return interaction.reply({ content: 'The leaderboard cannot be used in this channel.', ephemeral: true });
    }

    const msg = await buildLeaderboardMessage(guildId, page);
    return interaction.update({ embeds: msg.embeds, components: msg.components, allowedMentions: { parse: [] } });
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, user: discordUser } = interaction;

  if (!guild || !config.discord.allowedGuilds.includes(guild.id)) {
    return interaction.reply({ content: 'This server is not enabled for the prediction market.', ephemeral: true });
  }

  // Market-related commands require the market to be enabled
  const marketCommands = ['market', 'give-grist', 'channel-multiplier'];
  if (marketCommands.includes(commandName)) {
    const settings = await guildSettings.getSettings(guild.id);
    if (!settings?.market_enabled) {
      return interaction.reply({ content: 'The prediction market is not enabled on this server. An admin can enable it with `/setup enable_market:True`.', ephemeral: true });
    }
  }

  if (commandName === 'balance') {
    const balance = await users.getBalance(discordUser.id, guild.id);
    return interaction.reply({ content: `Your balance: **${balance}** ${GRIST}`, ephemeral: true });
  }

  if (commandName === 'leaderboard') {
    // Channel whitelist check
    const lbSettings = await guildSettings.getSettings(guild.id);
    const allowedChannels = lbSettings?.leaderboard_channel_ids ?? [];
    if (allowedChannels.length > 0 && !allowedChannels.includes(interaction.channelId)) {
      return interaction.reply({ content: 'The leaderboard cannot be used in this channel.', ephemeral: true });
    }

    const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
    const msg = await buildLeaderboardMessage(guild.id, page);

    if (msg.total === 0) {
      return interaction.reply({ content: `No one has earned ${GRIST} yet!`, allowedMentions: { parse: [] } });
    }
    if (page > msg.totalPages) {
      return interaction.reply({ content: `Page ${page} doesn't exist. There are only ${msg.totalPages} page(s).`, ephemeral: true });
    }

    return interaction.reply({ embeds: msg.embeds, components: msg.components, allowedMentions: { parse: [] } });
  }

  if (commandName === 'market') {
    const sub = interaction.options.getSubcommand();

    // All market subcommands are mod-only
    const settings = await guildSettings.getSettings(guild.id);
    const hasModRole = settings?.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id);
    if (!interaction.member.permissions.has('ManageGuild') && !hasModRole) {
      return interaction.reply({ content: 'You need the mod role to use market commands. Use the activity to trade!', ephemeral: true });
    }

    const user = await users.getOrCreate(discordUser.id, guild.id);

    if (sub === 'create') {
      const title = interaction.options.getString('title');
      const optionLabels = interaction.options.getString('options').split(',').map(s => s.trim()).filter(Boolean);
      const resolution = interaction.options.getString('resolution');
      const description = interaction.options.getString('description') || null;
      const closesAt = parseCloses(interaction.options.getString('closes'));

      if (optionLabels.length < 2) {
        return interaction.reply({ content: 'You need at least 2 options.', ephemeral: true });
      }

      const market = await createMarket(guild.id, user.id, title, description, resolution, closesAt, optionLabels);

      const optList = market.options.map(o => `  ${o.id}: ${o.label}`).join('\n');
      return interaction.reply({ content: `Market #${market.id} created: **${title}**\nResolution: ${resolution}\nOptions:\n${optList}`, allowedMentions: { parse: [] } });
    }

    if (sub === 'resolve') {
      const marketId = interaction.options.getInteger('market_id');
      const optionId = interaction.options.getInteger('option_id');

      const market = await markets.getById(marketId);
      if (!market) return interaction.reply({ content: 'Market not found.', ephemeral: true });
      if (market.status !== 'open' && market.status !== 'closed') {
        return interaction.reply({ content: 'Market is already resolved or cancelled.', ephemeral: true });
      }

      const winLabel = market.options.find(o => o.id === optionId)?.label;
      if (!winLabel) return interaction.reply({ content: 'Option not found in this market.', ephemeral: true });

      const confirmEmbed = new EmbedBuilder()
        .setTitle('Confirm Resolution')
        .setDescription(`**Market #${marketId}** — ${market.title}\n\nWinning option: **${winLabel}**\n\nThis will pay out all winners. You can undo with \`/market reopen\`.`)
        .setColor(0xED4245);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`market_resolve:${marketId}:${optionId}`).setLabel('Resolve').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('market_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      return interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true, allowedMentions: { parse: [] } });
    }

    if (sub === 'icon') {
      const marketId = interaction.options.getInteger('market_id');
      const attachment = interaction.options.getAttachment('image');

      const market = await markets.getById(marketId);
      if (!market) return interaction.reply({ content: 'Market not found.', ephemeral: true });

      const iconUrl = attachment ? attachment.url : null;
      await markets.setIcon(marketId, iconUrl);
      return interaction.reply({
        content: iconUrl ? `Icon set for Market #${marketId}.` : `Icon removed from Market #${marketId}.`,
        ephemeral: true,
      });
    }

    if (sub === 'reopen') {
      const marketId = interaction.options.getInteger('market_id');

      const market = await markets.getById(marketId);
      if (!market) return interaction.reply({ content: 'Market not found.', ephemeral: true });
      if (market.status !== 'resolved') {
        return interaction.reply({ content: 'Market is not resolved.', ephemeral: true });
      }

      const rolled = await bets.rollbackPayouts(marketId);
      await markets.reopen(marketId);
      return interaction.reply({ content: `Market #${marketId} reopened. ${rolled} payout(s) rolled back.`, allowedMentions: { parse: [] } });
    }
  }

  if (commandName === 'setup') {
    const isGameAdmin = config.discord.gameAdmins.includes(discordUser.id);
    if (!isGameAdmin && !interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({ content: 'You need Manage Server permission to use this command.', ephemeral: true });
    }

    const modRole = interaction.options.getRole('mod_role');
    const backfill = interaction.options.getBoolean('backfill') ?? false;
    const enableMarket = interaction.options.getBoolean('enable_market');
    const marketChannel = interaction.options.getChannel('market_channel');
    const leaderboardChannel = interaction.options.getChannel('leaderboard_channel');
    const modlogChannel = interaction.options.getChannel('modlog_channel');

    await guildSettings.setModRole(guild.id, modRole.id);

    const parts = [`Mod role set to **${modRole.name}**.`];

    if (enableMarket !== null) {
      await guildSettings.setMarketEnabled(guild.id, enableMarket);
      parts.push(enableMarket ? 'Prediction market **enabled**.' : 'Prediction market **disabled**.');
    }

    if (marketChannel) {
      await guildSettings.setMarketChannel(guild.id, marketChannel.id);
      parts.push(`New market announcements → <#${marketChannel.id}>.`);
    }

    if (leaderboardChannel) {
      // Add to existing whitelist rather than overwrite
      const existing = await guildSettings.getSettings(guild.id);
      const current = existing?.leaderboard_channel_ids ?? [];
      if (!current.includes(leaderboardChannel.id)) {
        await guildSettings.setLeaderboardChannels(guild.id, [...current, leaderboardChannel.id]);
      }
      parts.push(`/leaderboard whitelisted in <#${leaderboardChannel.id}>.`);
    }

    if (modlogChannel) {
      await guildSettings.setModlogChannel(guild.id, modlogChannel.id);
      parts.push(`Mod log → <#${modlogChannel.id}>.`);
    }

    let reply = `Setup complete!\n${parts.join('\n')}`;

    if (backfill) {
      await interaction.deferReply();
      let processed = 0;
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const channels = guild.channels.cache.filter(
        c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildForum
      );

      for (const [, channel] of channels) {
        try {
          let lastId = null;
          let done = false;
          while (!done) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            for (const [, msg] of messages) {
              if (msg.createdAt < oneWeekAgo) { done = true; break; }
              if (msg.author.bot) continue;
              const user = await users.getOrCreate(
                msg.author.id, guild.id,
                msg.author.username, msg.author.displayAvatarURL({ size: 64 })
              );
              const reward = Math.round(config.currency.baseReward * 100) / 100;
              await users.addBalance(user.id, reward, 'backfill', msg.id);
              processed++;
            }
            lastId = messages.last()?.id;
          }
        } catch { /* channel may not be readable */ }
      }

      return interaction.editReply({ content: `${reply}\n\nBackfill complete! Processed **${processed}** messages from the last week.`, allowedMentions: { parse: [] } });
    }

    return interaction.reply({ content: reply, allowedMentions: { parse: [] } });
  }

  if (commandName === 'channel-multiplier') {
    const channel = interaction.options.getChannel('channel');
    const multiplier = interaction.options.getNumber('multiplier');

    if (multiplier < 0 || multiplier > 10) {
      return interaction.reply({ content: 'Multiplier must be between 0 and 10.', ephemeral: true });
    }

    await guildSettings.setChannelMultiplier(guild.id, channel.id, multiplier);
    return interaction.reply({ content: `Channel <#${channel.id}> multiplier set to **${multiplier}x**. Threads in this channel will inherit this multiplier.`, allowedMentions: { parse: [] } });
  }

  if (commandName === 'give-grist') {
    // Check if user has mod role
    const settings = await guildSettings.getSettings(guild.id);
    const hasPermission = interaction.member.permissions.has('ManageGuild') ||
      (settings?.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id));

    if (!hasPermission) {
      return interaction.reply({ content: 'You need the mod role or Manage Server permission to give grist.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getNumber('amount');

    if (amount <= 0) return interaction.reply({ content: 'Amount must be positive.', ephemeral: true });

    const user = await users.getOrCreate(targetUser.id, guild.id, targetUser.username, targetUser.displayAvatarURL({ size: 64 }));
    await users.addBalance(user.id, amount, 'mod_give', discordUser.id);
    return interaction.reply({ content: `Gave **${amount}** ${GRIST} to <@${targetUser.id}>.`, allowedMentions: { parse: [] } });
  }

  if (commandName === 'post-play-message') {
    const settings = await guildSettings.getSettings(guild.id);
    const hasPermission = interaction.member.permissions.has('ManageGuild') ||
      (settings?.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id));

    if (!hasPermission) {
      return interaction.reply({ content: 'You need the mod role or Manage Server permission to use this command.', ephemeral: true });
    }

    const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;

    const embed = new EmbedBuilder()
      .setTitle('Guild Prediction Market')
      .setDescription(`Make predictions, place bets with ${GRIST}, and climb the leaderboard!\n\nClick the button below to launch the app.`)
      .setColor(0x5865F2);

    const button = new ButtonBuilder()
      .setLabel('Play Now')
      .setStyle(ButtonStyle.Primary)
      .setCustomId('launch_activity');

    const row = new ActionRowBuilder().addComponents(button);

    await targetChannel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
    return interaction.reply({ content: `Play Now message posted in <#${targetChannel.id}>!`, ephemeral: true });
  }

  if (commandName === 'ignore-channel') {
    const settings = await guildSettings.getSettings(guild.id);
    const hasMod = interaction.member.permissions.has('ManageGuild') ||
      (settings?.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id));
    if (!hasMod) {
      return interaction.reply({ content: 'You need the mod role or Manage Server permission to use this command.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const channel = interaction.options.getChannel('channel');
      await guildSettings.addExcludedChannel(guild.id, channel.id);
      return interaction.reply({ content: `<#${channel.id}> is now ignored — no grist or censoring there.`, ephemeral: true });
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      await guildSettings.removeExcludedChannel(guild.id, channel.id);
      return interaction.reply({ content: `<#${channel.id}> is no longer ignored.`, ephemeral: true });
    }

    if (sub === 'list') {
      const excluded = settings?.excluded_channel_ids ?? [];
      if (excluded.length === 0) {
        return interaction.reply({ content: 'No channels are being ignored.', ephemeral: true });
      }
      return interaction.reply({ content: `**Ignored channels:**\n${excluded.map(id => `<#${id}>`).join('\n')}`, ephemeral: true, allowedMentions: { parse: [] } });
    }
  }

  if (commandName === 'banwords') {
    const settings = await guildSettings.getSettings(guild.id);
    const hasMod = interaction.member.permissions.has('ManageGuild') ||
      (settings?.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id));
    if (!hasMod) {
      return interaction.reply({ content: 'You need the mod role or Manage Server permission to use this command.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const word = interaction.options.getString('word').toLowerCase().trim();
      await bannedWords.addWord(guild.id, word);
      return interaction.reply({ content: `Added \`${word}\` to the censor list.`, ephemeral: true });
    }

    if (sub === 'list') {
      const words = await bannedWords.listWords(guild.id);
      if (words.length === 0) {
        return interaction.reply({ content: 'No banned words configured.', ephemeral: true });
      }
      return interaction.reply({ content: `**Banned words:**\n${words.map(w => `\`${w}\``).join(', ')}`, ephemeral: true });
    }
  }

  if (commandName === 'ping-hsbc') {
    const settings = await guildSettings.getSettings(guild.id);
    const hasMod = interaction.member.permissions.has('ManageGuild') ||
      (settings?.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id));
    if (!hasMod) {
      return interaction.reply({ content: 'You need the mod role or Manage Server permission to use this command.', ephemeral: true });
    }
    await interaction.channel.send('<@&1495516829546971166>');
    return interaction.reply({ content: 'Done.', ephemeral: true });
  }
}

export {  commands, handleInteraction  };
