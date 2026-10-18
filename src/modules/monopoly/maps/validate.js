// prüft eine map-vorlage, bevor sie geladen oder für einen raum benutzt wird

import { GameError } from '../engine/errors.js';

const CORNERS = ['go', 'prison', 'vacation', 'goToPrison'];
const TILE_TYPES = new Set(['corner', 'city', 'airport', 'company', 'tax', 'treasure', 'surprise']);
export const EFFECTS = new Set([
  'money', 'moveTo', 'moveSteps', 'nextOfType', 'prison', 'pardon', 'payEach', 'collectEach', 'repairs',
  'boost', 'shield', 'skipTurn', 'goToVacation', 'teleportRandom', 'swapRandom', 'moveOthers',
  'stealPercent', 'robinHood', 'everyonePaysPot', 'payPerProperty', 'freeUpgrade', 'griefUpgrade', 'griefSelf', 'claimFree',
]);

const isInt = (v, min = 0) => Number.isInteger(v) && v >= min;
const isText = (v, max = 60) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function validateMap(map) {
  const fail = message => { throw new GameError(`Map ${map?.id ?? '?'}: ${message}`); };
  if (!map || typeof map !== 'object') fail('not an object');
  if (!/^[a-z0-9-]{2,40}$/.test(map.id ?? '')) fail('id must be 2–40 characters of a-z, 0-9 and -');
  if (!isText(map.name)) fail('name is missing');
  const tiles = map.tiles;
  if (!Array.isArray(tiles) || tiles.length < 16 || tiles.length % 4 !== 0 || tiles.length > 64) {
    fail('tiles must be a list of 16 to 64 entries, divisible by 4');
  }
  const side = tiles.length / 4;
  CORNERS.forEach((kind, k) => {
    const tile = tiles[k * side];
    if (tile?.type !== 'corner' || tile.corner !== kind) fail(`tile ${k * side} must be the "${kind}" corner`);
  });
  const groups = map.groups ?? {};
  for (const [id, group] of Object.entries(groups)) {
    if (!isColor(group.color)) fail(`group ${id} needs a colour like #79678a`);
  }
  tiles.forEach((tile, i) => {
    const where = `tile ${i} (${tile?.name ?? '?'})`;
    if (!TILE_TYPES.has(tile?.type)) fail(`${where}: unknown type`);
    if (!isText(tile.name, 40)) fail(`${where}: name must be 1–40 characters`);
    if (tile.type === 'corner' && i % side !== 0) fail(`${where}: corners only go in the corners`);
    if (tile.type !== 'corner' && i % side === 0) fail(`${where}: a corner position needs a corner tile`);
    if (tile.type === 'city') {
      if (!groups[tile.group]) fail(`${where}: unknown group "${tile.group}"`);
      if (!isInt(tile.price, 1) || !isInt(tile.house, 1)) fail(`${where}: price and house must be positive whole numbers`);
      if (!Array.isArray(tile.rent) || tile.rent.length !== 6 || !tile.rent.every(r => isInt(r))) fail(`${where}: rent needs 6 numbers (plain, 1–4 upgrades, full)`);
    }
    if (tile.type === 'airport') {
      if (!isInt(tile.price, 1)) fail(`${where}: price must be a positive whole number`);
      if (!Array.isArray(tile.rent) || !tile.rent.length || !tile.rent.every(r => isInt(r))) fail(`${where}: rent needs one number per airport owned`);
    }
    if (tile.type === 'company') {
      if (!isInt(tile.price, 1)) fail(`${where}: price must be a positive whole number`);
      if (!Array.isArray(tile.multipliers) || !tile.multipliers.length || !tile.multipliers.every(r => isInt(r, 1))) fail(`${where}: multipliers needed`);
    }
    if (tile.type === 'tax' && !isInt(tile.amount, 1) && !isInt(tile.percent, 1)) fail(`${where}: tax needs an amount or a percent`);
  });
  for (const key of ['pass', 'land']) if (!isInt(map.rewards?.[key])) fail(`rewards.${key} must be a whole number`);
  if (!isInt(map.prison?.fine) || !isInt(map.prison?.turns, 1)) fail('prison needs fine and turns');
  if (!isInt(map.vacation?.turns)) fail('vacation needs turns');

  const decks = [
    ['treasure', map.cards?.treasure],
    ['surprise', map.cards?.surprise],
    ['crazy.treasure', map.cards?.crazy?.treasure ?? []],
    ['crazy.surprise', map.cards?.crazy?.surprise ?? []],
  ];
  for (const [name, cards] of decks) {
    if (!Array.isArray(cards)) fail(`cards.${name} must be a list`);
    cards.forEach((card, k) => {
      const where = `cards.${name}[${k}]`;
      if (!isText(card?.text, 240)) fail(`${where}: text must be 1–240 characters`);
      if (!EFFECTS.has(card.effect?.type)) fail(`${where}: unknown effect "${card.effect?.type}"`);
      if (card.effect.type === 'moveTo' && !(isInt(card.effect.tile) && card.effect.tile < tiles.length)) fail(`${where}: tile index out of range`);
    });
    if (cards.filter(c => c.effect.type === 'pardon').length > 1 && !name.startsWith('crazy')) fail(`cards.${name}: at most one pardon card`);
  }
  return map;
}
