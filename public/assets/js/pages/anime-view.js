const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const ratings = anime => Array.isArray(anime.ratings) ? anime.ratings : [];

export function animeMemberOptions(items) {
  const members = new Map();
  for (const anime of items) for (const entry of ratings(anime)) {
    if (entry.memberId != null) members.set(String(entry.memberId), { id: String(entry.memberId), name: entry.memberName || 'Unbekanntes Mitglied' });
  }
  return [...members.values()].sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
}

function date(value) {
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const timestamp = normalized == null ? NaN : new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function filterAnime(items, { memberIds = [], status = 'all', genre = 'all', type = 'all', sort = 'newest' } = {}) {
  const selected = [...new Set(memberIds.map(String))];
  return items.filter(anime => {
    const entries = ratings(anime);
    return selected.every(id => entries.some(entry => entry.memberId != null && String(entry.memberId) === id))
      && (status === 'all' || entries.some(entry => entry.status === status))
      && (genre === 'all' || (Array.isArray(anime.genres) && anime.genres.includes(genre)))
      && (type === 'all' || anime.type === type);
  }).sort((a, b) => {
    let order = 0;
    if (sort === 'newest' || sort === 'oldest') {
      const first = date(a.airedFrom), second = date(b.airedFrom);
      if (first === null && second !== null) return 1;
      if (second === null && first !== null) return -1;
      order = first === null ? 0 : sort === 'oldest' ? first - second : second - first;
    }
    else if (sort === 'added') order = (date(b.createdAt) ?? 0) - (date(a.createdAt) ?? 0);
    else if (sort === 'popular') order = ratings(b).length - ratings(a).length;
    else if (sort === 'title') order = collator.compare(a.title, b.title);
    else if (sort === 'genre') order = collator.compare(a.genres?.[0] ?? '\uffff', b.genres?.[0] ?? '\uffff');
    else if (sort === 'score') order = (b.malScore ?? -1) - (a.malScore ?? -1);
    else if (sort === 'episodes-asc' || sort === 'episodes-desc') {
      if (a.episodes == null && b.episodes != null) return 1;
      if (b.episodes == null && a.episodes != null) return -1;
      order = a.episodes == null ? 0 : sort === 'episodes-asc' ? a.episodes - b.episodes : b.episodes - a.episodes;
    }
    return order || collator.compare(a.title || '', b.title || '') || collator.compare(String(a.id || ''), String(b.id || ''));
  });
}
