import { Router } from 'express';

export function animeRoutes(service, auth) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/search', async (req, res) => res.json(await service.search(req.query.q, req.query.page ?? 1)));
  router.get('/season', async (_req, res) => res.json(await service.season()));
  router.get('/mal/:id', async (req, res) => res.json({ anime: await service.details(req.params.id) }));
  router.get('/members', async (req, res) => res.json({ members: await service.members(await auth.memberFromCookieHeader(req.headers.cookie)) }));
  router.get('/', async (_req, res) => res.json({ items: await service.list() }));
  router.post('/:id/entries', async (req, res) => {
    const member = await auth.memberFromCookieHeader(req.headers.cookie);
    if (!member) return res.status(401).json({ error: 'Bitte melde dich zuerst mit Discord an.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON erforderlich.' });
    res.status(201).json({ ok: true, ...await service.addEntry(req.params.id, req.body, member) });
  });
  router.delete('/:id', async (req, res) => res.json({ ok: true,
    ...await service.deleteAnime(req.params.id, await auth.memberFromCookieHeader(req.headers.cookie)) }));
  return router;
}
