// geld, wörter und farben so, wie die map-vorlage es vorgibt

export function money(map, amount) {
  const symbol = map?.words?.currency ?? '$';
  const sign = amount < 0 ? '-' : '';
  const value = Math.abs(Math.round(amount)).toLocaleString('en-US');
  return map?.words?.currencyPosition === 'before' ? `${sign}${symbol}${value}` : `${sign}${value}${symbol}`;
}

export const word = (map, key, fallback) => map?.words?.[key] ?? fallback;

export function pardonName(map, deck) {
  const pardon = map?.words?.pardon;
  if (typeof pardon === 'string') return pardon;
  return pardon?.[deck] ?? 'Pardon card';
}

/** Lesbare textfarbe auf einer gruppenfarbe. */
export function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#14121a' : '#ffffff';
}

export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export const isOwnable = tile => tile && ['city', 'airport', 'company'].includes(tile.type);

export function groupTiles(map, group) {
  return map.tiles.flatMap((t, i) => (t.type === 'city' && t.group === group ? [i] : []));
}

/** Farbe eines feldes (straße: gruppe, sonst neutral). */
export function tileColor(map, tile) {
  if (tile?.type === 'city') return map.groups[tile.group].color;
  return null;
}
