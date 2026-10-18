// grundstückskarte, handel und statistik

import { h } from './dom.js';
import { FLAGS, TILE_ICONS, UI, artwork, pawnSvg } from './icons.js';
import { duration, groupTiles, inkOn, isOwnable, money, pardonName, word } from './format.js';
import { closeModal, openModal } from './modal.js';

const capital = text => text.charAt(0).toUpperCase() + text.slice(1);

// ---- grundstückskarte --------------------------------------------------------

export function tileDialog(view, index) {
  const { map } = view;
  const tile = map.tiles[index];
  if (!isOwnable(tile)) return;
  const render = () => {
    const game = view.room?.game;
    const state = game?.tiles[index] ?? null;
    const owner = state?.owner ? game.players.find(p => p.id === state.owner) : null;
    const group = tile.type === 'city' ? map.groups[tile.group] : null;
    const color = group?.color ?? 'var(--m-panel-3)';
    const level = state?.level ?? 0;
    const rows = [];
    if (tile.type === 'city') {
      const labels = ['Rent', `With 1 ${word(map, 'house', 'house')}`, `With 2 ${word(map, 'houses', 'houses')}`, `With 3 ${word(map, 'houses', 'houses')}`, `With 4 ${word(map, 'houses', 'houses')}`, `With ${word(map, 'hotel', 'hotel')}`];
      tile.rent.forEach((r, k) => rows.push([labels[k], money(map, r), k, owner && level === k]));
    } else if (tile.type === 'airport') {
      const owned = owner ? map.tiles.filter((t, i) => t.type === 'airport' && game.tiles[i]?.owner === owner.id).length : 0;
      tile.rent.forEach((r, k) => rows.push([`${k + 1} airport${k ? 's' : ''} owned`, money(map, r), k, owned === k + 1]));
    } else {
      const owned = owner ? map.tiles.filter((t, i) => t.type === 'company' && game.tiles[i]?.owner === owner.id).length : 0;
      tile.multipliers.forEach((m, k) => rows.push([`${k + 1} compan${k ? 'ies' : 'y'} owned`, `dice × ${m}`, k, owned === k + 1]));
    }
    const can = game?.can ?? {};
    const act = (type, extra) => view.act({ type, tile: index, ...extra });
    const half = Math.floor(tile.price / 2);
    const mine = owner && owner.id === view.me;
    const actions = mine ? [
      tile.type === 'city' && h('button.btn.btn-good', { disabled: !can.upgrade?.includes(index), onclick: () => act('upgrade') }, h('span.btn-icon', { html: UI.upgrade }), `Upgrade · ${money(map, tile.house)}`),
      tile.type === 'city' && h('button.btn', { disabled: !can.downgrade?.includes(index), onclick: () => act('downgrade') }, h('span.btn-icon', { html: UI.downgrade }), `Downgrade · +${money(map, Math.floor(tile.house / 2))}`),
      h('button.btn', { disabled: !can.sell?.includes(index), onclick: () => act('sell') }, h('span.btn-icon', { html: UI.sell }), `Sell · +${money(map, state.mortgaged ? 0 : half)}`),
      view.room.settings.mortgage && (state.mortgaged
        ? h('button.btn', { disabled: !can.unmortgage?.includes(index), onclick: () => act('unmortgage') }, h('span.btn-icon', { html: UI.mortgage }), `Lift mortgage · ${money(map, game.unmortgageCosts?.[index] ?? Math.floor(half * 1.1))}`)
        : h('button.btn', { disabled: !can.mortgage?.includes(index), onclick: () => act('mortgage') }, h('span.btn-icon', { html: UI.mortgage }), `Mortgage · +${money(map, half)}`)),
    ] : [];
    const groupMembers = group ? groupTiles(map, tile.group) : [];
    return h('div.deed', { '--group': color, '--group-ink': group ? inkOn(group.color) : 'var(--m-text)' },
      h('div.deed-head',
        group ? h('span.deed-flag', { html: artwork(group.flag, FLAGS) }) : h('span.deed-icon', { html: artwork(tile.icon ?? tile.type, TILE_ICONS) }),
        h('div.deed-title', h('h2', tile.name), h('span.deed-price', money(map, tile.price))),
      ),
      groupMembers.length ? h('div.deed-set', groupMembers.map(i => {
        const s = game?.tiles[i];
        const o = s?.owner ? game.players.find(p => p.id === s.owner) : null;
        return h('span.deed-set-item', { class: i === index ? 'is-this' : '', '--owner': o?.appearance?.color ?? 'transparent', title: o ? `${map.tiles[i].name}: ${o.name}` : `${map.tiles[i].name}: for sale` }, map.tiles[i].name);
      })) : null,
      h('table.deed-rent', h('tbody', rows.map(([label, value, k, now]) => h('tr', { class: now ? 'is-now' : '' },
        h('td', h('span.deed-label', tile.type === 'city' && k > 0 ? h('span.deed-levels', k === 5 ? h('i.level-full', '★') : Array.from({ length: k }, () => h('i.level'))) : null, label)),
        h('td.num', value))))),
      h('dl.deed-facts',
        tile.type === 'city' ? [h('dt', `${capital(word(map, 'house', 'house'))} cost`), h('dd', money(map, tile.house))] : null,
        h('dt', 'Mortgage value'), h('dd', money(map, half)),
        h('dt', 'Owner'), h('dd', owner ? h('span.deed-owner', h('span.mini-pawn', { html: pawnSvg(owner.appearance?.shape, owner.appearance?.color) }), owner.name) : 'For sale'),
        state?.mortgaged ? [h('dt', 'Status'), h('dd.bad', 'Mortgaged: no rent')] : null,
      ),
      actions.length ? h('div.deed-actions', actions) : null,
      mine ? null : h('p.hint', owner ? 'Click on a property to see its price and rent payments.' : 'Land on it to buy it.'),
    );
  };
  const modal = openModal({ title: tile.name, className: 'modal-deed', body: render(), onClose: () => { view.refreshDialog = null; } });
  view.refreshDialog = () => modal.panel.querySelector('.modal-body').replaceChildren(render());
}

// ---- handel -----------------------------------------------------------------

function sideSummary(map, game, side) {
  const items = [
    side.money ? h('span.trade-chip.trade-money', money(map, side.money)) : null,
    ...side.tiles.map(i => {
      const t = map.tiles[i];
      return h('span.trade-chip', { '--group': t.type === 'city' ? map.groups[t.group].color : 'var(--m-muted)' }, t.name, game.tiles[i]?.mortgaged ? ' (mortgaged)' : '');
    }),
    ...side.pardons.map(d => h('span.trade-chip.trade-card', pardonName(map, d))),
  ].filter(Boolean);
  return items.length ? items : [h('span.faint', 'nothing')];
}

export function tradeSummary(view, trade) {
  const { map } = view;
  const game = view.room.game;
  const from = game.players.find(p => p.id === trade.from);
  const to = game.players.find(p => p.id === trade.to);
  return h('div.trade-summary',
    h('div.trade-side', h('span.label', `${from?.name ?? '?'} gives`), h('div.trade-chips', sideSummary(map, game, trade.give))),
    h('span.trade-arrow', { html: UI.trade }),
    h('div.trade-side', h('span.label', `${to?.name ?? '?'} gives`), h('div.trade-chips', sideSummary(map, game, trade.take))),
    trade.note ? h('p.trade-note', `“${trade.note}”`) : null,
  );
}

export function viewTradeDialog(view, trade) {
  const incoming = trade.to === view.me;
  const from = view.room.game.players.find(p => p.id === trade.from);
  openModal({
    title: incoming ? `Trade offer from ${from?.name}` : 'Your trade offer',
    className: 'modal-trade',
    body: [
      tradeSummary(view, trade),
      h('div.modal-actions',
        incoming ? h('button.btn.btn-good', { onclick: () => view.act({ type: 'tradeAccept', id: trade.id }).then(ok => ok && closeModal()) }, 'Accept') : null,
        h('button.btn', { onclick: () => view.act({ type: 'tradeDecline', id: trade.id }).then(ok => ok && closeModal()) }, incoming ? 'Decline' : 'Cancel offer'),
      ),
    ],
  });
}

export function createTradeDialog(view, otherId) {
  const { map } = view;
  const game = view.room.game;
  const me = game.players.find(p => p.id === view.me);
  const others = game.players.filter(p => !p.bankrupt && p.id !== view.me);
  if (!me || !others.length) return;
  let other = others.find(p => p.id === otherId) ?? others[0];
  const offer = { give: { money: 0, tiles: new Set(), pardons: new Set() }, take: { money: 0, tiles: new Set(), pardons: new Set() } };
  let note = '';

  const tradable = playerId => game.tiles.flatMap((t, i) => {
    if (t?.owner !== playerId) return [];
    const tile = map.tiles[i];
    const built = tile.type === 'city' && groupTiles(map, tile.group).some(j => game.tiles[j].level > 0);
    return built ? [] : [i];
  });

  const column = (player, side) => {
    const sideOffer = offer[side];
    const tiles = tradable(player.id);
    const moneyInput = h('input.input', { type: 'number', min: 0, max: player.money, step: 10, value: sideOffer.money || '', placeholder: '0', inputmode: 'numeric',
      oninput: e => { sideOffer.money = Math.max(0, Math.min(player.money, Math.floor(Number(e.target.value) || 0))); } });
    return h('div.trade-col',
      h('div.trade-col-head', h('span.mini-pawn', { html: pawnSvg(player.appearance?.shape, player.appearance?.color) }), h('b', side === 'give' ? 'You give' : `${player.name} gives`), h('span.faint.num', money(map, player.money))),
      h('label.field', h('span.label', `Money (${map.words?.currency ?? '$'})`), moneyInput),
      h('div.trade-tiles', tiles.length ? tiles.map(i => {
        const tile = map.tiles[i];
        const btn = h('button.trade-tile', { type: 'button', class: sideOffer.tiles.has(i) ? 'is-on' : '', '--group': tile.type === 'city' ? map.groups[tile.group].color : 'var(--m-muted)',
          onclick: () => { sideOffer.tiles.has(i) ? sideOffer.tiles.delete(i) : sideOffer.tiles.add(i); btn.classList.toggle('is-on'); } },
        tile.name, game.tiles[i].mortgaged ? h('small', ' mortgaged') : null);
        return btn;
      }) : h('p.faint', 'No tradable properties')),
      player.pardons.length ? h('div.trade-tiles', player.pardons.map(d => {
        const btn = h('button.trade-tile.trade-card', { type: 'button', onclick: () => { sideOffer.pardons.has(d) ? sideOffer.pardons.delete(d) : sideOffer.pardons.add(d); btn.classList.toggle('is-on'); } }, pardonName(map, d));
        return btn;
      })) : null,
    );
  };

  const body = h('div.trade-builder');
  const draw = () => body.replaceChildren(
    h('div.trade-pick', h('span.label', 'Trade with'), h('div.seg', others.map(p => h('button.seg-btn', { type: 'button', class: p.id === other.id ? 'is-on' : '',
      onclick: () => { other = p; offer.take = { money: 0, tiles: new Set(), pardons: new Set() }; draw(); } }, h('span.mini-pawn', { html: pawnSvg(p.appearance?.shape, p.appearance?.color) }), p.name)))),
    h('div.trade-cols', column(me, 'give'), column(other, 'take')),
    h('label.field', h('span.label', 'Note (optional)'), h('input.input', { maxlength: 140, value: note, placeholder: 'Make them an offer they cannot refuse', oninput: e => { note = e.target.value; } })),
    h('div.modal-actions',
      h('button.btn.btn-primary', { onclick: async () => {
        const side = s => ({ money: s.money, tiles: [...s.tiles], pardons: [...s.pardons] });
        if (await view.act({ type: 'tradeCreate', to: other.id, give: side(offer.give), take: side(offer.take), note })) closeModal();
      } }, h('span.btn-icon', { html: UI.trade }), 'Send offer'),
    ),
  );
  draw();
  openModal({ title: 'Create a trade', className: 'modal-trade', body });
}

// ---- statistik ---------------------------------------------------------------

function netWorthChart(game) {
  const points = game.stats.netWorth;
  if (points.length < 2) return h('p.faint', 'Not enough data yet.');
  const W = 560;
  const H = 200;
  const max = Math.max(1, ...points.flatMap(p => Object.values(p.values)));
  const x = i => (i / (points.length - 1)) * W;
  const y = v => H - (v / max) * (H - 12) - 6;
  const lines = game.players.map(p => {
    const d = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(pt.values[p.id] ?? 0).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${p.appearance?.color ?? '#999'}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="currentColor" opacity=".12"/>`).join('');
  return h('div.chart', { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Net worth over time">${grid}${lines}</svg>` });
}

export function statsDialog(view) {
  const game = view.room.game ?? null;
  if (!game) return;
  const { map } = view;
  const stats = game.stats;
  const prisoner = Object.entries(stats.prisonVisits).sort((a, b) => b[1] - a[1])[0];
  const prisonerName = prisoner && prisoner[1] > 0 ? game.players.find(p => p.id === prisoner[0])?.name : null;
  const hot = stats.heat.map((n, i) => [i, n]).filter(([i]) => map.tiles[i].type !== 'corner').sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxHeat = hot[0]?.[1] || 1;
  openModal({
    title: 'Game statistics',
    className: 'modal-stats',
    body: [
      h('div.stat-grid',
        h('div.stat', h('span.label', 'Duration'), h('b', duration((stats.endedAt ?? Date.now()) - stats.startedAt))),
        h('div.stat', h('span.label', 'Turns'), h('b', stats.turns)),
        h('div.stat', h('span.label', 'Doubles'), h('b', stats.doubles)),
        h('div.stat', h('span.label', 'Trades'), h('b', stats.trades)),
        h('div.stat', h('span.label', 'Auctions'), h('b', stats.auctions)),
        h('div.stat', h('span.label', `Most times in ${word(map, 'prison', 'prison')}`), h('b', prisonerName ? `${prisonerName} (${prisoner[1]})` : 'nobody')),
      ),
      h('h3', 'Net worth over time'),
      netWorthChart(game),
      h('div.chart-legend', game.players.map(p => h('span', h('i', { style: { background: p.appearance?.color } }), p.name))),
      h('h3', 'Most visited'),
      h('ol.heat', hot.map(([i, n]) => h('li', h('span', map.tiles[i].name), h('span.heat-bar', h('i', { style: { width: `${(n / maxHeat) * 100}%` } })), h('span.num', n)))),
      h('div.modal-actions', h('button.btn', { onclick: closeModal }, 'Back to board')),
    ],
  });
}
