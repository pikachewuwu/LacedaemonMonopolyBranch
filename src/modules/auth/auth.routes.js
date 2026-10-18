import { Router } from 'express';
import { cookieOptions, parseCookies } from '../../middleware/cookies.js';
import { SESSION_COOKIE, SESSION_DAYS, STATE_COOKIE, safeReturnTo } from './auth.service.js';

export function authRoutes(service, { secure }) {
  const router = Router();

  router.get('/me', async (req, res) => {
    const member = await service.memberFromCookieHeader(req.headers.cookie);
    res.json({ member, discordEnabled: service.enabled });
  });

  router.get('/discord', (req, res) => {
    if (!service.enabled) return res.status(503).json({ error: 'Discord-Login ist noch nicht eingerichtet (DISCORD_CLIENT_ID/SECRET).' });
    const state = service.newState();
    const returnTo = safeReturnTo(req.query.returnTo);
    res.cookie(STATE_COOKIE, `${state}|${returnTo}`, cookieOptions(secure, 10 * 60_000));
    res.redirect(service.authorizeUrl(state));
  });

  router.get('/discord/callback', async (req, res) => {
    const saved = parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '';
    const [state, returnTo] = [saved.slice(0, saved.indexOf('|')), saved.slice(saved.indexOf('|') + 1)];
    res.clearCookie(STATE_COOKIE, { path: '/' });
    if (!state || req.query.state !== state || typeof req.query.code !== 'string') {
      return res.redirect('/pages/monopoly.html#login-failed');
    }
    try {
      const { token } = await service.loginWithCode(req.query.code);
      res.cookie(SESSION_COOKIE, token, cookieOptions(secure, SESSION_DAYS * 86_400_000));
      res.redirect(safeReturnTo(returnTo));
    } catch (error) {
      console.error('Discord-Login fehlgeschlagen:', error.message);
      res.redirect(`/pages/monopoly.html#login-failed`);
    }
  });

  router.post('/logout', async (req, res) => {
    await service.logout(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return router;
}
