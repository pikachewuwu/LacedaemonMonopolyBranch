//verbindung zur sqlite db

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function migrateSteamGameReviews(sqlite) {
  if (!sqlite.pragma('table_info(steam_game_reviews)').some(column => column.name === 'priority')) {
    sqlite.transaction(() => sqlite.exec(readFileSync(path.join(migrationsDir, 'sqlite-game-reviews-v2.sql'), 'utf8')))();
  }
}

export function migrateAnimeEntries(sqlite) {
  const table = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mal_anime_entries'").get();
  if (table && !table.sql.includes('CONSTRAINT mal_anime_entries_fields_check')) {
    sqlite.transaction(() => sqlite.exec(readFileSync(path.join(migrationsDir, 'sqlite-anime-entries-v2.sql'), 'utf8')))();
  }
}

export function openSqlite(file) {
  const filename = file === ':memory:' ? file : path.resolve(process.cwd(), file);
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  if (filename !== ':memory:') sqlite.pragma('journal_mode = WAL');
  try {
    sqlite.exec(readFileSync(path.join(migrationsDir, 'sqlite.sql'), 'utf8'));
    migrateSteamGameReviews(sqlite);
    migrateAnimeEntries(sqlite);
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return {
    dialect: 'sqlite',
    async all(sql, values = []) { return sqlite.prepare(sql).all(...values); },
    async get(sql, values = []) { return sqlite.prepare(sql).get(...values) ?? null; },
    async run(sql, values = []) { return sqlite.prepare(sql).run(...values); },
    async batch(statements) {
      return sqlite.transaction(() => statements.map(({ sql, values = [] }) => sqlite.prepare(sql).run(...values)))();
    },
    async close() { sqlite.close(); },
  };
}
