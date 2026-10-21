const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function identity(value) {
  return (typeof value === 'string' || typeof value === 'number') && String(value).trim() ? String(value) : null;
}

function ratings(game) { return Array.isArray(game.ratings) ? game.ratings : []; }

export function memberOptions(games) {
  const members = new Map();
  for (const game of games) {
    for (const rating of ratings(game)) {
      const id = identity(rating.memberId);
      if (id === null || members.has(id)) continue;
      members.set(id, { id, name: typeof rating.memberName === 'string' && rating.memberName ? rating.memberName : 'Unbekanntes Mitglied' });
    }
  }
  return [...members.values()].sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
}

function timestamp(value) {
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const number = normalized === null || normalized === undefined ? NaN : new Date(normalized).getTime();
  return Number.isFinite(number) ? number : null;
}

function createdAt(game) { return timestamp(game.createdAt) ?? timestamp(game.metadataUpdatedAt) ?? 0; }
function popularity(game) { return ratings(game).filter(rating => rating.status === 'planned').length; }

function price(game) {
  if (game.price?.isFree === true) return 0;
  const value = game.price?.final;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function genre(game) {
  return (Array.isArray(game.genres) ? game.genres : []).filter(value => typeof value === 'string' && value.trim()).sort(collator.compare)[0] || null;
}

function titleOrder(a, b) {
  return collator.compare(String(a.title || ''), String(b.title || ''))
    || collator.compare(String(a.steamAppId ?? a.id ?? ''), String(b.steamAppId ?? b.id ?? ''));
}

export function filterAndSortGames(games, { memberIds = [], status = 'all', sort = 'newest' } = {}) {
  const selected = [...new Set(memberIds.map(identity).filter(value => value !== null))];
  const filtered = games.filter(game => {
    const reviews = ratings(game);
    return selected.every(id => reviews.some(rating => identity(rating.memberId) === id && rating.status === 'planned'))
      && (status === 'all' || reviews.some(rating => rating.status === status));
  });
  return filtered.sort((a, b) => {
    let order = 0;
    if (sort === 'oldest') order = createdAt(a) - createdAt(b);
    else if (sort === 'popular') order = popularity(b) - popularity(a);
    else if (sort === 'price-desc' || sort === 'price-asc') {
      const left = price(a), right = price(b);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      order = left === null ? 0 : sort === 'price-desc' ? right - left : left - right;
    } else if (sort === 'genre') {
      const left = genre(a), right = genre(b);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      order = left === null ? 0 : collator.compare(left, right);
    } else order = createdAt(b) - createdAt(a);
    return order || titleOrder(a, b);
  });
}
