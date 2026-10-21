import { Router } from 'express';

export function gamesRoutes(service, auth) {
  const router = Router();
  router.get('/members', async (req, res) => {
    const member = await auth.memberFromCookieHeader(req.headers.cookie);
    res.set('Cache-Control', 'no-store');
    res.json({ members: await service.members(member) });
  });
  router.get('/search', async (req, res) => res.json(await service.search(req.query.q, req.query.page ?? 1)));
  router.get('/steam/:appId', async (req, res) => res.json({ game: await service.details(req.params.appId) }));
  router.get('/', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ items: await service.list() });
  });
  router.post('/:appId/reviews', async (req, res) => {
    const member = await auth.memberFromCookieHeader(req.headers.cookie);
    if (!member) return res.status(401).json({ error: 'Bitte melde dich zuerst mit Discord an.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON erforderlich.' });
    const result = await service.addReview(req.params.appId, req.body, member);
    res.status(201).json({ ok: true, ...result });
  });
  router.delete('/:appId', async (req, res) => {
    const member = await auth.memberFromCookieHeader(req.headers.cookie);
    const result = await service.deleteGame(req.params.appId, member);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...result });
  });
  return router;
}
