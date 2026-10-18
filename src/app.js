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
import { notFound, errorHandler } from './middleware/error-handler.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));

  const catalogService = makeCatalogService(makeCatalogRepository(db));
  const leaderboardRepository = makeLeaderboardRepository(db);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/catalog', catalogRoutes(catalogService));
  app.use('/api/leaderboard', leaderboardRoutes(leaderboardRepository));
  app.use('/api/overview', overviewRoutes(catalogService, leaderboardRepository));
  app.use('/api', notFound);

  app.use(express.static(publicDir, { extensions: ['html'], index: 'index.html' }));
  app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));
  app.use(errorHandler);
  return app;
}
