// Own CDP driver for Northwind Mail: launches the Playwright headless shell,
// drives the game over the DevTools protocol, takes the screenshots and runs
// the scripted playtest. Node 22+ standard library only (global WebSocket).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME =
  process.env.CHROME ??
  '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9333;
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:8080';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('chrome did not open its DevTools port');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      } else if (m.method) {
        this.events.push(m);
      }
    };
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
  async key(code, key, vk, type) {
    await this.send('Input.dispatchKeyEvent', {
      type, code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  }
  async tap(code, key, vk) {
    await this.key(code, key, vk, 'rawKeyDown');
    await this.key(code, key, vk, 'keyUp');
  }
  async hold(code, key, vk) { await this.key(code, key, vk, 'rawKeyDown'); }
  async release(code, key, vk) { await this.key(code, key, vk, 'keyUp'); }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  }
}

async function main() {
  const mode = process.argv[2];
  const chrome = spawn(CHROME, [
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--mute-audio',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,720', '--force-device-scale-factor=1', '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    await waitForPort();
    const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    if (mode === 'shot') {
      const name = process.argv[3];
      const out = process.argv[4];
      await cdp.send('Page.navigate', { url: `${BASE}/?shot=${name}&seed=1` });
      let ready = false;
      for (let i = 0; i < 60; i++) {
        await sleep(250);
        try { ready = await cdp.eval('window.__shotReady === true'); } catch { ready = false; }
        if (ready) break;
      }
      const errors = await cdp.eval('window.__errors || []').catch(() => []);
      console.log(`shot ${name}: ready=${ready} errors=${JSON.stringify(errors)}`);
      await sleep(300);
      await cdp.shot(out);
      console.log(`wrote ${out}`);
    } else if (mode === 'playtest') {
      const out = process.argv[3] || 'playtest.jpg';
      await cdp.send('Page.navigate', { url: `${BASE}/` });
      await sleep(2500);
      const hasGame = await cdp.eval('!!window.__game').catch(() => false);
      console.log('game loaded:', hasGame);
      if (!hasGame) {
        console.log('errors:', JSON.stringify(await cdp.eval('window.__errors || []').catch(() => [])));
        return;
      }
      // Title -> pick Morning Mail -> briefing -> flying.
      await cdp.tap('Digit1', '1', 49);
      await sleep(300);
      await cdp.tap('Enter', 'Enter', 13);
      await sleep(300);
      await cdp.tap('Enter', 'Enter', 13);
      await sleep(300);
      console.log('screen after start:', await cdp.eval('window.__game.screen'));
      // Takeoff: full throttle, then pull up once rolling.
      await cdp.hold('KeyW', 'w', 87);
      const samples = [];
      for (let i = 0; i < 20; i++) {
        if (i === 6) await cdp.hold('ArrowUp', 'ArrowUp', 38);
        await sleep(1000);
        const s = await cdp.eval(`(() => { const g = window.__game; const p = g.plane; return { t: ${i + 1}, screen: g.screen, x: Math.round(p.x), y: Math.round(p.y), speed: Math.round(p.speed * 10) / 10, vs: Math.round(p.vs * 10) / 10, thr: Math.round(p.throttle * 100) / 100, fuel: Math.round(p.fuel), ground: p.onGround, crash: p.crashed, score: g.mission ? g.mission.score : 0 }; })()`).catch((e) => ({ error: String(e).slice(0, 120) }));
        samples.push(s);
        console.log(JSON.stringify(s));
        if (s.crash) break;
      }
      await cdp.release('KeyW', 'w', 87);
      await cdp.release('ArrowUp', 'ArrowUp', 38);
      const errors = await cdp.eval('window.__errors || []').catch(() => []);
      console.log('page errors:', JSON.stringify(errors));
      await cdp.shot(out);
      console.log(`wrote ${out}`);
    } else {
      console.log('usage: capture.mjs shot <name> <out.jpg> | capture.mjs playtest [out.jpg]');
    }
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('driver failed:', e.message); process.exit(1); });
