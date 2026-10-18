import { initLayout } from '../core/layout.js';
import { start } from '../monopoly/app.js';

await initLayout();
try {
  await start();
} catch (error) {
  console.error(error);
  document.querySelector('#mono-app').textContent = `Monopoly konnte nicht geladen werden: ${error.message}`;
}
