// kleiner dom-baukasten: h('div.klasse', {attribute}, kinder...). texte immer als textnode

export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className += ` ${value}`;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'html') node.innerHTML = value; // nur für eigene svg-konstanten
    else if (key.startsWith('--')) node.style.setProperty(key, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Inhalt nur neu bauen, wenn sich der schlüssel geändert hat (schont fokus und animationen). */
export function renderIf(node, key, build) {
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  node.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
}

export const $ = (selector, root = document) => root.querySelector(selector);

export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
