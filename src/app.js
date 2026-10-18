//konfiguriert express, verbindet routen, services, repositories

import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCatalogRepository } from './modules/catalog/catalog.repository.js';
import { makeCatalogService } from './modules/catalog/catalog.service.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { makeLeaderboardRepository } from './modules/leaderboard/leaderboard.repository.js';
import { leaderboardRoutes } from './modules/leaderboard/leaderboard.routes.js';
import { overviewRoutes } from './modules/overview/overview.routes.js';
import { makeAuthRepository } from './modules/auth/auth.repository.js';
import { makeAuthService } from './modules/auth/auth.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { loadMaps } from './modules/monopoly/maps/index.js';
import { makeRoomManager } from './modules/monopoly/lobbies/rooms.js';
import { makeMonopolyRepository } from './modules/monopoly/monopoly.repository.js';
import { monopolyRoutes, saveFinishedGame } from './modules/monopoly/monopoly.routes.js';
import { notFound, errorHandler } from './middleware/error-handler.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp(db, config = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        // discord-avatare und der monopoly-websocket
        'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        // ohne https (z.b. im heimnetz per ip) würde der browser sonst alle dateien per https anfragen
        'upgrade-insecure-requests': config.nodeEnv === 'production' ? [] : null,
      },
    },
  }));
  app.use(express.json({ limit: '32kb' }));

  const catalogService = makeCatalogService(makeCatalogRepository(db));
  const leaderboardRepository = makeLeaderboardRepository(db);
  const auth = makeAuthService(makeAuthRepository(db), config.discord ?? {});
  const maps = loadMaps();
  const monopolyRepository = makeMonopolyRepository(db);
  const rooms = makeRoomManager({ maps, onFinished: saveFinishedGame(monopolyRepository) });
  // server.js hängt den websocket an dieselben objekte
  app.locals.monopoly = { auth, maps, rooms };

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/catalog', catalogRoutes(catalogService));
  app.use('/api/leaderboard', leaderboardRoutes(leaderboardRepository));
  app.use('/api/overview', overviewRoutes(catalogService, leaderboardRepository));
  app.use('/api/auth', authRoutes(auth, { secure: config.nodeEnv === 'production' }));
  app.use('/api/monopoly', monopolyRoutes({ maps, rooms, repository: monopolyRepository }));
  app.use('/api', notFound);

  // einladungslink: /play/abcde
  app.get('/play/:roomId', (req, res) => {
    res.redirect(`/pages/monopoly.html#/room/${encodeURIComponent(req.params.roomId.toLowerCase().replace(/[^a-z]/g, ''))}`);
  });
  app.use(express.static(publicDir, { extensions: ['html'], index: 'index.html' }));
  app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));
  app.use(errorHandler);
  return app;
}
