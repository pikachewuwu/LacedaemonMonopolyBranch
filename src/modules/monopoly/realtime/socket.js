// socket.io: server ist autoritativ, clients schicken nur wünsche und bekommen den ganzen zustand zurück

import { createHash } from 'node:crypto';
import { Server } from 'socket.io';
import { GameError } from '../engine/errors.js';

const NAME_PATTERN = /[^\p{L}\p{N} ._'-]/gu;

export function guestName(raw) {
  const name = String(raw ?? '').replace(NAME_PATTERN, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return name.length >= 2 ? name : `Guest ${Math.floor(Math.random() * 900 + 100)}`;
}

/** Wer ist das? Discord-sitzung aus dem cookie, sonst gast mit zufalls-token aus dem browser. */
export async function resolveIdentity(handshake, auth) {
  const member = await auth.memberFromCookieHeader(handshake.headers.cookie).catch(() => null);
  if (member) return { id: `m:${member.id}`, name: member.name, memberId: member.id, avatarUrl: member.avatarUrl };
  const token = String(handshake.auth?.guestToken ?? '');
  if (token.length < 16 || token.length > 128) throw new GameError('Missing guest token');
  const id = `g:${createHash('sha256').update(token).digest('hex').slice(0, 20)}`;
  return { id, name: guestName(handshake.auth?.name), memberId: null, avatarUrl: null };
}

const EVENT_BURST = 40;
const EVENTS_PER_SECOND = 15;
const ROOMS_PER_10_MIN = 6;

export function attachMonopolySocket(httpServer, { rooms, auth, access }) {
  const io = new Server(httpServer, { serveClient: true, maxHttpBufferSize: 64_000 });
  const roomSockets = new Map();

  rooms.setNotifier((room, events) => {
    for (const socket of roomSockets.get(room.id) ?? []) {
      socket.emit('room:state', { room: room.view(socket.data.identity.id), events });
    }
  });

  io.use(async (socket, next) => {
    // dieselbe zugangssperre wie für die seiten
    if (access && !access.allowed(socket.handshake.headers.cookie)) return next(new Error('Access denied'));
    try {
      socket.data.identity = await resolveIdentity(socket.handshake, auth);
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on('connection', socket => {
    const identity = socket.data.identity;
    let roomId = null;
    let chatBudget = { tokens: 6, at: Date.now() };
    let eventBudget = { tokens: EVENT_BURST, at: Date.now() };
    const roomsCreated = [];

    function track(id) {
      if (roomId && roomId !== id) detach();
      untrack();
      roomId = id;
      if (!roomSockets.has(id)) roomSockets.set(id, new Set());
      roomSockets.get(id).add(socket);
    }

    function untrack() {
      if (!roomId) return;
      roomSockets.get(roomId)?.delete(socket);
      if (!roomSockets.get(roomId)?.size) roomSockets.delete(roomId);
      roomId = null;
    }

    /** Raum verlassen, ohne aufzugeben (z.b. zurück zur startseite). */
    function detach() {
      if (!roomId) return;
      const id = roomId;
      untrack();
      const stillHere = [...(roomSockets.get(id) ?? [])].some(s => s.data.identity.id === identity.id);
      try {
        if (!stillHere) rooms.get(id).disconnect(identity.id);
      } catch {
        /* raum schon weg */
      }
    }

    const currentRoom = () => {
      if (!roomId) throw new GameError('Join a room first');
      return rooms.get(roomId);
    };

    /** Jede anfrage: fehler als { error } zurück statt den socket zu sprengen. */
    function on(event, handler) {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        // grobe bremse gegen skripte, die den server fluten
        const now = Date.now();
        eventBudget = { tokens: Math.min(EVENT_BURST, eventBudget.tokens + ((now - eventBudget.at) / 1000) * EVENTS_PER_SECOND), at: now };
        if (eventBudget.tokens < 1) return reply({ error: 'Slow down a little' });
        eventBudget.tokens--;
        if (payload !== undefined && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) return reply({ error: 'Invalid request' });
        try {
          reply({ ok: true, ...(await handler(payload ?? {})) });
        } catch (error) {
          if (!(error instanceof GameError)) console.error(`Monopoly ${event}:`, error);
          reply({ error: error instanceof GameError ? error.message : 'Something went wrong' });
        }
      });
    }

    socket.emit('hello', { identity: { id: identity.id, name: identity.name, memberId: identity.memberId, avatarUrl: identity.avatarUrl } });

    on('rooms:list', () => ({ rooms: rooms.listPublic() }));

    on('room:create', ({ settings }) => {
      const now = Date.now();
      while (roomsCreated.length && now - roomsCreated[0] > 10 * 60_000) roomsCreated.shift();
      if (roomsCreated.length >= ROOMS_PER_10_MIN) throw new GameError('You created a lot of rooms. Try again in a few minutes');
      roomsCreated.push(now);
      const room = rooms.create(settings ?? {});
      return { roomId: room.id };
    });

    on('room:quick', () => ({ roomId: rooms.quickPlay(identity).id }));

    on('room:join', ({ roomId: id, spectator, appearance }) => {
      const room = rooms.get(id);
      const wasIn = roomId === room.id;
      track(room.id);
      const role = room.join({ ...identity, appearance }, { spectator: Boolean(spectator) });
      if (wasIn) room.changed();
      return { role };
    });

    on('room:leave', () => {
      const room = currentRoom();
      room.leave(identity.id);
      untrack();
      return {};
    });

    on('room:settings', ({ patch }) => { currentRoom().updateSettings(identity.id, patch); });
    on('room:appearance', ({ appearance }) => { currentRoom().setAppearance(identity.id, appearance); });
    on('room:team', ({ team, playerId }) => { currentRoom().setTeam(identity.id, team, playerId ?? identity.id); });
    on('room:bot', () => { currentRoom().addBot(identity.id); });
    on('room:kick', ({ playerId }) => { currentRoom().kick(identity.id, playerId); });
    on('room:votekick', ({ playerId }) => { currentRoom().voteKick(identity.id, playerId); });
    on('room:start', () => { currentRoom().start(identity.id); });
    on('room:restart', () => { currentRoom().restart(identity.id); });
    on('game:act', action => { currentRoom().act(identity.id, action); });
    on('game:grant', () => { currentRoom().grantTime(identity.id); });

    on('chat:send', ({ text }) => {
      const now = Date.now();
      chatBudget = { tokens: Math.min(6, chatBudget.tokens + (now - chatBudget.at) / 1500), at: now };
      if (chatBudget.tokens < 1) throw new GameError('Slow down a little');
      chatBudget.tokens--;
      currentRoom().say(identity.id, text);
    });

    on('room:detach', () => { detach(); });

    socket.on('disconnect', detach);
  });

  return io;
}
