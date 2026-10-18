// End-to-end: build example/, serve it, drive headless Chrome over CDP; then the editor.
//   node test/e2e.js        exit 0 only if every assertion passes
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, '.tmp/e2e-dist'), SITE_PORT = 4208, EDITOR_PORT = 4209;
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/assets/data/site.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', mp4: 'video/mp4', mp3: 'audio/mpeg', ttf: 'font/ttf' };

let failed = 0;
const check = (name, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && info ? `  (${info})` : ''}`); };

const cleanups = [];
async function main() {
  // ---- build + static server ----
  const b = spawnSync(process.execPath, ['cli.js', 'build', 'example', '--out', DIST], { cwd: ROOT, encoding: 'utf8' });
  check('build succeeds', b.status === 0, (b.stderr || b.stdout).trim());
  const server = http.createServer((req, res) => {
    const f = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(DIST + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).slice(1)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(SITE_PORT, '127.0.0.1', r));
  cleanups.push(() => server.close());

  const page = await chrome();
  const id = name => page.eval(`GPSB.find(${JSON.stringify(name)})?.id`);
  const style = (name, prop) => page.eval(`getComputedStyle(GPSB.el(GPSB.find(${JSON.stringify(name)}).id))[${JSON.stringify(prop)}]`);

  // ---- built site: index ----
  await page.open(`http://127.0.0.1:${SITE_PORT}/index.html`);
  const ready = await page.until(`window.GPSB?.behaviour && GPSB.behaviour(GPSB.find('Ring')?.id, 'Spin')`);
  check('index: runtime + behaviours boot', !!ready);
  check('index: Repeat renders one Card per site.json feature', await page.eval(`GPSB.els(GPSB.find('Feature Card').id).length`) === site.features.length);
  check('index: Repeat clones get their own node data (GPSB.nodeFor)', await page.eval(`(() => { const els = GPSB.els(GPSB.find('Feature Card').id); return new Set(els.map(e => JSON.stringify(GPSB.nodeFor(e).components.map(c => c.props)))).size === els.length && GPSB.nodeFor(els[0]) === GPSB.nodeFor(els[0]); })()`));
  check('index: Repeat renders one Post per site.json post', await page.eval(`GPSB.els(GPSB.find('Post').id).length`) === site.posts.length);
  check('index: {{data/site.json:...}} binding resolved', (await page.eval(`GPSB.el(GPSB.find('Eyebrow').id).textContent`)) === site.hero.eyebrow);
  const card = await page.eval(`(() => { const c = document.querySelector('gpsb-card'); return c?.shadowRoot ? { h3: c.shadowRoot.querySelector('h3')?.textContent, img: c.shadowRoot.querySelector('img')?.getAttribute('src') } : null; })()`);
  check('index: custom element has a populated shadowRoot', card?.h3 === site.features[0].title && card?.img?.split('?')[0].endsWith(site.features[0].icon) && /\?v=[0-9a-f]{10}$/.test(card?.img ?? ''), JSON.stringify(card));

  const ring1 = await style('Ring', 'transform'), orb1 = await style('Orbiter', 'transform');
  await sleep(700);
  const ring2 = await style('Ring', 'transform'), orb2 = await style('Orbiter', 'transform');
  check('index: behaviour (Spin) changes the Ring over time', ring1 !== ring2 && ring2 !== 'none', `${ring1} -> ${ring2}`);
  check('index: Animator (Orbit clip) changes computed style over time', orb1 !== orb2, `${orb1} -> ${orb2}`);
  const sprites = new Set();
  for (let i = 0; i < 6; i++) { sprites.add(await style('Chomper', 'backgroundImage')); await sleep(70); }
  check('index: sprite swap animation changes Image.sprite', sprites.size > 1, `${sprites.size} distinct`);

  const typed = await page.eval(`(() => { const e = GPSB.el(GPSB.find('Subtitle').id); return e.querySelector('.caret') ? e.textContent : null; })()`);
  check('index: Typewriter (started by a clip event) typed the subtitle', typed?.startsWith(site.hero.subtitle.slice(0, 20)), typed);

  const speed0 = await page.eval(`GPSB.behaviour(GPSB.find('Ring').id, 'Spin').props.speed`);
  await page.eval(`GPSB.el(GPSB.find('Spin Button').id).click()`);
  check('index: Button.onClick calls a behaviour method', await page.eval(`GPSB.behaviour(GPSB.find('Ring').id, 'Spin').props.speed`) === speed0 * 2);
  const panelId = await id('Inspector Panel');
  const shown0 = await page.eval(`getComputedStyle(GPSB.el('${panelId}')).display`);
  await page.eval(`GPSB.el(GPSB.find('Panel Button').id).click()`);
  await sleep(100);
  const shown1 = await page.eval(`getComputedStyle(GPSB.el('${panelId}')).display`);
  check('index: Button.onClick setActive toggles a panel', shown0 === 'none' && shown1 !== 'none', `${shown0} -> ${shown1}`);
  const c = await page.eval(`(() => { const c = document.querySelector('gpsb-counter'); c.shadowRoot.querySelector('.inc').click(); c.shadowRoot.querySelector('.inc').click(); return c.shadowRoot.querySelector('.value').textContent; })()`);
  check('index: Counter component script is interactive', c === '2', c);
  const unit = await page.eval(`(async () => {
    const { define } = await import('./gpsb/component.js');
    const host = document.createElement('div');
    document.body.append(host);
    // parsed before define -> upgrade path
    host.innerHTML = '<gpsb-e2e-t n="4" on items="[1,2]" label="a&lt;b" html="&lt;i&gt;x&lt;/i&gt;"></gpsb-e2e-t>';
    const changes = [];
    define('gpsb-e2e-t', { template: '<p title="{{label}}">{{label}} {{n}} {{items.1}}</p><div>{{{html}}}</div>', style: 'p{color:red}',
      props: { n: { type: 'int', default: 1 }, on: { type: 'bool', default: false }, off: { type: 'bool', default: true }, items: { type: 'list', default: [] },
        label: { type: 'string', default: '' }, html: { type: 'text', default: '' }, bad: { type: 'vec2', default: [0, 0] } } },
      class extends (await import('./gpsb/component.js')).Component { propChanged(k, v) { changes.push(k + '=' + v); } });
    const el = host.firstChild, p = () => el.shadowRoot.querySelector('p');
    const a = { props: { ...el.props }, text: p().textContent, title: p().title, raw: el.shadowRoot.querySelector('i')?.textContent, style: el.shadowRoot.querySelector('style').textContent };
    el.setAttribute('n', '7'); el.setAttribute('bad', '{oops');
    await Promise.resolve();
    // created after define
    const el2 = document.createElement('gpsb-e2e-t'); el2.setAttribute('off', 'false'); host.append(el2);
    const r = { ...a, after: p().textContent, bad: el.props.bad, changes, off: el2.props.off, def: el2.shadowRoot.querySelector('p').textContent };
    host.remove();
    return r;
  })()`);
  check('component.js: typed props from attributes', JSON.stringify(unit.props) === JSON.stringify({ n: 4, on: true, off: true, items: [1, 2], label: 'a<b', html: '<i>x</i>', bad: [0, 0] }), JSON.stringify(unit.props));
  check('component.js: {{x}} escaped in text + attributes, {{{x}}} raw, :host default', unit.text === 'a<b 4 2' && unit.title === 'a<b' && unit.raw === 'x' && unit.style.startsWith(':host{display:block}'), JSON.stringify(unit));
  check('component.js: re-render on attribute change, bad JSON -> default', unit.after === 'a<b 7 2' && JSON.stringify(unit.bad) === '[0,0]' && unit.changes.includes('n=7'), JSON.stringify(unit));
  check('component.js: element created after define', unit.off === false && unit.def === ' 1 ', JSON.stringify(unit));
  check('index: zero console errors / exceptions', page.errors.length === 0, page.errors.join(' | '));

  // ---- built site: about ----
  await page.open(`http://127.0.0.1:${SITE_PORT}/about.html`);
  await page.until(`window.GPSB?.behaviour`);
  await sleep(500);
  check('about: Card child node projected into its <slot>', await page.eval(`document.querySelector('gpsb-card').shadowRoot.querySelector('slot').assignedElements().length`) === 1);
  const bp = () => page.eval(`(() => { const q = n => GPSB.el(GPSB.find(n).id); return { brand: q('Brand').textContent.trim(), title: getComputedStyle(q('About Title')).fontSize, about: getComputedStyle(q('Nav About')).display, active: GPSB.breakpoints().join() }; })()`);
  const desk = await bp();
  await page.resize(390, 844); await sleep(400);
  const phone = await bp();
  await page.resize(1440, 900); await sleep(400);
  const back = await bp();
  check('about: Phone breakpoint overrides (CSS size, text, active) apply at 390px', phone.title === '34px' && phone.brand === 'perfect site builder' && phone.about === 'none' && phone.active === 'Tablet,Phone', JSON.stringify(phone));
  check('about: base values at desktop, restored after resizing back', desk.title === '52px' && desk.about !== 'none' && JSON.stringify(back) === JSON.stringify(desk), JSON.stringify({ desk, back }));
  check('about: zero console errors / exceptions', page.errors.length === 0, page.errors.join(' | '));

  // ---- editor ----
  const cfg = path.join(ROOT, '.tmp', 'e2e-config'); // keep the user's real project list / prefs untouched
  fs.rmSync(cfg, { recursive: true, force: true });
  const ed = spawn(process.execPath, ['cli.js', 'serve', 'example', '--port', String(EDITOR_PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GPSB_CONFIG_DIR: cfg } });
  cleanups.push(() => ed.kill());
  await new Promise((ok, err) => { ed.stdout.on('data', d => /editor:/.test(d) && ok()); ed.on('exit', c => err(new Error(`editor server exited ${c}`))); });
  await page.open(`http://127.0.0.1:${EDITOR_PORT}/`);
  check('hub: lists the opened example project', !!await page.until(`document.body.innerText.includes('${path.join(ROOT, 'example').replace(/\\/g, '\\\\')}')`, 5000));
  await page.open(`http://127.0.0.1:${EDITOR_PORT}/editor/`);
  const names = ['Canvas', 'Hero', 'Ring', 'Orbiter', 'Feature Card', 'Inspector Panel', 'Gallery Grid'];
  await page.until(`document.querySelector('[data-panel=hierarchy]')?.innerText.includes('Inspector Panel')`, 5000);
  const tree = await page.eval(`document.querySelector('[data-panel=hierarchy]')?.innerText ?? ''`);
  const missing = names.filter(n => !tree.includes(n));
  check('editor: Hierarchy lists the example node names', !missing.length, missing.length ? `missing ${missing.join(', ')}` : '');
  await sleep(1000);
  check('editor: zero console errors / exceptions', page.errors.length === 0, page.errors.join(' | '));

  // ---- TypeScript + engine API + tweens: test/fixtures/scripting, built ----
  const TS = path.join(ROOT, '.tmp/e2e-scripting'), TS_PORT = 4210, TS_EDITOR_PORT = 4211;
  fs.rmSync(TS, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'test/fixtures/scripting'), TS, { recursive: true });
  const tb = spawnSync(process.execPath, ['cli.js', 'build', TS], { cwd: ROOT, encoding: 'utf8' });
  check('scripting: TypeScript project builds', tb.status === 0, (tb.stderr || tb.stdout).trim());
  cleanups.push(await serveDir(path.join(TS, 'dist'), TS_PORT));
  await page.open(`http://127.0.0.1:${TS_PORT}/index.html`);
  const tsDone = await page.until(`GPSB.behaviour?.('mover', 'TweenDemo')?.phase === 2`, 5000);
  check('scripting: TS behaviour runs a coroutine of tweens to the end', !!tsDone);
  const st = await page.eval(`(() => { const n = id => GPSB.nodeFor(GPSB.el(id)); return { label: GPSB.el('label').textContent, pos: n('mover').rect.pos, scale: n('mover').rect.scale, color: n('mover').components[0].props.color, lp: n('mover').rect._layoutPos ?? null, speed: GPSB.behaviour('box', 'Spinner').speed }; })()`);
  check('scripting: tweens moved, scaled and recoloured the object (and cleaned up _layoutPos)', JSON.stringify([st.pos, st.scale, st.color, st.lp]) === JSON.stringify([[300, 300], [1.5, 1.5], '#ff3366', null]), JSON.stringify(st));
  check('scripting: typed node prop wrote into a Text, WebEvent called another behaviour', st.label === 'done:2' && st.speed === -180, JSON.stringify(st));
  const rot1 = await page.eval(`GPSB.nodeFor(GPSB.el('box')).rect.rotation`); await sleep(300);
  check('scripting: update() + rectTransform rotate the object (applied automatically)', (await page.eval(`GPSB.nodeFor(GPSB.el('box')).rect.rotation`)) !== rot1 && (await page.eval(`GPSB.el('box').style.transform`)).includes('rotate'));
  await page.eval(`GPSB.el('badge').click()`); await sleep(100);
  check('scripting: TS extension: build-time HTML, init + prop field re-applies (patch)', (await page.eval(`GPSB.el('badge').textContent`)) === 'BETA x1');
  check('scripting: zero console errors / exceptions', page.errors.length === 0, page.errors.join(' | '));

  // ---- the same project in the editor (dev server compiles .ts on request) ----
  const ted = spawn(process.execPath, ['cli.js', 'serve', TS, '--port', String(TS_EDITOR_PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GPSB_CONFIG_DIR: cfg } });
  cleanups.push(() => ted.kill());
  await new Promise((ok, err) => { ted.stdout.on('data', d => /editor:/.test(d) && ok()); ted.on('exit', c => err(new Error(`editor server exited ${c}`))); });
  await page.open(`http://127.0.0.1:${TS_EDITOR_PORT}/editor/`);
  await page.until(`document.querySelector('[data-panel=hierarchy]')?.innerText.includes('Mover')`, 5000);
  await sleep(800);
  const meta = await page.eval(`(async () => { const S = await import('/editor/state.js'), C = await import('/lib/components.js'); return { tween: S.S.behaviourMeta.TweenDemo, spin: S.S.behaviourMeta.Spinner, badge: !!C.builtins.Badge?.extension }; })()`);
  check('editor (TS): behaviour props + methods read from compiled .ts', JSON.stringify(Object.keys(meta.tween?.props ?? {})) === '["target","distance","tint","onDone"]' && meta.spin?.methods?.includes('reverse') && !meta.tween?.error, JSON.stringify(meta));
  check('editor (TS): .ts extension registered like a built-in', meta.badge);
  check('editor (TS): Scene preview shows the extension HTML', !!await page.until(`[...document.querySelectorAll('iframe[title=Preview]')].some(f => f.contentDocument?.body?.innerHTML.includes('>BETA<'))`, 5000));
  check('editor (TS): typings + tsconfig.json written for the IDE', fs.existsSync(path.join(TS, '.gpsb/types/gpsb/project.d.ts')) && fs.existsSync(path.join(TS, 'tsconfig.json')));
  await page.eval(`import('/editor/state.js').then(S => S.setPlaying(true))`);
  const played = await page.until(`[...document.querySelectorAll('iframe[title=Preview]')].some(f => f.contentWindow?.GPSB?.behaviour?.('mover', 'TweenDemo')?.phase === 2 && f.contentDocument.querySelector('[data-gpsb=label]').textContent === 'done:2')`, 6000);
  check('editor (TS): Play mode runs the TS behaviours and tweens', !!played);
  await page.eval(`import('/editor/state.js').then(S => S.setPlaying(false))`);
  await sleep(300);
  check('editor (TS): zero console errors / exceptions', page.errors.length === 0, page.errors.join(' | '));
  const served = await fetch(`http://127.0.0.1:${TS_EDITOR_PORT}/project/behaviours/Spinner.js`).then(r => r.text());
  check('dev server: .ts served compiled under its .js name', /class Spinner extends Behaviour/.test(served) && !/declare|: number/.test(served) && /sourceMappingURL=data:/.test(served));
  fs.writeFileSync(path.join(TS, 'behaviours/Bad.ts'), 'export default class { x: = 1 }\n');
  const bad = await fetch(`http://127.0.0.1:${TS_EDITOR_PORT}/project/behaviours/Bad.js`).then(r => r.text());
  check('dev server: a TS syntax error comes back as a script that throws it', /^throw new SyntaxError\(".*behaviours\/Bad\.ts/.test(bad), bad.slice(0, 120));
}

// static file server for a built site -> cleanup function
async function serveDir(dir, port) {
  const s = http.createServer((req, res) => {
    const f = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(dir + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).slice(1)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => s.listen(port, '127.0.0.1', r));
  return () => s.close();
}

// minimal CDP client (same approach as test/browser.js)
async function chrome(W = 1440, H = 900) {
  const bin = [process.env.CHROME, '/usr/bin/google-chrome', '/snap/bin/chromium', '/usr/bin/chromium'].find(f => f && fs.existsSync(f));
  if (!bin) throw new Error('no chrome found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gpsb-e2e-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  cleanups.push(() => { proc.kill('SIGKILL'); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(100);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).then(l => l.find(t => t.type === 'page')).catch(() => null);
  }
  if (!target) throw new Error('chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let n = 0;
  const pending = new Map(), page = { errors: [] };
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      page.errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown') page.errors.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon\.ico/.test(m.params.entry.url ?? ''))
      page.errors.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++n; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  page.eval = async expr => {
    const r = (await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true })).result;
    if (r?.exceptionDetails) throw new Error(`eval failed: ${expr}\n${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r?.result?.value;
  };
  page.open = async url => {
    page.errors = [];
    const loaded = new Promise(r => { const f = e => { if (JSON.parse(e.data).method === 'Page.loadEventFired') { ws.removeEventListener('message', f); r(); } }; ws.addEventListener('message', f); });
    await send('Page.navigate', { url });
    await Promise.race([loaded, sleep(10000)]);
  };
  page.resize = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  page.until = async (expr, ms = 8000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) { const v = await page.eval(expr).catch(() => null); if (v) return v; }
    return null;
  };
  return page;
}

try { await main(); } catch (e) { failed++; console.log('FAIL', e.stack ?? e); } finally { for (const f of cleanups.reverse()) try { f(); } catch {} }
console.log(failed ? `\n${failed} assertion(s) failed` : '\nall e2e assertions passed');
process.exit(failed ? 1 : 0);
