// Headless Chrome check via the DevTools protocol (no deps; Node's built-in WebSocket).
//   node test/browser.js <url> [--shot out.png] [--eval "js expr"] [--wait ms] [--size 1600x1000]
// Prints console messages + uncaught exceptions, the --eval result (awaited, JSON), exits 1 on page errors.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const shot = opt('--shot'), expr = opt('--eval'), wait = +opt('--wait', 1500), [W, H] = opt('--size', '1600x1000').split('x').map(Number);
const url = args[0];
if (!url) { console.log('usage: node test/browser.js <url> [--shot f.png] [--eval expr] [--wait ms] [--size WxH]'); process.exit(2); }

const bin = [process.env.CHROME, '/usr/bin/google-chrome', '/snap/bin/chromium', '/usr/bin/chromium'].find(f => f && fs.existsSync(f));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gpsb-chrome-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
// Chrome's helper processes can still be writing the profile right after the kill: retry, and never crash on it
const cleanup = () => { chrome.kill('SIGKILL'); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(100);
  target = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).then(l => l.find(t => t.type === 'page')).catch(() => null);
}
if (!target) { console.error('chrome did not start'); cleanup(); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); let errors = 0;
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a.preview ?? a.type)).join(' ');
    if (m.params.type === 'error') errors++;
    console.log(`[console.${m.params.type}] ${text}`);
  } else if (m.method === 'Runtime.exceptionThrown') {
    errors++;
    const d = m.params.exceptionDetails;
    console.log(`[exception] ${d.exception?.description ?? d.text} ${d.url ?? ''}:${d.lineNumber ?? ''}`);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon\.ico/.test(m.params.entry.url ?? '')) {
    errors++;
    console.log(`[log.error] ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(wait);
if (expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
  const res = r.result;
  if (res?.exceptionDetails) { errors++; console.log('[eval error]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text); }
  else console.log('[eval]', JSON.stringify(res?.result?.value, null, 2));
  await sleep(300);
}
if (shot) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot, Buffer.from(r.result.data, 'base64'));
  console.log(`[shot] ${shot}`);
}
ws.close(); cleanup();
console.log(errors ? `${errors} error(s)` : 'no errors');
process.exit(errors ? 1 : 0);
