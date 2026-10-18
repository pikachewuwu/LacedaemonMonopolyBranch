// der spielraum: brett in der mitte, chat links, spieler/handel/einstellungen rechts

import { h, renderIf, wait } from './dom.js';
import { Board } from './board.js';
import { Dice } from './dice.js';
import { LOGO, UI, pawnSvg } from './icons.js';
import { groupTiles, isOwnable, money, pardonName, word } from './format.js';
import { closeModal, modalOpen, openModal, toast } from './modal.js';
import { createTradeDialog, groupDialog, setBuildPanel, statsDialog, tileDialog, tradeSummary, viewTradeDialog } from './dialogs.js';
import { isMuted, setMuted, sound } from './sound.js';
import { confetti } from './confetti.js';
import { Fx } from './fx.js';
import { applyTheme, currentTheme, listThemes } from './themes.js';
import { BoardStrip } from './strip.js';
import { saveName, savedName } from './net.js';

export class RoomView {
  constructor(ctx, roomId) {
    this.ctx = ctx;
    this.roomId = roomId;
    this.room = null;
    this.map = null;
    this.queue = [];
    this.pumping = false;
    this.offset = 0;
    this.lastMoney = new Map();
    this.cardTimer = null;
    this.logTab = 'chat';
    this.seenChat = 0;
    this.board = new Board({ onTile: i => this.map && isOwnable(this.map.tiles[i]) && tileDialog(this, i) });
    this.dice = new Dice();
    this.fx = new Fx(this.board);
    this.build();
    this.ticker = setInterval(() => this.tick(), 200);
  }

  get me() { return this.room?.you.id; }

  get myPlayer() { return this.room?.game?.players.find(p => p.id === this.me) ?? null; }

  // ---- gerüst ------------------------------------------------------------

  build() {
    this.chatList = h('ol.chat-list', { 'aria-live': 'polite' });
    this.chatInput = h('input.input', { maxlength: 300, placeholder: 'Say something…', 'aria-label': 'Chat message' });
    const chatForm = h('form.chat-form', { onsubmit: e => {
      e.preventDefault();
      const text = this.chatInput.value.trim();
      if (!text) return;
      this.chatInput.value = '';
      this.ctx.net.ask('chat:send', { text }).catch(err => toast(err.message, 'bad'));
    } }, this.chatInput, h('button.icon-btn', { type: 'submit', 'aria-label': 'Send', html: UI.chat }));
    this.tabs = h('div.tabs',
      h('button.tab.is-on', { type: 'button', 'data-tab': 'chat', onclick: () => this.setTab('chat') }, 'Chat'),
      h('button.tab', { type: 'button', 'data-tab': 'log', onclick: () => this.setTab('log') }, 'Game log'));
    this.soundBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Sound', html: isMuted() ? UI.mute : UI.sound, onclick: () => {
      setMuted(!isMuted());
      this.soundBtn.innerHTML = isMuted() ? UI.mute : UI.sound;
    } });
    this.strip = new BoardStrip({ onTile: i => this.map && isOwnable(this.map.tiles[i]) && tileDialog(this, i) });
    this.lineBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Line view', title: 'Board view / line view', html: UI.strip, onclick: () => this.toggleLineView() });
    this.codeEl = h('span.room-code', this.roomId);
    this.left = h('aside.side.side-left',
      h('header.side-head',
        h('a.brand-mini', { href: '#/' }, h('img.brand-mark', { src: LOGO, alt: '' }), h('span', 'Lacedaemon')),
        h('div.side-tools', this.lineBtn, this.soundBtn,
          h('button.icon-btn', { type: 'button', 'aria-label': 'Board theme', html: UI.palette, onclick: () => this.themeDialog() }),
          h('button.icon-btn', { type: 'button', 'aria-label': 'Leave room', html: UI.door, onclick: () => this.leaveDialog() }))),
      h('section.panel.invite-panel',
        h('span.label', 'Room'),
        h('div.invite', this.codeEl, h('button.btn.btn-sm', { type: 'button', onclick: () => this.copyInvite() }, h('span.btn-icon', { html: UI.copy }), 'Copy invite link'))),
      h('section.panel.chat-panel', this.tabs, this.chatList, chatForm),
    );
    this.playersPanel = h('section.panel.players-panel');
    this.tradesPanel = h('section.panel.trades-panel');
    this.propsPanel = h('section.panel.props-panel');
    this.settingsPanel = h('section.panel.settings-panel');
    this.right = h('aside.side.side-right', this.playersPanel, this.tradesPanel, this.propsPanel, this.settingsPanel);

    this.stage = h('div.center-stage');
    this.cardSlot = h('div.center-card', { title: 'Click to close', onclick: () => this.hideCard() });
    this.status = h('div.center-status');
    this.miniLog = h('ol.center-log');
    this.board.center.append(
      h('div.center-brand', h('img.center-emblem', { src: LOGO, alt: '' }), h('span.center-logo', 'LACEDAEMON'), h('span.center-map')),
      this.status, this.dice.el, this.stage, this.cardSlot, this.miniLog,
    );
    this.boardArea = h('main.board-area', h('div.board-fit', this.board.el), this.strip.el);
    this.el = h('div.room-layout', this.left, this.boardArea, this.right);
  }

  /** brett oder eine zeile mit allen feldern; die zeile folgt dem spieler am zug. */
  toggleLineView() {
    this.lineView = !this.lineView;
    this.boardArea.classList.toggle('is-line', Boolean(this.lineView));
    if (this.lineView) this.boardArea.insertBefore(this.board.center, this.strip.el);
    else this.board.grid.append(this.board.center);
    this.strip.el.hidden = !this.lineView;
    this.lineBtn.classList.toggle('is-on', Boolean(this.lineView));
    if (this.lineView) this.strip.focusTurn(this.room?.game, { force: true });
  }

  setTab(tab) {
    this.logTab = tab;
    this.tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-on', t.dataset.tab === tab));
    this.chatList.dataset.key = '';
    this.renderChat();
  }

  /** Wer über einen link kommt, schaut erst zu und wählt dann name und figur. */
  async join({ asPlayer = false } = {}) {
    const appearance = this.ctx.appearance;
    const reply = await this.ctx.net.ask('room:join', { roomId: this.roomId, appearance, spectator: !asPlayer });
    return reply.role;
  }

  destroy() {
    clearInterval(this.ticker);
    clearTimeout(this.cardTimer);
    closeModal();
  }

  // ---- zustand und animation ---------------------------------------------

  async receive(message) {
    if (message.room.id !== this.roomId) return;
    this.offset = message.room.serverNow - Date.now();
    this.queue.push(message);
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift();
        await this.ensureMap(next.room.map.id);
        if (this.room) await this.play(next.events ?? [], this.queue.length > 2 || document.hidden);
        this.render(next.room);
      }
    } finally {
      this.pumping = false;
    }
  }

  async ensureMap(id) {
    if (this.map?.id === id) return;
    this.map = await this.ctx.loadMap(id);
    this.board.setMap(this.map);
    this.strip.setMap(this.map);
    this.board.center.querySelector('.center-map').textContent = this.map.name;
  }

  /** Farbe und name eines spielers aus dem letzten bekannten zustand. */
  who(id) {
    const p = this.room?.game?.players.find(x => x.id === id) ?? this.room?.participants.find(x => x.id === id);
    return { name: p?.name ?? '?', color: p?.appearance?.color ?? '#d6ad77' };
  }

  /** Effekte in der brettmitte zu den ereignissen. */
  async effect(e) {
    const fx = this.fx;
    const bank = { x: 50, y: 50 };
    if (e.type === 'turn') fx.turn(this.who(e.playerId).color);
    else if (e.type === 'dice' && e.dice[0] === e.dice[1]) fx.banner('DOUBLES!', 'doubles', `${this.who(e.playerId).name} rolls again`);
    else if (e.type === 'move' && e.mode === 'prison') fx.banner(this.map.tiles[this.board.prisonIndex()].name, 'prison', `${this.who(e.playerId).name} is trapped`);
    else if (e.type === 'buy') fx.buy(this.map, e.tile, this.who(e.playerId).color, this.who(e.playerId).name);
    else if (e.type === 'upgrade') fx.upgrade(e.tile);
    else if (e.type === 'bankrupt') fx.banner(e.reason === 'bankrupt' ? 'BANKRUPT' : 'OUT', 'bankrupt', this.who(e.playerId).name);
    else if (e.type === 'money' && e.amount > 0 && e.to) {
      // nur geld, das bei jemandem ankommt (miete, =collect, karten); zahlungen an die bank ohne münzregen
      const from = e.from ? fx.pawnPoint(e.from) : bank;
      fx.coins(from, fx.pawnPoint(e.to), Math.min(8, 3 + Math.round(Math.log2(e.amount) / 2)), `+${money(this.map, e.amount)}`);
    } else if (e.type === 'trade' && e.state === 'accepted' && e.give) {
      await fx.trade(this.map, this.who(e.from), this.who(e.to), e.give, e.take);
    }
  }

  async play(events, fast) {
    for (const e of events) {
      await this.animate(e, fast);
      if (!fast) await this.effect(e);
    }
  }

  /** Die eigentliche animation eines ereignisses (würfel, laufen, karte, klang). */
  async animate(e, fast) {
    if (e.type === 'dice') {
      if (!fast) sound.dice();
      await this.dice.roll(e.dice, fast);
    } else if (e.type === 'move') {
      if (e.mode === 'prison' && !fast) sound.prison();
      await this.board.move(e, fast);
    } else if (e.type === 'card') {
      if (!fast) sound.card();
      this.showCard(e);
      if (!fast) await wait(700);
    } else if (e.type === 'buy' || e.type === 'upgrade') {
      if (!fast) sound.build();
    } else if (e.type === 'turn') {
      // neuer zug: alte karte weg
      this.hideCard();
      if (e.playerId === this.me) sound.turn();
    } else if (e.type === 'trade' && e.state === 'accepted') {
      sound.trade();
    } else if (e.type === 'trade' && (e.state === 'declined' || e.state === 'cancelled')) {
      sound.decline();
    } else if (e.type === 'bid') {
      if (!fast) sound.bid();
    } else if (e.type === 'over') {
      sound.win();
      confetti();
    }
  }

  showCard(e) {
    clearTimeout(this.cardTimer);
    const deck = word(this.map, e.deck, e.deck);
    this.cardSlot.replaceChildren(h(`div.game-card.deck-${e.deck}`, { class: e.crazy ? 'is-crazy' : '' },
      h('span.game-card-deck', e.crazy ? `Crazy ${deck}` : deck),
      h('p', e.text)));
    this.cardSlot.classList.add('is-shown');
    this.cardTimer = setTimeout(() => this.hideCard(), 3200);
  }

  hideCard() {
    clearTimeout(this.cardTimer);
    this.cardSlot.classList.remove('is-shown');
  }

  /** Spielaktion senden; fehler als meldung, rückgabe true bei erfolg. */
  async act(action) {
    try {
      await this.ctx.net.ask('game:act', action);
      return true;
    } catch (error) {
      toast(error.message, 'bad');
      return false;
    }
  }

  async ask(event, payload) {
    try {
      return await this.ctx.net.ask(event, payload);
    } catch (error) {
      toast(error.message, 'bad');
      return null;
    }
  }

  // ---- rendern -----------------------------------------------------------

  render(room) {
    const before = this.room;
    this.room = room;
    const game = room.game;
    this.el.dataset.phase = room.phase;
    this.board.update(game, room.participants, { showPot: room.settings.vacationCash });
    this.strip.update(game, room.participants);
    if (this.lineView) {
      if (this.board.center.parentNode !== this.boardArea) this.boardArea.insertBefore(this.board.center, this.strip.el);
      this.strip.focusTurn(game);
    }
    if (!game) this.board.updatePawns({ players: room.participants.map(p => ({ ...p, position: 0, prisonTurns: 0 })), turn: {}, phase: 'lobby' }, room.participants);
    if (game?.turn.dice && !before?.game) this.dice.show(game.turn.dice, true);
    this.renderPlayers();
    this.renderTrades();
    this.renderProps();
    this.renderSettings();
    this.renderStage();
    this.renderChat();
    this.renderMiniLog();
    this.floatMoney();
    this.refreshDialog?.();
    if (game?.card && game.card.text !== before?.game?.card?.text && !this.cardSlot.classList.contains('is-shown')) {
      // spät beigetreten: aktuelle karte trotzdem zeigen
      if (!before) this.showCard(game.card);
    }
    if (room.phase === 'ended' && before?.phase === 'playing') setTimeout(() => statsDialog(this), 2200);
    this.notifyTrades(before);
  }

  notifyTrades(before) {
    const game = this.room.game;
    if (!game || !before?.game) return;
    const now = game.trades ?? [];
    const old = new Set((before.game.trades ?? []).map(t => t.id));
    const nameOf = id => game.players.find(p => p.id === id)?.name ?? 'Someone';
    for (const t of now) {
      if (old.has(t.id)) continue;
      if (t.to === this.me) {
        sound.offer();
        toast(`${nameOf(t.from)} sent you a trade offer`);
        if (!document.querySelector('.modal-backdrop')) viewTradeDialog(this, t);
      } else if (t.from === this.me) {
        sound.send();
      } else {
        // offene angebote sieht der ganze tisch, nicht nur die beiden beteiligten
        sound.watch();
        toast(`${nameOf(t.from)} offered ${nameOf(t.to)} a trade`);
      }
    }
  }

  floatMoney() {
    const game = this.room.game;
    if (!game) return;
    for (const p of game.players) {
      const old = this.lastMoney.get(p.id);
      this.lastMoney.set(p.id, p.money);
      if (old === undefined || old === p.money) continue;
      const row = this.playersPanel.querySelector(`[data-player="${CSS.escape(p.id)}"] .pl-money`);
      if (!row) continue;
      const diff = p.money - old;
      if (diff > 0 && p.id === this.me) sound.coin();
      if (diff < 0 && p.id === this.me) sound.pay();
      const float = h(`span.money-float.${diff > 0 ? 'up' : 'down'}`, `${diff > 0 ? '+' : ''}${money(this.map, diff)}`);
      row.append(float);
      setTimeout(() => float.remove(), 1600);
    }
  }

  renderPlayers() {
    const room = this.room;
    const game = room.game;
    const map = this.map;
    const list = game
      ? game.players.map(p => ({ ...room.participants.find(x => x.id === p.id), ...p, participant: room.participants.find(x => x.id === p.id) }))
      : room.participants;
    const key = JSON.stringify([list.map(p => [p.id, p.name, p.money, p.debt, p.netWorth, p.bankrupt, p.connected, p.appearance, p.team, p.prisonTurns, p.pardons, p.votes, p.skipTurns, p.boost, p.shield]),
      room.hostId, game?.turn.playerId, game?.phase, room.phase, room.you, room.settings.maxPlayers, room.settings.teams]);
    renderIf(this.playersPanel, key, () => {
      const head = h('div.panel-head', h('h3', 'Players'), h('span.faint.num', game ? `round ${game.round}` : `${room.participants.length}/${room.settings.maxPlayers}`));
      const rows = list.map(p => {
        const turn = game && game.turn.playerId === p.id && game.phase === 'playing';
        const team = p.team ? room.teams.find(t => t.id === p.team) : null;
        const badges = [
          room.hostId === p.id ? h('span.badge.badge-host', { title: 'Host', html: UI.crown }) : null,
          p.isBot ? h('span.badge', 'bot') : null,
          p.connected === false && !p.isBot ? h('span.badge.badge-off', 'offline') : null,
          team ? h('span.badge', { title: team.name }, team.emoji) : null,
          p.prisonTurns > 0 ? h('span.badge.badge-bad', word(map, 'prison', 'prison').replace(/^the /i, '')) : null,
          p.skipTurns > 0 ? h('span.badge', 'skips') : null,
          p.boost ? h('span.badge.badge-good', 'boost') : null,
          p.shield ? h('span.badge.badge-good', 'slowmode') : null,
          p.pardons?.length ? h('span.badge', { title: p.pardons.map(d => pardonName(map, d)).join(', ') }, `🎫 ${p.pardons.length}`) : null,
          p.votes ? h('span.badge.badge-bad', `kick ${p.votes}`) : null,
        ];
        return h('button.player-row', {
          type: 'button',
          'data-player': p.id,
          class: [turn ? 'is-turn' : '', p.bankrupt ? 'is-out' : '', p.id === this.me ? 'is-me' : ''].join(' '),
          '--pc': p.appearance?.color ?? '#999',
          onclick: () => this.playerMenu(p),
        },
          h('span.pl-pawn', { html: pawnSvg(p.appearance?.shape, p.appearance?.color) }),
          p.avatarUrl ? h('img.pl-avatar', { src: p.avatarUrl, alt: '' }) : null,
          h('span.pl-main', h('span.pl-name', p.name, p.id === this.me ? h('small', ' (you)') : null), h('span.pl-badges', badges)),
          game ? h('span.pl-money',
            h('b.num', { class: p.debt ? 'bad' : '' }, p.bankrupt ? (p.leftReason === 'left' ? 'left' : 'bankrupt') : money(map, p.money - (p.debt ?? 0))),
            p.bankrupt ? null : h('small.num.faint', `worth ${money(map, p.netWorth)}`)) : null,
        );
      });
      const empty = !game ? Array.from({ length: Math.max(0, room.settings.maxPlayers - room.participants.length) }, () => h('div.player-row.is-empty', h('span.pl-pawn'), h('span.faint', 'Waiting for player…'))) : [];
      return [head, h('div.player-list', rows, empty)];
    });
  }

  playerMenu(p) {
    const room = this.room;
    const game = room.game;
    const options = [];
    if (game && game.phase === 'playing' && p.id !== this.me && !p.bankrupt && this.myPlayer && !this.myPlayer.bankrupt) {
      options.push(h('button.btn', { onclick: () => { closeModal(); createTradeDialog(this, p.id); } }, h('span.btn-icon', { html: UI.trade }), 'Trade'));
    }
    if (room.clock?.canGrant && room.clock.playerId === p.id) {
      options.push(h('button.btn', { onclick: () => this.ask('game:grant', {}).then(closeModal) }, h('span.btn-icon', { html: UI.clock }), 'Give this player extra time'));
    }
    if (room.you.role === 'player' && p.id !== this.me && !p.isBot && !p.bankrupt) {
      options.push(h('button.btn', { onclick: () => this.ask('room:votekick', { playerId: p.id }).then(closeModal) }, 'Vote to remove'));
    }
    if (room.you.isHost && p.id !== this.me && (room.phase === 'lobby' || p.isBot || room.settings.isPrivate) && !p.bankrupt) {
      options.push(h('button.btn.btn-bad', { onclick: () => this.ask('room:kick', { playerId: p.id }).then(closeModal) }, p.isBot ? 'Remove bot' : 'Remove player'));
    }
    if (room.phase === 'lobby' && room.settings.teams.enabled && (p.id === this.me || room.you.isHost)) {
      options.push(h('div.seg', room.teams.slice(0, Math.max(2, Math.min(4, room.participants.length))).map(t =>
        h('button.seg-btn', { class: p.team === t.id ? 'is-on' : '', onclick: () => this.ask('room:team', { team: t.id, playerId: p.id }).then(closeModal) }, `${t.emoji} ${t.name}`))));
    }
    if (p.id === this.me && room.phase !== 'ended') {
      options.push(h('button.btn', { onclick: () => { closeModal(); this.appearanceDialog(); } }, h('span.btn-icon', { html: UI.palette }), 'Change appearance'));
    }
    if (!options.length) return;
    openModal({ title: p.name, className: 'modal-menu', body: h('div.menu-list', options) });
  }

  renderTrades() {
    const game = this.room.game;
    const show = game && game.phase === 'playing';
    this.tradesPanel.hidden = !show;
    if (!show) return;
    const me = this.me;
    const key = JSON.stringify([game.trades, this.myPlayer?.bankrupt, game.players.map(p => [p.id, p.name, p.appearance?.color]), me]);
    renderIf(this.tradesPanel, key, () => {
      const who = id => game.players.find(p => p.id === id) ?? null;
      const pawn = p => h('span.mini-pawn', { html: pawnSvg(p?.appearance?.shape, p?.appearance?.color) });
      return [
        h('div.panel-head', h('h3', 'Trade offers', game.trades.length ? h('span.badge', game.trades.length) : null),
          this.myPlayer && !this.myPlayer.bankrupt ? h('button.btn.btn-sm', { onclick: () => createTradeDialog(this) }, h('span.btn-icon', { html: UI.plus }), 'Create') : null),
        game.trades.length ? h('div.trade-list', game.trades.map(t => {
          const from = who(t.from);
          const to = who(t.to);
          return h('button.trade-item', { type: 'button', class: t.to === me ? 'is-incoming' : '', onclick: () => viewTradeDialog(this, t) },
            h('span.label',
              h('span.trade-who', pawn(from), h('b', from?.name ?? '?'), h('span.trade-arrow-inline', { html: UI.trade }), pawn(to), h('b', to?.name ?? '?')),
              t.to === me ? h('span.badge.badge-new', 'answer') : t.from === me ? h('span.badge', 'yours') : h('span.badge', 'open')),
            tradeSummary(this, t));
        })) : h('p.faint.panel-empty', 'No open offers. Every offer at this table is shown here for everyone.'),
      ];
    });
  }

  renderProps() {
    const game = this.room.game;
    const me = this.myPlayer;
    const show = game && me && !me.bankrupt;
    this.propsPanel.hidden = !show;
    if (!show) return;
    const map = this.map;
    const mine = game.tiles.flatMap((t, i) => (t?.owner === this.me ? [i] : []));
    const key = JSON.stringify([mine, mine.map(i => game.tiles[i]), game.can]);
    renderIf(this.propsPanel, key, () => {
      const groups = new Map();
      for (const i of mine) {
        const tile = map.tiles[i];
        const k = tile.type === 'city' ? tile.group : tile.type;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(i);
      }
      return [
        h('div.panel-head', h('h3', 'My properties'), h('span.faint.num', mine.length)),
        mine.length ? h('div.props', [...groups.entries()].map(([k, list]) => {
          const color = map.groups[k]?.color ?? 'var(--m-muted)';
          const total = map.groups[k] ? groupTiles(map, k).length : null;
          const full = Boolean(total && list.length === total);
          return h('div.prop-group', { '--group': color },
            full
              ? h('button.prop-count.prop-count-btn', { type: 'button', title: 'Upgrade or downgrade the whole set', onclick: () => groupDialog(this, k) }, `${list.length}/${total}`, h('span', ' ⇅'))
              : h('span.prop-count', total ? `${list.length}/${total}` : list.length),
            list.map(i => h('button.prop', { type: 'button', class: game.tiles[i].mortgaged ? 'is-mortgaged' : '', onclick: () => tileDialog(this, i) },
              h('span.prop-name', map.tiles[i].name),
              game.tiles[i].level ? h('span.prop-level', game.tiles[i].level === 5 ? '★' : '▮'.repeat(game.tiles[i].level)) : null)));
        })) : h('p.faint.panel-empty', 'Click on a property to upgrade, downgrade or sell it.'),
        h('button.btn.btn-bad.btn-sm.give-up', { onclick: () => this.confirmBankrupt() }, 'Declare bankruptcy'),
      ];
    });
  }

  renderSettings() {
    const room = this.room;
    const config = this.ctx.config;
    const editable = room.phase === 'lobby' && room.you.isHost;
    const key = JSON.stringify([room.settings, editable, room.phase, room.map.id]);
    renderIf(this.settingsPanel, key, () => {
      const set = patch => this.ask('room:settings', { patch });
      const row = item => {
        const value = room.settings[item.key];
        let control;
        if (item.kind === 'switch') {
          control = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(value), 'aria-label': item.label, disabled: !editable, onclick: () => set({ [item.key]: !value }) }, h('i'));
        } else if (item.kind === 'select') {
          const label = v => (item.money ? money(this.map, v) : item.key === 'roundLimit' ? (v ? `${v}` : 'none') : String(v).replace(/^\w/, c => c.toUpperCase()));
          control = editable
            ? h('select.input.input-sm', { 'aria-label': item.label, onchange: e => set({ [item.key]: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) }) },
              item.options.map(o => h('option', { value: o, selected: o === value }, label(o))))
            : h('span.setting-value', label(value));
        } else if (item.kind === 'number') {
          control = editable
            ? h('input.input.input-sm.num-input', { type: 'number', inputmode: 'numeric', min: item.min ?? 0, max: item.max ?? 1000000, step: item.step ?? 10, value, 'aria-label': item.label,
              onchange: e => set({ [item.key]: Math.round(Number(e.target.value)) }) })
            : h('span.setting-value', item.money ? money(this.map, value) : String(value));
        } else if (item.kind === 'teams') {
          control = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(value.enabled), 'aria-label': 'Enable teams', disabled: !editable, onclick: () => set({ teams: { enabled: !value.enabled, balanceStartCash: value.balanceStartCash } }) }, h('i'));
        }
        const extra = item.kind === 'teams' && value.enabled
          ? h('div.setting.setting-sub', h('div.setting-text', h('span.setting-label', 'Balance starting cash'), h('span.setting-desc', 'Smaller teams receive more starting cash')),
            h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(value.balanceStartCash), disabled: !editable, onclick: () => set({ teams: { enabled: true, balanceStartCash: !value.balanceStartCash } }) }, h('i')))
          : null;
        return [h('div.setting', { class: item.section === 'more' ? 'is-extra' : '' },
          h('div.setting-text', h('span.setting-label', item.label, item.badge ? h('span.badge.badge-new', item.badge) : null), h('span.setting-desc', item.description)),
          control), extra];
      };
      const sections = [['room', null], ['rules', 'Gameplay rules'], ['more', 'More'], ['order', null]];
      if (room.phase !== 'lobby') {
        const changed = config.settings.filter(s => (s.section === 'rules' || s.section === 'more') && JSON.stringify(room.settings[s.key]) !== JSON.stringify(config.defaults[s.key]));
        return [
          h('div.panel-head', h('h3', 'Room rules')),
          h('div.rule-chips', changed.length ? changed.map(s => h('span.rule-chip', { title: s.description }, s.kind === 'select' ? `${s.label}: ${s.money ? money(this.map, room.settings[s.key]) : room.settings[s.key]}` : s.label)) : h('span.faint', 'Default room settings')),
        ];
      }
      return [
        h('div.panel-head', h('h3', 'Game settings'), editable ? null : h('span.faint', 'host only')),
        h('div.setting', h('div.setting-text', h('span.setting-label', 'Board'), h('span.setting-desc', room.map.description)),
          editable && this.ctx.maps.length > 1
            ? h('select.input.input-sm', { onchange: e => set({ mapId: e.target.value }) }, this.ctx.maps.map(m => h('option', { value: m.id, selected: m.id === room.map.id }, m.name)))
            : h('span.setting-value', room.map.name)),
        sections.map(([section, title]) => [
          title ? h('h4.settings-section', title) : null,
          config.settings.filter(s => s.section === section).map(row),
        ]),
      ];
    });
  }

  /** Log-text lesbar machen: spielernamen in ihrer farbe, geldbeträge hervorgehoben. */
  logContent(text) {
    const game = this.room?.game;
    const map = this.map;
    if (!game || !map || !text) return text;
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = game.players.map(p => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
    const currency = map.words?.currency ?? '$';
    const tokens = [...new Set(names)].map(escape);
    tokens.push(`\\d[\\d,.]*\\s*${escape(currency)}`);
    const pattern = new RegExp(`(${tokens.join('|')})`, 'g');
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const token = match[0];
      const player = game.players.find(p => p.name === token);
      parts.push(player
        ? h('b.log-name', { style: { color: player.appearance?.color ?? 'inherit' } }, token)
        : h('b.log-money', token));
      last = match.index + token.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  renderChat() {
    const room = this.room;
    if (!room) return;
    const items = this.logTab === 'chat' ? room.chat : (room.game?.log ?? []).map(l => ({ ...l, kind: `log log-${l.kind}` }));
    const key = `${this.logTab}:${items.at(-1)?.id ?? 0}:${items.length}`;
    if (this.chatList.dataset.key === key) return;
    const stick = this.chatList.scrollHeight - this.chatList.scrollTop - this.chatList.clientHeight < 40;
    this.chatList.dataset.key = key;
    this.chatList.replaceChildren(...items.map(m => h('li', { class: `msg msg-${m.kind}` },
      m.name ? h('b', { style: { color: m.color } }, `${m.name}: `) : null, this.logContent(m.text))));
    if (stick || this.logTab === 'log') this.chatList.scrollTop = this.chatList.scrollHeight;
  }

  renderMiniLog() {
    const log = this.room.game?.log ?? [];
    const key = String(log.at(-1)?.id ?? 0);
    renderIf(this.miniLog, key, () => log.slice(-3).map(l => h('li', { class: `log-${l.kind}` }, this.logContent(l.text))));
  }

  // ---- mitte -------------------------------------------------------------

  renderStage() {
    const room = this.room;
    const game = room.game;
    this.dice.el.hidden = !game;
    if (room.phase === 'lobby') return this.renderLobbyStage();
    if (room.phase === 'ended') return this.renderEndStage();
    const map = this.map;
    const turn = game.turn;
    const current = game.players.find(p => p.id === turn.playerId);
    const me = this.myPlayer;
    const mine = me && turn.playerId === me.id && !me.bankrupt;
    const myDebt = me?.debt ?? 0;
    const key = JSON.stringify([turn, game.auction, game.debts, me?.money, me?.prisonTurns, me?.pardons, myDebt, room.clock?.playerId, game.players.map(p => p.position)]);

    this.status.replaceChildren(
      h('span.status-pawn', { html: pawnSvg(current.appearance?.shape, current.appearance?.color) }),
      h('span.status-text', mine ? 'Your turn' : `${current.name}'s turn`),
      h('span.clock', h('i.clock-bar')),
    );
    this.status.classList.toggle('is-mine', Boolean(mine));
    this.status.style.setProperty('--pc', current.appearance?.color ?? 'var(--m-accent)');

    renderIf(this.stage, key, () => {
      if (game.auction) return this.auctionStage();
      if (myDebt > 0) {
        return h('div.stage-debt',
          h('p', h('b.bad', `You owe ${money(map, myDebt)}`), h('br'), 'Downgrade, sell or mortgage properties to pay your debt.'),
          h('div.stage-buttons',
            h('button.btn', { onclick: () => this.propsPanel.scrollIntoView({ behavior: 'smooth' }) }, 'My properties'),
            h('button.btn.btn-bad', { onclick: () => this.confirmBankrupt() }, 'Declare bankruptcy')));
      }
      if (game.debts.length) {
        const names = [...new Set(game.debts.map(d => game.players.find(p => p.id === d.from)?.name))].join(', ');
        return h('p.stage-wait', `Waiting for ${names} to pay…`);
      }
      if (!mine) return h('p.stage-wait', current.isBot ? `${current.name} is thinking…` : `Waiting for ${current.name}…`);
      const buttons = [];
      if (turn.phase === 'roll') {
        if (me.prisonTurns > 0 && turn.rolls === 0) {
          if (me.pardons.length) buttons.push(h('button.btn', { onclick: () => this.act({ type: 'usePardon', deck: me.pardons[0] }) }, `Use ${pardonName(map, me.pardons[0])}`));
          buttons.push(h('button.btn', { disabled: me.money < game.prisonFine, onclick: () => this.act({ type: 'payPrison' }) }, `Pay ${money(map, game.prisonFine)}`));
          buttons.push(h('button.btn.btn-primary.btn-lg', { onclick: () => this.act({ type: 'roll' }) }, h('span.btn-icon', { html: UI.dice }), 'Roll for doubles'));
        } else {
          buttons.push(h('button.btn.btn-primary.btn-lg', { onclick: () => this.act({ type: 'roll' }) }, h('span.btn-icon', { html: UI.dice }), turn.rolls > 0 ? 'Roll again' : 'Roll the dice'));
        }
      } else if (turn.phase === 'buy') {
        const tile = map.tiles[me.position];
        buttons.push(h('button.btn.btn-good.btn-lg', { disabled: me.money < tile.price, onclick: () => this.act({ type: 'buy' }) }, `Buy for ${money(map, tile.price)}`));
        buttons.push(h('button.btn', { onclick: () => this.act({ type: 'decline' }) }, h('span.btn-icon', { html: room.settings.auction ? UI.gavel : UI.close }), room.settings.auction ? 'Auction' : 'Skip'));
        buttons.push(h('button.btn.btn-ghost', { onclick: () => tileDialog(this, me.position) }, 'Details'));
      } else if (turn.phase === 'done') {
        buttons.push(h('button.btn.btn-primary.btn-lg', { onclick: () => this.act({ type: 'endTurn' }) }, 'End turn'));
      }
      return h('div.stage-buttons', buttons);
    });
  }

  auctionStage() {
    const game = this.room.game;
    const map = this.map;
    const a = game.auction;
    const tile = map.tiles[a.tile];
    const bidder = a.bidderId ? game.players.find(p => p.id === a.bidderId) : null;
    const me = this.myPlayer;
    const bid = amount => this.act({ type: 'bid', amount });
    const canBid = me && !me.bankrupt;
    return h('div.auction', { '--group': tile.type === 'city' ? map.groups[tile.group].color : 'var(--m-accent)' },
      h('div.auction-head', h('span.label', h('span.btn-icon', { html: UI.gavel }), 'Auction'), h('b', tile.name)),
      h('div.auction-bid', h('span.num', money(map, a.bid)), h('span.faint', bidder ? `by ${bidder.name}` : 'no bids yet')),
      h('div.auction-timer', h('i')),
      canBid ? h('div.stage-buttons', [2, 10, 100].map(step =>
        h('button.btn', { disabled: me.money < a.bid + step || bidder?.id === me.id, onclick: () => bid(a.bid + step) }, `+${money(map, step)}`))) : null,
    );
  }

  renderLobbyStage() {
    const room = this.room;
    this.status.replaceChildren(h('span.status-text', room.you.role === 'player' ? 'Waiting for players' : 'Join the game'));
    const key = JSON.stringify([room.you, room.participants.map(p => [p.id, p.appearance, p.team]), room.settings.maxPlayers, room.settings.canBotsJoin, room.settings.teams, this.ctx.identity?.name]);
    renderIf(this.stage, key, () => {
      if (room.you.role !== 'player') {
        // auf kleinen brettern passt die figurenwahl nicht in die mitte
        if (this.boardArea.clientWidth < 560) {
          return h('div.lobby-stage', h('button.btn.btn-primary.btn-lg', { onclick: () => openModal({ title: 'Join game', className: 'modal-join', body: this.joinPanel() }) }, 'Join game'));
        }
        return this.joinPanel();
      }
      const enough = room.participants.length >= 2;
      return h('div.lobby-stage',
        h('p.stage-wait', room.you.isHost ? (enough ? 'Everyone here? Start the game.' : 'Invite friends or add a bot to start.') : 'Waiting for the host to start the game…'),
        room.you.isHost ? h('div.stage-buttons',
          h('button.btn.btn-primary.btn-lg', { disabled: !enough, onclick: () => this.ask('room:start', {}) }, h('span.btn-icon', { html: UI.play }), 'Start game'),
          room.settings.canBotsJoin ? h('button.btn', { disabled: room.participants.length >= room.settings.maxPlayers, onclick: () => this.ask('room:bot', {}) }, h('span.btn-icon', { html: UI.bot }), 'Add bot') : null) : null,
        h('button.btn.btn-ghost.btn-sm', { onclick: () => this.copyInvite() }, h('span.btn-icon', { html: UI.copy }), 'Copy invite link'),
      );
    });
  }

  joinPanel() {
    const room = this.room;
    const config = this.ctx.config;
    const taken = new Set(room.participants.map(p => p.appearance.color));
    const look = this.ctx.appearance ?? { color: config.colors.find(c => !taken.has(c)), shape: 'blob' };
    if (taken.has(look.color)) look.color = config.colors.find(c => !taken.has(c)) ?? look.color;
    this.ctx.appearance = look;
    const full = room.participants.length >= room.settings.maxPlayers;
    const nameInput = !this.ctx.member ? h('input.input', { maxlength: 20, value: savedName() || this.ctx.identity?.name || '', placeholder: 'Your nickname…', 'aria-label': 'Nickname' }) : null;
    const preview = h('span.join-preview', { html: pawnSvg(look.shape, look.color) });
    const redraw = () => { preview.innerHTML = pawnSvg(look.shape, look.color); };
    return h('div.join',
      preview,
      nameInput,
      h('span.label', 'Select your player appearance:'),
      h('div.swatches', config.colors.map(c => h('button.swatch', { type: 'button', '--c': c, 'aria-label': c, disabled: taken.has(c), class: look.color === c ? 'is-on' : '',
        onclick: e => { look.color = c; e.currentTarget.parentElement.querySelectorAll('.swatch').forEach(s => s.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); redraw(); } }))),
      h('div.shapes', config.shapes.map(s => h('button.shape', { type: 'button', 'aria-label': s, class: look.shape === s ? 'is-on' : '', html: pawnSvg(s, look.color),
        onclick: e => { look.shape = s; e.currentTarget.parentElement.querySelectorAll('.shape').forEach(x => x.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); redraw(); } }))),
      room.phase === 'lobby' && !full
        ? h('button.btn.btn-primary.btn-lg', { onclick: async () => {
          if (nameInput) {
            const name = nameInput.value.trim();
            if (name && name !== this.ctx.identity?.name) {
              saveName(name);
              await this.ctx.reconnect(name);
            }
          }
          this.ctx.appearance = look;
          if (await this.ask('room:join', { roomId: this.roomId, appearance: look })) closeModal();
        } }, 'Join game')
        : h('p.faint', full ? 'The room is full.' : 'The game has already started. You are watching.'),
      room.settings.onlyUsers && !this.ctx.member ? h('p.hint', 'Only logged-in users can join this room.') : null,
    );
  }

  renderEndStage() {
    const room = this.room;
    const game = room.game;
    const winners = game.players.filter(p => game.winner?.playerIds.includes(p.id));
    this.status.replaceChildren(h('span.status-text', 'Game over!'));
    const key = JSON.stringify([game.winner, room.you.isHost]);
    renderIf(this.stage, key, () => h('div.end-stage',
      h('div.winner-pawns', winners.map(w => h('span.winner-pawn', { html: pawnSvg(w.appearance?.shape, w.appearance?.color) }))),
      h('h2.winner-title', game.winner?.team ? `Team ${room.teams.find(t => t.id === game.winner.team)?.name ?? game.winner.team} wins!` : `${winners[0]?.name ?? 'Nobody'} wins!`),
      h('ol.final', room.result?.standings.map((id, i) => {
        const p = game.players.find(x => x.id === id);
        return h('li', h('span.num.faint', `${i + 1}`), h('span.mini-pawn', { html: pawnSvg(p.appearance?.shape, p.appearance?.color) }), h('span', p.name), h('span.num', p.bankrupt ? 'bankrupt' : money(this.map, p.netWorth)));
      })),
      h('div.stage-buttons',
        h('button.btn', { onclick: () => statsDialog(this) }, h('span.btn-icon', { html: UI.stats }), 'Game statistics'),
        room.you.isHost ? h('button.btn.btn-primary', { onclick: () => this.ask('room:restart', {}) }, 'Play again') : null),
    ));
    this.dice.el.hidden = true;
  }

  // ---- uhr ---------------------------------------------------------------

  tick() {
    const room = this.room;
    if (!room?.game) return;
    const now = Date.now() + this.offset;
    const bar = this.status.querySelector('.clock-bar');
    const clock = room.clock;
    if (bar) {
      const debt = room.debtDeadlines.find(d => d.playerId === this.me);
      const deadline = debt?.deadline ?? clock?.deadline;
      const start = debt?.since ?? clock?.startedAt;
      if (deadline && start && room.phase === 'playing') {
        const total = Math.max(1, deadline - start);
        const left = Math.max(0, deadline - now);
        bar.parentElement.hidden = false;
        bar.style.width = `${Math.min(100, (left / total) * 100)}%`;
        bar.parentElement.classList.toggle('is-low', left < 10_000);
        bar.parentElement.title = `${Math.ceil(left / 1000)}s left`;
        bar.parentElement.dataset.left = `${Math.ceil(left / 1000)}s`;
      } else {
        bar.parentElement.hidden = true;
      }
    }
    const auctionBar = this.stage.querySelector('.auction-timer i');
    if (auctionBar && room.game.auction) {
      const left = Math.max(0, room.game.auction.endsAt - now);
      auctionBar.style.width = `${(left / 10_000) * 100}%`;
    }
  }

  // ---- dialoge -----------------------------------------------------------

  confirm(title, text, label, onYes) {
    openModal({ title, className: 'modal-confirm', body: [h('p', text), h('div.modal-actions',
      h('button.btn', { onclick: closeModal }, 'Cancel'),
      h('button.btn.btn-bad', { onclick: () => { closeModal(); onYes(); } }, label))] });
  }

  confirmBankrupt() {
    this.confirm('Declare bankruptcy?', 'Your properties go back to the bank (or to your teammate) and you are out of the game. You can keep watching.', 'Go bankrupt', () => this.act({ type: 'bankrupt' }));
  }

  leaveDialog() {
    const playing = this.room?.phase === 'playing' && this.myPlayer && !this.myPlayer.bankrupt;
    if (!playing) return this.ctx.leave();
    this.confirm('Leave the game?', 'You will be removed from the game and your properties go back to the bank.', 'Leave game', () => this.ctx.leave());
  }

  appearanceDialog() {
    const config = this.ctx.config;
    const me = this.room.participants.find(p => p.id === this.me);
    if (!me) return;
    const look = { ...me.appearance };
    const taken = new Set(this.room.participants.filter(p => p.id !== this.me).map(p => p.appearance.color));
    const body = h('div.join');
    const draw = () => body.replaceChildren(
      h('span.join-preview', { html: pawnSvg(look.shape, look.color) }),
      h('div.swatches', config.colors.map(c => h('button.swatch', { type: 'button', '--c': c, disabled: taken.has(c), class: look.color === c ? 'is-on' : '', onclick: () => { look.color = c; draw(); } }))),
      h('div.shapes', config.shapes.map(s => h('button.shape', { type: 'button', class: look.shape === s ? 'is-on' : '', html: pawnSvg(s, look.color), onclick: () => { look.shape = s; draw(); } }))),
      h('div.modal-actions', h('button.btn.btn-primary', { onclick: async () => {
        this.ctx.appearance = look;
        if (await this.ask('room:appearance', { appearance: look })) closeModal();
      } }, 'Save')),
    );
    draw();
    openModal({ title: 'Your appearance', className: 'modal-appearance', body });
  }

  themeDialog() {
    const root = document.querySelector('.mono-root');
    openModal({ title: 'Board theme', className: 'modal-themes', body: h('div.theme-grid', listThemes().map(t => h('button.theme-card', { type: 'button', class: currentTheme() === t.id ? 'is-on' : '',
      onclick: e => { applyTheme(root, t.id); e.currentTarget.parentElement.querySelectorAll('.theme-card').forEach(x => x.classList.toggle('is-on', x === e.currentTarget)); } },
      h('span.theme-swatch', t.swatch.map(c => h('i', { style: { background: c } }))),
      h('b', t.name), h('small.faint', t.line ?? '')))) });
  }

  async copyInvite() {
    const link = `${location.origin}/play/${this.roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied');
    } catch {
      openModal({ title: 'Invite link', body: h('input.input', { value: link, readonly: true, onfocus: e => e.target.select() }) });
    }
  }
}

export { modalOpen };
