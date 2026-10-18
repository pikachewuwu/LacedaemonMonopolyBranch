// entscheidungen für bots und für spieler, deren zeit abgelaufen ist (passive = nur das nötigste)

const RESERVE = 150;
const memory = new WeakMap();

function remember(game, playerId) {
  if (!memory.has(game)) memory.set(game, {});
  const all = memory.get(game);
  return (all[playerId] ??= { asked: {} });
}

/** Nächste aktion für den spieler, oder null wenn er gerade nichts tun muss. */
export function botAction(game, playerId, { passive = false } = {}) {
  const p = game.player(playerId);
  if (!p || p.bankrupt || game.phase !== 'playing') return null;

  if (game.debtOf(p.id) > 0) return raiseFunds(game, p) ?? { type: 'bankrupt' };

  if (!passive) {
    const offer = game.trades.find(t => t.to === p.id);
    if (offer) return { type: acceptsTrade(game, p, offer) ? 'tradeAccept' : 'tradeDecline', id: offer.id };
  }

  if (game.auction) return passive ? null : auctionBid(game, p);
  if (game.turn.playerId !== p.id || game.debts.length) return null;

  if (!passive && (game.turn.phase === 'roll' || game.turn.phase === 'done')) {
    const proposal = tradeProposal(game, p);
    if (proposal) return proposal;
  }

  switch (game.turn.phase) {
    case 'roll':
      if (!passive && p.prisonTurns > 0 && game.turn.rolls === 0) {
        if (p.pardons.length) return { type: 'usePardon', deck: p.pardons[0] };
        const freeLeft = game.tiles.filter(t => t && t.owner === null).length;
        if (freeLeft > 8 && p.money > 400) return { type: 'payPrison' };
      }
      return { type: 'roll' };
    case 'buy':
      return !passive && wantsToBuy(game, p) ? { type: 'buy' } : { type: 'decline' };
    case 'done': {
      if (!passive) {
        const build = bestUpgrade(game, p);
        if (build !== null) return { type: 'upgrade', tile: build };
        const lift = game.permissions(p.id).unmortgage.find(i => p.money - game.unmortgageCost(i) > 500);
        if (lift !== undefined) return { type: 'unmortgage', tile: lift };
      }
      return { type: 'endTurn' };
    }
    default:
      return null;
  }
}

/** Würde dieses grundstück eine gruppe vervollständigen oder einem gegner eine verbauen? */
function setInterest(game, p, index) {
  const tile = game.map.tiles[index];
  if (tile.type !== 'city') return 1;
  const group = game.info.groups[tile.group];
  const mine = group.filter(i => i !== index && game.tiles[i].owner === p.id).length;
  const others = group.filter(i => i !== index && game.tiles[i].owner && game.tiles[i].owner !== p.id);
  if (mine === group.length - 1) return 1.6;
  if (others.length === group.length - 1 && new Set(others.map(i => game.tiles[i].owner)).size === 1) return 1.3;
  return mine > 0 ? 1.15 : 1;
}

function wantsToBuy(game, p) {
  const tile = game.map.tiles[p.position];
  const interest = setInterest(game, p, p.position);
  const reserve = interest >= 1.3 ? 0 : game.round < 6 ? 60 : RESERVE;
  return p.money - tile.price >= reserve;
}

function auctionBid(game, p) {
  const a = game.auction;
  if (a.bidderId === p.id) return null;
  const tile = game.map.tiles[a.tile];
  const limit = Math.min(Math.floor(tile.price * 0.9 * setInterest(game, p, a.tile)), p.money - RESERVE);
  const step = a.bid < 100 ? 10 : a.bid < 400 ? 20 : 50;
  const next = a.bid + step;
  if (next > limit) return null;
  return { type: 'bid', amount: next };
}

function bestUpgrade(game, p) {
  const can = game.permissions(p.id).upgrade;
  const affordable = can.filter(i => p.money - game.map.tiles[i].house >= RESERVE + 100);
  if (!affordable.length) return null;
  return affordable.sort((a, b) => game.tiles[a].level - game.tiles[b].level || game.map.tiles[b].price - game.map.tiles[a].price)[0];
}

/** Geld auftreiben: erst bauten verkaufen, dann hypotheken, dann einzelne grundstücke. */
export function raiseFunds(game, p) {
  const can = game.permissions(p.id);
  if (can.downgrade.length) {
    return { type: 'downgrade', tile: can.downgrade.sort((a, b) => game.map.tiles[a].price - game.map.tiles[b].price)[0] };
  }
  const cheapest = list => list.sort((a, b) => setInterest(game, p, a) - setInterest(game, p, b) || game.map.tiles[a].price - game.map.tiles[b].price)[0];
  if (can.mortgage.length) return { type: 'mortgage', tile: cheapest(can.mortgage) };
  if (can.sell.length) return { type: 'sell', tile: cheapest(can.sell.filter(i => !game.tiles[i].mortgaged).length ? can.sell.filter(i => !game.tiles[i].mortgaged) : can.sell) };
  return null;
}

/** Fehlt genau ein feld zu einer gruppe? Dann ein angebot machen, das mit der zeit besser wird. */
function tradeProposal(game, p) {
  if (game.trades.some(t => t.from === p.id)) return null;
  const mem = remember(game, p.id);
  for (const [group, indices] of Object.entries(game.info.groups)) {
    const missing = indices.filter(i => game.tiles[i].owner !== p.id);
    if (missing.length !== 1 || indices.some(i => game.tiles[i].mortgaged)) continue;
    const want = missing[0];
    const owner = game.tiles[want].owner ? game.player(game.tiles[want].owner) : null;
    if (!owner || owner.bankrupt || game.teammates(p.id, owner.id) || game.setHasBuildings(want)) continue;
    const asked = mem.asked[want] ?? { turn: -99, tries: 0 };
    if (game.stats.turns - asked.turn < 6) continue;
    const price = game.map.tiles[want].price;
    // ein feld anbieten, das dem anderen seine gruppe vervollständigt
    const sweetener = game.owned(p.id).find(i => game.map.tiles[i].type === 'city' && game.map.tiles[i].group !== group
      && !game.setHasBuildings(i) && game.info.groups[game.map.tiles[i].group].every(j => j === i || game.tiles[j].owner === owner.id));
    const factor = Math.min(1.4 + asked.tries * 0.3, 2.6);
    const cash = Math.min(Math.round(price * factor), Math.max(p.money - RESERVE, 0));
    mem.asked[want] = { turn: game.stats.turns, tries: asked.tries + 1 };
    if (sweetener === undefined && cash < price) continue;
    const give = sweetener !== undefined ? { tiles: [sweetener], money: Math.max(0, Math.min(cash, price - game.map.tiles[sweetener].price)) } : { money: cash };
    const offer = { type: 'tradeCreate', to: owner.id, give, take: { tiles: [want] } };
    try {
      game.checkFairness(p, game.normalizeSide(give), game.normalizeSide(offer.take));
    } catch {
      continue;
    }
    return offer;
  }
  return null;
}

function acceptsTrade(game, p, trade) {
  const gets = game.sideValue(trade.give);
  const gives = game.sideValue(trade.take);
  const handsOverSet = trade.take.tiles.some(i => {
    const tile = game.map.tiles[i];
    if (tile.type !== 'city') return false;
    return game.info.groups[tile.group].every(j => game.tiles[j].owner === trade.from || trade.take.tiles.includes(j));
  });
  const completesMine = trade.give.tiles.some(i => setInterest(game, p, i) >= 1.6);
  if (completesMine && gets * 1.3 >= gives) return true;
  return gets >= gives * (handsOverSet ? 1.8 : 1.2) && trade.take.money <= p.money;
}
