// End-to-end: build example/, serve it, drive headless Chrome over CDP; then the editor.
//   node test/e2e.js        exit 0 only if every assertion passes
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pm from '../pm.js';
import { startRegistry, PACKAGES } from './registry.js';

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

  // ---- npm packages (pm.js) from a fake registry: imported by name in the built site, the editor and Play mode ----
  const reg = await startRegistry(PACKAGES);
  cleanups.push(() => reg.close());
  const PK = path.join(ROOT, '.tmp/e2e-packages'), PK_PORT = 4212, PK_EDITOR_PORT = 4213;
  fs.rmSync(PK, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'test/fixtures/scripting'), PK, { recursive: true });
  fs.mkdirSync(path.join(PK, 'packages')); fs.mkdirSync(path.join(PK, 'public/vendor'), { recursive: true });
  fs.writeFileSync(path.join(PK, 'packages/manifest.json'), JSON.stringify({ registry: reg.url, dependencies: {} }));
  fs.writeFileSync(path.join(PK, 'public/vendor/v.js'), 'export const v = 1;\n');
  await pm.add(PK, ['esm-lib', 'umd-lib']);
  fs.writeFileSync(path.join(PK, 'behaviours/UsesPkgs.ts'), "import { Behaviour } from '../gpsb/engine.js';\nimport { sum, twice, env } from 'esm-lib';\nimport { up } from 'esm-lib/utils/str.js';\nimport umd from 'umd-lib';\nexport default class UsesPkgs extends Behaviour {\n  start() { (window as any).pkgs = { sum: sum(2, 3), twice: twice(4), env, up: up('x'), triple: umd.triple(3) }; }\n}\n");
  const pg = JSON.parse(fs.readFileSync(path.join(PK, 'pages/index.json'), 'utf8'));
  pg.children.push({ id: 'pk', name: 'Pkgs', active: true, rect: pg.children[0].rect, components: [{ type: 'behaviour:UsesPkgs', props: {} }], children: [] });
  fs.writeFileSync(path.join(PK, 'pages/index.json'), JSON.stringify(pg));
  const pb = spawnSync(process.execPath, ['cli.js', 'build', PK], { cwd: ROOT, encoding: 'utf8' });
  check('packages: project with npm packages builds', pb.status === 0, (pb.stderr || pb.stdout).trim());
  cleanups.push(await serveDir(path.join(PK, 'dist'), PK_PORT));
  const want = JSON.stringify({ sum: 5, twice: 8, env: 'browser', up: 'X', triple: 9 });
  await page.open(`http://127.0.0.1:${PK_PORT}/index.html`);
  const built = await page.until(`window.pkgs && JSON.stringify(window.pkgs)`, 5000);
  check('packages: built site imports ESM, bundled CommonJS and UMD packages by name (import map)', built === want, built);
  check('packages: built site zero console errors', page.errors.length === 0, page.errors.join(' | '));
  const ped = spawn(process.execPath, ['cli.js', 'serve', PK, '--port', String(PK_EDITOR_PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GPSB_CONFIG_DIR: cfg } });
  cleanups.push(() => ped.kill());
  await new Promise((ok, err) => { ped.stdout.on('data', d => /editor:/.test(d) && ok()); ped.on('exit', c => err(new Error(`editor server exited ${c}`))); });
  await page.open(`http://127.0.0.1:${PK_EDITOR_PORT}/editor/`);
  await page.until(`document.querySelector('[data-panel=hierarchy]')?.innerText.includes('Pkgs')`, 5000);
  await sleep(800);
  const pmeta = await page.eval(`import('/editor/state.js').then(S => S.S.behaviourMeta.UsesPkgs)`);
  check('packages: the editor reads a behaviour that imports packages (its own import map)', pmeta && !pmeta.error && pmeta.methods.includes('start'), JSON.stringify(pmeta));
  await page.eval(`import('/editor/state.js').then(S => S.setPlaying(true))`);
  const played2 = await page.until(`[...document.querySelectorAll('iframe[title=Preview]')].map(f => f.contentWindow?.pkgs && JSON.stringify(f.contentWindow.pkgs)).find(Boolean)`, 6000);
  check('packages: Play mode runs them', played2 === want, played2);
  await page.eval(`import('/editor/state.js').then(S => S.setPlaying(false))`);
  const win = await page.eval(`(async () => {
    (await import('/editor/packages.js')).openPackageManager();
    const wait = async f => { for (let i = 0; i < 40 && !f(); i++) await new Promise(r => setTimeout(r, 100)); return f(); };
    const rows = () => [...document.querySelectorAll('.pm-row .pm-name')].map(e => e.textContent);
    const project = await wait(() => rows().includes('esm-lib') && rows());
    document.querySelector('[data-tab=registry]').click();
    const q = document.querySelector('.pm-q'); q.value = 'lib'; q.dispatchEvent(new Event('input'));
    const found = await wait(() => rows().includes('old-lib') && rows());
    document.querySelector('.prefs-x').click();
    return { project, found };
  })()`);
  check('packages: Package Manager lists the project\'s packages and searches the registry', win.project?.includes('umd-lib') && win.project?.includes('dep-cjs') && win.found?.includes('old-lib'), JSON.stringify(win));
  const added = await page.eval(`fetch('/api/packages/add', { method: 'POST', headers: { 'x-gpsb': '1', 'x-gpsb-project': ${JSON.stringify(encodeURIComponent(PK))}, 'content-type': 'application/json' }, body: JSON.stringify({ specs: ['@scope/thing'] }) }).then(r => r.json())`);
  check('packages: /api/packages/add installs and answers with the list', added.installed?.includes('@scope/thing@0.1.0') && added.list?.packages.some(p => p.name === '@scope/thing'), JSON.stringify(added).slice(0, 200));
  check('packages: editor zero console errors', page.errors.length === 0, page.errors.join(' | '));
  const pub = await fetch(`http://127.0.0.1:${PK_EDITOR_PORT}/project/vendor/v.js`).then(r => r.status === 200 && r.text());
  check('dev server: public/ is served at the site root, as on the built site', pub === 'export const v = 1;\n', String(pub));
  await formsSection(page);
}

// ---- forms: validation, sending, events (a local endpoint records submissions) ----
async function formsSection(page) {
  const FM = path.join(ROOT, '.tmp/e2e-forms'), FM_PORT = 4214, API_PORT = 4215, got = [];
  const api = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-headers': '*' }); return res.end(); }
    let body = '';
    req.on('data', d => (body += d)).on('end', () => {
      got.push(body);
      const bad = body.includes('fail@');
      res.writeHead(bad ? 422 : 200, cors);
      res.end(JSON.stringify(bad ? { errors: [{ message: 'Bad email' }] } : { ok: true }));
    });
  });
  await new Promise(r => api.listen(API_PORT, '127.0.0.1', r));
  cleanups.push(() => api.close());
  fs.rmSync(FM, { recursive: true, force: true });
  for (const d of ['pages', 'behaviours']) fs.mkdirSync(path.join(FM, d), { recursive: true });
  const rect = (x, y, w = 200, h = 32) => ({ anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0, 0], pos: [x, y], size: [w, h], rotation: 0, scale: [1, 1] });
  const n = (id, name, components, r, children = [], extra = {}) => ({ id, name, active: true, rect: r, components, children, ...extra });
  const root = n('root', 'Canvas', [{ type: 'Canvas', props: {} }, { type: 'CanvasScaler', props: {} }], rect(0, 0), [
    n('contact', 'Contact', [{ type: 'Form', props: { action: `http://127.0.0.1:${API_PORT}/submit`, message: 'msg', onSuccess: [{ target: 'thanks', call: 'setActive', arg: 'true' }] } }, { type: 'behaviour:FormWatch', props: {} }], rect(20, 20, 400, 200), [
      n('email', 'Email', [{ type: 'InputField', props: { name: 'email', contentType: 'email', required: true, errorMessage: 'Enter your email' } }], rect(0, 0)),
      n('agree', 'Agree', [{ type: 'Toggle', props: { name: 'agree', required: true, isOn: false } }], rect(0, 40, 20, 20)),
      n('send', 'Send', [{ type: 'Button', props: { type: 'submit' } }], rect(0, 80, 100, 30)),
    ]),
    n('msg', 'Msg', [{ type: 'Text', props: { text: '' } }], rect(20, 240, 400, 30)),
    n('thanks', 'Thanks', [{ type: 'Text', props: { text: 'Thanks panel' } }], rect(20, 280, 400, 30), [], { active: false }),
    n('mine', 'Mine', [{ type: 'Form', props: {} }], rect(20, 320, 400, 60), [n('q', 'Q', [{ type: 'InputField', props: { name: 'q', text: 'hi' } }], rect(0, 0))]),
  ]);
  fs.writeFileSync(path.join(FM, 'pages/index.json'), JSON.stringify(root));
  fs.writeFileSync(path.join(FM, 'project.json'), JSON.stringify({ name: 'forms', inject: { bodyEnd: `<script type="module">
    window.events = [];
    for (const t of ['submit', 'success', 'error', 'invalid']) document.addEventListener('gpsb:' + t, e => events.push([e.target.dataset.gpsb, t, t === 'invalid' ? e.detail.fields.map(f => f.name + ':' + f.message).join() : t === 'error' ? e.detail.error + ' ' + e.detail.status : t === 'submit' ? JSON.stringify(e.detail.data) : e.detail.status]));
    document.querySelector('[data-gpsb=mine]').addEventListener('gpsb:submit', e => e.detail.handle(async data => { window.handled = data; return { mine: true }; }));
  </script>` } }));
  fs.writeFileSync(path.join(FM, 'behaviours/FormWatch.js'), "import { Behaviour } from '../gpsb/engine.js';\nexport default class FormWatch extends Behaviour {\n  start() { this.getComponent('Form').onSuccess.addListener((d, e) => { window.viaEngine = [d.status, e.type]; }); }\n}\n");
  const b = spawnSync(process.execPath, ['cli.js', 'build', FM], { cwd: ROOT, encoding: 'utf8' });
  check('forms: project builds', b.status === 0, (b.stderr || b.stdout).trim());
  cleanups.push(await serveDir(path.join(FM, 'dist'), FM_PORT));
  await page.open(`http://127.0.0.1:${FM_PORT}/index.html`);
  await page.until(`window.GPSB?.behaviour?.('contact', 'FormWatch')`, 5000);
  const ev = () => page.eval(`JSON.stringify(window.events.splice(0))`);
  const submit = id => page.eval(`GPSB.el('${id}').querySelector('button[type=submit]').click()`);
  const text = id => page.eval(`GPSB.el('${id}').textContent`);
  await submit('contact'); await sleep(200);
  const inv = { ev: await ev(), msg: await text('msg'), state: await page.eval(`GPSB.el('contact').dataset.state`), cls: await page.eval(`GPSB.el('email').classList.contains('gpsb-invalid')`) };
  check('forms: invalid fields -> gpsb:invalid with custom messages, message Text, gpsb-invalid class, nothing sent',
    inv.ev === JSON.stringify([['contact', 'invalid', 'email:Enter your email,agree:' + (await page.eval(`GPSB.el('agree').querySelector('input').validationMessage`))]]) && inv.msg === 'Please check the highlighted fields.' && inv.state === 'invalid' && inv.cls && got.length === 0, JSON.stringify(inv));
  await page.eval(`(() => { const e = GPSB.el('email').querySelector('input'); e.value = 'me@example.com'; e.dispatchEvent(new Event('input', { bubbles: true })); GPSB.el('agree').querySelector('input').click(); })()`);
  check('forms: fixing a field clears its invalid mark', !(await page.eval(`GPSB.el('email').classList.contains('gpsb-invalid')`)));
  await submit('contact');
  await page.until(`GPSB.el('contact').dataset.state === 'success'`, 4000);
  const ok = { ev: await ev(), msg: await text('msg'), sent: got.at(-1) ?? '', thanks: await page.eval(`getComputedStyle(GPSB.el('thanks')).display`), engine: await page.eval(`JSON.stringify(window.viaEngine)`),
    reset: await page.eval(`[GPSB.el('email').querySelector('input').value, GPSB.nodeFor(GPSB.el('email')).components[0].props.text, GPSB.nodeFor(GPSB.el('agree')).components[0].props.isOn]`) };
  check('forms: valid -> gpsb:submit (data) -> sent -> gpsb:success, message, fields reset (node data too)',
    ok.ev === JSON.stringify([['contact', 'submit', '{"email":"me@example.com","agree":"on"}'], ['contact', 'success', 200]]) && ok.msg === 'Thank you! Your message was sent.' && /me@example\.com/.test(ok.sent) && !/_hp/.test(ok.sent) && JSON.stringify(ok.reset) === '["","",false]', JSON.stringify(ok));
  check('forms: On Success event list ran (setActive) and an engine listener heard it', ok.thanks !== 'none' && ok.engine === '[200,"gpsb:success"]', JSON.stringify(ok));
  await page.eval(`(() => { const e = GPSB.el('email').querySelector('input'); e.value = 'fail@example.com'; GPSB.el('agree').querySelector('input').click(); })()`);
  await page.eval(`GPSB.invoke('contact', 'Form.submit')`);
  await page.until(`GPSB.el('contact').dataset.state === 'error'`, 4000);
  const err = { ev: await ev(), msg: await text('msg') };
  check('forms: Form.submit from an event; a failed send -> gpsb:error with the service message and status', err.ev.includes('["contact","error","Bad email 422"]') && err.msg.startsWith('Sorry'), JSON.stringify(err));
  const n0 = got.length;
  await page.eval(`(() => { GPSB.el('contact').querySelector('.gpsb-hp').value = 'spam'; GPSB.el('email').querySelector('input').value = 'bot@example.com'; })()`);
  await submit('contact'); await sleep(300);
  check('forms: honeypot filled -> looks sent, nothing sent', got.length === n0 && (await page.eval(`GPSB.el('contact').dataset.state`)) === 'success');
  await page.eval(`GPSB.invoke('mine', 'Form.submit')`); await sleep(200);
  const mine = { handled: await page.eval(`JSON.stringify(window.handled)`), ev: await ev(), state: await page.eval(`GPSB.el('mine').dataset.state`) };
  check('forms: gpsb:submit detail.handle(fn) sends with your code, then success', mine.handled === '{"q":"hi"}' && mine.ev.includes('["mine","success",0]') && mine.state === 'success' && got.length === n0, JSON.stringify(mine));
  const errs = page.errors.filter(e => !/status of 422/.test(e)); // the deliberate failed send
  check('forms: zero console errors', errs.length === 0, errs.join(' | '));
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
