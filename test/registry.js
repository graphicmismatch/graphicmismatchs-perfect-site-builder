// A fake npm registry for tests: packuments, gzipped tarballs with real integrity hashes, and search, all in memory.
//   const reg = await startRegistry(PACKAGES); … reg.url, reg.hits (tarball downloads), reg.publish(name, v, def), reg.close()
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

// files -> .tar (ustar; GNU long names for paths over 100 bytes)
export function tar(files) {
  const blocks = [];
  const header = (name, size, type = '0') => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0);
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const pad = n => Buffer.alloc((512 - (n % 512)) % 512);
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    if (Buffer.byteLength(name) > 100) { const n = Buffer.from(name + '\0'); blocks.push(header('././@LongLink', n.length, 'L'), n, pad(n.length)); }
    blocks.push(header(name, data.length), data, pad(data.length));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

// defs: { name: { 'dist-tags'?, versions: { v: { files: { path: text }, dependencies?, peerDependencies?, deprecated?,
//   badHash?, rawFiles? (tar entry names used as-is) } } } }; package.json is generated unless given
export async function startRegistry(defs) {
  const tarballs = new Map(), hits = new Map();
  let url = '';
  const build = (name, v, d) => {
    const pkg = d.files['package.json'] ? JSON.parse(d.files['package.json']) : { name, version: v };
    const entries = d.rawFiles ?? Object.fromEntries(Object.entries({ ...d.files, 'package.json': JSON.stringify({ ...pkg, name, version: v }) }).map(([p, c]) => [`package/${p}`, c]));
    const tgz = zlib.gzipSync(tar(entries)), file = `${name.split('/').pop()}-${v}.tgz`;
    tarballs.set(`/${name}/-/${file}`, tgz);
    const integrity = 'sha512-' + crypto.createHash('sha512').update(d.badHash ? Buffer.from('x') : tgz).digest('base64');
    return { name, version: v, dependencies: d.dependencies, peerDependencies: d.peerDependencies, deprecated: d.deprecated, dist: { tarball: `${url}${name}/-/${file}`, integrity } };
  };
  const packuments = {};
  const publish = (name, v, d) => {
    const p = (packuments[name] ??= { name, 'dist-tags': {}, versions: {}, description: `${name} (test)` });
    p.versions[v] = build(name, v, d);
    if (!v.includes('-')) p['dist-tags'].latest = v;
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname);
    if (p === '/-/v1/search') {
      const t = u.searchParams.get('text') ?? '';
      const objects = Object.values(packuments).filter(x => x.name.includes(t)).map(x => ({ package: { name: x.name, version: x['dist-tags'].latest, description: x.description } }));
      return send(res, 200, { objects });
    }
    if (tarballs.has(p)) { hits.set(p, (hits.get(p) ?? 0) + 1); res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(tarballs.get(p)); }
    const pk = packuments[p.slice(1)];
    return pk ? send(res, 200, pk) : send(res, 404, { error: 'not found' });
  });
  const send = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
  for (const [name, def] of Object.entries(defs)) {
    for (const [v, d] of Object.entries(def.versions)) publish(name, v, d);
    Object.assign(packuments[name]['dist-tags'], def['dist-tags'] ?? {});
  }
  return { url, hits: p => [...hits].filter(([k]) => k.includes(p)).reduce((n, [, c]) => n + c, 0), publish, close: () => server.close() };
}

// the packages the tests install
export const PACKAGES = {
  'esm-lib': {
    'dist-tags': { latest: '1.2.0', next: '2.0.0-beta.1' },
    versions: Object.fromEntries(['1.0.0', '1.2.0', '2.0.0-beta.1'].map(v => [v, {
      dependencies: { 'dep-cjs': '^1.0.0' },
      files: {
        'package.json': JSON.stringify({ type: 'module', exports: { '.': { types: './index.d.ts', import: './index.js' }, './extra': './extra.js', './utils/*': './src/utils/*', './package.json': './package.json' } }),
        'index.js': `import dep, { add } from 'dep-cjs';\nimport { twice } from './lib/math';\nexport const sum = (a, b) => add(a, b);\nexport const depVersion = dep.version;\nexport const env = dep.env;\nexport { twice };\nexport const VERSION = '${v}';\n`,
        'lib/math.js': 'export const twice = x => x * 2;\n',
        'extra.js': "export const extra = 'extra';\n",
        'src/utils/str.js': 'export const up = s => s.toUpperCase();\n',
        'index.d.ts': 'export declare const sum: (a: number, b: number) => number;\nexport declare const twice: (x: number) => number;\nexport declare const depVersion: string;\nexport declare const env: string;\nexport declare const VERSION: string;\n',
      },
    }])),
  },
  'dep-cjs': {
    versions: Object.fromEntries(['1.0.0', '1.0.3', '2.0.0'].map(v => [v, {
      files: {
        'package.json': JSON.stringify({ main: 'index.js', browser: { './node-only.js': './browser.js' } }),
        'index.js': "#!/usr/bin/env node\n'use strict';\nconst u = require('./util');\nconst data = require('./data.json');\nlet fs; try { fs = require('fs'); } catch (e) { fs = null; }\nexports.add = (a, b) => a + b + u.zero;\nexports.version = data.v;\nexports.env = require('./node-only.js').env;\n",
        'util.js': 'module.exports = { zero: 0 };\n',
        'data.json': JSON.stringify({ v }),
        'node-only.js': "exports.env = 'node';\n",
        'browser.js': "exports.env = 'browser';\n",
      },
    }])),
  },
  'umd-lib': {
    versions: { '3.1.0': { files: { 'package.json': JSON.stringify({ main: 'umd.js' }), 'umd.js': '(function (root, f) { if (typeof module === "object" && module.exports) module.exports = f(); else root.Umd = f(); })(this, function () { return { triple: function (x) { return x * 3; } }; });\n' } } },
  },
  '@types/umd-lib': {
    versions: { '3.1.2': { files: { 'index.d.ts': 'declare const umd: { triple(x: number): number };\nexport default umd;\n' } } },
  },
  '@scope/thing': {
    versions: { '0.1.0': { files: { 'package.json': JSON.stringify({ main: 'cjs.js', module: 'esm.js' }), 'esm.js': "export default 'scoped';\n", 'cjs.js': "module.exports = 'scoped';\n" } } },
  },
  'css-only': {
    versions: { '1.0.0': { files: { 'package.json': JSON.stringify({ main: 'style.css' }), 'style.css': 'body { color: red; }\n' } } },
  },
  'conf-a': {
    versions: { '1.0.0': { dependencies: { 'dep-cjs': '^2.0.0' }, files: { 'index.js': 'module.exports = 1;\n' } } },
  },
  // a chain three levels deep, one of them with a git dependency that is skipped
  'chain-a': { versions: { '1.0.0': { dependencies: { 'chain-b': '^1.0.0' }, files: { 'index.js': "module.exports = require('chain-b') + 1;\n" } } } },
  'chain-b': { versions: { '1.0.0': { dependencies: { 'chain-c': '~1.1.0', 'from-git': 'github:x/y' }, files: { 'index.js': "module.exports = require('chain-c') + 1;\n" } } } },
  'chain-c': { versions: { '1.0.0': { files: { 'index.js': 'module.exports = 0;\n' } }, '1.1.5': { files: { 'index.js': 'module.exports = 1;\n' } } } },
  'bad-tar': {
    versions: { '1.0.0': { rawFiles: { 'package/package.json': '{"name":"bad-tar","version":"1.0.0"}', 'package/../../escaped.js': 'evil' }, files: {} } },
  },
  'bad-hash': {
    versions: { '1.0.0': { badHash: true, files: { 'index.js': 'module.exports = 1;\n' } } },
  },
  'old-lib': {
    versions: { '1.0.0': { deprecated: 'use new-lib', files: { 'index.js': 'module.exports = 1;\n' } } },
  },
  'long-names': {
    versions: { '1.0.0': { files: { [`${'deep/'.repeat(22)}file.js`]: 'export default 42;\n', 'package.json': JSON.stringify({ type: 'module', module: `${'deep/'.repeat(22)}file.js` }) } } },
  },
};
