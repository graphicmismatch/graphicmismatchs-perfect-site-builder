#!/usr/bin/env node
// graphicmismatch's perfect site builder
//   psb [hub] [--port N]       open the Project Hub at http://127.0.0.1:4000
//   psb serve [dir] [--port N] same, with <dir> registered and opened in the editor
//   psb new   <dir>            create an empty project
//   psb build [dir] [--out D]  write the static site (default <dir>/dist)
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { renderDocument, makeCtx } from './lib/render.js';
import { parseComponent, compileComponent } from './lib/compile.js';
import { newNode } from './lib/node.js';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const PORT = +flag('--port', 4000), OUT = flag('--out');
const [cmd = 'hub', dir = '.'] = args;
const ROOT = path.resolve(dir);

export const ASSET_TYPES = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico'],
  video: ['mp4', 'webm', 'ogv', 'mov'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'],
  json: ['json'], font: ['woff', 'woff2', 'ttf', 'otf'], text: ['txt', 'md', 'csv'],
};
const MIME = {
  html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  avif: 'image/avif', ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
};
const ext = f => path.extname(f).slice(1).toLowerCase();
const assetType = f => Object.keys(ASSET_TYPES).find(t => ASSET_TYPES[t].includes(ext(f))) ?? 'other';

async function files(dir, base = dir) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
const readJSON = async (f, d) => JSON.parse(await fsp.readFile(f, 'utf8').catch(() => JSON.stringify(d)));

export async function loadProject(root) {
  const p = n => path.join(root, n);
  const project = await readJSON(p('project.json'), { name: path.basename(root) });
  const pages = {}, components = {}, behaviours = {}, clips = {}, json = {}, assets = [];
  for (const f of await files(p('pages'))) if (f.endsWith('.json')) pages[f.slice(0, -5)] = await readJSON(p('pages/' + f));
  for (const f of await files(p('components'))) if (f.endsWith('.html')) {
    const name = f.slice(0, -5);
    try { components[name] = parseComponent(name, await fsp.readFile(p('components/' + f), 'utf8')); }
    catch (e) { components[name] = { name, tag: 'psb-error', props: {}, error: String(e) }; }
  }
  for (const f of await files(p('behaviours'))) if (f.endsWith('.js')) behaviours[f.slice(0, -3)] = { path: 'behaviours/' + f };
  for (const f of await files(p('animations'))) if (f.endsWith('.anim.json')) clips[f.slice(0, -10)] = await readJSON(p('animations/' + f));
  for (const f of await files(p('assets'))) {
    const st = await fsp.stat(p('assets/' + f));
    assets.push({ path: f, type: assetType(f), size: st.size });
    if (ext(f) === 'json') json[f] = await readJSON(p('assets/' + f), null);
  }
  return { project, pages, components, behaviours, clips, json, assets };
}

const ctxFor = (P, extra) => makeCtx({ pages: Object.keys(P.pages), customs: P.components, json: P.json, clips: P.clips, breakpoints: P.project.breakpoints, ...extra });

export async function build(root, out = path.join(root, 'dist')) {
  const P = await loadProject(root);
  await fsp.rm(out, { recursive: true, force: true });
  await fsp.mkdir(path.join(out, 'psb'), { recursive: true });
  for (const f of await fsp.readdir(path.join(TOOL, 'lib'))) if (f !== 'compile.js') await fsp.copyFile(path.join(TOOL, 'lib', f), path.join(out, 'psb', f));
  for (const d of ['assets', 'behaviours']) if (fs.existsSync(path.join(root, d))) await fsp.cp(path.join(root, d), path.join(out, d), { recursive: true });
  await fsp.mkdir(path.join(out, 'components'), { recursive: true });
  for (const name of Object.keys(P.components)) {
    const src = await fsp.readFile(path.join(root, 'components', name + '.html'), 'utf8');
    for (const [f, code] of Object.entries(compileComponent(name, src))) await fsp.writeFile(path.join(out, 'components', f), code);
  }
  const ctx = ctxFor(P);
  for (const [name, tree] of Object.entries(P.pages)) {
    const { html, css } = renderDocument(tree, ctx, { name });
    await fsp.writeFile(path.join(out, name + '.html'), html);
    await fsp.writeFile(path.join(out, name + '.css'), css);
  }
  return { out, pages: Object.keys(P.pages) };
}

export async function create(root) {
  if (fs.existsSync(path.join(root, 'project.json'))) throw new Error(`${root} already has a project.json`);
  for (const d of ['pages', 'assets', 'components', 'behaviours', 'animations']) await fsp.mkdir(path.join(root, d), { recursive: true });
  await fsp.writeFile(path.join(root, 'project.json'), JSON.stringify({ name: path.basename(root) }, null, 2));
  const canvas = newNode('Canvas', [{ type: 'Canvas', props: { title: path.basename(root) } }, { type: 'CanvasScaler', props: {} }]);
  await fsp.writeFile(path.join(root, 'pages/index.json'), JSON.stringify(canvas, null, 2));
}

// ---------- user config: project registry + editor preferences (shared by every project and port) ----------
const CONFIG = process.env.PSB_CONFIG_DIR ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'perfect-site-builder');
const cfgFile = n => path.join(CONFIG, n);
const readCfg = (n, d) => readJSON(cfgFile(n), d);
const writeCfg = async (n, v) => { await fsp.mkdir(CONFIG, { recursive: true }); await fsp.writeFile(cfgFile(n), JSON.stringify(v, null, 2)); };
const isProject = d => fs.existsSync(path.join(d, 'project.json'));

async function register(dir, touch = false) {
  const list = (await readCfg('projects.json', [])).filter(x => x.path !== dir);
  const prev = (await readCfg('projects.json', [])).find(x => x.path === dir);
  list.unshift({ path: dir, added: prev?.added ?? Date.now(), lastOpened: touch ? Date.now() : prev?.lastOpened ?? null });
  await writeCfg('projects.json', list);
}
async function projectList() {
  const out = [];
  for (const x of await readCfg('projects.json', [])) {
    const exists = isProject(x.path);
    const info = { ...x, exists, name: path.basename(x.path), open: x.path === root };
    if (exists) {
      const pj = await readJSON(path.join(x.path, 'project.json'), {});
      const pages = (await files(path.join(x.path, 'pages'))).filter(f => f.endsWith('.json'));
      const st = await fsp.stat(path.join(x.path, 'project.json'));
      Object.assign(info, { name: pj.name || info.name, pages: pages.length, assets: (await files(path.join(x.path, 'assets'))).filter(f => !path.basename(f).startsWith('.')).length, modified: st.mtimeMs });
    }
    out.push(info);
  }
  return out.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
}

// ---------- dev server (hub + editor) ----------
let root = null, watcher = null; // project currently open in the editor
const notOpen = () => Object.assign(new Error('no project open'), { code: 409 });
function safe(rel) {
  if (!root) throw notOpen();
  const p = path.resolve(root, String(rel ?? ''));
  if (p !== root && !p.startsWith(root + path.sep)) throw Object.assign(new Error('path outside project'), { code: 403 });
  return p;
}
const send = (res, code, body, type = 'text/plain') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const sendJSON = (res, v) => send(res, 200, JSON.stringify(v), MIME.json);
const readBody = req => new Promise((ok, err) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', err); });
const bodyJSON = async req => JSON.parse(String(await readBody(req)) || '{}');
const absDir = p => { if (!p || !path.isAbsolute(String(p))) throw Object.assign(new Error('absolute path required'), { code: 400 }); return path.resolve(String(p)); };

async function sendFile(res, file) {
  const st = await fsp.stat(file).catch(() => null);
  if (!st?.isFile()) return send(res, 404, 'not found');
  res.writeHead(200, { 'content-type': MIME[ext(file)] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

async function openProject(dir) {
  if (!isProject(dir)) throw Object.assign(new Error(`no project.json in ${dir}`), { code: 400 });
  root = dir;
  await register(dir, true);
  watcher?.close();
  let t;
  watcher = fs.watch(root, { recursive: true }, (_, f) => {
    if (!f || f.startsWith('dist') || f.startsWith('.')) return;
    clearTimeout(t);
    t = setTimeout(() => { for (const c of clients) c.write(`data: ${JSON.stringify({ file: f.split(path.sep).join('/') })}\n\n`); }, 100);
  });
}

async function hubApi(req, res, p, q) {
  if (p === '/api/hub/projects') return sendJSON(res, { projects: await projectList(), open: root, home: os.homedir() });
  if (p === '/api/hub/ls') { // directory browser for New / Add
    const dir = absDir(q.get('path') || os.homedir());
    const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    const dirs = ents.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => ({ name: e.name, project: isProject(path.join(dir, e.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return sendJSON(res, { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), project: isProject(dir), dirs, sep: path.sep });
  }
  if (req.method !== 'POST') return send(res, 405, 'POST only');
  const b = await bodyJSON(req);
  if (p === '/api/hub/open') { await openProject(absDir(b.path)); return sendJSON(res, { ok: true, open: root }); }
  if (p === '/api/hub/add') {
    const d = absDir(b.path);
    if (!isProject(d)) throw Object.assign(new Error(`no project.json in ${d}`), { code: 400 });
    await register(d); return sendJSON(res, { ok: true });
  }
  if (p === '/api/hub/remove') { // forget only; files stay on disk
    const d = absDir(b.path);
    await writeCfg('projects.json', (await readCfg('projects.json', [])).filter(x => x.path !== d));
    if (root === d) { root = null; watcher?.close(); }
    return sendJSON(res, { ok: true });
  }
  if (p === '/api/hub/create') {
    const name = String(b.name ?? '').trim();
    if (!/^[\w.-][\w .-]*$/.test(name)) throw Object.assign(new Error('invalid project name'), { code: 400 });
    const d = path.join(absDir(b.dir), name);
    if (fs.existsSync(d) && (await fsp.readdir(d)).length) throw Object.assign(new Error(`${d} exists and is not empty`), { code: 409 });
    if (b.template === 'showcase') {
      await fsp.cp(path.join(TOOL, 'example'), d, { recursive: true, filter: f => !f.includes(`${path.sep}dist`) });
      const pj = path.join(d, 'project.json');
      await fsp.writeFile(pj, JSON.stringify({ ...await readJSON(pj, {}), name }, null, 2));
    } else await create(d);
    await register(d);
    return sendJSON(res, { ok: true, path: d });
  }
  send(res, 404, 'not found');
}
const clients = new Set();
function serve(initial) {
  const server = http.createServer(async (req, res) => {
    try {
      // only our own pages may talk to us: block DNS rebinding (Host) and cross-site writes (custom header)
      if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host)) return send(res, 403, 'bad host');
      if (req.method !== 'GET' && req.headers['x-psb'] !== '1') return send(res, 403, 'missing x-psb header');
      // writes from an editor tab must target the project it loaded (another may have been opened since)
      if (req.method !== 'GET' && p0(req).startsWith('/api/') && !p0(req).startsWith('/api/hub/') && p0(req) !== '/api/prefs' && req.headers['x-psb-project'] !== encodeURIComponent(root ?? ''))
        return send(res, 409, 'a different project is open now; reload the editor');
      const u = new URL(req.url, 'http://x');
      const p = decodeURIComponent(u.pathname);
      const q = u.searchParams;
      if (p === '/' || p === '/hub') return sendFile(res, path.join(TOOL, 'editor/hub.html'));
      if (p === '/editor' || p === '/editor/') {
        if (!root) { res.writeHead(302, { location: '/' }); return res.end(); }
        return sendFile(res, path.join(TOOL, 'editor/index.html'));
      }
      if (p.startsWith('/editor/') || p.startsWith('/lib/')) {
        const f = path.resolve(TOOL, '.' + p);
        if (!f.startsWith(TOOL + path.sep)) return send(res, 403, 'forbidden');
        return sendFile(res, f);
      }
      if (p.startsWith('/api/hub/')) return await hubApi(req, res, p, q);
      if (p === '/api/prefs') {
        if (req.method === 'PUT') { await writeCfg('prefs.json', await bodyJSON(req)); return sendJSON(res, { ok: true }); }
        return sendJSON(res, await readCfg('prefs.json', {}));
      }
      if (p.startsWith('/project/psb/')) return sendFile(res, path.join(TOOL, 'lib', path.basename(p)));
      const comp = p.match(/^\/project\/components\/(.+?)(\.script)?\.js$/);
      if (comp) {
        const src = await fsp.readFile(safe(`components/${comp[1]}.html`), 'utf8').catch(e => { if (e.code === 409) throw e; return null; });
        if (src == null) return send(res, 404, 'no component');
        const out = compileComponent(comp[1], src);
        return send(res, 200, out[comp[1] + (comp[2] ?? '') + '.js'] ?? '', MIME.js);
      }
      if (p.startsWith('/project/')) return sendFile(res, safe(p.slice(9)));
      if (p === '/api/project') { if (!root) throw notOpen(); return sendJSON(res, { root, ...await loadProject(root) }); }
      if (p === '/api/file') {
        const f = safe(q.get('path'));
        if (req.method === 'PUT') {
          await fsp.mkdir(path.dirname(f), { recursive: true });
          await new Promise((ok, err) => req.pipe(fs.createWriteStream(f)).on('finish', ok).on('error', err));
          return sendJSON(res, { ok: true });
        }
        if (req.method === 'DELETE') { await fsp.rm(f, { recursive: true, force: true }); return sendJSON(res, { ok: true }); }
        return sendFile(res, f);
      }
      if (p === '/api/rename' && req.method === 'POST') {
        const to = safe(q.get('to'));
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.rename(safe(q.get('from')), to);
        return sendJSON(res, { ok: true });
      }
      if (p === '/api/build' && req.method === 'POST') { if (!root) throw notOpen(); return sendJSON(res, await build(root, OUT && path.resolve(OUT))); }
      if (p === '/api/events') { // file-change notifications (external edits -> editor reload)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        res.write(': hi\n\n');
        clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      send(res, 404, 'not found');
    } catch (e) {
      send(res, [400, 403, 409].includes(e.code) ? e.code : 500, String(e.message ?? e));
    }
  });
  const p0 = req => decodeURIComponent(new URL(req.url, 'http://x').pathname);
  server.listen(PORT, '127.0.0.1', async () => {
    if (initial) await openProject(initial);
    console.log(`graphicmismatch's perfect site builder\n  hub:     http://127.0.0.1:${PORT}/${initial ? `\n  project: ${initial}\n  editor:  http://127.0.0.1:${PORT}/editor/` : ''}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (cmd === 'new') create(ROOT).then(() => console.log(`created ${ROOT}\nnext: psb serve ${dir}`), e => { console.error(e.message); process.exit(1); });
  else if (cmd === 'build') build(ROOT, OUT && path.resolve(OUT)).then(r => console.log(`built ${r.pages.length} page(s) -> ${r.out}`), e => { console.error(e); process.exit(1); });
  else if (cmd === 'serve' || cmd === 'hub') {
    if (cmd === 'serve' && !isProject(ROOT)) { console.error(`no project.json in ${ROOT} (run: psb new ${dir})`); process.exit(1); }
    serve(cmd === 'serve' ? ROOT : null);
  } else { console.log('usage: psb [hub] | psb serve [dir] [--port N] | psb new <dir> | psb build [dir] [--out D]'); process.exit(1); }
}
