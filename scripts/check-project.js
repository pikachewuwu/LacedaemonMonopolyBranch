import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

//Prüft ob die Projekt-Struktur korrekt aufgebaut ist anhand der angegebenen required -> muss ggf. angepasst werden wenn sich dateinamen
//etc ändern

const required = [
  'public/index.html', 'public/pages/anime.html', 'public/pages/games.html',
  'public/pages/leaderboard.html', 'public/pages/fantasy.html',
  'public/assets/css/base.css', 'public/assets/js/core/layout.js',
  'public/assets/css/pages/games.css', 'public/assets/js/components/steam-games.js',
  'src/modules/games/steam.service.js', 'src/modules/games/games.routes.js',
  'src/modules/anime/mal.service.js', 'src/modules/anime/anime.routes.js',
  'public/assets/js/components/anime.js', 'public/assets/css/pages/anime.css',
  'src/server.js', 'src/app.js', 'src/db/migrations/sqlite.sql',
  'public/pages/monopoly.html', 'public/assets/css/pages/monopoly.css', 'public/assets/js/monopoly/app.js',
  'public/assets/monopoly/themes/themes.json', 'src/modules/monopoly/maps/lacedaemon.json',
  '.env.example', '.gitignore', 'README.md',
];
let failed = false;
for (const file of required) {
  if (!existsSync(file)) {
    console.error(`Fehlt: ${file}`);
    failed = true;
  }
}
function findJavaScript(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...findJavaScript(file));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(file);
  }
  return result;
}
for (const file of ['public', 'src', 'tests', 'scripts'].flatMap(findJavaScript)) {
  try {
    execFileSync(process.execPath, ['--check', path.resolve(file)], { stdio: 'pipe' });
  } catch {
    console.error(`JavaScript-Syntaxfehler: ${file}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log('Projektstruktur und JavaScript-Syntax: OK');
