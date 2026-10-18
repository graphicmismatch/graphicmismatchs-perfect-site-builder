#!/usr/bin/env node
// graphicmismatch's perfect site builder
//   gpsb [hub] [--port N]       open the Project Hub at http://127.0.0.1:4000
//   gpsb serve [dir] [--port N] same, with <dir> registered and opened in the editor
//   gpsb new   <dir>            create an empty project
//   gpsb build [dir] [--out D]  write the static site (default <dir>/dist)
//   gpsb types [dir]            write TypeScript typings + tsconfig.json for the project's scripts
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import * as nodeModule from 'node:module';
import { renderDocument, makeCtx, pageUrl, itemUrl, collectionItems } from './lib/render.js';
import { registerComponent, unregisterComponent, extensionNames, builtins } from './lib/components.js';
import { parseComponent, compileComponent, isTS, compileTS, withMap, quiet } from './lib/compile.js';
import { newNode, walk, getComponent } from './lib/node.js';
import { expandPrefabs } from './lib/prefab.js';

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
  const pages = {}, components = {}, behaviours = {}, clips = {}, json = {}, text = {}, assets = [];
  for (const f of await files(p('pages'))) if (f.endsWith('.json')) {
    const t = await tryJSON(root, 'pages/' + f, null, null, errors);
    if (t) pages[f.slice(0, -5)] = t;
  }
  for (const f of await files(p('components'))) if (f.endsWith('.html')) {
    const name = f.slice(0, -5);
    try { components[name] = parseComponent(name, await fsp.readFile(p('components/' + f), 'utf8')); }
    catch (e) { components[name] = { name, tag: 'gpsb-error', props: {}, error: String(e) }; }
  }
  // scripts: <Name>.js or <Name>.ts (module: the URL it's published and served as)
  const script = (dir, f, list, extra) => {
    const name = f.slice(0, -3);
    if (list[name]) return errors.push({ file: `${dir}/${f}`, error: `both ${name}.js and ${name}.ts exist: remove one` });
    list[name] = { path: `${dir}/${f}`, module: `${dir}/${name}.js`, lang: f.slice(-2), ...extra };
  };
  for (const f of await files(p('behaviours'))) if (f.endsWith('.js') || isTS(f)) script('behaviours', f, behaviours);
  const prefabs = {};
  for (const f of await files(p('prefabs'))) if (f.endsWith('.prefab.json')) {
    const t = await tryJSON(root, 'prefabs/' + f, null, null, errors);
    if (t) prefabs[f.slice(0, -12)] = t;
  }
  // extension components: top-level extensions/<Name>.js (subfolders may hold their helper modules)
  const extensions = {};
  for (const f of await files(p('extensions'))) if (/^[A-Za-z_]\w*\.[jt]s$/.test(f)) {
    const st = await fsp.stat(p('extensions/' + f));
    script('extensions', f, extensions, { size: st.size, mtime: st.mtimeMs });
  }
  for (const f of await files(p('animations'))) if (f.endsWith('.anim.json')) {
    const c = await tryJSON(root, 'animations/' + f, null, null, errors);
    if (c) clips[f.slice(0, -10)] = c;
  }
  for (const f of await files(p('assets'))) {
    const st = await fsp.stat(p('assets/' + f));
    assets.push({ path: f, type: assetType(f), size: st.size, mtime: st.mtimeMs });
    if (ext(f) === 'json') json[f] = await tryJSON(root, 'assets/' + f, null, null, errors);
    else if (['md', 'txt'].includes(ext(f)) && st.size <= 512 * 1024) text[f] = await fsp.readFile(p('assets/' + f), 'utf8'); // Markdown component sources
  }
  for (const c of Object.values(components)) if (c.error) errors.push({ file: `components/${c.name}.html`, error: c.error });
  return { project, pages, prefabs, components, behaviours, clips, json, text, assets, extensions, errors };
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
    catch (err) { P.errors.push({ file: e.path, error: err.message + (nodeModule.registerHooks ? '' : ` (TypeScript extensions and '../gpsb/' imports need Node 22.15 or later; this is ${process.version})`) }); }
  }
}
const statExtVersions = P => Object.fromEntries(Object.entries(P.extensions).map(([n, e]) => [n, e.size.toString(36) + Math.floor(e.mtime).toString(36)]));
async function hashFile(file) {
  const h = crypto.createHash('sha1');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex').slice(0, 10);
}

// Project scripts imported in Node (extensions, at build time and by the dev server): .ts files are compiled on load,
// './x.js' finds x.ts, and '../gpsb/<file>.js' (the runtime as published next to the site's scripts) is this tool's lib/.
if (nodeModule.registerHooks) quiet(() => nodeModule.registerHooks({
  resolve(spec, ctx, next) {
    if (/^\.\.?\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
      const u = new URL(spec, ctx.parentURL), f = fileURLToPath(u);
      if (!fs.existsSync(f)) {
        const ts = f.replace(/\.js$/, '.ts'), lib = path.join(TOOL, 'lib', path.basename(f));
        if (ts !== f && fs.existsSync(ts)) return next(pathToFileURL(ts).href + u.search, ctx);
        if (path.basename(path.dirname(f)) === 'gpsb' && fs.existsSync(lib)) return next(pathToFileURL(lib).href, ctx);
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (!url.startsWith('file:') || !isTS(new URL(url).pathname)) return next(url, ctx);
    const f = fileURLToPath(new URL(url).href.split('?')[0]);
    return { format: 'module', shortCircuit: true, source: withMap(compileTS(fs.readFileSync(f, 'utf8'), f)) };
  },
}));

// behaviours/ and extensions/ -> the site: .ts compiled to .js (+ .js.map), .d.ts left out, everything else as-is
async function copyScripts(from, to) {
  for (const f of await files(from)) {
    if (f.endsWith('.d.ts')) continue;
    const dst = path.join(to, f);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    if (!isTS(f)) { await fsp.copyFile(path.join(from, f), dst); continue; }
    let r;
    try { r = compileTS(await fsp.readFile(path.join(from, f), 'utf8'), f); } catch (e) { throw new Error(`${path.basename(from)}/${f}: ${e.message}`); }
    const js = dst.slice(0, -3) + '.js';
    await fsp.writeFile(js, withMap(r, path.basename(js) + '.map'));
    await fsp.writeFile(js + '.map', JSON.stringify(r.map));
  }
}

// ---------- TypeScript typings ----------
// .gpsb/types/gpsb/*.d.ts: the engine API (scripts import it as '../gpsb/engine.js'; tsconfig rootDirs maps that here)
// and project.d.ts (typed getComponent for every component this project has). Plus a tsconfig.json if there is none.
// The dev server rewrites them when the editor (re)loads a project that uses TypeScript; `gpsb types` on demand.
const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, rootDirs: ['.', '.gpsb/types'],
  },
  include: ['behaviours', 'extensions', '.gpsb/types'],
};
const usesTS = (root, P) => fs.existsSync(path.join(root, 'tsconfig.json')) || [...Object.values(P.behaviours), ...Object.values(P.extensions)].some(s => s.lang === 'ts');
const writeIfChanged = async (f, text) => { if ((await fsp.readFile(f, 'utf8').catch(() => null)) !== text) await fsp.writeFile(f, text); };
export async function writeTypes(root, P) {
  const dir = path.join(root, '.gpsb/types/gpsb');
  await fsp.mkdir(dir, { recursive: true });
  await writeIfChanged(path.join(root, '.gpsb/.gitignore'), '*\n');
  const libTypes = (await fsp.readdir(path.join(TOOL, 'lib'))).filter(f => f.endsWith('.d.ts'));
  for (const f of libTypes) await writeIfChanged(path.join(dir, f), await fsp.readFile(path.join(TOOL, 'lib', f), 'utf8'));
  await writeIfChanged(path.join(dir, 'project.d.ts'), projectTypes(P));
  for (const f of await fsp.readdir(dir)) if (f.endsWith('.d.ts') && f !== 'project.d.ts' && !libTypes.includes(f)) await fsp.rm(path.join(dir, f)); // from an older gpsb
  const tc = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(tc)) await fsp.writeFile(tc, JSON.stringify(TSCONFIG, null, 2) + '\n');
}
const tsType = s => {
  const t = s.type ?? '';
  if (t === 'number' || t === 'int') return 'number';
  if (t === 'bool') return 'boolean';
  if (t === 'color') return 'Color';
  if (t === 'vec2') return 'Vector2';
  if (t === 'vec4') return 'Vector4';
  if (t === 'enum') return (s.options ?? []).map(o => JSON.stringify(o)).join(' | ') || 'string';
  if (t === 'node') return s.component ? `ComponentRef<${JSON.stringify(s.component)}> | null` : 'WebObject | null';
  if (t === 'event') return 'WebEvent';
  if (t === 'list') return `Array<${tsType({ type: s.of ?? 'string' }).replace(/^Color$|^Vector[24]$/, 'string')}>`;
  return 'string';
};
function projectTypes(P) {
  const comps = { ...Object.fromEntries(Object.entries(builtins).map(([n, d]) => [n, d.props])), ...Object.fromEntries(Object.entries(P.components).map(([n, c]) => ['component:' + n, c.props])) };
  const body = Object.entries(comps).map(([n, props]) => `    ${JSON.stringify(n)}: {\n${Object.entries(props ?? {}).map(([k, s]) => `      ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${tsType(s)};`).join('\n')}\n    };`).join('\n');
  return `// Generated by gpsb from this project's components (built-in, extensions, components/*.html). Do not edit.\n`
    + `import type { Color, Vector2, Vector4, WebObject, WebEvent, ComponentRef } from './engine.js';\n\n`
    + `declare module './engine.js' {\n  interface ComponentTypes {\n${body}\n  }\n}\nexport {};\n`;
}

const ctxFor = (P, extra) => makeCtx({ pages: Object.keys(P.pages), customs: P.components, json: P.json, text: P.text, clips: P.clips, breakpoints: P.project.breakpoints, inject: P.project.inject, tokens: P.project.tokens, ...extra });

// The output folder is deleted before every build: refuse anything that is not a previous build or a fresh folder.
// project.json `keep`: paths in the output folder that builds leave alone, gitignore-style: `name/` is a folder,
// `name` a file; paths may be nested (`.git/`, `CNAME`, `.well-known/`, `docs/notes.txt`)
const keepOf = project => (Array.isArray(project.keep) ? project.keep : []).filter(k => typeof k === 'string')
  .map(k => k.trim().replace(/^\/+/, '')).filter(k => k && !k.split('/').includes('..'))
  .map(k => ({ path: k.replace(/\/+$/, ''), dir: k.endsWith('/') }));
const isKept = (keep, rel, dir) => keep.some(k => k.path === rel && k.dir === dir);
const holdsKept = (keep, rel) => keep.some(k => k.path.startsWith(rel + '/')); // a folder with kept paths inside
// delete everything in `dir` except kept paths (folders holding kept paths are cleared around them)
async function clearOut(dir, keep, rel = '') {
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const r = rel ? `${rel}/${e.name}` : e.name, p = path.join(dir, e.name);
    if (isKept(keep, r, e.isDirectory())) continue;
    if (e.isDirectory() && holdsKept(keep, r)) await clearOut(p, keep, r);
    else await fsp.rm(p, { recursive: true, force: true });
  }
}
async function checkOut(root, out, keep) {
  const inside = (a, b) => a === b || a.startsWith(b + path.sep);
  if (inside(root, out)) throw new Error(`refusing to build into ${out}: it contains the project`);
  for (const d of ['pages', 'assets', 'components', 'behaviours', 'animations'])
    if (inside(out, path.join(root, d))) throw new Error(`refusing to build into ${out}: it is inside the project's ${d}/ folder`);
  const ents = (await fsp.readdir(out, { withFileTypes: true }).catch(() => [])).filter(e => !isKept(keep, e.name, e.isDirectory()) && !(e.isDirectory() && holdsKept(keep, e.name)));
  if (ents.length && !['gpsb', 'psb'].some(d => fs.existsSync(path.join(out, d, 'runtime.js')))) // psb/: built before the rename
    throw new Error(`refusing to build into ${out}: it is not empty and does not look like a previous build`);
}

export async function build(root, out = path.join(root, 'dist')) {
  root = path.resolve(root); out = path.resolve(out);
  const P = await loadProject(root), keep = keepOf(P.project);
  await checkOut(root, out, keep);
  const extensionVersions = {};
  for (const [n, e] of Object.entries(P.extensions)) extensionVersions[n] = await hashFile(path.join(root, e.path));
  await loadExtensions(root, P, extensionVersions);
  const hooks = await buildHooks(root);
  // a broken page/clip/extension/project.json would silently drop content from the site: fail. Bad components/assets: warn.
  const fatal = P.errors.filter(e => !/^(components|assets)\//.test(e.file));
  if (fatal.length) throw new Error('cannot build:\n' + fatal.map(e => `  ${e.file}: ${e.error}`).join('\n'));
  const warnings = P.errors.map(e => `${e.file}: ${e.error}`);
  for (const [name, tree] of Object.entries(P.pages)) { // prefab instances -> real nodes
    expandPrefabs(tree, P.prefabs);
    for (const [n] of walk(tree)) if (n._missing) warnings.push(`pages/${name}.json: ${n.name} uses ${n._missing === 'cycle' ? 'a prefab that contains itself' : 'a missing prefab'} (${n.prefab})`);
  }
  await clearOut(out, keep); // the previous build
  await fsp.mkdir(path.join(out, 'gpsb'), { recursive: true });
  for (const f of await fsp.readdir(path.join(TOOL, 'lib'))) if (f !== 'compile.js' && !f.endsWith('.d.ts')) await fsp.copyFile(path.join(TOOL, 'lib', f), path.join(out, 'gpsb', f));
  if (fs.existsSync(path.join(root, 'assets'))) await fsp.cp(path.join(root, 'assets'), path.join(out, 'assets'), { recursive: true });
  for (const d of ['behaviours', 'extensions']) if (fs.existsSync(path.join(root, d))) await copyScripts(path.join(root, d), path.join(out, d));
  await fsp.mkdir(path.join(out, 'components'), { recursive: true });
  for (const name of Object.keys(P.components)) {
    if (P.components[name].error) continue; // reported in warnings
    const src = await fsp.readFile(path.join(root, 'components', name + '.html'), 'utf8');
    for (const [f, code] of Object.entries(compileComponent(name, src))) await fsp.writeFile(path.join(out, 'components', f), code);
  }
  const site = siteUrl(P.project), clean = !!P.project.cleanUrls, files = [];
  const opts = { assetVersions: await hashVersions(root, P), extensionVersions, cleanUrls: clean, minify: !!P.project.minify };
  // every output page: normal pages, and one per item of each collection (template) page
  const base = ctxFor(P, opts), outputs = [];
  for (const [name, tree] of Object.entries(P.pages)) {
    const items = collectionItems(tree, base);
    if (!items) outputs.push({ name, tree, scope: null, ...pageOutput(name, clean, site), url: pageUrl(name, clean).replace(/^index\.html$/, '') });
    else for (const it of items) outputs.push({ name: `${name}/${it.slug}`, tree, scope: { item: it.item, index: it.index }, ...itemOutput(name, it.slug, clean), url: itemUrl(name, it.slug, clean) });
  }
  const collections = collectionsOf(P);
  for (const o of outputs) {
    let r = renderDocument(o.tree, ctxFor(P, { ...opts, collections, prefix: o.prefix }), { name: o.name.split('/').pop(), cssHref: o.cssHref, scope: o.scope });
    if (hooks.transformPage) r = { ...r, ...(await hooks.transformPage({ name: o.name, html: r.html, css: r.css, project: P.project, item: o.scope?.item }) ?? {}) };
    await fsp.mkdir(path.join(out, path.dirname(o.file)), { recursive: true });
    await fsp.writeFile(path.join(out, o.file), r.html);
    await fsp.writeFile(path.join(out, path.dirname(o.file), o.cssFile), r.css);
    files.push(o.file);
  }
  // search engines: sitemap of the indexable pages (needs the public site URL), robots.txt pointing at it
  if (site) {
    const urls = outputs.filter(o => o.name !== '404' && !o.tree.components?.find(c => c.type === 'PageMeta')?.props?.noindex)
      .map(o => `  <url><loc>${escXml(site + o.url)}</loc></url>`);
    await fsp.writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  }
  await fsp.writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n${site ? `\nSitemap: ${site}sitemap.xml\n` : ''}`);
  // public/: copied to the site root as-is, last (CNAME, _redirects, .well-known/, your own robots.txt...)
  if (fs.existsSync(path.join(root, 'public'))) await fsp.cp(path.join(root, 'public'), out, { recursive: true });
  await hooks.afterBuild?.({ out, root, project: P.project, pages: Object.keys(P.pages), files });
  return { out, pages: Object.keys(P.pages), warnings };
}

// names of the pages that are collection templates
const collectionsOf = P => Object.keys(P.pages).filter(n => getComponent(P.pages[n], 'Canvas')?.props?.collection);
const escXml = s => s.replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);
// project.siteUrl normalised to end in '/', or '' when unset/invalid
export function siteUrl(project) {
  try { const u = new URL(project.siteUrl); u.search = u.hash = ''; return u.href.endsWith('/') ? u.href : u.href + '/'; } catch { return ''; }
}
// where a page is written and the URL prefix its links/assets need. The 404 page is served for any missing path,
// so it uses root-relative URLs (the site URL's path, default /).
function pageOutput(name, clean, site) {
  if (name === '404') { const root = site ? new URL(site).pathname : '/'; return { file: '404.html', prefix: root, cssHref: `${root}404.css`, cssFile: '404.css' }; }
  const up = '../'.repeat(name.split('/').length - 1), css = name.split('/').pop() + '.css'; // nested pages (pages/a/b.json)
  if (clean && name !== 'index') return { file: `${name}/index.html`, prefix: up + '../', cssHref: css, cssFile: css };
  return { file: `${name}.html`, prefix: up, cssHref: css, cssFile: css };
}
// one item of a collection page: post/<slug>.html, or post/<slug>/index.html with clean URLs
function itemOutput(page, slugv, clean) {
  const up = '../'.repeat(page.split('/').length), css = page.split('/').pop() + '.css'; // the template may be nested too
  return clean ? { file: `${page}/${slugv}/index.html`, prefix: up + '../', cssHref: css, cssFile: css }
    : { file: `${page}/${slugv}.html`, prefix: up, cssHref: `${slugv}.css`, cssFile: `${slugv}.css` };
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
let root = null, watcher = null; // project currently open in the editor; watcher: { close() } for all its fs watchers
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
  watcher = watchProject(dir);
}

// Hot reload: tell editors about changed project files. Only the source folders are watched recursively (plus the root
// itself for project.json/build.js): the output folder and .git can be big and change under a recursive watcher (a
// rebuild, a commit), which made it fail. A watcher that errors is restarted.
const SOURCES = ['pages', 'assets', 'components', 'behaviours', 'extensions', 'animations', 'prefabs', 'public'];
function watchProject(dir) {
  const ws = new Map(); // folder ('' = root) -> FSWatcher
  let t, closed = false;
  const changed = f => {
    if (f.split(path.sep).some(p => p.startsWith('.'))) return;
    clearTimeout(t);
    t = setTimeout(() => { for (const c of clients) c.write(`data: ${JSON.stringify({ file: f.split(path.sep).join('/') })}\n\n`); }, 100);
  };
  const watch = d => {
    if (closed || ws.has(d) || (d && !fs.existsSync(path.join(dir, d)))) return;
    try {
      const w = fs.watch(path.join(dir, d), { recursive: !!d }, (_, f) => {
        if (!f) return;
        changed(d ? path.join(d, f) : f);
        if (!d && SOURCES.includes(f)) watch(f); // a source folder created later
      });
      w.on('error', () => { w.close(); ws.delete(d); setTimeout(() => watch(d), 500); });
      ws.set(d, w);
    } catch { /* the folder went away; watched again if it comes back */ }
  };
  ['', ...SOURCES].forEach(watch);
  return { close: () => { closed = true; for (const w of ws.values()) w.close(); } };
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
      // a TypeScript script, served under its published .js name (a syntax error comes back as a script that throws it)
      const ts = p.match(/^\/project\/((?:behaviours|extensions)\/.+)\.js$/);
      if (ts && !fs.existsSync(safe(ts[1] + '.js')) && fs.existsSync(safe(ts[1] + '.ts'))) {
        const src = await fsp.readFile(safe(ts[1] + '.ts'), 'utf8');
        let js;
        try { js = withMap(compileTS(src, ts[1] + '.ts')); } catch (e) { js = `throw new SyntaxError(${JSON.stringify(`${ts[1]}.ts: ${e.message}`)});\n`; }
        return send(res, 200, js, MIME.js);
      }
      const it = p.match(/^\/project\/([\w-]+(?:\/[\w-]+)*)\/([\w-]+)\.html$/); // collection item (preview links)
      if (it && fs.existsSync(safe(`pages/${it[1]}.json`))) {
        const P = await loadProject(root), tree = P.pages[it[1]], extensionVersions = statExtVersions(P);
        await loadExtensions(root, P, extensionVersions);
        if (tree) expandPrefabs(tree, P.prefabs);
        const cx = ctxFor(P, { assetVersions: statVersions(P), extensionVersions, prefix: '../'.repeat(it[1].split('/').length), collections: collectionsOf(P) });
        const item = tree && collectionItems(tree, cx)?.find(x => x.slug === it[2]);
        if (item) return send(res, 200, renderDocument(tree, cx, { name: it[2], cssHref: null, scope: { item: item.item, index: item.index } }).html, MIME.html);
      }
      const page = p.match(/^\/project\/([\w-]+(?:\/[\w-]+)*)\.html$/)?.[1];
      if (page && fs.existsSync(safe(`pages/${page}.json`))) { // a page rendered on the fly (Links / IFrames in the editor preview)
        const P = await loadProject(root), extensionVersions = statExtVersions(P);
        await loadExtensions(root, P, extensionVersions);
        if (P.pages[page]) expandPrefabs(P.pages[page], P.prefabs);
        if (P.pages[page]) return send(res, 200, renderDocument(P.pages[page], ctxFor(P, { assetVersions: statVersions(P), extensionVersions, collections: collectionsOf(P), prefix: '../'.repeat(page.split('/').length - 1) }), { name: page.split('/').pop(), cssHref: null }).html, MIME.html);
      }
      if (p.startsWith('/project/')) return sendFile(res, safe(p.slice(9)));
      if (p === '/api/project') {
        if (!root) throw notOpen();
        const P = await loadProject(root);
        if (usesTS(root, P)) { // keep the IDE typings in step with the project's components
          await loadExtensions(root, P, statExtVersions(P));
          await writeTypes(root, P).catch(e => P.errors.push({ file: '.gpsb/types', error: e.message }));
        }
        return sendJSON(res, { root, ...P });
      }
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
  else if (cmd === 'types') loadProject(ROOT).then(async P => { await loadExtensions(ROOT, P, statExtVersions(P)); await writeTypes(ROOT, P); console.log(`wrote ${path.join(ROOT, '.gpsb/types')} and tsconfig.json`); }).catch(e => { console.error(e.message); process.exit(1); });
  else if (cmd === 'serve' || cmd === 'hub') {
    if (cmd === 'serve' && !isProject(ROOT)) { console.error(`no project.json in ${ROOT} (run: gpsb new ${dir})`); process.exit(1); }
    serve(cmd === 'serve' ? ROOT : null);
  } else { console.log('usage: gpsb [hub] | gpsb serve [dir] [--port N] | gpsb new <dir> | gpsb build [dir] [--out D] | gpsb types [dir]'); process.exit(1); }
}
