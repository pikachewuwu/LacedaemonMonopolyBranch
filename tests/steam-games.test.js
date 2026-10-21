import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openSqlite, migrateSteamGameReviews } from '../src/db/sqlite.js';
import { createApp } from '../src/app.js';
import { makeAuthRepository } from '../src/modules/auth/auth.repository.js';
import { makeCatalogRepository } from '../src/modules/catalog/catalog.repository.js';
import { makeGamesRepository } from '../src/modules/games/games.repository.js';

const game = {
  steamAppId: 620, title: 'Portal 2',
  shortDescription: 'Kooperative Rätsel aus dem Steam Store.',
  headerImage: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/header.jpg',
  genres: ['Action', 'Abenteuer'],
  storeUrl: 'https://store.steampowered.com/app/620/',
  price: { currency: 'EUR', final: 975, formatted: '9,75€', isFree: false },
  players: { label: 'Koop', coop: true, coopPlayers: null, multiplayer: true, singlePlayer: true },
  metadataUpdatedAt: '2026-10-19T12:00:00.000Z',
};

const oldReviewsSchema = `CREATE TABLE steam_game_reviews (
  steam_app_id INTEGER NOT NULL REFERENCES steam_games(app_id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  status TEXT NOT NULL CHECK (status IN ('planned', 'ongoing', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (steam_app_id, member_id)
);`;

test('A failed review rolls back the game metadata and cannot leave a phantom game', async () => {
  const db = openSqlite(':memory:');
  try {
    const repository = makeGamesRepository(db);
    await assert.rejects(repository.saveReview(game, { memberId: 99999, score: 8, status: 'planned' }));
    assert.equal(await repository.count(), 0);
    assert.equal((await db.get('SELECT COUNT(*) AS total FROM steam_game_reviews')).total, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS total FROM steam_game_entries')).total, 0);
  } finally {
    await db.close();
  }
});

async function setup() {
  const db = openSqlite(':memory:');
  const auth = makeAuthRepository(db);
  const firstId = await auth.upsertMember({ discordUserId: '123', username: 'alex-one', displayName: 'Alex', avatar: 'first-avatar' });
  const secondId = await auth.upsertMember({ discordUserId: '456', username: 'alex-two', displayName: 'Alex', avatar: null });
  for (const [token, id] of [['first-session', firstId], ['second-session', secondId]]) {
    await auth.createSession(createHash('sha256').update(token).digest('hex'), id, Date.now() + 60_000);
  }
  let detailCalls = 0;
  const steam = {
    async details(id) {
      assert.equal(Number(id), 620);
      detailCalls += 1;
      return structuredClone(game);
    },
    async search() { return { items: [structuredClone(game)], total: 1, page: 1, hasMore: false }; },
  };
  const app = createApp(db, {}, { steam });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    db, auth, firstId, secondId, origin,
    detailCalls: () => detailCalls,
    review(body, token = 'first-session') {
      return fetch(`${origin}/api/games/620/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `lcd_session=${token}` } : {}) },
        body: JSON.stringify(body),
      });
    },
    remove(id = 620, token = 'first-session') {
      return fetch(`${origin}/api/games/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: token ? { Cookie: `lcd_session=${token}` } : {},
      });
    },
    async close() {
      app.locals.monopoly.rooms.dispose();
      await new Promise(resolve => server.close(resolve));
      await db.close();
    },
  };
}

test('Steam game reviews require a live session before loading metadata or saving anything', async () => {
  const fixture = await setup();
  try {
    for (const token of [null, 'forged-session']) {
      assert.equal((await fixture.review({ score: 8, status: 'ongoing' }, token)).status, 401);
    }
    await fixture.auth.deleteSession(createHash('sha256').update('first-session').digest('hex'));
    assert.equal((await fixture.review({ score: 8, status: 'ongoing' })).status, 401);
    assert.equal(fixture.detailCalls(), 0);
    assert.equal((await fixture.db.get('SELECT COUNT(*) AS total FROM steam_game_reviews')).total, 0);
  } finally {
    await fixture.close();
  }
});

test('Steam game reviews use server metadata and session identity and update one review per member', async () => {
  const fixture = await setup();
  try {
    const posted = await fixture.review({
      score: 8, status: 'ongoing', memberId: fixture.secondId, memberName: 'Fake identity',
      title: 'Fake title', genres: ['Fake genre'], description: 'Fake description',
      avatarUrl: 'https://attacker.example/avatar.png',
      headerImage: 'https://attacker.example/game.png',
      creatorMemberId: fixture.secondId, createdAt: '2000-01-01T00:00:00Z',
    });
    assert.equal(posted.status, 201);
    const firstRow = await fixture.db.get('SELECT * FROM steam_game_reviews WHERE steam_app_id = ?', [620]);
    assert.equal(Number(firstRow.member_id), fixture.firstId);
    assert.equal(firstRow.score, null);
    assert.equal(firstRow.status, 'ongoing');
    const storedGame = await fixture.db.get('SELECT * FROM steam_games WHERE app_id = ?', [620]);
    assert.equal(storedGame.title, 'Portal 2');
    assert.deepEqual(JSON.parse(storedGame.metadata_json), game);
    assert.equal((await fixture.review({ score: 6, status: 'completed' })).status, 201);
    assert.equal((await fixture.review({ score: 10, status: 'planned' }, 'second-session')).status, 201);
    const rows = await fixture.db.all('SELECT * FROM steam_game_reviews WHERE steam_app_id = ? ORDER BY member_id', [620]);
    assert.equal(rows.length, 2, 'Identical Discord display names must remain separate members');
    assert.equal(Number(rows[0].member_id), fixture.firstId);
    assert.equal(Number(rows[0].score), 6);
    assert.equal(rows[0].status, 'completed');
    assert.equal(Number(rows[1].member_id), fixture.secondId);
    assert.equal(rows[1].score, null);
    assert.equal(rows[1].priority, 'medium');

    const response = await fetch(`${fixture.origin}/api/games`);
    assert.equal(response.status, 200);
    const { items } = await response.json();
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Portal 2');
    assert.equal(items[0].ratings.length, 2);
    assert.equal(items[0].averageScore, 6);
    assert.equal(items[0].creatorMemberId, fixture.firstId);
    assert.ok(Number.isFinite(Date.parse(items[0].createdAt)));
    assert.notEqual(items[0].createdAt, '2000-01-01T00:00:00Z');
    assert.ok(items[0].ratings.every(review => review.memberName === 'Alex'));
    assert.ok(items[0].ratings.every(review => new URL(review.avatarUrl).hostname === 'cdn.discordapp.com'));
    assert.match(items[0].ratings.find(review => Number(review.memberId) === fixture.firstId).avatarUrl, /first-avatar/);
  } finally {
    await fixture.close();
  }
});

test('Only the creator can delete a game, including all its reviews, and dashboard counts follow', async () => {
  const fixture = await setup();
  try {
    assert.equal((await fixture.review({ score: 8, status: 'planned' })).status, 201);
    assert.equal((await fixture.review({ score: 9, status: 'ongoing' }, 'second-session')).status, 201);
    for (const token of [null, 'forged-session']) assert.equal((await fixture.remove(620, token)).status, 401);
    assert.equal((await fixture.remove(620, 'second-session')).status, 403);
    assert.equal((await fixture.db.get('SELECT COUNT(*) AS total FROM steam_game_reviews')).total, 2);
    const deleted = await fixture.remove();
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true, itemId: 'steam:620' });
    for (const table of ['steam_games', 'steam_game_entries', 'steam_game_reviews']) {
      assert.equal((await fixture.db.get(`SELECT COUNT(*) AS total FROM ${table}`)).total, 0);
    }
    assert.deepEqual((await (await fetch(`${fixture.origin}/api/games`)).json()).items, []);
    assert.equal((await (await fetch(`${fixture.origin}/api/overview`)).json()).counts.games, 0);
    assert.equal((await fixture.remove()).status, 404);
    assert.equal(fixture.detailCalls(), 2, 'Deleting must work independently of Steam availability');
  } finally {
    await fixture.close();
  }
});

test('Expired sessions and invalid game IDs cannot delete games or affect legacy records', async () => {
  const fixture = await setup();
  try {
    await makeCatalogRepository(fixture.db).saveReview('games', { title: 'Altes Spiel', memberName: 'Alex', score: 7, status: 'planned' });
    await fixture.review({ score: 8, status: 'planned' });
    for (const id of ['legacy:1', '0', '-1', '620 OR 1=1', '4294967296']) {
      assert.equal((await fixture.remove(id)).status, 400);
    }
    await fixture.auth.deleteSession(createHash('sha256').update('first-session').digest('hex'));
    assert.equal((await fixture.remove()).status, 401);
    assert.equal((await fixture.db.get('SELECT COUNT(*) AS total FROM steam_games')).total, 1);
    assert.equal((await fixture.db.get('SELECT COUNT(*) AS total FROM catalog_items')).total, 1);
  } finally {
    await fixture.close();
  }
});

test('Review changes preserve the original creator and added date, even when metadata changes', async () => {
  const fixture = await setup();
  try {
    await fixture.review({ score: 8, status: 'planned' });
    await fixture.db.run('UPDATE steam_game_entries SET created_at = ? WHERE steam_app_id = ?', ['2026-01-01 12:00:00', 620]);
    await makeGamesRepository(fixture.db).saveReview({ ...game, metadataUpdatedAt: '2026-12-01T00:00:00.000Z' },
      { memberId: fixture.secondId, score: 9, status: 'completed' });
    const [entry] = await makeGamesRepository(fixture.db).list();
    assert.equal(entry.creatorMemberId, fixture.firstId);
    assert.equal(entry.createdAt, '2026-01-01T12:00:00.000Z');
    assert.equal(entry.metadataUpdatedAt, '2026-12-01T00:00:00.000Z');
    assert.equal((await fixture.remove(620, 'second-session')).status, 403);
    await fixture.db.run('DELETE FROM members WHERE id = ?', [fixture.firstId]);
    await fixture.review({ score: 10, status: 'planned' }, 'second-session');
    const [orphan] = await makeGamesRepository(fixture.db).list();
    assert.equal(orphan.creatorMemberId, null, 'A deleted creator must not transfer ownership to another reviewer');
    assert.equal((await fixture.remove(620, 'second-session')).status, 403);
  } finally {
    await fixture.close();
  }
});

test('Existing Steam data migrates without loss and only an unambiguous first reviewer becomes creator', () => {
  const migration = readFileSync(new URL('../src/db/migrations/sqlite.sql', import.meta.url), 'utf8');
  const previousSchema = (migration.slice(0, migration.indexOf('-- Unveränderlicher'))
    + migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS sessions')))
    .replace(/CREATE TABLE IF NOT EXISTS steam_game_reviews \([\s\S]*?\n\);/, oldReviewsSchema);
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(previousSchema);
    const member = db.prepare('INSERT INTO members (id, discord_user_id, username, display_name) VALUES (?, ?, ?, ?)');
    member.run(1, '123', 'first', 'Alex');
    member.run(2, '456', 'second', 'Alex');
    const insertGame = db.prepare('INSERT INTO steam_games (app_id, title, metadata_json, fetched_at) VALUES (?, ?, ?, ?)');
    for (const id of [10, 20, 30, 40]) insertGame.run(id, `Spiel ${id}`, JSON.stringify({ ...game, steamAppId: id }), Date.parse(game.metadataUpdatedAt));
    const review = db.prepare('INSERT INTO steam_game_reviews (steam_app_id, member_id, score, status, created_at) VALUES (?, ?, 8, ?, ?)');
    review.run(10, 1, 'planned', '2026-01-01 12:00:00');
    review.run(10, 2, 'completed', '2026-01-02 12:00:00');
    review.run(20, 1, 'planned', '2026-01-03 12:00:00');
    review.run(20, 2, 'planned', '2026-01-03 12:00:00');
    review.run(40, 2, 'planned', '2026-01-01 12:00:00');
    review.run(40, 1, 'planned', '2026-01-02 12:00:00');
    db.exec(migration);
    migrateSteamGameReviews(db);
    const entries = () => db.prepare('SELECT steam_app_id, creator_member_id, created_at FROM steam_game_entries ORDER BY steam_app_id').all();
    assert.deepEqual(entries().map(row => row.creator_member_id), [1, null, null, 2]);
    assert.equal(entries()[0].created_at, '2026-01-01 12:00:00');
    assert.equal(entries()[2].created_at, '2026-10-19 12:00:00');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM steam_game_reviews').get().total, 6);
    assert.ok(db.prepare("SELECT * FROM steam_game_reviews WHERE status = 'planned'").all().every(row => row.score === null && row.priority === 'medium'));
    assert.equal(db.prepare("SELECT score FROM steam_game_reviews WHERE status = 'completed'").get().score, 8);
    db.prepare('DELETE FROM members WHERE id = 1').run();
    db.exec(migration);
    migrateSteamGameReviews(db);
    assert.deepEqual(entries().map(row => row.creator_member_id), [null, null, null, 2], 'A restart must not assign unknown ownership to surviving reviewers');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM steam_games').get().total, 4);
  } finally {
    db.close();
  }
});

test('Invalid scores and statuses do not overwrite an existing Steam review', async () => {
  const fixture = await setup();
  try {
    assert.equal((await fixture.review({ score: 8, status: 'paused' })).status, 201);
    for (const body of [
      { score: 11, status: 'paused' }, { score: 0, status: 'paused' },
      { score: 8.5, status: 'completed' }, { score: 8, status: 'unknown' },
      { status: 'planned', priority: 'urgent' }, { status: 'completed' },
    ]) {
      assert.equal((await fixture.review(body)).status, 400);
    }
    const row = await fixture.db.get('SELECT score, status FROM steam_game_reviews WHERE member_id = ?', [fixture.firstId]);
    assert.equal(Number(row.score), 8);
    assert.equal(row.status, 'paused');
  } finally {
    await fixture.close();
  }
});

test('Existing manual games remain listed and counted alongside Steam games', async () => {
  const fixture = await setup();
  try {
    const legacy = makeCatalogRepository(fixture.db);
    await legacy.saveReview('games', { title: 'Altes Spiel', memberName: 'Altmitglied', score: 7, status: 'planned' });
    await legacy.saveReview('anime', { title: 'Anime', memberName: 'Altmitglied', score: 7, status: 'planned' });
    assert.equal((await fixture.review({ score: 8, status: 'ongoing' })).status, 201);
    for (const path of ['/api/games', '/api/catalog/games']) {
      const response = await fetch(`${fixture.origin}${path}`);
      assert.equal(response.status, 200);
      const { items } = await response.json();
      assert.deepEqual(items.map(item => item.title).sort(), ['Altes Spiel', 'Portal 2']);
    }
    const overview = await fetch(`${fixture.origin}/api/overview`);
    assert.deepEqual((await overview.json()).counts, { anime: 1, games: 2 });
    const oldWrite = await fetch(`${fixture.origin}/api/catalog/games/reviews`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Spoofed', memberName: 'Fake', score: 9, status: 'completed' }),
    });
    assert.ok(oldWrite.status >= 400 && oldWrite.status < 500, 'The legacy route must not allow arbitrary unauthenticated game writes');
    assert.equal((await legacy.list('games')).length, 1);
  } finally {
    await fixture.close();
  }
});

test('Wishlist priorities and ongoing status have no score; only paused and completed scores affect the average', async () => {
  const fixture = await setup();
  try {
    for (const input of [
      { status: 'planned', priority: 'high', score: 10 },
      { status: 'ongoing', score: 10, priority: 'high' },
      { status: 'paused', score: 4, priority: 'low' },
      { status: 'completed', score: 9 },
      { status: 'planned', priority: 'low' },
    ]) {
      assert.equal((await fixture.review(input)).status, 201);
      const [entry] = await makeGamesRepository(fixture.db).list();
      const scored = ['paused', 'completed'].includes(input.status);
      assert.equal(entry.ratings[0].score, scored ? input.score : null);
      assert.equal(entry.ratings[0].priority, input.status === 'planned' ? input.priority : null);
      assert.equal(entry.averageScore, scored ? input.score : null);
    }
    await fixture.review({ status: 'completed', score: 8 }, 'second-session');
    assert.equal((await makeGamesRepository(fixture.db).list())[0].averageScore, 8);
    await fixture.review({ status: 'paused', score: 4 });
    assert.equal((await makeGamesRepository(fixture.db).list())[0].averageScore, 6);
  } finally { await fixture.close(); }
});

test('Additional members receive default wishlists without overwriting their existing entries or changing the creator', async () => {
  const fixture = await setup();
  try {
    assert.equal((await fetch(`${fixture.origin}/api/games/members`)).status, 401);
    const members = await (await fetch(`${fixture.origin}/api/games/members`, { headers: { Cookie: 'lcd_session=first-session' } })).json();
    assert.equal(members.members.length, 2, 'All registered members, including those without reviews, must be selectable');
    assert.deepEqual(members.members.map(member => member.id).sort(), [fixture.firstId, fixture.secondId]);
    assert.equal((await fixture.review({ status: 'planned', priority: 'high', memberIds: [fixture.secondId, fixture.secondId, fixture.firstId] })).status, 201);
    let [entry] = await makeGamesRepository(fixture.db).list();
    assert.equal(entry.creatorMemberId, fixture.firstId);
    assert.equal(entry.ratings.length, 2);
    assert.equal(entry.ratings.find(rating => rating.memberId === fixture.firstId).priority, 'high');
    assert.deepEqual(entry.ratings.filter(rating => rating.memberId === fixture.secondId).map(({ status, priority, score }) => ({ status, priority, score })),
      [{ status: 'planned', priority: 'medium', score: null }]);
    await fixture.review({ status: 'paused', score: 7 }, 'second-session');
    await fixture.review({ status: 'ongoing', memberIds: [fixture.secondId] });
    [entry] = await makeGamesRepository(fixture.db).list();
    assert.equal(entry.ratings.find(rating => rating.memberId === fixture.secondId).score, 7);
    assert.equal(entry.ratings.find(rating => rating.memberId === fixture.secondId).status, 'paused');
    assert.equal(entry.creatorMemberId, fixture.firstId);
    for (const memberIds of [[999999], ['2'], [-1], '2', Array(51).fill(fixture.secondId)]) {
      assert.equal((await fixture.review({ status: 'planned', memberIds })).status, 400);
    }
    assert.equal((await makeGamesRepository(fixture.db).list())[0].ratings.length, 2);
  } finally { await fixture.close(); }
});

test('A failed additional membership rolls back the game, creator and all included entries together', async () => {
  const fixture = await setup();
  try {
    await assert.rejects(makeGamesRepository(fixture.db).saveReview(game,
      { memberId: fixture.firstId, status: 'planned', memberIds: [fixture.secondId, 999999] }));
    for (const table of ['steam_games', 'steam_game_reviews', 'steam_game_entries']) {
      assert.equal((await fixture.db.get(`SELECT COUNT(*) AS total FROM ${table}`)).total, 0);
    }
  } finally { await fixture.close(); }
});
