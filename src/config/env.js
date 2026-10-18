import 'dotenv/config';

//ließt umgebungsvariablen aus .env zentral aus, gilt für gesamtes projekt

export function getConfig() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT muss eine gültige Portnummer sein.');
  }
  const dbClient = process.env.DB_CLIENT ?? 'sqlite';
  if (!['sqlite', 'postgres'].includes(dbClient)) {
    throw new Error('DB_CLIENT muss sqlite oder postgres sein.');
  }
  if (dbClient === 'postgres' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL wird für PostgreSQL benötigt.');
  }
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    host: process.env.HOST ?? '127.0.0.1',
    port,
    dbClient,
    sqliteFile: process.env.SQLITE_FILE ?? './data/lacedaemon.sqlite',
    databaseUrl: process.env.DATABASE_URL,
    sitePassword: process.env.SITE_PASSWORD ?? '',
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID ?? '',
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
      redirectUri: process.env.DISCORD_REDIRECT_URI ?? `http://localhost:${port}/api/auth/discord/callback`,
      guildId: process.env.DISCORD_GUILD_ID ?? '',
    },
  };
}
