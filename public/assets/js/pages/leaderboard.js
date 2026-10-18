import { initLayout } from '../core/layout.js';
import { api } from '../core/api.js';
import { renderLeaderboard } from '../components/leaderboard.js';

await initLayout();
try {
  const { members, isDemo } = await api('/leaderboard');
  document.querySelector('#board-hint').textContent = isDemo
    ? 'Beispieldaten. Die tatsächlichen Discord-Drachenwerte werden später über eine gesicherte Integration importiert.'
    : 'Drachenwerte aus der Datenbank.';
  renderLeaderboard(document.querySelector('#leaderboard-rows'), members);
} catch (error) {
  document.querySelector('#board-hint').textContent = error.message;
}
