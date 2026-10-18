// reine helfer rund um ein spielbrett (map-json), ohne spielzustand

export const OWNABLE = new Set(['city', 'airport', 'company']);

export const isOwnable = tile => OWNABLE.has(tile?.type);

/** Indizes vorberechnen, damit die Engine nicht ständig sucht. */
export function describeMap(map) {
  const size = map.tiles.length;
  const corner = kind => map.tiles.findIndex(t => t.type === 'corner' && t.corner === kind);
  const groups = {};
  const byType = { airport: [], company: [] };
  map.tiles.forEach((tile, index) => {
    if (tile.type === 'city') (groups[tile.group] ??= []).push(index);
    if (byType[tile.type]) byType[tile.type].push(index);
  });
  return {
    size,
    side: size / 4,
    go: corner('go'),
    prison: corner('prison'),
    vacation: corner('vacation'),
    goToPrison: corner('goToPrison'),
    groups,
    airports: byType.airport,
    companies: byType.company,
  };
}

/** Geld im stil der map formatieren, z.b. "200🐉". */
export function money(map, amount) {
  const symbol = map.words?.currency ?? '$';
  const value = Math.round(amount).toLocaleString('en-US');
  return map.words?.currencyPosition === 'before' ? `${symbol}${value}` : `${value}${symbol}`;
}

export const word = (map, key, fallback) => map.words?.[key] ?? fallback;

export function pardonName(map, deck) {
  const pardon = map.words?.pardon;
  if (typeof pardon === 'string') return pardon;
  return pardon?.[deck] ?? 'Exit card';
}
