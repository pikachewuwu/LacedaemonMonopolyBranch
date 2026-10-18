// alle grafiken als inline-svg. flaggen, feld-icons und figuren werden in den map-vorlagen per id gewählt

const svg = (body, view = 32) => `<svg viewBox="0 0 ${view} ${view}" aria-hidden="true" focusable="false">${body}</svg>`;

/** Runde "länder"-flaggen der farbgruppen. */
export const FLAGS = {
  block: svg(`<rect width="32" height="32" fill="#7a5230"/><rect width="32" height="12" fill="#5fbf3a"/>
    <g fill="#469a2a"><rect x="1" y="11" width="5" height="4"/><rect x="10" y="11" width="4" height="5"/><rect x="19" y="11" width="5" height="3"/><rect x="27" y="11" width="5" height="5"/></g>
    <g fill="#5a3a20"><rect x="4" y="19" width="4" height="4"/><rect x="16" y="22" width="4" height="4"/><rect x="24" y="18" width="4" height="4"/><rect x="9" y="26" width="4" height="4"/></g>
    <g fill="#9b6b43"><rect x="12" y="16" width="3" height="3"/><rect x="22" y="26" width="3" height="3"/><rect x="2" y="27" width="3" height="3"/></g>
    <g fill="#8ee05f"><rect x="5" y="3" width="3" height="3"/><rect x="21" y="5" width="3" height="3"/></g>`),
  orbit: svg(`<rect width="32" height="32" fill="#121735"/>
    <g fill="#fff"><circle cx="6" cy="7" r=".9"/><circle cx="25" cy="5" r=".7"/><circle cx="27" cy="24" r=".9"/><circle cx="5" cy="25" r=".6"/><circle cx="12" cy="4" r=".5"/></g>
    <circle cx="16" cy="17" r="7" fill="#e5484d"/><path d="M11 14.5c2-1.6 6-2.3 9.5-.6" stroke="#ff8c8f" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <ellipse cx="16" cy="17" rx="13" ry="3.6" fill="none" stroke="#ffd2c4" stroke-width="1.5" transform="rotate(-18 16 17)"/>
    <circle cx="24.5" cy="9" r="2" fill="#d9dceb"/>`),
  rps: svg(`<rect width="11" height="32" fill="#8b919c"/><rect x="11" width="10" height="32" fill="#ffffff"/><rect x="21" width="11" height="32" fill="#e5484d"/>
    <circle cx="5.5" cy="16" r="3.2" fill="#5f6570"/><rect x="13.2" y="12" width="5.6" height="8" rx=".8" fill="none" stroke="#9aa3b5" stroke-width="1.3"/>
    <g stroke="#fff" stroke-width="1.4" stroke-linecap="round"><path d="M23.5 12.5l5 7M28.5 12.5l-5 7"/></g>`),
  debate: svg(`<rect width="32" height="11" fill="#2a2233"/><rect y="11" width="32" height="10" fill="#79678a"/><rect y="21" width="32" height="11" fill="#cdb9de"/>
    <path d="M6 9h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-6l-4 3.5V20H6a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" fill="#fff" opacity=".92"/>
    <path d="M17 14h9a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-1v3l-3.5-3H17a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3z" fill="#f4a35f" stroke="#2a2233" stroke-width=".8"/>`),
  lizard: svg(`<rect width="32" height="32" fill="#2c5a14"/><circle cx="25" cy="7" r="3.2" fill="#e4f77a" opacity=".9"/>
    <g stroke="#d7f05a" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M15 9.5v10.5c0 3.4 1.6 5.6 5.4 7"/><path d="M15 12.5l-4.3-2.7M15 12.5l4.3-2.7M15 18.5l-4.3 3M15 18.5l4.3 3"/></g>
    <ellipse cx="15" cy="7.6" rx="2.5" ry="3.1" fill="#d7f05a"/><g fill="#2c5a14"><circle cx="14" cy="7" r=".6"/><circle cx="16" cy="7" r=".6"/></g>`),
  bolt: svg(`<rect width="11" height="32" fill="#1f3a93"/><rect x="11" width="10" height="32" fill="#fbf7ec"/><rect x="21" width="11" height="32" fill="#f7c948"/>
    <path d="M18.5 3 8.5 18h6.8l-2.3 11 10.5-16h-6.9z" fill="#ffd23f" stroke="#1b1b22" stroke-width="1.3" stroke-linejoin="round"/>`),
  sheriff: svg(`<rect width="32" height="32" fill="#f6e7c8"/><rect x="13" width="6" height="32" fill="#ff8a3d"/><rect y="13" width="32" height="6" fill="#ff8a3d"/>
    <path d="M16 6.5l6.9 12H9.1z M16 25.5l-6.9-12h13.8z" fill="#8a4b14" stroke="#f6e7c8" stroke-width=".8" stroke-linejoin="round"/>
    <circle cx="16" cy="16" r="2.6" fill="#f6c76b"/>`),
  helmet: svg(`<rect width="32" height="32" fill="#1d3b8f"/><path d="M0 23h32v2.6H0zM0 28.4h32V31H0z" fill="#dfe7ff" opacity=".55"/>
    <path d="M9 27V15.6C9 10 12.1 5.8 16 5.8s7 4.2 7 9.8V27h-4.6v-6.2L16 18.2l-2.4 2.6V27z" fill="#e8c46a" stroke="#7b5a1c" stroke-width=".8"/>
    <path d="M16 6c.2-2.4 3.8-3.9 8-3-2.6.9-4.5 2.5-5.3 4.6" fill="#e5484d"/>`),
};

/** Icons für nicht-straßen-felder. */
export const TILE_ICONS = {
  windows: svg(`<g fill="#4cc2ff"><path d="M5 7.6 14 6.3v9.2H5z"/><path d="M15.5 6.1 27 4.4v11.1H15.5z"/><path d="M5 17h9v9.3L5 25z"/><path d="M15.5 17H27v11.2l-11.5-1.6z"/></g>`),
  linux: svg(`<ellipse cx="16" cy="18" rx="8" ry="10" fill="#1c1c1c"/><ellipse cx="16" cy="20.3" rx="5.2" ry="6.8" fill="#f4f4f4"/>
    <circle cx="13.6" cy="11.4" r="1.7" fill="#fff"/><circle cx="18.4" cy="11.4" r="1.7" fill="#fff"/><circle cx="13.9" cy="11.7" r=".85" fill="#111"/><circle cx="18.1" cy="11.7" r=".85" fill="#111"/>
    <path d="M14 14.2h4l-2 2.3z" fill="#f5b528"/><path d="M8.6 27.6c1.6-2.1 4-2.2 5.5-.4M23.4 27.6c-1.6-2.1-4-2.2-5.5-.4" stroke="#f5b528" stroke-width="2.6" stroke-linecap="round" fill="none"/>`),
  mac: svg(`<g fill="none" stroke="#e6e8ee" stroke-width="2.2"><rect x="12.2" y="12.2" width="7.6" height="7.6"/>
    <path d="M12.2 12.2V8.8a3.4 3.4 0 1 0-3.4 3.4zM19.8 12.2V8.8a3.4 3.4 0 1 1 3.4 3.4zM19.8 19.8h3.4a3.4 3.4 0 1 1-3.4 3.4zM12.2 19.8v3.4a3.4 3.4 0 1 1-3.4-3.4z"/></g>`),
  uwuntu: svg(`<circle cx="16" cy="16" r="12.5" fill="#e95420"/><g stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9.4 12.8l3.4 2.2-3.4 2.2M22.6 12.8l-3.4 2.2 3.4 2.2"/><path d="M12.2 20.4c1.1 1.5 2.5 1.5 3.8 0 1.3 1.5 2.7 1.5 3.8 0"/></g>
    <g fill="#ff9d80"><ellipse cx="9" cy="20" rx="1.8" ry="1"/><ellipse cx="23" cy="20" rx="1.8" ry="1"/></g>`),
  server: svg(`<g fill="#2b3446" stroke="#9fb3d1" stroke-width="1.2"><rect x="6" y="5" width="20" height="6.4" rx="1.6"/><rect x="6" y="12.8" width="20" height="6.4" rx="1.6"/><rect x="6" y="20.6" width="20" height="6.4" rx="1.6"/></g>
    <g fill="#43e07a"><circle cx="9.6" cy="8.2" r="1.1"/><circle cx="9.6" cy="16" r="1.1"/></g><circle cx="9.6" cy="23.8" r="1.1" fill="#ffc73f"/>
    <g stroke="#9fb3d1" stroke-width="1.2" stroke-linecap="round"><path d="M14 8.2h8M14 16h8M14 23.8h8"/></g>`),
  internet: svg(`<g fill="none" stroke="#5fd0ff" stroke-width="2.4" stroke-linecap="round"><path d="M4.5 13a16.5 16.5 0 0 1 23 0"/><path d="M8.6 17.2a10.6 10.6 0 0 1 14.8 0"/><path d="M12.6 21.3a4.9 4.9 0 0 1 6.8 0"/></g><circle cx="16" cy="25.3" r="2" fill="#5fd0ff"/>`),
  donation: svg(`<circle cx="16" cy="16" r="12" fill="#f4a35f"/><circle cx="16" cy="16" r="9.4" fill="none" stroke="#fff3df" stroke-width="1" opacity=".7"/>
    <path d="M16 22.4s-6.2-3.7-6.2-7.8a3.4 3.4 0 0 1 6.2-1.9 3.4 3.4 0 0 1 6.2 1.9c0 4.1-6.2 7.8-6.2 7.8z" fill="#fff"/>`),
  bill: svg(`<path d="M8 3.5h16v25l-2.7-1.8-2.6 1.8-2.7-1.8-2.7 1.8-2.6-1.8L8 28.5z" fill="#eef1f7" stroke="#9aa4b8" stroke-width="1"/>
    <g stroke="#6b7487" stroke-width="1.4" stroke-linecap="round"><path d="M11.5 9h9M11.5 12.5h9M11.5 16h5.5"/></g><path d="M11.5 21h9" stroke="#e5484d" stroke-width="2" stroke-linecap="round"/>`),
  treasure: svg(`<path d="M5 13c0-4.4 4.9-7 11-7s11 2.6 11 7v2H5z" fill="#c9852e"/><rect x="5" y="15" width="22" height="12" rx="1.5" fill="#a5651d"/>
    <g fill="#f0c45a"><rect x="5" y="14" width="22" height="2.6"/><rect x="9" y="6.6" width="2.4" height="20.4"/><rect x="20.6" y="6.6" width="2.4" height="20.4"/></g>
    <rect x="13.6" y="13.2" width="4.8" height="6" rx="1" fill="#ffe08a" stroke="#7a4a12" stroke-width=".8"/><circle cx="16" cy="16" r=".9" fill="#7a4a12"/>`),
  surprise: svg(`<defs><linearGradient id="sq" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ad5"/><stop offset="1" stop-color="#b874ff"/></linearGradient></defs>
    <path d="M10.5 11.3a5.6 5.6 0 1 1 8.6 4.7c-1.9 1.3-3.1 2.4-3.1 4.6v1.2" fill="none" stroke="url(#sq)" stroke-width="4.2" stroke-linecap="round"/><circle cx="16" cy="27" r="2.6" fill="#d98bff"/>`),
};

/** Grafiken für die vier ecken (64er raster). */
export const CORNER_ART = {
  go: svg(`<defs><linearGradient id="gc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe7a3"/><stop offset="1" stop-color="#e2a740"/></linearGradient></defs>
    <circle cx="32" cy="30" r="19" fill="url(#gc)" stroke="#8a5a14" stroke-width="2"/><circle cx="32" cy="30" r="14.5" fill="none" stroke="#fff6d6" stroke-width="1.2" opacity=".7"/>
    <text x="32" y="38" text-anchor="middle" font-size="21">🐉</text>`, 64),
  prison: svg(`<rect x="4" y="4" width="56" height="56" rx="6" fill="#c9b458"/>
    <g stroke="#a8963f" stroke-width="1.4" opacity=".75"><path d="M14 4v56M24 4v56M34 4v56M44 4v56M54 4v56"/></g>
    <g fill="#e6d77e" opacity=".6"><path d="M9 10l3 3-3 3-3-3zM19 24l3 3-3 3-3-3zM29 10l3 3-3 3-3-3zM39 24l3 3-3 3-3-3zM49 10l3 3-3 3-3-3zM9 38l3 3-3 3-3-3zM29 38l3 3-3 3-3-3zM49 38l3 3-3 3-3-3z"/></g>
    <rect x="10" y="7" width="44" height="4" rx="2" fill="#fffbe0" opacity=".95"/><rect x="10" y="11" width="44" height="12" fill="#fffbe0" opacity=".18"/>
    <g fill="#2a2416"><rect x="12" y="20" width="4" height="38" rx="2"/><rect x="22.5" y="20" width="4" height="38" rx="2"/><rect x="33" y="20" width="4" height="38" rx="2"/><rect x="43.5" y="20" width="4" height="38" rx="2"/><rect x="8" y="20" width="48" height="4" rx="2"/></g>`, 64),
  vacation: svg(`<circle cx="46" cy="16" r="8" fill="#ffd45c"/><g stroke="#ffd45c" stroke-width="2.2" stroke-linecap="round"><path d="M46 3v3M46 26v3M33 16h3M56 16h3M37 7l2 2M53 23l2 2M55 7l-2 2M39 23l-2 2"/></g>
    <path d="M6 54c8-2 44-2 52 0v4H6z" fill="#3c8f2a"/>
    <g fill="#5fcf3d"><path d="M12 54c-1-8 1-15 4-20-1 7 0 13 2 20z"/><path d="M18 54c0-10 4-18 9-22-3 7-4 14-3 22z"/><path d="M27 54c-2-9-1-16 2-23 1 8 2 15 3 23z"/><path d="M34 54c1-8 5-15 10-18-3 6-4 12-4 18z"/><path d="M42 54c-1-6 0-12 3-16 0 6 1 11 2 16z"/><path d="M48 54c1-5 4-9 8-11-2 4-3 7-3 11z"/></g>`, 64),
  goToPrison: svg(`<rect x="10" y="8" width="44" height="20" rx="4" fill="#1d7a3b"/><rect x="10" y="8" width="44" height="20" rx="4" fill="none" stroke="#9bf0b5" stroke-width="1.5"/>
    <text x="32" y="23" text-anchor="middle" font-size="12" font-weight="800" fill="#e9fff0" font-family="Arial, sans-serif" letter-spacing="1.5">EXIT</text>
    <path d="M18 58V36h28v22" fill="#c9b458" stroke="#2a2416" stroke-width="2"/><rect x="26" y="42" width="12" height="16" fill="#2a2416"/>
    <path d="M44 47h12M51 42l5 5-5 5" stroke="#e5484d" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, 64),
};

/** Spielfiguren. `color` füllt die figur. */
export function pawnSvg(shape, color) {
  const c = color;
  const eyes = (y = 18, dx = 5) => `<g><circle cx="${20 - dx}" cy="${y}" r="4.2" fill="#fff"/><circle cx="${20 + dx}" cy="${y}" r="4.2" fill="#fff"/><circle cx="${20 - dx + 0.8}" cy="${y + 0.6}" r="2.2" fill="#1a1423"/><circle cx="${20 + dx + 0.8}" cy="${y + 0.6}" r="2.2" fill="#1a1423"/></g>`;
  const shine = '<ellipse cx="13.5" cy="10.5" rx="4.5" ry="2.6" fill="#fff" opacity=".28" transform="rotate(-25 13.5 10.5)"/>';
  const outline = 'stroke="rgba(0,0,0,.35)" stroke-width="1.4"';
  const shapes = {
    blob: `<path d="M20 4c8.6 0 14.5 6.6 14.5 15.6 0 9.5-5.6 16.4-14.5 16.4S5.5 29.1 5.5 19.6C5.5 10.6 11.4 4 20 4z" fill="${c}" ${outline}/>${shine}${eyes()}`,
    helmet: `<path d="M7.5 36V18.5C7.5 10.4 13 4.5 20 4.5s12.5 5.9 12.5 14V36h-8V26l-4.5-4.4-4.5 4.4v10z" fill="${c}" ${outline}/><path d="M20 4.6c0-3.2 5.6-5.2 11.5-3.8-3.6 1.3-6.8 3.4-8 6.3" fill="#e5484d" ${outline}/>${shine}<path d="M11 18h7M22 18h7" stroke="#1a1423" stroke-width="2.4" stroke-linecap="round"/>`,
    dragon: `<path d="M9 13 5 3l9 6M31 13l4-10-9 6" fill="${c}" ${outline} stroke-linejoin="round"/><path d="M20 6c9 0 14 6.5 14 14.5S28.5 36 20 36 6 28.5 6 20.5 11 6 20 6z" fill="${c}" ${outline}/>${shine}${eyes(18, 5.5)}<g fill="#1a1423"><circle cx="17" cy="28" r="1.2"/><circle cx="23" cy="28" r="1.2"/></g><path d="M14.5 32.5l2-2 2 2M21.5 32.5l2-2 2 2" stroke="#fff" stroke-width="1.2" fill="none"/>`,
    cube: `<rect x="5" y="5" width="30" height="30" rx="5" fill="${c}" ${outline}/>${shine}<g fill="#1a1423"><rect x="11" y="13" width="6" height="6"/><rect x="23" y="13" width="6" height="6"/><rect x="17" y="19" width="6" height="7"/><rect x="14" y="23" width="3" height="7"/><rect x="23" y="23" width="3" height="7"/></g>`,
    ghost: `<path d="M6 36V19C6 10.7 12.3 4 20 4s14 6.7 14 15v17l-4.7-3.4L24.7 36 20 32.6 15.3 36l-4.6-3.4z" fill="${c}" ${outline} stroke-linejoin="round"/>${shine}${eyes(18)}<ellipse cx="20" cy="26.5" rx="2.6" ry="3" fill="#1a1423"/>`,
    crown: `<path d="M5 31 3.5 10l9.5 8L20 5l7 13 9.5-8L35 31z" fill="${c}" ${outline} stroke-linejoin="round"/><rect x="5" y="30" width="30" height="6" rx="2" fill="${c}" ${outline}/>${shine}<g fill="#fff"><circle cx="20" cy="22" r="2.6"/><circle cx="12" cy="24" r="1.8"/><circle cx="28" cy="24" r="1.8"/></g>`,
  };
  return svg(shapes[shape] ?? shapes.blob, 40);
}

/** Kleine bedien-icons (24er raster, currentColor). */
const ui = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const UI = {
  crown: ui('<path d="M3 18 2 7l5 4 5-7 5 7 5-4-1 11z" fill="currentColor" stroke="none"/>'),
  copy: ui('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  sound: ui('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  mute: ui('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>'),
  palette: ui('<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.8 2-1.8 0-1.3-1.2-1.6-1.2-2.8 0-1 .8-1.7 1.9-1.7H17a4 4 0 0 0 4-4c0-4.3-4-7.7-9-7.7z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>'),
  chat: ui('<path d="M4 5h16v11H9l-5 4z"/>'),
  trade: ui('<path d="M7 7h13l-4-4M17 17H4l4 4"/>'),
  bot: ui('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/>'),
  user: ui('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  close: ui('<path d="M6 6l12 12M18 6 6 18"/>'),
  dice: ui('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  home: ui('<path d="M3 11 12 4l9 7M6 9.5V20h12V9.5"/>'),
  clock: ui('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  gavel: ui('<path d="m14 4 6 6M11 7l6 6M12.5 5.5l-5 5 6 6 5-5M10.5 13.5 3 21"/>'),
  plus: ui('<path d="M12 5v14M5 12h14"/>'),
  door: ui('<path d="M14 3H6v18h8M10 12h11M18 9l3 3-3 3"/>'),
  stats: ui('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  key: ui('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>'),
  people: ui('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 13.5a6.5 6.5 0 0 1 4 6.5"/>'),
  play: ui('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
  eye: ui('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.6 5.3A16.6 16.6 0 0 0 15.5 4l-.5 1a15.4 15.4 0 0 0-6 0l-.5-1a16.5 16.5 0 0 0-4.1 1.3C1.8 9.2 1.1 13 1.4 16.7a16.7 16.7 0 0 0 5.1 2.6l1.1-1.7c-.6-.2-1.2-.5-1.7-.8l.4-.3a11.8 11.8 0 0 0 11.4 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5.1-2.6c.4-4.3-.6-8-3-11.4ZM8.5 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>',
  lock: ui('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  upgrade: ui('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  downgrade: ui('<path d="M12 5v14M5 12l7 7 7-7"/>'),
  sell: ui('<path d="M3 12 12 3h8v8l-9 9z"/><circle cx="16" cy="8" r="1.4" fill="currentColor"/>'),
  mortgage: ui('<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 11h18M7 15h3"/>'),
};

/** Ein bild aus der vorlage: eingebaute id, "emoji:🦎" oder "img:/pfad.png". */
export function artwork(ref, table) {
  if (typeof ref !== 'string') return '';
  if (ref.startsWith('emoji:')) return `<span class="art-emoji">${escapeHtml(ref.slice(6))}</span>`;
  if (ref.startsWith('img:')) return `<img class="art-img" alt="" src="${escapeHtml(ref.slice(4))}">`;
  return table[ref] ?? '';
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
