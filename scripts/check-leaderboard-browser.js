import express from 'express';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => candidate && existsSync(candidate));
if (!browser) throw new Error('Chrome/Edge fehlt. Bitte BROWSER_PATH angeben.');
const fixtures = [{ memberName: 'Zara', balance: 300 }, { memberName: 'Alex', balance: 120 },
  { memberName: 'Ben', balance: 80 }, { memberName: 'Eva', balance: 0 }, { memberName: 'Müller', balance: 120 }];
const app = express();
app.get('/pages/leaderboard.html', (_req, res) => {
  const html = readFileSync(path.join(root, 'public/pages/leaderboard.html'), 'utf8');
  res.type('html').send(html.replace('</body>', '<script type="module" src="/leaderboard-test.js"></script></body>'));
});
app.get('/api/auth/me', (_req, res) => res.json({ member: null }));
app.get('/api/leaderboard', (req, res) => {
  const scenario = new URL(req.get('referer') ?? 'http://localhost').searchParams.get('scenario');
  if (scenario === 'error') return res.status(500).json({ error: 'Testfehler' });
  res.json({ members: scenario === 'empty' ? [] : fixtures, isDemo: true });
});
app.get('/leaderboard-test.js', (_req, res) => res.type('js').send(`
import { renderLeaderboardView } from '/assets/js/components/leaderboard-views.js';
import { rankMembers } from '/assets/js/components/leaderboard-data.js';
await import('/assets/js/pages/leaderboard.js');
const assert = (condition, text) => { if (!condition) throw new Error(text); };
const select = (id, value) => { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); };
const rows = () => [...document.querySelectorAll('#leaderboard-display tbody tr')];
const view = type => document.querySelector('[data-view="' + type + '"]').click();
const reset = () => document.querySelector('#board-reset').click();
try {
  const scenario = new URLSearchParams(location.search).get('scenario');
  const display = document.querySelector('#leaderboard-display');
  if (scenario === 'error') {
    assert(document.querySelector('#board-fields').disabled, 'Error state enabled controls');
    assert(document.querySelector('#board-result-status').textContent.includes('nicht geladen'), 'Missing error message');
    assert(display.getAttribute('aria-busy') === 'false', 'Error left loading state');
  } else if (scenario === 'empty') {
    assert(rows().length === 0, 'Empty data rendered rows');
    assert(display.textContent.includes('Noch keine'), 'Missing empty state');
    assert(document.querySelector('#board-count').textContent === '0', 'Wrong empty summary');
  } else {
    assert(rows().length === 5 && rows()[0].textContent.includes('Zara'), 'Initial order');
    const filters = document.querySelector('.board-filter-menu');
    assert(!filters.open, 'Filters should start collapsed');
    filters.querySelector('summary').click();
    assert(filters.open, 'Filters did not expand');
    select('board-limit', '2');
    assert(rows().length === 2 && document.querySelector('#board-total').textContent === '420', 'Member limit or summary');
    view('bar');
    assert(display.querySelectorAll('.chart-mark').length === 2 && rows().length === 2, 'Chart ignored member limit');
    view('list');
    select('board-sort', 'balance-asc');
    assert(rows().length === 2 && rows()[0].cells[1].textContent === 'Eva', 'Limit applied before sorting');
    select('board-limit', '0');
    assert(document.querySelector('#board-limit').getAttribute('aria-invalid') === 'true' && rows().length === 0, 'Invalid member limit accepted');
    reset();
    assert(document.querySelector('#board-limit').value === '' && rows().length === 5, 'Reset did not clear limit');
    select('board-sort', 'balance-asc');
    assert(rows()[0].textContent.includes('Eva') && rows()[0].cells[0].textContent === '05', 'Ascending sort or stable rank');
    select('board-sort', 'name-asc');
    assert(rows()[0].cells[1].textContent === 'Alex', 'Name ascending');
    select('board-sort', 'name-desc');
    assert(rows()[0].cells[1].textContent === 'Zara', 'Name descending');
    select('board-search', 'MÜLL');
    assert(rows().length === 1 && rows()[0].cells[0].textContent === '02', 'Search or stable rank');
    assert(document.querySelector('#board-total').textContent === '120', 'Filtered summary');
    filters.querySelector('summary').click();
    assert(!filters.open && rows().length === 1, 'Collapsing filters changed the selection');
    filters.querySelector('summary').click();
    reset();
    select('board-min', '100'); select('board-max', '150');
    assert(rows().length === 2, 'Balance filter');
    select('board-max', '50');
    assert(document.querySelector('#board-result-status').classList.contains('error-message') && rows().length === 0, 'Invalid range');
    reset();
    select('board-search', 'Nobody');
    assert(display.textContent.includes('Keine Mitglieder'), 'Missing no-results state');
    reset();
    for (const type of ['bar', 'column', 'pie', 'donut']) {
      view(type);
      assert(display.querySelector('svg'), type + ' did not render');
      assert(rows().length === 5, 'Accessible data table missing');
      assert(!display.querySelector('svg').outerHTML.match(/NaN|Infinity/), 'Invalid SVG values');
      const mark = display.querySelector('.chart-mark');
      mark.dispatchEvent(new FocusEvent('focus'));
      assert(display.querySelector('.board-chart-readout').textContent.includes('Drachen'), 'Keyboard details missing');
    }
    select('board-max', '0');
    assert(!display.querySelector('svg') && display.textContent.includes('positiver Gesamtwert'), 'All-zero circle');
    reset(); select('board-search', 'Zara'); view('pie');
    assert(display.querySelector('svg circle'), 'Single member pie');
    reset();
    const scratch = document.createElement('div');
    const many = rankMembers(Array.from({ length: 35 }, (_, index) => ({ memberName: 'Mitglied ' + index, balance: index })));
    renderLeaderboardView(scratch, many, 'pie');
    assert(scratch.querySelectorAll('.board-legend li').length === 10 && scratch.textContent.includes('Weitere 26'), 'Circle grouping');
    renderLeaderboardView(scratch, many, 'bar');
    assert(scratch.querySelectorAll('.chart-mark').length === 25 && scratch.querySelectorAll('tbody tr').length === 35, 'Bar limit/data loss');
    renderLeaderboardView(scratch, many, 'column');
    assert(scratch.querySelectorAll('.chart-mark').length === 20, 'Column limit');
    renderLeaderboardView(scratch, rankMembers([{ memberName: '<img src=x onerror=alert(1)>', balance: 1 }]), 'list');
    assert(!scratch.querySelector('img') && scratch.textContent.includes('<img'), 'Name became HTML');
    view('donut');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Page overflows viewport');
  }
  document.body.dataset.leaderboardTest = 'passed';
} catch (error) {
  document.body.dataset.leaderboardTest = 'failed';
  document.querySelector('#board-result-status').textContent = error.stack;
}
`));
app.use(express.static(path.join(root, 'public')));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const temporary = mkdtempSync(path.join(tmpdir(), 'lacedaemon-leaderboard-'));

async function checkBrowser(profile, screenshot, width, url) {
  const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-extensions', '--hide-scrollbars',
    '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true });
  const exit = new Promise(resolve => child.once('exit', resolve));
  let socket;
  const timer = setTimeout(() => child.kill(), 25000);
  try {
    const port = await new Promise((resolve, reject) => {
      let log = '';
      child.stderr.on('data', chunk => {
        log += chunk;
        const found = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (found) resolve(Number(found[1]));
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Browser exited before DevTools started: ' + log.slice(-1000))));
    });
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    socket.addEventListener('close', () => { for (const { reject } of pending.values()) reject(new Error('DevTools closed')); pending.clear(); });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 700 });
    await command('Page.navigate', { url });
    let state;
    for (let attempt = 0; attempt < 150; attempt++) {
      const evaluated = await command('Runtime.evaluate', {
        expression: '({result:document.body?.dataset.leaderboardTest,message:document.querySelector("#board-result-status")?.textContent,width:innerWidth})',
        returnByValue: true,
      });
      state = evaluated.result.value;
      if (state?.result) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (state?.result !== 'passed') throw new Error(state?.message ?? 'Browser test timed out');
    if (state.width !== width) throw new Error('Wrong viewport: ' + state.width);
    const captured = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(screenshot, Buffer.from(captured.data, 'base64'));
    await command('Browser.close').catch(() => {});
  } finally {
    socket?.close();
    child.kill();
    await exit;
    clearTimeout(timer);
  }
}

try {
  for (const [name, width, scenario] of [['desktop', 1440, 'normal'], ['mobile', 390, 'normal'], ['empty', 1000, 'empty'], ['error', 1000, 'error']]) {
    const profile = path.join(temporary, name + '-profile');
    const screenshot = path.join(temporary, name + '.png');
    await checkBrowser(profile, screenshot, width,
      'http://127.0.0.1:' + server.address().port + '/pages/leaderboard.html?scenario=' + scenario);
    console.log(name + ': OK; screenshot: ' + screenshot);
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  // Delete only this test run's known browser profile directories, preserving screenshots.
  for (const name of ['desktop', 'mobile', 'empty', 'error']) {
    const profile = path.resolve(temporary, name + '-profile');
    if (path.dirname(profile) === path.resolve(temporary) && path.basename(temporary).startsWith('lacedaemon-leaderboard-')) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Browser files may still be locked. */ }
    }
  }
}
