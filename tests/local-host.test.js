import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request } from 'node:http';
import { localHost } from '../src/middleware/local-host.js';
import { makeAccessGate } from '../src/middleware/access.js';

function requestWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { Host: host } }, response => {
      response.resume();
      response.once('end', () => resolve({ status: response.statusCode, headers: new Headers(response.headers) }));
    });
    req.once('error', reject);
    req.end();
  });
}

test('Local page aliases redirect to localhost before issuing access cookies', async () => {
  const app = express();
  app.use(localHost);
  const access = makeAccessGate('test-password', { secure: false });
  app.use(access.routes);
  app.use(access.middleware);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const alias of ['127.0.0.1', '127.0.0.0', '[::1]']) {
      const response = await requestWithHost(`${base}/pages/profile.html?tab=stats`, `${alias}:${port}`);
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('location'), `http://localhost:${port}/pages/profile.html?tab=stats`);
      assert.equal(response.headers.get('set-cookie'), null);
    }
    const canonical = await requestWithHost(`${base}/pages/profile.html`, `localhost:${port}`);
    assert.equal(canonical.status, 401);
    assert.equal(canonical.headers.get('location'), null);
    const externalLookingPath = await fetch(`${base}//evil.example/path`, { redirect: 'manual' });
    assert.equal(new URL(externalLookingPath.headers.get('location')).hostname, 'localhost');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('Local canonicalization does not change API requests, assets, POSTs or other hosts', async () => {
  const app = express();
  app.use(localHost);
  app.use((_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const url of ['/api/auth/me', '/assets/css/base.css', '/socket.io/', '/favicon.ico']) {
      assert.equal((await fetch(base + url, { redirect: 'manual' })).status, 200);
    }
    assert.equal((await fetch(`${base}/access`, { method: 'POST', redirect: 'manual' })).status, 200);
    for (const host of ['localhost', '192.168.1.10', 'example.com']) {
      assert.equal((await requestWithHost(base, `${host}:${port}`)).status, 200);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
