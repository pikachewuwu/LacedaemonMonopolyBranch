// alle räume im speicher: erstellen, finden, schnellspiel, aufräumen

import { randomInt } from 'node:crypto';
import { GameError } from '../engine/errors.js';
import { Room } from './room.js';

const LETTERS = 'abcdefghijkmnopqrstuvwxyz';
const IDLE_LOBBY_MS = 10 * 60_000;
const IDLE_GAME_MS = 20 * 60_000;
const MAX_ROOMS = 500;

export function makeRoomManager({ maps, onFinished = () => {}, now = () => Date.now() }) {
  const rooms = new Map();
  let notify = () => {};

  function newId() {
    for (;;) {
      const id = Array.from({ length: 5 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
      if (!rooms.has(id)) return id;
    }
  }

  function create(settings = {}) {
    if (rooms.size >= MAX_ROOMS) throw new GameError('Too many rooms right now, try again later');
    const room = new Room({ id: newId(), settings, maps, now, notify: (r, events) => notify(r, events), onFinished });
    rooms.set(room.id, room);
    return room;
  }

  function get(id) {
    const room = rooms.get(String(id ?? '').toLowerCase());
    if (!room) throw new GameError('This room does not exist');
    return room;
  }

  /** Öffentliche räume, die noch spieler suchen (für "All rooms"). */
  function listPublic() {
    return [...rooms.values()]
      .filter(r => !r.settings.isPrivate && r.participants.some(p => !p.isBot && p.connected))
      .sort((a, b) => Number(a.phase !== 'lobby') - Number(b.phase !== 'lobby') || b.participants.length - a.participants.length)
      .slice(0, 50)
      .map(r => r.summary());
  }

  /** "Play": vollsten offenen raum nehmen, sonst einen neuen öffnen. */
  function quickPlay(identity) {
    const open = [...rooms.values()]
      .filter(r => r.phase === 'lobby' && !r.settings.isPrivate && r.participants.length < r.settings.maxPlayers
        && r.humans.some(p => p.connected) && !r.participant(identity.id) && !(r.settings.onlyUsers && !identity.memberId))
      .sort((a, b) => b.participants.length - a.participants.length);
    return open[0] ?? create();
  }

  function sweep() {
    const t = now();
    for (const room of rooms.values()) {
      const online = room.participants.some(p => !p.isBot && p.connected) || room.spectators.size > 0;
      const limit = room.phase === 'playing' ? IDLE_GAME_MS : IDLE_LOBBY_MS;
      if (!online && t - room.lastHumanAt > limit) {
        room.dispose();
        rooms.delete(room.id);
      }
    }
  }

  const sweeper = setInterval(sweep, 60_000);
  sweeper.unref?.();

  return {
    rooms,
    create,
    get,
    listPublic,
    quickPlay,
    sweep,
    setNotifier(fn) { notify = fn; },
    dispose() {
      clearInterval(sweeper);
      for (const room of rooms.values()) room.dispose();
    },
  };
}
