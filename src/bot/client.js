// Shared reference to the Discord client so other modules can check guild state
let client = null;

function setClient(c) { client = c; }
function getClient() { return client; }

function isBotInGuild(guildId) {
  return client?.guilds?.cache?.has(guildId) ?? false;
}

export {  setClient, getClient, isBotInGuild  };
