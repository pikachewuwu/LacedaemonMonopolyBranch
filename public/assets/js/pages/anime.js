import { initLayout } from '../core/layout.js';
import { api } from '../core/api.js';
import { ownRating } from '../components/steam-games.js';
import { element, animeId, createAnimeCard, createAnimeTable, createAnimeMemberList, createAnimeSearchResult, createAnimeEntryFields, validAnimeInput } from '../components/anime.js';
import { animeMemberOptions, filterAnime } from './anime-view.js';

void initLayout();
const node = id => document.querySelector(`#anime-${id}`);
const list = node('list'), count = node('count'), listStatus = node('list-status'), retry = node('retry'), feedback = node('feedback');
const dialog = node('add-dialog'), search = node('search'), results = node('search-results'), more = node('search-more'), searchStatus = node('search-status');
const selection = node('selection'), fields = node('entry-fields'), options = node('entry-options'), form = node('entry-form'), save = node('save'), message = node('entry-message');
const login = node('login'), session = node('session'), authRetry = node('auth-retry'), close = node('dialog-close'), cancel = node('dialog-cancel');
const memberFilter = node('members-filter'), memberOptions = node('member-options'), selectedCount = node('selected-members'), clear = node('clear-members');
const statusFilter = node('status-filter'), genreFilter = node('genre-filter'), typeFilter = node('type-filter'), sortFilter = node('sort');
const addMembers = node('add-member-options'), membersMessage = node('members-message'), membersRetry = node('members-retry');
const viewButtons = node('view-toggle').querySelectorAll('[data-anime-view]');
const viewStorageKey = 'lacedaemon:anime-view';
const sourceButtons = node('source-toggle').querySelectorAll('[data-anime-source]');
const sourceDescription = node('source-description'), libraryHeading = node('library-heading');
const memberDialog = node('members-dialog'), memberDialogHeading = node('members-heading'), memberDialogList = node('members-list'), memberDialogClose = node('members-close');
let memberDialogTrigger = null;
const sourceStorageKey = 'lacedaemon:anime-source';
let view = 'grid';
try { if (localStorage.getItem(viewStorageKey) === 'list') view = 'list'; } catch { /* The view also works without browser storage. */ }
let source = 'members', season = null, libraryVersion = 0, libraryController;
try { if (localStorage.getItem(sourceStorageKey) === 'season') source = 'season'; } catch { /* Browser storage is optional. */ }
let member = null, items = [], selected = null, memberIds = new Set(), saving = false, loaded = false;
let inputs = createAnimeEntryFields({ episodes: null }); options.append(inputs.root);
let searchTimer, searchController, detailsController, searchVersion = 0, detailsVersion = 0, currentQuery = '', currentPage = 0, searchItems = [];
let membersLoading = false;
let pendingLibraryRender = false, entrySaves = 0;

function show(target, text, error = false) { target.textContent = text; target.classList.toggle('error-message', error); }
function updateState() {
  fields.disabled = !member || !selected || saving;
  [search, close, cancel].forEach(control => { control.disabled = saving; });
  more.disabled = saving;
  save.textContent = saving ? 'Wird hinzugefügt …' : 'Anime hinzufügen';
}
function render() {
  pendingLibraryRender = false;
  const visible = filterAnime(items, { memberIds: [...memberIds], status: statusFilter.value, genre: genreFilter.value, type: typeFilter.value, sort: sortFilter.value });
  const tableView = view === 'list', actions = { member, onSave: saveEntry, onDelete: deleteAnime, onMembers: showAnimeMembers, seasonal: source === 'season' };
  sourceButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.animeSource === source)));
  libraryHeading.textContent = source === 'season' ? season?.label || 'Aktuelle Season' : 'Unsere Anime';
  sourceDescription.textContent = source === 'season'
    ? `${season?.label ? `${season.label}: alle` : 'Alle'} Anime dieser Season. Wähle „Schaue ich“ oder merke dir einen Anime mit „Interessant“.`
    : 'Alle Anime, die Mitglieder schauen, planen oder bereits abgeschlossen haben.';
  list.classList.toggle('games-cards', !tableView);
  list.classList.toggle('anime-list-view', tableView);
  if (tableView) {
    list.setAttribute('tabindex', '0'); list.setAttribute('role', 'region'); list.setAttribute('aria-label', 'Anime-Liste');
  } else {
    list.removeAttribute('tabindex'); list.removeAttribute('role'); list.removeAttribute('aria-label');
  }
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.animeView === view)));
  const children = tableView
    ? (visible.length ? [createAnimeTable(visible, actions)] : [])
    : visible.map(anime => createAnimeCard(anime, actions));
  list.replaceChildren(...children);
  if (loaded) {
    count.textContent = visible.length === items.length ? `${items.length} Anime` : `${visible.length} von ${items.length} Anime`;
    show(listStatus, visible.length ? '' : items.length ? 'Keine Anime passen zu dieser Auswahl.'
      : source === 'season' ? 'Für diese Season sind noch keine Anime verfügbar.' : 'Noch keine Anime eingetragen. Füge den ersten Anime hinzu.');
    listStatus.hidden = visible.length > 0;
  }
}
function flushPendingRender() {
  if (pendingLibraryRender && entrySaves === 0 && !list.contains(document.activeElement)
    && !list.querySelector('.anime-inline-message.error-message')) { updateFilters(); render(); }
}
list.addEventListener('focusout', () => { setTimeout(flushPendingRender, 0); });
function showAnimeMembers(anime) {
  memberDialogTrigger = document.activeElement;
  memberDialogHeading.textContent = anime.title || 'Mitglieder';
  memberDialogList.replaceChildren(createAnimeMemberList(anime));
  if (!memberDialog.open) memberDialog.showModal();
  memberDialogClose.focus();
}
memberDialogClose.addEventListener('click', () => memberDialog.close());
memberDialog.addEventListener('click', event => {
  if (event.target !== memberDialog) return;
  const bounds = memberDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) memberDialog.close();
});
memberDialog.addEventListener('close', () => {
  if (memberDialogTrigger?.isConnected) memberDialogTrigger.focus();
  else node('view-toggle').querySelector('[aria-pressed="true"]').focus();
  memberDialogTrigger = null;
});
viewButtons.forEach(button => button.addEventListener('click', () => {
  if (view === button.dataset.animeView) return;
  view = button.dataset.animeView;
  try { localStorage.setItem(viewStorageKey, view); } catch { /* Keep switching available when storage is blocked. */ }
  render();
}));
sourceButtons.forEach(button => button.addEventListener('click', () => {
  if (source === button.dataset.animeSource) return;
  source = button.dataset.animeSource;
  try { localStorage.setItem(sourceStorageKey, source); } catch { /* Keep switching available when storage is blocked. */ }
  items = []; loaded = false; count.textContent = 'Wird geladen …';
  render(); void refresh();
}));
function updateMemberCount() { selectedCount.textContent = String(memberIds.size); selectedCount.hidden = memberIds.size === 0; clear.disabled = memberIds.size === 0; }
function updateFilters() {
  const members = animeMemberOptions(items), available = new Set(members.map(member => member.id));
  memberIds = new Set([...memberIds].filter(id => available.has(id)));
  const legend = element('legend', 'games-visually-hidden', 'Mitglieder auswählen'); memberOptions.replaceChildren(legend);
  for (const entry of members) {
    const label = element('label', 'games-member-option'), input = element('input');
    input.type = 'checkbox'; input.value = entry.id; input.name = 'memberId'; input.checked = memberIds.has(entry.id);
    label.append(input, element('span', '', entry.name)); memberOptions.append(label);
  }
  if (!members.length) memberOptions.append(element('p', 'muted', 'Noch keine Mitglieder mit Anime-Einträgen.'));
  for (const [filter, values, label] of [[genreFilter, items.flatMap(item => item.genres ?? []), 'Alle Genres'], [typeFilter, items.map(item => item.type).filter(Boolean), 'Alle Formate']]) {
    const previous = filter.value, first = element('option', '', label); first.value = 'all'; filter.replaceChildren(first);
    for (const value of [...new Set(values)].sort((a, b) => a.localeCompare(b, 'de'))) {
      const option = element('option', '', value); option.value = value; filter.append(option);
    }
    filter.value = [...filter.options].some(option => option.value === previous) ? previous : 'all';
  }
  updateMemberCount();
}
async function refresh({ deferRender = false } = {}) {
  libraryController?.abort();
  const controller = new AbortController(), version = ++libraryVersion;
  libraryController = controller;
  retry.hidden = true; retry.disabled = true; list.setAttribute('aria-busy', 'true');
  if (!loaded) {
    show(listStatus, source === 'season' ? 'Anime der aktuellen Season werden geladen …' : 'Anime werden geladen …'); listStatus.hidden = false;
  }
  try {
    const response = await api(source === 'season' ? '/anime/season' : '/anime', { cache: 'no-store', signal: controller.signal });
    if (version !== libraryVersion || controller.signal.aborted) return false;
    if (!Array.isArray(response.items)) throw new Error('Ungültige Antwort beim Laden der Anime.');
    if (source === 'season') {
      if (typeof response.season?.label !== 'string') throw new Error('Die aktuelle Season konnte nicht geladen werden.');
      season = response.season;
    }
    items = response.items; loaded = true;
    // Eine Antwort darf ein inzwischen wieder bearbeitetes Feld nicht ersetzen.
    if (deferRender && (entrySaves > 0 || list.contains(document.activeElement))) pendingLibraryRender = true;
    else { updateFilters(); render(); }
    return true;
  } catch (error) {
    if (version !== libraryVersion || controller.signal.aborted) return false;
    if (!loaded) count.textContent = 'Nicht geladen';
    show(listStatus, error.message || 'Anime konnten nicht geladen werden.', true); listStatus.hidden = false; retry.hidden = false; return false;
  } finally {
    if (version === libraryVersion) { retry.disabled = false; list.setAttribute('aria-busy', 'false'); }
  }
}
async function refreshMember({ renderCards = true } = {}) {
  authRetry.hidden = true;
  try {
    const response = await api('/auth/me', { cache: 'no-store' }); member = response.member || null;
    show(session, member ? `Dein Eintrag wird als ${member.name || member.username} gespeichert.` : 'Melde dich mit Discord an, um Anime hinzuzufügen oder deinen Fortschritt zu speichern.');
    login.hidden = Boolean(member);
    if (dialog.open && member) void loadMembers();
    if (selected && !saving) inputs.fill(ownRating(selected, member) ?? {});
    if (renderCards) render(); return member ? 'authenticated' : 'guest';
  } catch { member = null; login.hidden = false; authRetry.hidden = false; show(session, 'Anmeldestatus konnte nicht geladen werden.', true); if (renderCards) render(); return 'unavailable'; }
  finally { updateState(); }
}
async function loadMembers() {
  if (!member || membersLoading) return;
  membersLoading = true; membersRetry.hidden = true; show(membersMessage, 'Mitglieder werden geladen …');
  try {
    const response = await api('/anime/members', { cache: 'no-store' });
    if (!Array.isArray(response.members)) throw new Error('Mitglieder konnten nicht geladen werden.');
    const checked = new Set([...addMembers.querySelectorAll('input:checked')].map(input => input.value)); addMembers.replaceChildren();
    for (const entry of response.members.filter(entry => String(entry.id) !== String(member?.id))) {
      const label = element('label', 'games-member-option'), input = element('input');
      input.type = 'checkbox'; input.name = 'addMemberId'; input.value = String(entry.id); input.checked = checked.has(input.value);
      label.append(input, element('span', '', entry.name)); addMembers.append(label);
    }
    show(membersMessage, addMembers.children.length ? '' : 'Noch keine weiteren Mitglieder angemeldet.');
  } catch (error) { show(membersMessage, error.message, true); membersRetry.hidden = false; }
  finally { membersLoading = false; }
}
function updateLoginLink() { login.href = `/api/auth/discord?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`; }
updateLoginLink(); login.addEventListener('click', updateLoginLink);
retry.addEventListener('click', refresh); authRetry.addEventListener('click', () => refreshMember()); membersRetry.addEventListener('click', loadMembers);
memberOptions.addEventListener('change', () => { memberIds = new Set([...memberOptions.querySelectorAll('input:checked')].map(input => input.value)); updateMemberCount(); render(); });
clear.addEventListener('click', () => { memberIds.clear(); memberOptions.querySelectorAll('input').forEach(input => { input.checked = false; }); updateMemberCount(); render(); });
[statusFilter, genreFilter, typeFilter, sortFilter].forEach(control => control.addEventListener('change', render));
document.addEventListener('click', event => { if (!memberFilter.contains(event.target)) memberFilter.open = false; });
memberFilter.addEventListener('keydown', event => { if (event.key === 'Escape') { memberFilter.open = false; memberFilter.querySelector('summary').focus(); } });
node('add-button').addEventListener('click', () => { if (!dialog.open) { dialog.showModal(); search.focus(); void loadMembers(); } });
[close, cancel].forEach(button => button.addEventListener('click', () => { if (!saving) dialog.close(); }));
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });

function clearResults() { results.replaceChildren(); results.hidden = true; more.hidden = true; searchItems = []; currentPage = 0; }
function resetSelection() {
  detailsController?.abort(); detailsVersion += 1; selected = null; selection.replaceChildren(); selection.hidden = true;
  selection.setAttribute('aria-busy', 'false'); updateState();
}
dialog.addEventListener('close', () => {
  clearTimeout(searchTimer); searchController?.abort(); searchVersion += 1; resetSelection(); clearResults(); search.value = '';
  results.setAttribute('aria-busy', 'false'); show(searchStatus, 'Mindestens 2 Zeichen eingeben.'); show(message, '');
  addMembers.querySelectorAll('input').forEach(input => { input.checked = false; });
});
async function searchAnime(query, version, page = 1) {
  const controller = new AbortController(); searchController = controller;
  results.setAttribute('aria-busy', 'true'); more.disabled = true; show(searchStatus, 'MyAnimeList wird durchsucht …');
  try {
    const response = await api(`/anime/search?q=${encodeURIComponent(query)}&page=${page}`, { signal: controller.signal });
    if (version !== searchVersion || controller.signal.aborted) return;
    if (!Array.isArray(response.items)) throw new Error('Ungültige Anime-Suchergebnisse.');
    const known = new Set(searchItems.map(item => animeId(item.malId)));
    const added = response.items.filter(item => { const id = animeId(item.malId); if (!id || known.has(id)) return false; known.add(id); return true; });
    searchItems.push(...added); currentPage = page; currentQuery = query;
    results.append(...added.map(item => createAnimeSearchResult(item, selectAnime))); results.hidden = searchItems.length === 0; more.hidden = !response.hasMore;
    show(searchStatus, searchItems.length ? `${searchItems.length}${Number.isInteger(response.total) ? ` von ${response.total}` : ''} Treffer. Wähle einen Anime aus.` : 'Keine Anime gefunden. Versuche einen anderen Suchbegriff.');
  } catch (error) { if (version !== searchVersion || controller.signal.aborted) return; if (page === 1) clearResults(); show(searchStatus, `${error.message} Bitte versuche die Suche erneut.`, true); }
  finally { if (version === searchVersion) { results.setAttribute('aria-busy', 'false'); more.disabled = saving; } }
}
search.addEventListener('input', () => {
  clearTimeout(searchTimer); searchController?.abort(); searchVersion += 1; const version = searchVersion;
  resetSelection(); clearResults(); results.setAttribute('aria-busy', 'false'); show(message, '');
  const query = search.value.trim();
  if (query.length < 2) { show(searchStatus, 'Mindestens 2 Zeichen eingeben.'); return; }
  show(searchStatus, 'Suche wird vorbereitet …'); searchTimer = setTimeout(() => searchAnime(query, version), 400);
});
more.addEventListener('click', () => { if (!more.disabled && currentQuery && currentPage) void searchAnime(currentQuery, searchVersion, currentPage + 1); });
async function selectAnime(anime) {
  const id = animeId(anime.malId); if (!id || saving) return;
  clearTimeout(searchTimer); searchController?.abort(); searchVersion += 1; resetSelection(); clearResults();
  const version = detailsVersion, controller = new AbortController(); detailsController = controller;
  search.value = anime.title; selection.hidden = false; selection.setAttribute('aria-busy', 'true'); results.setAttribute('aria-busy', 'false');
  show(searchStatus, 'Anime-Details werden geladen …'); show(message, '');
  try {
    const response = await api(`/anime/mal/${id}`, { signal: controller.signal });
    if (version !== detailsVersion || controller.signal.aborted) return;
    if (animeId(response.anime?.malId) !== id) throw new Error('Die Anime-Details konnten nicht zugeordnet werden.');
    selected = { ...response.anime, ratings: items.find(item => animeId(item.malId) === id)?.ratings ?? [] };
    selection.replaceChildren(createAnimeCard(selected, { preview: true }));
    inputs = createAnimeEntryFields(selected, ownRating(selected, member) ?? {}); options.replaceChildren(inputs.root);
    show(searchStatus, `${selected.title} ausgewählt.`); updateState();
  } catch (error) { if (version === detailsVersion && !controller.signal.aborted) { selection.hidden = true; show(searchStatus, `${error.message} Wähle den Anime erneut aus.`, true); } }
  finally { if (version === detailsVersion) selection.setAttribute('aria-busy', 'false'); }
}
async function mutationError(error) {
  let text = error.message || 'Die Änderung konnte nicht gespeichert werden.';
  if (error.status === 401 && await refreshMember({ renderCards: false }) === 'guest') text = 'Deine Sitzung ist abgelaufen. Melde dich über „Anime hinzufügen“ erneut an.';
  show(feedback, text, true); throw new Error(text);
}
async function saveEntry(anime, input, { deferRender = false } = {}) {
  const id = animeId(anime.malId); if (!member || !id) throw new Error('Bitte melde dich mit Discord an.');
  entrySaves += 1;
  try {
    try { await api(`/anime/${id}/entries`, { method: 'POST', body: JSON.stringify({ status: input.status, watchedEpisodes: input.watchedEpisodes,
      score: input.score, memberIds: input.memberIds ?? [], autoComplete: input.autoComplete ?? true }) }); } catch (error) { return await mutationError(error); }
    show(feedback, 'Dein Anime-Eintrag wurde gespeichert.');
    const refreshed = await refresh({ deferRender });
    return refreshed ? items.find(item => animeId(item.malId) === id) : null;
  } finally { entrySaves -= 1; setTimeout(flushPendingRender, 0); }
}
async function deleteAnime(anime) {
  const id = animeId(anime.malId); if (!member || !id) throw new Error('Bitte melde dich mit Discord an.');
  try { await api(`/anime/${id}`, { method: 'DELETE' }); } catch (error) { return mutationError(error); }
  show(feedback, 'Der Anime wurde gelöscht.'); await refresh();
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (!member || !selected || saving) return;
  const input = { ...inputs.read(), memberIds: [...addMembers.querySelectorAll('input:checked')].map(input => Number(input.value)) };
  if (!validAnimeInput(input, selected)) { show(message, 'Bitte prüfe Status, Episodenzahl und Bewertung.', true); return; }
  saving = true; updateState(); show(message, 'Eintrag wird gespeichert …');
  try { await saveEntry(selected, input); dialog.close(); }
  catch (error) { show(message, error.message, true); }
  finally { saving = false; updateState(); }
});
render();
await Promise.all([refresh(), refreshMember()]);
