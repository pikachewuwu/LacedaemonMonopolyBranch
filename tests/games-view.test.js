import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortGames, memberOptions } from '../public/assets/js/pages/games-view.js';

const games = [
  { id: 'alpha', title: 'Alpha', createdAt: '2026-01-01T00:00:00Z', genres: ['Rätsel', 'Action'], price: { final: 500 },
    ratings: [{ memberId: 1, memberName: 'Alex', status: 'planned' }, { memberId: 2, memberName: 'Alex', status: 'planned' }] },
  { id: 'beta', title: 'Beta', createdAt: '2026-01-02T00:00:00Z', genres: ['Simulation'], price: { final: 2000 },
    ratings: [{ memberId: 1, memberName: 'Alex', status: 'planned' }, { memberId: 2, memberName: 'Alex', status: 'ongoing' }] },
  { id: 'gamma', title: 'Gamma', createdAt: '2026-01-03T00:00:00Z', genres: ['Abenteuer'], price: { isFree: true },
    ratings: [{ memberId: 2, memberName: 'Alex', status: 'planned' }] },
  { id: 'empty', title: 'Delta', createdAt: '2026-01-04T00:00:00Z', genres: [], price: null, ratings: [] },
  { id: 'legacy', title: 'Legacy', createdAt: '2026-01-05T00:00:00Z',
    ratings: [{ memberName: 'Alex', status: 'completed' }] },
];
const ids = (options, entries = games) => filterAndSortGames(entries, options).map(game => game.id);

test('Member filters use the intersection of wishlists and never infer identity from display names', () => {
  assert.equal(ids({ memberIds: [] }).length, 5, 'No selection must include games without watchers');
  assert.deepEqual(ids({ memberIds: [1] }), ['beta', 'alpha']);
  assert.deepEqual(ids({ memberIds: ['2'] }), ['gamma', 'alpha']);
  assert.deepEqual(ids({ memberIds: [1, '2', 1] }), ['alpha']);
  assert.deepEqual(ids({ memberIds: ['unknown'] }), []);
  assert.deepEqual(memberOptions(games), [{ id: '1', name: 'Alex' }, { id: '2', name: 'Alex' }]);
});

test('Status filtering composes with wishlist member filtering and includes matching legacy records', () => {
  assert.deepEqual(ids({ status: 'planned' }), ['gamma', 'beta', 'alpha']);
  assert.deepEqual(ids({ status: 'ongoing' }), ['beta']);
  assert.deepEqual(ids({ status: 'completed' }), ['legacy']);
  assert.deepEqual(ids({ memberIds: [1], status: 'ongoing' }), ['beta']);
  assert.deepEqual(ids({ memberIds: [1, 2], status: 'ongoing' }), []);
});

test('Added date, popularity, price and genre sorting produce the requested order', () => {
  assert.deepEqual(ids({ sort: 'newest' }), ['legacy', 'empty', 'gamma', 'beta', 'alpha']);
  assert.deepEqual(ids({ sort: 'oldest' }), ['alpha', 'beta', 'gamma', 'empty', 'legacy']);
  assert.deepEqual(ids({ sort: 'popular' }), ['alpha', 'beta', 'gamma', 'empty', 'legacy']);
  assert.deepEqual(ids({ sort: 'price-desc' }), ['beta', 'alpha', 'gamma', 'empty', 'legacy']);
  assert.deepEqual(ids({ sort: 'price-asc' }), ['gamma', 'alpha', 'beta', 'empty', 'legacy']);
  assert.deepEqual(ids({ sort: 'genre' }), ['gamma', 'alpha', 'beta', 'empty', 'legacy']);
});

test('Unavailable prices stay last in both directions and never use an old initial price', () => {
  const entries = [
    { id: 'discount', title: 'Discount', price: { initial: 9999 } },
    { id: 'missing', title: 'Missing', price: null },
    { id: 'priced', title: 'Priced', price: { final: 500 } },
    { id: 'free', title: 'Free', price: { isFree: true } },
    { id: 'invalid', title: 'Invalid', price: { final: '0' } },
  ];
  assert.deepEqual(ids({ sort: 'price-asc' }, entries), ['free', 'priced', 'discount', 'invalid', 'missing']);
  assert.deepEqual(ids({ sort: 'price-desc' }, entries), ['priced', 'free', 'discount', 'invalid', 'missing']);
});

test('Sorting preserves source order and uses the added date rather than refreshed Steam metadata', () => {
  const snapshot = structuredClone(games);
  for (const sort of ['newest', 'oldest', 'popular', 'price-desc', 'price-asc', 'genre']) ids({ sort });
  assert.deepEqual(games, snapshot);
  const entries = [
    { id: 'first', createdAt: '2026-01-01 12:00:00', metadataUpdatedAt: '2026-12-01T00:00:00Z' },
    { id: 'second', createdAt: '2026-01-01T12:01:00Z' },
    { id: 'fallback', createdAt: 'invalid', metadataUpdatedAt: '2026-01-01T12:02:00Z' },
  ];
  assert.deepEqual(ids({ sort: 'oldest' }, entries), ['first', 'second', 'fallback']);
});
