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

    // ein paar runden: menschen würfeln und beenden, der bot spielt selbst
    const sockets = { [ann.last().you.id]: ann, [ben.last().you.id]: ben };
    for (let i = 0; i < 3; i++) {
      await until(() => {
        const g = ann.last().game;
        return g.phase === 'over' || (sockets[g.turn.playerId] && !g.auction && !g.debts.length);
      }, 15000);
      const g = ann.last().game;
      if (g.phase === 'over') break;
      const me = sockets[g.turn.playerId];
      const before = g.version;
      for (let k = 0; k < 6; k++) {
        const s = me.last().game;
        if (s.turn.playerId !== me.last().you.id || s.auction || s.debts.length) break;
        const type = s.turn.phase === 'roll' ? 'roll' : s.turn.phase === 'buy' ? 'buy' : 'endTurn';
        const reply = await me.ask('game:act', { type: type === 'buy' && s.players.find(p => p.id === me.last().you.id).money < 500 ? 'decline' : type });
        if (reply.error) assert.fail(reply.error);
        await until(() => me.last().game.version > before);
        if (type === 'endTurn') break;
      }
    }
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
