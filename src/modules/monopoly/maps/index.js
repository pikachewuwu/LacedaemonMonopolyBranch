// lädt alle map-vorlagen (*.json) aus diesem ordner. neue map = neue datei, kein code nötig

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMap } from './validate.js';

const mapsDir = path.dirname(fileURLToPath(import.meta.url));

export function loadMaps(directory = mapsDir) {
  const maps = new Map();
  for (const file of readdirSync(directory).filter(f => f.endsWith('.json')).sort()) {
    const map = validateMap(JSON.parse(readFileSync(path.join(directory, file), 'utf8')));
    if (maps.has(map.id)) throw new Error(`Map-ID doppelt: ${map.id} (${file})`);
    maps.set(map.id, Object.freeze(map));
  }
  if (!maps.size) throw new Error('Keine Monopoly-Map gefunden.');
  return maps;
}

/** Kurzinfo für listen (lobby, map-auswahl). */
export function mapSummary(map) {
  return {
    id: map.id,
    name: map.name,
    description: map.description ?? '',
    tiles: map.tiles.length,
    colors: Object.values(map.groups).map(g => g.color),
  };
}
