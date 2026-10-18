// das ganze brett als eine zeile: zum schnellen überblick und mitfokussieren
// (das feld, auf dem der spieler am zug steht, wird automatisch in die mitte gescrollt)

import { h } from './dom.js';
import { pawnSvg } from './icons.js';

export class BoardStrip {
  constructor({ onTile } = {}) {
    this.onTile = onTile ?? (() => {});
    this.el = h('div.board-strip', { hidden: true });
    this.track = h('ol.strip-track');
    this.el.append(this.track);
    this.map = null;
    this.tiles = [];
    this.focused = null;
  }

  setMap(map) {
    if (this.map?.id === map.id && this.tiles.length === map.tiles.length) return;
    this.map = map;
    this.tiles = map.tiles.map((tile, index) => {
      const group = tile.type === 'city' ? map.groups[tile.group] : null;
      const el = h('button.strip-tile', {
        type: 'button',
        '--group': group?.color ?? 'transparent',
        'data-index': index,
        'aria-label': tile.name,
        onclick: () => this.onTile(index),
      },
        h('span.strip-index', String(index)),
        h('span.strip-name', tile.name),
        h('span.strip-levels'),
        h('span.strip-pawns'));
      return { el, tile, index, levels: el.querySelector('.strip-levels'), pawns: el.querySelector('.strip-pawns') };
    });
    this.track.replaceChildren(...this.tiles.map(t => t.el));
    this.focused = null;
  }

  update(game, participants = []) {
    if (!this.map) return;
    const players = game?.players ?? [];
    const turnId = game?.phase === 'playing' ? game.turn?.playerId : null;
    const byTile = new Map();
    for (const p of players) {
      if (p.bankrupt) continue;
      if (!byTile.has(p.position)) byTile.set(p.position, []);
      byTile.get(p.position).push(p);
    }
    this.lastPlayers = players;
    for (const { el, index, levels, pawns } of this.tiles) {
      const state = game?.tiles?.[index] ?? null;
      const owner = state?.owner ? players.find(p => p.id === state.owner) : null;
      const color = owner?.appearance?.color ?? participants.find(p => p.id === state?.owner)?.appearance?.color ?? null;
      el.classList.toggle('is-owned', Boolean(owner || color));
      el.classList.toggle('is-mortgaged', Boolean(state?.mortgaged));
      if (color) el.style.setProperty('--owner', color);
      const level = state?.level ?? 0;
      if (levels.dataset.level !== String(level)) {
        levels.dataset.level = level;
        levels.replaceChildren(...(level === 5 ? [h('i.level-full', '★')] : Array.from({ length: level }, () => h('i.level'))));
      }
      const here = byTile.get(index) ?? [];
      const key = here.map(p => `${p.id}:${p.appearance?.color ?? ''}`).join('|');
      if (pawns.dataset.key !== key) {
        pawns.dataset.key = key;
        pawns.replaceChildren(...here.map(p => h('span.strip-pawn', { title: p.name, html: pawnSvg(p.appearance?.shape, p.appearance?.color) })));
      }
      el.classList.toggle('is-turn', Boolean(turnId) && here.some(p => p.id === turnId));
    }
  }

  /** Sicht auf den spieler am zug schieben; nur wenn sich die position geändert hat. */
  focusTurn(game, { force = false } = {}) {
    if (!this.map) return;
    const player = game?.players?.find(p => p.id === game.turn?.playerId);
    if (!player) return;
    const key = `${player.id}:${player.position}`;
    if (!force && this.focused === key) return;
    this.focused = key;
    // erst nach dem layout messen, sonst ist die breite noch 0
    const run = () => this.focusIndex(player.position);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }

  focusIndex(index) {
    const item = this.tiles[index];
    if (!item) return;
    // offsetLeft zählt ab dem nächsten positionierten elternteil, nicht ab der spur
    const track = this.track.getBoundingClientRect();
    const tile = item.el.getBoundingClientRect();
    const offset = tile.left - track.left + this.track.scrollLeft;
    const target = offset - this.track.clientWidth / 2 + tile.width / 2;
    this.track.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }
}
