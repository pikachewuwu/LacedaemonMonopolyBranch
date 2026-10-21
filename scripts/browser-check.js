import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';

// Valid one-pixel PNG keeps browser checks independent of external image availability.
const fixturePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHGkAAAAASUVORK5CYII=';

export async function checkBrowser(browser, profile, screenshot, width, url) {
  const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-extensions', '--hide-scrollbars',
    '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const logs = [];
  let socket;
  const timer = setTimeout(() => child.kill(), 30_000);
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
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.consoleAPICalled') {
        logs.push(message.params.type + ': ' + message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
      }
      if (message.method === 'Runtime.exceptionThrown') {
        logs.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      }
      if (message.method === 'Fetch.requestPaused') {
        void command('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: fixturePng }).catch(error => logs.push(error.message));
      }
      if (!pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const { reject } of pending.values()) reject(new Error('DevTools closed'));
      pending.clear();
    });
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Fetch.enable', { patterns: [
      { urlPattern: 'https://*.steamstatic.com/*', requestStage: 'Request' },
      { urlPattern: 'https://cdn.discordapp.com/*', requestStage: 'Request' },
      { urlPattern: 'https://cdn.myanimelist.net/*', requestStage: 'Request' },
    ] });
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 700 });
    await command('Page.navigate', { url });
    let state;
    for (let attempt = 0; attempt < 240; attempt++) {
      const evaluated = await command('Runtime.evaluate', {
        expression: '({result:document.body?.dataset.gamesTest ?? document.body?.dataset.animeTest,message:document.body?.dataset.gamesTestError ?? document.body?.dataset.animeTestError,width:innerWidth})',
        returnByValue: true,
      });
      state = evaluated.result.value;
      if (state?.result) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const captured = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(screenshot, Buffer.from(captured.data, 'base64'));
    if (state?.result !== 'passed') throw new Error((state?.message ?? 'Browser test timed out') + '\nBrowser console:\n' + logs.join('\n'));
    assert.equal(state.width, width, 'Wrong CDP viewport');
    await command('Browser.close').catch(() => {});
  } finally {
    socket?.close();
    child.kill();
    await exited;
    clearTimeout(timer);
  }
}

