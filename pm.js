// gpsb package manager: npm packages for a project's scripts, the Unity Package Manager way. Node only, never shipped.
//   packages/manifest.json        { "dependencies": { "canvas-confetti": "^1.9.3" },
//                                   "registry"?: url, "scopedRegistries"?: [{ "name", "url", "scopes": ["@co"] }] }
//   packages/packages-lock.json   what was resolved: exact versions, tarball URLs, integrity, entry points
//   packages/<name>/              the installed files (commit them, or let `gpsb install` restore them from the lock)
// Like UPM there's one version of each package per project: the highest that satisfies every request, with direct
// dependencies winning conflicts. Packages are never allowed to run scripts. Pages get an import map (importMap) so
// `import x from 'name'` works in the browser; CommonJS packages are bundled into an ES module (gpsb.esm.js).
// Docs: docs/packages.md.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { builtinModules } from 'node:module';

export const DIR = 'packages', MANIFEST = 'packages/manifest.json', LOCK = 'packages/packages-lock.json';
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
const BUNDLE = 'gpsb.esm.js';

// ---------- semver ----------
const SEM = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export function parseVersion(v) {
  const m = SEM.exec(String(v).trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] } : null;
}
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a, y = typeof b === 'string' ? parseVersion(b) : b;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length; // 1.0.0 > 1.0.0-beta
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const np = /^\d+$/.test(p), nq = /^\d+$/.test(q);
    if (np && nq) return +p - +q;
    return np ? -1 : nq ? 1 : p < q ? -1 : 1;
  }
  return 0;
}
const V = (major, minor, patch, pre = []) => ({ major, minor, patch, pre });
// '1', '1.2', '1.x', '*' -> parts (null = any)
function partial(s) {
  const m = /^v?(\d+|[xX*])?(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s);
  if (!m) throw new Error(`invalid version range "${s}"`);
  const n = v => (v == null || /^[xX*]$/.test(v) ? null : +v);
  let [a, b, c] = [n(m[1]), n(m[2]), n(m[3])];
  if (a == null) b = c = null; else if (b == null) c = null;
  return { a, b, c, pre: m[4] ? m[4].split('.') : [] };
}
// one token ('^1.2', '>=2', '1.x') -> comparators [[op, version]]
function comparators(tok) {
  const m = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(tok), op = m[1] ?? '';
  const { a, b, c, pre } = partial(m[2] || '*');
  if (a == null) return op === '<' || op === '>' ? [['<', V(0, 0, 0)]] : []; // '*' matches anything
  const lo = V(a, b ?? 0, c ?? 0, pre), next = b == null ? V(a + 1, 0, 0) : V(a, b + 1, 0);
  switch (op) {
    case '^': return [['>=', lo], ['<', a > 0 || b == null ? V(a + 1, 0, 0) : b > 0 || c == null ? V(0, b + 1, 0) : V(0, 0, c + 1)]];
    case '~': return [['>=', lo], ['<', next]];
    case '>': return c != null ? [['>', lo]] : [['>=', next]];
    case '>=': return [['>=', lo]];
    case '<': return [['<', lo]];
    case '<=': return c != null ? [['<=', lo]] : [['<', next]];
    default: return c != null ? [['=', lo]] : [['>=', lo], ['<', next]]; // '1.2.3', '=1.2.3', '1.2'
  }
}
// '^1.2 || >=3 <4', '1.2 - 2.3' -> comparator sets (any set may match; every comparator of a set must)
export function parseRange(range) {
  return String(range).trim().split('||').map(set => {
    set = set.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1');
    const hy = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hy) return [...comparators('>=' + hy[1]), ...comparators('<=' + hy[2])];
    return set ? set.split(/\s+/).flatMap(comparators) : [];
  });
}
const test = (v, [op, w]) => { const d = compareVersions(v, w); return op === '=' ? d === 0 : op === '>' ? d > 0 : op === '>=' ? d >= 0 : op === '<' ? d < 0 : d <= 0; };
// prereleases only match a range that names a prerelease of the same x.y.z (as npm does)
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  return parseRange(range).some(set => set.every(c => test(v, c))
    && (!v.pre.length || set.some(([, w]) => w.pre.length && w.major === v.major && w.minor === v.minor && w.patch === v.patch)));
}
export const maxSatisfying = (versions, range) => versions.filter(v => satisfies(v, range)).sort(compareVersions).at(-1) ?? null;

// 'name', 'name@^1.2', '@scope/name@latest' -> { name, range } (range '' = latest)
export function parseSpec(spec) {
  spec = String(spec).trim();
  const at = spec.indexOf('@', 1), name = at > 0 ? spec.slice(0, at) : spec, range = at > 0 ? spec.slice(at + 1).trim() : '';
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name) || ['manifest.json', 'packages-lock.json'].includes(name)) throw new Error(`invalid package name "${name}"`);
  if (/[:/#]/.test(range) || /^(file|git|github|link|workspace|npm):/.test(range)) throw new Error(`${name}: only registry versions are supported ("${range}")`);
  return { name, range };
}

// ---------- registry ----------
const slashed = u => (u.endsWith('/') ? u : u + '/');
export function registryFor(manifest, name) {
  const scope = name.startsWith('@') ? name.split('/')[0] : null;
  const s = scope && (manifest.scopedRegistries ?? []).find(r => (r.scopes ?? []).includes(scope));
  return slashed(s?.url ?? manifest.registry ?? DEFAULT_REGISTRY);
}
const ABBREVIATED = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8';
async function request(url, accept) {
  let r;
  try { r = await fetch(url, { headers: { accept } }); } catch (e) { throw new Error(`can't reach ${new URL(url).host} (${e.cause?.code ?? e.message})`); }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}
// one per operation: caches packuments (abbreviated: versions with their dependencies and dist)
export function registry(manifest) {
  const cache = new Map(), url = name => registryFor(manifest, name) + name.replace('/', '%2f');
  const packument = name => {
    if (!cache.has(name)) cache.set(name, request(url(name), ABBREVIATED).then(r => r?.json() ?? null));
    return cache.get(name);
  };
  return {
    packument,
    async need(name) { const p = await packument(name); if (!p) throw new Error(`package "${name}" not found in ${registryFor(manifest, name)}`); return p; },
    // full metadata (description, license, homepage, versions) for the Package Manager window
    async info(name) {
      const r = await request(url(name), 'application/json');
      if (!r) throw new Error(`package "${name}" not found`);
      const p = await r.json(), latest = p['dist-tags']?.latest, v = p.versions?.[latest] ?? {};
      return {
        name: p.name, description: p.description ?? v.description ?? '', latest, distTags: p['dist-tags'] ?? {},
        versions: Object.keys(p.versions ?? {}).filter(parseVersion).sort(compareVersions).reverse(),
        license: v.license ?? p.license ?? '', homepage: v.homepage ?? p.homepage ?? '', repository: v.repository?.url ?? '',
        deprecated: v.deprecated ?? '', dependencies: v.dependencies ?? {},
      };
    },
    async search(text, size = 20) {
      const r = await request(`${registryFor(manifest, text)}-/v1/search?text=${encodeURIComponent(text)}&size=${size}`, 'application/json');
      return ((await r?.json())?.objects ?? []).map(o => ({ name: o.package.name, version: o.package.version, description: o.package.description ?? '' }));
    },
    async tarball(u) {
      const r = await request(u, 'application/octet-stream');
      if (!r) throw new Error(`${u}: not found`);
      return Buffer.from(await r.arrayBuffer());
    },
  };
}

// ---------- tarballs ----------
// .tar -> [{ path, data }] (regular files only; ustar prefix, pax and GNU long names)
export function untar(buf) {
  const out = [], str = (b, s, e) => b.subarray(s, e).toString('utf8').replace(/\0[\s\S]*$/, '');
  let next = null;
  for (let o = 0; o + 512 <= buf.length;) {
    const h = buf.subarray(o, o + 512);
    if (h.every(b => b === 0)) break;
    const size = parseInt(str(h, 124, 136).trim() || '0', 8), type = String.fromCharCode(h[156] || 48);
    let name = str(h, 0, 100);
    if (str(h, 257, 262) === 'ustar' && str(h, 345, 500)) name = str(h, 345, 500) + '/' + name;
    const data = buf.subarray(o + 512, o + 512 + size);
    o += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8')); if (m) next = m[1]; continue; }
    if (type === 'L') { next = data.toString('utf8').replace(/\0[\s\S]*$/, ''); continue; }
    if (next) { name = next; next = null; }
    if (type === '0' || type === '7') out.push({ path: name, data });
  }
  return out;
}
// tarball entry 'package/dist/x.js' -> 'dist/x.js'; anything escaping the package folder is refused
function entryPath(p) {
  const rel = p.replace(/\\/g, '/').split('/').slice(1).join('/');
  if (!rel) return null;
  const norm = path.posix.normalize(rel);
  if (norm.startsWith('/') || norm === '..' || norm.startsWith('../') || /^[a-z]:/i.test(norm)) throw new Error(`unsafe path in package: ${p}`);
  return norm;
}
function verify(buf, dist, name) {
  const sri = String(dist.integrity ?? '').split(/\s+/).find(s => s.startsWith('sha512-'));
  const ok = sri ? crypto.createHash('sha512').update(buf).digest('base64') === sri.slice(7)
    : dist.shasum ? crypto.createHash('sha1').update(buf).digest('hex') === dist.shasum : true;
  if (!ok) throw new Error(`${name}: the download doesn't match its integrity hash`);
  return sri ?? (dist.shasum ? `sha1-${Buffer.from(dist.shasum, 'hex').toString('base64')}` : '');
}
// download, check, extract into packages/<name>/ (replacing what was there)
async function fetchInto(root, reg, name, dist) {
  const buf = await reg.tarball(dist.tarball);
  const integrity = verify(buf, dist, name);
  const files = untar(zlib.gunzipSync(buf)).map(f => ({ rel: entryPath(f.path), data: f.data })).filter(f => f.rel); // every path checked first
  const dir = path.join(root, DIR, name), tmp = `${dir}.gpsb-tmp`;
  await fsp.rm(tmp, { recursive: true, force: true });
  try {
    for (const f of files) {
      await fsp.mkdir(path.dirname(path.join(tmp, f.rel)), { recursive: true });
      await fsp.writeFile(path.join(tmp, f.rel), f.data);
    }
  } catch (e) { await fsp.rm(tmp, { recursive: true, force: true }); throw e; }
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(dir), { recursive: true });
  await fsp.rename(tmp, dir);
  return integrity;
}

// ---------- entry points ----------
const readPkg = dir => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const isFile = f => fs.existsSync(f) && fs.statSync(f).isFile();
const clean = rel => path.posix.normalize(rel.replace(/^\.\//, ''));
// first existing file for a package-relative path (with Node's extension and index lookups)
function fileIn(dir, rel) {
  if (typeof rel !== 'string') return null;
  rel = clean(rel);
  for (const c of [rel, rel + '.js', rel + '.mjs', rel + '.cjs', rel + '.json', rel + '/index.js', rel + '/index.mjs', rel + '/index.json'])
    if (!c.startsWith('..') && isFile(path.join(dir, c))) return c;
  return null;
}
// exports conditions, in the order the browser prefers them
const CONDITIONS = ['browser', 'import', 'module', 'default'];
function pickTarget(t, cond = 'default') {
  if (typeof t === 'string') return [t, cond];
  if (Array.isArray(t)) { for (const x of t) { const r = pickTarget(x, cond); if (r) return r; } return null; }
  if (t && typeof t === 'object') for (const c of CONDITIONS) if (c in t) { const r = pickTarget(t[c], c === 'default' ? cond : c); if (r) return r; }
  return null;
}
const typesTarget = t => (typeof t !== 'object' || !t ? null : Array.isArray(t) ? t.map(typesTarget).find(Boolean) : typeof t.types === 'string' ? t.types : Object.values(t).map(typesTarget).find(Boolean));
const exportsMap = pkg => {
  const e = pkg.exports;
  if (e == null) return null;
  return typeof e === 'string' || Array.isArray(e) || !Object.keys(e).some(k => k.startsWith('.')) ? { '.': e } : e;
};
const ESM_SYNTAX = /(^|[;\n}])\s*(import\s*[\w{*'"]|export\s*(\{|\*|default\b|const\b|let\b|var\b|function\b|class\b|async\b))/;
const CJS_SYNTAX = /\bmodule\.exports\b|\bexports\.[\w$]+\s*=|\brequire\s*\(/;
function isESM(dir, rel, pkg, via) {
  if (rel.endsWith('.mjs')) return true;
  if (rel.endsWith('.cjs') || rel.endsWith('.json')) return false;
  if (via === 'import' || via === 'module' || pkg.type === 'module') return true;
  const src = fs.readFileSync(path.join(dir, rel), 'utf8');
  return ESM_SYNTAX.test(src) && !CJS_SYNTAX.test(src);
}
// what a package offers the browser: main entry, format, import map entries (package-relative), types
export function analyze(dir, name) {
  const pkg = readPkg(dir), ex = exportsMap(pkg);
  let [mainRel, via] = (ex && pickTarget(ex['.'])) || [];
  if (!mainRel && typeof pkg.module === 'string') [mainRel, via] = [pkg.module, 'module'];
  if (!mainRel && typeof pkg.browser === 'string') [mainRel, via] = [pkg.browser, 'browser'];
  if (!mainRel && (pkg.main || isFile(path.join(dir, 'index.js')))) [mainRel, via] = [pkg.main || 'index.js', 'main'];
  const found = fileIn(dir, mainRel), main = found && /\.(m?js|cjs|json)$/.test(found) ? found : null; // a CSS-only package has files, no module
  const format = !main ? 'none' : isESM(dir, main, pkg, via) ? 'esm' : 'cjs';
  const imports = {};
  if (main) imports[name] = format === 'esm' ? main : BUNDLE;
  if (format === 'esm' && ex) for (const [k, v] of Object.entries(ex)) {
    if (!k.startsWith('./') || k === '.') continue;
    const t = pickTarget(v)?.[0];
    if (!t) continue;
    if (k.endsWith('/*') && t.endsWith('/*')) imports[`${name}/${k.slice(2, -1)}`] = clean(t.slice(0, -1)).replace(/\/?$/, '/');
    else if (!k.includes('*')) { const f = fileIn(dir, t); if (f) imports[`${name}/${k.slice(2)}`] = f; }
  }
  imports[`${name}/`] ??= ''; // name/dist/style.css and other files inside the package
  const types = [pkg.types, pkg.typings, ex && typesTarget(ex['.']), 'index.d.ts'].map(t => typeof t === 'string' && fileIn(dir, t)).find(Boolean) || null;
  return { main, format, imports, types, description: pkg.description ?? '', license: typeof pkg.license === 'string' ? pkg.license : '' };
}

// ---------- CommonJS -> ES module ----------
// Bundles a CommonJS package's own files (followed through require('./x')) into one ES module whose default export is
// module.exports. require('other-package') becomes an import, resolved by the import map like any other package, so
// each package is loaded once. Node built-ins and missing packages throw only if they're actually required at runtime.
const REQUIRE = /(?<![.\w$])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g; // not obj.require(…)
const BUILTINS = new Set(builtinModules.flatMap(m => [m, 'node:' + m]));
const RESERVED = new Set('break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await'.split(' '));
const bareName = s => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
export function bundleCJS(packagesDir, name, mainRel, formats) {
  packagesDir = path.resolve(packagesDir);
  const mods = [], ids = new Map(), externals = new Map(), warnings = new Set();
  const pkgRoot = file => { // the package a file belongs to (deep requires can reach into other packages)
    let d = path.dirname(file);
    while (d.startsWith(packagesDir + path.sep) && !isFile(path.join(d, 'package.json'))) d = path.dirname(d);
    return d;
  };
  const resolveFile = abs => {
    for (const c of [abs, abs + '.js', abs + '.json', abs + '.cjs', path.join(abs, 'index.js'), path.join(abs, 'index.json')])
      if (c.startsWith(packagesDir + path.sep) && isFile(c)) return c;
    if (isFile(path.join(abs, 'package.json'))) { const m = readPkg(abs).main; if (m) return resolveFile(path.join(abs, m)); }
    return null;
  };
  const add = file => {
    if (ids.has(file)) return ids.get(file);
    const id = mods.length, src = fs.readFileSync(file, 'utf8').replace(/^#!.*/, ''), m = { file, src, deps: {} };
    ids.set(file, id);
    mods.push(m);
    if (!file.endsWith('.json')) for (const [, , spec] of src.matchAll(REQUIRE)) m.deps[spec] ??= link(file, spec);
    return id;
  };
  const link = (from, spec) => {
    const root = pkgRoot(from), browser = isFile(path.join(root, 'package.json')) ? readPkg(root).browser : null;
    const swap = key => (browser && typeof browser === 'object' && key in browser ? browser[key] : undefined);
    let s = swap(spec);
    if (s === false) return { empty: true };
    if (typeof s === 'string') spec = s;
    if (/^\.{0,2}\//.test(spec)) {
      let f = resolveFile(path.resolve(path.dirname(from), spec));
      const alt = f && swap('./' + path.relative(root, f).split(path.sep).join('/'));
      if (alt === false) return { empty: true };
      if (typeof alt === 'string') f = resolveFile(path.resolve(root, alt));
      return f ? { id: add(f) } : { missing: `Cannot find module '${spec}'` };
    }
    const pn = bareName(spec), sub = spec.slice(pn.length + 1);
    if (BUILTINS.has(spec) || BUILTINS.has(pn)) { warnings.add(`uses the Node module "${spec}" (not available in the browser)`); return { missing: `"${spec}" is a Node module` }; }
    if (!formats[pn]) { warnings.add(`requires "${pn}", which isn't installed`); return { missing: `Cannot find package '${pn}'` }; }
    if (pn === name && !sub) return { id: 0 };
    if (!sub) { if (!externals.has(pn)) externals.set(pn, externals.size); return { ext: pn }; }
    const f = resolveFile(path.join(packagesDir, pn, sub));
    return f ? { id: add(f) } : { missing: `Cannot find module '${spec}'` };
  };
  add(path.join(packagesDir, name, mainRel));
  // named exports for `import { x } from …`: found statically in the entry (and files it re-exports)
  const names = new Set(), scan = m => {
    for (const x of m.src.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) names.add(x[1]);
    for (const x of m.src.matchAll(/Object\.defineProperty\(\s*(?:module\.)?exports\s*,\s*['"]([A-Za-z_$][\w$]*)['"]/g)) names.add(x[1]);
    const lit = /\bmodule\.exports\s*=\s*\{([^{}]*)\}/.exec(m.src);
    if (lit) for (const p of lit[1].split(',')) { const k = /^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(p); if (k) names.add(k[1]); }
  };
  scan(mods[0]);
  for (const [, , spec] of mods[0].src.matchAll(/\bmodule\.exports\s*=\s*require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)) { const d = mods[0].deps[spec]; if (d && 'id' in d) scan(mods[d.id]); }
  const named = [...names].filter(n => n !== 'default' && n !== '__esModule' && !RESERVED.has(n)).sort();
  const rel = f => path.relative(path.join(packagesDir, name), f).split(path.sep).join('/');
  const code = [
    `// ${name}: CommonJS bundled into an ES module by gpsb (default export = module.exports). Do not edit.`,
    ...[...externals.keys()].map((p, i) => `import * as __x${i} from ${JSON.stringify(p)};`),
    `const __ext = { ${[...externals.keys()].map((p, i) => `${JSON.stringify(p)}: [__x${i}, ${formats[p] === 'cjs'}]`).join(', ')} };`,
    `const process = globalThis.process ?? { env: { NODE_ENV: 'production' }, browser: true, argv: [], cwd: () => '/', nextTick: (f, ...a) => queueMicrotask(() => f(...a)) };`,
    'const global = globalThis;',
    'const __m = [',
    ...mods.map(m => m.file.endsWith('.json')
      ? `[function (module) { module.exports = ${m.src.trim()}; }, {}, ${JSON.stringify(rel(m.file))}],`
      : `[function (module, exports, require, __filename, __dirname) {\n${m.src}\n}, ${JSON.stringify(m.deps)}, ${JSON.stringify(rel(m.file))}],`),
    '];',
    'const __c = [];',
    'function __r(id) {',
    '  if (__c[id]) return __c[id].exports;',
    '  const module = (__c[id] = { exports: {} }), [fn, deps, file] = __m[id];',
    '  const require = s => {',
    '    const d = deps[s];',
    "    if (!d) throw new Error(`Cannot find module '${s}' (only require() calls with a string literal are bundled)`);",
    "    if ('id' in d) return __r(d.id);",
    '    if (d.ext) { const [ns, cjs] = __ext[d.ext]; return cjs ? ns.default : ns; }',
    '    if (d.empty) return {};',
    '    throw new Error(d.missing);',
    '  };',
    `  fn.call(module.exports, module, module.exports, require, '/${name}/' + file, '/${name}/' + file.replace(/\\/?[^/]*$/, ''));`,
    '  return module.exports;',
    '}',
    'const __main = __r(0);',
    'export default __main;',
    named.length ? `export const { ${named.join(', ')} } = __main ?? {};` : '',
  ].join('\n') + '\n';
  return { code, named, warnings: [...warnings] };
}

// ---------- manifest + lock ----------
const readJSON = async (f, d) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return d; throw new Error(`${path.basename(f)}: ${e.message}`); } };
const sortKeys = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
export const readManifest = root => readJSON(path.join(root, MANIFEST), { dependencies: {} });
export const readLock = root => readJSON(path.join(root, LOCK), null);
async function writeManifest(root, m) {
  await fsp.mkdir(path.join(root, DIR), { recursive: true });
  await fsp.writeFile(path.join(root, MANIFEST), JSON.stringify({ ...m, dependencies: sortKeys(m.dependencies ?? {}) }, null, 2) + '\n');
}
const writeLock = (root, packages) => fsp.writeFile(path.join(root, LOCK), JSON.stringify({ lockfileVersion: 1, packages: sortKeys(packages) }, null, 2) + '\n');

// import map entries of the runtime packages: { 'name': 'name/dist/x.js', 'name/': 'name/' } (relative to packages/)
export function packageImports(lock) {
  const out = {};
  for (const [name, p] of Object.entries(lock?.packages ?? {})) {
    if (p.typesOnly) continue;
    for (const [spec, rel] of Object.entries(p.imports ?? {})) out[spec] = `${name}/${rel}`;
  }
  return sortKeys(out);
}
// URL-safe path segments, keeping @scope readable
export const packageUrl = rel => String(rel).split('/').map(s => encodeURIComponent(s).replace(/^%40/, '@')).join('/');

// ---------- resolution ----------
const depsOf = info => ({
  ...(info.dependencies ?? {}),
  ...Object.fromEntries(Object.entries(info.peerDependencies ?? {}).filter(([k]) => !info.peerDependenciesMeta?.[k]?.optional)),
});
// manifest (+ lock preferences) -> Map name -> { version, info, requested: [{ range, from }] }, warnings
async function resolve(reg, manifest, lock, fresh) {
  const direct = manifest.dependencies ?? {};
  let chosen = new Map();
  for (let round = 0; round < 30; round++) {
    const req = new Map(), warnings = [];
    const want = (n, range, from) => { // -> false for a dependency that isn't a registry version
      if (/[:/#]/.test(range ?? '')) { warnings.push(`${from ?? 'manifest'}: skipped ${n}@${range} (only registry versions are supported)`); return false; }
      (req.get(n) ?? req.set(n, []).get(n)).push({ range: range || 'latest', from });
      return true;
    };
    for (const [n, r] of Object.entries(direct)) want(n, r, null);
    const seen = new Set(), queue = Object.keys(direct);
    while (queue.length) {
      const n = queue.shift();
      if (seen.has(n)) continue;
      seen.add(n);
      for (const [d, r] of Object.entries(chosen.has(n) ? depsOf(chosen.get(n).info) : {})) if (want(d, r, n)) queue.push(d);
    }
    const next = new Map();
    for (const [n, rs] of req) {
      const p = await reg.need(n), tags = p['dist-tags'] ?? {}, all = Object.keys(p.versions ?? {}).filter(parseVersion);
      const fits = (v, r) => { try { return tags[r] ? v === tags[r] : satisfies(v, r); } catch { return false; } };
      const best = list => { const ok = all.filter(v => list.every(x => fits(v, x.range))); return ok.includes(lock?.packages?.[n]?.version) && !fresh(n) ? lock.packages[n].version : ok.includes(tags.latest) ? tags.latest : ok.sort(compareVersions).at(-1); };
      let v = best(rs);
      if (!v) { // conflict: the direct dependency wins, else the highest version anyone asked for
        const d = rs.find(x => !x.from);
        v = d ? best([d]) : rs.map(x => best([x])).filter(Boolean).sort(compareVersions).at(-1);
        if (!v) throw new Error(`${n}: no version matches ${rs.map(x => `"${x.range}"`).join(', ')}`);
        warnings.push(`${n}: no single version satisfies ${rs.map(x => `${x.range} (${x.from ?? 'manifest'})`).join(', ')}; using ${v}`);
      }
      next.set(n, { name: n, version: v, info: p.versions[v], requested: rs });
    }
    const settled = next.size === chosen.size && [...next].every(([n, c]) => chosen.get(n)?.version === c.version);
    chosen = next;
    if (settled) return { packages: chosen, warnings };
  }
  throw new Error('package versions did not settle (conflicting dependencies)');
}

// ---------- operations ----------
const queues = new Map(); // one operation at a time per project
const serial = (root, fn) => { const p = (queues.get(root) ?? Promise.resolve()).then(fn, fn); queues.set(root, p.catch(() => {})); return p; };
const installedVersion = (root, name) => { try { return readPkg(path.join(root, DIR, name)).version; } catch { return null; } };
const typesName = n => '@types/' + (n.startsWith('@') ? n.slice(1).replace('/', '__') : n);

// Make packages/ match the manifest: resolve, download what changed, convert CommonJS, add @types, prune, write the lock.
// fresh(name): ignore the locked version (update). -> { installed: [name@v], removed: [names], warnings }
async function sync(root, manifest, { fresh = () => false, log = () => {} } = {}) {
  const lock = await readLock(root), reg = registry(manifest), warnings = [];
  const { packages, warnings: w } = await resolve(reg, manifest, lock, fresh);
  warnings.push(...w);
  const entries = {}, installed = [], downloaded = new Set();
  const get = async (name, version, dist) => {
    const prev = lock?.packages?.[name];
    if (installedVersion(root, name) === version && prev?.version === version) return prev.integrity;
    log(`downloading ${name}@${version}`);
    installed.push(`${name}@${version}`);
    downloaded.add(name);
    return fetchInto(root, reg, name, dist);
  };
  for (const [name, c] of packages) {
    if (c.info.deprecated) warnings.push(`${name}@${c.version} is deprecated: ${c.info.deprecated}`);
    if (c.info.hasInstallScript || c.info.scripts?.install || c.info.scripts?.postinstall || c.info.gypfile) warnings.push(`${name} has install scripts or native code; gpsb never runs them, so it may not work`);
    const integrity = await get(name, c.version, c.info.dist);
    entries[name] = { version: c.version, resolved: c.info.dist.tarball, integrity, direct: name in (manifest.dependencies ?? {}), dependencies: sortKeys(depsOf(c.info)) };
  }
  // entry points (all packages first: a CommonJS bundle needs to know which of its imports are CommonJS too)
  const dir = path.join(root, DIR), formats = {};
  for (const name of Object.keys(entries)) { const a = analyze(path.join(dir, name), name); Object.assign(entries[name], { main: a.main, format: a.format, imports: a.imports, types: a.types }); formats[name] = a.format; }
  for (const [name, e] of Object.entries(entries)) {
    if (downloaded.has(name) || (e.format === 'cjs' && !isFile(path.join(dir, name, BUNDLE)))) await convert(dir, name, e, formats, warnings);
    else if (lock?.packages?.[name]?.named) e.named = lock.packages[name].named; // unchanged: converted when it was installed
  }
  // types for packages that ship none
  if (manifest.types !== false) for (const name of Object.keys(entries)) {
    if (entries[name].types || name.startsWith('@types/')) continue;
    const tn = typesName(name), tp = await reg.packument(tn).catch(() => null);
    if (!tp || entries[tn]) continue;
    // DefinitelyTyped versions follow the library's major.minor
    const { major, minor } = parseVersion(entries[name].version), tvs = Object.keys(tp.versions ?? {});
    const queue = [[tn, maxSatisfying(tvs, `~${major}.${minor}`) ?? maxSatisfying(tvs, `^${major}`) ?? tp['dist-tags']?.latest]];
    while (queue.length) {
      const [n, v] = queue.shift();
      if (entries[n] || !v) continue;
      const info = (await reg.need(n)).versions[v];
      entries[n] = { version: v, resolved: info.dist.tarball, integrity: await get(n, v, info.dist), direct: false, typesOnly: true, dependencies: sortKeys(info.dependencies ?? {}) };
      entries[n].types = analyze(path.join(dir, n), n).types;
      for (const [d, r] of Object.entries(info.dependencies ?? {})) queue.push([d, maxSatisfying(Object.keys((await reg.need(d)).versions), r)]); // their imports, types only
    }
  }
  const removed = await prune(root, entries);
  await writeLock(root, entries);
  return { installed, removed, warnings };
}
// make an installed package loadable by the browser: bundle CommonJS, add extensions to bundler-style ESM imports
async function convert(dir, name, entry, formats, warnings) {
  if (entry.format === 'esm') { const n = await fixImports(dir, name, formats); if (n) warnings.push(`${name}: added file extensions to imports in ${n} file(s)`); }
  if (entry.format !== 'cjs') return;
  const r = bundleCJS(dir, name, entry.main, formats);
  await fsp.writeFile(path.join(dir, name, BUNDLE), r.code);
  entry.named = r.named;
  for (const w of r.warnings) warnings.push(`${name}: ${w}`);
}
// Many "module" builds are written for bundlers: `import './util'` without an extension, or a deep import into a
// package without an exports map. Browsers need the exact file, so rewrite those specifiers to it.
const SPECIFIER = /(\b(?:from|import)\s*\(?\s*)(['"])([^'"\n]+)\2/g;
async function fixImports(dir, name, formats) {
  const root = path.join(dir, name);
  let changed = 0;
  for (const rel of await walkFiles(root)) {
    if (!/\.m?js$/.test(rel) || rel === BUNDLE) continue;
    const file = path.join(root, rel), src = await fsp.readFile(file, 'utf8');
    const out = src.replace(SPECIFIER, (m, pre, q, spec) => {
      let base, sub;
      if (/^\.{1,2}\//.test(spec)) [base, sub] = [path.dirname(file), spec];
      else {
        const pn = bareName(spec);
        if (!formats[pn] || spec === pn || !isFile(path.join(dir, pn, 'package.json')) || readPkg(path.join(dir, pn)).exports) return m;
        [base, sub] = [path.join(dir, pn), spec.slice(pn.length + 1)];
      }
      if (isFile(path.join(base, sub))) return m;
      const ext = ['.js', '.mjs', '/index.js', '/index.mjs'].find(e => isFile(path.join(base, sub + e)));
      return ext ? `${pre}${q}${spec}${ext}${q}` : m;
    });
    if (out !== src) { await fsp.writeFile(file, out); changed++; }
  }
  return changed;
}
async function walkFiles(dir, base = dir) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...await walkFiles(p, base)); }
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
// remove folders in packages/ that the lock doesn't list
async function prune(root, entries) {
  const dir = path.join(root, DIR), removed = [];
  const drop = async rel => { await fsp.rm(path.join(dir, rel), { recursive: true, force: true }); removed.push(rel); };
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (e.name.endsWith('.gpsb-tmp')) { await fsp.rm(path.join(dir, e.name), { recursive: true, force: true }); continue; }
    if (!e.name.startsWith('@')) { if (!entries[e.name]) await drop(e.name); continue; }
    for (const s of await fsp.readdir(path.join(dir, e.name), { withFileTypes: true })) if (s.isDirectory() && !entries[`${e.name}/${s.name}`]) await drop(`${e.name}/${s.name}`);
    if (!(await fsp.readdir(path.join(dir, e.name))).length) await fsp.rmdir(path.join(dir, e.name));
  }
  return removed;
}

// gpsb add name[@range] …: a missing range becomes ^<latest>
export function add(root, specs, opts = {}) {
  return serial(root, async () => {
    const m = await readManifest(root), reg = registry(m);
    m.dependencies ??= {};
    for (const s of specs) {
      const { name, range } = parseSpec(s);
      const p = await reg.need(name);
      if (range && !p['dist-tags']?.[range] && !Object.keys(p.versions).some(v => satisfies(v, range))) throw new Error(`${name}: no version matches "${range}" (latest is ${p['dist-tags']?.latest})`);
      m.dependencies[name] = range && !p['dist-tags']?.[range] ? range : `^${p['dist-tags']?.[range || 'latest'] ?? p['dist-tags'].latest}`;
    }
    const r = await sync(root, m, { ...opts, fresh: n => specs.some(s => parseSpec(s).name === n) });
    await writeManifest(root, m);
    return r;
  });
}
export function remove(root, names, opts = {}) {
  return serial(root, async () => {
    const m = await readManifest(root);
    for (const n of names) { if (!m.dependencies?.[n]) throw new Error(`${n} is not in packages/manifest.json`); delete m.dependencies[n]; }
    const r = await sync(root, m, opts);
    await writeManifest(root, m);
    return r;
  });
}
// newest versions the manifest ranges allow (names: only those, and their dependencies)
export function update(root, names = [], opts = {}) {
  return serial(root, async () => {
    const m = await readManifest(root);
    return sync(root, m, { ...opts, fresh: n => !names.length || names.includes(n) });
  });
}
// gpsb install: restore what the lock lists (only missing or changed folders are downloaded); without a lock, resolve
export function install(root, opts = {}) {
  return serial(root, async () => {
    const m = await readManifest(root), lock = await readLock(root);
    const deps = m.dependencies ?? {}, locked = lock?.packages ?? {};
    const fits = (v, r) => { try { return !r || satisfies(v, r); } catch { return true; } }; // a dist-tag can't be checked offline
    const inSync = lock && Object.entries(deps).every(([n, r]) => locked[n]?.direct && fits(locked[n].version, r)) && Object.entries(locked).every(([n, p]) => !p.direct || n in deps);
    if (!inSync) return Object.keys(deps).length || lock ? sync(root, m, opts) : { installed: [], removed: [], warnings: [] };
    const reg = registry(m), installed = [], warnings = [], dir = path.join(root, DIR), formats = Object.fromEntries(Object.entries(locked).map(([n, p]) => [n, p.format]));
    for (const [name, p] of Object.entries(locked)) {
      if (installedVersion(root, name) === p.version && (p.format !== 'cjs' || isFile(path.join(dir, name, BUNDLE)))) continue;
      opts.log?.(`downloading ${name}@${p.version}`);
      await fetchInto(root, reg, name, { tarball: p.resolved, integrity: p.integrity });
      await convert(dir, name, p, formats, warnings);
      installed.push(`${name}@${p.version}`);
    }
    return { installed, removed: [], warnings };
  });
}
// missing packages, without touching the network: for loadProject's error list
export async function problems(root) {
  const lock = await readLock(root).catch(e => ({ error: e.message }));
  if (lock?.error) return [lock.error];
  return Object.entries(lock?.packages ?? {}).filter(([n, p]) => installedVersion(root, n) !== p.version).map(([n, p]) => `${n}@${p.version} is not installed (run gpsb install)`);
}
// Package Manager window: manifest + lock, with what each package offers
export async function list(root) {
  const m = await readManifest(root), lock = await readLock(root);
  return {
    registry: registryFor(m, ''), dependencies: m.dependencies ?? {},
    packages: Object.entries(lock?.packages ?? {}).map(([name, p]) => {
      let description = '', license = '';
      try { ({ description, license } = analyze(path.join(root, DIR, name), name)); } catch { /* not installed */ }
      return { name, ...p, description, license, installed: installedVersion(root, name) === p.version };
    }),
  };
}
export const search = async (root, text) => registry(await readManifest(root)).search(text);
export const info = async (root, name) => registry(await readManifest(root)).info(name);
// newest version per installed direct dependency (for "update available")
export async function outdated(root) {
  const m = await readManifest(root), lock = await readLock(root), reg = registry(m), out = {};
  for (const [n, range] of Object.entries(m.dependencies ?? {})) {
    const p = await reg.packument(n).catch(() => null);
    if (!p) continue;
    const all = Object.keys(p.versions ?? {}).filter(parseVersion);
    out[n] = { current: lock?.packages?.[n]?.version ?? null, wanted: maxSatisfying(all, range), latest: p['dist-tags']?.latest ?? null };
  }
  return out;
}
