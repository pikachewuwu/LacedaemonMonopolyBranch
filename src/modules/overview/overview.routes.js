import { Router } from 'express';

export function overviewRoutes(catalogService, leaderboardRepository) {
  const router = Router();
  router.get('/', async (_req, res) => {
    const [counts, members] = await Promise.all([
      catalogService.counts(),
      leaderboardRepository.list(),
    ]);
    res.json({
      counts,
      leaderboard: members,
      leaderboardIsDemo: members.length > 0 && members.every(member => member.isDemo),
    });
  });
  return router;
}
