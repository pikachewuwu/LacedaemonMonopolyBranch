import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { openSqlite } from '../src/db/sqlite.js';
import { createApp } from '../src/app.js';
import { attachMonopolySocket } from '../src/modules/monopoly/realtime/socket.js';

function client(url, name) {
  const socket = connect(url, { auth: { guestToken: `token-${name}-0123456789`, name }, transports: ['websocket'] });
  socket.states = [];
  socket.on('room:state', s => socket.states.push(s.room));
  socket.ask = (event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));
  socket.last = () => socket.states.at(-1);
  return socket;
}

const until = async (check, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('Zeitüberschreitung');
};

test('zwei spieler und ein bot: raum, einstellungen, start, züge', async () => {
  const db = openSqlite(':memory:');
  const app = createApp(db, {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const io = attachMonopolySocket(server, app.locals.monopoly);
  const url = `http://127.0.0.1:${server.address().port}`;
  const ann = client(url, 'Ann');
  const ben = client(url, 'Ben');
  try {
    const { roomId } = await ann.ask('room:create', { settings: { isPrivate: true } });
    assert.match(roomId, /^[a-z]{5}$/);
    assert.equal((await ann.ask('room:join', { roomId })).role, 'player');
    assert.equal((await ben.ask('room:join', { roomId })).role, 'player');
    assert.equal((await ben.ask('room:settings', { patch: { auction: true } })).error, 'Only the host can do that');
    assert.ok((await ann.ask('room:settings', { patch: { auction: true, crazyCards: true, turnTimer: 'off' } })).ok);
    assert.match((await ann.ask('room:settings', { patch: { nope: 1 } })).error, /Unknown setting/);
    assert.ok((await ann.ask('room:bot', {})).ok);
    await until(() => ben.last()?.participants.length === 3);
    assert.equal(ben.last().settings.crazyCards, true);
    assert.ok((await ann.ask('room:start', {})).ok);
    await until(() => ann.last()?.phase === 'playing');

    // ein paar züge: menschen würfeln, kaufen und beenden, der bot spielt selbst
    const sockets = { [ann.last().you.id]: ann, [ben.last().you.id]: ben };
    let actions = 0;
    const deadline = Date.now() + 30_000;
    while (actions < 6 && Date.now() < deadline) {
      const g = ann.last().game;
      if (g.phase === 'over') break;
      const me = sockets[g.turn.playerId];
      if (!me || g.auction || g.debts.length || me.last()?.game?.version !== g.version) {
        await new Promise(r => setTimeout(r, 30));
        continue;
      }
      const mine = g.players.find(p => p.id === g.turn.playerId);
      const type = g.turn.phase === 'roll' ? 'roll' : g.turn.phase === 'buy' ? (mine.money >= 400 ? 'buy' : 'decline') : 'endTurn';
      const reply = await me.ask('game:act', { type });
      if (reply.error) assert.fail(`${type}: ${reply.error}`);
      actions++;
      await until(() => ann.last().game.version > g.version, 15_000);
    }
    assert.ok(actions >= 3, `nur ${actions} aktionen`);
    assert.ok(ann.last().game.log.length > 3);
    assert.ok((await ben.ask('chat:send', { text: 'gg' })).ok);
    await until(() => ann.last().chat.some(c => c.text === 'gg'));
  } finally {
    ann.close();
    ben.close();
    app.locals.monopoly.rooms.dispose();
    io.close();
    server.close();
    await db.close();
  }
});

test('handelsangebote stehen im chat und mit details im log', async () => {
  const db = openSqlite(':memory:');
  const app = createApp(db, {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const io = attachMonopolySocket(server, app.locals.monopoly);
  const url = `http://127.0.0.1:${server.address().port}`;
  const ann = client(url, 'Ann');
  const ben = client(url, 'Ben');
  try {
    const { roomId } = await ann.ask('room:create', { settings: { isPrivate: true } });
    assert.equal((await ann.ask('room:join', { roomId })).role, 'player');
    assert.equal((await ben.ask('room:join', { roomId })).role, 'player');
    assert.ok((await ann.ask('room:start', {})).ok);
    await until(() => ben.last()?.phase === 'playing');

    const benId = ben.last().you.id;
    const reply = await ann.ask('game:act', {
      type: 'tradeCreate',
      to: benId,
      give: { money: 250, tiles: [], pardons: [] },
      take: { money: 0, tiles: [], pardons: [] },
      note: 'take it',
    });
    assert.ok(reply.ok, reply.error);

    await until(() => ben.last().chat.some(c => c.kind === 'trade' && c.text === 'Ann sent Ben an offer'));
    const chatLine = ben.last().chat.find(c => c.kind === 'trade');
    assert.equal(chatLine.text, 'Ann sent Ben an offer');

    await until(() => ben.last().game.log.some(l => l.kind === 'trade' && l.text.includes('offered')));
    const logLine = ben.last().game.log.find(l => l.kind === 'trade' && l.text.includes('offered'));
    assert.match(logLine.text, /Ann offered Ben a trade: 250/);
    assert.match(logLine.text, /take it/);

    const tradeId = ben.last().game.trades[0].id;
    assert.ok((await ben.ask('game:act', { type: 'tradeDecline', id: tradeId })).ok);
    await until(() => ben.last().chat.some(c => c.text === "Ben declined Ann's offer"));
  } finally {
    ann.close();
    ben.close();
    app.locals.monopoly.rooms.dispose();
    io.close();
    server.close();
    await db.close();
  }
});
