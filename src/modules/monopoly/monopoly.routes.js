import { Router } from 'express';
import { mapSummary } from './maps/index.js';
import { DEFAULT_SETTINGS, SETTINGS_CATALOG } from './settings.js';
import { COLORS, SHAPES, TEAMS } from './lobbies/appearance.js';

export function monopolyRoutes({ maps, rooms, repository }) {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json({ settings: SETTINGS_CATALOG, defaults: DEFAULT_SETTINGS, colors: COLORS, shapes: SHAPES, teams: TEAMS });
  });

  router.get('/maps', (_req, res) => {
    res.json({ maps: [...maps.values()].map(mapSummary) });
  });

  router.get('/maps/:id', (req, res) => {
    const map = maps.get(req.params.id);
    if (!map) return res.status(404).json({ error: 'Unbekannte Map.' });
    res.json({ map });
  });

  router.get('/rooms', (_req, res) => {
    res.json({ rooms: rooms.listPublic() });
  });

  router.get('/games/recent', async (_req, res) => {
    res.json({ games: await repository.recent(8) });
  });

  return router;
}

/** Ergebnis einer beendeten partie speichern. */
export function saveFinishedGame(repository) {
  return room => {
    const g = room.game;
    const top = g.player(g.standings()[0]);
    const member = room.participant(top.id)?.memberId ?? null;
    repository.saveGame({
      roomId: room.id,
      mapId: g.map.id,
      startedAt: g.stats.startedAt,
      endedAt: g.stats.endedAt,
      turns: g.stats.turns,
      winnerName: top.name,
      winnerMemberId: member,
      players: g.standings().map(id => ({ name: g.player(id).name, netWorth: g.netWorth(id), bot: g.player(id).isBot })),
    }).catch(error => console.error('Partie konnte nicht gespeichert werden:', error));
  };
}
