export const GAME_STATUSES = { planned: 'Merkliste', ongoing: 'Wird gespielt', paused: 'Pausiert', completed: 'Abgeschlossen' };
export const GAME_PRIORITIES = { high: 'High', medium: 'Medium', low: 'Low' };

export function gameReviewInput(status, score, priority) {
  return { status, score: ['paused', 'completed'].includes(status) ? Number(score) : null,
    priority: status === 'planned' ? priority : null };
}

export function validGameReview(input) {
  return Object.hasOwn(GAME_STATUSES, input.status)
    && (input.status !== 'planned' || Object.hasOwn(GAME_PRIORITIES, input.priority))
    && (!['paused', 'completed'].includes(input.status) || (Number.isInteger(input.score) && input.score >= 1 && input.score <= 10));
}

export function updateGameReviewFields(status, score, priority) {
  const scored = ['paused', 'completed'].includes(status);
  score.closest('[data-game-score-field]').hidden = !scored;
  priority.closest('[data-game-priority-field]').hidden = status !== 'planned';
  score.disabled = !scored;
  priority.disabled = status !== 'planned';
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function steamAppId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function steamImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const hosts = ['steamstatic.com', 'steamcdn-a.akamaihd.net', 'steamusercontent.com'];
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url.href;
  } catch { return null; }
}

function discordImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.discordapp.com'
      && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

function gameImage(game, className = 'game-cover') {
  const cover = element('div', className);
  const placeholder = element('span', 'game-cover-placeholder', 'Kein Spielbild verfügbar');
  cover.append(placeholder);
  const url = steamImageUrl(game.headerImage);
  if (url) {
    const image = element('img');
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.remove(); placeholder.hidden = false; }, { once: true });
    image.src = url;
    placeholder.hidden = true;
    cover.append(image);
  }
  return cover;
}

function gameFacts(game) {
  const facts = element('dl', 'game-facts');
  const values = [
    ['Spieler', game.players?.label || 'Spielerzahl nicht angegeben'],
    ['Genre', Array.isArray(game.genres) && game.genres.length ? game.genres.join(' · ') : 'Nicht angegeben'],
    ['Preis', game.price?.formatted || 'Preis nicht verfügbar'],
  ];
  for (const [label, value] of values) {
    const group = element('div');
    group.append(element('dt', '', label), element('dd', '', value));
    facts.append(group);
  }
  return facts;
}

export function reviewAvatar(rating) {
  const name = typeof rating.memberName === 'string' && rating.memberName ? rating.memberName : 'Unbekanntes Mitglied';
  const avatar = element('span', 'game-review-avatar');
  avatar.title = name;
  avatar.setAttribute('aria-label', name);
  avatar.setAttribute('role', 'img');
  avatar.tabIndex = 0;
  const fallback = element('span', 'game-avatar-fallback', Array.from(name)[0].toLocaleUpperCase('de'));
  fallback.setAttribute('aria-hidden', 'true');
  avatar.append(fallback);
  const url = discordImageUrl(rating.avatarUrl);
  if (url) {
    const image = element('img');
    image.alt = '';
    image.width = 34;
    image.height = 34;
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.remove(); fallback.hidden = false; }, { once: true });
    image.src = url;
    fallback.hidden = true;
    avatar.append(image);
  }
  const tooltip = element('span', 'game-avatar-tooltip', name);
  tooltip.setAttribute('aria-hidden', 'true');
  avatar.append(tooltip);
  return avatar;
}

export function ownRating(game, member) {
  if (!member || member.id === undefined || member.id === null) return null;
  return (Array.isArray(game.ratings) ? game.ratings : []).find(rating => rating.memberId !== null && rating.memberId !== undefined
    && String(rating.memberId) === String(member.id)) || null;
}

function addCardActions(content, card, game, member, onSaveReview, onDelete) {
  const canReview = typeof onSaveReview === 'function';
  const canDelete = typeof onDelete === 'function' && !game.legacy
    && game.creatorMemberId !== null && game.creatorMemberId !== undefined
    && String(game.creatorMemberId) === String(member.id);
  if (!canReview && !canDelete) return;

  let busy = false;
  let currentRating = ownRating(game, member);
  const actions = element('div', 'game-actions');
  const editor = element('form', 'game-review-editor');
  editor.hidden = true;
  editor.setAttribute('aria-label', `Dein Eintrag für ${game.title || 'dieses Spiel'}`);
  const fields = element('fieldset', 'game-inline-fields');
  fields.append(element('legend', 'games-visually-hidden', 'Dein Eintrag'));
  const options = element('div', 'game-inline-options');
  const statusLabel = element('label', 'game-inline-label', 'Status');
  const status = element('select', 'form-control game-inline-status');
  status.name = 'status';
  for (const [value, label] of Object.entries(GAME_STATUSES)) {
    const option = element('option', '', label);
    option.value = value;
    status.append(option);
  }
  statusLabel.append(status);
  const scoreLabel = element('label', 'game-inline-label', 'Bewertung');
  scoreLabel.dataset.gameScoreField = '';
  const score = element('select', 'form-control game-inline-score');
  score.name = 'score';
  for (let value = 1; value <= 10; value++) {
    const option = element('option', '', `${value} / 10`);
    option.value = String(value);
    score.append(option);
  }
  scoreLabel.append(score);
  const priorityLabel = element('label', 'game-inline-label', 'Priorität');
  priorityLabel.dataset.gamePriorityField = '';
  const priority = element('select', 'form-control game-inline-priority');
  priority.name = 'priority';
  for (const [value, label] of Object.entries(GAME_PRIORITIES)) {
    const option = element('option', '', label);
    option.value = value;
    priority.append(option);
  }
  priorityLabel.append(priority);
  options.append(statusLabel, scoreLabel, priorityLabel);
  status.addEventListener('change', () => updateGameReviewFields(status.value, score, priority));
  const inlineActions = element('div', 'game-inline-actions');
  const save = element('button', 'button button-primary game-inline-save', 'Speichern');
  save.type = 'submit';
  const cancel = element('button', 'button games-secondary game-inline-cancel', 'Abbrechen');
  cancel.type = 'button';
  inlineActions.append(save, cancel);
  fields.append(options, inlineActions);
  const reviewMessage = element('p', 'games-message game-inline-message');
  reviewMessage.setAttribute('role', 'status');
  reviewMessage.setAttribute('aria-live', 'polite');
  editor.append(fields, reviewMessage);

  const edit = element('button', 'button games-secondary game-edit-review');
  edit.type = 'button';
  const updateEditLabel = () => {
    edit.textContent = currentRating ? 'Deinen Eintrag bearbeiten' : 'Auf die Merkliste / bewerten';
    edit.classList.toggle('game-add-review', !currentRating);
  };
  updateEditLabel();
  const deleteButton = element('button', 'button games-secondary game-delete', 'Spiel löschen');
  deleteButton.type = 'button';
  const confirmation = element('div', 'game-delete-confirmation');
  confirmation.hidden = true;
  confirmation.setAttribute('role', 'group');
  confirmation.setAttribute('aria-label', 'Spiel löschen bestätigen');
  confirmation.append(element('p', '', `„${game.title || 'Dieses Spiel'}“ wirklich löschen? Der Spieleintrag und alle Bewertungen werden entfernt.`));
  const deleteActions = element('div', 'game-inline-actions');
  const confirmDelete = element('button', 'button game-confirm-delete', 'Endgültig löschen');
  confirmDelete.type = 'button';
  const cancelDelete = element('button', 'button games-secondary game-cancel-delete', 'Abbrechen');
  cancelDelete.type = 'button';
  deleteActions.append(confirmDelete, cancelDelete);
  const deleteMessage = element('p', 'games-message game-delete-message');
  deleteMessage.setAttribute('role', 'status');
  deleteMessage.setAttribute('aria-live', 'polite');
  confirmation.append(deleteActions, deleteMessage);

  function setBusy(value) {
    busy = value;
    fields.disabled = value;
    for (const control of [edit, deleteButton, confirmDelete, cancelDelete]) control.disabled = value;
    editor.setAttribute('aria-busy', String(value));
    confirmation.setAttribute('aria-busy', String(value));
  }
  function closeEditor() {
    if (busy) return;
    editor.hidden = true;
    edit.hidden = false;
    edit.focus();
  }
  edit.addEventListener('click', () => {
    if (busy) return;
    confirmation.hidden = true;
    deleteButton.hidden = false;
    status.value = currentRating && Object.hasOwn(GAME_STATUSES, currentRating.status) ? currentRating.status : 'planned';
    score.value = currentRating && Number.isInteger(Number(currentRating.score)) && Number(currentRating.score) >= 1 && Number(currentRating.score) <= 10 ? String(currentRating.score) : '8';
    priority.value = currentRating && Object.hasOwn(GAME_PRIORITIES, currentRating.priority) ? currentRating.priority : 'medium';
    updateGameReviewFields(status.value, score, priority);
    reviewMessage.textContent = '';
    reviewMessage.classList.remove('error-message');
    editor.hidden = false;
    edit.hidden = true;
    status.focus();
  });
  cancel.addEventListener('click', closeEditor);
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
  });
  editor.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !canReview) return;
    const input = gameReviewInput(status.value, score.value, priority.value);
    if (!validGameReview(input)) {
      reviewMessage.textContent = 'Bitte wähle einen gültigen Status sowie eine Priorität oder Bewertung.';
      reviewMessage.classList.add('error-message');
      return;
    }
    setBusy(true);
    save.textContent = 'Wird gespeichert …';
    reviewMessage.textContent = '';
    reviewMessage.classList.remove('error-message');
    try {
      await onSaveReview(game, input);
      currentRating = { ...currentRating, ...input };
      updateEditLabel();
      editor.hidden = true;
      edit.hidden = false;
      if (edit.isConnected) edit.focus();
    } catch (error) {
      reviewMessage.textContent = error?.message || 'Die Bewertung konnte nicht gespeichert werden. Bitte versuche es erneut.';
      reviewMessage.classList.add('error-message');
    } finally {
      setBusy(false);
      save.textContent = 'Speichern';
    }
  });
  deleteButton.addEventListener('click', () => {
    if (busy) return;
    editor.hidden = true;
    edit.hidden = false;
    deleteMessage.textContent = '';
    deleteMessage.classList.remove('error-message');
    confirmation.hidden = false;
    deleteButton.hidden = true;
    cancelDelete.focus();
  });
  function closeConfirmation() {
    if (busy) return;
    confirmation.hidden = true;
    deleteButton.hidden = false;
    deleteButton.focus();
  }
  cancelDelete.addEventListener('click', closeConfirmation);
  confirmation.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeConfirmation(); }
  });
  confirmDelete.addEventListener('click', async () => {
    if (busy || !canDelete) return;
    setBusy(true);
    confirmDelete.textContent = 'Wird gelöscht …';
    deleteMessage.textContent = '';
    deleteMessage.classList.remove('error-message');
    try {
      await onDelete(game);
      card.remove();
    } catch (error) {
      deleteMessage.textContent = error?.message || 'Das Spiel konnte nicht gelöscht werden. Bitte versuche es erneut.';
      deleteMessage.classList.add('error-message');
    } finally {
      setBusy(false);
      confirmDelete.textContent = 'Endgültig löschen';
    }
  });
  if (canReview) actions.append(edit);
  if (canDelete) actions.append(deleteButton);
  content.append(actions);
  if (canReview) content.append(editor);
  if (canDelete) content.append(confirmation);
}

export function createGameCard(game, { member = null, onSaveReview = null, onDelete = null, preview = false } = {}) {
  const card = element('article', preview ? 'game-card game-card-preview' : 'game-card');
  const appId = steamAppId(game.steamAppId);
  if (appId) card.dataset.steamAppId = String(appId);
  card.append(gameImage(game));
  const content = element('div', 'game-content');
  const heading = element('div', 'game-heading');
  heading.append(element('h3', 'game-title', game.title || 'Unbekanntes Spiel'));
  const average = game.averageScore === null || game.averageScore === undefined ? NaN : Number(game.averageScore);
  if (!preview && Number.isFinite(average)) heading.append(element('span', 'game-average', `Ø ${average.toLocaleString('de-DE', { maximumFractionDigits: 1 })} / 10`));
  content.append(heading);
  if (game.shortDescription) content.append(element('p', 'game-description', game.shortDescription));
  if (game.legacy) content.append(element('p', 'game-legacy-note', 'Bestehender Eintrag ohne Steam-Verknüpfung.'));
  else content.append(gameFacts(game));
  const id = steamAppId(game.steamAppId);
  if (id) {
    const link = element('a', 'game-store-link', 'Auf Steam ansehen ↗');
    link.href = `https://store.steampowered.com/app/${id}/`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    content.append(link);
  }
  const updatedAt = game.metadataUpdatedAt ? new Date(game.metadataUpdatedAt) : null;
  if (updatedAt && Number.isFinite(updatedAt.getTime())) {
    const note = element('p', 'game-data-date');
    note.append(document.createTextNode('Steam-Daten vom '));
    const time = element('time', '', updatedAt.toLocaleDateString('de-DE'));
    time.dateTime = updatedAt.toISOString();
    note.append(time);
    content.append(note);
  }
  const ratings = Array.isArray(game.ratings) ? game.ratings : [];
  if (!preview && ratings.length) {
    const reviews = element('div', 'game-reviews');
    reviews.append(element('p', 'game-reviews-heading', `${ratings.length} ${ratings.length === 1 ? 'Mitglied' : 'Mitglieder'}`));
    const list = element('ul', 'game-review-list');
    for (const rating of ratings) {
      const row = element('li', 'game-review');
      row.append(reviewAvatar(rating));
      row.append(element('span', 'game-review-status', Object.hasOwn(GAME_STATUSES, rating.status) ? GAME_STATUSES[rating.status] : 'Unbekannter Status'));
      if (rating.status === 'planned') {
        row.append(element('span', 'game-review-priority', `Priorität: ${GAME_PRIORITIES[rating.priority] || 'Medium'}`));
      } else if (['paused', 'completed'].includes(rating.status)) {
        const score = rating.score == null ? NaN : Number(rating.score);
        row.append(element('span', 'game-review-score', Number.isFinite(score) ? `${score} / 10` : '—'));
      }
      list.append(row);
    }
    reviews.append(list);
    content.append(reviews);
  }
  if (!preview && id && member) addCardActions(content, card, game, member, onSaveReview, onDelete);
  card.append(content);
  return card;
}

export function createSearchResult(game, onSelect) {
  const item = element('li');
  const button = element('button', 'game-search-result');
  button.type = 'button';
  button.append(gameImage(game, 'game-search-cover'));
  const text = element('span', 'game-search-result-text');
  text.append(element('strong', '', game.title || 'Unbekanntes Spiel'));
  text.append(element('span', 'muted', game.price?.formatted || 'Preis nicht verfügbar'));
  button.append(text);
  button.addEventListener('click', () => onSelect(game));
  item.append(button);
  return item;
}
