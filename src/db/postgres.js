//verbindung zur postgres db

import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Unsere Repository-Queries nutzen ? als Platzhalter. PostgreSQL erwartet $1, $2 usw.
function postgresPlaceholders(sql) {
  let count = 0;
  return sql.replace(/\?/g, () => `$${++count}`);
}

export async function openPostgres(url) {
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(readFileSync(path.join(migrationsDir, 'postgres.sql'), 'utf8'));
    return {
      dialect: 'postgres',
      async all(sql, values = []) {
        const result = await pool.query(postgresPlaceholders(sql), values);
        return result.rows;
      },
      async get(sql, values = []) {
        const result = await pool.query(postgresPlaceholders(sql), values);
        return result.rows[0] ?? null;
      },
      async run(sql, values = []) {
        const result = await pool.query(postgresPlaceholders(sql), values);
        return { changes: result.rowCount };
      },
      async close() { await pool.end(); },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
