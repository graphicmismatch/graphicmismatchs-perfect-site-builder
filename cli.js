#!/usr/bin/env node
// graphicmismatch's perfect site builder
//   psb new   <dir>            create an empty project
//   psb serve [dir] [--port N] open the editor at http://127.0.0.1:4000
//   psb build [dir] [--out D]  write the static site (default <dir>/dist)
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDocument, makeCtx } from './lib/render.js';
import { parseComponent, compileComponent } from './lib/compile.js';
import { newNode } from './lib/node.js';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const PORT = +flag('--port', 4000), OUT = flag('--out');
const [cmd = 'serve', dir = '.'] = args;
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

const ctxFor = (P, extra) => makeCtx({ pages: Object.keys(P.pages), customs: P.components, json: P.json, clips: P.clips, ...extra });

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

// ---------- dev server (editor) ----------
function safe(rel) {
  const p = path.resolve(ROOT, String(rel ?? ''));
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) throw Object.assign(new Error('path outside project'), { code: 403 });
  return p;
}
const send = (res, code, body, type = 'text/plain') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const sendJSON = (res, v) => send(res, 200, JSON.stringify(v), MIME.json);
const readBody = req => new Promise((ok, err) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', err); });

async function sendFile(res, file) {
  const st = await fsp.stat(file).catch(() => null);
  if (!st?.isFile()) return send(res, 404, 'not found');
  res.writeHead(200, { 'content-type': MIME[ext(file)] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const clients = new Set();
function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      // only our own editor may talk to us: block DNS rebinding (Host) and cross-site writes (custom header)
      if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host)) return send(res, 403, 'bad host');
      if (req.method !== 'GET' && req.headers['x-psb'] !== '1') return send(res, 403, 'missing x-psb header');
      const u = new URL(req.url, 'http://x');
      const p = decodeURIComponent(u.pathname);
      const q = u.searchParams;
      if (p === '/') return sendFile(res, path.join(TOOL, 'editor/index.html'));
      if (p.startsWith('/editor/') || p.startsWith('/lib/')) {
        const f = path.resolve(TOOL, '.' + p);
        if (!f.startsWith(TOOL + path.sep)) return send(res, 403, 'forbidden');
        return sendFile(res, f);
      }
      if (p.startsWith('/project/psb/')) return sendFile(res, path.join(TOOL, 'lib', path.basename(p)));
      const comp = p.match(/^\/project\/components\/(.+?)(\.script)?\.js$/);
      if (comp) {
        const src = await fsp.readFile(safe(`components/${comp[1]}.html`), 'utf8').catch(() => null);
        if (src == null) return send(res, 404, 'no component');
        const out = compileComponent(comp[1], src);
        return send(res, 200, out[comp[1] + (comp[2] ?? '') + '.js'] ?? '', MIME.js);
      }
      if (p.startsWith('/project/')) return sendFile(res, safe(p.slice(9)));
      if (p === '/api/project') return sendJSON(res, await loadProject(ROOT));
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
      if (p === '/api/build' && req.method === 'POST') return sendJSON(res, await build(ROOT, OUT && path.resolve(OUT)));
      if (p === '/api/events') { // file-change notifications (external edits -> editor reload)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        res.write(': hi\n\n');
        clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      send(res, 404, 'not found');
    } catch (e) {
      send(res, e.code === 403 ? 403 : 500, String(e.message ?? e));
    }
  });
  let t;
  fs.watch(ROOT, { recursive: true }, (_, f) => {
    if (!f || f.startsWith('dist') || f.startsWith('.')) return;
    clearTimeout(t);
    t = setTimeout(() => { for (const c of clients) c.write(`data: ${JSON.stringify({ file: f.split(path.sep).join('/') })}\n\n`); }, 100);
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`graphicmismatch's perfect site builder\n  project: ${ROOT}\n  editor:  http://127.0.0.1:${PORT}/`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (cmd === 'new') create(ROOT).then(() => console.log(`created ${ROOT}\nnext: psb serve ${dir}`), e => { console.error(e.message); process.exit(1); });
  else if (cmd === 'build') build(ROOT, OUT && path.resolve(OUT)).then(r => console.log(`built ${r.pages.length} page(s) -> ${r.out}`), e => { console.error(e); process.exit(1); });
  else if (cmd === 'serve') {
    if (!fs.existsSync(path.join(ROOT, 'project.json'))) { console.error(`no project.json in ${ROOT} (run: psb new ${dir})`); process.exit(1); }
    serve();
  } else { console.log('usage: psb new <dir> | psb serve [dir] [--port N] | psb build [dir] [--out D]'); process.exit(1); }
}
