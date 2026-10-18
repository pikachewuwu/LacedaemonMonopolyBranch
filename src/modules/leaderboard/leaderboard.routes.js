import { Router } from 'express';

export function leaderboardRoutes(repository) {
  const router = Router();
  router.get('/', async (_req, res) => {
    const members = await repository.list();
    res.json({ members, isDemo: members.length > 0 && members.every(member => member.isDemo) });
  });
  return router;
}
