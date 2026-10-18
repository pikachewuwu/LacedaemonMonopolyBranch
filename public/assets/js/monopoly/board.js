// das spielbrett: felder aus der map-vorlage bauen, besitz/upgrades zeigen, figuren laufen lassen

import { h, wait } from './dom.js';
import { CORNER_ART, FLAGS, TILE_ICONS, artwork, pawnSvg } from './icons.js';
import { inkOn, isOwnable, money } from './format.js';

const CORNER_RATIO = 1.6;
const STEP_MS = 190;

export class Board {
  constructor({ onTile } = {}) {
    this.onTile = onTile ?? (() => {});
    this.el = h('div.board');
    this.grid = h('div.board-grid');
    this.center = h('div.board-center');
    this.pawnLayer = h('div.pawn-layer');
    this.el.append(this.grid, this.pawnLayer);
    this.map = null;
    this.tiles = [];
    this.pawns = new Map();
    this.shown = new Map();
    this.moving = new Set();
  }

  /** Geometrie: 1 = kantenfeld, CORNER_RATIO = ecke. */
  geometry(index) {
    const side = this.map.tiles.length / 4;
    let row;
    let col;
    let edge;
    if (index <= side) { row = 1; col = index + 1; edge = 'top'; }
    else if (index <= side * 2) { col = side + 1; row = index - side + 1; edge = 'right'; }
    else if (index <= side * 3) { row = side + 1; col = side + 1 - (index - side * 2); edge = 'bottom'; }
    else { col = 1; row = side + 1 - (index - side * 3); edge = 'left'; }
    if (index % side === 0) edge = 'corner';
    const total = side - 1 + CORNER_RATIO * 2;
    const center = n => (n === 1 ? CORNER_RATIO / 2 : n === side + 1 ? total - CORNER_RATIO / 2 : CORNER_RATIO + (n - 2) + 0.5);
    return { row, col, edge, x: (center(col) / total) * 100, y: (center(row) / total) * 100, unit: 100 / total };
  }

  setMap(map) {
    if (this.map?.id === map.id && this.tiles.length === map.tiles.length) return;
    this.map = map;
    const side = map.tiles.length / 4;
    this.el.style.setProperty('--n', side - 1);
    this.el.style.setProperty('--k', CORNER_RATIO);
    this.grid.style.gridTemplateColumns = `${CORNER_RATIO}fr repeat(${side - 1}, 1fr) ${CORNER_RATIO}fr`;
    this.grid.style.gridTemplateRows = this.grid.style.gridTemplateColumns;
    this.center.style.gridArea = `2 / 2 / ${side + 1} / ${side + 1}`;
    this.tiles = map.tiles.map((tile, index) => this.buildTile(tile, index));
    this.grid.replaceChildren(...this.tiles.map(t => t.el), this.center);
    this.pawns.clear();
    this.shown.clear();
    this.pawnLayer.replaceChildren();
  }

  buildTile(tile, index) {
    const g = this.geometry(index);
    const group = tile.type === 'city' ? this.map.groups[tile.group] : null;
    const el = h(`button.tile.tile-${tile.type}.edge-${g.edge}`, {
      type: 'button',
      style: { gridRow: g.row, gridColumn: g.col },
      '--group': group?.color ?? 'transparent',
      '--group-ink': group ? inkOn(group.color) : 'inherit',
      'aria-label': tile.name,
      'data-index': index,
      onclick: () => this.onTile(index),
    });
    if (tile.type === 'corner') {
      el.classList.add(`corner-${tile.corner}`);
      if (tile.corner === 'prison') {
        el.append(
          h('span.corner-visit', tile.visiting ?? 'Passing by'),
          h('span.prison-cell', h('span.prison-art', { html: artwork(tile.art ?? 'prison', CORNER_ART) }), h('span.prison-label', tile.name)),
        );
      } else {
        const pot = tile.corner === 'vacation' ? h('span.corner-pot', { hidden: true }) : null;
        el.append(h('span.corner-inner', h('span.corner-art', { html: artwork(tile.art ?? tile.corner, CORNER_ART) }), h('span.corner-label', tile.name), pot));
        return { el, tile, pot };
      }
      return { el, tile };
    }
    const flag = group ? h('span.tile-flag', { html: artwork(group.flag, FLAGS) }) : null;
    const icon = !group ? h('span.tile-icon', { html: artwork(tile.icon ?? tile.type, TILE_ICONS) }) : null;
    const price = isOwnable(tile) ? money(this.map, tile.price) : tile.type === 'tax' ? (tile.percent ? `${tile.percent}%` : money(this.map, tile.amount)) : '';
    const priceEl = price ? h('span.tile-price', price) : null;
    const levels = h('span.tile-levels');
    // lange wörter kleiner setzen statt mitten im wort umzubrechen
    const longest = Math.max(...tile.name.split(/[\s-]+/).map(w => w.length));
    const name = h('span.tile-name', { '--chars': longest }, tile.name);
    if (/\s/.test(tile.name)) el.classList.add('has-space');
    const owner = isOwnable(tile) ? h('span.tile-owner') : null;
    const card = h('span.tile-card', flag, h('span.tile-glow'), icon, name, levels, priceEl, owner);
    el.append(card, h('span.tile-mortgage', 'Mortgaged'));
    return { el, tile, priceEl, levels, price, owner };
  }

  /** Besitz, upgrades, hypotheken und figuren aus dem spielzustand übernehmen. */
  update(game, participants = [], { showPot = false } = {}) {
    if (!this.map) return;
    this.lastGame = game;
    const lookOf = id => game?.players.find(p => p.id === id)?.appearance ?? participants.find(p => p.id === id)?.appearance ?? { color: '#888', shape: 'blob' };
    this.tiles.forEach((t, i) => {
      const state = game?.tiles?.[i] ?? null;
      const owned = Boolean(state?.owner);
      t.el.classList.toggle('is-owned', owned);
      t.el.classList.toggle('is-mortgaged', Boolean(state?.mortgaged));
      if (owned) {
        const look = lookOf(state.owner);
        t.el.style.setProperty('--owner', look.color);
        t.el.style.setProperty('--owner-ink', inkOn(look.color));
        const key = `${look.shape}:${look.color}`;
        if (t.owner && t.owner.dataset.look !== key) {
          t.owner.dataset.look = key;
          t.owner.innerHTML = pawnSvg(look.shape, look.color);
        }
      } else {
        t.el.style.removeProperty('--owner');
      }
      if (t.pot) {
        const pot = game?.vacationPot ?? 0;
        t.pot.hidden = !(showPot || pot > 0);
        const label = `Pot: ${money(this.map, pot)}`;
        if (t.pot.textContent !== label) t.pot.textContent = label;
      }
      if (t.priceEl) {
        const label = owned && !state.mortgaged && state.rent ? money(this.map, state.rent) : t.price;
        if (t.priceEl.textContent !== label) t.priceEl.textContent = label;
      }
      if (t.levels) {
        const level = state?.level ?? 0;
        if (t.levels.dataset.level !== String(level)) {
          t.levels.dataset.level = level;
          t.levels.replaceChildren(...(level === 5 ? [h('i.level-full', '★')] : Array.from({ length: level }, () => h('i.level'))));
          if (level) t.el.classList.add('just-built');
          setTimeout(() => t.el.classList.remove('just-built'), 700);
        }
      }
    });
    this.updatePawns(game, participants);
  }

  updatePawns(game, participants) {
    const players = game ? game.players.filter(p => !p.bankrupt) : [];
    const ids = new Set(players.map(p => p.id));
    for (const [id, el] of this.pawns) {
      if (!ids.has(id)) {
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 400);
        this.pawns.delete(id);
        this.shown.delete(id);
      }
    }
    for (const p of players) {
      let el = this.pawns.get(p.id);
      const appearance = p.appearance ?? participants.find(x => x.id === p.id)?.appearance ?? { color: '#ccc', shape: 'blob' };
      const look = `${appearance.shape}:${appearance.color}`;
      if (!el) {
        el = h('div.pawn', { 'data-player': p.id, title: p.name });
        this.pawnLayer.append(el);
        this.pawns.set(p.id, el);
      }
      if (el.dataset.look !== look) {
        el.dataset.look = look;
        el.innerHTML = pawnSvg(appearance.shape, appearance.color);
      }
      el.classList.toggle('is-turn', game.turn.playerId === p.id && game.phase === 'playing');
      el.classList.toggle('in-prison', p.prisonTurns > 0);
      if (!this.moving.has(p.id)) this.shown.set(p.id, p.position);
    }
    this.layoutPawns(game);
  }

  /** Mehrere figuren auf einem feld leicht versetzt anordnen. */
  layoutPawns(game) {
    const byTile = new Map();
    for (const [id, pos] of this.shown) {
      const jailed = game?.players.find(p => p.id === id)?.prisonTurns > 0;
      const key = `${pos}:${jailed && pos === this.prisonIndex() ? 'in' : 'out'}`;
      if (!byTile.has(key)) byTile.set(key, []);
      byTile.get(key).push(id);
    }
    for (const [key, ids] of byTile) {
      const [pos, where] = key.split(':');
      const g = this.geometry(Number(pos));
      ids.forEach((id, k) => {
        const el = this.pawns.get(id);
        if (!el) return;
        const [dx, dy] = spread(k, ids.length, g.unit * (g.edge === 'corner' ? 0.42 : 0.3));
        let { x, y } = g;
        if (Number(pos) === this.prisonIndex()) {
          // in der zelle: zur brettmitte versetzt, beim vorbeigehen: am rand
          const shift = g.unit * 0.42;
          if (where === 'in') { x -= shift * 0.55; y += shift * 0.55; } else { x += shift * 0.75; y -= shift * 0.75; }
        }
        el.style.left = `${x + dx}%`;
        el.style.top = `${y + dy}%`;
        el.style.zIndex = String(10 + Math.round(y));
      });
    }
  }

  prisonIndex() {
    return this.map ? this.map.tiles.length / 4 : 10;
  }

  /** Eine bewegung abspielen. walk = feld für feld, jump = bogen, prison = blinzeln. */
  async move(event, fast = false) {
    const el = this.pawns.get(event.playerId);
    if (!el || fast) {
      this.shown.set(event.playerId, event.to);
      return;
    }
    const n = this.map.tiles.length;
    this.moving.add(event.playerId);
    try {
      if (event.mode === 'walk' && event.steps !== 0) {
        const dir = Math.sign(event.steps);
        let pos = event.from;
        for (let i = 0; i < Math.abs(event.steps); i++) {
          pos = (pos + dir + n) % n;
          this.shown.set(event.playerId, pos);
          el.classList.remove('hop');
          void el.offsetWidth;
          el.classList.add('hop');
          this.layoutPawns(this.lastGame);
          await wait(STEP_MS);
        }
      } else {
        el.classList.add(event.mode === 'prison' ? 'warp' : 'jump');
        await wait(event.mode === 'prison' ? 220 : 120);
        this.shown.set(event.playerId, event.to);
        this.layoutPawns(this.lastGame);
        await wait(event.mode === 'prison' ? 380 : 520);
        el.classList.remove('jump', 'warp');
      }
    } finally {
      this.moving.delete(event.playerId);
    }
  }

  /** Felder hervorheben (z.b. eigene grundstücke beim handeln). */
  highlight(indices) {
    const set = new Set(indices ?? []);
    this.el.classList.toggle('is-highlighting', set.size > 0);
    this.tiles.forEach((t, i) => t.el.classList.toggle('is-highlight', set.has(i)));
  }
}

function spread(k, count, radius) {
  if (count <= 1) return [0, 0];
  const angle = (k / count) * Math.PI * 2 - Math.PI / 2;
  const r = radius * (count > 4 ? 1 : 0.8);
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

/** Mini-vorschau eines bretts (landing page, map-auswahl). */
export function miniBoard(map) {
  const board = new Board();
  board.setMap(map);
  board.el.classList.add('is-mini');
  return board;
}
