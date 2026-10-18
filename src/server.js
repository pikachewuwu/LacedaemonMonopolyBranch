//startet die anwendung, lädt konfig aus env.js öffnet db, startet express, startet server etc... schließt db verbindung wieder 

import { getConfig } from './config/env.js';
import { openDatabase } from './db/index.js';
import { seedDemoData } from './db/seed.js';
import { createApp } from './app.js';
import { attachMonopolySocket } from './modules/monopoly/realtime/socket.js';

async function start() {
  const config = getConfig();
  const db = await openDatabase(config);
  try {
    await seedDemoData(db);
    const app = createApp(db, config);
    const server = app.listen(config.port, config.host, () => {
      console.log(`Lacedaemon gestartet: http://${config.host}:${server.address().port}`);
      console.log(`Datenbank: ${config.dbClient} | Entwicklungsmodus: ${config.nodeEnv}`);
    });
    const io = attachMonopolySocket(server, app.locals.monopoly);
    let closing = false;
    async function shutdown() {
      if (closing) return;
      closing = true;
      app.locals.monopoly.rooms.dispose();
      io.close();
      server.close(async () => {
        await db.close();
        process.exit(0);
      });
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    await db.close();
    throw error;
  }
}

start().catch(error => {
  console.error('Server konnte nicht gestartet werden:', error);
  process.exitCode = 1;
});
