import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { authRoutes } from '../src/modules/auth/auth.routes.js';

test('Login normalizes the host before setting the state cookie and preserves returnTo', async () => {
  const app = express();
  app.use('/api/auth', authRoutes({ enabled: true }, {
    secure: false, redirectUri: 'http://localhost:3000/api/auth/discord/callback',
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const target = '/pages/profile.html?tab=info#profil';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/discord?returnTo=${encodeURIComponent(target)}`, { redirect: 'manual' });
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.origin, 'http://localhost:3000');
    assert.equal(destination.pathname, '/api/auth/discord');
    assert.equal(destination.searchParams.get('returnTo'), target);
    assert.equal(response.headers.get('set-cookie'), null);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Login preserves returnTo through the OAuth cookie and callback', async () => {
  const app = express();
  app.use('/api/auth', authRoutes({
    enabled: true,
    newState: () => 'test-state',
    authorizeUrl: () => 'https://discord.com/oauth2/authorize',
    loginWithCode: async () => ({ token: 'test-session' }),
  }, { secure: false }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  try {
    for (const target of ['/', '/pages/profile.html', '/pages/anime.html?q=test#liste', '/pages/monopoly.html']) {
      const start = await fetch(`${base}/discord?returnTo=${encodeURIComponent(target)}`, { redirect: 'manual' });
      const cookie = start.headers.getSetCookie()[0].split(';')[0];
      const callback = await fetch(`${base}/discord/callback?state=test-state&code=test-code`, {
        headers: { Cookie: cookie }, redirect: 'manual',
      });
      assert.equal(callback.status, 302);
      assert.equal(callback.headers.get('location'), target);
    }
    const start = await fetch(`${base}/discord`, { redirect: 'manual' });
    const cookie = start.headers.getSetCookie()[0].split(';')[0];
    const callback = await fetch(`${base}/discord/callback?state=test-state&code=test-code`, {
      headers: { Cookie: cookie }, redirect: 'manual',
    });
    assert.equal(callback.headers.get('location'), '/');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
