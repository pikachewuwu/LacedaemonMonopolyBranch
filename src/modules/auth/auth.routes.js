import { Router } from 'express';
import { cookieOptions, parseCookies } from '../../middleware/cookies.js';
import { SESSION_COOKIE, SESSION_DAYS, STATE_COOKIE, safeReturnTo } from './auth.service.js';

export function authRoutes(service, { secure, redirectUri }) {
  const router = Router();
  const loginOrigin = redirectUri ? new URL(redirectUri) : null;

  router.get('/profile', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const member = await service.memberFromCookieHeader(req.headers.cookie);
    if (!member) return res.status(401).json({ error: 'Bitte zuerst anmelden.' });
    res.json(await service.getProfile(member.id));
  });

  router.put('/profile', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const member = await service.memberFromCookieHeader(req.headers.cookie);
    if (!member) return res.status(401).json({ error: 'Bitte zuerst anmelden.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON erforderlich.' });
    res.json(await service.updateProfile(member.id, req.body?.description));
  });

  router.get('/me', async (req, res) => {
    const member = await service.memberFromCookieHeader(req.headers.cookie);
    res.json({ member, discordEnabled: service.enabled });
  });

  router.get('/discord', (req, res) => {
    if (!service.enabled) return res.status(503).json({ error: 'Discord-Login ist noch nicht eingerichtet (DISCORD_CLIENT_ID/SECRET).' });
    const returnTo = safeReturnTo(req.query.returnTo);
    // Set the state cookie on the same host that receives Discord's callback.
    if (loginOrigin && req.get('host') !== loginOrigin.host) {
      const loginUrl = new URL('/api/auth/discord', loginOrigin);
      loginUrl.searchParams.set('returnTo', returnTo);
      return res.redirect(loginUrl.href);
    }
    const state = service.newState();
    res.cookie(STATE_COOKIE, `${state}|${returnTo}`, cookieOptions(secure, 10 * 60_000));
    res.redirect(service.authorizeUrl(state));
  });

  router.get('/discord/callback', async (req, res) => {
    const saved = parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '';
    const [state, returnTo] = [saved.slice(0, saved.indexOf('|')), saved.slice(saved.indexOf('|') + 1)];
    res.clearCookie(STATE_COOKIE, { path: '/' });
    if (!state || req.query.state !== state || typeof req.query.code !== 'string') {
      return res.redirect(safeReturnTo(returnTo));
    }
    try {
      const { token } = await service.loginWithCode(req.query.code);
      res.cookie(SESSION_COOKIE, token, cookieOptions(secure, SESSION_DAYS * 86_400_000));
      res.redirect(safeReturnTo(returnTo));
    } catch (error) {
      console.error('Discord-Login fehlgeschlagen:', error.message);
      res.redirect(safeReturnTo(returnTo));
    }
  });

  router.post('/logout', async (req, res) => {
    await service.logout(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return router;
}
