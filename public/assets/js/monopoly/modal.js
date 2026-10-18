// ein dialog zur zeit; schließen mit esc, klick daneben oder x

import { h } from './dom.js';
import { UI } from './icons.js';

let current = null;

export function openModal({ title, className = '', body, onClose }) {
  closeModal();
  const close = () => closeModal();
  const panel = h(`div.modal.${className || 'modal-default'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title ?? 'Dialog' },
    h('button.modal-x', { type: 'button', 'aria-label': 'Close', onclick: close, html: UI.close }),
    title ? h('h2.modal-title', title) : null,
    h('div.modal-body', body),
  );
  const backdrop = h('div.modal-backdrop', { onmousedown: e => { if (e.target === backdrop) close(); } }, panel);
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.querySelector('.mono-root')?.append(backdrop) ?? document.body.append(backdrop);
  current = { backdrop, onKey, onClose, panel };
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  panel.querySelector('button:not(.modal-x), input, select')?.focus({ preventScroll: true });
  return current;
}

export function closeModal() {
  if (!current) return;
  const { backdrop, onKey, onClose } = current;
  current = null;
  document.removeEventListener('keydown', onKey);
  backdrop.classList.remove('is-open');
  setTimeout(() => backdrop.remove(), 180);
  onClose?.();
}

export const modalOpen = name => current?.panel.classList.contains(name);

/** Kurze meldung unten rechts. */
export function toast(text, kind = 'info') {
  let stack = document.querySelector('.toasts');
  if (!stack) {
    stack = h('div.toasts', { 'aria-live': 'polite' });
    (document.querySelector('.mono-root') ?? document.body).append(stack);
  }
  const el = h(`div.toast.toast-${kind}`, text);
  stack.append(el);
  setTimeout(() => el.classList.add('is-out'), 3200);
  setTimeout(() => el.remove(), 3600);
}
