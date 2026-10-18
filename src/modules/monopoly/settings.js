// raumeinstellungen: alles von richup plus unsere extras. texte gehen 1:1 ins lobby-panel

import { GameError } from './engine/errors.js';

export const STARTING_CASH = [500, 1000, 1500, 2000, 2500, 3000];
export const MAX_PLAYERS = [2, 3, 4, 5, 6, 7, 8];
export const TURN_TIMERS = ['standard', 'relaxed', 'off'];
export const ROUND_LIMITS = [0, 20, 30, 50];

export const DEFAULT_SETTINGS = Object.freeze({
  maxPlayers: 4,
  isPrivate: false,
  canBotsJoin: true,
  onlyUsers: false,
  teams: Object.freeze({ enabled: false, balanceStartCash: false }),
  payDoubleRentWhenOwnFullSet: false,
  vacationCash: false,
  auction: false,
  noRentPaymentsWhileInPrison: false,
  mortgage: false,
  evenBuild: true,
  startingCash: 1500,
  crazyCards: false,
  turnTimer: 'standard',
  roundLimit: 0,
  shufflePlayerOrder: true,
  mapId: 'lacedaemon',
});

/** Reihenfolge und text des einstellungs-panels (wie richup, plus "more" am ende). */
export const SETTINGS_CATALOG = [
  { section: 'room', key: 'maxPlayers', kind: 'select', options: MAX_PLAYERS, label: 'Maximum players', description: 'How many players can join the game' },
  { section: 'room', key: 'isPrivate', kind: 'switch', label: 'Private room', description: 'Private rooms can be accessed using the room URL only' },
  { section: 'room', key: 'canBotsJoin', kind: 'switch', label: 'Allow bots to join', badge: 'Beta', description: 'Bots can be added to empty seats' },
  { section: 'room', key: 'onlyUsers', kind: 'switch', label: 'Only logged-in users', description: 'Only allow players logged in with Discord to join the game' },
  { section: 'room', key: 'teams', kind: 'teams', label: 'Teams', badge: 'Beta', description: 'Partner with other players' },
  { section: 'rules', key: 'payDoubleRentWhenOwnFullSet', kind: 'switch', label: 'x2 rent on full-set properties', description: 'If a player owns a full property set, the base rent payment will be doubled' },
  { section: 'rules', key: 'vacationCash', kind: 'switch', label: 'Vacation cash', description: 'If a player lands on Vacation, all collected money from taxes and bank payments will be earned' },
  { section: 'rules', key: 'auction', kind: 'switch', label: 'Auction', description: 'If someone skips purchasing the property landed on, it will be sold to the highest bidder' },
  { section: 'rules', key: 'noRentPaymentsWhileInPrison', kind: 'switch', label: "Don't collect rent while in prison", description: 'Rent will not be collected when landing on properties whose owners are in prison' },
  { section: 'rules', key: 'mortgage', kind: 'switch', label: 'Mortgage', description: "Mortgage properties to earn 50% of their cost, but you won't get paid rent when players land on them" },
  { section: 'rules', key: 'evenBuild', kind: 'switch', label: 'Even build', description: 'Houses and hotels must be built up and sold off evenly within a property set' },
  { section: 'rules', key: 'startingCash', kind: 'select', options: STARTING_CASH, money: true, label: 'Starting cash', description: 'Adjust how much money players start the game with' },
  { section: 'more', key: 'crazyCards', kind: 'switch', label: 'Crazy Surprises/Treasures', badge: 'New', description: 'Mix wild cards into both decks: swaps, teleports, Nitro Boosts, TNT. Deviates from the original game' },
  { section: 'more', key: 'turnTimer', kind: 'select', options: TURN_TIMERS, label: 'Turn timer', description: 'Standard gives 20 seconds plus a time bank. Relaxed doubles it. Off waits forever' },
  { section: 'more', key: 'roundLimit', kind: 'select', options: ROUND_LIMITS, label: 'Round limit', description: 'End the game after this many rounds; the highest net worth wins. 0 plays until one is left' },
  { section: 'order', key: 'shufflePlayerOrder', kind: 'switch', label: 'Randomize player order', description: 'Randomly reorder players at the beginning of the game' },
];

const BOOLEAN_KEYS = SETTINGS_CATALOG.filter(s => s.kind === 'switch').map(s => s.key);

/**
 * Teilupdate prüfen (strikt wie bei richup: unbekannte schlüssel sind ein fehler).
 * `knownMaps` ist die liste gültiger map-ids.
 */
export function validateSettingsPatch(patch, knownMaps) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new GameError('Invalid settings');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (BOOLEAN_KEYS.includes(key)) {
      if (typeof value !== 'boolean') throw new GameError(`Invalid ${key} value`);
      clean[key] = value;
    } else if (key === 'maxPlayers') {
      if (!MAX_PLAYERS.includes(value)) throw new GameError('Invalid maxPlayers value');
      clean[key] = value;
    } else if (key === 'startingCash') {
      if (!STARTING_CASH.includes(value)) throw new GameError('Invalid startingCash value');
      clean[key] = value;
    } else if (key === 'turnTimer') {
      if (!TURN_TIMERS.includes(value)) throw new GameError('Invalid turnTimer value');
      clean[key] = value;
    } else if (key === 'roundLimit') {
      if (!ROUND_LIMITS.includes(value)) throw new GameError('Invalid roundLimit value');
      clean[key] = value;
    } else if (key === 'mapId') {
      if (typeof value !== 'string' || !knownMaps.includes(value)) throw new GameError('Invalid mapId value');
      clean[key] = value;
    } else if (key === 'teams') {
      if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') throw new GameError('Invalid teams value');
      clean.teams = { enabled: value.enabled, balanceStartCash: value.enabled && value.balanceStartCash === true };
    } else {
      throw new GameError(`Unknown setting: ${key}`);
    }
  }
  return clean;
}

export function createSettings(patch = {}, knownMaps = [DEFAULT_SETTINGS.mapId]) {
  return { ...DEFAULT_SETTINGS, teams: { ...DEFAULT_SETTINGS.teams }, ...validateSettingsPatch(patch, knownMaps) };
}

/** Regeln, die vom standard abweichen (für die chips auf den raumkarten). */
export function changedRules(settings) {
  return SETTINGS_CATALOG
    .filter(s => s.section === 'rules' || s.section === 'more')
    .filter(s => JSON.stringify(settings[s.key]) !== JSON.stringify(DEFAULT_SETTINGS[s.key]))
    .map(s => s.key);
}
