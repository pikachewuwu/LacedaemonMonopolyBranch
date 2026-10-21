import { createHash } from 'node:crypto';
import express from 'express';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { openSqlite } from '../src/db/sqlite.js';
import { makeAuthRepository } from '../src/modules/auth/auth.repository.js';
import { makeAnimeRepository } from '../src/modules/anime/anime.repository.js';
import { AnimeSourceError } from '../src/modules/anime/mal.service.js';
import { checkBrowser } from './browser-check.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => candidate && existsSync(candidate));
if (!browser) throw new Error('Chrome/Edge fehlt. Bitte BROWSER_PATH angeben.');
const db = openSqlite(':memory:'), auth = makeAuthRepository(db), repository = makeAnimeRepository(db);
const memberId = await auth.upsertMember({ discordUserId: '123', username: 'alex', displayName: 'Alex', avatar: 'fixture-avatar' });
const otherMemberId = await auth.upsertMember({ discordUserId: '456', username: 'sam', displayName: 'Sam', avatar: null });
const unscoredMemberId = await auth.upsertMember({ discordUserId: '789', username: 'jamie', displayName: 'Jamie', avatar: null });
const token = 'anime-browser-session', tokenHash = createHash('sha256').update(token).digest('hex');
const base = { imageUrl: 'https://cdn.myanimelist.net/images/anime/4/19644.jpg', synopsis: 'Eine Reise voller Abenteuer.',
  metadataUpdatedAt: '2026-10-19T12:00:00.000Z', source: 'MyAnimeList via Tenrai', type: 'TV' };
const fixtures = [
  { ...base, malId: 1, title: 'Cowboy Bebop', episodes: 26, genres: ['Action', 'Science Fiction'], malScore: 8.75 },
  { ...base, malId: 5114, title: 'Fullmetal Alchemist: Brotherhood', episodes: 64, genres: ['Action', 'Fantasy'], malScore: 9.1 },
  { ...base, malId: 21, title: 'One Piece', imageUrl: null, episodes: null, genres: ['Action', 'Adventure'], malScore: null },
  { ...base, malId: 199, title: 'Spirited Away', episodes: 1, genres: ['Fantasy'], type: 'Movie', malScore: 8.8 },
];
const seasonalFixture = { ...base, malId: 200, title: 'Seasonal Discovery', episodes: 12, genres: ['Fantasy'], malScore: 7.5 };
const seasonFixtures = [...fixtures, seasonalFixture];
let searches = 0, seasonLoads = 0, seasonFailure = false;
const source = {
  async season() {
    seasonLoads += 1;
    if (seasonFailure) throw new AnimeSourceError('Die Season konnte momentan nicht geladen werden.', 503,
      { code: 'ANIME_SOURCE_NETWORK_ERROR', retryAfter: 15 });
    return { items: structuredClone(seasonFixtures), season: { year: 2026, name: 'fall', label: 'Herbst 2026' } };
  },
  async search(query, page = 1) {
    searches += 1;
    if (query === 'error') throw new AnimeSourceError('Die Anime-Quelle ist momentan nicht erreichbar.', 503,
      { code: 'ANIME_SOURCE_NETWORK_ERROR', retryAfter: 15 });
    if (query === 'nobody') return { items: [], total: 0, hasMore: false, page: Number(page) };
    return { items: [structuredClone(fixtures[Number(page) === 1 ? 0 : 1])], total: 2, hasMore: Number(page) === 1, page: Number(page) };
  },
  async details(id) {
    const anime = seasonFixtures.find(item => item.malId === Number(id));
    if (!anime) throw Object.assign(new Error('Anime fehlt.'), { status: 404 });
    return structuredClone(anime);
  },
};
const application = createApp(db, {}, { animeSource: source }), app = express();
async function seed() {
  await repository.saveEntry(fixtures[1], { memberId: otherMemberId, status: 'plan_to_watch', watchedEpisodes: null, score: null });
  await repository.saveEntry(fixtures[1], { memberId, status: 'watching', watchedEpisodes: 10, score: null });
  await repository.saveEntry(fixtures[2], { memberId: otherMemberId, status: 'watching', watchedEpisodes: 12, score: null });
  await repository.saveEntry(fixtures[2], { memberId, status: 'plan_to_watch', watchedEpisodes: null, score: null });
  await repository.saveEntry(fixtures[3], { memberId: otherMemberId, status: 'completed', watchedEpisodes: 1, score: 9 });
  await repository.saveEntry(fixtures[3], { memberId: unscoredMemberId, status: 'completed', watchedEpisodes: 1, score: null });
  for (let index = 0; index < fixtures.length; index++) await db.run('UPDATE mal_anime SET created_at = ? WHERE mal_id = ?', [`2026-01-0${index + 1} 12:00:00`, fixtures[index].malId]);
}
app.get('/pages/anime.html', async (req, res) => {
  if (req.query.viewReload !== '1') {
    await db.run('DELETE FROM mal_anime'); await auth.deleteSession(tokenHash); searches = 0; seasonLoads = 0; seasonFailure = false;
    if (req.query.scenario === 'guest') { res.clearCookie('lcd_session'); await seed(); }
    else { await auth.createSession(tokenHash, memberId, Date.now() + 60000); res.cookie('lcd_session', token, { httpOnly: true, sameSite: 'lax', path: '/' }); }
  }
  const html = readFileSync(path.join(root, 'public/pages/anime.html'), 'utf8');
  res.type('html').send(html.replace('</body>', '<script type="module" src="/anime-test.js"></script></body>'));
});
app.get('/test-state', async (_req, res) => res.json({ searches, seasonLoads, memberId, otherMemberId, items: await repository.list(),
  seasonItems: seasonFixtures.map(item => ({ ...item, ratings: [], averageScore: null })) }));
app.post('/test-seed', async (_req, res) => { await seed(); res.json({ ok: true }); });
app.post('/test-expire', async (_req, res) => { await auth.deleteSession(tokenHash); res.json({ ok: true }); });
app.post('/test-season-failure/:enabled', (req, res) => { seasonFailure = req.params.enabled === '1'; res.json({ ok: true }); });
app.get('/anime-test.js', (_req, res) => res.type('js').send(String.raw`
await import('/assets/js/pages/anime.js');
const node = selector => document.querySelector(selector);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const waitUntil = async (condition, label) => { for (let attempt = 0; attempt < 120; attempt++) {
  if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 50));
} throw new Error('Timed out: ' + label); };
const input = (selector, value) => { const control = node(selector); control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); control.dispatchEvent(new Event('change', { bubbles: true })); };
const state = async () => (await fetch('/test-state', { cache: 'no-store' })).json();
const results = () => [...document.querySelectorAll('#anime-search-results .game-search-result')];
const card = id => node('#anime-list [data-mal-id="' + id + '"]');
const titles = () => [...document.querySelectorAll('#anime-list .game-title, #anime-list .anime-list-title-link')].map(title => title.textContent);
const reviewProgress = id => card(id)?.querySelector('.anime-review-progress, .anime-list-member-progress');
const reviewScore = id => card(id)?.querySelector('.game-review-score, .anime-list-member-score');
const assertTitles = (expected, label) => assert(JSON.stringify(titles()) === JSON.stringify(expected), label + ': ' + titles());
const assertNoOverflow = label => assert(document.documentElement.scrollWidth <= innerWidth + 1, label + ': anime page overflows viewport');
const assertControls = () => {
  assert(node('#anime-source-toggle [data-anime-source="members"]').textContent.trim() === 'Lacedaemon', 'Member source is not called Lacedaemon');
  const actions = node('.anime-library-actions'), add = node('#anime-add-button'), toggle = node('#anime-view-toggle');
  assert(actions?.contains(add) && actions.contains(toggle), 'Add and view controls are not grouped below the library heading');
  const bounds = actions.getBoundingClientRect(), addBounds = add.getBoundingClientRect(), viewBounds = toggle.getBoundingClientRect();
  assert(addBounds.left <= bounds.left + 2 && viewBounds.left < bounds.left + bounds.width / 2, 'Add or view controls are not on the left');
  assert(actions.getBoundingClientRect().top >= node('.anime-section-heading').getBoundingClientRect().bottom - 1, 'View controls are not below the library heading');
};
const assertView = view => {
  for (const button of document.querySelectorAll('#anime-view-toggle [data-anime-view]')) {
    assert(button.getAttribute('aria-pressed') === String(button.dataset.animeView === view), 'Wrong active view: ' + view);
  }
  assert(node('#anime-list').classList.contains(view === 'grid' ? 'games-cards' : 'anime-list-view'), 'Missing view layout: ' + view);
  assert(Boolean(node('#anime-list .anime-table')) === (view === 'list'), 'Wrong table visibility: ' + view);
};
const switchView = view => {
  const button = node('#anime-view-toggle [data-anime-view="' + view + '"]');
  assert(button, 'Missing view toggle: ' + view); button.click(); assertView(view);
  assert(localStorage.getItem('lacedaemon:anime-view') === view, 'View choice not saved');
};
const assertSource = source => {
  for (const button of document.querySelectorAll('#anime-source-toggle [data-anime-source]')) {
    assert(button.getAttribute('aria-pressed') === String(button.dataset.animeSource === source), 'Wrong active source: ' + source);
  }
  assert(node('#anime-source-toggle [data-anime-source="' + source + '"]'), 'Missing source toggle: ' + source);
};
const switchSource = async (source, expectedId = null) => {
  const button = node('#anime-source-toggle [data-anime-source="' + source + '"]');
  assert(button, 'Missing source toggle: ' + source); button.click();
  await waitUntil(() => node('#anime-list').getAttribute('aria-busy') === 'false'
    && node('#anime-source-toggle [data-anime-source="' + source + '"]').getAttribute('aria-pressed') === 'true'
    && (!expectedId || Boolean(card(expectedId))), 'Source ' + source);
  assertSource(source);
  assert(localStorage.getItem('lacedaemon:anime-source') === source, 'Source choice not saved');
};
const assertGrid = () => {
  assertView('grid');
  for (const item of document.querySelectorAll('#anime-list .anime-card')) {
    const header = item.querySelector('.anime-season-header').getBoundingClientRect();
    const body = item.querySelector('.anime-season-body').getBoundingClientRect();
    const image = item.querySelector('.anime-cover').getBoundingClientRect();
    const content = item.querySelector('.anime-season-info').getBoundingClientRect();
    const footer = item.querySelector('.anime-season-stats').getBoundingClientRect();
    assert(item.querySelector('.anime-season-header .game-title') && item.querySelector('.anime-season-meta')
      && item.querySelector('.anime-season-genres'), 'Season card title, metadata, or genre row missing');
    assert(header.bottom <= body.top + 1, 'Season card heading is not above poster and synopsis');
    assert(image.width > 0 && content.width > 0 && Math.abs(image.right - content.left) <= 2, 'Season poster and synopsis are not side by side');
    assert(image.left >= body.left - 1 && content.right <= body.right + 1, 'Season card body overflows');
    assert(footer.top >= body.bottom - 1 && footer.width >= body.width - 2, 'Season card score footer is not below the full body');
    const members = item.querySelector('.anime-season-members'), button = members?.querySelector('.anime-members-button');
    assert(!item.querySelector('.anime-review-name, .game-review-status, .game-review-score, .anime-review-progress'), 'Card still exposes member details outside the dialog');
    if (members) {
      assert(button?.matches('button[type="button"]') && button.getAttribute('aria-haspopup') === 'dialog'
        && button.getAttribute('aria-controls') === 'anime-members-dialog', 'Avatar group is not a native dialog button');
      assert(button.getAttribute('aria-label')?.includes(item.querySelector('.game-title').textContent), 'Avatar group has no descriptive accessible name');
      assert(button.children.length && [...button.children].every(avatar => avatar.classList.contains('game-review-avatar')), 'Avatar group contains content besides member avatars');
      assert(!button.querySelector('a, button, input, select, textarea, [tabindex]'), 'Avatar group contains a nested tab stop');
    }
  }
  if (innerWidth >= 1200) assert(getComputedStyle(node('#anime-list')).gridTemplateColumns.split(' ').length === 3, 'Desktop not three columns');
  assertNoOverflow('Grid');
};
const assertMemberDialog = async (id, { close = true, dismissal = 'button' } = {}) => {
  const anime = (await state()).items.find(item => item.malId === id);
  assert(anime?.ratings.length, 'Dialog fixture has no members: ' + id);
  const trigger = card(id)?.querySelector('.anime-members-button'), dialog = node('#anime-members-dialog');
  assert(trigger && dialog && !dialog.open, 'Missing avatar trigger or dialog starts open');
  assert(trigger.querySelectorAll('.game-review-avatar').length === anime.ratings.length, 'Avatar group does not include every member status');
  trigger.focus(); trigger.click(); await waitUntil(() => dialog.open, 'Member dialog opened');
  assert(dialog.getAttribute('aria-labelledby') === 'anime-members-heading' && node('#anime-members-heading').textContent.includes(anime.title), 'Member dialog has no anime title');
  assert(document.activeElement === node('#anime-members-close'), 'Member dialog did not focus its close button');
  const list = node('#anime-members-list .anime-member-detail-list'), rows = [...(list?.querySelectorAll('li.anime-member-detail') || [])];
  assert(list?.matches('ul, ol, [role="list"]') && rows.length === anime.ratings.length, 'Member dialog does not list every member');
  const statuses = { watching: 'Watching', plan_to_watch: 'Plan to watch', completed: 'Completed' };
  for (const entry of anime.ratings) {
    const row = rows.find(item => item.querySelector('.anime-member-detail-name, .anime-review-name')?.textContent === entry.memberName);
    assert(row?.querySelector('.game-review-avatar'), 'Member name or avatar missing from dialog: ' + entry.memberName);
    const name = row.querySelector('.anime-member-detail-name, .anime-review-name'), summary = row.querySelector('.anime-member-detail-summary');
    const status = summary?.querySelector('.game-review-status'), score = summary?.querySelector('.game-review-score'), progress = row.querySelector('.anime-review-progress');
    assert(status?.textContent === statuses[entry.status], 'Wrong member status in dialog');
    assert(name.getBoundingClientRect().bottom <= summary.getBoundingClientRect().top + 1, 'Member name is not above the status row');
    if (entry.status === 'completed') {
      assert(score, 'Completed member score is missing');
      if (Number.isInteger(entry.score)) assert(score.textContent === entry.score + ' / 10', 'Wrong completed member score');
      else assert(score.textContent === '\u2014' && (score.title || score.getAttribute('aria-label')), 'Missing member score has no explained fallback');
      const statusBounds = status.getBoundingClientRect(), scoreBounds = score.getBoundingClientRect();
      assert(Math.abs((statusBounds.top + statusBounds.bottom) / 2 - (scoreBounds.top + scoreBounds.bottom) / 2) <= 1,
        'Completed status and score are not aligned on one row');
      assert(scoreBounds.left >= statusBounds.right - 1, 'Completed score is not beside its status');
    } else assert(!score, 'Unfinished member has a score');
    if (entry.status !== 'plan_to_watch' && Number.isInteger(entry.watchedEpisodes)) {
      assert(progress?.textContent === entry.watchedEpisodes + (anime.episodes ? ' / ' + anime.episodes : '') + ' Episoden', 'Member progress is missing or has an invented total');
    } else assert(!progress, 'Planned member has episode progress');
  }
  assert(!dialog.querySelector('.anime-edit, .anime-entry-editor, .anime-delete'), 'Member details are not read-only');
  const bounds = dialog.getBoundingClientRect();
  assert(bounds.left >= -1 && bounds.right <= innerWidth + 1 && dialog.scrollWidth <= dialog.clientWidth + 1, 'Member dialog overflows viewport');
  if (!close) return;
  const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
  if (dismissal === 'cancel') {
    let canceled = false; dialog.addEventListener('cancel', () => { canceled = true; }, { once: true });
    dialog.requestClose();
    assert(canceled, 'Native Escape/cancel path was not triggered');
  } else if (dismissal === 'backdrop') dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left - 1, clientY: bounds.top - 1 }));
  else node('#anime-members-close').click();
  await closed;
  assert(!dialog.open && document.activeElement === trigger, 'Member dialog did not close or return focus to its avatar button');
};
const assertTable = async () => {
  assertView('list');
  const table = node('#anime-list .anime-table'), rows = [...table.querySelectorAll('tbody > tr[data-mal-id]')];
  assert(JSON.stringify([...table.querySelectorAll('thead th')].map(cell => cell.textContent))
    === JSON.stringify(['#', 'Bild', 'Titel', 'Avg. Score', 'Tags', 'Mitglieder']), 'Wrong list columns');
  assert((table.querySelector('thead th:nth-child(4)').title + ' ' + (table.querySelector('caption')?.textContent || '')).includes('Community'), 'Average score has no community explanation');
  assert(rows.length === titles().length, 'List title or row count differs');
  const stored = await state();
  for (const [index, row] of rows.entries()) {
    const anime = [...stored.items, ...stored.seasonItems].find(item => String(item.malId) === row.dataset.malId), cells = [...row.children];
    assert(anime && cells.length === 6, 'List row does not have six cells');
    assert(cells[0].textContent === String(index + 1), 'List indices do not follow displayed order');
    assert(cells[1].querySelector('img, .game-cover-placeholder'), 'List image or fallback missing');
    assert(cells[2].querySelector('.anime-list-title-link').textContent === anime.title, 'List title missing');
    assert(cells[2].matches('th[scope="row"]'), 'List title has no row header');
    if (Number.isFinite(anime.averageScore)) assert(cells[3].textContent.includes(anime.averageScore.toLocaleString('de-DE', { maximumFractionDigits: 2 })), 'Community average missing from list');
    else assert(cells[3].textContent.includes('—') || cells[3].textContent.includes('–'), 'Missing community average has no fallback');
    for (const genre of anime.genres) assert(cells[4].textContent.includes(genre), 'List tag missing: ' + genre);
    for (const entry of anime.ratings) assert(cells[5].textContent.includes(entry.memberName), 'Visible list member missing: ' + entry.memberName);
    assert(!cells[5].querySelector('.anime-edit, .anime-entry-editor, .anime-delete'), 'Personal actions are outside title column');
  }
  if (rows.length && innerWidth < 700) assert(node('#anime-list').scrollWidth > node('#anime-list').clientWidth, 'Mobile table has no horizontal scrolling area');
  assertNoOverflow('List');
};
const submit = () => node('#anime-entry-form').requestSubmit(node('#anime-save'));
const edit = id => card(id).querySelector('.anime-edit').click();
const inlineInput = (id, name, value) => input('#anime-list [data-mal-id="' + id + '"] .anime-inline-' + name, value);
const inlineSave = id => { const form = card(id).querySelector('.anime-entry-editor'); form.requestSubmit(form.querySelector('.anime-inline-save')); };
const searchFor = async (query, length) => { input('#anime-search', query); await waitUntil(() => results().length === length
  && node('#anime-search-results').getAttribute('aria-busy') === 'false'
  && node('#anime-search-status').textContent.includes(length ? 'Treffer.' : 'Keine Anime'), 'Search ' + query); };
const checkSeasonalSource = async ({ readOnly }) => {
  assertSource('members');
  const storedBefore = await state(), sort = node('#anime-sort').value;
  assert(!storedBefore.items.some(item => item.malId === 200), 'Seasonal discovery was already saved');
  await switchSource('season', 200);
  assertView('list'); await assertTable();
  assert(titles().length === 5, 'Seasonal source does not include every seasonal anime');
  assert(node('#anime-sort').value === sort, 'Source switch reset sorting');
  assert(!(await state()).items.some(item => item.malId === 200), 'Viewing a seasonal anime saved it');
  if (!readOnly) assert(card(200).querySelector('.anime-edit'), 'Unselected seasonal list row cannot be added');
  switchView('grid'); assertGrid();
  if (readOnly) {
    assert(!node('#anime-list .anime-watch, #anime-list .anime-interest, #anime-list .anime-edit'), 'Guest can write seasonal entries');
    const login = card(200).querySelector('.anime-season-login');
    assert(login && new URL(login.href).pathname === '/api/auth/discord', 'Seasonal guest has no Discord login link');
  } else {
    assert(card(200).querySelector('.anime-watch') && card(200).querySelector('.anime-interest'), 'Seasonal quick actions missing');
    card(200).querySelector('.anime-interest').click();
    await waitUntil(async () => {
      const anime = (await state()).items.find(item => item.malId === 200);
      return anime?.ratings.some(entry => String(entry.memberId) === String(storedBefore.memberId) && entry.status === 'plan_to_watch'
        && entry.watchedEpisodes === null && entry.score === null)
        && card(200)?.querySelector('.anime-interest')?.getAttribute('aria-pressed') === 'true';
    }, 'Seasonal interest saved');
    card(200).querySelector('.anime-watch').click();
    await waitUntil(async () => {
      const anime = (await state()).items.find(item => item.malId === 200);
      return anime?.ratings.length === 1 && anime.ratings[0].memberId === storedBefore.memberId
        && anime.ratings[0].status === 'watching' && anime.ratings[0].watchedEpisodes === 0 && anime.ratings[0].score === null
        && card(200)?.querySelector('.anime-watch')?.getAttribute('aria-pressed') === 'true';
    }, 'Seasonal watching saved for current member');
    await switchSource('members', 200);
    await assertMemberDialog(200);
    await switchSource('season', 200);
  }
  input('#anime-genre-filter', 'Fantasy'); input('#anime-type-filter', 'TV'); input('#anime-sort', 'score');
  const memberOption = node('#anime-member-options input[value="' + storedBefore.otherMemberId + '"]');
  assert(memberOption, 'Member filter missing after seasonal source switch'); memberOption.checked = true;
  memberOption.dispatchEvent(new Event('change', { bubbles: true }));
  await switchSource('members');
  assert(node('#anime-genre-filter').value === 'Fantasy' && node('#anime-type-filter').value === 'TV'
    && node('#anime-sort').value === 'score', 'Member source switch reset available filters or sorting');
  assert(node('#anime-member-options input[value="' + storedBefore.otherMemberId + '"]').checked, 'Source switch reset member filter');
  await switchSource('season');
  assert(node('#anime-genre-filter').value === 'Fantasy' && node('#anime-type-filter').value === 'TV'
    && node('#anime-sort').value === 'score', 'Seasonal source switch reset available filters or sorting');
  node('#anime-clear-members').click(); input('#anime-genre-filter', 'all'); input('#anime-type-filter', 'all');
  assertGrid();
  await switchSource('members');
  await fetch('/test-season-failure/1', { method: 'POST' });
  await switchSource('season');
  assert(node('#anime-list-status').classList.contains('error-message') && !node('#anime-retry').hidden,
    'Season source failure has no error or retry');
  assert(!card(200), 'Failed seasonal source shows stale member collection');
  await fetch('/test-season-failure/0', { method: 'POST' }); node('#anime-retry').click();
  await waitUntil(() => Boolean(card(200)) && node('#anime-list').getAttribute('aria-busy') === 'false', 'Season source retry');
  assertSource('season'); assertGrid(); switchView('list'); await assertTable();
  assert(card(200), 'Seasonal source lost unfiltered discovery');
};
try {
  const scenario = new URLSearchParams(location.search).get('scenario'), guest = scenario === 'guest';
  assertControls();
  if (new URLSearchParams(location.search).get('viewReload') === '1') {
    assertSource('season'); assert(card(200), 'Seasonal source choice did not survive reload');
    assertView('list'); await assertTable();
    if (guest || scenario === 'expired') assert(!node('#anime-list .anime-edit, #anime-list .anime-delete'), 'Guest sees personal actions after reload');
    switchView('grid'); assertGrid();
    window.scrollTo({ top: Math.max(0, node('#anime-list').getBoundingClientRect().top + scrollY - 90), left: 0, behavior: 'instant' });
    if (guest || innerWidth < 700) await assertMemberDialog(199, { close: false });
    document.body.dataset.animeTest = 'passed';
  } else {
  assertSource('members'); assertView('grid');
  assert(!node('#anime-add-dialog').open, 'Dialog starts open');
  node('#anime-add-button').click();
  const canceled = new Promise(resolve => node('#anime-add-dialog').addEventListener('close', resolve, { once: true }));
  node('#anime-dialog-cancel').click(); await canceled;
  assert(!node('#anime-add-dialog').open, 'Dialog cancel failed');
  node('#anime-add-button').click();
  input('#anime-search', 'x'); assert(node('#anime-search-status').textContent.includes('Mindestens 2'), 'Missing minimum query feedback');
  assert((await state()).searches === 0, 'Single character called provider');
  await searchFor('nobody', 0); assert(node('#anime-search-status').textContent.includes('Keine Anime'), 'Missing empty state');
  input('#anime-search', 'error'); await waitUntil(() => node('#anime-search-status').classList.contains('error-message'), 'Provider failure');
  assert(node('#anime-search-status').textContent.includes('Die Anime-Quelle ist momentan nicht erreichbar.'), 'Controlled source failure was replaced by a generic server error');
  await searchFor('Cowboy', 1); node('#anime-search-more').click();
  await waitUntil(() => results().length === 2 && node('#anime-search-more').hidden, 'Pagination');
  results()[0].click();
  await waitUntil(() => node('#anime-selection .game-title')?.textContent === 'Cowboy Bebop' && node('#anime-selection').getAttribute('aria-busy') === 'false', 'Provider details');
  assert(node('#anime-selection img').src.includes('cdn.myanimelist.net'), 'Poster missing');
  assert(node('#anime-selection').textContent.includes('26'), 'Provider episodes missing');
  assert(node('#anime-entry-options .anime-episode-field').hidden && node('#anime-entry-options .anime-score-field').hidden, 'Plan to watch displays episodes or rating');
  if (guest) {
    assert(node('#anime-entry-fields').disabled && !node('#anime-login').hidden, 'Guest controls or login state wrong');
    submit();
    const response = await fetch('/api/anime/1/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'plan_to_watch' }) });
    assert(response.status === 401, 'Guest write accepted');
    node('#anime-dialog-cancel').click(); assert(!node('#anime-list .anime-edit') && !node('#anime-list .anime-delete'), 'Guest sees personal actions');
    assertGrid();
    await assertMemberDialog(199); await assertMemberDialog(5114, { dismissal: 'cancel' }); await assertMemberDialog(21, { dismissal: 'backdrop' });
    switchView('list'); await assertTable();
    assert(!node('#anime-list .anime-edit, #anime-list .anime-delete'), 'Guest sees personal list actions');
  } else {
    input('#anime-status', 'watching');
    assert(!node('#anime-episodes').disabled && node('#anime-score').disabled, 'Watching fields wrong');
    input('#anime-episodes', '4');
    const initial = await state();
    await waitUntil(() => Boolean(node('#anime-add-member-options input[value="' + initial.otherMemberId + '"]')), 'Member selector');
    node('#anime-add-member-options input[value="' + initial.otherMemberId + '"]').checked = true; submit();
    await waitUntil(() => Boolean(card(1)) && !node('#anime-add-dialog').open, 'Saved watching entry');
    assertGrid(); await assertMemberDialog(1); edit(1);
    const contentBounds = card(1).getBoundingClientRect();
    for (const control of card(1).querySelectorAll('.anime-entry-editor input, .anime-entry-editor select')) {
      if (!control.getClientRects().length) continue;
      const bounds = control.getBoundingClientRect();
      assert(bounds.left >= contentBounds.left && bounds.right <= contentBounds.right, 'Grid editor control overflows card');
    }
    card(1).querySelector('.anime-inline-cancel').click(); assertNoOverflow('Grid editor');
    switchView('list'); await assertTable();
    assert(reviewProgress(1).textContent === '4 / 26 Episoden', 'Watching progress missing');
    assert(!reviewScore(1), 'Watching or planned displayed rating');
    assert(card(1).querySelectorAll('.game-review-avatar').length === 2, 'Additional member missing');
    assert(card(1).querySelector('.game-review-avatar').title === 'Alex', 'Avatar hover name missing');
    edit(1); assert(card(1).querySelector('.anime-inline-episodes').value === '4', 'Progress not prefilled');
    inlineInput(1, 'episodes', '6'); card(1).querySelector('.anime-inline-cancel').click(); edit(1);
    assert(card(1).querySelector('.anime-inline-episodes').value === '4', 'Cancel changed progress');
    inlineInput(1, 'status', 'plan_to_watch');
    assert(card(1).querySelector('.anime-inline-episodes').disabled && card(1).querySelector('.anime-inline-score').disabled, 'Inline plan fields wrong');
    inlineSave(1); await waitUntil(() => card(1)?.querySelector('.anime-entry-editor').hidden && !reviewProgress(1), 'Saved plan without progress');
    edit(1); inlineInput(1, 'status', 'completed');
    assert(card(1).querySelector('.anime-inline-episodes').value === '26' && card(1).querySelector('.anime-inline-episodes').readOnly, 'Completed did not fill total');
    assert(!card(1).querySelector('.anime-inline-score').disabled, 'Completed rating unavailable');
    inlineInput(1, 'score', '8'); inlineSave(1);
    await waitUntil(() => reviewScore(1)?.textContent === '8 / 10' && card(1).querySelector('.anime-entry-editor').hidden, 'Completed score saved');
    await fetch('/test-seed', { method: 'POST' }); edit(1); inlineSave(1); await waitUntil(() => titles().length === 4, 'Library refresh');
    const seeded = await state(); input('#anime-sort', 'oldest');
    assertTitles(['Cowboy Bebop', 'Fullmetal Alchemist: Brotherhood', 'One Piece', 'Spirited Away'], 'Oldest');
    await assertTable();
    input('#anime-sort', 'newest'); assertTitles(['Spirited Away', 'One Piece', 'Fullmetal Alchemist: Brotherhood', 'Cowboy Bebop'], 'Newest');
    input('#anime-sort', 'episodes-asc'); assertTitles(['Spirited Away', 'Cowboy Bebop', 'Fullmetal Alchemist: Brotherhood', 'One Piece'], 'Episode count unknown last');
    input('#anime-sort', 'episodes-desc'); assertTitles(['Fullmetal Alchemist: Brotherhood', 'Cowboy Bebop', 'Spirited Away', 'One Piece'], 'Episodes descending');
    input('#anime-sort', 'score'); assertTitles(['Fullmetal Alchemist: Brotherhood', 'Spirited Away', 'Cowboy Bebop', 'One Piece'], 'MAL score');
    const sorted = titles(); switchView('grid'); assertGrid(); assertTitles(sorted, 'Switch retained score sort');
    await assertMemberDialog(199); await assertMemberDialog(5114, { dismissal: 'cancel' }); await assertMemberDialog(21, { dismissal: 'backdrop' });
    switchView('list'); assertTitles(sorted, 'List retained score sort'); await assertTable();
    input('#anime-sort', 'oldest');
    node('#anime-members-filter').open = true;
    for (const id of [seeded.memberId, seeded.otherMemberId]) {
      const checkbox = node('#anime-member-options input[value="' + id + '"]'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    assertTitles(['Cowboy Bebop', 'Fullmetal Alchemist: Brotherhood', 'One Piece'], 'All selected members required');
    input('#anime-status-filter', 'watching'); input('#anime-genre-filter', 'Action'); input('#anime-type-filter', 'TV');
    assertTitles(['Fullmetal Alchemist: Brotherhood', 'One Piece'], 'Composed filters');
    switchView('grid'); assertGrid(); assertTitles(['Fullmetal Alchemist: Brotherhood', 'One Piece'], 'Grid retained composed filters');
    assert(node('#anime-status-filter').value === 'watching' && node('#anime-genre-filter').value === 'Action' && node('#anime-type-filter').value === 'TV', 'Switch reset filter controls');
    assert(node('#anime-member-options').querySelectorAll('input:checked').length === 2, 'Switch reset selected members');
    switchView('list'); assertTitles(['Fullmetal Alchemist: Brotherhood', 'One Piece'], 'List retained composed filters'); await assertTable();
    node('#anime-clear-members').click(); input('#anime-status-filter', 'all'); input('#anime-genre-filter', 'all'); input('#anime-type-filter', 'Movie');
    assertTitles(['Spirited Away'], 'Format filter');
    input('#anime-type-filter', 'all'); node('#anime-members-filter').open = false;
    assert(!card(21).querySelector('.anime-list-cover img') && card(21).querySelector('.anime-list-cover .game-cover-placeholder'), 'Missing list artwork has no fallback');
    assert(card(1).querySelector('.anime-delete') && !card(5114).querySelector('.anime-delete'), 'Creator delete buttons wrong');
    const denied = await fetch('/api/anime/5114', { method: 'DELETE' }); assert(denied.status === 403, 'Non-creator deletion accepted');
    card(1).querySelector('.anime-delete').click(); card(1).querySelector('.anime-cancel-delete').click();
    assert(card(1), 'Cancel deleted card');
    if (scenario === 'expired') {
      await fetch('/test-expire', { method: 'POST' }); edit(5114); inlineInput(5114, 'episodes', '11'); inlineSave(5114);
      await waitUntil(() => card(5114)?.querySelector('.anime-inline-message').textContent.includes('Sitzung ist abgelaufen'), 'Expired session feedback');
      assert((await state()).items.find(item => item.malId === 5114).ratings.find(entry => entry.memberId === seeded.memberId).watchedEpisodes === 10, 'Expired session wrote progress');
    } else {
      card(1).querySelector('.anime-delete').click(); card(1).querySelector('.anime-confirm-delete').click();
      await waitUntil(() => !card(1) && titles().length === 3, 'Creator deletion');
      assert(!(await state()).items.some(item => item.malId === 1), 'Deleted anime remains');
    }
  }
  const { createAnimeCard, createAnimeTable, createAnimeMemberList, createAnimeEntryFields, validAnimeInput } = await import('/assets/js/components/anime.js');
  const scratch = createAnimeCard({ malId: 2, title: '<img src=x onerror=alert(1)>', imageUrl: 'javascript:alert(1)', genres: [], ratings: [] });
  assert(!scratch.querySelector('img') && scratch.querySelector('.game-title').textContent.includes('<img'), 'Untrusted anime data became HTML');
  assert(!scratch.querySelector('.anime-members-button'), 'Empty card has an avatar dialog button');
  const unsafeText = '<img src=x onerror=alert(1)>', tableScratch = createAnimeTable([{ malId: 2, title: unsafeText,
    imageUrl: 'javascript:alert(1)', genres: [unsafeText], averageScore: 8.5, ratings: [{ memberName: unsafeText, status: 'watching', watchedEpisodes: 3 }] }]);
  assert(!tableScratch.querySelector('img') && tableScratch.querySelector('tbody .anime-list-title').textContent.includes(unsafeText)
    && tableScratch.querySelector('tbody .anime-list-tags').textContent.includes(unsafeText) && tableScratch.querySelector('tbody .anime-list-members').textContent.includes(unsafeText), 'Untrusted list data became HTML');
  assert(tableScratch.querySelector('tbody .anime-list-score').textContent === '8,5 / 10', 'Community average decimal is not localized');
  const memberScratch = createAnimeMemberList({ episodes: null, ratings: [{ memberName: unsafeText, status: 'completed', watchedEpisodes: 12, score: null }] });
  assert(!memberScratch.querySelector('img') && memberScratch.querySelector('.anime-member-detail-name').textContent === unsafeText, 'Untrusted member details became HTML');
  assert(memberScratch.querySelector('.anime-review-progress').textContent === '12 Episoden'
    && memberScratch.querySelector('.game-review-score').textContent === '\u2014', 'Unknown episode total or missing score is misrepresented');
  assert(createAnimeMemberList({ ratings: [] }).querySelector('.anime-member-detail-empty'), 'Empty member dialog has no explanation');
  const unknown = createAnimeEntryFields({ episodes: null }, { status: 'watching', watchedEpisodes: 12 }); unknown.status.value = 'completed'; unknown.status.dispatchEvent(new Event('change'));
  assert(!unknown.episodes.readOnly && validAnimeInput(unknown.read(), { episodes: null }), 'Unknown total prevented entering own completed count');
  await assertTable(); switchView('grid'); assertGrid(); switchView('list');
  await checkSeasonalSource({ readOnly: guest || scenario === 'expired' });
  const reloadUrl = new URL(location.href); reloadUrl.searchParams.set('viewReload', '1'); location.replace(reloadUrl);
  }
} catch (error) { document.body.dataset.animeTest = 'failed'; document.body.dataset.animeTestError = error.stack; console.error(error); }
`));
app.use(application);
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const temporary = mkdtempSync(path.join(tmpdir(), 'lacedaemon-anime-'));
const cases = [['desktop', 1440, 'normal'], ['mobile', 390, 'normal'], ['guest', 1440, 'guest'], ['expired', 1000, 'expired']];
try {
  for (const [name, width, scenario] of cases) {
    const screenshot = path.join(temporary, name + '.png');
    await checkBrowser(browser, path.join(temporary, name + '-profile'), screenshot, width,
      `http://127.0.0.1:${server.address().port}/pages/anime.html?scenario=${scenario}`);
    console.log(`${name}: OK; screenshot: ${screenshot}`);
  }
} finally {
  application.locals.monopoly.rooms.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close();
  for (const [name] of cases) {
    const profile = path.resolve(temporary, name + '-profile');
    if (path.dirname(profile) === path.resolve(temporary) && path.basename(temporary).startsWith('lacedaemon-anime-')) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* A browser lock may linger. */ }
    }
  }
}
