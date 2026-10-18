// einstieg: startseite, raumliste und raum. routen per hash: #/ , #/rooms , #/room/abcde

import { h } from './dom.js';
import { api, connect, savedName, saveName } from './net.js';
import { Board } from './board.js';
import { LOGO, UI, pawnSvg } from './icons.js';
import { money } from './format.js';
import { RoomView } from './room-view.js';
import { toast } from './modal.js';
import { applyTheme, currentTheme, listThemes, loadThemes } from './themes.js';

const root = document.querySelector('#mono-app');
const header = document.querySelector('[data-site-header]');
const mapCache = new Map();

const ctx = {
  net: null,
  identity: null,
  member: null,
  discordEnabled: false,
  config: null,
  maps: [],
  appearance: null,
  view: null,
  async loadMap(id) {
    if (!mapCache.has(id)) mapCache.set(id, api(`/monopoly/maps/${encodeURIComponent(id)}`).then(r => r.map));
    return mapCache.get(id);
  },
  async reconnect(name) {
    ctx.net?.close();
    await openConnection(name);
  },
  async leave() {
    try { await ctx.net.ask('room:leave'); } catch { /* egal */ }
    location.hash = '#/';
  },
};

function openConnection(name) {
  return new Promise(resolve => {
    ctx.net = connect(name, {
      hello: ({ identity }) => {
        ctx.identity = identity;
        resolve();
        // nach einem verbindungsabbruch wieder in den raum (der sitzplatz bleibt erhalten)
        if (ctx.view) ctx.view.join().catch(() => {});
      },
      state: message => ctx.view?.receive(message),
      status: (state, detail) => {
        document.body.classList.toggle('is-offline', state !== 'online');
        if (state === 'error') console.warn('Monopoly-Verbindung:', detail);
      },
    });
  });
}

// ---- startseite ------------------------------------------------------------------

async function landing() {
  header.hidden = false;
  document.body.classList.remove('in-room');
  const map = await ctx.loadMap(ctx.config.defaults.mapId);
  const preview = new Board();
  preview.setMap(map);
  preview.el.classList.add('is-preview');
  preview.center.append(h('div.preview-center', h('img.preview-logo', { src: LOGO, alt: '' }), h('span.center-logo', 'LACEDAEMON'), h('span.faint', 'Monopoly')));
  preview.update({ tiles: [], players: [], turn: {}, phase: 'lobby' }, []);

  const nameInput = h('input.input.input-lg', { maxlength: 20, placeholder: 'Your nickname...', value: savedName(), 'aria-label': 'Nickname' });
  const ensureName = async () => {
    if (ctx.member) return true;
    const name = nameInput.value.trim();
    if (name.length < 2) {
      nameInput.focus();
      toast('Pick a nickname first (2–20 characters)', 'bad');
      return false;
    }
    if (name !== ctx.identity?.name) {
      saveName(name);
      await ctx.reconnect(name);
    }
    return true;
  };
  const play = async () => {
    if (!(await ensureName())) return;
    const { roomId } = await ctx.net.ask('room:quick');
    ctx.seatNext = roomId;
    location.hash = `#/room/${roomId}`;
  };
  const createPrivate = async () => {
    if (!(await ensureName())) return;
    const { roomId } = await ctx.net.ask('room:create', { settings: { isPrivate: true } });
    ctx.seatNext = roomId;
    location.hash = `#/room/${roomId}`;
  };

  const who = ctx.member
    ? h('div.whoami', h('img.avatar', { src: ctx.member.avatarUrl, alt: '' }), h('span', 'Playing as ', h('b', ctx.member.name)),
      h('button.btn.btn-ghost.btn-sm', { onclick: async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); } }, 'Log out'))
    : nameInput;

  const recent = h('div.recent');
  api('/monopoly/games/recent').then(({ games }) => {
    if (!games.length) return;
    recent.replaceChildren(h('h3', 'Recent games'), h('ul', games.map(g => h('li',
      h('span.recent-win', '🏆 ', h('b', g.winnerName)),
      h('span.faint', `${g.players.length} players · ${g.turns} turns`)))));
  }).catch(() => {});

  const themePicker = h('div.theme-row', listThemes().map(t => h('button.theme-dot', { type: 'button', title: t.name, 'aria-label': t.name, class: currentTheme() === t.id ? 'is-on' : '',
    onclick: e => { applyTheme(root, t.id); e.currentTarget.parentElement.querySelectorAll('.theme-dot').forEach(x => x.classList.toggle('is-on', x === e.currentTarget)); } },
    t.swatch.map(c => h('i', { style: { background: c } })))));

  root.replaceChildren(h('div.landing',
    h('section.hero',
      h('img.hero-logo', { src: LOGO, alt: 'Lacedaemon' }),
      h('h1.logo', h('span.logo-main', 'LACEDAEMON'), h('span.logo-sub', 'Monopoly')),
      h('p.tagline', 'Rule the server.'),
      h('div.hero-form',
        who,
        h('button.btn.btn-primary.btn-xl', { onclick: () => play().catch(e => toast(e.message, 'bad')) }, h('span.btn-icon', { html: UI.play }), 'Play'),
        h('div.hero-row',
          h('a.btn', { href: '#/rooms' }, h('span.btn-icon', { html: UI.people }), 'All rooms'),
          h('button.btn', { onclick: () => createPrivate().catch(e => toast(e.message, 'bad')) }, h('span.btn-icon', { html: UI.key }), 'Create a private game')),
        !ctx.member ? h('a.btn.btn-discord', {
          href: `/api/auth/discord?returnTo=${encodeURIComponent('/pages/monopoly.html')}`,
          onclick: e => { if (!ctx.discordEnabled) { e.preventDefault(); toast('Discord login is not configured on this server yet', 'bad'); } },
        }, h('span.btn-icon', { html: UI.discord }), 'Login with Discord') : null,
      ),
      h('div.theme-pick', h('span.label', 'Board theme'), themePicker),
    ),
    h('section.landing-board', preview.el),
    recent,
  ));
}

// ---- raumliste -------------------------------------------------------------------

async function roomList() {
  header.hidden = false;
  document.body.classList.remove('in-room');
  const list = h('div.room-cards', h('p.faint', 'Loading rooms…'));
  root.replaceChildren(h('div.rooms-page',
    h('div.rooms-head', h('h1', 'All rooms'), h('a.btn', { href: '#/' }, 'Back')),
    list));
  const { rooms } = await ctx.net.ask('rooms:list');
  if (!rooms.length) {
    list.replaceChildren(h('div.empty-rooms', h('p', 'No open rooms right now.'), h('a.btn.btn-primary', { href: '#/' }, 'Start one')));
    return;
  }
  const chips = s => ctx.config.settings.filter(x => (x.section === 'rules' || x.section === 'more') && JSON.stringify(s[x.key]) !== JSON.stringify(ctx.config.defaults[x.key]));
  list.replaceChildren(...rooms.map(r => h('a.room-card', { href: `#/room/${r.id}` },
    h('div.room-card-head', h('b.room-code', r.id), h('span.faint', r.phase === 'lobby' ? `${r.players.length}/${r.maxPlayers} players` : 'playing')),
    h('div.room-colors', r.map.colors.map(c => h('i', { style: { background: c } }))),
    h('div.room-players', r.players.map(p => h('span.mini-pawn', { title: p.name, html: pawnSvg(p.isBot ? 'cube' : 'blob', p.color) }))),
    h('div.rule-chips', chips(r.settings).length ? chips(r.settings).map(c => h('span.rule-chip', c.kind === 'select' ? `${c.label}: ${c.money ? money(null, r.settings[c.key]) : r.settings[c.key]}` : c.label)) : h('span.faint', 'Default room settings')),
    h('span.room-join', r.phase === 'lobby' ? 'Join →' : 'Watch →'))));
}

// ---- raum ------------------------------------------------------------------------

async function enterRoom(roomId) {
  header.hidden = true;
  document.body.classList.add('in-room');
  const view = new RoomView(ctx, roomId);
  ctx.view = view;
  root.replaceChildren(view.el);
  try {
    // über play/create direkt hinsetzen, über einen link erst zuschauen
    const asPlayer = ctx.seatNext === roomId;
    ctx.seatNext = null;
    await view.join({ asPlayer });
  } catch (error) {
    ctx.view = null;
    view.destroy();
    root.replaceChildren(h('div.rooms-page', h('div.empty-rooms', h('h1', 'Room not found'), h('p.faint', error.message), h('a.btn.btn-primary', { href: '#/' }, 'Back to start'))));
  }
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (ctx.view) {
    ctx.view.destroy();
    ctx.view = null;
    ctx.net.ask('room:detach').catch(() => {});
  }
  if (hash === 'login-failed') {
    toast('Discord login failed or was cancelled', 'bad');
    history.replaceState(null, '', '#/');
  }
  const roomMatch = hash.match(/^room\/([a-z]{3,10})$/);
  try {
    if (roomMatch) await enterRoom(roomMatch[1]);
    else if (hash === 'rooms') await roomList();
    else await landing();
  } catch (error) {
    console.error(error);
    toast(error.message, 'bad');
  }
}

export async function start() {
  root.classList.add('mono-root');
  await loadThemes();
  applyTheme(root, currentTheme());
  const [me, config, maps] = await Promise.all([api('/auth/me'), api('/monopoly/config'), api('/monopoly/maps')]);
  ctx.member = me.member;
  ctx.discordEnabled = me.discordEnabled;
  ctx.config = config;
  ctx.maps = maps.maps;
  await openConnection(savedName());
  window.addEventListener('hashchange', route);
  await route();
}
