// spielfiguren: farbe und form, plus namen für bots und teams.
// zehn farben, die man auf dem brett sicher auseinanderhält

export const COLORS = [
  '#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00',
  '#8e24aa', '#00bcd4', '#ec407a', '#f5f5f5', '#795548',
];

export const SHAPES = ['blob', 'helmet', 'dragon', 'cube', 'ghost', 'crown'];

export const BOT_NAMES = ['Blitz Bot', 'Creeper', 'Spartan Bot', 'Lizard King', 'Mod Bot', 'Dragon Bot', 'Ghost Ping', 'Backroom Entity'];

export const TEAMS = [
  { id: 'dragons', name: 'Dragons', emoji: '🐉' },
  { id: 'lizards', name: 'Lizards', emoji: '🦎' },
  { id: 'spartans', name: 'Spartans', emoji: '🛡️' },
  { id: 'grass', name: 'Grass Touchers', emoji: '🌿' },
];

export function validAppearance(value) {
  return Boolean(value && COLORS.includes(value.color) && SHAPES.includes(value.shape));
}
