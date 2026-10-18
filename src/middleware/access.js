// zugangssperre für testserver: ein gemeinsames passwort (SITE_PASSWORD), danach merkt sich der browser 30 tage ein cookie.
// das cookie enthält nur einen hmac des passworts; wird das passwort geändert, müssen alle neu rein.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, urlencoded } from 'express';
import { cookieOptions, parseCookies } from './cookies.js';

export const ACCESS_COOKIE = 'lcd_access';
const ACCESS_DAYS = 30;
const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60_000;
// ohne passwort erreichbar: health-check (für das hosting) und alles, was die passwortseite braucht
const OPEN_PATHS = new Set(['/api/health', '/access', '/assets/img/lacedaemon-favicon.jpg']);

const sha = text => createHash('sha256').update(String(text)).digest();

function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !value.startsWith('/access')
    ? value : '/pages/monopoly.html';
}

const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(next, message = '') {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lacedaemon</title><link rel="icon" href="/assets/img/lacedaemon-favicon.jpg"></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 600px at 50% 0%,#142338,#070b11 70%);color:#eef2f6;font-family:Inter,'Segoe UI',system-ui,sans-serif">
<form method="post" action="/access" style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:32px;width:min(340px,calc(100vw - 32px));border-radius:18px;background:rgba(18,26,36,.85);border:1px solid rgba(214,173,119,.18);box-shadow:0 20px 60px rgba(0,0,0,.5)">
<img src="/assets/img/lacedaemon-favicon.jpg" alt="" width="96" height="96" style="border-radius:50%;box-shadow:0 0 50px rgba(120,200,255,.35)">
<h1 style="margin:4px 0 0;font:700 1.4rem Georgia,serif;letter-spacing:.14em">LACEDAEMON</h1>
<p style="margin:0;color:#9baabc;font-size:.92rem;text-align:center">Nur für eingeladene Freunde. Bitte das Passwort eingeben.</p>
<input type="hidden" name="next" value="${escape(next)}">
<input type="password" name="password" required autofocus autocomplete="current-password" placeholder="Passwort" aria-label="Passwort"
 style="width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(214,173,119,.3);background:#0e1721;color:#eef2f6;font:inherit;text-align:center">
${message ? `<p role="alert" style="margin:0;color:#ff8f8f;font-size:.88rem">${escape(message)}</p>` : ''}
<button style="width:100%;padding:12px;border:0;border-radius:12px;background:linear-gradient(180deg,#f4cf94,#d6ad77);color:#1e1915;font-family:inherit;font-size:1rem;font-weight:700;cursor:pointer">Eintreten</button>
</form></body></html>`;
}

export function makeAccessGate(password, { secure = false, now = () => Date.now() } = {}) {
  const enabled = Boolean(password);
  const token = enabled ? createHmac('sha256', password).update('lcd-access-v1').digest('hex') : '';
  const failures = new Map();

  /** Hat dieser browser schon das richtige passwort eingegeben? */
  function allowed(cookieHeader) {
    if (!enabled) return true;
    const given = Buffer.from(parseCookies(cookieHeader)[ACCESS_COOKIE] ?? '');
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  function middleware(req, res, next) {
    if (!enabled || OPEN_PATHS.has(req.path) || allowed(req.headers.cookie)) return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return res.status(401).json({ error: 'Zugang gesperrt.' });
    res.status(401).type('html').send(page(req.originalUrl));
  }

  const routes = Router();
  routes.get('/access', (req, res) => {
    if (!enabled) return res.redirect('/');
    res.type('html').send(page(safeNext(req.query.next)));
  });
  routes.post('/access', urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    if (!enabled) return res.redirect('/');
    const key = req.ip ?? 'unknown';
    const entry = failures.get(key);
    if (entry && entry.until > now() && entry.count >= MAX_FAILURES) {
      return res.status(429).type('html').send(page(safeNext(req.body?.next), 'Zu viele Versuche. Bitte in 15 Minuten erneut probieren.'));
    }
    if (!timingSafeEqual(sha(req.body?.password ?? ''), sha(password))) {
      const fresh = entry && entry.until > now() ? entry : { count: 0, until: now() + LOCK_MS };
      fresh.count++;
      failures.set(key, fresh);
      return res.status(401).type('html').send(page(safeNext(req.body?.next), 'Falsches Passwort.'));
    }
    failures.delete(key);
    res.cookie(ACCESS_COOKIE, token, cookieOptions(secure, ACCESS_DAYS * 86_400_000));
    res.redirect(303, safeNext(req.body?.next));
  });

  return { enabled, allowed, middleware, routes };
}
