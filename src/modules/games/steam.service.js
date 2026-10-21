import sanitizeHtml from 'sanitize-html';

export class SteamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function steamAppId(value) {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id < 1 || id > 4294967295) throw new SteamError('Ungültige Steam-App-ID.', 400);
  return id;
}

function text(value, length = 2000) {
  if (typeof value !== 'string') return '';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key) => {
      if (key[0] !== '#') return entities[key.toLowerCase()] ?? entity;
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).trim().slice(0, length);
}

function imageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const allowed = ['steamstatic.com', 'steamcdn-a.akamaihd.net', 'steamusercontent.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    return url.protocol === 'https:' && allowed && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

function attributes(markup, name) {
  return markup.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] ?? '';
}

function searchItems(html) {
  const items = [];
  const seen = new Set();
  const rows = /<a\b([^>]*\bdata-ds-appid\s*=\s*["']\d+["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const row of html.matchAll(rows)) {
    const id = Number(attributes(row[1], 'data-ds-appid'));
    if (!Number.isSafeInteger(id) || id < 1 || id > 4294967295 || seen.has(id)) continue;
    const title = text(row[2].match(/<span\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1], 300);
    if (!title) continue;
    const image = row[2].match(/<img\b[^>]*>/i)?.[0] ?? '';
    const price = text(row[2].match(/<div\b[^>]*class=["'][^"']*\bdiscount_final_price\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1], 80);
    items.push({ steamAppId: id, title, headerImage: imageUrl(attributes(image, 'src')), price: price ? { formatted: price } : null });
    seen.add(id);
  }
  return items;
}

function playerInfo(data) {
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const coop = categories.some(category => [9, 38, 39, 48].includes(category.id) || /ko[-\s]?op|co[-\s]?op/i.test(category.description ?? ''));
  const multiplayer = categories.some(category => category.id === 1);
  const singlePlayer = categories.some(category => category.id === 2);
  let coopPlayers = null;
  if (coop) {
    const description = text(data.detailed_description, 50000);
    // Only read explicit player counts immediately connected to a co-op description.
    const numbered = [...description.matchAll(/\b(\d{1,2})\s*[-– ]*(?:spieler|players?)\s*[-– ]*(?:ko[-\s]?op|co[-\s]?op|cooperative)/gi)];
    const paired = /\b(?:zwei|two)\s*[-– ]*(?:spieler|players?)\s*[-– ]*(?:ko[-\s]?op|co[-\s]?op|cooperative)/i.test(description);
    const counts = new Set(numbered.map(match => Number(match[1])).filter(count => count >= 2 && count <= 64));
    if (paired) counts.add(2);
    if (counts.size === 1) coopPlayers = [...counts][0];
  }
  return { coop, coopPlayers, multiplayer, singlePlayer,
    label: coop ? coopPlayers ? `Koop · ${coopPlayers} Spieler` : 'Koop · Spielerzahl nicht angegeben'
      : multiplayer ? 'Mehrspieler · Spielerzahl nicht angegeben' : singlePlayer ? 'Einzelspieler · 1 Spieler' : 'Spielerzahl nicht angegeben' };
}

export function makeSteamService({ fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  async function json(url) {
    try {
      const response = await fetchImpl(url.href, {
        signal: AbortSignal.timeout(8000), redirect: 'error',
        headers: { Accept: 'application/json', 'Accept-Language': 'de-DE,de;q=0.9' },
      });
      if (!response.ok) throw new SteamError('Steam ist momentan nicht erreichbar. Bitte versuche es später erneut.', response.status === 429 ? 503 : 502);
      return await response.json();
    } catch (error) {
      if (error instanceof SteamError) throw error;
      throw new SteamError('Steam konnte nicht rechtzeitig antworten. Bitte versuche es erneut.', 503);
    }
  }
  async function cached(key, ttl, operation) {
    const entry = cache.get(key);
    if (entry && entry.expiresAt > now()) return structuredClone(entry.value);
    if (!pending.has(key)) {
      const work = operation().then(value => {
        cache.delete(key);
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expiresAt: now() + ttl });
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    return structuredClone(await pending.get(key));
  }
  return {
    async search(query, page = 1) {
      const term = typeof query === 'string' ? query.trim() : '';
      if (term.length < 2 || term.length > 100) throw new SteamError('Bitte gib einen Suchbegriff mit 2–100 Zeichen ein.', 400);
      const currentPage = typeof page === 'string' && /^\d+$/.test(page) ? Number(page) : page;
      if (!Number.isInteger(currentPage) || currentPage < 1 || currentPage > 1000) throw new SteamError('Ungültige Ergebnisseite.', 400);
      return cached(`search:${term.toLowerCase()}:${currentPage}`, 120000, async () => {
        const url = new URL('https://store.steampowered.com/search/results/');
        url.search = new URLSearchParams({ term, category1: '998', start: String((currentPage - 1) * 50), count: '50', l: 'german', cc: 'de', infinite: '1' });
        const data = await json(url);
        if (!data?.success || typeof data.results_html !== 'string' || data.results_html.length > 4000000) throw new SteamError('Die Steam-Suche hat keine gültigen Daten geliefert.');
        const total = Number(data.total_count);
        if (!Number.isSafeInteger(total) || total < 0) throw new SteamError('Die Steam-Suche hat keine gültige Trefferzahl geliefert.');
        return { items: searchItems(data.results_html), total, page: currentPage, hasMore: currentPage * 50 < total };
      });
    },
    async details(value) {
      const id = steamAppId(value);
      return cached(`details:${id}`, 1800000, async () => {
        const url = new URL('https://store.steampowered.com/api/appdetails');
        url.search = new URLSearchParams({ appids: String(id), l: 'german', cc: 'de' });
        const response = await json(url);
        const data = response?.[id]?.data;
        if (!response?.[id]?.success || !data || data.type !== 'game' || Number(data.steam_appid) !== id) {
          throw new SteamError('Dieses Steam-Spiel ist nicht verfügbar oder der Eintrag ist kein Spiel.', 404);
        }
        const title = text(data.name, 300);
        if (!title) throw new SteamError('Steam hat keinen gültigen Spieltitel geliefert.');
        let price = null;
        if (data.is_free === true) price = { formatted: 'Kostenlos', currency: null, final: 0, isFree: true };
        else if (data.price_overview && Number.isSafeInteger(data.price_overview.final) && data.price_overview.final >= 0) {
          price = { formatted: text(data.price_overview.final_formatted, 80) || 'Preis nicht angegeben',
            currency: text(data.price_overview.currency, 3), final: data.price_overview.final, isFree: false };
        }
        return { steamAppId: id, title, shortDescription: text(data.short_description),
          headerImage: imageUrl(data.header_image), storeUrl: `https://store.steampowered.com/app/${id}/`,
          genres: Array.isArray(data.genres) ? data.genres.map(genre => text(genre.description, 80)).filter(Boolean).slice(0, 20) : [],
          price, players: playerInfo(data), metadataUpdatedAt: new Date(now()).toISOString() };
      });
    },
  };
}
