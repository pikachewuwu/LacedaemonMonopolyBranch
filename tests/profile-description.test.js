import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import { openSqlite } from '../src/db/sqlite.js';
import { makeAuthRepository } from '../src/modules/auth/auth.repository.js';
import { makeAuthService } from '../src/modules/auth/auth.service.js';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { errorHandler } from '../src/middleware/error-handler.js';

test('Profile descriptions persist independently of Discord profile updates', async () => {
  const db = openSqlite(':memory:');
  try {
    const repository = makeAuthRepository(db);
    const service = makeAuthService(repository, {});
    const discordUser = { discordUserId: '123', username: 'alex', displayName: 'Alex', avatar: null };
    const id = await repository.upsertMember(discordUser);
    assert.equal((await service.getProfile(id)).description, 'Mitglied der Lacedaemon-Community.');
    await service.updateProfile(id, '  Hallo\nLacedaemon!  ');
    await repository.upsertMember({ ...discordUser, displayName: 'Alex neu' });
    const reloaded = makeAuthService(makeAuthRepository(db), {});
    assert.equal((await reloaded.getProfile(id)).description, 'Hallo\nLacedaemon!');
    await service.updateProfile(id, '');
    assert.equal((await reloaded.getProfile(id)).description, '');
    await assert.rejects(service.updateProfile(id, 'a'.repeat(501)), /500/);
    await assert.rejects(service.updateProfile(id, null), /500/);
    assert.equal((await reloaded.getProfile(id)).description, '');
  } finally {
    await db.close();
  }
});

test('Profile API authenticates updates and only changes the session owner', async () => {
  const db = openSqlite(':memory:');
  const repository = makeAuthRepository(db);
  const member = { discordUserId: '123', username: 'alex', displayName: 'Alex', avatar: null };
  const id = await repository.upsertMember(member);
  const otherId = await repository.upsertMember({ ...member, discordUserId: '456' });
  const tokenHash = createHash('sha256').update('test-session').digest('hex');
  await repository.createSession(tokenHash, id, Date.now() + 60000);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes(makeAuthService(repository, {}), { secure: false }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/profile`;
  const headers = { Cookie: 'lcd_session=test-session', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const response = await fetch(url, {
      method: 'PUT', headers, body: JSON.stringify({ description: "Ich spiele gern.\nHallo 'Welt'!", memberId: otherId }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { description: "Ich spiele gern.\nHallo 'Welt'!" });
    const loaded = await fetch(url, { headers });
    assert.equal((await loaded.json()).description, "Ich spiele gern.\nHallo 'Welt'!");
    assert.equal(await repository.getDescription(otherId), null);
    const invalid = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ description: 'x'.repeat(501) }) });
    assert.equal(invalid.status, 400);
    assert.equal(await repository.getDescription(id), "Ich spiele gern.\nHallo 'Welt'!");
    await repository.deleteSession(tokenHash);
    assert.equal((await fetch(url, { method: 'PUT', headers, body: '{"description":"test"}' })).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});
