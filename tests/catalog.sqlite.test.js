import test from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../src/db/sqlite.js';
import { makeCatalogRepository } from '../src/modules/catalog/catalog.repository.js';
import { makeCatalogService } from '../src/modules/catalog/catalog.service.js';

test('Bewertungen werden gruppiert und bei erneutem Speichern aktualisiert', async () => {
  const db = openSqlite(':memory:');
  try {
    const service = makeCatalogService(makeCatalogRepository(db));
    await service.addReview('anime', { title: 'Naruto', memberName: 'Alex', score: 8, status: 'completed' });
    await service.addReview('anime', { title: 'naruto', memberName: 'Sam', score: 10, status: 'ongoing' });
    await service.addReview('anime', { title: 'Naruto', memberName: 'alex', score: 6, status: 'completed' });
    const list = await service.list('anime');
    assert.equal(list.length, 1);
    assert.equal(list[0].ratings.length, 2);
    assert.equal(list[0].averageScore, 8);
    assert.deepEqual(await service.counts(), { anime: 1, games: 0 });
  } finally {
    await db.close();
  }
});
