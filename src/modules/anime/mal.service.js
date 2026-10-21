import sanitizeHtml from 'sanitize-html';

export class AnimeSourceError extends Error {
  constructor(message, status = 502, { cause, code = 'ANIME_SOURCE_ERROR', retryAfter } = {}) {
    super(message, { cause });
    this.status = status;
    this.code = code;
    this.expose = true;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

const API_BASE = 'https://api.tenrai.org/v1';
const MAX_SEASON_PAGES = 100;

function currentSeason(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', year: 'numeric', month: 'numeric' })
    .formatToParts(new Date(now()));
  const year = Number(parts.find(part => part.type === 'year').value);
  const quarter = Math.floor((Number(parts.find(part => part.type === 'month').value) - 1) / 3);
  const name = ['winter', 'spring', 'summer', 'fall'][quarter];
  return { year, name, label: `${['Winter', 'Frühling', 'Sommer', 'Herbst'][quarter]} ${year}` };
}

function retryAfterSeconds(response, now) {
  const value = response.headers?.get('retry-after');
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now()) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : undefined;
}

export function malId(value) {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id < 1 || id > 999999999) throw new AnimeSourceError('Ungültige MyAnimeList-ID.', 400);
  return id;
}

function text(value, limit = 4000) {
  return typeof value === 'string' ? sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim().slice(0, limit) : '';
}

function imageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.myanimelist.net' && !url.port && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function normalize(item, now, fetchedAt) {
  const id = malId(item?.mal_id);
  const title = text(item.title, 300);
  if (!title) throw new AnimeSourceError('MyAnimeList hat keinen gültigen Titel geliefert.');
  return { malId: id, title, titleEnglish: text(item.title_english, 300), titleJapanese: text(item.title_japanese, 300),
    synopsis: text(item.synopsis), imageUrl: imageUrl(item.images?.jpg?.large_image_url ?? item.images?.jpg?.image_url),
    url: `https://myanimelist.net/anime/${id}`, type: text(item.type, 40) || 'Unbekannt',
    episodes: Number.isSafeInteger(item.episodes) && item.episodes > 0 ? item.episodes : null,
    genres: [...new Set([...(Array.isArray(item.genres) ? item.genres : []), ...(Array.isArray(item.themes) ? item.themes : [])]
      .map(genre => text(genre?.name, 80)).filter(Boolean))].slice(0, 30),
    airingStatus: text(item.status, 80), year: Number.isInteger(item.year) && item.year > 1900 ? item.year : null,
    malScore: typeof item.score === 'number' && item.score > 0 && item.score <= 10 ? item.score : null,
    studios: [...new Set((Array.isArray(item.studios) ? item.studios : []).map(studio => text(studio?.name, 120)).filter(Boolean))].slice(0, 20),
    adaptationSource: text(item.source, 80), duration: text(item.duration, 80),
    airedFrom: typeof item.aired?.from === 'string' && Number.isFinite(Date.parse(item.aired.from)) ? item.aired.from.slice(0, 40) : null,
    malMembers: Number.isSafeInteger(item.members) && item.members >= 0 ? item.members : null,
    metadataUpdatedAt: new Date(now()).toISOString(), sourceUpdatedAt: fetchedAt, source: 'MyAnimeList via Tenrai' };
}

export function makeMalService({ fetchImpl = fetch, now = Date.now, minIntervalMs = 1100,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const cache = new Map(), pending = new Map();
  let queue = Promise.resolve(), nextStart = 0, queued = 0;
  let unavailableUntil = 0, lastFailure = null;
  function checkAvailability() {
    if (lastFailure && unavailableUntil > now()) throw new AnimeSourceError(lastFailure.message, lastFailure.status,
      { cause: lastFailure.cause, code: lastFailure.code, retryAfter: Math.max(1, Math.ceil((unavailableUntil - now()) / 1000)) });
  }
  function request(url) {
    checkAvailability();
    if (queued >= 15) throw new AnimeSourceError('Zu viele Anime-Anfragen. Bitte versuche es gleich erneut.', 429);
    queued += 1;
    const work = queue.then(async () => {
      checkAvailability();
      const delay = nextStart - now();
      if (delay > 0) await wait(delay);
      nextStart = now() + minIntervalMs;
      try {
        const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new AnimeSourceError(response.status === 429 ? 'Die Anime-Quelle ist ausgelastet. Bitte versuche es später erneut.'
          : 'Die Anime-Daten sind momentan nicht verfügbar.', response.status === 404 ? 404 : response.status === 429 ? 429 : 502,
        { code: response.status === 429 ? 'ANIME_SOURCE_RATE_LIMITED' : 'ANIME_SOURCE_HTTP_ERROR', retryAfter: retryAfterSeconds(response, now) });
        const data = await response.json();
        const sourceTime = response.headers?.get('last-modified');
        lastFailure = null;
        unavailableUntil = 0;
        return { data, fetchedAt: sourceTime && Number.isFinite(Date.parse(sourceTime)) ? new Date(sourceTime).toISOString() : null };
      } catch (error) {
        let failure = error;
        if (!(error instanceof AnimeSourceError)) {
          const timedOut = ['TimeoutError', 'AbortError'].includes(error.name)
            || ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(error.cause?.code);
          failure = new AnimeSourceError(error instanceof SyntaxError ? 'Die Anime-Quelle hat ungültige Daten geliefert. Bitte versuche es später erneut.'
            : timedOut ? 'Die Anime-Quelle antwortet momentan zu langsam. Bitte versuche es gleich erneut.'
              : 'Die Anime-Quelle ist momentan nicht erreichbar. Bitte versuche es gleich erneut.',
          error instanceof SyntaxError ? 502 : 503, { cause: error,
            code: error instanceof SyntaxError ? 'ANIME_SOURCE_INVALID_RESPONSE' : timedOut ? 'ANIME_SOURCE_TIMEOUT' : 'ANIME_SOURCE_NETWORK_ERROR' });
        }
        if (failure.status >= 500 || failure.status === 429) {
          const seconds = failure.retryAfter ?? (failure.status === 429 ? 30 : 15);
          failure.retryAfter = seconds;
          lastFailure = failure;
          unavailableUntil = now() + seconds * 1000;
        }
        throw failure;
      }
    }).finally(() => { queued -= 1; });
    queue = work.catch(() => {});
    return work;
  }
  async function cached(key, ttl, operation) {
    const entry = cache.get(key);
    if (entry && entry.until > now()) return structuredClone(entry.value);
    if (!pending.has(key)) {
      const work = operation().then(value => {
        cache.delete(key);
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(key, { value, until: now() + ttl });
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    return structuredClone(await pending.get(key));
  }
  return {
    async season() {
      const season = currentSeason(now);
      return cached(`season:${season.year}:${season.name}`, 900000, async () => {
        const items = [], seen = new Set();
        for (let page = 1; page <= MAX_SEASON_PAGES; page += 1) {
          const url = new URL(`${API_BASE}/seasons/${season.year}/${season.name}`);
          url.search = new URLSearchParams({ sfw: 'true', limit: '25', page: String(page) });
          const { data, fetchedAt } = await request(url);
          if (!Array.isArray(data?.data) || typeof data.pagination?.has_next_page !== 'boolean'
            || (data.pagination.current_page != null && data.pagination.current_page !== page)) {
            throw new AnimeSourceError('Die saisonale Anime-Liste hat keine gültigen Daten geliefert.');
          }
          const previousSize = seen.size;
          for (const item of data.data) {
            if (!Number.isSafeInteger(item?.mal_id) || item.mal_id < 1 || item.mal_id > 999999999 || !text(item.title, 300) || seen.has(item.mal_id)) continue;
            seen.add(item.mal_id);
            items.push(normalize(item, now, fetchedAt));
          }
          if (!data.pagination.has_next_page) return { items, season };
          if (seen.size === previousSize) throw new AnimeSourceError('Die saisonale Anime-Liste konnte nicht vollständig geladen werden.');
        }
        throw new AnimeSourceError('Die saisonale Anime-Liste enthält zu viele Ergebnisseiten.');
      });
    },
    async search(query, page = 1) {
      const term = typeof query === 'string' ? query.trim() : '';
      const current = typeof page === 'string' && /^\d+$/.test(page) ? Number(page) : page;
      if (term.length < 2 || term.length > 100) throw new AnimeSourceError('Bitte gib einen Suchbegriff mit 2–100 Zeichen ein.', 400);
      if (!Number.isInteger(current) || current < 1 || current > 1000) throw new AnimeSourceError('Ungültige Ergebnisseite.', 400);
      return cached(`search:${term.toLowerCase()}:${current}`, 120000, async () => {
        const url = new URL(`${API_BASE}/anime`);
        url.search = new URLSearchParams({ q: term, page: String(current), limit: '20', sfw: 'true', order_by: 'members', sort: 'desc' });
        const { data, fetchedAt } = await request(url);
        if (!Array.isArray(data?.data) || !data.pagination) throw new AnimeSourceError('Die Anime-Suche hat keine gültigen Daten geliefert.');
        const seen = new Set();
        const items = data.data.flatMap(item => {
          if (!Number.isSafeInteger(item?.mal_id) || item.mal_id < 1 || item.mal_id > 999999999 || !text(item.title, 300) || seen.has(item.mal_id)) return [];
          seen.add(item.mal_id);
          return [normalize(item, now, fetchedAt)];
        });
        const total = data.pagination.items?.total;
        return { items, total: Number.isSafeInteger(total) && total >= 0 ? total : null,
          page: current, hasMore: data.pagination.has_next_page === true };
      });
    },
    async details(value) {
      const id = malId(value);
      return cached(`details:${id}`, 900000, async () => {
        const { data, fetchedAt } = await request(new URL(`${API_BASE}/anime/${id}`));
        if (data?.data?.mal_id !== id) throw new AnimeSourceError('Der Anime konnte nicht eindeutig zugeordnet werden.');
        return normalize(data.data, now, fetchedAt);
      });
    },
  };
}
