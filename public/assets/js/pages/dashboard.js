import { initLayout } from '../core/layout.js';
import { api } from '../core/api.js';
import { renderLeaderboard } from '../components/leaderboard.js';

await initLayout();
try {
  const { counts, leaderboard, leaderboardIsDemo } = await api('/overview');
  document.querySelector('#anime-count').textContent = counts.anime;
  document.querySelector('#games-count').textContent = counts.games;
  document.querySelector('#leaderboard-kind').textContent = leaderboardIsDemo ? 'Beispieldaten – Discord-Anbindung folgt' : 'Gespeicherte Daten';
  renderLeaderboard(document.querySelector('#leaderboard-rows'), leaderboard.slice(0, 5));
} catch (error) {
  document.querySelector('#page-message').textContent = error.message;
}
