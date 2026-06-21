import {  REST, Routes  } from "discord.js";
import config from "../config.js";
import {  commands  } from "./commands.js";

const rest = new REST({ version: '10' }).setToken(config.discord.token);

// Remove any global slash commands to avoid duplicates with per-guild commands
async function clearGlobalSlashCommands() {
  const existing = await rest.get(Routes.applicationCommands(config.discord.clientId));
  const slashCmds = existing.filter(cmd => cmd.type === 1);
  for (const cmd of slashCmds) {
    await rest.delete(Routes.applicationCommand(config.discord.clientId, cmd.id));
  }
  if (slashCmds.length > 0) {
    console.log(`Cleared ${slashCmds.length} global slash command(s).`);
  }
}

// Ensures the Entry Point command stays silent (handler: 1 = APP_HANDLER suppresses Discord's "Join Now" message)
async function registerGlobalEntryPoint() {
  const existing = await rest.get(Routes.applicationCommands(config.discord.clientId));
  const entryPoints = existing.filter(cmd => cmd.type === 4);

  if (entryPoints.length === 0) return;

  for (const ep of entryPoints) {
    const { id, application_id, version, ...body } = ep;
    await rest.patch(Routes.applicationCommand(config.discord.clientId, id), { body: { ...body, handler: 1 } });
  }
  console.log(`Entry Point command(s) patched to silent mode.`);
}

async function registerCommandsForGuild(guildId) {
  const body = commands.map(c => c.toJSON());
  console.log(`Registering ${body.length} commands for guild ${guildId}...`);
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body });
  console.log(`Commands registered for guild ${guildId}.`);
}

async function registerCommands(guilds) {
  await clearGlobalSlashCommands().catch(err =>
    console.error('Failed to clear global slash commands:', err.message)
  );
  await registerGlobalEntryPoint().catch(err =>
    console.error('Failed to patch Entry Point command:', err.message)
  );
  for (const guildId of guilds) {
    try {
      await registerCommandsForGuild(guildId);
    } catch (err) {
      console.error(`Failed to register commands for guild ${guildId}:`, err.message);
    }
  }
}

export {  registerCommands  };
