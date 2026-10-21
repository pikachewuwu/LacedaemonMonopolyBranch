import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateAnimeEntries, openSqlite } from '../src/db/sqlite.js';

function legacyDatabase(filename = ':memory:', extendedStatuses = false) {
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(new URL('../src/db/migrations/sqlite.sql', import.meta.url), 'utf8'));
  sqlite.exec(`DROP TABLE mal_anime_entries;
    CREATE TABLE mal_anime_entries (
      mal_id INTEGER NOT NULL REFERENCES mal_anime(mal_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('watching', 'plan_to_watch', 'completed'${extendedStatuses ? ", 'on_hold', 'dropped'" : ''})),
      watched_episodes INTEGER CHECK (watched_episodes BETWEEN 0 AND 100000),
      score INTEGER CHECK (score BETWEEN 1 AND 10),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (mal_id, member_id),
      CHECK ((status = 'plan_to_watch' AND watched_episodes IS NULL AND score IS NULL)
        OR (status = 'watching' AND watched_episodes IS NOT NULL AND score IS NULL)
        OR (status = 'completed' AND watched_episodes IS NOT NULL AND watched_episodes > 0))
    );
    CREATE INDEX idx_mal_anime_entries_member ON mal_anime_entries(member_id);
    INSERT INTO members (id, discord_user_id, username, display_name) VALUES
      (1, '123', 'alex', 'Alex'), (2, '456', 'sam', 'Sam'), (3, '789', 'lee', 'Lee');
    INSERT INTO mal_anime (mal_id, title, metadata_json, fetched_at, creator_member_id)
      VALUES (1, 'Cowboy Bebop', '{}', 1, 1);
    INSERT INTO mal_anime_entries (mal_id, member_id, status, watched_episodes, score, created_at, updated_at) VALUES
      (1, 1, 'watching', 4, NULL, '2026-01-01 12:00:00', '2026-01-02 12:00:00'),
      (1, 2, 'completed', 26, 9, '2026-01-03 12:00:00', '2026-01-04 12:00:00'),
      (1, 3, 'plan_to_watch', NULL, NULL, '2026-01-05 12:00:00', '2026-01-06 12:00:00');`);
  return sqlite;
}

for (const extendedStatuses of [false, true]) {
  test(`Anime migration preserves entries and constraints from ${extendedStatuses ? 'partially updated' : 'original'} schemas`, () => {
    const sqlite = legacyDatabase(':memory:', extendedStatuses);
    try {
      const before = sqlite.prepare('SELECT * FROM mal_anime_entries ORDER BY member_id').all();
      migrateAnimeEntries(sqlite);
      assert.deepEqual(sqlite.prepare('SELECT * FROM mal_anime_entries ORDER BY member_id').all(), before);
      const update = sqlite.prepare('UPDATE mal_anime_entries SET status = ?, watched_episodes = ?, score = ? WHERE member_id = 1');
      for (const status of ['on_hold', 'dropped']) {
        update.run(status, 4, null);
        assert.equal(sqlite.prepare('SELECT status FROM mal_anime_entries WHERE member_id = 1').get().status, status);
        assert.throws(() => update.run(status, null, null), /CHECK constraint/);
        assert.throws(() => update.run(status, 4, 8), /CHECK constraint/);
      }
      assert.throws(() => update.run('unknown', 4, null), /CHECK constraint/);
      assert.throws(() => update.run('plan_to_watch', 4, null), /CHECK constraint/);
      assert.throws(() => update.run('completed', 0, null), /CHECK constraint/);
      assert.throws(() => update.run('completed', 26, 11), /CHECK constraint/);
      assert.ok(sqlite.pragma('index_list(mal_anime_entries)').some(index => index.name === 'idx_mal_anime_entries_member'));
      assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
      const after = sqlite.prepare('SELECT * FROM mal_anime_entries ORDER BY member_id').all();
      migrateAnimeEntries(sqlite);
      assert.deepEqual(sqlite.prepare('SELECT * FROM mal_anime_entries ORDER BY member_id').all(), after);
      sqlite.prepare('DELETE FROM members WHERE id = 1').run();
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM mal_anime_entries').get().total, 2);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM mal_anime').get().total, 1);
    } finally { sqlite.close(); }
  });
}

test('Opening an existing SQLite file upgrades anime checks once and preserves saved progress on reopen', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lacedaemon-anime-migration-'));
  const filename = path.join(directory, 'anime.sqlite');
  let db;
  try {
    legacyDatabase(filename).close();
    db = openSqlite(filename);
    await db.run("UPDATE mal_anime_entries SET status = 'on_hold' WHERE member_id = 1");
    await db.close(); db = null;
    db = openSqlite(filename);
    assert.deepEqual(await db.get('SELECT status, watched_episodes, created_at FROM mal_anime_entries WHERE member_id = 1'),
      { status: 'on_hold', watched_episodes: 4, created_at: '2026-01-01 12:00:00' });
    assert.equal((await db.get('SELECT COUNT(*) AS total FROM mal_anime_entries')).total, 3);
    await db.run("UPDATE mal_anime_entries SET status = 'dropped' WHERE member_id = 1");
  } finally {
    if (db) await db.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  }
});

test('A failed anime migration rolls back the rebuild without losing the original table or entries', () => {
  const sqlite = legacyDatabase();
  try {
    sqlite.pragma('ignore_check_constraints = ON');
    sqlite.prepare('UPDATE mal_anime_entries SET score = 20 WHERE member_id = 2').run();
    sqlite.pragma('ignore_check_constraints = OFF');
    const before = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'mal_anime_entries'").get();
    assert.throws(() => migrateAnimeEntries(sqlite), /CHECK constraint/);
    assert.deepEqual(sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'mal_anime_entries'").get(), before);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM mal_anime_entries').get().total, 3);
    assert.equal(sqlite.prepare('SELECT score FROM mal_anime_entries WHERE member_id = 2').get().score, 20);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'mal_anime_entries_v2'").get(), undefined);
  } finally { sqlite.close(); }
});
