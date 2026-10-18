// optik-vorlagen: jede ist eine css-datei unter /assets/monopoly/themes/<id>.css plus eintrag in themes.json

const KEY = 'lcd-monopoly-theme';
let themes = [];

export async function loadThemes() {
  try {
    const response = await fetch('/assets/monopoly/themes/themes.json');
    themes = (await response.json()).themes;
  } catch {
    themes = [{ id: 'lacedaemon', name: 'Lacedaemon Night', swatch: ['#0a1017', '#141d29', '#d6ad77'] }];
  }
  return themes;
}

export const listThemes = () => themes;

export function currentTheme() {
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* egal */ }
  return themes.some(t => t.id === id) ? id : themes[0]?.id ?? 'lacedaemon';
}

/** Theme-css laden und auf den spielbereich anwenden. */
export function applyTheme(root, id) {
  const theme = themes.find(t => t.id === id) ?? themes[0];
  if (!theme) return;
  let link = document.getElementById('mono-theme-css');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = 'mono-theme-css';
    document.head.append(link);
  }
  const href = `/assets/monopoly/themes/${theme.id}.css`;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  if (theme.fonts && !document.querySelector(`link[data-fonts="${theme.id}"]`)) {
    const fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.dataset.fonts = theme.id;
    fonts.href = theme.fonts;
    document.head.append(fonts);
  }
  root.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.swatch[0]);
  try { localStorage.setItem(KEY, theme.id); } catch { /* egal */ }
}
