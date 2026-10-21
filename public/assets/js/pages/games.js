import { initLayout } from '../core/layout.js';
import { api } from '../core/api.js';
import { createGameCard, createSearchResult, ownRating, steamAppId, GAME_STATUSES, GAME_PRIORITIES,
  gameReviewInput, validGameReview, updateGameReviewFields } from '../components/steam-games.js';
import { memberOptions, filterAndSortGames } from './games-view.js';

void initLayout();

const list = document.querySelector('#games-list');
const count = document.querySelector('#games-count');
const listStatus = document.querySelector('#games-list-status');
const retry = document.querySelector('#games-retry');
const search = document.querySelector('#game-search');
const results = document.querySelector('#game-search-results');
const more = document.querySelector('#game-search-more');
const searchStatus = document.querySelector('#game-search-status');
const selection = document.querySelector('#game-selection');
const session = document.querySelector('#games-session');
const login = document.querySelector('#games-login');
const authRetry = document.querySelector('#games-auth-retry');
const form = document.querySelector('#game-review-form');
const fields = document.querySelector('#game-review-fields');
const save = document.querySelector('#game-save');
const message = document.querySelector('#game-review-message');
const status = document.querySelector('#game-status');
const score = document.querySelector('#game-score');
const priority = document.querySelector('#game-priority');
const addMemberOptions = document.querySelector('#game-add-member-options');
const membersMessage = document.querySelector('#game-members-message');
const membersRetry = document.querySelector('#game-members-retry');
const dialog = document.querySelector('#games-add-dialog');
const openDialog = document.querySelector('#games-add-button');
const closeDialog = document.querySelector('#games-dialog-close');
const cancelDialog = document.querySelector('#games-dialog-cancel');
const memberFilter = document.querySelector('#games-members-filter');
const memberFields = document.querySelector('#games-member-options');
const selectedCount = document.querySelector('#games-selected-members');
const clearMembers = document.querySelector('#games-clear-members');
const statusFilter = document.querySelector('#games-status-filter');
const sortFilter = document.querySelector('#games-sort');
const feedback = document.querySelector('#games-feedback');

let member = null;
let games = [];
let selectedGame = null;
let saving = false;
let searchTimer;
let searchController;
let detailsController;
let searchVersion = 0;
let detailsVersion = 0;
let searchQuery = '';
let searchPage = 0;
let searchItems = [];
let selectedMemberIds = new Set();
let gamesLoaded = false;
let gamesError = '';
let availableMembers = [];
let membersLoaded = false;
let membersLoading = false;

function setMessage(target, text, error = false) {
  target.textContent = text;
  target.classList.toggle('error-message', error);
}

function updateSaveState() {
  fields.disabled = !member || !selectedGame || saving;
  search.disabled = saving;
  more.disabled = saving;
  closeDialog.disabled = saving;
  cancelDialog.disabled = saving;
  save.textContent = saving ? 'Wird gespeichert …' : ownRating(selectedGame || {}, member) ? 'Eintrag aktualisieren'
    : status.value === 'planned' ? 'Merkliste speichern' : status.value === 'ongoing' ? 'Status speichern' : 'Bewertung speichern';
}

function renderAddMembers() {
  const selected = new Set([...addMemberOptions.querySelectorAll('input:checked')].map(input => input.value));
  addMemberOptions.replaceChildren();
  for (const entry of availableMembers.filter(entry => String(entry.id) !== String(member?.id))) {
    const label = document.createElement('label');
    label.className = 'games-member-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'addMemberId';
    checkbox.value = String(entry.id);
    checkbox.checked = selected.has(checkbox.value);
    const name = document.createElement('span');
    name.textContent = entry.name || 'Unbekanntes Mitglied';
    label.append(checkbox, name);
    addMemberOptions.append(label);
  }
}

async function refreshAvailableMembers() {
  if (!member || membersLoading) return;
  membersLoading = true;
  membersRetry.hidden = true;
  setMessage(membersMessage, 'Mitglieder werden geladen …');
  try {
    const response = await api('/games/members', { cache: 'no-store' });
    if (!Array.isArray(response.members)) throw new Error('Mitglieder konnten nicht geladen werden.');
    availableMembers = response.members;
    membersLoaded = true;
    renderAddMembers();
    setMessage(membersMessage, availableMembers.some(entry => String(entry.id) !== String(member.id)) ? '' : 'Noch keine weiteren Mitglieder angemeldet.');
  } catch (error) {
    setMessage(membersMessage, error.message || 'Mitglieder konnten nicht geladen werden.', true);
    membersRetry.hidden = false;
  } finally { membersLoading = false; }
}
membersRetry.addEventListener('click', refreshAvailableMembers);
status.addEventListener('change', () => {
  updateGameReviewFields(status.value, score, priority);
  updateSaveState();
});

function renderGames() {
  const visible = filterAndSortGames(games, { memberIds: [...selectedMemberIds], status: statusFilter.value, sort: sortFilter.value });
  list.replaceChildren(...visible.map(game => createGameCard(game, { member, onSaveReview: saveReview, onDelete: deleteGame })));
  if (gamesLoaded) {
    count.textContent = visible.length === games.length ? `${games.length} ${games.length === 1 ? 'Spiel' : 'Spiele'}` : `${visible.length} von ${games.length} Spielen`;
    if (gamesError) {
      setMessage(listStatus, gamesError, true);
      listStatus.hidden = false;
    } else {
      setMessage(listStatus, visible.length ? '' : games.length ? 'Keine Spiele passen zu dieser Auswahl.' : 'Noch keine Spiele eingetragen. Füge das erste Spiel hinzu.');
      listStatus.hidden = visible.length > 0;
    }
  }
}

function updateMemberFilter() {
  selectedCount.textContent = String(selectedMemberIds.size);
  selectedCount.hidden = selectedMemberIds.size === 0;
  clearMembers.disabled = selectedMemberIds.size === 0;
}

function renderMemberOptions() {
  const options = memberOptions(games);
  const available = new Set(options.map(option => option.id));
  selectedMemberIds = new Set([...selectedMemberIds].filter(id => available.has(id)));
  const legend = document.createElement('legend');
  legend.className = 'games-visually-hidden';
  legend.textContent = 'Mitglieder auswählen';
  memberFields.replaceChildren(legend);
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'games-member-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'memberId';
    checkbox.value = option.id;
    checkbox.checked = selectedMemberIds.has(option.id);
    const name = document.createElement('span');
    name.textContent = option.name;
    label.append(checkbox, name);
    memberFields.append(label);
  }
  if (!options.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Noch keine angemeldeten Mitglieder mit Bewertungen.';
    memberFields.append(empty);
  }
  updateMemberFilter();
}

function prefillReview() {
  const rating = ownRating(selectedGame || {}, member);
  status.value = rating && Object.hasOwn(GAME_STATUSES, rating.status) ? rating.status : 'planned';
  score.value = rating && Number.isInteger(Number(rating.score)) && Number(rating.score) >= 1 && Number(rating.score) <= 10 ? String(rating.score) : '8';
  priority.value = rating && Object.hasOwn(GAME_PRIORITIES, rating.priority) ? rating.priority : 'medium';
  updateGameReviewFields(status.value, score, priority);
}

async function refreshGames() {
  retry.hidden = true;
  retry.disabled = true;
  list.setAttribute('aria-busy', 'true');
  try {
    const response = await api('/games', { cache: 'no-store' });
    if (!Array.isArray(response.items)) throw new Error('Ungültige Antwort beim Laden der Spiele.');
    games = response.items;
    gamesLoaded = true;
    gamesError = '';
    renderMemberOptions();
    renderGames();
    return true;
  } catch (error) {
    gamesError = error.message || 'Spiele konnten nicht geladen werden.';
    listStatus.hidden = false;
    setMessage(listStatus, gamesError, true);
    count.textContent = games.length ? `${games.length} Spiele` : 'Nicht verfügbar';
    retry.hidden = false;
    return false;
  } finally {
    retry.disabled = false;
    list.setAttribute('aria-busy', 'false');
  }
}

async function refreshMember({ render = true } = {}) {
  authRetry.hidden = true;
  authRetry.disabled = true;
  try {
    const response = await api('/auth/me', { cache: 'no-store' });
    member = response.member || null;
    setMessage(session, member ? `Du bewertest als ${member.name || member.username || 'Discord-Mitglied'}.` : 'Melde dich mit Discord an, um Spiele hinzuzufügen oder zu bewerten.');
    login.hidden = Boolean(member);
    if (dialog.open && member && !membersLoaded) void refreshAvailableMembers();
    if (selectedGame && !saving) prefillReview();
    if (render) renderGames();
    return member ? 'authenticated' : 'guest';
  } catch {
    member = null;
    setMessage(session, 'Der Anmeldestatus konnte nicht geprüft werden.', true);
    login.hidden = false;
    authRetry.hidden = false;
    if (render) renderGames();
    return 'unavailable';
  } finally {
    authRetry.disabled = false;
    updateSaveState();
  }
}

function updateLoginLink() {
  login.href = `/api/auth/discord?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
}
updateLoginLink();
login.addEventListener('click', updateLoginLink);
authRetry.addEventListener('click', () => refreshMember());
retry.addEventListener('click', refreshGames);

memberFields.addEventListener('change', () => {
  selectedMemberIds = new Set([...memberFields.querySelectorAll('input[name="memberId"]:checked')].map(input => input.value));
  updateMemberFilter();
  renderGames();
});
clearMembers.addEventListener('click', () => {
  selectedMemberIds.clear();
  memberFields.querySelectorAll('input[name="memberId"]').forEach(input => { input.checked = false; });
  updateMemberFilter();
  renderGames();
});
statusFilter.addEventListener('change', renderGames);
sortFilter.addEventListener('change', renderGames);
document.addEventListener('click', event => {
  if (!memberFilter.contains(event.target)) memberFilter.open = false;
});
memberFilter.addEventListener('keydown', event => {
  if (event.key === 'Escape' && memberFilter.open) {
    event.preventDefault();
    memberFilter.open = false;
    memberFilter.querySelector('summary').focus();
  }
});

openDialog.addEventListener('click', () => {
  if (dialog.open) return;
  dialog.showModal();
  if (member) void refreshAvailableMembers();
  search.focus();
});
closeDialog.addEventListener('click', () => { if (!saving) dialog.close(); });
cancelDialog.addEventListener('click', () => { if (!saving) dialog.close(); });
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
dialog.addEventListener('close', () => {
  clearTimeout(searchTimer);
  searchController?.abort();
  searchVersion += 1;
  resetSelection();
  clearResults();
  search.value = '';
  results.setAttribute('aria-busy', 'false');
  setMessage(searchStatus, 'Mindestens 2 Zeichen eingeben.');
  setMessage(message, '');
  addMemberOptions.querySelectorAll('input').forEach(input => { input.checked = false; });
});

async function mutationFailed(error) {
  let text = error.message || 'Die Änderung konnte nicht gespeichert werden.';
  if (error.status === 401) {
    const authState = await refreshMember({ render: false });
    if (authState === 'guest') text = 'Deine Sitzung ist abgelaufen. Melde dich über „Spiel hinzufügen“ erneut mit Discord an.';
  }
  setMessage(feedback, text, true);
  throw new Error(text);
}

async function saveReview(game, input) {
  const id = steamAppId(game.steamAppId);
  if (!member || !id) throw new Error('Bitte melde dich mit Discord an.');
  try {
    await api(`/games/${id}/reviews`, { method: 'POST', body: JSON.stringify({ score: input.score, status: input.status,
      priority: input.priority, memberIds: input.memberIds ?? [] }) });
  } catch (error) { return mutationFailed(error); }
  setMessage(feedback, 'Deine Bewertung wurde gespeichert.');
  await refreshGames();
}

async function deleteGame(game) {
  const id = steamAppId(game.steamAppId);
  if (!member || !id || game.legacy || String(game.creatorMemberId) !== String(member.id)) throw new Error('Nur der Ersteller kann diesen Spieleintrag löschen.');
  try { await api(`/games/${id}`, { method: 'DELETE' }); }
  catch (error) { return mutationFailed(error); }
  setMessage(feedback, 'Der Spieleintrag wurde gelöscht.');
  await refreshGames();
}

function clearResults() {
  results.replaceChildren();
  results.hidden = true;
  more.hidden = true;
  searchItems = [];
  searchPage = 0;
}

function resetSelection() {
  detailsController?.abort();
  detailsVersion += 1;
  selectedGame = null;
  selection.replaceChildren();
  selection.hidden = true;
  selection.setAttribute('aria-busy', 'false');
  updateSaveState();
}

async function searchSteam(query, version, page = 1) {
  searchController = new AbortController();
  const controller = searchController;
  results.setAttribute('aria-busy', 'true');
  more.disabled = true;
  setMessage(searchStatus, page === 1 ? 'Steam wird durchsucht …' : 'Weitere Treffer werden geladen …');
  try {
    const response = await api(`/games/search?q=${encodeURIComponent(query)}&page=${page}`, { signal: controller.signal });
    if (version !== searchVersion || controller.signal.aborted) return;
    if (!Array.isArray(response.items)) throw new Error('Steam hat keine gültigen Suchergebnisse geliefert.');
    const existing = new Set(searchItems.map(game => steamAppId(game.steamAppId)));
    const items = response.items.filter(game => {
      const id = steamAppId(game.steamAppId);
      if (!id || existing.has(id)) return false;
      existing.add(id);
      return true;
    });
    searchItems.push(...items);
    searchPage = page;
    searchQuery = query;
    results.append(...items.map(game => createSearchResult(game, selectGame)));
    results.hidden = searchItems.length === 0;
    more.hidden = !response.hasMore;
    const total = Number(response.total);
    const summary = Number.isFinite(total) && total >= searchItems.length ? `${searchItems.length} von ${total} Treffern` : `${searchItems.length} Treffer`;
    setMessage(searchStatus, searchItems.length ? `${summary}. Wähle ein Spiel aus.` : 'Keine Spiele gefunden. Versuche einen anderen Suchbegriff.');
  } catch (error) {
    if (version !== searchVersion || controller.signal.aborted) return;
    if (page === 1) clearResults();
    setMessage(searchStatus, error.message || 'Die Steam-Suche ist momentan nicht verfügbar.', true);
  } finally {
    if (version === searchVersion) {
      results.setAttribute('aria-busy', 'false');
      more.disabled = false;
    }
  }
}

more.addEventListener('click', () => {
  if (!more.disabled && searchQuery && searchPage) void searchSteam(searchQuery, searchVersion, searchPage + 1);
});

search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchController?.abort();
  searchVersion += 1;
  const version = searchVersion;
  resetSelection();
  clearResults();
  results.setAttribute('aria-busy', 'false');
  setMessage(message, '');
  const query = search.value.trim();
  if (query.length < 2) {
    setMessage(searchStatus, 'Mindestens 2 Zeichen eingeben.');
    return;
  }
  setMessage(searchStatus, 'Suche wird vorbereitet …');
  searchTimer = setTimeout(() => searchSteam(query, version), 300);
});

async function selectGame(game) {
  if (saving) return;
  const id = steamAppId(game.steamAppId);
  if (!id) return;
  clearTimeout(searchTimer);
  searchController?.abort();
  searchVersion += 1;
  resetSelection();
  const version = detailsVersion;
  detailsController = new AbortController();
  const controller = detailsController;
  clearResults();
  results.setAttribute('aria-busy', 'false');
  search.value = game.title || '';
  setMessage(searchStatus, 'Spieldetails werden geladen …');
  setMessage(message, '');
  selection.hidden = false;
  selection.setAttribute('aria-busy', 'true');
  try {
    const response = await api(`/games/steam/${id}`, { signal: controller.signal });
    if (version !== detailsVersion || controller.signal.aborted) return;
    if (steamAppId(response.game?.steamAppId) !== id) throw new Error('Die Spieldetails konnten nicht zugeordnet werden.');
    const existing = games.find(entry => steamAppId(entry.steamAppId) === id);
    selectedGame = { ...response.game, ratings: existing?.ratings || [] };
    selection.replaceChildren(createGameCard(selectedGame, { preview: true }));
    prefillReview();
    setMessage(searchStatus, `${selectedGame.title} ausgewählt.`);
    updateSaveState();
  } catch (error) {
    if (version !== detailsVersion || controller.signal.aborted) return;
    selection.hidden = true;
    setMessage(searchStatus, `${error.message || 'Die Spieldetails konnten nicht geladen werden.'} Wähle das Spiel erneut aus oder suche noch einmal.`, true);
  } finally {
    if (version === detailsVersion) selection.setAttribute('aria-busy', 'false');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const id = steamAppId(selectedGame?.steamAppId);
  if (!member || !id || saving) return;
  const input = { ...gameReviewInput(status.value, score.value, priority.value),
    memberIds: [...addMemberOptions.querySelectorAll('input:checked')].map(input => Number(input.value)) };
  if (!validGameReview(input)) {
    setMessage(message, 'Bitte wähle einen gültigen Status sowie eine Priorität oder Bewertung.', true);
    return;
  }
  saving = true;
  updateSaveState();
  setMessage(message, 'Bewertung wird gespeichert …');
  try {
    await saveReview(selectedGame, input);
    dialog.close();
  } catch (error) {
    setMessage(message, error.message || 'Die Bewertung konnte nicht gespeichert werden.', true);
  } finally {
    saving = false;
    updateSaveState();
  }
});

await Promise.all([refreshGames(), refreshMember()]);
