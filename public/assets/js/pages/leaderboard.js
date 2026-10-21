import { initLayout } from '../core/layout.js';
import { api } from '../core/api.js';
import { formatNumber } from '../core/dom.js';
import { rankMembers, selectMembers, summarizeMembers } from '../components/leaderboard-data.js';
import { renderLeaderboardView } from '../components/leaderboard-views.js';

const controls = document.querySelector('#board-controls');
const fields = document.querySelector('#board-fields');
const display = document.querySelector('#leaderboard-display');
const status = document.querySelector('#board-result-status');
const views = { list: 'Rangliste', bar: 'Balkendiagramm', column: 'Säulendiagramm', pie: 'Kreisdiagramm', donut: 'Ringdiagramm' };
let members = [];
let view = 'list';

function update() {
  const minInput = document.querySelector('#board-min');
  const maxInput = document.querySelector('#board-max');
  const limitInput = document.querySelector('#board-limit');
  const min = minInput.value === '' ? 0 : minInput.valueAsNumber;
  const max = maxInput.value === '' ? Infinity : maxInput.valueAsNumber;
  const rangeValid = minInput.validity.valid && maxInput.validity.valid && min <= max;
  const valid = rangeValid && limitInput.validity.valid;
  minInput.setAttribute('aria-invalid', String(!minInput.validity.valid));
  maxInput.setAttribute('aria-invalid', String(!rangeValid));
  limitInput.setAttribute('aria-invalid', String(!limitInput.validity.valid));
  const selected = valid ? selectMembers(members, {
    search: document.querySelector('#board-search').value,
    min, max,
    ranks: document.querySelector('#board-ranks').value === 'all' ? Infinity : Number(document.querySelector('#board-ranks').value),
    sort: document.querySelector('#board-sort').value,
    limit: limitInput.value === '' ? Infinity : limitInput.valueAsNumber,
  }) : [];
  const summary = summarizeMembers(selected);
  document.querySelector('#board-count').textContent = formatNumber(summary.count);
  document.querySelector('#board-total').textContent = formatNumber(summary.total);
  document.querySelector('#board-average').textContent = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(summary.average);
  document.querySelector('#board-view-title').textContent = views[view];
  status.classList.toggle('error-message', !valid);
  status.textContent = valid
    ? `${formatNumber(selected.length)} von ${formatNumber(members.length)} Mitgliedern · Platzierungen aus der gesamten Rangliste`
    : !limitInput.validity.valid ? 'Bitte gib eine ganze Mitgliederzahl von mindestens 1 ein.'
      : 'Bitte gib gültige Drachenwerte ein. Der Höchstwert darf nicht unter dem Mindestwert liegen.';
  renderLeaderboardView(display, selected, view, !valid ? 'Bitte korrigiere die Filterwerte.' :
    members.length ? 'Keine Mitglieder passen zu deinen Filtern.' : 'Noch keine Einträge vorhanden.');
}

controls.addEventListener('submit', event => event.preventDefault());
controls.addEventListener('input', update);
controls.addEventListener('change', update);
controls.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    controls.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    update();
  });
});
document.querySelector('#board-reset').addEventListener('click', () => {
  controls.reset();
  view = 'list';
  controls.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  update();
});

void initLayout();
try {
  const { members: data, isDemo } = await api('/leaderboard');
  if (!Array.isArray(data) || data.some(member => typeof member?.memberName !== 'string' || !Number.isFinite(member.balance) || member.balance < 0)) {
    throw new Error('Die Rangliste enthält ungültige Daten.');
  }
  members = rankMembers(data);
  document.querySelector('#board-hint').textContent = isDemo
    ? 'Beispieldaten. Die tatsächlichen Discord-Drachenwerte werden später über eine gesicherte Integration importiert.'
    : 'Drachenwerte aus der Datenbank.';
  fields.disabled = false;
  update();
} catch (error) {
  status.textContent = 'Die Rangliste konnte nicht geladen werden. Bitte lade die Seite erneut.';
  status.classList.add('error-message');
  document.querySelector('#board-hint').textContent = error.message;
} finally {
  display.setAttribute('aria-busy', 'false');
}
