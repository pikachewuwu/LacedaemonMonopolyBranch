//entscheidet, welche datenbank config genutzt wird (also postgres oder lite) müssen uns noch draug einigen was genau

import { openSqlite } from './sqlite.js';
import { openPostgres } from './postgres.js';

export async function openDatabase(config) {
  if (config.dbClient === 'postgres') return openPostgres(config.databaseUrl);
  return openSqlite(config.sqliteFile);
}
