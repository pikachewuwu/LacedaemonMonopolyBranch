// spielfiguren: farbe (richup-palette) und form, plus namen für bots und teams

export const COLORS = [
  '#c0da5a', '#ffc73f', '#ff843f', '#c34848', '#5a99da', '#7fe7f5',
  '#009688', '#73e85d', '#9a6e5e', '#c63fa2', '#ff7ca0', '#7f5ada',
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
