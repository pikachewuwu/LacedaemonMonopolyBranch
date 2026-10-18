// effekte über dem brett: münzen, siegel, wellen, banner und der handschlag beim handel

import { h, wait } from './dom.js';
import { FLAGS, LOGO, TILE_ICONS, artwork } from './icons.js';
import { isOwnable, money } from './format.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Fx {
  constructor(board) {
    this.board = board;
    this.layer = h('div.fx-layer');
    this.ambient = h('div.center-ambient', Array.from({ length: 14 }, (_, k) => h('i', {
      '--x': `${(k * 37) % 100}%`, '--d': `${9 + (k * 7) % 9}s`, '--delay': `${-(k * 1.7) % 9}s`, '--s': `${0.5 + ((k * 13) % 10) / 10}`,
    })));
    board.el.append(this.layer);
    board.center.prepend(this.ambient);
  }

  /** Mittelpunkt eines felds oder einer figur in prozent des bretts. */
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

  /** Münzen fliegen im bogen von a nach b. */
  coins(from, to, count = 8, label = '') {
    if (!from || !to || reduced()) return;
    for (let i = 0; i < count; i++) {
      const coin = this.spawn(h('span.fx-coin', '🐉'), 1600);
      const lift = 10 + Math.random() * 8;
      const jitter = () => (Math.random() - 0.5) * 3;
      const mid = { x: (from.x + to.x) / 2 + jitter(), y: Math.min(from.y, to.y) - lift };
      coin.animate([
        { left: `${from.x + jitter()}%`, top: `${from.y + jitter()}%`, transform: 'translate(-50%,-50%) scale(.3) rotate(0deg)', opacity: 0 },
        { left: `${mid.x}%`, top: `${mid.y}%`, transform: 'translate(-50%,-50%) scale(1.15) rotate(200deg)', opacity: 1, offset: 0.5 },
        { left: `${to.x}%`, top: `${to.y}%`, transform: 'translate(-50%,-50%) scale(.5) rotate(380deg)', opacity: 0.2 },
      ], { duration: 900 + i * 45, delay: i * 55, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'both' });
    }
    if (label) this.floatText(to, label, 'gold');
  }

  floatText(at, text, kind = '') {
    if (!at) return;
    const el = this.spawn(h(`span.fx-float.${kind || 'plain'}`, { style: { left: `${at.x}%`, top: `${at.y}%` } }, text), 1700);
    el.animate([
      { transform: 'translate(-50%, -20%) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%, -110%) scale(1.08)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -240%) scale(1)', opacity: 0 },
    ], { duration: 1600, delay: 500, easing: 'ease-out', fill: 'both' });
  }

  /** Wellen im mittelfeld in der farbe des spielers, der dran ist. */
  turn(color) {
    if (reduced()) return;
    for (let i = 0; i < 3; i++) {
      this.spawn(h('span.fx-ring', { '--c': color, style: { animationDelay: `${i * 180}ms` } }), 1600);
    }
  }

  /** Gekauft: siegel mit flagge und name. */
  buy(map, index, color, who) {
    const tile = map.tiles[index];
    if (!isOwnable(tile)) return;
    const group = tile.type === 'city' ? map.groups[tile.group] : null;
    const art = group ? artwork(group.flag, FLAGS) : artwork(tile.icon ?? tile.type, TILE_ICONS);
    const seal = this.spawn(h('div.fx-seal', { '--c': color, '--g': group?.color ?? color },
      h('span.fx-seal-art', { html: art }),
      h('b', tile.name),
      h('small', `${who} · SOLD`)), 2300);
    seal.animate([
      { transform: 'translate(-50%,-50%) scale(2.2) rotate(-14deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(.94) rotate(-6deg)', opacity: 1, offset: 0.16 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(-6deg)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%,-60%) scale(.9) rotate(-6deg)', opacity: 0 },
    ], { duration: 2200, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    this.burst(this.tilePoint(index), color);
  }

  burst(at, color, n = 14) {
    if (!at || reduced()) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 5 + Math.random() * 4;
      const spark = this.spawn(h('span.fx-spark', { '--c': color, style: { left: `${at.x}%`, top: `${at.y}%` } }), 900);
      spark.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * r}cqw), calc(-50% + ${Math.sin(a) * r}cqw)) scale(.2)`, opacity: 0 },
      ], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
    }
  }

  banner(text, kind, sub = '') {
    const el = this.spawn(h(`div.fx-banner.${kind}`, h('b', text), sub ? h('small', sub) : null), 2000);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0, filter: 'blur(6px)' },
      { transform: 'translate(-50%,-50%) scale(1.04)', opacity: 1, filter: 'blur(0)', offset: 0.18 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.78 },
      { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 0, filter: 'blur(4px)' },
    ], { duration: 1900, easing: 'ease-out', fill: 'both' });
  }

  upgrade(index, color) {
    const at = this.tilePoint(index);
    this.burst(at, '#8dffb9', 10);
    this.floatText(at, '▲', 'good');
    void color;
  }

  /**
   * Handel: das server-logo erscheint, beide angebote steigen ins licht zwischen den händen,
   * kreisen umeinander und landen beim jeweils anderen.
   */
  async trade(map, a, b, give, take) {
    if (reduced()) return;
    const summary = side => [
      side.money ? money(map, side.money) : null,
      ...side.tiles.map(i => map.tiles[i].name),
      ...side.pardons.map(() => 'Pardon card'),
    ].filter(Boolean).join(', ') || 'nothing';
    const light = { x: 50, y: 37 };
    const portal = h('img.fx-portal', { src: LOGO, alt: '' });
    const glow = h('span.fx-handshake-glow', { style: { left: `${light.x}%`, top: `${light.y}%` } });
    const halo = h('span.fx-halo', { style: { left: `${light.x}%`, top: `${light.y}%` } });
    const orbA = h('span.fx-orb', { '--c': a.color });
    const orbB = h('span.fx-orb', { '--c': b.color });
    const tagA = h('span.fx-tag.left', { '--c': a.color }, a.name);
    const tagB = h('span.fx-tag.right', { '--c': b.color }, b.name);
    const caption = h('div.fx-trade-caption',
      h('span.label', 'Trade complete'),
      h('div.fx-trade-sides',
        h('span', h('b', { style: { color: a.color } }, a.name), h('small', summary(give))),
        h('i', '⇄'),
        h('span', h('b', { style: { color: b.color } }, b.name), h('small', summary(take)))));
    const scene = this.spawn(h('div.fx-trade', portal, halo, glow, tagA, tagB, orbA, orbB, caption), 5000);
    const D = 4600;
    scene.animate([{ opacity: 0 }, { opacity: 1, offset: 0.07 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { duration: D, fill: 'both' });
    portal.animate([
      { transform: 'translate(-50%, -50%) scale(.7)', opacity: 0, filter: 'blur(8px) saturate(.6)' },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, filter: 'blur(0) saturate(1)', offset: 0.18 },
      { transform: 'translate(-50%, -50%) scale(1.03)', opacity: 1, offset: 0.82 },
      { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 0, filter: 'blur(6px)' },
    ], { duration: D, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    halo.animate([{ opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: 1, offset: 0.35 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: D, fill: 'both' });
    // die angebote: von der eigenen seite hinauf ins licht, umkreisen, hinüber zum anderen
    const path = (from, to, phase) => {
      const ring = (t, r) => ({ left: `${light.x + Math.cos(t + phase) * r}%`, top: `${light.y + Math.sin(t + phase) * r * 0.7}%` });
      return [
        { left: `${from}%`, top: '58%', transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
        { left: `${from}%`, top: '58%', transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.16 },
        { ...ring(0, 7), transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: 0.36 },
        { ...ring(Math.PI * 0.7, 5), transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: 0.46 },
        { ...ring(Math.PI * 1.4, 3), transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1, offset: 0.54 },
        { ...ring(Math.PI * 2.1, 5), transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1, offset: 0.62 },
        { left: `${to}%`, top: '58%', transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.8 },
        { left: `${to}%`, top: '58%', transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 },
      ];
    };
    orbA.animate(path(18, 82, Math.PI), { duration: D, easing: 'ease-in-out', fill: 'both' });
    orbB.animate(path(82, 18, 0), { duration: D, easing: 'ease-in-out', fill: 'both' });
    glow.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.2)' }, { opacity: 0, offset: 0.5 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.57 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.8)', offset: 0.8 }, { opacity: 0 }],
      { duration: D, easing: 'ease-out', fill: 'both' });
    for (const tag of [tagA, tagB]) tag.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: D, fill: 'both' });
    caption.animate([{ opacity: 0, transform: 'translate(-50%, 20%)' }, { opacity: 0, offset: 0.6 }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.7 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }],
      { duration: D, fill: 'both' });
    setTimeout(() => this.burst(light, '#fff4d6', 18), D * 0.56);
    await wait(1800);
  }
}
