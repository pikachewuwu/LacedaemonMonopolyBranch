//verbindung zur sqlite db

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openSqlite(file) {
  const filename = file === ':memory:' ? file : path.resolve(process.cwd(), file);
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  if (filename !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.exec(readFileSync(path.join(migrationsDir, 'sqlite.sql'), 'utf8'));
  return {
    dialect: 'sqlite',
    async all(sql, values = []) { return sqlite.prepare(sql).all(...values); },
    async get(sql, values = []) { return sqlite.prepare(sql).get(...values) ?? null; },
    async run(sql, values = []) { return sqlite.prepare(sql).run(...values); },
    async close() { sqlite.close(); },
  };
}
