import { Router } from 'express';

export function catalogRoutes(service) {
  const router = Router();
  router.get('/:category', async (req, res) => {
    res.json({ items: await service.list(req.params.category) });
  });
  router.post('/:category/reviews', async (req, res) => {
    const result = await service.addReview(req.params.category, req.body);
    res.status(201).json({ ok: true, ...result });
  });
  return router;
}
