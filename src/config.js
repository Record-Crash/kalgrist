import "dotenv/config";

const allowedGuilds = process.env.ALLOWED_GUILD_IDS
  ? process.env.ALLOWED_GUILD_IDS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const gameAdmins = process.env.GAME_ADMIN
  ? process.env.GAME_ADMIN.split(',').map(s => s.trim()).filter(Boolean)
  : [];

export default {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    allowedGuilds,
    gameAdmins,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    activityUrl: process.env.ACTIVITY_URL || 'http://localhost:3000',
  },
  apiSports: {
    widgetKey: process.env.API_SPORTS_WIDGET_KEY || '',
  },
  currency: {
    baseReward: parseFloat(process.env.CURRENCY_BASE_REWARD) || 1,
    cooldownMs: parseInt(process.env.CURRENCY_MESSAGE_COOLDOWN_MS, 10) || 5000,
    maxLengthMultiplier: parseFloat(process.env.CURRENCY_MAX_LENGTH_MULTIPLIER) || 3,
    reactionBonus: parseFloat(process.env.CURRENCY_REACTION_BONUS) || 0.5,
  },
};
