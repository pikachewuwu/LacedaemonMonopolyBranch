import { initLayout } from '../core/layout.js';
import { api } from '../core/api.js';
import { renderCatalog } from '../components/catalog.js';
import { showMessage } from '../core/dom.js';

export async function initCatalogPage(category) {
  await initLayout();
  const target = document.querySelector('#catalog-list');
  const form = document.querySelector('#catalog-form');
  const message = document.querySelector('#form-message');
  const count = document.querySelector('#catalog-count');

  async function refresh() {
    const { items } = await api(`/catalog/${category}`);
    count.textContent = `${items.length} Titel`;
    renderCatalog(target, items, category);
  }

  try { await refresh(); }
  catch (error) { showMessage(message, error.message, true); }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const data = new FormData(form);
    const input = {
      title: String(data.get('title') ?? '').trim(),
      memberName: String(data.get('memberName') ?? '').trim(),
      score: Number(data.get('score')),
      status: String(data.get('status')),
    };
    button.disabled = true;
    try {
      await api(`/catalog/${category}/reviews`, { method: 'POST', body: JSON.stringify(input) });
      showMessage(message, 'Bewertung wurde gespeichert. Derselbe Name kann seine Bewertung später überschreiben.');
      form.elements.title.value = '';
      await refresh();
    } catch (error) {
      showMessage(message, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}
