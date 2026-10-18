import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { openSqlite } from '../src/db/sqlite.js';
import { createApp } from '../src/app.js';
import { attachMonopolySocket } from '../src/modules/monopoly/realtime/socket.js';

async function start(sitePassword) {
  const db = openSqlite(':memory:');
  const app = createApp(db, { sitePassword });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const io = attachMonopolySocket(server, app.locals.monopoly);
  const url = `http://127.0.0.1:${server.address().port}`;
  const stop = async () => {
    app.locals.monopoly.rooms.dispose();
    io.close();
    server.close();
    await db.close();
  };
  return { url, stop };
}

const login = (url, password) => fetch(`${url}/access`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password, next: '/play/abcde' }),
});

function socketWorks(url, cookie) {
  return new Promise(resolve => {
    const socket = connect(url, { auth: { guestToken: 'token-access-test-0123' }, extraHeaders: cookie ? { cookie } : {}, transports: ['polling'], reconnection: false });
    socket.on('hello', () => { socket.close(); resolve(true); });
    socket.on('connect_error', () => { socket.close(); resolve(false); });
  });
}

test('mit SITE_PASSWORD: ohne passwort kein zugang, mit passwort cookie und zugang', async () => {
  const { url, stop } = await start('geheim-123');
  try {
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    const pageResponse = await fetch(`${url}/pages/monopoly.html`);
    assert.equal(pageResponse.status, 401);
    assert.match(await pageResponse.text(), /Passwort/);
    assert.equal((await fetch(`${url}/api/monopoly/maps`)).status, 401);
    assert.equal(await socketWorks(url), false);

    assert.equal((await login(url, 'falsch')).status, 401);
    const ok = await login(url, 'geheim-123');
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/play/abcde');
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.match(ok.headers.get('set-cookie'), /HttpOnly/i);
    assert.equal((await fetch(`${url}/api/monopoly/maps`, { headers: { cookie } })).status, 200);
    assert.equal(await socketWorks(url, cookie), true);
    assert.equal((await fetch(`${url}/api/monopoly/maps`, { headers: { cookie: 'lcd_access=nachgemacht' } })).status, 401);
  } finally {
    await stop();
  }
});

test('nach zu vielen fehlversuchen wird gesperrt', async () => {
  const { url, stop } = await start('geheim-123');
  try {
    for (let i = 0; i < 8; i++) await login(url, `falsch-${i}`);
    assert.equal((await login(url, 'geheim-123')).status, 429);
  } finally {
    await stop();
  }
});

test('ohne SITE_PASSWORD bleibt alles offen (lokale entwicklung)', async () => {
  const { url, stop } = await start('');
  try {
    assert.equal((await fetch(`${url}/api/monopoly/maps`)).status, 200);
    assert.equal(await socketWorks(url), true);
  } finally {
    await stop();
  }
});

test('der weiterleitungsziel nach dem login bleibt auf der eigenen seite', async () => {
  const { url, stop } = await start('geheim-123');
  try {
    const response = await fetch(`${url}/access`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'geheim-123', next: '//evil.example' }),
    });
    assert.equal(response.headers.get('location'), '/pages/monopoly.html');
  } finally {
    await stop();
  }
});
