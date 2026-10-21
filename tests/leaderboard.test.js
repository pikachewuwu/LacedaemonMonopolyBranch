import test from 'node:test';
import assert from 'node:assert/strict';
import { rankMembers, selectMembers, summarizeMembers, circleEntries } from '../public/assets/js/components/leaderboard-data.js';

const source = [
  { memberName: 'Zara', balance: 300 }, { memberName: 'Alex', balance: 120 },
  { memberName: 'Ben', balance: 80 }, { memberName: 'Eva', balance: 0 },
  { memberName: 'Müller', balance: 120 },
];

test('Ranks are based on all balances, preserve ties and never mutate API data', () => {
  const ranked = rankMembers(source);
  assert.deepEqual(ranked.map(member => member.rank), [1, 2, 2, 4, 5]);
  assert.deepEqual(source.map(member => member.memberName), ['Zara', 'Alex', 'Ben', 'Eva', 'Müller']);
  assert.equal(source[0].rank, undefined);
  const ascending = selectMembers(ranked, { sort: 'balance-asc' });
  assert.deepEqual(ascending.map(member => member.memberName), ['Eva', 'Ben', 'Alex', 'Müller', 'Zara']);
  assert.deepEqual(ascending.map(member => member.rank), [5, 4, 2, 2, 1]);
  assert.equal(ranked[0].memberName, 'Zara');
});

test('Names, ranges and rank filters combine without changing original placements', () => {
  const ranked = rankMembers(source);
  assert.deepEqual(selectMembers(ranked, { search: ' MÜLL ', min: 100, max: 150, ranks: 2 }).map(member => member.memberName), ['Müller']);
  assert.equal(selectMembers(ranked, { min: 300, max: 300 })[0].memberName, 'Zara');
  assert.equal(selectMembers(ranked, { max: 0 })[0].memberName, 'Eva');
  assert.equal(selectMembers(ranked, { min: 500 }).length, 0);
  assert.equal(selectMembers(ranked, { min: 200, max: 100 }).length, 0);
  assert.deepEqual(selectMembers(ranked, { sort: 'name-asc' }).map(member => member.memberName), ['Alex', 'Ben', 'Eva', 'Müller', 'Zara']);
  assert.deepEqual(selectMembers(ranked, { sort: 'name-desc' }).map(member => member.memberName), ['Zara', 'Müller', 'Eva', 'Ben', 'Alex']);
});

test('Statistics describe the filtered data, including empty and zero-balance selections', () => {
  assert.deepEqual(summarizeMembers(source), { count: 5, total: 620, average: 124 });
  assert.deepEqual(summarizeMembers([]), { count: 0, total: 0, average: 0 });
  assert.deepEqual(summarizeMembers([{ balance: 0 }]), { count: 1, total: 0, average: 0 });
});

test('Member count limits apply after filtering and sorting, including ties', () => {
  const ranked = rankMembers(source);
  assert.deepEqual(selectMembers(ranked, { limit: 2 }).map(member => member.memberName), ['Zara', 'Alex']);
  assert.deepEqual(selectMembers(ranked, { sort: 'balance-asc', limit: 2 }).map(member => member.memberName), ['Eva', 'Ben']);
  assert.deepEqual(selectMembers(ranked, { min: 100, max: 150, sort: 'name-desc', limit: 1 }).map(member => member.memberName), ['Müller']);
  assert.equal(selectMembers(ranked, { limit: 100 }).length, 5);
  assert.equal(selectMembers(ranked).length, 5);
  assert.equal(selectMembers(ranked, { limit: 1 })[0].rank, 1);
});

test('Circle grouping retains the total and order without losing small or zero entries', () => {
  const members = Array.from({ length: 15 }, (_, index) => ({ memberName: `Mitglied ${index}`, balance: index }));
  const grouped = circleEntries(members);
  assert.equal(grouped.length, 10);
  assert.equal(grouped[0].name, 'Mitglied 0');
  assert.equal(grouped.at(-1).name, 'Weitere 6 Mitglieder');
  assert.equal(summarizeMembers(grouped).total, summarizeMembers(members).total);
  assert.equal(circleEntries(source).length, 5);
  assert.deepEqual(circleEntries([]), []);
});
