import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSteamService } from '../src/modules/games/steam.service.js';

const image = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/header.jpg';

function steamGame(overrides = {}) {
  return {
    type: 'game', steam_appid: 620, name: 'Portal 2',
    short_description: 'Ein <strong>Koop</strong>-Spiel &amp; mehr.',
    header_image: image,
    genres: [{ id: '1', description: 'Action' }, { id: '25', description: 'Abenteuer' }],
    price_overview: { currency: 'EUR', initial: 975, final: 195, discount_percent: 80, final_formatted: '1,95€' },
    categories: [{ id: 1, description: 'Mehrspieler' }, { id: 9, description: 'Koop' }],
    ...overrides,
  };
}

test('Different co-op counts for different modes are not presented as one universal number', async () => {
  const service = makeSteamService({ fetchImpl: async () => Response.json({
    620: { success: true, data: steamGame({ detailed_description: '2-player co-op locally and 4-player co-op online.' }) },
  }) });
  const game = await service.details(620);
  assert.equal(game.players.coop, true);
  assert.equal(game.players.coopPlayers, null);
  assert.match(game.players.label, /nicht angegeben/);
});

test('Steam search requests game results on a fixed Steam origin and preserves pagination', async () => {
  const calls = [];
  const service = makeSteamService({
    fetchImpl: async (input, options) => {
      calls.push({ url: new URL(input), options });
      return Response.json({
        success: 1, total_count: 151, start: 50,
        results_html: `<a class="search_result_row" data-ds-appid="620" href="https://store.steampowered.com/app/620/Portal_2/">
          <img src="${image}"><span class="title">Portal 2 &amp; Friends</span>
          <div class="discount_final_price">1,95€</div></a>`,
      });
    },
  });
  const result = await service.search('Portal & Friends', 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://store.steampowered.com');
  assert.equal(calls[0].url.pathname, '/search/results/');
  assert.equal(calls[0].url.searchParams.get('term'), 'Portal & Friends');
  assert.equal(calls[0].url.searchParams.get('category1'), '998');
  assert.equal(calls[0].url.searchParams.get('start'), '50');
  assert.equal(calls[0].url.searchParams.get('count'), '50');
  assert.equal(calls[0].url.searchParams.get('cc'), 'de');
  assert.equal(calls[0].url.searchParams.get('l'), 'german');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result.page, 2);
  assert.equal(result.total, 151);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].steamAppId, 620);
  assert.equal(result.items[0].title, 'Portal 2 & Friends');
  assert.equal(result.items[0].headerImage, image);
});

test('Steam searches and details are cached independently', async () => {
  const calls = [];
  const service = makeSteamService({
    fetchImpl: async input => {
      const url = new URL(input);
      calls.push(url);
      if (url.pathname === '/search/results/') {
        return Response.json({ success: 1, total_count: 0, results_html: '', start: 0 });
      }
      return Response.json({ 620: { success: true, data: steamGame() } });
    },
  });
  assert.equal((await service.search('Portal', 1)).hasMore, false);
  await service.search('Portal', 1);
  await service.details(620);
  await service.details(620);
  assert.equal(calls.filter(url => url.pathname === '/search/results/').length, 1);
  assert.equal(calls.filter(url => url.pathname === '/api/appdetails').length, 1);
});

test('Steam details keep metadata from Steam and do not invent a numeric cooperative player limit', async () => {
  const service = makeSteamService({
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://store.steampowered.com');
      assert.equal(url.pathname, '/api/appdetails');
      assert.equal(url.searchParams.get('appids'), '620');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ 620: { success: true, data: steamGame() } });
    },
  });
  const game = await service.details(620);
  assert.equal(game.steamAppId, 620);
  assert.equal(game.title, 'Portal 2');
  assert.equal(game.shortDescription, 'Ein Koop-Spiel & mehr.');
  assert.equal(game.headerImage, image);
  assert.deepEqual(game.genres, ['Action', 'Abenteuer']);
  assert.deepEqual(game.price, { currency: 'EUR', final: 195, formatted: '1,95€', isFree: false });
  assert.equal(game.players.coop, true);
  assert.equal(game.players.coopPlayers, null);
  assert.ok(game.players.label);
});

test('Invalid app IDs cannot change the Steam request URL or trigger a request', async () => {
  let calls = 0;
  const service = makeSteamService({ fetchImpl: async () => { calls += 1; throw new Error('Unexpected fetch'); } });
  for (const id of ['https://attacker.example', '../620', '620&appids=10', -1, 1.5, 0]) {
    await assert.rejects(service.details(id), error => error.status === 400);
  }
  assert.equal(calls, 0);
});

test('Steam details reject unavailable applications and non-game products', async () => {
  for (const item of [
    { success: false },
    { success: true, data: steamGame({ type: 'dlc' }) },
  ]) {
    const service = makeSteamService({ fetchImpl: async () => Response.json({ 620: item }) });
    await assert.rejects(service.details(620), error => error.status === 404 || error.status === 400);
  }
});

test('Steam upstream failures reject without caching a broken response', async () => {
  let calls = 0;
  const service = makeSteamService({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('Unavailable', { status: 503 });
      return Response.json({ 620: { success: true, data: steamGame() } });
    },
  });
  await assert.rejects(service.details(620));
  assert.equal((await service.details(620)).title, 'Portal 2');
  assert.equal(calls, 2);
});

test('Steam cache isolates caller mutations, coalesces requests and refreshes stale prices', async () => {
  let calls = 0;
  let currentTime = Date.parse('2026-10-19T12:00:00Z');
  const service = makeSteamService({
    now: () => currentTime,
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ 620: { success: true, data: steamGame() } });
    },
  });
  const [first, second] = await Promise.all([service.details(620), service.details(620)]);
  assert.equal(calls, 1);
  first.title = 'Changed by a caller';
  first.genres.push('Injected');
  assert.equal(second.title, 'Portal 2');
  assert.deepEqual((await service.details(620)).genres, ['Action', 'Abenteuer']);
  assert.equal(calls, 1);
  currentTime += 86_400_000;
  assert.equal((await service.details(620)).title, 'Portal 2');
  assert.equal(calls, 2);
});

test('Free games are distinct from games with no price available', async () => {
  for (const [data, expected] of [
    [steamGame({ is_free: true, price_overview: undefined }), { formatted: 'Kostenlos', currency: null, final: 0, isFree: true }],
    [steamGame({ is_free: false, price_overview: undefined }), null],
  ]) {
    const service = makeSteamService({ fetchImpl: async () => Response.json({ 620: { success: true, data } }) });
    assert.deepEqual((await service.details(620)).price, expected);
  }
});

test('Cooperative player limits require an explicit Steam description tied to co-op', async () => {
  for (const [description, expected] of [
    ['Includes a two-player co-op campaign.', 2],
    ['Ein 4-Spieler-Koop-Abenteuer.', 4],
    ['Über 100 Level, mit Koop-Unterstützung.', null],
  ]) {
    const service = makeSteamService({
      fetchImpl: async () => Response.json({ 620: { success: true, data: steamGame({ detailed_description: description }) } }),
    });
    assert.equal((await service.details(620)).players.coopPlayers, expected);
  }
});

test('Steam data cannot supply unrelated image hosts or arbitrary search endpoints', async () => {
  const service = makeSteamService({
    fetchImpl: async input => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://store.steampowered.com');
      if (url.pathname === '/api/appdetails') {
        return Response.json({ 620: { success: true, data: steamGame({ header_image: 'https://steamstatic.com.attacker.example/avatar.png' }) } });
      }
      return Response.json({ success: 1, total_count: 1, results_html: '<a data-ds-appid="620"><img src="javascript:alert(1)"><span class="title">Portal 2</span></a>' });
    },
  });
  assert.equal((await service.details(620)).headerImage, null);
  assert.equal((await service.search('https://attacker.example/')).items[0].headerImage, null);
});
