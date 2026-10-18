// die spielregeln, serverseitig und ohne dom/express. ablauf und zahlen wie richup.io,
// siehe docs/MONOPOLY.md. jede aktion geht über act(), fehler werfen GameError.

import { GameError } from './errors.js';
import { createRng, pick, shuffle } from './rng.js';
import { describeMap, isOwnable, money, pardonName, word } from './board.js';

export const AUCTION_MS = 10_000;
export const MAX_TRADES_PER_PAIR = 5;
export const GIFT_LIMIT = 0.9;
export const PARDON_VALUE = 50;
const NET_WORTH_POINTS = 400;

export class MonopolyGame {
  /**
   * @param {object} o
   * @param {object} o.map validierte map (siehe maps/validate.js)
   * @param {object} o.settings raumeinstellungen
   * @param {{id:string,name:string,isBot?:boolean,team?:string|null,appearance?:object}[]} o.players
   */
  constructor({ map, settings, players, seed = Date.now(), now = () => Date.now() }) {
    if (players.length < 2) throw new GameError('You must have at least two players for the game to start');
    this.map = map;
    this.info = describeMap(map);
    this.settings = settings;
    this.rand = createRng(seed);
    this.now = now;
    this.teams = Boolean(settings.teams?.enabled);

    const ordered = settings.shufflePlayerOrder ? shuffle(players, this.rand) : players.slice();
    const cash = startingCash(players, settings);
    this.players = ordered.map(p => ({
      id: p.id,
      name: p.name,
      isBot: Boolean(p.isBot),
      team: this.teams ? p.team ?? null : null,
      appearance: p.appearance ?? null,
      money: cash.get(p.id),
      position: this.info.go,
      bankrupt: false,
      leftReason: null,
      prisonTurns: 0,
      skipTurns: 0,
      doublesInARow: 0,
      pardons: [],
      shield: false,
      boost: false,
    }));
    this.tiles = map.tiles.map(t => (isOwnable(t) ? { owner: null, level: 0, mortgaged: false } : null));
    this.decks = {};
    for (const deck of ['treasure', 'surprise']) {
      const cards = [...(map.cards?.[deck] ?? []), ...(settings.crazyCards ? map.cards?.crazy?.[deck] ?? [] : [])];
      this.decks[deck] = { cards, order: shuffle(cards.map((_, i) => i), this.rand), index: 0, pardonHolder: null };
    }
    this.phase = 'playing';
    this.round = 1;
    this.turn = this.freshTurn(this.players[0].id, 1);
    this.auction = null;
    this.debts = [];
    this.trades = [];
    this.tradeSeq = 0;
    this.vacationPot = 0;
    this.card = null;
    this.winner = null;
    this.version = 0;
    this.events = [];
    this.log = [];
    this.stats = {
      startedAt: now(),
      endedAt: null,
      turns: 1,
      doubles: 0,
      trades: 0,
      auctions: 0,
      heat: Array(this.info.size).fill(0),
      prisonVisits: Object.fromEntries(this.players.map(p => [p.id, 0])),
      netWorth: [],
    };
    this.say(`${this.current.name} starts the game`, 'turn');
    this.recordNetWorth();
  }

  // ---- lesen -------------------------------------------------------------

  get current() { return this.player(this.turn.playerId); }

  get alive() { return this.players.filter(p => !p.bankrupt); }

  player(id) { return this.players.find(p => p.id === id) ?? null; }

  fmt(amount) { return money(this.map, amount); }

  owned(playerId) {
    return this.tiles.flatMap((t, i) => (t?.owner === playerId ? [i] : []));
  }

  teammates(a, b) {
    if (!this.teams || a === b) return false;
    const pa = this.player(a);
    const pb = this.player(b);
    return Boolean(pa?.team && pa.team === pb?.team);
  }

  ownsGroup(playerId, group) {
    return this.info.groups[group].every(i => this.tiles[i].owner === playerId);
  }

  debtOf(playerId) {
    return this.debts.filter(d => d.from === playerId).reduce((sum, d) => sum + d.amount, 0);
  }

  inPrison(playerId) { return (this.player(playerId)?.prisonTurns ?? 0) > 0; }

  /** Gesamtwert wie bei richup: hypotheken zählen 0, bauten zum baupreis, pardon 50. */
  netWorth(playerId) {
    const p = this.player(playerId);
    if (!p || p.bankrupt) return 0;
    let worth = p.money - this.debtOf(playerId) + p.pardons.length * PARDON_VALUE;
    for (const i of this.owned(playerId)) {
      const tile = this.map.tiles[i];
      const state = this.tiles[i];
      if (!state.mortgaged) worth += tile.price;
      if (tile.type === 'city') worth += state.level * tile.house;
    }
    return worth;
  }

  /** Was ein spieler beim bankrott höchstens auftreiben kann. */
  liquidationValue(playerId) {
    const p = this.player(playerId);
    let value = p.money + p.pardons.length * PARDON_VALUE;
    for (const i of this.owned(playerId)) {
      const tile = this.map.tiles[i];
      const state = this.tiles[i];
      if (!state.mortgaged) value += Math.floor(tile.price / 2);
      if (tile.type === 'city') value += Math.floor((state.level * tile.house) / 2);
    }
    return value;
  }

  /** Miete, die ein besucher jetzt zahlen würde (ohne ausnahmen für besucher). */
  rentFor(index, diceTotal = 7) {
    const tile = this.map.tiles[index];
    const state = this.tiles[index];
    if (!state || state.owner === null || state.mortgaged) return 0;
    const owner = this.player(state.owner);
    let rent = 0;
    if (tile.type === 'city') {
      rent = tile.rent[state.level];
      if (state.level === 0 && this.settings.payDoubleRentWhenOwnFullSet && this.ownsGroup(owner.id, tile.group)) rent *= 2;
    } else if (tile.type === 'airport') {
      const count = this.info.airports.filter(i => this.tiles[i].owner === owner.id).length;
      rent = tile.rent[Math.min(count, tile.rent.length) - 1];
    } else if (tile.type === 'company') {
      const count = this.info.companies.filter(i => this.tiles[i].owner === owner.id).length;
      rent = tile.multipliers[Math.min(count, tile.multipliers.length) - 1] * diceTotal;
    }
    return owner.boost ? rent * 2 : rent;
  }

  // ---- protokoll ---------------------------------------------------------

  emit(event) { this.events.push(event); }

  say(text, kind = 'info') {
    const entry = { id: ++this.version, at: this.now(), kind, text };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this.emit({ type: 'log', ...entry });
  }

  /** Ereignisse seit dem letzten aufruf abholen (für animationen im client). */
  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  recordNetWorth() {
    this.stats.netWorth.push({ turn: this.stats.turns, values: Object.fromEntries(this.players.map(p => [p.id, this.netWorth(p.id)])) });
    if (this.stats.netWorth.length > NET_WORTH_POINTS) {
      this.stats.netWorth = this.stats.netWorth.filter((_, i) => i % 2 === 0);
    }
  }

  // ---- aktionen ----------------------------------------------------------

  /** Einziger einstiegspunkt für spieler-aktionen. */
  act(playerId, action) {
    if (this.phase !== 'playing') throw new GameError('The game is over');
    const p = this.player(playerId);
    if (!p) throw new GameError('You are not playing in this game');
    if (p.bankrupt) throw new GameError('You are bankrupt');
    const handler = Object.hasOwn(ACTIONS, action?.type ?? '') ? ACTIONS[action.type] : null;
    if (!handler) throw new GameError('Unknown action');
    // zahlen aus dem client: nur ganze, nicht negative zahlen im erlaubten bereich
    for (const key of ['tile', 'amount', 'id']) {
      if (key in action && !(Number.isInteger(action[key]) && action[key] >= 0 && action[key] <= 1e9)) throw new GameError('Invalid action');
    }
    if ('tile' in action && action.tile >= this.info.size) throw new GameError('Invalid action');
    if ('group' in action && typeof action.group !== 'string') throw new GameError('Invalid action');
    handler.call(this, p, action);
    this.version++;
    return this.drainEvents();
  }

  requireTurn(p) {
    if (this.turn.playerId !== p.id) throw new GameError("It's not your turn");
  }

  requireNoBlockers() {
    if (this.auction) throw new GameError('Wait for the auction to finish');
    if (this.debts.length) throw new GameError('Waiting for debts to be paid');
  }

  roll(p) {
    this.requireTurn(p);
    this.requireNoBlockers();
    if (this.turn.phase !== 'roll') throw new GameError(this.turn.phase === 'buy' ? 'Buy or skip the property first' : "You can't roll again this turn");
    const dice = [1 + Math.floor(this.rand() * 6), 1 + Math.floor(this.rand() * 6)];
    const doubles = dice[0] === dice[1];
    this.turn.dice = dice;
    this.turn.rolls++;
    this.card = null;
    if (doubles) this.stats.doubles++;
    this.emit({ type: 'dice', playerId: p.id, dice });
    const total = dice[0] + dice[1];

    if (p.prisonTurns > 0) {
      if (doubles) {
        p.prisonTurns = 0;
        this.say(`${p.name} rolled doubles and escaped ${word(this.map, 'prison', 'prison')}`, 'prison');
        this.turn.again = false;
        this.moveBy(p, total);
      } else {
        p.prisonTurns--;
        this.say(p.prisonTurns === 0
          ? `${p.name} rolled ${dice.join('+')} and is released next turn`
          : `${p.name} rolled ${dice.join('+')} and stays in ${word(this.map, 'prison', 'prison')}`, 'prison');
        this.turn.again = false;
        this.turn.phase = 'done';
        return;
      }
    } else {
      p.doublesInARow = doubles ? p.doublesInARow + 1 : 0;
      if (p.doublesInARow >= 3) {
        this.say(`${p.name} rolled doubles three times in a row`, 'prison');
        this.sendToPrison(p);
        this.turn.phase = 'done';
        this.autoEndTurn(p);
        return;
      }
      this.turn.again = doubles;
      this.say(`${p.name} rolled ${dice[0]} and ${dice[1]}`, 'dice');
      this.moveBy(p, total);
    }
    this.settleTurnPhase();
    // wer in die backrooms geschickt wurde, hat nichts mehr zu tun
    if (this.turn.jailed && this.turn.phase === 'done') this.autoEndTurn(p);
  }

  /** Zug sofort abgeben, wenn er nach dem backrooms-besuch leer ist. */
  autoEndTurn(p) {
    this.turn.jailed = false;
    try {
      this.endTurn(p);
    } catch {
      /* schulden oder auktion: dann beendet der spieler den zug selbst */
    }
  }

  /** Nach einer auflösung: nochmal würfeln, kaufen oder fertig. */
  settleTurnPhase() {
    if (this.phase !== 'playing') return;
    if (this.turn.phase === 'buy' || this.auction) return;
    const p = this.current;
    this.turn.phase = this.turn.again && !p.bankrupt && p.prisonTurns === 0 ? 'roll' : 'done';
  }

  payPrison(p) {
    this.requireTurn(p);
    this.requireNoBlockers();
    if (p.prisonTurns === 0) throw new GameError('You are not in prison');
    if (this.turn.phase !== 'roll' || this.turn.rolls > 0) throw new GameError("You can't do it now");
    const fine = this.map.prison.fine;
    if (p.money < fine) throw new GameError("You don't have enough money to pay for it");
    this.payBank(p, fine, { pot: true });
    p.prisonTurns = 0;
    this.say(`${p.name} paid ${this.fmt(fine)} to get out of ${word(this.map, 'prison', 'prison')}`, 'prison');
  }

  usePardon(p, { deck }) {
    this.requireTurn(p);
    this.requireNoBlockers();
    if (p.prisonTurns === 0) throw new GameError('You are not in prison');
    if (this.turn.phase !== 'roll' || this.turn.rolls > 0) throw new GameError("You can't do it now");
    const which = deck && p.pardons.includes(deck) ? deck : p.pardons[0];
    if (!which) throw new GameError("You don't have an exit card");
    p.pardons.splice(p.pardons.indexOf(which), 1);
    this.decks[which].pardonHolder = null;
    p.prisonTurns = 0;
    this.say(`${p.name} used the ${pardonName(this.map, which)}`, 'prison');
  }

  buy(p) {
    this.requireTurn(p);
    if (this.turn.phase !== 'buy') throw new GameError('There is nothing to buy');
    const tile = this.map.tiles[p.position];
    const state = this.tiles[p.position];
    if (state.owner !== null) throw new GameError(`${this.player(state.owner).name} already owns this property`);
    if (p.money < tile.price) throw new GameError("You don't have enough money");
    p.money -= tile.price;
    state.owner = p.id;
    state.level = 0;
    this.emit({ type: 'buy', playerId: p.id, tile: p.position, price: tile.price });
    this.say(`${p.name} bought ${tile.name} for ${this.fmt(tile.price)}`, 'buy');
    this.turn.phase = 'resolving';
    this.settleTurnPhase();
  }

  decline(p) {
    this.requireTurn(p);
    if (this.turn.phase !== 'buy') throw new GameError('There is nothing to skip');
    const tile = this.map.tiles[p.position];
    this.turn.phase = 'resolving';
    if (this.settings.auction) {
      this.startAuction(p.position, p.id);
      return;
    }
    this.say(`${p.name} didn't buy ${tile.name}`);
    this.settleTurnPhase();
  }

  startAuction(index, startedBy) {
    const tile = this.map.tiles[index];
    if (this.tiles[index].owner !== null) throw new GameError('Cannot auction owned property');
    this.auction = { tile: index, bid: 0, bidderId: null, endsAt: this.now() + AUCTION_MS, ms: AUCTION_MS, startedBy, bids: 0 };
    this.stats.auctions++;
    this.emit({ type: 'auction', tile: index });
    this.say(`${tile.name} goes to auction`, 'auction');
  }

  bid(p, { amount }) {
    const a = this.auction;
    if (!a) throw new GameError('No active auction');
    if (!Number.isInteger(amount) || amount <= a.bid) throw new GameError('Bid must be higher than current bid');
    if (amount > p.money) throw new GameError("You don't have enough money");
    if (this.debtOf(p.id) > 0) throw new GameError('Pay your debt first');
    a.bid = amount;
    a.bidderId = p.id;
    a.bids++;
    a.endsAt = this.now() + AUCTION_MS;
    this.emit({ type: 'bid', playerId: p.id, amount });
  }

  /** Vom raum aufgerufen, wenn die auktionsuhr abgelaufen ist. */
  finishAuction() {
    const a = this.auction;
    if (!a) return this.drainEvents();
    this.auction = null;
    const tile = this.map.tiles[a.tile];
    const winner = a.bidderId ? this.player(a.bidderId) : null;
    if (winner && !winner.bankrupt && winner.money >= a.bid) {
      winner.money -= a.bid;
      this.tiles[a.tile].owner = winner.id;
      this.tiles[a.tile].level = 0;
      this.emit({ type: 'buy', playerId: winner.id, tile: a.tile, price: a.bid });
      this.say(`${winner.name} won ${tile.name} at auction for ${this.fmt(a.bid)}`, 'auction');
    } else {
      this.say(`Nobody bid on ${tile.name}`, 'auction');
    }
    this.settleTurnPhase();
    this.version++;
    return this.drainEvents();
  }

  endTurn(p) {
    this.requireTurn(p);
    this.requireNoBlockers();
    if (this.turn.phase === 'roll') throw new GameError("You can't do it now. Roll the dice first.");
    if (this.turn.phase === 'buy') throw new GameError('Buy or skip the property first');
    this.nextTurn();
  }

  nextTurn() {
    if (this.checkEnd()) return;
    const order = this.players;
    let index = order.findIndex(x => x.id === this.turn.playerId);
    for (let guard = 0; guard < order.length * 4; guard++) {
      index = (index + 1) % order.length;
      if (index === 0) {
        this.round++;
        if (this.settings.roundLimit && this.round > this.settings.roundLimit) {
          this.say(`Round limit of ${this.settings.roundLimit} reached`, 'turn');
          this.finish();
          return;
        }
      }
      const next = order[index];
      if (next.bankrupt) continue;
      next.shield = false;
      next.boost = false;
      this.stats.turns++;
      if (next.skipTurns > 0) {
        next.skipTurns--;
        this.say(`${next.name} skips this turn`, 'turn');
        continue;
      }
      this.turn = this.freshTurn(next.id, this.stats.turns);
      next.doublesInARow = 0;
      this.card = null;
      this.recordNetWorth();
      this.emit({ type: 'turn', playerId: next.id });
      return;
    }
  }

  freshTurn(playerId, number) {
    return { playerId, phase: 'roll', dice: null, again: false, rolls: 0, jailed: false, number, startedAt: this.now() };
  }

  // ---- bauen und verwalten -----------------------------------------------

  ownTile(p, index) {
    const tile = this.map.tiles[index];
    const state = this.tiles[index];
    if (!tile || !state) throw new GameError('This is not a property');
    if (state.owner !== p.id) throw new GameError("You don't own this property.");
    return { tile, state };
  }

  canManage(p) {
    return this.turn.playerId === p.id || this.debtOf(p.id) > 0;
  }

  upgradeError(p, index) {
    const tile = this.map.tiles[index];
    const state = this.tiles[index];
    if (tile?.type !== 'city') return 'This property is not a city';
    if (state.owner !== p.id) return "You don't own this property.";
    if (this.turn.playerId !== p.id) return 'You can only build on your turn';
    if (this.auction) return 'Wait for the auction to finish';
    if (this.debtOf(p.id) > 0) return 'Pay your debt first';
    if (!this.ownsGroup(p.id, tile.group)) return `You must own every property of the set in order to start building ${word(this.map, 'houses', 'houses')} and ${word(this.map, 'hotels', 'hotels')}.`;
    const group = this.info.groups[tile.group];
    if (group.some(i => this.tiles[i].mortgaged)) return "You can't upgrade properties in sets that have mortgaged properties in them.";
    if (state.level >= 5) return 'The requested level is invalid.';
    if (this.settings.evenBuild && state.level > Math.min(...group.map(i => this.tiles[i].level))) return 'You have to evenly upgrade properties in this set';
    if (p.money < tile.house) return "You don't have enough money to upgrade this property";
    return null;
  }

  upgrade(p, { tile: index }) {
    const error = this.upgradeError(p, index);
    if (error) throw new GameError(error);
    const tile = this.map.tiles[index];
    const state = this.tiles[index];
    p.money -= tile.house;
    state.level++;
    this.emit({ type: 'upgrade', playerId: p.id, tile: index, level: state.level });
    this.say(`${p.name} built ${state.level === 5 ? `a ${word(this.map, 'hotel', 'hotel')}` : `an ${word(this.map, 'house', 'house')}`} on ${tile.name}`, 'build');
  }

  downgradeError(p, index) {
    const tile = this.map.tiles[index];
    const state = this.tiles[index];
    if (tile?.type !== 'city') return 'This property is not a city';
    if (state.owner !== p.id) return "You don't own this property.";
    if (!this.canManage(p)) return 'You can only do this on your turn';
    if (state.level === 0) return 'The requested level is invalid.';
    const group = this.info.groups[tile.group];
    if (this.settings.evenBuild && state.level < Math.max(...group.map(i => this.tiles[i].level))) return 'You have to evenly downgrade properties in this set';
    return null;
  }

  downgrade(p, { tile: index }) {
    const error = this.downgradeError(p, index);
    if (error) throw new GameError(error);
    const tile = this.map.tiles[index];
    const state = this.tiles[index];
    state.level--;
    const refund = Math.floor(tile.house / 2);
    this.credit(p, refund);
    this.emit({ type: 'upgrade', playerId: p.id, tile: index, level: state.level });
    this.say(`${p.name} sold an ${word(this.map, 'house', 'house')} on ${tile.name} for ${this.fmt(refund)}`, 'build');
  }

  /** Alle straßen eines sets um genau eine stufe hochziehen; immer die niedrigsten, damit evenBuild gilt. */
  upgradeGroup(p, { group }) {
    const list = this.setIndices(group);
    const levels = list.map(i => this.tiles[i].level);
    if (Math.min(...levels) >= 5) throw new GameError('This set is already fully upgraded');
    const floor = Math.min(...levels);
    let count = 0;
    let spent = 0;
    for (const index of list) {
      if (this.tiles[index].level !== floor) continue;
      if (this.upgradeError(p, index)) continue;
      const cost = this.map.tiles[index].house;
      p.money -= cost;
      spent += cost;
      this.tiles[index].level++;
      this.emit({ type: 'upgrade', playerId: p.id, tile: index, level: this.tiles[index].level });
      count++;
    }
    if (!count) {
      // nur die fehler der straßen melden, die jetzt dran wären
      const why = list.filter(i => this.tiles[i].level === floor).map(i => this.upgradeError(p, i)).find(Boolean);
      throw new GameError(why ?? list.map(i => this.upgradeError(p, i)).find(Boolean) ?? 'Nothing to upgrade');
    }
    this.say(`${p.name} upgraded the whole ${this.setName(group)} set (${count}×, ${this.fmt(spent)})`, 'build');
  }

  /** Gegenstück: alle straßen eines sets um eine stufe zurückbauen; immer die höchsten zuerst. */
  downgradeGroup(p, { group }) {
    const list = this.setIndices(group);
    const top = Math.max(...list.map(i => this.tiles[i].level));
    if (top <= 0) throw new GameError('There is nothing to downgrade in this set');
    let count = 0;
    let refunded = 0;
    for (const index of list) {
      if (this.tiles[index].level !== top) continue;
      if (this.downgradeError(p, index)) continue;
      this.tiles[index].level--;
      const refund = Math.floor(this.map.tiles[index].house / 2);
      this.credit(p, refund);
      refunded += refund;
      this.emit({ type: 'upgrade', playerId: p.id, tile: index, level: this.tiles[index].level });
      count++;
    }
    if (!count) {
      const why = list.filter(i => this.tiles[i].level === top).map(i => this.downgradeError(p, i)).find(Boolean);
      throw new GameError(why ?? list.map(i => this.downgradeError(p, i)).find(Boolean) ?? 'Nothing to downgrade');
    }
    this.say(`${p.name} downgraded the whole ${this.setName(group)} set (${count}×, +${this.fmt(refunded)})`, 'build');
  }

  setIndices(group) {
    const list = typeof group === 'string' ? this.info.groups[group] : null;
    if (!list?.length) throw new GameError('Unknown property set');
    return list;
  }

  setName(group) {
    return this.map.groups[group]?.placeholder ?? group;
  }

  setHasBuildings(index) {
    const tile = this.map.tiles[index];
    if (tile.type !== 'city') return false;
    return this.info.groups[tile.group].some(i => this.tiles[i].level > 0);
  }

  sellError(p, index) {
    const state = this.tiles[index];
    if (!state) return 'This is not a property';
    if (state.owner !== p.id) return "You don't own this property.";
    if (!this.canManage(p)) return 'You can only do this on your turn';
    if (this.setHasBuildings(index)) return "You can't sell a property if its set has buildings on it. Downgrade them first.";
    return null;
  }

  sell(p, { tile: index }) {
    const error = this.sellError(p, index);
    if (error) throw new GameError(error);
    const tile = this.map.tiles[index];
    const state = this.tiles[index];
    const refund = state.mortgaged ? 0 : Math.floor(tile.price / 2);
    Object.assign(state, { owner: null, level: 0, mortgaged: false });
    this.cancelTradesWith(index);
    this.credit(p, refund);
    this.emit({ type: 'sell', playerId: p.id, tile: index });
    this.say(`${p.name} sold ${tile.name} to the bank for ${this.fmt(refund)}`, 'build');
  }

  mortgageError(p, index) {
    const state = this.tiles[index];
    if (!this.settings.mortgage) return 'Mortgages are turned off in this room';
    if (!state) return 'This is not a property';
    if (state.owner !== p.id) return "You don't own this property.";
    if (!this.canManage(p)) return 'You can only do this on your turn';
    if (state.mortgaged) return 'This property is already mortgaged';
    if (this.setHasBuildings(index)) return "You can't mortgage properties of a set that has buildings in it.";
    return null;
  }

  mortgage(p, { tile: index }) {
    const error = this.mortgageError(p, index);
    if (error) throw new GameError(error);
    const tile = this.map.tiles[index];
    this.tiles[index].mortgaged = true;
    const loan = Math.floor(tile.price / 2);
    this.credit(p, loan);
    this.emit({ type: 'mortgage', playerId: p.id, tile: index });
    this.say(`${p.name} mortgaged ${tile.name} for ${this.fmt(loan)}`, 'build');
  }

  unmortgageCost(index) {
    return Math.floor(Math.floor(this.map.tiles[index].price / 2) * 1.1);
  }

  unmortgageError(p, index) {
    const state = this.tiles[index];
    if (!state) return 'This is not a property';
    if (state.owner !== p.id) return "You don't own this property.";
    if (this.turn.playerId !== p.id) return 'You can only do this on your turn';
    if (!state.mortgaged) return 'This property is not mortgaged';
    if (this.debtOf(p.id) > 0) return 'Pay your debt first';
    if (p.money < this.unmortgageCost(index)) return "You don't have enough money to lift the mortgage";
    return null;
  }

  unmortgage(p, { tile: index }) {
    const error = this.unmortgageError(p, index);
    if (error) throw new GameError(error);
    const cost = this.unmortgageCost(index);
    p.money -= cost;
    this.tiles[index].mortgaged = false;
    this.emit({ type: 'mortgage', playerId: p.id, tile: index });
    this.say(`${p.name} lifted the mortgage on ${this.map.tiles[index].name} for ${this.fmt(cost)}`, 'build');
  }

  // ---- geld --------------------------------------------------------------

  /** Geld gutschreiben und damit zuerst offene schulden begleichen. */
  credit(p, amount) {
    p.money += amount;
    for (const debt of this.debts.filter(d => d.from === p.id)) {
      if (p.money <= 0) break;
      const part = Math.min(p.money, debt.amount);
      p.money -= part;
      debt.amount -= part;
      this.receive(debt.to, part, debt.pot);
    }
    const before = this.debts.length;
    this.debts = this.debts.filter(d => d.amount > 0);
    if (before !== this.debts.length && !this.debts.some(d => d.from === p.id)) {
      this.say(`${p.name} paid off the debt`, 'money');
    }
  }

  receive(toId, amount, pot) {
    if (amount <= 0) return;
    if (toId) {
      const to = this.player(toId);
      if (to && !to.bankrupt) this.credit(to, amount);
    } else if (pot) {
      this.vacationPot += amount;
    }
  }

  /**
   * Zahlung an spieler oder bank. Reicht das bargeld nicht, bekommt der gläubiger
   * sofort was da ist und der rest wird schuld (wie richup).
   */
  pay(from, toId, amount, { pot = false } = {}) {
    if (amount <= 0) return;
    const paid = Math.min(Math.max(from.money, 0), amount);
    from.money -= paid;
    this.receive(toId, paid, pot);
    this.emit({ type: 'money', from: from.id, to: toId, amount });
    if (paid < amount) {
      this.debts.push({ from: from.id, to: toId, amount: amount - paid, pot });
      this.say(`${from.name} owes ${this.fmt(amount - paid)}${toId ? ` to ${this.player(toId).name}` : ''}`, 'debt');
    }
  }

  payBank(from, amount, { pot = false } = {}) {
    this.pay(from, null, amount, { pot: pot && this.settings.vacationCash });
  }

  bankrupt(p) {
    this.goBankrupt(p, 'bankrupt');
  }

  /** Bankrott oder ausscheiden: gläubiger bekommt bis zum liquidationswert, rest an bank/team. */
  goBankrupt(p, reason = 'bankrupt') {
    if (p.bankrupt) return;
    const myDebts = this.debts.filter(d => d.from === p.id);
    const mate = this.teams ? this.alive.find(x => x.id !== p.id && x.team === p.team) : null;
    this.debts = this.debts.filter(d => d.from !== p.id);
    this.trades = this.trades.filter(t => t.from !== p.id && t.to !== p.id);
    if (this.auction?.bidderId === p.id) {
      this.auction.bidderId = null;
      this.auction.bid = 0;
    }

    if (mate) {
      // teams: das erbe geht an den mitspieler
      let rest = p.money;
      for (const debt of myDebts) {
        const part = Math.min(rest, debt.amount);
        rest -= part;
        this.receive(debt.to, part, debt.pot);
      }
      for (const i of this.owned(p.id)) this.tiles[i].owner = mate.id;
      mate.pardons.push(...p.pardons);
      for (const deck of p.pardons) this.decks[deck].pardonHolder = mate.id;
      if (rest > 0) this.credit(mate, rest);
    } else {
      let pool = this.liquidationValue(p.id);
      for (const debt of myDebts) {
        const part = Math.min(pool, debt.amount);
        pool -= part;
        this.receive(debt.to, part, debt.pot);
      }
      for (const i of this.owned(p.id)) Object.assign(this.tiles[i], { owner: null, level: 0, mortgaged: false });
      for (const deck of p.pardons) this.decks[deck].pardonHolder = null;
    }
    p.pardons = [];
    p.money = 0;
    p.bankrupt = true;
    p.leftReason = reason;
    p.prisonTurns = 0;
    this.emit({ type: 'bankrupt', playerId: p.id, reason });
    const why = reason === 'left' ? 'left the game' : reason === 'timeout' ? 'was removed for running out of time' : reason === 'kicked' ? 'was removed from the game' : 'went bankrupt';
    this.say(`${p.name} ${why}`, 'bankrupt');
    if (this.checkEnd()) return;
    if (this.turn.playerId === p.id) this.nextTurn();
  }

  checkEnd() {
    if (this.phase !== 'playing') return true;
    const alive = this.alive;
    const sides = new Set(alive.map(p => (this.teams && p.team ? `team:${p.team}` : p.id)));
    if (sides.size <= 1) {
      this.finish();
      return true;
    }
    return false;
  }

  finish() {
    this.phase = 'over';
    this.auction = null;
    this.turn.phase = 'over';
    this.stats.endedAt = this.now();
    this.recordNetWorth();
    const standings = this.standings();
    const top = this.player(standings[0]);
    const team = this.teams ? top.team : null;
    this.winner = { playerIds: team ? this.players.filter(p => p.team === team).map(p => p.id) : [top.id], team };
    this.emit({ type: 'over', winner: this.winner });
    this.say(team ? `Team ${team} wins the game` : `${top.name} wins the game`, 'over');
  }

  /** Gewinner zuerst: überlebende nach gesamtwert, dann die ausgeschiedenen. */
  standings() {
    return this.players
      .map(p => p.id)
      .sort((a, b) => Number(this.player(a).bankrupt) - Number(this.player(b).bankrupt) || this.netWorth(b) - this.netWorth(a));
  }

  // ---- bewegung ----------------------------------------------------------

  moveBy(p, steps, { collectGo = true, resolve = true, mode = 'walk' } = {}) {
    const n = this.info.size;
    const from = p.position;
    const to = (((from + steps) % n) + n) % n;
    p.position = to;
    this.emit({ type: 'move', playerId: p.id, from, to, steps, mode });
    if (steps > 0 && collectGo) {
      const goAhead = (this.info.go - from + n) % n || n;
      if (steps >= goAhead) {
        const landed = to === this.info.go;
        const reward = landed ? this.map.rewards.land : this.map.rewards.pass;
        this.credit(p, reward);
        this.emit({ type: 'money', from: null, to: p.id, amount: reward });
        this.say(`${p.name} ${landed ? 'landed on' : 'passed'} ${this.map.tiles[this.info.go].name} and collected ${this.fmt(reward)}`, 'money');
      }
    }
    if (resolve) this.land(p, this.turn.dice ? this.turn.dice[0] + this.turn.dice[1] : 7);
  }

  moveTo(p, target, opts = {}) {
    const n = this.info.size;
    this.moveBy(p, (target - p.position + n) % n || n, { mode: 'jump', ...opts });
  }

  sendToPrison(p) {
    const from = p.position;
    p.position = this.info.prison;
    p.prisonTurns = this.map.prison.turns;
    p.doublesInARow = 0;
    this.turn.again = false;
    if (this.turn.playerId === p.id) this.turn.jailed = true;
    this.stats.prisonVisits[p.id] = (this.stats.prisonVisits[p.id] ?? 0) + 1;
    this.emit({ type: 'move', playerId: p.id, from, to: p.position, steps: 0, mode: 'prison' });
    this.say(`${p.name} was sent to ${word(this.map, 'prison', 'prison')}`, 'prison');
  }

  land(p, diceTotal) {
    const index = p.position;
    const tile = this.map.tiles[index];
    this.stats.heat[index]++;
    switch (tile.type) {
      case 'corner':
        if (tile.corner === 'goToPrison') this.sendToPrison(p);
        else if (tile.corner === 'vacation') this.goVacation(p);
        return;
      case 'tax': {
        const amount = tile.percent ? Math.round((Math.max(p.money, 0) * tile.percent) / 100) : tile.amount;
        this.say(`${p.name} paid ${this.fmt(amount)} for ${tile.name}`, 'money');
        this.payBank(p, amount, { pot: true });
        return;
      }
      case 'treasure':
      case 'surprise':
        this.draw(p, tile.type);
        return;
      case 'city':
      case 'airport':
      case 'company':
        this.landOnProperty(p, index, diceTotal);
        return;
      default:
    }
  }

  goVacation(p) {
    p.skipTurns += this.map.vacation.turns;
    this.say(`${p.name} went to ${this.map.tiles[this.info.vacation].name}`, 'vacation');
    if (this.vacationPot > 0) {
      const pot = this.vacationPot;
      this.vacationPot = 0;
      this.credit(p, pot);
      this.emit({ type: 'money', from: null, to: p.id, amount: pot });
      this.say(`${p.name} collected the pot of ${this.fmt(pot)}`, 'money');
    }
  }

  landOnProperty(p, index, diceTotal) {
    const tile = this.map.tiles[index];
    const state = this.tiles[index];
    if (state.owner === null) {
      if (this.turn.playerId === p.id) this.turn.phase = 'buy';
      return;
    }
    if (state.owner === p.id) return;
    const owner = this.player(state.owner);
    if (state.mortgaged) return this.say(`${tile.name} is mortgaged, no rent`);
    if (this.teammates(p.id, owner.id)) return this.say(`${p.name} visits a teammate, no rent`);
    if (this.settings.noRentPaymentsWhileInPrison && owner.prisonTurns > 0) return this.say(`${owner.name} is in ${word(this.map, 'prison', 'prison')}, no rent`);
    if (p.shield) return this.say(`${p.name} is protected by slowmode, no rent`);
    const rent = this.rentFor(index, diceTotal);
    if (rent <= 0) return;
    this.say(`${p.name} paid ${this.fmt(rent)} rent to ${owner.name}`, 'rent');
    this.pay(p, owner.id, rent);
  }

  // ---- karten ------------------------------------------------------------

  draw(p, deckName) {
    const deck = this.decks[deckName];
    if (!deck.cards.length) return;
    // stapel durch: neu mischen statt die alte reihenfolge zu wiederholen
    if (deck.index >= deck.order.length) {
      deck.order = shuffle(deck.cards.map((_, i) => i), this.rand);
      deck.index = 0;
      this.say(`The ${word(this.map, deckName, deckName)} cards are reshuffled`, 'card');
    }
    let card = null;
    for (let tries = 0; tries < deck.cards.length; tries++) {
      const candidate = deck.cards[deck.order[deck.index % deck.order.length]];
      deck.index++;
      if (candidate.effect.type === 'pardon' && deck.pardonHolder) continue;
      card = candidate;
      break;
    }
    if (!card) return;
    const target = this.cardTarget(p, card.effect);
    const text = card.text.replaceAll('{player}', target?.name ?? 'someone');
    this.card = { deck: deckName, text, playerId: p.id, crazy: !(this.map.cards[deckName] ?? []).includes(card) };
    this.emit({ type: 'card', deck: deckName, text, playerId: p.id, crazy: this.card.crazy });
    this.say(`${p.name} drew a ${word(this.map, deckName, deckName)} card: ${text}`, 'card');
    this.applyCard(p, card.effect, deckName, target);
  }

  /** Für karten mit {player}: wen trifft es? */
  cardTarget(p, effect) {
    const others = this.alive.filter(x => x.id !== p.id);
    if (!others.length) return null;
    switch (effect.type) {
      case 'stealPercent':
      case 'robinHood':
        return others.slice().sort((a, b) => this.netWorth(b.id) - this.netWorth(a.id))[0];
      case 'griefUpgrade': {
        const builders = others.filter(o => this.owned(o.id).some(i => this.tiles[i].level > 0));
        return builders.length ? builders.sort((a, b) => this.netWorth(b.id) - this.netWorth(a.id))[0] : others[0];
      }
      case 'swapRandom':
        return pick(others, this.rand);
      default:
        return null;
    }
  }

  applyCard(p, effect, deckName, target) {
    const others = this.alive.filter(x => x.id !== p.id);
    switch (effect.type) {
      case 'money':
        if (effect.amount < 0) return this.payBank(p, -effect.amount, { pot: true });
        this.credit(p, effect.amount);
        this.emit({ type: 'money', from: null, to: p.id, amount: effect.amount });
        return;
      case 'moveTo':
        return this.moveTo(p, effect.tile, { collectGo: effect.collectGo !== false });
      case 'moveSteps':
        return this.moveBy(p, effect.steps, { collectGo: effect.steps > 0, mode: Math.abs(effect.steps) > 6 ? 'jump' : 'walk' });
      case 'nextOfType': {
        const list = effect.tileType === 'airport' ? this.info.airports : this.info.companies;
        if (!list.length) return;
        const n = this.info.size;
        const next = list.slice().sort((a, b) => ((a - p.position + n) % n || n) - ((b - p.position + n) % n || n))[0];
        return this.moveTo(p, next);
      }
      case 'prison':
        this.sendToPrison(p);
        return;
      case 'pardon':
        p.pardons.push(deckName);
        this.decks[deckName].pardonHolder = p.id;
        return;
      case 'payEach':
        for (const o of others) {
          if (!this.teammates(p.id, o.id)) this.pay(p, o.id, effect.amount);
        }
        return;
      case 'collectEach':
        for (const o of others) {
          if (!this.teammates(p.id, o.id)) this.pay(o, p.id, effect.amount);
        }
        return;
      case 'repairs': {
        let cost = 0;
        for (const i of this.owned(p.id)) {
          const level = this.tiles[i].level;
          cost += level === 5 ? effect.perHotel : level * effect.perHouse;
        }
        if (cost > 0) this.payBank(p, cost, { pot: true });
        else this.say(`${p.name} has nothing to pay for`);
        return;
      }
      // ---- verrückte karten --------------------------------------------
      case 'boost':
        p.boost = true;
        return;
      case 'shield':
        p.shield = true;
        return;
      case 'skipTurn':
        p.skipTurns += effect.turns ?? 1;
        return;
      case 'goToVacation':
        return this.moveTo(p, this.info.vacation, { collectGo: true });
      case 'teleportRandom': {
        const choices = this.map.tiles.map((_, i) => i).filter(i => i !== p.position && i !== this.info.goToPrison);
        return this.moveTo(p, pick(choices, this.rand), { collectGo: false });
      }
      case 'swapRandom': {
        if (!target) return;
        const mine = p.position;
        p.position = target.position;
        target.position = mine;
        this.emit({ type: 'move', playerId: p.id, from: mine, to: p.position, steps: 0, mode: 'jump' });
        this.emit({ type: 'move', playerId: target.id, from: p.position, to: mine, steps: 0, mode: 'jump' });
        return;
      }
      case 'moveOthers':
        for (const o of others) this.moveBy(o, effect.steps, { collectGo: false, resolve: false, mode: 'jump' });
        return;
      case 'stealPercent': {
        if (!target) return;
        const amount = Math.floor((Math.max(target.money, 0) * effect.percent) / 100);
        if (amount > 0) this.pay(target, p.id, amount);
        return;
      }
      case 'robinHood': {
        if (!target) return;
        const poorest = this.alive.slice().sort((a, b) => this.netWorth(a.id) - this.netWorth(b.id))[0];
        if (poorest.id !== target.id) this.pay(target, poorest.id, effect.amount);
        return;
      }
      case 'everyonePaysPot':
        for (const o of this.alive) this.pay(o, null, effect.amount, { pot: true });
        return;
      case 'payPerProperty': {
        const cost = this.owned(p.id).length * effect.amount;
        if (cost > 0) this.payBank(p, cost, { pot: true });
        return;
      }
      case 'freeUpgrade': {
        const options = this.owned(p.id).filter(i => {
          const tile = this.map.tiles[i];
          if (tile.type !== 'city' || this.tiles[i].level >= 5 || !this.ownsGroup(p.id, tile.group)) return false;
          const group = this.info.groups[tile.group];
          if (group.some(j => this.tiles[j].mortgaged)) return false;
          return !this.settings.evenBuild || this.tiles[i].level === Math.min(...group.map(j => this.tiles[j].level));
        });
        if (!options.length) {
          this.credit(p, 100);
          this.say(`${p.name} had nothing to upgrade and got ${this.fmt(100)} instead`, 'money');
          return;
        }
        const best = options.sort((a, b) => this.map.tiles[b].price - this.map.tiles[a].price)[0];
        this.tiles[best].level++;
        this.emit({ type: 'upgrade', playerId: p.id, tile: best, level: this.tiles[best].level });
        return;
      }
      case 'griefUpgrade':
      case 'griefSelf': {
        const victim = effect.type === 'griefSelf' ? p : target;
        if (!victim) return;
        const built = this.owned(victim.id).filter(i => this.tiles[i].level > 0).sort((a, b) => this.tiles[b].level - this.tiles[a].level);
        if (!built.length) {
          this.say(`${victim.name} had nothing to blow up`);
          return;
        }
        this.tiles[built[0]].level--;
        this.emit({ type: 'upgrade', playerId: victim.id, tile: built[0], level: this.tiles[built[0]].level });
        return;
      }
      case 'claimFree': {
        const free = this.tiles.flatMap((t, i) => (t && t.owner === null ? [i] : [])).sort((a, b) => this.map.tiles[a].price - this.map.tiles[b].price);
        if (!free.length) {
          this.credit(p, 200);
          this.say(`Nothing left to claim, ${p.name} got ${this.fmt(200)} instead`, 'money');
          return;
        }
        this.tiles[free[0]].owner = p.id;
        this.emit({ type: 'buy', playerId: p.id, tile: free[0], price: 0 });
        this.say(`${p.name} claimed ${this.map.tiles[free[0]].name}`, 'buy');
        return;
      }
      default:
    }
  }

  // ---- handel ------------------------------------------------------------

  sideValue(side) {
    return side.money + side.tiles.reduce((s, i) => s + (this.tiles[i].mortgaged ? 0 : this.map.tiles[i].price), 0) + side.pardons.length * PARDON_VALUE;
  }

  normalizeSide(side) {
    const s = side ?? {};
    const tiles = Array.isArray(s.tiles) ? [...new Set(s.tiles)] : [];
    const pardons = Array.isArray(s.pardons) ? [...new Set(s.pardons)] : [];
    const amount = s.money ?? 0;
    if (!Number.isInteger(amount) || amount < 0) throw new GameError('Invalid amount of money');
    if (!tiles.every(i => Number.isInteger(i) && this.tiles[i])) throw new GameError('Invalid property in trade');
    if (!pardons.every(d => d === 'treasure' || d === 'surprise')) throw new GameError('Invalid card in trade');
    return { money: amount, tiles, pardons };
  }

  validateTradeSide(owner, side) {
    for (const i of side.tiles) {
      if (this.tiles[i].owner !== owner.id) throw new GameError(`${owner.name} doesn't own ${this.map.tiles[i].name}`);
      if (this.setHasBuildings(i)) throw new GameError(`Sell the buildings in the set of ${this.map.tiles[i].name} first`);
    }
    for (const d of side.pardons) {
      if (!owner.pardons.includes(d)) throw new GameError(`${owner.name} doesn't have that card`);
    }
    if (side.money > owner.money) throw new GameError(`${owner.name} doesn't have enough money`);
  }

  tradeCreate(p, { to, give, take, note }) {
    const other = this.player(to);
    if (!other || other.bankrupt || other.id === p.id) throw new GameError('Choose another player to trade with');
    const offer = { give: this.normalizeSide(give), take: this.normalizeSide(take) };
    if (!offer.give.money && !offer.give.tiles.length && !offer.give.pardons.length && !offer.take.money && !offer.take.tiles.length && !offer.take.pardons.length) {
      throw new GameError("You can't send an empty trade");
    }
    this.validateTradeSide(p, offer.give);
    this.validateTradeSide(other, offer.take);
    const pending = this.trades.filter(t => (t.from === p.id && t.to === other.id) || (t.from === other.id && t.to === p.id)).length;
    if (pending >= MAX_TRADES_PER_PAIR) throw new GameError('Too many pending trades with this player');
    this.checkFairness(p, offer.give, offer.take);
    const trade = { id: ++this.tradeSeq, from: p.id, to: other.id, ...offer, note: String(note ?? '').slice(0, 140), at: this.now() };
    this.trades.push(trade);
    this.emit({ type: 'trade', id: trade.id, from: p.id, to: other.id, state: 'new' });
    const noteText = trade.note ? ` — “${trade.note}”` : '';
    this.say(`${p.name} offered ${other.name} a trade: ${this.sideText(trade.give)} for ${this.sideText(trade.take)}${noteText}`, 'trade');
    return trade;
  }

  /** Schutz in öffentlichen räumen gegen verschenken und schulden-flucht. */
  checkFairness(giver, give, take) {
    if (this.settings.isPrivate) return;
    const net = this.sideValue(give) - this.sideValue(take);
    if (net > 0 && net > GIFT_LIMIT * Math.max(this.netWorth(giver.id), 0)) throw new GameError('This trade gives away too much of your net worth');
  }

  findTrade(id) {
    const trade = this.trades.find(t => t.id === id);
    if (!trade) throw new GameError('This trade no longer exists');
    return trade;
  }

  tradeAccept(p, { id }) {
    const trade = this.findTrade(id);
    if (trade.to !== p.id) throw new GameError('This trade is not for you');
    const from = this.player(trade.from);
    this.validateTradeSide(from, trade.give);
    this.validateTradeSide(p, trade.take);
    this.checkFairness(from, trade.give, trade.take);
    this.checkFairness(p, trade.take, trade.give);
    this.trades = this.trades.filter(t => t.id !== id);
    this.transfer(from, p, trade.give);
    this.transfer(p, from, trade.take);
    this.stats.trades++;
    this.emit({ type: 'trade', id, from: trade.from, to: trade.to, state: 'accepted', give: trade.give, take: trade.take });
    this.say(`${from.name} gave ${this.sideText(trade.give)} to ${p.name} and got ${this.sideText(trade.take)} back`, 'trade');
    // handel kann eigentumsverhältnisse ändern, die andere angebote ungültig machen
    this.trades = this.trades.filter(t => {
      try {
        this.validateTradeSide(this.player(t.from), t.give);
        this.validateTradeSide(this.player(t.to), t.take);
        return true;
      } catch {
        return false;
      }
    });
  }

  transfer(from, to, side) {
    for (const i of side.tiles) this.tiles[i].owner = to.id;
    for (const d of side.pardons) {
      from.pardons.splice(from.pardons.indexOf(d), 1);
      to.pardons.push(d);
      this.decks[d].pardonHolder = to.id;
    }
    if (side.money) {
      from.money -= side.money;
      this.credit(to, side.money);
    }
  }

  /** Was in einer handelsseite steckt, in worten. */
  sideText(side) {
    const bits = [];
    if (side.money) bits.push(this.fmt(side.money));
    for (const i of side.tiles) bits.push(this.map.tiles[i]?.name ?? 'a property');
    for (const d of side.pardons) bits.push(pardonName(this.map, d));
    return bits.length ? bits.join(', ') : 'nothing';
  }

  tradeDecline(p, { id }) {
    const trade = this.findTrade(id);
    if (trade.to !== p.id && trade.from !== p.id) throw new GameError('This trade is not for you');
    this.trades = this.trades.filter(t => t.id !== id);
    const cancelled = trade.from === p.id;
    this.emit({ type: 'trade', id, from: trade.from, to: trade.to, state: cancelled ? 'cancelled' : 'declined' });
    this.say(cancelled
      ? `${p.name} took back the offer to ${this.player(trade.to).name} (${this.sideText(trade.give)} for ${this.sideText(trade.take)})`
      : `${p.name} declined ${this.player(trade.from).name}'s offer (${this.sideText(trade.give)} for ${this.sideText(trade.take)})`, 'trade');
  }

  cancelTradesWith(index) {
    this.trades = this.trades.filter(t => !t.give.tiles.includes(index) && !t.take.tiles.includes(index));
  }

  // ---- ansicht -----------------------------------------------------------

  /** Was ein spieler gerade mit seinen grundstücken tun darf. */
  permissions(playerId) {
    const p = this.player(playerId);
    const can = { upgrade: [], downgrade: [], sell: [], mortgage: [], unmortgage: [] };
    if (!p || p.bankrupt || this.phase !== 'playing') return can;
    for (const i of this.owned(p.id)) {
      if (!this.upgradeError(p, i)) can.upgrade.push(i);
      if (!this.downgradeError(p, i)) can.downgrade.push(i);
      if (!this.sellError(p, i)) can.sell.push(i);
      if (!this.mortgageError(p, i)) can.mortgage.push(i);
      if (!this.unmortgageError(p, i)) can.unmortgage.push(i);
    }
    return can;
  }

  /** Öffentlicher zustand, für einen zuschauer oder spieler zugeschnitten. */
  snapshot(viewerId = null) {
    const n = this.info.size;
    return {
      version: this.version,
      phase: this.phase,
      round: this.round,
      mapId: this.map.id,
      turn: { ...this.turn },
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        team: p.team,
        appearance: p.appearance,
        money: p.money,
        debt: this.debtOf(p.id),
        netWorth: this.netWorth(p.id),
        position: p.position,
        bankrupt: p.bankrupt,
        leftReason: p.leftReason,
        prisonTurns: p.prisonTurns,
        skipTurns: p.skipTurns,
        pardons: p.pardons.slice(),
        shield: p.shield,
        boost: p.boost,
      })),
      tiles: this.tiles.map((t, i) => (t ? { ...t, rent: this.rentFor(i) } : null)),
      auction: this.auction ? { ...this.auction } : null,
      debts: this.debts.map(d => ({ ...d })),
      // offene angebote sieht der ganze tisch (wie bei richup), antworten dürfen nur die beiden beteiligten
      trades: this.trades.map(t => structuredClone(t)),
      vacationPot: this.vacationPot,
      card: this.card,
      winner: this.winner,
      log: this.log.slice(-60),
      stats: { ...this.stats, heat: this.stats.heat.slice(0, n) },
      prisonFine: this.map.prison.fine,
      can: viewerId ? this.permissions(viewerId) : null,
      unmortgageCosts: Object.fromEntries(this.tiles.flatMap((t, i) => (t?.mortgaged ? [[i, this.unmortgageCost(i)]] : []))),
    };
  }
}

/** Startgeld je spieler; bei teams mit ausgleich bekommen kleinere teams mehr. */
function startingCash(players, settings) {
  const cash = new Map(players.map(p => [p.id, settings.startingCash]));
  if (settings.teams?.enabled && settings.teams.balanceStartCash) {
    const sizes = {};
    for (const p of players) sizes[p.team] = (sizes[p.team] ?? 0) + 1;
    const largest = Math.max(...Object.values(sizes));
    for (const p of players) cash.set(p.id, Math.round((settings.startingCash * largest) / sizes[p.team]));
  }
  return cash;
}

const ACTIONS = {
  roll(p) { this.roll(p); },
  buy(p) { this.buy(p); },
  decline(p) { this.decline(p); },
  bid(p, a) { this.bid(p, a); },
  endTurn(p) { this.endTurn(p); },
  payPrison(p) { this.payPrison(p); },
  usePardon(p, a) { this.usePardon(p, a); },
  upgrade(p, a) { this.upgrade(p, a); },
  downgrade(p, a) { this.downgrade(p, a); },
  upgradeGroup(p, a) { this.upgradeGroup(p, a); },
  downgradeGroup(p, a) { this.downgradeGroup(p, a); },
  sell(p, a) { this.sell(p, a); },
  mortgage(p, a) { this.mortgage(p, a); },
  unmortgage(p, a) { this.unmortgage(p, a); },
  bankrupt(p) { this.bankrupt(p); },
  tradeCreate(p, a) { this.tradeCreate(p, a); },
  tradeAccept(p, a) { this.tradeAccept(p, a); },
  tradeDecline(p, a) { this.tradeDecline(p, a); },
};
