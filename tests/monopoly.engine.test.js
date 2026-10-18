import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMaps } from '../src/modules/monopoly/maps/index.js';
import { MonopolyGame } from '../src/modules/monopoly/engine/game.js';
import { botAction } from '../src/modules/monopoly/engine/bots.js';
import { createSettings } from '../src/modules/monopoly/settings.js';

const maps = loadMaps();
const map = maps.get('lacedaemon');
const PLAYERS = [{ id: 'a', name: 'Ari' }, { id: 'b', name: 'Bea' }, { id: 'c', name: 'Cy' }];

function newGame(settings = {}, players = PLAYERS) {
  let t = 0;
  return new MonopolyGame({ map, settings: createSettings({ shufflePlayerOrder: false, ...settings }, [...maps.keys()]), players, seed: 7, now: () => (t += 1000) });
}

/** Würfel festlegen: jeder wurf ist [a, b]. */
function rig(game, ...rolls) {
  const values = rolls.flat().map(v => (v - 1) / 6 + 0.01);
  game.rand = () => values.shift() ?? 0.5;
}

test('die lacedaemon-map hat 40 felder und die vorgegebenen namen', () => {
  assert.equal(map.tiles.length, 40);
  assert.equal(map.tiles[0].name, '=collect');
  assert.equal(map.tiles[19].name, 'Debait');
  assert.equal(map.tiles[39].name, 'securo');
  assert.equal(map.tiles[35].name, 'OpenBSD');
  assert.equal(map.tiles[24 + 2].name, 'slot');
  assert.equal(map.tiles[29].name, 'casino');
  assert.equal(map.groups.germany.color, '#79678a');
  assert.equal(map.cards.treasure.length, 17);
  assert.equal(map.cards.surprise.length, 17);
});

test('würfeln, laufen, kaufen und miete', () => {
  const g = newGame();
  rig(g, [1, 2]);
  g.act('a', { type: 'roll' });
  assert.equal(g.player('a').position, 3);
  assert.equal(g.turn.phase, 'buy');
  g.act('a', { type: 'buy' });
  assert.equal(g.player('a').money, 1440);
  g.act('a', { type: 'endTurn' });
  rig(g, [2, 1]);
  g.act('b', { type: 'roll' });
  assert.equal(g.player('b').money, 1496);
  assert.equal(g.player('a').money, 1444);
});

test('über =collect: 200 beim vorbeigehen, 300 beim landen', () => {
  const g = newGame();
  g.player('a').position = 36;
  rig(g, [3, 1]);
  g.act('a', { type: 'roll' });
  assert.equal(g.player('a').position, 0);
  assert.equal(g.player('a').money, 1800);
  g.act('a', { type: 'endTurn' });
  g.player('b').position = 38;
  rig(g, [2, 3]);
  g.act('b', { type: 'roll' });
  assert.equal(g.player('b').money, 1700);
});

test('pasch erlaubt nochmal, dreimal pasch führt in die backrooms', () => {
  const g = newGame();
  rig(g, [1, 1], [2, 2], [3, 3]);
  g.act('a', { type: 'roll' });
  if (g.turn.phase === 'buy') g.act('a', { type: 'decline' });
  assert.equal(g.turn.phase, 'roll');
  g.act('a', { type: 'roll' });
  if (g.turn.phase === 'buy') g.act('a', { type: 'decline' });
  g.act('a', { type: 'roll' });
  assert.equal(g.player('a').position, 10);
  assert.equal(g.player('a').prisonTurns, 3);
  assert.equal(g.turn.phase, 'done');
});

test('backrooms: freikaufen kostet 50, nach drei fehlversuchen frei', () => {
  const g = newGame();
  g.sendToPrison(g.player('a'));
  g.act('a', { type: 'payPrison' });
  assert.equal(g.player('a').money, 1450);
  assert.equal(g.player('a').prisonTurns, 0);

  const h = newGame();
  h.sendToPrison(h.player('a'));
  for (let i = 0; i < 3; i++) {
    rig(h, [1, 2]);
    h.act('a', { type: 'roll' });
    assert.equal(h.player('a').position, 10);
    h.turn = h.freshTurn('a', 1);
  }
  assert.equal(h.player('a').prisonTurns, 0);
});

test('steuern: 10 % vom bargeld und pauschal 75', () => {
  const g = newGame();
  rig(g, [1, 3]);
  g.act('a', { type: 'roll' });
  assert.equal(g.player('a').money, 1350);
  g.act('a', { type: 'endTurn' });
  g.player('b').position = 34;
  rig(g, [1, 3]);
  g.act('b', { type: 'roll' });
  assert.equal(g.player('b').money, 1425);
});

test('gleichmäßig bauen, abreißen und hypotheken', () => {
  const g = newGame({ mortgage: true });
  const a = g.player('a');
  g.tiles[1].owner = 'a';
  g.tiles[3].owner = 'a';
  g.act('a', { type: 'upgrade', tile: 1 });
  assert.throws(() => g.act('a', { type: 'upgrade', tile: 1 }), /evenly/);
  g.act('a', { type: 'upgrade', tile: 3 });
  assert.equal(a.money, 1400);
  assert.equal(g.rentFor(3), 20);
  assert.throws(() => g.act('a', { type: 'mortgage', tile: 1 }), /buildings/);
  g.act('a', { type: 'downgrade', tile: 1 });
  g.act('a', { type: 'downgrade', tile: 3 });
  assert.equal(a.money, 1450);
  g.act('a', { type: 'mortgage', tile: 1 });
  assert.equal(a.money, 1480);
  assert.equal(g.rentFor(1), 0);
  assert.throws(() => g.act('a', { type: 'upgrade', tile: 3 }), /mortgaged/);
  g.act('a', { type: 'unmortgage', tile: 1 });
  assert.equal(a.money, 1447);
});

test('flughäfen und provider: miete nach anzahl', () => {
  const g = newGame();
  g.tiles[5].owner = 'a';
  g.tiles[15].owner = 'a';
  assert.equal(g.rentFor(5), 50);
  g.tiles[12].owner = 'b';
  g.tiles[27].owner = 'b';
  assert.equal(g.rentFor(12, 8), 80);
});

test('doppelte miete auf volle gruppe nur ohne upgrades und nur mit regel', () => {
  const g = newGame({ payDoubleRentWhenOwnFullSet: true });
  g.tiles[1].owner = 'a';
  g.tiles[3].owner = 'a';
  assert.equal(g.rentFor(1), 4);
  g.tiles[1].level = 1;
  assert.equal(g.rentFor(1), 10);
});

test('schulden, liquidation und bankrott', () => {
  const g = newGame();
  const b = g.player('b');
  g.tiles[39].owner = 'a';
  g.tiles[39].level = 5;
  g.tiles[37].owner = 'a';
  g.tiles[1].owner = 'b';
  b.money = 100;
  // b landet direkt auf securo
  g.turn = g.freshTurn('b', 2);
  b.position = 35;
  rig(g, [2, 2]);
  g.act('b', { type: 'roll' });
  assert.equal(g.debtOf('b'), 1900);
  assert.throws(() => g.act('b', { type: 'roll' }), /debt/);
  g.act('b', { type: 'sell', tile: 1 });
  assert.equal(g.debtOf('b'), 1870);
  g.act('b', { type: 'bankrupt' });
  assert.equal(b.bankrupt, true);
  assert.equal(g.tiles[1].owner, null);
  assert.equal(g.turn.playerId, 'c');
});

test('karten: pardon wird übersprungen, solange jemand sie hält', () => {
  const g = newGame();
  const deck = g.decks.treasure;
  const pardon = deck.cards.findIndex(c => c.effect.type === 'pardon');
  deck.order = [pardon, 1];
  deck.index = 0;
  g.draw(g.player('a'), 'treasure');
  assert.deepEqual(g.player('a').pardons, ['treasure']);
  g.draw(g.player('b'), 'treasure');
  assert.equal(g.player('b').money, 1700);
});

test('karten-text wird 1:1 übernommen', () => {
  const g = newGame();
  const deck = g.decks.surprise;
  deck.order = [deck.cards.findIndex(c => c.text === 'Advance to lizard-news.')];
  g.player('a').position = 22;
  g.draw(g.player('a'), 'surprise');
  assert.equal(g.card.text, 'Advance to lizard-news.');
  assert.equal(g.player('a').position, 24);
});

test('verrückte karten nur mit der einstellung', () => {
  assert.equal(newGame().decks.surprise.cards.length, 17);
  assert.equal(newGame({ crazyCards: true }).decks.surprise.cards.length, 27);
});

test('handel tauscht grundstücke und geld', () => {
  const g = newGame();
  g.tiles[1].owner = 'a';
  g.tiles[3].owner = 'b';
  g.act('a', { type: 'tradeCreate', to: 'b', give: { money: 100 }, take: { tiles: [3] } });
  const id = g.trades[0].id;
  g.act('b', { type: 'tradeAccept', id });
  assert.equal(g.tiles[3].owner, 'a');
  assert.equal(g.player('b').money, 1600);
  assert.throws(() => g.act('a', { type: 'tradeCreate', to: 'b', give: {}, take: {} }), /empty/);
  assert.throws(() => g.act('a', { type: 'tradeCreate', to: 'b', give: { money: 1390 }, take: {} }), /too much/);
});

test('auktion: höchstes gebot gewinnt', () => {
  const g = newGame({ auction: true });
  rig(g, [1, 2]);
  g.act('a', { type: 'roll' });
  g.act('a', { type: 'decline' });
  assert.ok(g.auction);
  g.act('b', { type: 'bid', amount: 20 });
  assert.throws(() => g.act('c', { type: 'bid', amount: 20 }), /higher/);
  g.act('c', { type: 'bid', amount: 35 });
  g.finishAuction();
  assert.equal(g.tiles[3].owner, 'c');
  assert.equal(g.player('c').money, 1465);
  assert.equal(g.turn.phase, 'done');
});

test('teams: keine miete unter partnern, ausgleich beim startgeld', () => {
  const players = [{ id: 'a', name: 'A', team: 'red' }, { id: 'b', name: 'B', team: 'red' }, { id: 'c', name: 'C', team: 'blue' }];
  const g = newGame({ teams: { enabled: true, balanceStartCash: true } }, players);
  assert.equal(g.player('c').money, 3000);
  g.tiles[3].owner = 'a';
  g.turn = g.freshTurn('b', 1);
  rig(g, [1, 2]);
  g.act('b', { type: 'roll' });
  assert.equal(g.player('b').money, 1500);
});

test('touch grass: setzt aus und kassiert den topf', () => {
  const g = newGame({ vacationCash: true });
  rig(g, [1, 3]);
  g.act('a', { type: 'roll' });
  assert.equal(g.vacationPot, 150);
  g.act('a', { type: 'endTurn' });
  g.player('b').position = 15;
  rig(g, [2, 3]);
  g.act('b', { type: 'roll' });
  assert.equal(g.player('b').money, 1650);
  g.act('b', { type: 'endTurn' });
  g.act('c', { type: 'roll' });
  if (g.turn.phase === 'buy') g.act('c', { type: 'decline' });
  if (g.turn.phase === 'roll') g.turn.phase = 'done';
  g.act('c', { type: 'endTurn' });
  g.act('a', { type: 'roll' });
  if (g.turn.phase === 'buy') g.act('a', { type: 'decline' });
  if (g.turn.phase === 'roll') g.turn.phase = 'done';
  g.act('a', { type: 'endTurn' });
  assert.equal(g.turn.playerId, 'c');
});

test('bots spielen ganze partien ohne fehler zu ende', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const settings = createSettings({
      auction: seed % 2 === 0,
      mortgage: seed % 3 === 0,
      crazyCards: seed % 4 === 0,
      vacationCash: seed % 5 === 0,
      teams: { enabled: seed % 6 === 0, balanceStartCash: true },
      roundLimit: seed % 7 === 0 ? 20 : 0,
    }, [...maps.keys()]);
    const players = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: id, isBot: true, team: i % 2 ? 'x' : 'y' }));
    let t = 0;
    const g = new MonopolyGame({ map, settings, players, seed, now: () => (t += 500) });
    let steps = 0;
    while (g.phase === 'playing' && steps < 60000) {
      steps++;
      if (g.auction) {
        const bids = g.alive.map(p => [p, botAction(g, p.id)]).filter(([, a]) => a);
        if (bids.length) {
          const [p, a] = bids[steps % bids.length];
          g.act(p.id, a);
        } else g.finishAuction();
        continue;
      }
      const actor = g.alive.find(p => g.debtOf(p.id) > 0 || g.trades.some(tr => tr.to === p.id)) ?? g.current;
      const action = botAction(g, actor.id);
      assert.ok(action, `bot ${actor.id} hat nichts zu tun (phase ${g.turn.phase})`);
      g.act(actor.id, action);
      for (const p of g.players) assert.ok(p.money >= 0, 'kein negatives bargeld');
    }
    assert.equal(g.phase, 'over', `partie ${seed} endet`);
    assert.ok(g.winner.playerIds.length >= 1);
  }
});
