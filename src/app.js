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
import { makeAccessGate } from './middleware/access.js';
import { localHost } from './middleware/local-host.js';
import { makeSteamService } from './modules/games/steam.service.js';
import { makeGamesRepository } from './modules/games/games.repository.js';
import { makeGamesService } from './modules/games/games.service.js';
import { gamesRoutes } from './modules/games/games.routes.js';
import { makeMalService } from './modules/anime/mal.service.js';
import { makeAnimeRepository } from './modules/anime/anime.repository.js';
import { makeAnimeService } from './modules/anime/anime.service.js';
import { animeRoutes } from './modules/anime/anime.routes.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp(db, config = {}, { steam = makeSteamService(), animeSource = makeMalService() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        // discord-avatare und der monopoly-websocket
        'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com',
          'https://steamstatic.com', 'https://*.steamstatic.com',
          'https://steamcdn-a.akamaihd.net', 'https://*.steamcdn-a.akamaihd.net',
          'https://steamusercontent.com', 'https://*.steamusercontent.com', 'https://cdn.myanimelist.net'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        // ohne https (z.b. im heimnetz per ip) würde der browser sonst alle dateien per https anfragen
        'upgrade-insecure-requests': config.nodeEnv === 'production' ? [] : null,
      },
    },
  }));
  // hinter dem proxy des hosters (render & co.) die echte ip für die sperre nach fehlversuchen
  if (config.nodeEnv === 'production') app.set('trust proxy', 1);
  if (config.nodeEnv === 'development') app.use(localHost);
  const access = makeAccessGate(config.sitePassword, { secure: config.nodeEnv === 'production' });
  app.use(access.routes);
  app.use(access.middleware);
  // Browsers request this conventional URL when no page-specific icon is declared.
  app.get('/favicon.ico', (_req, res) => {
    res.sendFile(path.join(publicDir, 'assets/img/lacedaemon-favicon.jpg'));
  });
  app.use(express.json({ limit: '32kb' }));

  const catalogRepository = makeCatalogRepository(db);
  const games = makeGamesService(makeGamesRepository(db), steam, catalogRepository);
  const anime = makeAnimeService(makeAnimeRepository(db), animeSource, catalogRepository);
  const catalogService = makeCatalogService(catalogRepository, { games, anime });
  const leaderboardRepository = makeLeaderboardRepository(db);
  const auth = makeAuthService(makeAuthRepository(db), config.discord ?? {});
  const maps = loadMaps();
  const monopolyRepository = makeMonopolyRepository(db);
  const rooms = makeRoomManager({ maps, onFinished: saveFinishedGame(monopolyRepository) });
  // server.js hängt den websocket an dieselben objekte
  app.locals.monopoly = { auth, maps, rooms, access };

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/catalog', catalogRoutes(catalogService));
  app.use('/api/games', gamesRoutes(games, auth));
  app.use('/api/anime', animeRoutes(anime, auth));
  app.use('/api/leaderboard', leaderboardRoutes(leaderboardRepository));
  app.use('/api/overview', overviewRoutes(catalogService, leaderboardRepository));
  app.use('/api/auth', authRoutes(auth, {
    secure: config.nodeEnv === 'production',
    redirectUri: config.discord?.redirectUri,
  }));
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
