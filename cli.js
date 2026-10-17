#!/usr/bin/env node
// graphicmismatch's perfect site builder
//   gpsb [hub] [--port N]       open the Project Hub at http://127.0.0.1:4000
//   gpsb serve [dir] [--port N] same, with <dir> registered and opened in the editor
//   gpsb new   <dir>            create an empty project
//   gpsb build [dir] [--out D]  write the static site (default <dir>/dist)
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { renderDocument, makeCtx } from './lib/render.js';
import { registerComponent, unregisterComponent, extensionNames } from './lib/components.js';
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
// like readJSON, but a parse error is recorded in `errors` ({ file, error }) and yields `bad` instead of throwing
const tryJSON = async (root, rel, d, bad, errors) => {
  try { return await readJSON(path.join(root, rel), d); } catch (e) { errors.push({ file: rel, error: e.message }); return bad; }
};

export async function loadProject(root) {
  const p = n => path.join(root, n);
  const errors = [], dflt = { name: path.basename(root) };
  const project = await tryJSON(root, 'project.json', dflt, dflt, errors);
  const pages = {}, components = {}, behaviours = {}, clips = {}, json = {}, assets = [];
  for (const f of await files(p('pages'))) if (f.endsWith('.json')) {
    const t = await tryJSON(root, 'pages/' + f, null, null, errors);
    if (t) pages[f.slice(0, -5)] = t;
  }
  for (const f of await files(p('components'))) if (f.endsWith('.html')) {
    const name = f.slice(0, -5);
    try { components[name] = parseComponent(name, await fsp.readFile(p('components/' + f), 'utf8')); }
    catch (e) { components[name] = { name, tag: 'gpsb-error', props: {}, error: String(e) }; }
  }
  for (const f of await files(p('behaviours'))) if (f.endsWith('.js')) behaviours[f.slice(0, -3)] = { path: 'behaviours/' + f };
  // extension components: top-level extensions/<Name>.js (subfolders may hold their helper modules)
  const extensions = {};
  for (const f of await files(p('extensions'))) if (/^[A-Za-z_]\w*\.js$/.test(f)) {
    const st = await fsp.stat(p('extensions/' + f));
    extensions[f.slice(0, -3)] = { path: 'extensions/' + f, size: st.size, mtime: st.mtimeMs };
  }
  for (const f of await files(p('animations'))) if (f.endsWith('.anim.json')) {
    const c = await tryJSON(root, 'animations/' + f, null, null, errors);
    if (c) clips[f.slice(0, -10)] = c;
  }
  for (const f of await files(p('assets'))) {
    const st = await fsp.stat(p('assets/' + f));
    assets.push({ path: f, type: assetType(f), size: st.size, mtime: st.mtimeMs });
    if (ext(f) === 'json') json[f] = await tryJSON(root, 'assets/' + f, null, null, errors);
  }
  for (const c of Object.values(components)) if (c.error) errors.push({ file: `components/${c.name}.html`, error: c.error });
  return { project, pages, components, behaviours, clips, json, assets, extensions, errors };
}

// dev server: a version per asset from size + mtime (changes whenever the file does)
const statVersions = P => Object.fromEntries(P.assets.map(a => [a.path, a.size.toString(36) + Math.floor(a.mtime).toString(36)]));
// build: content hashes, so a published asset URL only changes when its bytes do
async function hashVersions(root, P) {
  const out = {};
  for (const a of P.assets) out[a.path] = await hashFile(path.join(root, 'assets', a.path));
  return out;
}
// Register the project's extension components (replacing the previous project's) so rendering knows them.
// versions: { Name: v } (import cache key; the same value goes into page URLs). Load errors land in P.errors.
async function loadExtensions(root, P, versions) {
  for (const n of extensionNames()) unregisterComponent(n);
  for (const [name, e] of Object.entries(P.extensions)) {
    try { registerComponent(name, (await import(`${pathToFileURL(path.join(root, e.path)).href}?v=${versions[name]}`)).default); }
    catch (err) { P.errors.push({ file: e.path, error: err.message }); }
  }
}
const statExtVersions = P => Object.fromEntries(Object.entries(P.extensions).map(([n, e]) => [n, e.size.toString(36) + Math.floor(e.mtime).toString(36)]));
async function hashFile(file) {
  const h = crypto.createHash('sha1');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex').slice(0, 10);
}

const ctxFor = (P, extra) => makeCtx({ pages: Object.keys(P.pages), customs: P.components, json: P.json, clips: P.clips, breakpoints: P.project.breakpoints, inject: P.project.inject, ...extra });

// The output folder is deleted before every build: refuse anything that is not a previous build or a fresh folder.
async function checkOut(root, out) {
  const inside = (a, b) => a === b || a.startsWith(b + path.sep);
  if (inside(root, out)) throw new Error(`refusing to build into ${out}: it contains the project`);
  for (const d of ['pages', 'assets', 'components', 'behaviours', 'animations'])
    if (inside(out, path.join(root, d))) throw new Error(`refusing to build into ${out}: it is inside the project's ${d}/ folder`);
  const ents = await fsp.readdir(out).catch(() => []);
  if (ents.length && !['gpsb', 'psb'].some(d => fs.existsSync(path.join(out, d, 'runtime.js')))) // psb/: built before the rename
    throw new Error(`refusing to build into ${out}: it is not empty and does not look like a previous build`);
}

export async function build(root, out = path.join(root, 'dist')) {
  root = path.resolve(root); out = path.resolve(out);
  await checkOut(root, out);
  const P = await loadProject(root);
  const extensionVersions = {};
  for (const [n, e] of Object.entries(P.extensions)) extensionVersions[n] = await hashFile(path.join(root, e.path));
  await loadExtensions(root, P, extensionVersions);
  const hooks = await buildHooks(root);
  // a broken page/clip/extension/project.json would silently drop content from the site: fail. Bad components/assets: warn.
  const fatal = P.errors.filter(e => !/^(components|assets)\//.test(e.file));
  if (fatal.length) throw new Error('cannot build:\n' + fatal.map(e => `  ${e.file}: ${e.error}`).join('\n'));
  const warnings = P.errors.map(e => `${e.file}: ${e.error}`);
  await fsp.rm(out, { recursive: true, force: true });
  await fsp.mkdir(path.join(out, 'gpsb'), { recursive: true });
  for (const f of await fsp.readdir(path.join(TOOL, 'lib'))) if (f !== 'compile.js') await fsp.copyFile(path.join(TOOL, 'lib', f), path.join(out, 'gpsb', f));
  for (const d of ['assets', 'behaviours', 'extensions']) if (fs.existsSync(path.join(root, d))) await fsp.cp(path.join(root, d), path.join(out, d), { recursive: true });
  await fsp.mkdir(path.join(out, 'components'), { recursive: true });
  for (const name of Object.keys(P.components)) {
    if (P.components[name].error) continue; // reported in warnings
    const src = await fsp.readFile(path.join(root, 'components', name + '.html'), 'utf8');
    for (const [f, code] of Object.entries(compileComponent(name, src))) await fsp.writeFile(path.join(out, 'components', f), code);
  }
  const ctx = ctxFor(P, { assetVersions: await hashVersions(root, P), extensionVersions });
  for (const [name, tree] of Object.entries(P.pages)) {
    let r = renderDocument(tree, ctx, { name });
    if (hooks.transformPage) r = { ...r, ...(await hooks.transformPage({ name, html: r.html, css: r.css, project: P.project }) ?? {}) };
    await fsp.writeFile(path.join(out, name + '.html'), r.html);
    await fsp.writeFile(path.join(out, name + '.css'), r.css);
  }
  await hooks.afterBuild?.({ out, root, project: P.project, pages: Object.keys(P.pages) });
  return { out, pages: Object.keys(P.pages), warnings };
}

// Optional build.js in the project root (Node only, never copied to the site):
//   export function transformPage({ name, html, css, project }) -> { html?, css? }
//   export async function afterBuild({ out, root, project, pages })
async function buildHooks(root) {
  const f = path.join(root, 'build.js');
  if (!fs.existsSync(f)) return {};
  return import(`${pathToFileURL(f).href}?v=${(await fsp.stat(f)).mtimeMs}`);
}

export async function create(root) {
  if (fs.existsSync(path.join(root, 'project.json'))) throw new Error(`${root} already has a project.json`);
  for (const d of ['pages', 'assets', 'components', 'behaviours', 'animations']) await fsp.mkdir(path.join(root, d), { recursive: true });
  await fsp.writeFile(path.join(root, 'project.json'), JSON.stringify({ name: path.basename(root) }, null, 2));
  const canvas = newNode('Canvas', [{ type: 'Canvas', props: { title: path.basename(root) } }, { type: 'CanvasScaler', props: {} }]);
  await fsp.writeFile(path.join(root, 'pages/index.json'), JSON.stringify(canvas, null, 2));
}

// ---------- user config: project registry + editor preferences (shared by every project and port) ----------
const CONFIG_HOME = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
const CONFIG = process.env.GPSB_CONFIG_DIR ?? path.join(CONFIG_HOME, 'gpsb');
// carry the project list + preferences over from the folder used before the gpsb rename
function migrateConfig() {
  const old = path.join(CONFIG_HOME, 'perfect-site-builder');
  if (process.env.GPSB_CONFIG_DIR || fs.existsSync(CONFIG) || !fs.existsSync(old)) return;
  try { fs.cpSync(old, CONFIG, { recursive: true }); } catch (e) { console.warn(`could not copy settings from ${old}: ${e.message}`); }
}
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
function safe(rel, write = false) {
  if (!root) throw notOpen();
  const p = path.resolve(root, String(rel ?? ''));
  if (p !== root && !p.startsWith(root + path.sep)) throw Object.assign(new Error('path outside project'), { code: 403 });
  if (write && p === root) throw Object.assign(new Error('refusing to modify the project folder itself'), { code: 403 }); // e.g. an empty path
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
  // no-cache (not no-store): the browser keeps the file and revalidates it, so a page can reuse an image it already
  // has (sprite swaps, re-applied styles) instead of re-downloading it and drawing nothing meanwhile; edits still show
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  // versioned URLs (?v=, see assetVersions) never change content: cache for good, no revalidation per use
  const cache = /[?&]v=/.test(res.req.url) ? 'public, max-age=31536000, immutable' : 'no-cache';
  const head = { 'content-type': MIME[ext(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': cache, etag, 'last-modified': st.mtime.toUTCString() };
  if (res.req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
  // single byte range (media seeking; Safari needs it to play video at all)
  const m = /^bytes=(\d*)-(\d*)$/.exec(res.req.headers.range ?? '');
  let start = 0, end = st.size - 1;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], end); } else start = Math.max(0, st.size - +m[2]);
    if (start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...head, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}` });
  } else res.writeHead(200, { ...head, 'content-length': st.size });
  if (!st.size) return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
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
    let dir = absDir(q.get('path') || os.homedir());
    if (!(await fsp.stat(dir).catch(() => null))?.isDirectory()) dir = os.homedir(); // e.g. a remembered folder was deleted
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
  migrateConfig();
  const server = http.createServer(async (req, res) => {
    try {
      // only our own pages may talk to us: block DNS rebinding (Host) and cross-site writes (custom header)
      if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host)) return send(res, 403, 'bad host');
      if (req.method !== 'GET' && req.headers['x-gpsb'] !== '1') return send(res, 403, 'missing x-gpsb header');
      // writes from an editor tab must target the project it loaded (another may have been opened since)
      if (req.method !== 'GET' && p0(req).startsWith('/api/') && !p0(req).startsWith('/api/hub/') && p0(req) !== '/api/prefs' && req.headers['x-gpsb-project'] !== encodeURIComponent(root ?? ''))
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
      if (p.startsWith('/project/gpsb/')) return sendFile(res, path.join(TOOL, 'lib', path.basename(p)));
      const comp = p.match(/^\/project\/components\/(.+?)(\.script)?\.js$/);
      if (comp) {
        const src = await fsp.readFile(safe(`components/${comp[1]}.html`), 'utf8').catch(e => { if (e.code === 409) throw e; return null; });
        if (src == null) return send(res, 404, 'no component');
        const out = compileComponent(comp[1], src);
        return send(res, 200, out[comp[1] + (comp[2] ?? '') + '.js'] ?? '', MIME.js);
      }
      const page = p.match(/^\/project\/([\w-]+)\.html$/)?.[1];
      if (page && fs.existsSync(safe(`pages/${page}.json`))) { // a page rendered on the fly (Links / IFrames in the editor preview)
        const P = await loadProject(root), extensionVersions = statExtVersions(P);
        await loadExtensions(root, P, extensionVersions);
        if (P.pages[page]) return send(res, 200, renderDocument(P.pages[page], ctxFor(P, { assetVersions: statVersions(P), extensionVersions }), { name: page, cssHref: null }).html, MIME.html);
      }
      if (p.startsWith('/project/')) return sendFile(res, safe(p.slice(9)));
      if (p === '/api/project') { if (!root) throw notOpen(); return sendJSON(res, { root, ...await loadProject(root) }); }
      if (p === '/api/file') {
        const f = safe(q.get('path'), req.method !== 'GET');
        if (req.method === 'PUT') {
          await fsp.mkdir(path.dirname(f), { recursive: true });
          await new Promise((ok, err) => req.pipe(fs.createWriteStream(f)).on('finish', ok).on('error', err));
          return sendJSON(res, { ok: true });
        }
        if (req.method === 'DELETE') { await fsp.rm(f, { recursive: true, force: true }); return sendJSON(res, { ok: true }); }
        return sendFile(res, f);
      }
      if (p === '/api/rename' && req.method === 'POST') {
        const to = safe(q.get('to'), true), from = safe(q.get('from'), true);
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.rename(from, to);
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
  if (cmd === 'new') create(ROOT).then(() => console.log(`created ${ROOT}\nnext: gpsb serve ${dir}`), e => { console.error(e.message); process.exit(1); });
  else if (cmd === 'build') build(ROOT, OUT && path.resolve(OUT)).then(r => { for (const w of r.warnings) console.warn('warning: ' + w); console.log(`built ${r.pages.length} page(s) -> ${r.out}`); }, e => { console.error(e.message); process.exit(1); });
  else if (cmd === 'serve' || cmd === 'hub') {
    if (cmd === 'serve' && !isProject(ROOT)) { console.error(`no project.json in ${ROOT} (run: gpsb new ${dir})`); process.exit(1); }
    serve(cmd === 'serve' ? ROOT : null);
  } else { console.log('usage: gpsb [hub] | gpsb serve [dir] [--port N] | gpsb new <dir> | gpsb build [dir] [--out D]'); process.exit(1); }
}
