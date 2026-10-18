// ein spielraum: lobby -> partie -> ende. kennt keine sockets, meldet änderungen über notify()

import { GameError } from '../engine/errors.js';
import { MonopolyGame } from '../engine/game.js';
import { botAction } from '../engine/bots.js';
import { mapSummary } from '../maps/index.js';
import { createSettings, validateSettingsPatch } from '../settings.js';
import { BOT_NAMES, COLORS, SHAPES, TEAMS, validAppearance } from './appearance.js';

const CLOCKS = {
  standard: { graceMs: 20_000, bankStartMs: 60_000, bankMaxMs: 180_000, refillMs: [6_000, 20_000], debtGraceMs: 60_000 },
  relaxed: { graceMs: 40_000, bankStartMs: 120_000, bankMaxMs: 360_000, refillMs: [12_000, 40_000], debtGraceMs: 120_000 },
};
export const GRANT_MS = 60_000;
const GRANT_CAP_MS = 120_000;
const REMOVE_AFTER_AUTO_TURNS = 2;
const CHAT_LIMIT = 120;
const LOBBY_RECONNECT_MS = 15_000;

/** Wie lange der client für diese ereignisse animiert (bots warten so lange). */
export function animationMs(events) {
  let ms = 0;
  for (const e of events) {
    if (e.type === 'dice') ms += 900;
    if (e.type === 'move') ms += e.mode === 'walk' ? Math.abs(e.steps) * 190 + 150 : 650;
    if (e.type === 'card') ms += 1600;
    if (e.type === 'buy' || e.type === 'upgrade') ms += 250;
  }
  return ms;
}

export class Room {
  constructor({ id, settings, maps, notify, onFinished = () => {}, now = () => Date.now(), random = Math.random }) {
    this.id = id;
    this.maps = maps;
    this.settings = createSettings(settings, [...maps.keys()]);
    this.notify = notify;
    this.onFinished = onFinished;
    this.now = now;
    this.random = random;
    this.createdAt = now();
    this.lastActiveAt = now();
    // nur menschen zählen fürs aufräumen; bots allein halten keinen raum am leben
    this.lastHumanAt = now();
    this.phase = 'lobby';
    this.hostId = null;
    this.participants = [];
    this.spectators = new Map();
    this.chat = [];
    this.chatSeq = 0;
    this.game = null;
    this.result = null;
    this.votes = new Map();
    this.timer = null;
    this.busyUntil = 0;
    this.clock = null;
    this.banks = new Map();
    this.autoActed = new Map();
    this.debtSince = new Map();
    this.botSeq = 0;
  }

  get map() { return this.maps.get(this.settings.mapId); }

  get players() { return this.participants; }

  get humans() { return this.participants.filter(p => !p.isBot); }

  participant(id) { return this.participants.find(p => p.id === id) ?? null; }

  isHost(id) { return this.hostId === id; }

  requireHost(id) {
    if (!this.isHost(id)) throw new GameError('Only the host can do that');
  }

  requireLobby() {
    if (this.phase !== 'lobby') throw new GameError('The game has already started');
  }

  // ---- teilnehmer --------------------------------------------------------

  /** Beitreten: als spieler, wenn frei und lobby, sonst als zuschauer. Wiederkehrer behalten den platz. */
  join(identity, { spectator = false } = {}) {
    this.lastActiveAt = this.now();
    this.lastHumanAt = this.now();
    const existing = this.participant(identity.id);
    if (existing) {
      existing.connected = true;
      existing.avatarUrl = identity.avatarUrl ?? existing.avatarUrl;
      this.changed();
      return 'player';
    }
    const seatFree = this.phase === 'lobby' && this.participants.length < this.settings.maxPlayers;
    if (spectator || !seatFree) {
      this.spectators.set(identity.id, { id: identity.id, name: identity.name });
      this.changed();
      return 'spectator';
    }
    if (this.settings.onlyUsers && !identity.memberId) throw new GameError('Only logged-in users can join this room');
    this.spectators.delete(identity.id);
    this.participants.push({
      id: identity.id,
      name: this.uniqueName(identity.name),
      memberId: identity.memberId ?? null,
      avatarUrl: identity.avatarUrl ?? null,
      isBot: false,
      connected: true,
      appearance: this.freeAppearance(identity.appearance),
      team: this.settings.teams.enabled ? this.smallestTeam() : null,
      joinedAt: this.now(),
    });
    this.hostId ??= identity.id;
    this.system(`${this.participant(identity.id).name} joined the room`);
    this.changed();
    return 'player';
  }

  uniqueName(name) {
    const taken = new Set(this.participants.map(p => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
  }

  freeAppearance(wanted) {
    const used = new Set(this.participants.map(p => p.appearance.color));
    const color = wanted?.color && COLORS.includes(wanted.color) && !used.has(wanted.color) ? wanted.color : COLORS.find(c => !used.has(c)) ?? COLORS[0];
    const shape = SHAPES.includes(wanted?.shape) ? wanted.shape : SHAPES[0];
    return { color, shape };
  }

  smallestTeam() {
    const counts = TEAMS.slice(0, 2).map(t => [t.id, this.participants.filter(p => p.team === t.id).length]);
    return counts.sort((a, b) => a[1] - b[1])[0][0];
  }

  /** Socket getrennt: in der lobby platz freigeben, im spiel nur als offline markieren. */
  disconnect(id) {
    this.spectators.delete(id);
    const p = this.participant(id);
    if (!p) return this.changed();
    p.connected = false;
    if (this.phase === 'lobby') {
      // kurzer neuladen-puffer, damit niemand beim aktualisieren seinen platz verliert
      const timer = setTimeout(() => {
        if (this.phase === 'lobby' && this.participant(id) && !this.participant(id).connected) this.leave(id);
      }, LOBBY_RECONNECT_MS);
      timer.unref?.();
    }
    this.changed();
  }

  leave(id) {
    this.spectators.delete(id);
    const p = this.participant(id);
    if (!p) return this.changed();
    if (this.phase === 'playing' && this.game?.player(id) && !this.game.player(id).bankrupt) {
      this.applyGame(() => {
        this.game.goBankrupt(this.game.player(id), 'left');
        return this.game.drainEvents();
      });
      p.connected = false;
      return;
    }
    if (this.phase !== 'playing') {
      this.participants = this.participants.filter(x => x.id !== id);
      this.system(`${p.name} left the room`);
    }
    if (this.hostId === id) this.passHost();
    this.changed();
  }

  passHost() {
    const next = this.participants.find(p => !p.isBot && p.connected && p.id !== this.hostId) ?? this.participants.find(p => !p.isBot && p.id !== this.hostId);
    this.hostId = next?.id ?? null;
    if (next) this.system(`${next.name} is now the host`);
  }

  setAppearance(id, appearance) {
    const p = this.participant(id);
    if (!p) throw new GameError('Join the game first');
    if (!validAppearance(appearance)) throw new GameError('Invalid appearance');
    if (this.participants.some(x => x.id !== id && x.appearance.color === appearance.color)) throw new GameError('Another player already has this colour');
    p.appearance = { color: appearance.color, shape: appearance.shape };
    if (this.game?.player(id)) this.game.player(id).appearance = { ...p.appearance };
    this.changed();
  }

  setTeam(id, team, targetId = id) {
    this.requireLobby();
    if (targetId !== id) this.requireHost(id);
    const p = this.participant(targetId);
    if (!p) throw new GameError('Unknown player');
    if (!TEAMS.some(t => t.id === team)) throw new GameError('Unknown team');
    p.team = team;
    this.changed();
  }

  updateSettings(id, patch) {
    this.requireHost(id);
    this.requireLobby();
    const clean = validateSettingsPatch(patch, [...this.maps.keys()]);
    if (clean.maxPlayers && clean.maxPlayers < this.participants.length) throw new GameError('There are already more players in the room');
    Object.assign(this.settings, clean);
    if (clean.teams?.enabled) for (const p of this.participants) p.team ??= this.smallestTeam();
    if (clean.teams && !clean.teams.enabled) for (const p of this.participants) p.team = null;
    if (clean.canBotsJoin === false) this.participants = this.participants.filter(p => !p.isBot);
    this.changed();
  }

  addBot(id) {
    this.requireHost(id);
    this.requireLobby();
    if (!this.settings.canBotsJoin) throw new GameError('Bots are turned off in this room');
    if (this.participants.length >= this.settings.maxPlayers) throw new GameError('The room is full.');
    const used = new Set(this.participants.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) ?? `Bot ${this.botSeq + 1}`;
    const bot = {
      id: `bot:${this.id}:${++this.botSeq}`,
      name,
      memberId: null,
      avatarUrl: null,
      isBot: true,
      connected: true,
      appearance: this.freeAppearance({ shape: SHAPES[this.botSeq % SHAPES.length] }),
      team: this.settings.teams.enabled ? this.smallestTeam() : null,
      joinedAt: this.now(),
    };
    this.participants.push(bot);
    this.system(`${name} joined the room`);
    this.changed();
  }

  kick(id, targetId) {
    const target = this.participant(targetId);
    if (!target) throw new GameError('Unknown player');
    if (targetId === id) throw new GameError("You can't remove yourself");
    this.requireHost(id);
    if (this.phase !== 'lobby' && !target.isBot && !this.settings.isPrivate) throw new GameError('The host can only remove players during the game in private rooms.');
    this.remove(target, 'kicked');
  }

  remove(target, reason) {
    if (this.phase === 'playing' && this.game?.player(target.id) && !this.game.player(target.id).bankrupt) {
      this.applyGame(() => {
        this.game.goBankrupt(this.game.player(target.id), reason);
        return this.game.drainEvents();
      });
      return;
    }
    if (this.phase !== 'playing') this.participants = this.participants.filter(p => p.id !== target.id);
    this.system(`${target.name} was removed`);
    this.changed();
  }

  /** Abstimmung: mehrheit der menschlichen spieler (wie richup: ceil((n+1)/2)). */
  voteKick(id, targetId) {
    const voter = this.participant(id);
    const target = this.participant(targetId);
    if (!voter || !target || target.isBot || voter.id === target.id) throw new GameError('You cannot vote for this player');
    const votes = this.votes.get(targetId) ?? new Set();
    if (votes.has(id)) throw new GameError('You already voted to remove this player');
    votes.add(id);
    this.votes.set(targetId, votes);
    const voters = this.humans.filter(p => !this.game?.player(p.id)?.bankrupt);
    const needed = Math.ceil((voters.length + 1) / 2);
    this.system(`${voter.name} voted to remove ${target.name} (${votes.size}/${needed})`);
    if (votes.size >= needed) {
      this.votes.delete(targetId);
      this.remove(target, 'kicked');
      return;
    }
    this.changed();
  }

  // ---- chat --------------------------------------------------------------

  say(id, text) {
    const p = this.participant(id);
    if (!p) throw new GameError('Only game players can send chat messages');
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!clean) return;
    this.lastHumanAt = this.now();
    this.pushChat({ kind: 'chat', from: id, name: p.name, color: p.appearance.color, text: clean });
  }

  system(text) {
    this.pushChat({ kind: 'system', text });
  }

  pushChat(message) {
    this.chat.push({ id: ++this.chatSeq, at: this.now(), ...message });
    if (this.chat.length > CHAT_LIMIT) this.chat.shift();
    this.changed();
  }

  // ---- partie ------------------------------------------------------------

  start(id, seed = Math.floor(this.random() * 2 ** 31)) {
    this.requireHost(id);
    if (this.phase === 'playing') throw new GameError('The game has already started');
    if (this.participants.length < 2) throw new GameError('You must have at least two players for the game to start');
    if (this.settings.teams.enabled) {
      const teams = new Set(this.participants.map(p => p.team));
      if (teams.size < 2 || teams.has(null)) throw new GameError('At least 2 teams must have players to start');
    }
    this.game = new MonopolyGame({
      map: this.map,
      settings: this.settings,
      players: this.participants.map(p => ({ id: p.id, name: p.name, isBot: p.isBot, team: p.team, appearance: { ...p.appearance } })),
      seed,
      now: this.now,
    });
    this.phase = 'playing';
    this.result = null;
    this.votes.clear();
    this.banks = new Map(this.participants.map(p => [p.id, this.clockConfig()?.bankStartMs ?? 0]));
    this.autoActed.clear();
    this.debtSince.clear();
    this.clock = null;
    this.system('The game has started. Good luck!');
    this.afterGameChange(this.game.drainEvents());
  }

  restart(id) {
    this.requireHost(id);
    if (this.phase !== 'ended') throw new GameError('The game is still running');
    this.phase = 'lobby';
    this.game = null;
    this.clock = null;
    this.participants = this.participants.filter(p => p.isBot || p.connected);
    this.changed();
  }

  /** Aktion eines menschen. Zählt als lebenszeichen für die uhr. */
  act(id, action) {
    if (this.phase !== 'playing') throw new GameError('The game is not running');
    this.autoActed.set(id, 0);
    this.lastHumanAt = this.now();
    this.applyGame(() => this.game.act(id, action));
  }

  applyGame(fn) {
    const before = this.game.turn.playerId + ':' + this.game.turn.number;
    const events = fn();
    if (before !== this.game.turn.playerId + ':' + this.game.turn.number) this.closeClock(before);
    this.afterGameChange(events);
  }

  afterGameChange(events = []) {
    this.lastActiveAt = this.now();
    this.busyUntil = Math.max(this.busyUntil, this.now()) + animationMs(events);
    if (this.game.phase === 'over' && this.phase === 'playing') {
      this.phase = 'ended';
      this.clock = null;
      this.result = { winner: this.game.winner, standings: this.game.standings(), stats: this.game.stats };
      this.system(this.game.log.at(-1)?.text ?? 'Game over!');
      try {
        this.onFinished(this);
      } catch (error) {
        console.error('Partie konnte nicht gespeichert werden:', error);
      }
    }
    this.syncClock();
    this.schedule();
    this.notify(this, events);
  }

  changed() {
    this.notify(this, []);
  }

  // ---- uhr ---------------------------------------------------------------

  clockConfig() {
    return CLOCKS[this.settings.turnTimer] ?? null;
  }

  /** Uhr an den aktuellen zug anpassen (neuer zug = neue grace-zeit). */
  syncClock() {
    const config = this.clockConfig();
    const g = this.game;
    if (!config || this.phase !== 'playing') {
      this.clock = null;
      return;
    }
    const key = `${g.turn.playerId}:${g.turn.number}`;
    const current = g.current;
    if (!this.clock || this.clock.key !== key) {
      this.clock = { key, playerId: current.id, startedAt: this.now(), pausedMs: 0, pausedAt: null, grantedMs: 0, grants: new Set() };
    }
    // während auktionen steht die uhr
    if (g.auction && this.clock.pausedAt === null) this.clock.pausedAt = this.now();
    if (!g.auction && this.clock.pausedAt !== null) {
      this.clock.pausedMs += this.now() - this.clock.pausedAt;
      this.clock.pausedAt = null;
    }
    const debtors = new Set(g.debts.map(d => d.from));
    for (const id of this.debtSince.keys()) if (!debtors.has(id)) this.debtSince.delete(id);
    for (const id of debtors) if (!this.debtSince.has(id)) this.debtSince.set(id, this.now());
  }

  /** Abgelaufene zeit vom konto abziehen bzw. bei schnellem spiel auffüllen. */
  closeClock(key) {
    const config = this.clockConfig();
    if (!config || !this.clock || this.clock.key !== key) return;
    const { playerId, startedAt, pausedMs, grantedMs } = this.clock;
    const used = this.now() - startedAt - pausedMs - grantedMs;
    const bank = this.banks.get(playerId) ?? config.bankStartMs;
    if (used > config.graceMs) {
      this.banks.set(playerId, Math.max(0, bank - (used - config.graceMs)));
    } else {
      const [min, max] = config.refillMs;
      const refill = min + ((config.graceMs - used) / config.graceMs) * (max - min);
      this.banks.set(playerId, Math.min(config.bankMaxMs, bank + Math.round(refill)));
    }
  }

  turnDeadline() {
    const config = this.clockConfig();
    if (!config || !this.clock || this.game?.auction || this.game?.debts.length) return null;
    const player = this.game.player(this.clock.playerId);
    if (!player || player.isBot) return null;
    const bank = this.banks.get(player.id) ?? config.bankStartMs;
    return this.clock.startedAt + this.clock.pausedMs + config.graceMs + this.clock.grantedMs + bank;
  }

  debtDeadlines() {
    const config = this.clockConfig();
    if (!config) return [];
    return [...this.debtSince.entries()]
      .filter(([id]) => !this.game.player(id)?.isBot)
      .map(([id, since]) => ({ playerId: id, since, deadline: since + config.debtGraceMs }));
  }

  grantTime(id) {
    const g = this.game;
    if (this.phase !== 'playing' || !this.clock) throw new GameError('There is no clock running');
    const giver = g.player(id);
    if (!giver || giver.bankrupt) throw new GameError('Only players can give time');
    if (this.clock.playerId === id) throw new GameError("You can't give yourself time");
    if (this.clock.grants.has(id)) throw new GameError('You already gave time this turn');
    if (this.clock.grantedMs + GRANT_MS > GRANT_CAP_MS) throw new GameError('This turn already got enough extra time');
    this.clock.grants.add(id);
    this.clock.grantedMs += GRANT_MS;
    this.system(`${giver.name} gave ${g.player(this.clock.playerId).name} an extra minute`);
    this.schedule();
  }

  /** Zeit abgelaufen: der server spielt den zug minimal zu ende. */
  autoPlay(playerId, reason) {
    const g = this.game;
    const p = g.player(playerId);
    if (!p || p.bankrupt) return;
    const strikes = (this.autoActed.get(playerId) ?? 0) + 1;
    this.autoActed.set(playerId, strikes);
    this.system(`${p.name} ran out of time`);
    if (strikes >= REMOVE_AFTER_AUTO_TURNS && reason === 'turn') {
      this.applyGame(() => {
        g.goBankrupt(p, 'timeout');
        return g.drainEvents();
      });
      return;
    }
    this.applyGame(() => {
      const events = [];
      for (let i = 0; i < 40; i++) {
        const stillMine = g.phase === 'playing' && !p.bankrupt && (g.debtOf(p.id) > 0 || (reason === 'turn' && g.turn.playerId === p.id && !g.auction));
        if (!stillMine) break;
        const action = botAction(g, p.id, { passive: true });
        if (!action) break;
        try {
          events.push(...g.act(p.id, action));
        } catch {
          break;
        }
      }
      return events;
    });
  }

  // ---- zeitplan ----------------------------------------------------------

  /** Wer ist als nächstes dran, und wann? Ein timer für alles. */
  nextDue() {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return null;
    const now = this.now();
    const due = [];
    if (g.auction) due.push({ at: g.auction.endsAt, run: () => this.applyGame(() => g.finishAuction()) });
    const bot = this.botNeedingAction();
    if (bot) {
      const think = g.auction ? 700 + this.random() * 2200 : 650 + this.random() * 450;
      due.push({ at: Math.max(now + think, this.busyUntil + 250), run: () => this.runBot(bot) });
    }
    const deadline = this.turnDeadline();
    if (deadline !== null) due.push({ at: deadline, run: () => this.autoPlay(this.clock.playerId, 'turn') });
    for (const d of this.debtDeadlines()) due.push({ at: d.deadline, run: () => this.autoPlay(d.playerId, 'debt') });
    return due.sort((a, b) => a.at - b.at)[0] ?? null;
  }

  botNeedingAction() {
    const g = this.game;
    const bots = g.alive.filter(p => p.isBot);
    const priority = [
      ...bots.filter(b => g.debtOf(b.id) > 0),
      ...bots.filter(b => g.trades.some(t => t.to === b.id)),
      ...(g.auction ? bots.filter(b => botAction(g, b.id)) : []),
      ...(!g.auction && !g.debts.length && g.current.isBot ? [g.current] : []),
    ];
    return priority[0] ?? null;
  }

  runBot(bot) {
    const g = this.game;
    const action = botAction(g, bot.id);
    if (!action) return this.schedule();
    try {
      this.applyGame(() => g.act(bot.id, action));
    } catch (error) {
      // sollte nicht passieren; nicht hängen bleiben
      console.error('Bot-Aktion abgelehnt:', action, error.message);
      if (g.turn.playerId === bot.id && !g.auction && !g.debts.length) {
        try { this.applyGame(() => g.act(bot.id, { type: g.turn.phase === 'buy' ? 'decline' : 'endTurn' })); } catch { /* aufgeben */ }
      }
    }
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    const next = this.nextDue();
    if (!next) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.phase !== 'playing') return;
      try {
        next.run();
      } catch (error) {
        console.error('Monopoly-Zeitplan:', error);
        this.schedule();
      }
    }, Math.max(0, next.at - this.now()));
    this.timer.unref?.();
  }

  dispose() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  // ---- ansicht -----------------------------------------------------------

  view(viewerId) {
    const config = this.clockConfig();
    const role = this.participant(viewerId) ? 'player' : this.spectators.has(viewerId) ? 'spectator' : null;
    return {
      id: this.id,
      phase: this.phase,
      hostId: this.hostId,
      settings: structuredClone(this.settings),
      map: mapSummary(this.map),
      participants: this.participants.map(p => ({
        id: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl,
        isBot: p.isBot,
        isMember: Boolean(p.memberId),
        connected: p.connected,
        appearance: p.appearance,
        team: p.team,
        votes: this.votes.get(p.id)?.size ?? 0,
      })),
      spectators: this.spectators.size,
      teams: TEAMS,
      chat: this.chat.slice(-80),
      you: { id: viewerId, role, isHost: this.isHost(viewerId) },
      game: this.game ? this.game.snapshot(role === 'player' ? viewerId : null) : null,
      clock: this.clock && config ? {
        playerId: this.clock.playerId,
        startedAt: this.clock.startedAt + this.clock.pausedMs,
        deadline: this.turnDeadline(),
        graceEndsAt: this.clock.startedAt + this.clock.pausedMs + config.graceMs + this.clock.grantedMs,
        paused: this.clock.pausedAt !== null,
        canGrant: role === 'player' && this.clock.playerId !== viewerId && !this.clock.grants.has(viewerId),
      } : null,
      debtDeadlines: this.game ? this.debtDeadlines() : [],
      result: this.result,
      serverNow: this.now(),
    };
  }

  summary() {
    return {
      id: this.id,
      phase: this.phase,
      players: this.participants.map(p => ({ name: p.name, color: p.appearance.color, isBot: p.isBot })),
      maxPlayers: this.settings.maxPlayers,
      map: mapSummary(this.map),
      settings: structuredClone(this.settings),
      createdAt: this.createdAt,
    };
  }
}
