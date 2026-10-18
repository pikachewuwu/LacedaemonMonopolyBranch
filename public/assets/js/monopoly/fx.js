// effekte über dem brett: kurz und klar. münzen, siegel, banner und der tausch beim handel

import { h, wait } from './dom.js';
import { FLAGS, LOGO, TILE_ICONS, artwork } from './icons.js';
import { isOwnable, money, pardonName } from './format.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Fx {
  constructor(board) {
    this.board = board;
    this.layer = h('div.fx-layer');
    this.ambient = h('div.center-ambient', Array.from({ length: 10 }, (_, k) => h('i', {
      '--x': `${(k * 37) % 100}%`, '--d': `${10 + (k * 7) % 9}s`, '--delay': `${-(k * 1.7) % 9}s`, '--s': `${0.5 + ((k * 13) % 10) / 10}`,
    })));
    board.el.append(this.layer);
    board.center.prepend(this.ambient);
  }

  tilePoint(index) {
    const g = this.board.geometry(index);
    return { x: g.x, y: g.y };
  }

  pawnPoint(playerId) {
    const el = this.board.pawns.get(playerId);
    if (!el) return null;
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  }

  spawn(node, ms) {
    this.layer.append(node);
    setTimeout(() => node.remove(), ms);
    return node;
  }

  /** Münzen fliegen im bogen von a nach b, dazu der betrag beim empfänger. */
  coins(from, to, count, label = '') {
    if (!from || !to || reduced()) return;
    for (let i = 0; i < count; i++) {
      const coin = this.spawn(h('span.fx-coin', '🐉'), 1000);
      const jitter = () => (Math.random() - 0.5) * 2.4;
      const mid = { x: (from.x + to.x) / 2 + jitter(), y: Math.min(from.y, to.y) - 8 - Math.random() * 5 };
      coin.animate([
        { left: `${from.x + jitter()}%`, top: `${from.y + jitter()}%`, transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
        { left: `${mid.x}%`, top: `${mid.y}%`, transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: 0.5 },
        { left: `${to.x}%`, top: `${to.y}%`, transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      ], { duration: 600, delay: i * 35, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'both' });
    }
    if (label) this.floatText(to, label, 'gold');
  }

  floatText(at, text, kind = 'plain') {
    if (!at) return;
    const el = this.spawn(h(`span.fx-float.${kind}`, { style: { left: `${at.x}%`, top: `${at.y}%` } }, text), 1300);
    el.animate([
      { transform: 'translate(-50%, -40%) scale(.7)', opacity: 0 },
      { transform: 'translate(-50%, -120%) scale(1)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -120%) scale(1)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%, -190%) scale(1)', opacity: 0 },
    ], { duration: 1100, delay: 250, easing: 'ease-out', fill: 'both' });
  }

  /** Eine welle in der farbe des spielers, der jetzt dran ist. */
  turn(color) {
    if (reduced()) return;
    this.spawn(h('span.fx-ring', { '--c': color }), 900);
  }

  /** Gekauft: kurzes siegel mit flagge, name und käufer. */
  buy(map, index, color, who) {
    const tile = map.tiles[index];
    if (!isOwnable(tile)) return;
    const group = tile.type === 'city' ? map.groups[tile.group] : null;
    const art = group ? artwork(group.flag, FLAGS) : artwork(tile.icon ?? tile.type, TILE_ICONS);
    const seal = this.spawn(h('div.fx-seal', { '--c': color },
      h('span.fx-seal-art', { html: art }),
      h('b', tile.name),
      h('small', `bought by ${who}`)), 1300);
    seal.animate([
      { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.15 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%,-50%) scale(.96)', opacity: 0 },
    ], { duration: 1200, easing: 'ease-out', fill: 'both' });
  }

  burst(at, color, n = 10) {
    if (!at || reduced()) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 4 + Math.random() * 3;
      const spark = this.spawn(h('span.fx-spark', { '--c': color, style: { left: `${at.x}%`, top: `${at.y}%` } }), 700);
      spark.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * r}cqw), calc(-50% + ${Math.sin(a) * r}cqw)) scale(.2)`, opacity: 0 },
      ], { duration: 550, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
    }
  }

  banner(text, kind, sub = '') {
    const el = this.spawn(h(`div.fx-banner.${kind}`, h('b', text), sub ? h('small', sub) : null), 1200);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.85)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.15 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%,-50%) scale(1.04)', opacity: 0 },
    ], { duration: 1100, easing: 'ease-out', fill: 'both' });
  }

  upgrade(index) {
    const at = this.tilePoint(index);
    this.burst(at, '#8dffb9', 8);
  }

  /** Was eine seite gibt, als kleine chips (straßen in gruppenfarbe, geld, karten). */
  parcel(map, side, color) {
    const chips = [
      side.money ? h('span.fx-chip.fx-chip-money', money(map, side.money)) : null,
      ...side.tiles.map(i => {
        const tile = map.tiles[i];
        return h('span.fx-chip', { '--g': tile.type === 'city' ? map.groups[tile.group].color : '#9aa4b8' }, tile.name);
      }),
      ...side.pardons.map(d => h('span.fx-chip.fx-chip-card', pardonName(map, d))),
    ].filter(Boolean);
    return h('div.fx-parcel', { '--c': color }, chips.length ? chips : h('span.fx-chip', 'nothing'));
  }

  /**
   * Handel: das server-logo im hintergrund, beide pakete steigen ins licht zwischen
   * den händen und landen beim anderen. Die inhalte stehen die ganze zeit lesbar da.
   */
  async trade(map, a, b, give, take) {
    if (reduced()) return;
    const D = 2600;
    const portal = h('img.fx-portal', { src: LOGO, alt: '' });
    const glow = h('span.fx-handshake-glow', { style: { left: '50%', top: '40%' } });
    const fromA = this.parcel(map, give, a.color);
    const fromB = this.parcel(map, take, b.color);
    const head = h('div.fx-trade-head', h('span.label', 'Trade'),
      h('b', h('span', { style: { color: a.color } }, a.name), ' ⇄ ', h('span', { style: { color: b.color } }, b.name)));
    const scene = this.spawn(h('div.fx-trade', portal, glow, head, fromA, fromB), D + 200);
    scene.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }], { duration: D, fill: 'both' });
    portal.animate([
      { transform: 'translate(-50%, -50%) scale(.92)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.9, offset: 0.2 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.9, offset: 0.85 },
      { transform: 'translate(-50%, -50%) scale(1.02)', opacity: 0 },
    ],
      { duration: D, easing: 'ease-out', fill: 'both' });
    // links -> rechts über das licht, rechts -> links darunter
    const travel = (from, to, lift) => [
      { left: `${from}%`, top: '60%', transform: 'translate(-50%,-50%) scale(.8)', opacity: 0 },
      { left: `${from}%`, top: '60%', transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.15 },
      { left: `${from}%`, top: '60%', transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.3 },
      { left: '50%', top: `${lift}%`, transform: 'translate(-50%,-50%) scale(1.06)', opacity: 1, offset: 0.55 },
      { left: `${to}%`, top: '60%', transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.8 },
      { left: `${to}%`, top: '60%', transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
    ];
    fromA.animate(travel(24, 76, 38), { duration: D, easing: 'ease-in-out', fill: 'both' });
    fromB.animate(travel(76, 24, 74), { duration: D, easing: 'ease-in-out', fill: 'both' });
    glow.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' }, { opacity: 0, offset: 0.45 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.55 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.4)', offset: 0.75 }, { opacity: 0 }],
      { duration: D, fill: 'both' });
    await wait(900);
  }
}
