import { createHash } from 'node:crypto';
import express from 'express';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBrowser } from './browser-check.js';
import { createApp } from '../src/app.js';
import { openSqlite } from '../src/db/sqlite.js';
import { makeAuthRepository } from '../src/modules/auth/auth.repository.js';
import { makeGamesRepository } from '../src/modules/games/games.repository.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => candidate && existsSync(candidate));
if (!browser) throw new Error('Chrome/Edge fehlt. Bitte BROWSER_PATH angeben.');

const db = openSqlite(':memory:');
const auth = makeAuthRepository(db);
const memberId = await auth.upsertMember({ discordUserId: '123', username: 'alex', displayName: 'Alex', avatar: 'fixture-avatar' });
const otherMemberId = await auth.upsertMember({ discordUserId: '456', username: 'sam', displayName: 'Sam', avatar: null });
const repository = makeGamesRepository(db);
const token = 'games-browser-fixture-session';
const tokenHash = createHash('sha256').update(token).digest('hex');
const portal = {
  steamAppId: 620, title: 'Portal 2', shortDescription: 'Löse gemeinsam mit Freunden knifflige Rätsel.',
  headerImage: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/header.jpg',
  storeUrl: 'https://store.steampowered.com/app/620/', genres: ['Action', 'Abenteuer'],
  price: { formatted: '9,75€', currency: 'EUR', final: 975, isFree: false },
  players: { coop: true, coopPlayers: 2, multiplayer: true, singlePlayer: true, label: 'Koop · 2 Spieler' },
  metadataUpdatedAt: '2026-10-19T12:00:00.000Z',
};
const stardew = {
  ...portal, steamAppId: 413150, title: 'Stardew Valley', shortDescription: 'Baue deinen eigenen Bauernhof auf.',
  headerImage: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg',
  storeUrl: 'https://store.steampowered.com/app/413150/', genres: ['Simulation', 'Rollenspiel'],
  price: { formatted: '13,99€', currency: 'EUR', final: 1399, isFree: false },
  players: { coop: true, coopPlayers: null, multiplayer: true, singlePlayer: true, label: 'Koop · Spielerzahl nicht angegeben' },
};
const terraria = {
  ...portal, steamAppId: 105600, title: 'Terraria', genres: ['Action'], shortDescription: 'Graben, bauen und gemeinsam Abenteuer erleben.',
  headerImage: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/105600/header.jpg',
  storeUrl: 'https://store.steampowered.com/app/105600/', price: { formatted: '4,99€', currency: 'EUR', final: 499, isFree: false },
};
const hike = {
  ...portal, steamAppId: 1055540, title: 'A Short Hike', genres: ['Abenteuer'], shortDescription: 'Erkunde eine kleine Insel.',
  headerImage: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1055540/header.jpg',
  storeUrl: 'https://store.steampowered.com/app/1055540/', price: { formatted: '6,99€', currency: 'EUR', final: 699, isFree: false },
  players: { coop: false, coopPlayers: null, multiplayer: false, singlePlayer: true, label: 'Einzelspieler · 1 Spieler' },
};
const fixtures = [portal, stardew, terraria, hike];

async function seedGames(includePortal = false) {
  if (includePortal) await repository.saveReview(portal, { memberId, score: 7, status: 'completed' });
  await repository.saveReview(portal, { memberId: otherMemberId, score: 5, status: 'planned' });
  await repository.saveReview(stardew, { memberId: otherMemberId, score: 10, status: 'planned' });
  await repository.saveReview(stardew, { memberId, score: 8, status: 'planned' });
  await repository.saveReview(terraria, { memberId: otherMemberId, score: 6, status: 'ongoing' });
  await repository.saveReview(terraria, { memberId, score: 9, status: 'planned' });
  await repository.saveReview(hike, { memberId: otherMemberId, score: 9, status: 'completed' });
  for (let index = 0; index < fixtures.length; index++) {
    await db.run('UPDATE steam_game_entries SET created_at = ? WHERE steam_app_id = ?', [`2026-01-0${index + 1} 12:00:00`, fixtures[index].steamAppId]);
  }
}
let searches = 0;
const steam = {
  async search(query, page = 1) {
    searches += 1;
    if (query === 'error') throw Object.assign(new Error('Steam-Testfehler'), { status: 503 });
    if (query === 'nobody') return { items: [], total: 0, page: Number(page), hasMore: false };
    return { items: [structuredClone(Number(page) === 1 ? portal : stardew)], total: 2, page: Number(page), hasMore: Number(page) === 1 };
  },
  async details(id) {
    const game = fixtures.find(item => item.steamAppId === Number(id));
    if (!game) throw Object.assign(new Error('Spiel nicht gefunden'), { status: 404 });
    return structuredClone(game);
  },
};
const application = createApp(db, {}, { steam });
const app = express();
app.get('/pages/games.html', async (req, res) => {
  await db.run('DELETE FROM steam_game_reviews');
  await db.run('DELETE FROM steam_games');
  await auth.deleteSession(tokenHash);
  searches = 0;
  if (req.query.scenario === 'guest') {
    res.clearCookie('lcd_session');
    await seedGames(true);
  }
  else {
    await auth.createSession(tokenHash, memberId, Date.now() + 60_000);
    res.cookie('lcd_session', token, { httpOnly: true, sameSite: 'lax', path: '/' });
  }
  const html = readFileSync(path.join(root, 'public/pages/games.html'), 'utf8');
  res.type('html').send(html.replace('</body>', '<script type="module" src="/games-test.js"></script></body>'));
});
app.get('/test-state', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ searches, memberId, otherMemberId, games: await repository.list(),
    reviews: await db.all('SELECT steam_app_id, member_id, score, status, priority FROM steam_game_reviews') });
});
app.post('/test-seed', async (_req, res) => {
  await seedGames();
  res.json({ ok: true });
});
app.post('/test-expire', async (_req, res) => {
  await auth.deleteSession(tokenHash);
  res.json({ ok: true });
});
app.get('/games-test.js', (_req, res) => res.type('js').send(String.raw`
await import('/assets/js/pages/games.js');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const node = selector => document.querySelector(selector);
const waitUntil = async (condition, message) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out: ' + message);
};
const input = (selector, value) => {
  const element = node(selector);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};
const state = async () => (await fetch('/test-state', { cache: 'no-store' })).json();
const results = () => [...document.querySelectorAll('#game-search-results .game-search-result')];
const searchFor = async (query, expected) => {
  input('#game-search', query);
  await waitUntil(() => results().length === expected && node('#game-search-results').getAttribute('aria-busy') === 'false'
    && !node('#game-search-status').textContent.includes('vorbereitet'), 'Search results for ' + query);
};
const chooseFirst = async () => {
  results()[0].click();
  await waitUntil(() => !node('#game-selection').hidden && node('#game-selection').getAttribute('aria-busy') === 'false'
    && node('#game-selection .game-title')?.textContent === 'Portal 2', 'Selected Steam details');
};
const submit = () => node('#game-review-form').requestSubmit(node('#game-save'));
const card = appId => node('#games-list .game-card[data-steam-app-id="' + appId + '"]');
const titles = () => [...document.querySelectorAll('#games-list .game-title')].map(title => title.textContent);
const assertTitles = (expected, label) => assert(JSON.stringify(titles()) === JSON.stringify(expected), label + ': ' + JSON.stringify(titles()));
const edit = appId => card(appId).querySelector('.game-edit-review').click();
const inlineInput = (appId, name, value) => input('#games-list [data-steam-app-id="' + appId + '"] .game-inline-' + name, value);
const inlineSubmit = appId => {
  const form = card(appId).querySelector('.game-review-editor');
  form.requestSubmit(form.querySelector('.game-inline-save'));
};
const setMember = (id, checked) => {
  const checkbox = node('#games-member-options input[name="memberId"][value="' + id + '"]');
  assert(checkbox, 'Missing member filter ' + id);
  checkbox.checked = checked;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
};
try {
  const scenario = new URLSearchParams(location.search).get('scenario');
  const guest = scenario === 'guest';
  assert(titles().length === (guest ? 4 : 0), 'Unexpected initial library');
  assert(!node('#games-add-dialog').open, 'Add dialog should start closed');
  node('#games-add-button').click();
  assert(node('#games-add-dialog').open, 'Add button did not open dialog');
  node('#games-dialog-cancel').click();
  assert(!node('#games-add-dialog').open, 'Dialog cancel did not close');
  node('#games-add-button').click();
  node('#games-dialog-close').click();
  assert(!node('#games-add-dialog').open, 'Dialog close button did not close');
  node('#games-add-button').click();
  assert(node('#game-review-fields').disabled, 'Saving without selected game was enabled');
  assert(node('#games-login').hidden === !guest, 'Wrong session state');
  input('#game-search', 'x');
  assert(node('#game-search-status').textContent.includes('Mindestens 2'), 'Minimum query length feedback missing');
  assert((await state()).searches === 0, 'A one-character input called Steam');

  await searchFor('nobody', 0);
  assert(node('#game-search-status').textContent.includes('Keine Spiele'), 'Missing empty search state');
  input('#game-search', 'error');
  await waitUntil(() => node('#game-search-status').classList.contains('error-message'), 'Search failure feedback');
  assert(node('#game-search-results').hidden && node('#game-search-more').hidden, 'Search failure left stale results');

  await searchFor('Portal', 1);
  assert(!node('#game-search-more').hidden, 'Pagination button missing');
  assert(results()[0].textContent.includes('Portal 2'), 'Steam title missing from search result');
  assert(results()[0].querySelector('img')?.src.includes('/620/'), 'Steam search image missing');
  node('#game-search-more').click();
  await waitUntil(() => results().length === 2 && node('#game-search-more').hidden, 'Second search page');
  assert(results()[1].textContent.includes('Stardew Valley'), 'Pagination did not append second game');
  await chooseFirst();
  assert(node('#game-selection').textContent.includes('9,75€'), 'Steam price missing');
  assert(node('#game-selection').textContent.includes('2 Spieler'), 'Steam player count missing');
  assert(node('#game-selection').textContent.includes('Abenteuer'), 'Steam genre missing');
  input('#game-search', 'Changed query');
  assert(node('#game-selection').hidden && node('#game-review-fields').disabled, 'Typing a new query kept the old selection');
  await searchFor('Portal', 1);
  await chooseFirst();

  if (guest) {
    assert(node('#game-review-fields').disabled && node('#game-save').matches(':disabled'), 'Guest can save a review');
    assert(!node('#games-login').hidden && node('#games-login').href.includes('returnTo='), 'Guest login link missing');
    submit();
    const before = (await state()).reviews.length;
    assert(before === 7, 'Unexpected guest fixture review count');
    const denied = await fetch('/api/games/620/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score: 10, status: 'completed' }) });
    assert(denied.status === 401, 'Guest API write was accepted');
    assert((await state()).reviews.length === before, 'Guest UI wrote a review');
    node('#games-dialog-cancel').click();
    assert(!node('#games-list .game-edit-review') && !node('#games-list .game-delete'), 'Guest sees account actions');
  } else {
    assert(!node('#game-review-fields').disabled && node('#games-session').textContent.includes('Alex'), 'Authenticated session was not loaded');
    assert(node('#game-score').closest('[data-game-score-field]').hidden && !node('#game-priority').closest('[data-game-priority-field]').hidden, 'Wishlist must show priority instead of score');
    input('#game-status', 'ongoing');
    assert(node('#game-score').disabled && node('#game-priority').disabled, 'Ongoing must hide both rating and priority');
    input('#game-status', 'paused');
    assert(!node('#game-score').disabled && node('#game-priority').disabled, 'Paused must enable scores');
    input('#game-status', 'completed');
    assert(!node('#game-score').disabled, 'Completed must enable scores');
    input('#game-status', 'planned'); input('#game-priority', 'high');
    const initialState = await state();
    await waitUntil(() => Boolean(node('#game-add-member-options input[value="' + initialState.otherMemberId + '"]')), 'Members without game entries available in add dialog');
    node('#game-add-member-options input[value="' + initialState.otherMemberId + '"]').checked = true;
    submit();
    await waitUntil(() => card(620)?.querySelector('.game-review-priority')?.textContent === 'Priorität: High' && !node('#games-add-dialog').open, 'Saved wishlist and closed add dialog');
    const invited = await state();
    assert(invited.reviews.length === 2 && invited.reviews.every(review => review.score === null), 'Additional member or scoreless wishlist missing');
    assert(invited.reviews.find(review => review.member_id === initialState.otherMemberId).priority === 'medium', 'Included member must default to medium');
    assert(!card(620).querySelector('.game-average') && !card(620).querySelector('.game-review-score'), 'Wishlist priorities must not count as ratings');
    assert(card(620).querySelector('.game-title').textContent === 'Portal 2', 'Saved title differs from Steam');
    assert(card(620).querySelector('.game-review-status').textContent === 'Merkliste', 'Saved status missing');
    assert(card(620).querySelector('.game-review-avatar').title === 'Alex', 'Discord avatar hover name missing');
    assert(card(620).querySelector('.game-review-avatar img')?.src.includes('cdn.discordapp.com/avatars/123/fixture-avatar'), 'Discord review avatar missing');
    assert(card(620).querySelector('.game-cover img')?.src.includes('/620/'), 'Steam cover missing from card');
    assert(!document.querySelector('[name="memberName"]'), 'Editable review identity should come from the session');
    edit(620);
    assert(!card(620).querySelector('.game-review-editor').hidden && !node('#games-add-dialog').open, 'Review edit opened add dialog instead of card');
    assert(card(620).querySelector('.game-inline-priority').value === 'high', 'Priority not prefilled inline');
    inlineInput(620, 'priority', 'low'); inlineSubmit(620);
    await waitUntil(() => card(620)?.querySelector('.game-review-priority')?.textContent === 'Priorität: Low' && card(620).querySelector('.game-review-editor').hidden, 'Saved inline priority');
    edit(620); inlineInput(620, 'status', 'ongoing');
    assert(card(620).querySelector('.game-inline-score').disabled && card(620).querySelector('.game-inline-priority').disabled, 'Ongoing inline fields must be hidden');
    inlineSubmit(620);
    await waitUntil(() => card(620)?.querySelector('.game-review-status')?.textContent === 'Wird gespielt' && card(620).querySelector('.game-review-editor').hidden, 'Saved ongoing status');
    assert(card(620).querySelectorAll('.game-review-score').length === 0, 'Ongoing review displays a score');
    edit(620); inlineInput(620, 'status', 'paused'); inlineInput(620, 'score', '9'); inlineSubmit(620);
    await waitUntil(() => card(620)?.querySelector('.game-review-score')?.textContent === '9 / 10' && card(620).querySelector('.game-review-editor').hidden, 'Saved paused rating');
    edit(620);
    assert(card(620).querySelector('.game-inline-score').value === '9', 'Score not prefilled inline');
    assert(card(620).querySelector('.game-inline-status').value === 'paused', 'Status not prefilled inline');
    inlineInput(620, 'score', '3');
    card(620).querySelector('.game-inline-cancel').click();
    assert(card(620).querySelector('.game-review-editor').hidden && (await state()).reviews[0].score === 9, 'Inline cancel changed saved review');
    edit(620);
    assert(card(620).querySelector('.game-inline-score').value === '9', 'Cancel did not reset edited value');
    inlineInput(620, 'score', '7'); inlineInput(620, 'status', 'completed'); inlineSubmit(620);
    await waitUntil(() => card(620)?.querySelector('.game-review-score')?.textContent === '7 / 10'
      && card(620).querySelector('.game-review-editor')?.hidden, 'Updated inline review');
    const updated = await state();
    assert(updated.reviews.length === 2 && updated.reviews.find(review => review.member_id === initialState.memberId).score === 7
      && updated.reviews.find(review => review.member_id === initialState.memberId).status === 'completed', 'Updating created a duplicate review');

    await fetch('/test-seed', { method: 'POST' });
    edit(620); inlineSubmit(620);
    await waitUntil(() => titles().length === 4, 'Seeded library refreshed after inline save');
    const seeded = await state();
    input('#games-sort', 'newest');
    assertTitles(['A Short Hike', 'Terraria', 'Stardew Valley', 'Portal 2'], 'Newest sort');
    input('#games-sort', 'oldest');
    assertTitles(['Portal 2', 'Stardew Valley', 'Terraria', 'A Short Hike'], 'Oldest sort');
    input('#games-sort', 'price-asc');
    assertTitles(['Terraria', 'A Short Hike', 'Portal 2', 'Stardew Valley'], 'Ascending price');
    input('#games-sort', 'price-desc');
    assertTitles(['Stardew Valley', 'Portal 2', 'A Short Hike', 'Terraria'], 'Descending price');
    input('#games-sort', 'genre');
    assertTitles(['A Short Hike', 'Portal 2', 'Terraria', 'Stardew Valley'], 'Genre sort');
    input('#games-sort', 'popular');
    assertTitles(['Stardew Valley', 'Portal 2', 'Terraria', 'A Short Hike'], 'Popularity counts planned reviews');
    input('#games-sort', 'oldest');
    node('#games-members-filter').open = true;
    setMember(seeded.memberId, true);
    assertTitles(['Stardew Valley', 'Terraria'], 'Member planned filter');
    setMember(seeded.otherMemberId, true);
    assertTitles(['Stardew Valley'], 'Member intersection must require both planned reviews');
    input('#games-status-filter', 'ongoing');
    assertTitles([], 'Status and member intersection');
    node('#games-clear-members').click();
    assertTitles(['Terraria'], 'Clearing member filter must preserve status');
    input('#games-status-filter', 'completed');
    assertTitles(['Portal 2', 'A Short Hike'], 'Completed status filter');
    input('#games-status-filter', 'paused');
    assertTitles([], 'Paused filter must be available separately');
    input('#games-status-filter', 'planned');
    assertTitles(['Portal 2', 'Stardew Valley', 'Terraria'], 'Planned status filter');
    input('#games-status-filter', 'all');
    node('#games-members-filter').open = false;
    assertTitles(['Portal 2', 'Stardew Valley', 'Terraria', 'A Short Hike'], 'Clearing filters restores library');

    assert(card(1055540).querySelector('.game-add-review'), 'A member without a review cannot review on the card');
    edit(1055540);
    assert(card(1055540).querySelector('.game-inline-status').value === 'planned', 'New card review should default to planned');
    inlineInput(1055540, 'priority', 'low'); inlineSubmit(1055540);
    await waitUntil(async () => (await state()).reviews.some(review => review.steam_app_id === 1055540 && review.member_id === seeded.memberId), 'Adding own review inline');
    await waitUntil(() => Boolean(card(1055540).querySelector('.game-edit-review:not(.game-add-review)')), 'New review card refreshed');
    assert(card(1055540).querySelector('.game-review-priority').textContent === 'Priorität: Low', 'Inline wishlist priority missing');

    assert(card(620).querySelector('.game-delete'), 'Creator delete button missing');
    assert(!card(413150).querySelector('.game-delete'), 'Non-creator sees delete button');
    const deniedDelete = await fetch('/api/games/413150', { method: 'DELETE' });
    assert(deniedDelete.status === 403 && (await state()).games.length === 4, 'Non-creator API deletion was accepted');
    card(620).querySelector('.game-delete').click();
    const confirmation = card(620).querySelector('.game-delete-confirmation');
    assert(!confirmation.hidden && confirmation.textContent.includes('Portal 2') && confirmation.textContent.includes('alle Bewertungen'), 'Concrete destructive confirmation missing');
    card(620).querySelector('.game-cancel-delete').click();
    assert(card(620).querySelector('.game-delete-confirmation').hidden && (await state()).games.length === 4, 'Delete cancel removed a game');

    if (scenario === 'expired') {
      await fetch('/test-expire', { method: 'POST' });
      edit(413150); inlineInput(413150, 'status', 'paused'); inlineInput(413150, 'score', '1'); inlineSubmit(413150);
      await waitUntil(() => card(413150)?.querySelector('.game-inline-message')?.classList.contains('error-message'), 'Expired inline session error stays visible');
      assert(card(413150).querySelector('.game-inline-message').textContent.length > 0, 'Expired session feedback missing');
      const unchanged = (await state()).reviews.find(review => review.steam_app_id === 413150 && review.member_id === seeded.memberId);
      assert(unchanged.score === null && unchanged.status === 'planned', 'Expired session changed review');
    } else {
      card(620).querySelector('.game-delete').click();
      card(620).querySelector('.game-confirm-delete').click();
      await waitUntil(() => !card(620) && titles().length === 3, 'Creator deletion refreshed library');
      const deleted = await state();
      assert(deleted.games.length === 3 && !deleted.reviews.some(review => review.steam_app_id === 620), 'Game delete did not cascade through reviews');
    }
  }
  if (!guest) {
    const { createGameCard } = await import('/assets/js/components/steam-games.js');
    const fixture = (await state()).games.find(game => game.steamAppId === 413150);
    let rejectReview;
    let reviewCalls = 0;
    const scratch = createGameCard({ ...fixture, title: '<img src=x onerror=alert(1)>', creatorMemberId: String((await state()).memberId) }, {
      member: { id: (await state()).memberId },
      onSaveReview: () => { reviewCalls += 1; return new Promise((_resolve, reject) => { rejectReview = reject; }); },
      onDelete: async () => { throw new Error('403: Du darfst diesen Eintrag nicht löschen.'); },
    });
    document.body.append(scratch);
    assert(!scratch.querySelector('.game-title img') && scratch.querySelector('.game-title').textContent.includes('<img'), 'Game title was interpreted as HTML');
    scratch.querySelector('.game-edit-review').click();
    scratch.querySelector('.game-review-editor').requestSubmit(scratch.querySelector('.game-inline-save'));
    assert(scratch.querySelector('.game-inline-fields').disabled && scratch.querySelector('.game-delete').disabled, 'Inline save did not disable duplicate/destructive actions');
    scratch.querySelector('.game-inline-cancel').click();
    assert(!scratch.querySelector('.game-review-editor').hidden && reviewCalls === 1, 'Pending save was cancelled or duplicated');
    rejectReview(new Error('Speichern fehlgeschlagen.'));
    await waitUntil(() => scratch.querySelector('.game-inline-message').classList.contains('error-message'), 'Inline error callback');
    assert(!scratch.querySelector('.game-inline-fields').disabled, 'Failed save left controls disabled');
    scratch.querySelector('.game-inline-cancel').click();
    scratch.querySelector('.game-delete').click();
    scratch.querySelector('.game-confirm-delete').click();
    await waitUntil(() => scratch.querySelector('.game-delete-message').textContent.includes('403'), 'Delete permission failure feedback');
    assert(scratch.isConnected && !scratch.querySelector('.game-confirm-delete').disabled, 'Failed delete removed the card or disabled retry');
    scratch.remove();
  }
  if (innerWidth >= 1200) assert(getComputedStyle(node('#games-list')).gridTemplateColumns.split(' ').length === 3, 'Desktop library should use three columns');
  if (innerWidth >= 1200) assert(node('#games-add-button').getBoundingClientRect().left > node('#games-sort').getBoundingClientRect().right, 'Add button must be at the right end of the toolbar');
  await waitUntil(() => Boolean(node('[data-site-header] .topbar')), 'Navbar loaded');
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Page overflows viewport: ' + document.documentElement.scrollWidth + ' > ' + innerWidth);
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  document.body.dataset.gamesTest = 'passed';
} catch (error) {
  document.body.dataset.gamesTest = 'failed';
  document.body.dataset.gamesTestError = error.stack;
  console.error(error);
}
`));
app.use(application);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const temporary = mkdtempSync(path.join(tmpdir(), 'lacedaemon-games-'));
const cases = [['desktop', 1440, 'normal'], ['mobile', 390, 'normal'], ['guest', 1440, 'guest'], ['expired', 1000, 'expired']];

try {
  for (const [name, width, scenario] of cases) {
    const screenshot = path.join(temporary, name + '.png');
    await checkBrowser(browser, path.join(temporary, name + '-profile'), screenshot, width,
      'http://127.0.0.1:' + server.address().port + '/pages/games.html?scenario=' + scenario);
    console.log(name + ': OK; screenshot: ' + screenshot);
  }
} finally {
  application.locals.monopoly.rooms.dispose();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await db.close();
  // Only delete known browser profiles inside this run's verified temporary directory.
  for (const [name] of cases) {
    const profile = path.resolve(temporary, name + '-profile');
    if (path.dirname(profile) === path.resolve(temporary) && path.basename(temporary).startsWith('lacedaemon-games-')) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Browser files may remain locked. */ }
    }
  }
}
