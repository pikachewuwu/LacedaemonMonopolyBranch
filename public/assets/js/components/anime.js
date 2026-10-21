import { ownRating, reviewAvatar } from './steam-games.js';

export const ANIME_STATUSES = {
  plan_to_watch: 'Plan to watch',
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On hold',
  dropped: 'Dropped',
};

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function animeId(value) {
  const id = typeof value === 'number' || (typeof value === 'string' && /^\d{1,9}$/.test(value)) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 && id <= 999999999 ? id : null;
}

export function animeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.myanimelist.net' && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

export function validAnimeInput(input, anime) {
  if (!Object.hasOwn(ANIME_STATUSES, input.status)) return false;
  if (input.status === 'plan_to_watch') return input.watchedEpisodes === null && input.score === null;
  if (!Number.isInteger(input.watchedEpisodes) || input.watchedEpisodes < (input.status === 'completed' ? 1 : 0) || input.watchedEpisodes > 100000) return false;
  if (Number.isInteger(anime.episodes) && anime.episodes > 0 && (input.watchedEpisodes > anime.episodes || (input.status === 'completed' && input.watchedEpisodes !== anime.episodes))) return false;
  return input.status !== 'completed' || input.score === null || (Number.isInteger(input.score) && input.score >= 1 && input.score <= 10);
}

export function createAnimeEntryFields(anime, entry = {}, prefix = 'anime', { hideStatus = false } = {}) {
  const root = element('div', 'games-review-options anime-entry-options');
  const status = element('select', 'form-control anime-inline-status');
  status.id = `${prefix}-status`;
  status.name = 'status';
  for (const [value, text] of Object.entries(ANIME_STATUSES)) {
    const option = element('option', '', text); option.value = value; status.append(option);
  }
  const episodes = element('input', 'form-control anime-inline-episodes');
  episodes.id = `${prefix}-episodes`;
  episodes.type = 'number'; episodes.name = 'watchedEpisodes'; episodes.min = '0'; episodes.step = '1';
  episodes.max = String(anime.episodes ?? 100000);
  const score = element('select', 'form-control anime-inline-score');
  score.id = `${prefix}-score`; score.name = 'score';
  const none = element('option', '', 'Keine Bewertung'); none.value = ''; score.append(none);
  for (let value = 1; value <= 10; value++) {
    const option = element('option', '', `${value} / 10`); option.value = String(value); score.append(option);
  }
  function field(control, title) {
    const group = element('div');
    const label = element('label', 'label', title); label.htmlFor = control.id;
    group.append(label, control); root.append(group); return group;
  }
  const statusGroup = field(status, 'Status');
  statusGroup.hidden = hideStatus;
  const episodeGroup = field(episodes, anime.episodes ? `Gesehene Episoden (von ${anime.episodes})` : 'Gesehene Episoden');
  episodeGroup.className = 'anime-episode-field';
  const scoreGroup = field(score, 'Bewertung (optional)');
  scoreGroup.className = 'anime-score-field';
  function update() {
    const planned = status.value === 'plan_to_watch', completed = status.value === 'completed';
    episodeGroup.hidden = planned; episodes.disabled = planned; episodes.required = !planned;
    episodes.min = completed && !(Number.isInteger(anime.episodes) && anime.episodes > 0) ? '1' : '0';
    scoreGroup.hidden = !completed; score.disabled = !completed;
  }
  function fill(value = {}) {
    status.value = Object.hasOwn(ANIME_STATUSES, value.status) ? value.status : 'plan_to_watch';
    episodes.value = String(Number.isInteger(value.watchedEpisodes) ? value.watchedEpisodes : 0);
    score.value = Number.isInteger(value.score) && value.score >= 1 && value.score <= 10 ? String(value.score) : '';
    update();
  }
  status.addEventListener('change', () => {
    if (status.value === 'completed' && Number.isInteger(anime.episodes) && anime.episodes > 0) episodes.value = String(anime.episodes);
    update();
  });
  fill(entry);
  function read() {
    let selectedStatus = status.value;
    const watchedEpisodes = selectedStatus === 'plan_to_watch' ? null : episodes.value === '' ? null : Number(episodes.value);
    if (selectedStatus !== 'plan_to_watch' && Number.isInteger(anime.episodes) && anime.episodes > 0 && Number.isInteger(watchedEpisodes)) {
      if (watchedEpisodes === anime.episodes) selectedStatus = 'completed';
      else if (selectedStatus === 'completed' && watchedEpisodes >= 0 && watchedEpisodes < anime.episodes) selectedStatus = 'watching';
    }
    return { status: selectedStatus, watchedEpisodes,
      score: selectedStatus === 'completed' && score.value !== '' ? Number(score.value) : null };
  }
  return { root, fill, status, episodes, score,
    read };
}

function cover(anime, className = 'game-cover anime-cover') {
  const root = element('div', className);
  const fallback = element('span', 'game-cover-placeholder', 'Kein Anime-Bild verfügbar');
  root.append(fallback);
  const url = animeImageUrl(anime.imageUrl);
  if (url) {
    const image = element('img'); image.alt = ''; image.loading = 'lazy';
    image.addEventListener('error', () => { image.remove(); fallback.hidden = false; }, { once: true });
    image.src = url; fallback.hidden = true; root.append(image);
  }
  return root;
}

function addActions(content, card, anime, member, onSave, onDelete) {
  let current = ownRating(anime, member);
  let busy = false, queuedProgress = false;

  const selection = element('div', 'anime-season-selection');
  selection.setAttribute('role', 'group');
  selection.setAttribute('aria-label', `Deine Auswahl für ${anime.title}`);
  const statusSelect = element('select', 'form-control anime-quick-status');
  statusSelect.setAttribute('aria-label', `Status für ${anime.title}`);
  const placeholder = element('option', '', 'Status auswählen');
  placeholder.value = '';
  placeholder.disabled = true;
  statusSelect.append(placeholder);
  for (const [value, title] of Object.entries(ANIME_STATUSES)) {
    const option = element('option', '', title);
    option.value = value;
    statusSelect.append(option);
  }
  selection.append(statusSelect);
  const selectionMessage = element('p', 'games-message anime-selection-message');
  selectionMessage.setAttribute('role', 'status');

  // Episoden und Bewertung sind direkt unter dem Dropdown bearbeitbar,
  // ohne einen separaten Edit-Button und ohne ein zweites Status-Dropdown.
  const editor = element('form', 'game-review-editor anime-entry-editor');
  editor.hidden = true;
  editor.setAttribute('aria-label', `Fortschritt und Bewertung für ${anime.title}`);
  const fields = element('fieldset', 'game-inline-fields');
  fields.append(element('legend', 'games-visually-hidden', 'Anime-Fortschritt und Bewertung'));
  const inputs = createAnimeEntryFields(anime, current ?? {}, `anime-inline-${anime.malId}`, { hideStatus: true });
  inputs.status.addEventListener('change', () => { statusSelect.value = inputs.status.value; });
  fields.append(inputs.root);
  const message = element('p', 'games-message anime-inline-message');
  message.setAttribute('role', 'status');
  editor.append(fields, message);

  const actions = element('div', 'game-actions');
  const canDelete = typeof onDelete === 'function'
    && anime.creatorMemberId != null && String(anime.creatorMemberId) === String(member.id);
  const remove = element('button', 'button games-secondary game-delete anime-delete', 'Remove');
  remove.type = 'button';
  const confirmation = element('div', 'game-delete-confirmation');
  confirmation.hidden = true;
  confirmation.append(element('p', '', `„${anime.title}“ und alle Einträge der Mitglieder wirklich löschen?`));
  const yes = element('button', 'button anime-confirm-delete', 'Endgültig löschen');
  yes.type = 'button';
  const no = element('button', 'button games-secondary anime-cancel-delete', 'Abbrechen');
  no.type = 'button';
  const deleteMessage = element('p', 'games-message');
  deleteMessage.setAttribute('role', 'status');
  confirmation.append(yes, no, deleteMessage);

  function updateSelection() {
    statusSelect.value = Object.hasOwn(ANIME_STATUSES, current?.status) ? current.status : '';
  }
  function updateEditor() {
    const hasProgress = Boolean(current?.status && current.status !== 'plan_to_watch');
    editor.hidden = !hasProgress;
    if (hasProgress) inputs.fill(current);
    message.textContent = '';
    message.classList.remove('error-message');
  }
  function setBusy(value, keepFields = false) {
    busy = value;
    fields.disabled = value && !keepFields;
    statusSelect.disabled = value;
    [remove, yes, no].forEach(button => { button.disabled = value; });
  }

  async function selectStatus(status) {
    if (busy) return;
    if (!Object.hasOwn(ANIME_STATUSES, status) || current?.status === status) {
      updateSelection();
      return;
    }
    selectionMessage.textContent = '';
    selectionMessage.classList.remove('error-message');

    const hasEpisodeCount = Number.isInteger(anime.episodes) && anime.episodes > 0;
    const watchedEpisodes = status === 'plan_to_watch' ? null
      : status === 'completed' ? (hasEpisodeCount ? anime.episodes : null)
        : Number.isInteger(current?.watchedEpisodes) ? current.watchedEpisodes : 0;
    const input = { status, watchedEpisodes, score: null, autoComplete: false };

    // Ohne bekannte Gesamtepisoden muss der Benutzer den Fortschritt bei
    // "Completed" selbst eintragen. Es wird kein Wert erfunden oder gespeichert.
    if (status === 'completed' && !hasEpisodeCount) {
      inputs.fill({
        status,
        watchedEpisodes: Number.isInteger(current?.watchedEpisodes) && current.watchedEpisodes > 0
          ? current.watchedEpisodes : 1,
        score: null,
      });
      editor.hidden = false;
      selectionMessage.textContent = 'Bitte Episodenzahl eintragen. Beim Verlassen des Feldes wird gespeichert.';
      inputs.episodes.focus();
      return;
    }

    if (!validAnimeInput(input, anime)) {
      updateSelection();
      selectionMessage.textContent = 'Dieser Status kann mit den aktuellen Episodendaten nicht gespeichert werden.';
      selectionMessage.classList.add('error-message');
      return;
    }
    setBusy(true);
    try {
      await onSave(anime, input);
      current = { ...current, ...input };
      updateSelection();
      updateEditor();
      confirmation.hidden = true;
      if (canDelete) remove.hidden = false;
      selectionMessage.textContent = ANIME_STATUSES[status];
    } catch (error) {
      updateSelection();
      selectionMessage.textContent = error.message || 'Deine Auswahl konnte nicht gespeichert werden.';
      selectionMessage.classList.add('error-message');
    } finally {
      setBusy(false);
    }
  }

  statusSelect.addEventListener('change', () => selectStatus(statusSelect.value));
  editor.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target === inputs.episodes) {
      event.preventDefault(); inputs.episodes.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) { updateSelection(); updateEditor(); statusSelect.focus(); }
    }
  });
  async function saveProgress() {
    if (document.activeElement === inputs.episodes) return;
    if (busy) { queuedProgress = true; return; }
    queuedProgress = false;
    const input = inputs.read();
    if (!validAnimeInput(input, anime)) {
      message.textContent = 'Bitte prüfe Status, Episodenzahl und Bewertung.';
      message.classList.add('error-message');
      return;
    }
    const unchanged = current && ['status', 'watchedEpisodes', 'score'].every(key => current[key] === input[key]);
    if (unchanged) {
      updateSelection();
      if (document.activeElement !== inputs.score) updateEditor();
      return;
    }
    message.textContent = '';
    message.classList.remove('error-message');
    setBusy(true, true);
    message.textContent = 'Wird gespeichert …';
    try {
      const saved = await onSave(anime, input, { deferRender: true });
      const entry = saved?.ratings?.find(entry => String(entry.memberId) === String(member.id));
      if (saved) Object.assign(anime, saved);
      current = { ...current, ...input, ...entry };
      if (document.activeElement !== inputs.episodes && !queuedProgress) {
        updateSelection();
        if (document.activeElement !== inputs.score) updateEditor();
        else inputs.status.value = current.status;
        selectionMessage.textContent = ANIME_STATUSES[current.status];
      }
      message.textContent = 'Gespeichert.';
    } catch (error) {
      message.textContent = error.message || 'Der Eintrag konnte nicht gespeichert werden.';
      message.classList.add('error-message');
    } finally {
      setBusy(false);
      if (queuedProgress && document.activeElement !== inputs.episodes) void saveProgress();
    }
  }
  const scheduleProgressSave = () => { setTimeout(() => { void saveProgress(); }, 0); };
  inputs.episodes.addEventListener('blur', scheduleProgressSave);
  inputs.score.addEventListener('change', scheduleProgressSave);
  inputs.score.addEventListener('blur', scheduleProgressSave);
  editor.addEventListener('submit', event => {
    event.preventDefault();
    if (document.activeElement === inputs.episodes) inputs.episodes.blur();
    else scheduleProgressSave();
  });

  remove.addEventListener('click', () => {
    if (busy) return;
    confirmation.hidden = false;
    remove.hidden = true;
    deleteMessage.textContent = '';
    no.focus();
  });
  const closeConfirmation = () => {
    if (!busy) { confirmation.hidden = true; remove.hidden = false; remove.focus(); }
  };
  no.addEventListener('click', closeConfirmation);
  confirmation.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeConfirmation(); }
  });
  yes.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    yes.textContent = 'Wird gelöscht …';
    try {
      await onDelete(anime);
      card.remove();
    } catch (error) {
      deleteMessage.textContent = error.message || 'Der Anime konnte nicht gelöscht werden.';
      deleteMessage.classList.add('error-message');
    } finally {
      setBusy(false);
      yes.textContent = 'Endgültig löschen';
    }
  });

  if (typeof onSave === 'function') {
    updateSelection();
    updateEditor();
    content.append(selection, selectionMessage, editor);
  }
  if (canDelete) {
    actions.append(remove);
    content.append(actions, confirmation);
  }
}
function seasonLogin(anime) {
  const login = element('a', 'button games-secondary anime-season-login', 'Anmelden und auswählen');
  login.href = `/api/auth/discord?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
  login.setAttribute('aria-label', `Anmelden, um ${anime.title} auszuwählen`);
  return login;
}

function englishTitle(anime) {
  const title = typeof anime.titleEnglish === 'string' ? anime.titleEnglish.trim() : '';
  if (!title || title.toLocaleLowerCase('en') === (anime.title || '').trim().toLocaleLowerCase('en')) return null;
  const alternative = element('span', 'anime-title-english', title);
  alternative.lang = 'en'; alternative.title = title;
  return alternative;
}

export function createAnimeMemberList(anime) {
  const list = element('ul', 'anime-member-detail-list');
  const ratings = Array.isArray(anime.ratings) ? anime.ratings : [];
  for (const entry of ratings) {
    const row = element('li', 'anime-member-detail');
    const avatar = reviewAvatar(entry); avatar.removeAttribute('tabindex');
    const details = element('div', 'anime-member-detail-info');
    const name = element('span', 'anime-member-detail-name', entry.memberName || 'Unbekanntes Mitglied');
    const summary = element('div', 'anime-member-detail-summary');
    summary.append(element('span', 'game-review-status', Object.hasOwn(ANIME_STATUSES, entry.status) ? ANIME_STATUSES[entry.status] : 'Unbekannt'));
    if (entry.status === 'completed') {
      const validScore = Number.isInteger(entry.score) && entry.score >= 1 && entry.score <= 10;
      const score = element('span', 'game-review-score', validScore ? `${entry.score} / 10` : '—');
      if (!validScore) score.title = 'Keine Bewertung';
      summary.append(score);
    }
    details.append(name, summary);
    if (entry.status !== 'plan_to_watch' && Number.isInteger(entry.watchedEpisodes)) {
      details.append(element('span', 'anime-review-progress', `${entry.watchedEpisodes}${anime.episodes ? ` / ${anime.episodes}` : ''} Episoden`));
    }
    row.append(avatar, details); list.append(row);
  }
  if (!ratings.length) list.append(element('li', 'anime-member-detail-empty muted', 'Noch kein Mitglied hat diesen Anime auf seiner Liste.'));
  return list;
}

export function createAnimeCard(anime, { member = null, onSave = null, onDelete = null, onMembers = null, preview = false, seasonal = false } = {}) {
  const card = element('article', `game-card anime-card${preview ? ' game-card-preview' : ''}`);
  const id = animeId(anime.malId);
  if (id) card.dataset.malId = String(id);
  const heading = element('header', 'anime-season-header');
  const title = element('h3', 'game-title');
  const name = element(id ? 'a' : 'span', 'anime-season-title', anime.title || 'Unbekannter Anime');
  if (id) { name.href = `https://myanimelist.net/anime/${id}`; name.target = '_blank'; name.rel = 'noopener noreferrer'; }
  title.append(name); heading.append(title);
  const alternativeTitle = englishTitle(anime);
  if (alternativeTitle) heading.append(alternativeTitle);
  const metadata = element('div', 'anime-season-meta');
  const premiere = new Date(anime.airedFrom);
  const details = [anime.type || 'Unbekannt', Number.isFinite(premiere.getTime()) && anime.airedFrom
    ? premiere.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
    `${anime.episodes ?? '?'} Episoden`, anime.duration];
  for (const detail of details.filter(Boolean)) metadata.append(element('span', '', detail));
  const genres = element('div', 'anime-season-genres');
  const tags = Array.isArray(anime.genres) ? anime.genres : [];
  for (const genre of tags) genres.append(element('span', 'anime-tag', genre));
  if (!tags.length) genres.append(element('span', 'muted', 'Genres noch unbekannt'));
  const body = element('div', 'anime-season-body');
  const content = element('div', 'game-content anime-season-info');
  content.tabIndex = 0; content.setAttribute('aria-label', `Beschreibung und Details zu ${anime.title}`);
  content.append(element('p', 'game-description', anime.synopsis || 'Noch keine Beschreibung verfügbar.'));
  const facts = element('dl', 'game-facts');
  for (const [key, value] of [['Studio', anime.studios?.length ? anime.studios.join(', ') : null], ['Vorlage', anime.adaptationSource]]) {
    if (!value) continue;
    const group = element('div'); group.append(element('dt', '', key), element('dd', '', String(value))); facts.append(group);
  }
  if (facts.children.length) content.append(facts);
  if (id) {
    const link = element('a', 'game-store-link', 'Auf MyAnimeList ansehen ↗'); link.href = `https://myanimelist.net/anime/${id}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; content.append(link);
  }
  const date = new Date(anime.metadataUpdatedAt);
  if (anime.metadataUpdatedAt && Number.isFinite(date.getTime())) content.append(element('p', 'game-data-date', `Daten abgerufen am ${date.toLocaleString('de-DE')}`));
  body.append(cover(anime), content);
  const stats = element('div', 'anime-season-stats');
  const malScore = element('div', 'anime-season-stat anime-season-score');
  malScore.append(element('strong', '', Number.isFinite(anime.malScore) ? `★ ${anime.malScore.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '★ —'), element('span', '', 'MAL-Score'));
  const malMembers = element('div', 'anime-season-stat anime-season-popularity');
  malMembers.append(element('strong', '', Number.isSafeInteger(anime.malMembers) ? anime.malMembers.toLocaleString('de-DE') : '—'), element('span', '', 'MAL-Mitglieder'));
  stats.append(malScore, malMembers);
  if (!preview && Number.isFinite(anime.averageScore)) {
    const average = element('div', 'anime-season-stat game-average');
    average.append(element('strong', '', anime.averageScore.toLocaleString('de-DE', { maximumFractionDigits: 2 })), element('span', '', 'Community Ø'));
    stats.append(average);
  }
  card.append(heading, metadata, genres, body, stats);
  const ratings = Array.isArray(anime.ratings) ? anime.ratings : [];
  if (!preview && ratings.length) {
    const reviews = element('div', 'game-reviews anime-season-members');
    const button = element('button', 'anime-members-button'); button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'anime-members-dialog');
    button.setAttribute('aria-label', `${ratings.length} ${ratings.length === 1 ? 'Mitglied' : 'Mitglieder'} mit ${anime.title || 'diesem Anime'} auf der Liste: Details anzeigen`);
    for (const entry of ratings) {
      const avatar = reviewAvatar(entry);
      avatar.removeAttribute('tabindex'); avatar.removeAttribute('aria-label'); avatar.removeAttribute('role');
      avatar.setAttribute('aria-hidden', 'true'); button.append(avatar);
    }
    button.addEventListener('click', () => { if (typeof onMembers === 'function') onMembers(anime); });
    reviews.append(button); card.append(reviews);
  }
  if (!preview && id && !anime.legacy) {
    const controls = element('div', 'anime-season-controls');
    if (member) addActions(controls, card, anime, member, onSave, onDelete);
    else if (seasonal) controls.append(seasonLogin(anime));
    if (controls.children.length) card.append(controls);
  }
  return card;
}

export function createAnimeTable(items, { member = null, onSave = null, onDelete = null, seasonal = false } = {}) {
  const table = element('table', 'anime-table');
  table.append(element('caption', 'games-visually-hidden', 'Anime-Liste mit Bewertungen, Tags und Mitgliedern'));
  const head = element('thead');
  const headings = element('tr');
  for (const [title, column] of [['#', 'index'], ['Bild', 'image'], ['Titel', 'title'], ['Avg. Score', 'score'], ['Tags', 'tags'], ['Mitglieder', 'members']]) {
    const heading = element('th', `anime-list-${column}`, title); heading.scope = 'col';
    if (column === 'score') heading.title = 'Durchschnitt der Community-Bewertungen';
    headings.append(heading);
  }
  head.append(headings);
  const body = element('tbody');
  items.forEach((anime, index) => {
    const row = element('tr', 'anime-list-row');
    const id = animeId(anime.malId);
    if (id) row.dataset.malId = String(id);
    const position = element('td', 'anime-list-index', String(index + 1));
    const image = element('td', 'anime-list-image');
    image.append(cover(anime, 'game-cover anime-list-cover'));
    const title = element('th', 'anime-list-title'); title.scope = 'row';
    const name = element(id ? 'a' : 'span', 'game-title anime-list-title-link', anime.title || 'Unbekannter Anime');
    if (id) {
      name.href = `https://myanimelist.net/anime/${id}`;
      name.target = '_blank'; name.rel = 'noopener noreferrer';
    }
    title.append(name);
    const alternativeTitle = englishTitle(anime);
    if (alternativeTitle) title.append(alternativeTitle);
    title.append(element('span', 'anime-list-meta', `${anime.type || 'Unbekannt'} · ${anime.episodes ?? '?'} Episoden`));
    if (id && !anime.legacy) {
      if (member) addActions(title, row, anime, member, onSave, onDelete);
      else if (seasonal) title.append(seasonLogin(anime));
    }
    const score = element('td', 'anime-list-score');
    const average = Number.isFinite(anime.averageScore)
      ? `${anime.averageScore.toLocaleString('de-DE', { maximumFractionDigits: 2 })} / 10` : '—';
    const value = element('span', 'anime-list-score-value', average);
    value.setAttribute('aria-label', average === '—' ? 'Noch keine Community-Bewertung' : `Community-Durchschnitt: ${average}`);
    score.append(value);
    const tags = element('td', 'anime-list-tags');
    const genres = Array.isArray(anime.genres) ? anime.genres : [];
    if (genres.length) {
      const list = element('div', 'anime-list-tag-list');
      for (const genre of genres) list.append(element('span', 'anime-tag', genre));
      tags.append(list);
    } else tags.append(element('span', 'muted', '—'));
    const members = element('td', 'anime-list-members');
    const ratings = Array.isArray(anime.ratings) ? anime.ratings : [];
    if (ratings.length) {
      const list = element('ul', 'anime-list-member-list');
      for (const entry of ratings) {
        const item = element('li', 'anime-list-member');
        const details = element('div', 'anime-list-member-details');
        details.append(element('span', 'anime-list-member-name', entry.memberName || 'Unbekanntes Mitglied'));
        details.append(element('span', 'anime-list-member-status', Object.hasOwn(ANIME_STATUSES, entry.status) ? ANIME_STATUSES[entry.status] : 'Unbekannt'));
        if (entry.status !== 'plan_to_watch' && Number.isInteger(entry.watchedEpisodes)) {
          details.append(element('span', 'anime-list-member-progress anime-review-progress', `${entry.watchedEpisodes}${anime.episodes ? ` / ${anime.episodes}` : ''} Episoden`));
        }
        if (entry.status === 'completed' && Number.isInteger(entry.score) && entry.score >= 1 && entry.score <= 10) {
          details.append(element('span', 'anime-list-member-score game-review-score', `${entry.score} / 10`));
        }
        item.append(reviewAvatar(entry), details); list.append(item);
      }
      members.append(list);
    } else members.append(element('span', 'muted', 'Noch keine Mitglieder'));
    row.append(position, image, title, score, tags, members); body.append(row);
  });
  table.append(head, body); return table;
}

export function createAnimeSearchResult(anime, select) {
  const item = element('li'); const button = element('button', 'game-search-result'); button.type = 'button';
  const text = element('span', 'game-search-result-text');
  text.append(element('strong', '', anime.title));
  const alternativeTitle = englishTitle(anime);
  if (alternativeTitle) text.append(alternativeTitle);
  text.append(element('span', 'muted', `${anime.type} · ${anime.episodes ?? '?'} Episoden`));
  button.append(cover(anime, 'game-search-cover anime-search-cover'), text);
  button.addEventListener('click', () => select(anime)); item.append(button); return item;
}
