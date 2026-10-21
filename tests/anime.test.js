import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openSqlite } from '../src/db/sqlite.js';
import { createApp } from '../src/app.js';
import { makeAuthRepository } from '../src/modules/auth/auth.repository.js';
import { makeAnimeRepository } from '../src/modules/anime/anime.repository.js';
import { makeCatalogRepository } from '../src/modules/catalog/catalog.repository.js';
import { makeMalService, AnimeSourceError } from '../src/modules/anime/mal.service.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { filterAnime, animeMemberOptions } from '../public/assets/js/pages/anime-view.js';

const anime = { malId: 1, title: 'Cowboy Bebop', imageUrl: 'https://cdn.myanimelist.net/images/anime/4/19644.jpg',
  synopsis: 'Weltraum-Abenteuer.', episodes: 26, genres: ['Action', 'Science Fiction'], type: 'TV', malScore: 8.75,
  metadataUpdatedAt: '2026-10-19T12:00:00.000Z', source: 'MyAnimeList via Tenrai' };
const upstream = { mal_id: 1, title: 'Cowboy Bebop', synopsis: '<p>Space &amp; adventure</p>', type: 'TV', episodes: 26,
  images: { jpg: { large_image_url: anime.imageUrl } }, genres: [{ name: 'Action' }], themes: [{ name: 'Space' }], score: 8.75 };

test('MyAnimeList adapter uses fixed Tenrai URLs, validated IDs and safe plain metadata with paginated search', async () => {
  const requests = [];
  const source = makeMalService({ minIntervalMs: 0, fetchImpl: async (url, options) => {
    requests.push({ url: new URL(url), options });
    return Response.json(url.includes('/anime?') ? { data: [upstream, upstream], pagination: { has_next_page: true, items: { total: 21 } } } : { data: upstream });
  } });
  const result = await source.search('Cowboy & test', '2');
  assert.equal(result.items.length, 1);
  assert.equal(result.total, 21); assert.equal(result.hasMore, true);
  assert.equal(requests[0].url.origin, 'https://api.tenrai.org');
  assert.equal(requests[0].url.pathname, '/v1/anime');
  assert.equal(requests[0].url.searchParams.get('q'), 'Cowboy & test');
  assert.equal(requests[0].url.searchParams.get('page'), '2');
  assert.equal(requests[0].url.searchParams.get('sfw'), 'true');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(result.items[0].synopsis, 'Space & adventure');
  const details = await source.details(1);
  assert.equal(details.episodes, 26);
  assert.equal(details.source, 'MyAnimeList via Tenrai');
  assert.deepEqual(details.genres, ['Action', 'Space']);
  for (const id of ['https://attacker.example', '1/../../', -1, 0, 1.5, '9999999999']) await assert.rejects(source.details(id), error => error.status === 400);
  await assert.rejects(source.search('x'), error => error.status === 400);
  await assert.rejects(source.search('Cowboy', 0), error => error.status === 400);
  assert.equal(requests.length, 2);
});

test('Provider caches coalesced requests safely, retries failures and keeps unknown episode totals unknown', async () => {
  let calls = 0, clock = Date.parse('2026-10-19T12:00:00Z'), failing = true;
  const source = makeMalService({ minIntervalMs: 0, now: () => clock, fetchImpl: async () => {
    calls += 1;
    return failing ? Response.json({}, { status: 429 }) : Response.json({ data: { ...upstream, episodes: null,
      images: { jpg: { large_image_url: 'https://attacker.example/image.jpg' } } } });
  } });
  await assert.rejects(source.details(1), error => error.status === 429);
  await assert.rejects(source.details(2), error => error.status === 429 && error.retryAfter === 30);
  assert.equal(calls, 1, 'A source cooldown must avoid another upstream request');
  clock += 30001;
  failing = false;
  const [first, second] = await Promise.all([source.details(1), source.details(1)]);
  assert.equal(calls, 2); assert.equal(first.episodes, null); assert.equal(first.imageUrl, null);
  first.genres.push('Mutation');
  assert.ok(!second.genres.includes('Mutation'));
  assert.ok(!(await source.details(1)).genres.includes('Mutation'));
  clock += 900001; await source.details(1); assert.equal(calls, 3);
});

test('Seasonal discovery loads every page once, deduplicates and safely caches the complete Berlin season', async () => {
  let clock = Date.parse('2026-10-21T10:00:00Z');
  const requests = [], waits = [];
  const source = makeMalService({ now: () => clock, wait: async ms => { waits.push(ms); clock += ms; }, fetchImpl: async value => {
    const url = new URL(value), page = Number(url.searchParams.get('page'));
    requests.push(url);
    return Response.json({ data: page === 1 ? [upstream, { ...upstream, title: '', mal_id: 999 }] : [upstream, { ...upstream, mal_id: 2,
      studios: [{ name: '<b>Studio &amp; Co</b>' }, { name: 'Studio &amp; Co' }], source: '<b>Manga</b>',
      duration: '24 min per ep', aired: { from: '2026-10-03T00:00:00+00:00' }, members: 12345 }],
    pagination: { has_next_page: page === 1, current_page: page } });
  } });
  const [first, second] = await Promise.all([source.season(), source.season()]);
  assert.deepEqual(first.season, { year: 2026, name: 'fall', label: 'Herbst 2026' });
  assert.deepEqual(first.items.map(item => item.malId), [1, 2]);
  assert.equal(requests.length, 2, 'Concurrent visitors share one complete seasonal fetch');
  for (const [index, url] of requests.entries()) {
    assert.equal(url.origin, 'https://api.tenrai.org');
    assert.equal(url.pathname, '/v1/seasons/2026/fall');
    assert.equal(url.searchParams.get('sfw'), 'true');
    assert.equal(url.searchParams.get('limit'), '25');
    assert.equal(url.searchParams.get('page'), String(index + 1));
  }
  assert.deepEqual(waits, [1100], 'Season pages use the existing provider rate limiter');
  assert.deepEqual(first.items[1].studios, ['Studio & Co']);
  assert.equal(first.items[1].adaptationSource, 'Manga');
  assert.equal(first.items[1].duration, '24 min per ep');
  assert.equal(first.items[1].airedFrom, '2026-10-03T00:00:00+00:00');
  assert.equal(first.items[1].malMembers, 12345);
  first.items[0].genres.push('Mutation'); first.season.label = 'Changed';
  assert.ok(!second.items[0].genres.includes('Mutation'));
  assert.equal((await source.season()).season.label, 'Herbst 2026');
  assert.equal(requests.length, 2);
  clock += 900001;
  await source.season();
  assert.equal(requests.length, 4, 'The complete season refreshes after its TTL');
});

test('Season selection follows Berlin quarter and year boundaries even while the old season remains cached', async () => {
  let clock;
  const requests = [], source = makeMalService({ minIntervalMs: 0, now: () => clock, fetchImpl: async url => {
    requests.push(new URL(url).pathname);
    return Response.json({ data: [], pagination: { has_next_page: false } });
  } });
  for (const [date, year, name, label] of [
    ['2026-03-31T21:59:59Z', 2026, 'winter', 'Winter 2026'],
    ['2026-03-31T22:00:00Z', 2026, 'spring', 'Frühling 2026'],
    ['2026-06-30T22:00:00Z', 2026, 'summer', 'Sommer 2026'],
    ['2026-09-30T22:00:00Z', 2026, 'fall', 'Herbst 2026'],
    ['2026-12-31T23:00:00Z', 2027, 'winter', 'Winter 2027'],
  ]) {
    clock = Date.parse(date);
    assert.deepEqual((await source.season()).season, { year, name, label });
    assert.equal(requests.at(-1), `/v1/seasons/${year}/${name}`);
  }
  assert.equal(requests.length, 5);
});

test('Season discovery rejects malformed and non-advancing pagination rather than returning a partial catalogue', async () => {
  for (const payload of [
    { data: [upstream] },
    { data: {}, pagination: { has_next_page: false } },
    { data: [upstream], pagination: { has_next_page: 'true' } },
    { data: [upstream], pagination: { has_next_page: false, current_page: 9 } },
    { data: [], pagination: { has_next_page: true } },
    { data: [upstream], pagination: { has_next_page: true } },
  ]) {
    let calls = 0;
    const source = makeMalService({ minIntervalMs: 0, fetchImpl: async () => { calls += 1; return Response.json(payload); } });
    await assert.rejects(source.season(), error => error instanceof AnimeSourceError && error.status === 502);
    assert.ok(calls <= 2, 'Broken or repeated pages must terminate promptly');
  }
  let calls = 0;
  const source = makeMalService({ minIntervalMs: 0, fetchImpl: async () => Response.json({ data: [{ ...upstream, mal_id: ++calls }], pagination: { has_next_page: true } }) });
  await assert.rejects(source.season(), /zu viele Ergebnisseiten/);
  assert.equal(calls, 100, 'An unbounded provider response must have a finite request budget');
});

test('A failed later season page is never cached as a complete catalogue and recovery restarts at page one', async () => {
  let clock = 0, failing = true;
  const pages = [], source = makeMalService({ minIntervalMs: 0, now: () => clock, fetchImpl: async value => {
    const page = Number(new URL(value).searchParams.get('page')); pages.push(page);
    return page === 2 && failing ? Response.json({}, { status: 503 })
      : Response.json({ data: [{ ...upstream, mal_id: page }], pagination: { has_next_page: page === 1 } });
  } });
  await assert.rejects(source.season(), error => error.status === 502 && error.retryAfter === 15);
  await assert.rejects(source.season(), error => error.status === 502);
  assert.deepEqual(pages, [1, 2]);
  clock = 15001; failing = false;
  assert.deepEqual((await source.season()).items.map(item => item.malId), [1, 2]);
  assert.deepEqual(pages, [1, 2, 1, 2]);
});

test('Network failures preserve their cause and do not turn DNS errors or invalid JSON into timeouts', async () => {
  for (const [cause, code, status] of [
    [new DOMException('test timeout', 'TimeoutError'), 'ANIME_SOURCE_TIMEOUT', 503],
    [new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }), 'ANIME_SOURCE_NETWORK_ERROR', 503],
    [new SyntaxError('private upstream body'), 'ANIME_SOURCE_INVALID_RESPONSE', 502],
  ]) {
    let calls = 0, clock = 0, failing = true;
    const source = makeMalService({ minIntervalMs: 0, now: () => clock, fetchImpl: async () => {
      calls += 1;
      if (failing) throw cause;
      return Response.json({ data: upstream });
    } });
    const results = await Promise.allSettled([source.details(1), source.details(2)]);
    assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === code && result.reason.status === status));
    assert.equal(results[0].reason.cause, cause);
    assert.equal(results[0].reason.expose, true);
    assert.equal(calls, 1, 'Already queued requests must also honor the cooldown');
    clock = 15001; failing = false;
    assert.equal((await source.details(1)).malId, 1);
    assert.equal(calls, 2, 'Requests must recover when the source recovers');
  }
});

test('Rate limiting honors the source Retry-After header before attempting another request', async () => {
  let calls = 0, clock = 0;
  const source = makeMalService({ minIntervalMs: 0, now: () => clock, fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? Response.json({}, { status: 429, headers: { 'Retry-After': '60' } }) : Response.json({ data: upstream });
  } });
  await assert.rejects(source.details(1), error => error.retryAfter === 60);
  clock = 30000;
  await assert.rejects(source.details(1), error => error.retryAfter === 30);
  assert.equal(calls, 1);
  clock = 60001;
  assert.equal((await source.details(1)).malId, 1);
});

test('Expected source failures expose only a controlled message, while unexpected server failures stay private', () => {
  const previousWarn = console.warn, previousError = console.error, logs = [];
  console.warn = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);
  const response = () => ({ statusCode: null, body: null, headers: {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    set(key, value) { this.headers[key] = value; return this; } });
  try {
    const expected = response();
    errorHandler(new AnimeSourceError('Anime-Quelle ist nicht erreichbar.', 503,
      { code: 'ANIME_SOURCE_NETWORK_ERROR', cause: new Error('private detail'), retryAfter: 15 }), {}, expected, () => {});
    assert.equal(expected.statusCode, 503);
    assert.equal(expected.body.error, 'Anime-Quelle ist nicht erreichbar.');
    assert.equal(expected.headers['Retry-After'], '15');
    assert.ok(!JSON.stringify(expected.body).includes('private detail'));
    assert.equal(typeof logs[0][0], 'string', 'An expected external failure should produce a short diagnostic');
    const unexpected = response();
    errorHandler(new Error('private server secret'), {}, unexpected, () => {});
    assert.equal(unexpected.body.error, 'Interner Serverfehler.');
  } finally { console.warn = previousWarn; console.error = previousError; }
});

test('Provider rate spacing and source dates are preserved, malformed details never become valid entries', async () => {
  let clock = 0; const waits = [];
  const source = makeMalService({ now: () => clock, wait: async ms => { waits.push(ms); clock += ms; }, fetchImpl: async url =>
    Response.json({ data: { ...upstream, mal_id: Number(url.split('/').at(-1)) } }, { headers: { 'Last-Modified': 'Mon, 19 Oct 2026 12:00:00 GMT' } }) });
  await Promise.all([source.details(1), source.details(2)]);
  assert.deepEqual(waits, [1100]);
  assert.equal((await source.details(1)).sourceUpdatedAt, '2026-10-19T12:00:00.000Z');
  const invalid = makeMalService({ minIntervalMs: 0, fetchImpl: async () => Response.json({ data: { ...upstream, mal_id: 2 } }) });
  await assert.rejects(invalid.details(1), /zugeordnet/);
});

async function setup({ seasonError } = {}) {
  const db = openSqlite(':memory:'), auth = makeAuthRepository(db);
  const firstId = await auth.upsertMember({ discordUserId: '123', username: 'alex', displayName: 'Alex', avatar: 'fixture' });
  const secondId = await auth.upsertMember({ discordUserId: '456', username: 'alex2', displayName: 'Alex', avatar: null });
  for (const [token, id] of [['first', firstId], ['second', secondId]]) await auth.createSession(createHash('sha256').update(token).digest('hex'), id, Date.now() + 60000);
  let calls = 0;
  const source = { async search() { return { items: [anime], total: 1, hasMore: false }; },
    async season() {
      if (seasonError) throw seasonError;
      return { items: [{ ...anime, title: 'Current provider title', studios: ['Current studio'] }, { ...anime, malId: 2, title: 'Seasonal discovery' }],
        season: { year: 2026, name: 'fall', label: 'Herbst 2026' } };
    },
    async details(id) { calls += 1; return { ...anime, malId: Number(id), episodes: Number(id) === 2 ? null : 26 }; } };
  const app = createApp(db, {}, { animeSource: source }), server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', body, token = 'first' } = {}) => fetch(origin + path, { method,
    headers: { ...(token ? { Cookie: `lcd_session=${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { db, auth, firstId, secondId, request, calls: () => calls,
    save: (body, token = 'first', id = 1) => request(`/api/anime/${id}/entries`, { method: 'POST', body, token }),
    async close() { app.locals.monopoly.rooms.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); } };
}

test('The public season API merges current metadata with live member selections without creating catalogue entries', async () => {
  const fixture = await setup();
  try {
    let response = await fixture.request('/api/anime/season', { token: null });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    let feed = await response.json();
    assert.deepEqual(feed.season, { year: 2026, name: 'fall', label: 'Herbst 2026' });
    assert.equal(feed.items.length, 2);
    assert.deepEqual(feed.items[0].ratings, []);
    assert.equal(feed.items[0].averageScore, null);
    assert.equal(feed.items[0].creatorMemberId, undefined);
    assert.equal(feed.items[0].id, 'mal:1');
    assert.equal(await makeAnimeRepository(fixture.db).count(), 0, 'Browsing must never add anime to member selections');
    await fixture.save({ status: 'completed', score: 9 });
    await fixture.save({ status: 'watching', watchedEpisodes: 4 }, 'second');
    const [saved] = await makeAnimeRepository(fixture.db).list();
    feed = await (await fixture.request('/api/anime/season', { token: null })).json();
    const selected = feed.items.find(item => item.malId === 1);
    assert.equal(selected.title, 'Current provider title');
    assert.deepEqual(selected.studios, ['Current studio']);
    assert.equal(selected.id, saved.id);
    assert.equal(selected.creatorMemberId, fixture.firstId);
    assert.equal(selected.createdAt, saved.createdAt);
    assert.equal(selected.averageScore, 9);
    assert.deepEqual(selected.ratings, saved.ratings);
    assert.equal(await makeAnimeRepository(fixture.db).count(), 1);
    assert.equal((await makeAnimeRepository(fixture.db).list())[0].title, anime.title, 'Discovery reads must not rewrite persisted metadata');
    await fixture.save({ status: 'plan_to_watch' }, 'second');
    feed = await (await fixture.request('/api/anime/season')).json();
    assert.equal(feed.items[0].ratings.find(rating => rating.memberId === fixture.secondId).status, 'plan_to_watch', 'Saved selections appear immediately on subsequent seasonal reads');
    await fixture.request('/api/anime/1', { method: 'DELETE' });
    assert.deepEqual((await (await fixture.request('/api/anime/season')).json()).items[0].ratings, []);
    assert.equal(await makeAnimeRepository(fixture.db).count(), 0);
  } finally { await fixture.close(); }
});

test('Season source failures keep their controlled API status and leave saved member selections readable', async () => {
  const fixture = await setup({ seasonError: new AnimeSourceError('Saisonquelle momentan nicht erreichbar.', 503,
    { code: 'ANIME_SOURCE_NETWORK_ERROR', retryAfter: 15 }) });
  try {
    await fixture.save({ status: 'plan_to_watch' });
    const response = await fixture.request('/api/anime/season', { token: null });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '15');
    assert.equal((await response.json()).error, 'Saisonquelle momentan nicht erreichbar.');
    assert.equal((await (await fixture.request('/api/anime')).json()).items.length, 1);
  } finally { await fixture.close(); }
});

test('Anime writes and member lists require sessions; metadata and personal identity cannot be supplied by the browser', async () => {
  const fixture = await setup();
  try {
    assert.equal((await fixture.save({ status: 'plan_to_watch' }, null)).status, 401);
    assert.equal((await fixture.request('/api/anime/members', { token: null })).status, 401);
    assert.equal(fixture.calls(), 0);
    const saved = await fixture.save({ status: 'watching', watchedEpisodes: 6, score: 10, memberId: fixture.secondId,
      title: 'Fake title', episodes: 100, creatorMemberId: fixture.secondId });
    assert.equal(saved.status, 201);
    const [entry] = (await (await fixture.request('/api/anime')).json()).items;
    assert.equal(entry.title, anime.title); assert.equal(entry.episodes, 26);
    assert.equal(entry.creatorMemberId, fixture.firstId);
    assert.deepEqual(entry.ratings.map(({ memberId, status, watchedEpisodes, score }) => ({ memberId, status, watchedEpisodes, score })),
      [{ memberId: fixture.firstId, status: 'watching', watchedEpisodes: 6, score: null }]);
    assert.equal(entry.averageScore, null);
    const members = (await (await fixture.request('/api/anime/members')).json()).members;
    assert.equal(members.length, 2); assert.ok(members.every(member => member.name === 'Alex'));
  } finally { await fixture.close(); }
});

test('On hold and dropped persist through the API with progress and retain the existing scoring rules', async () => {
  const fixture = await setup();
  try {
    await fixture.save({ status: 'completed', score: 9 });
    for (const status of ['on_hold', 'dropped']) {
      const saved = await fixture.save({ status, watchedEpisodes: 4, score: 9 });
      assert.equal(saved.status, 201, await saved.text());
      const [item] = (await (await fixture.request('/api/anime')).json()).items;
      assert.equal(item.ratings[0].status, status);
      assert.equal(item.ratings[0].watchedEpisodes, 4);
      assert.equal(item.ratings[0].score, null);
      assert.equal(item.averageScore, null);
      assert.equal((await fixture.save({ status, watchedEpisodes: 27 })).status, 400);
      assert.equal((await fixture.save({ status, watchedEpisodes: -1 })).status, 400);
      assert.equal((await fixture.save({ status, watchedEpisodes: null })).status, 400);
    }
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 5 })).status, 201);
    assert.equal((await fixture.save({ status: 'completed', score: 8 })).status, 201);
    assert.equal((await fixture.save({ status: 'plan_to_watch' })).status, 201);
  } finally { await fixture.close(); }
});

test('Reaching the provider episode total automatically completes saved progress and enables a rating', async () => {
  const fixture = await setup();
  try {
    for (const status of ['watching', 'on_hold', 'dropped']) {
      assert.equal((await fixture.save({ status, watchedEpisodes: 25 })).status, 201);
      let [item] = (await (await fixture.request('/api/anime')).json()).items;
      assert.equal(item.ratings[0].status, status);
      const response = await fixture.save({ status, watchedEpisodes: 26, score: 8, episodes: 999 });
      assert.equal(response.status, 201, await response.text());
      [item] = (await (await fixture.request('/api/anime')).json()).items;
      assert.equal(item.ratings[0].status, 'completed');
      assert.equal(item.ratings[0].watchedEpisodes, 26);
      assert.equal(item.ratings[0].score, 8);
      assert.equal(item.averageScore, 8);
    }
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 26 })).status, 201);
    assert.equal((await makeAnimeRepository(fixture.db).list())[0].ratings[0].score, null, 'Completion does not invent a score');
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 27 })).status, 400);
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 26, score: 11 })).status, 400);
    assert.equal((await fixture.save({ status: 'plan_to_watch', watchedEpisodes: 26 })).status, 201);
    assert.equal((await makeAnimeRepository(fixture.db).list())[0].ratings[0].status, 'plan_to_watch');
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 26 }, 'first', 2)).status, 201);
    const unknown = (await makeAnimeRepository(fixture.db).list()).find(item => item.malId === 2);
    assert.equal(unknown.episodes, null);
    assert.equal(unknown.ratings[0].status, 'watching', 'Unknown totals must never imply completion');
  } finally { await fixture.close(); }
});

test('Completed progress can be reduced and automatic completion can be deferred until saving', async () => {
  const fixture = await setup();
  try {
    assert.equal((await fixture.save({ status: 'completed', score: 9 })).status, 201);
    for (const watchedEpisodes of [20, 0]) {
      const response = await fixture.save({ status: 'completed', watchedEpisodes, score: 9 });
      assert.equal(response.status, 201, await response.text());
      const [item] = await makeAnimeRepository(fixture.db).list();
      assert.equal(item.ratings[0].status, 'watching');
      assert.equal(item.ratings[0].watchedEpisodes, watchedEpisodes);
      assert.equal(item.ratings[0].score, null);
      assert.equal(item.averageScore, null);
    }
    for (const status of ['watching', 'on_hold', 'dropped']) {
      assert.equal((await fixture.save({ status, watchedEpisodes: 26, autoComplete: false })).status, 201);
      assert.equal((await makeAnimeRepository(fixture.db).list())[0].ratings[0].status, status);
    }
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 26 })).status, 201);
    assert.equal((await makeAnimeRepository(fixture.db).list())[0].ratings[0].status, 'completed');
    assert.equal((await fixture.save({ status: 'completed', watchedEpisodes: 0 }, 'first', 2)).status, 400);
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 5, autoComplete: 'false' })).status, 400);
  } finally { await fixture.close(); }
});

test('Watching tracks progress, planned hides both fields and completed validates real totals and permits scores only there', async () => {
  const fixture = await setup();
  try {
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 0, score: 8 })).status, 201);
    assert.equal((await fixture.save({ status: 'completed', score: 9 })).status, 201);
    let [item] = await makeAnimeRepository(fixture.db).list();
    assert.equal(item.ratings[0].watchedEpisodes, 26); assert.equal(item.ratings[0].score, 9); assert.equal(item.averageScore, 9);
    for (const body of [{ status: 'watching', watchedEpisodes: -1 }, { status: 'watching', watchedEpisodes: 27 },
      { status: 'watching', watchedEpisodes: 2.5 }, { status: 'completed', watchedEpisodes: 27 },
      { status: 'completed', score: 11 }, { status: 'completed', score: 1.5 }, { status: 'unknown' }]) {
      assert.equal((await fixture.save(body)).status, 400);
    }
    assert.equal((await makeAnimeRepository(fixture.db).list())[0].ratings[0].score, 9);
    await fixture.save({ status: 'plan_to_watch', watchedEpisodes: 99999, score: 10 });
    [item] = await makeAnimeRepository(fixture.db).list();
    assert.equal(item.ratings[0].watchedEpisodes, null); assert.equal(item.ratings[0].score, null); assert.equal(item.averageScore, null);
    assert.equal((await fixture.save({ status: 'completed' }, 'first', 2)).status, 400);
    assert.equal((await fixture.save({ status: 'completed', watchedEpisodes: 12, score: 8 }, 'first', 2)).status, 201);
    assert.equal((await makeAnimeRepository(fixture.db).list()).find(item => item.malId === 2).episodes, null);
  } finally { await fixture.close(); }
});

test('Additional members get separate watchlists without overwrite; creator-only deletion cascades through them', async () => {
  const fixture = await setup();
  try {
    assert.equal((await fixture.save({ status: 'watching', watchedEpisodes: 4, memberIds: [fixture.secondId, fixture.secondId] })).status, 201);
    let [item] = await makeAnimeRepository(fixture.db).list();
    assert.equal(item.ratings.length, 2);
    assert.equal(item.ratings.find(entry => entry.memberId === fixture.secondId).status, 'plan_to_watch');
    await fixture.save({ status: 'completed', score: 7 }, 'second');
    await fixture.save({ status: 'watching', watchedEpisodes: 5, memberIds: [fixture.secondId] });
    [item] = await makeAnimeRepository(fixture.db).list();
    assert.equal(item.ratings.find(entry => entry.memberId === fixture.secondId).score, 7);
    assert.equal((await fixture.request('/api/anime/1', { method: 'DELETE', token: 'second' })).status, 403);
    for (const memberIds of [[999999], ['1'], '2', Array(51).fill(fixture.secondId)]) assert.equal((await fixture.save({ status: 'plan_to_watch', memberIds })).status, 400);
    assert.equal((await fixture.request('/api/anime/1', { method: 'DELETE' })).status, 200);
    assert.equal((await fixture.db.get('SELECT COUNT(*) AS total FROM mal_anime_entries')).total, 0);
    assert.equal((await fixture.request('/api/anime/1', { method: 'DELETE' })).status, 404);
  } finally { await fixture.close(); }
});

test('Legacy anime stay readable and counted, while the old unauthenticated identity-write route is blocked', async () => {
  const fixture = await setup();
  try {
    await makeCatalogRepository(fixture.db).saveReview('anime', { title: 'Altes Anime', memberName: 'Alex', score: 8, status: 'completed' });
    await fixture.save({ status: 'plan_to_watch' });
    const items = (await (await fixture.request('/api/catalog/anime')).json()).items;
    assert.equal(items.length, 2); assert.equal(items.find(item => item.legacy).ratings[0].memberId, undefined);
    assert.equal((await (await fixture.request('/api/overview')).json()).counts.anime, 2);
    assert.equal((await fixture.request('/api/catalog/anime/reviews', { method: 'POST', body: { title: 'Spoof', memberName: 'Fake', score: 8, status: 'completed' }, token: null })).status, 400);
    const repo = makeAnimeRepository(fixture.db);
    await assert.rejects(repo.saveEntry({ ...anime, malId: 3 }, { memberId: fixture.firstId, status: 'plan_to_watch', score: null, watchedEpisodes: null, memberIds: [999999] }));
    assert.equal(await repo.exists(3), false);
    await fixture.auth.deleteSession(createHash('sha256').update('first').digest('hex'));
    assert.equal((await fixture.save({ status: 'plan_to_watch' })).status, 401);
  } finally { await fixture.close(); }
});

test('Anime filters combine member intersections, status, genre and type without mutating source data', () => {
  const items = [
    { id: '1', title: 'Alpha', genres: ['Action'], type: 'TV', episodes: 26, malScore: 8, createdAt: '2026-01-01 00:00:00', ratings: [{ memberId: 1, memberName: 'Alex', status: 'watching' }, { memberId: 2, memberName: 'Alex', status: 'plan_to_watch' }] },
    { id: '2', title: 'Beta', genres: ['Drama'], type: 'Movie', episodes: 1, malScore: 9, createdAt: '2026-01-02 00:00:00', ratings: [{ memberId: 2, memberName: 'Alex', status: 'completed' }] },
    { id: '3', title: 'Gamma', genres: ['Action'], type: 'TV', episodes: null, createdAt: '2026-01-03 00:00:00', ratings: [] },
  ];
  const snapshot = structuredClone(items), ids = options => filterAnime(items, options).map(item => item.id);
  assert.deepEqual(ids({ memberIds: ['1', 2] }), ['1']);
  assert.deepEqual(ids({ memberIds: [2], genre: 'Action', type: 'TV', status: 'watching' }), ['1']);
  assert.deepEqual(ids({ status: 'completed' }), ['2']);
  assert.deepEqual(ids({ sort: 'oldest' }), ['1', '2', '3']);
  assert.deepEqual(ids({ sort: 'score' }), ['2', '1', '3']);
  assert.deepEqual(ids({ sort: 'episodes-asc' }), ['2', '1', '3']);
  assert.deepEqual(ids({ sort: 'episodes-desc' }), ['1', '2', '3']);
  assert.equal(animeMemberOptions(items).length, 2);
  assert.deepEqual(items, snapshot);
});

test('Release date sorting is independent of added and updated dates, with unknown releases last in both directions', () => {
  const items = [
    { id: '1', title: 'Alpha', airedFrom: '2010-04-01T00:00:00Z', createdAt: '2026-01-03 12:00:00', metadataUpdatedAt: '2029-01-01T00:00:00Z' },
    { id: '2', title: 'Beta', airedFrom: '2025-10-01T00:00:00Z', createdAt: '2026-01-01 12:00:00', updatedAt: '2030-01-01T00:00:00Z' },
    { id: '3', title: 'Gamma', airedFrom: null, createdAt: '2026-01-02 12:00:00' },
    { id: '4', title: 'Delta', airedFrom: 'invalid', createdAt: '2026-01-04 12:00:00' },
  ];
  const snapshot = structuredClone(items), ids = sort => filterAnime(items, { sort }).map(item => item.id);
  assert.deepEqual(ids('newest'), ['2', '1', '4', '3']);
  assert.deepEqual(ids('oldest'), ['1', '2', '4', '3']);
  assert.deepEqual(ids('added'), ['4', '1', '3', '2']);
  assert.deepEqual(items, snapshot);
});
