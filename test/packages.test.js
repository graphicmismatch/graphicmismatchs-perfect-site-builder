// node test/packages.test.js: the package manager (pm.js) against a fake npm registry (test/registry.js)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pm from '../pm.js';
import { startRegistry, tar, PACKAGES } from './registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the CLI's import hooks tell Node that package files are ES modules; importing them directly here makes Node guess
const warn = process.emitWarning;
process.emitWarning = (w, ...a) => (/Module type of .* is not specified/.test(String(w?.message ?? w)) ? undefined : warn.call(process, w, ...a));
const T = path.join(ROOT, '.tmp', 'packages-test');
// the CLI in a child process, asynchronously: it may download from the fake registry, which runs in this process
const cli = (...args) => new Promise(ok => {
  const c = spawn(process.execPath, ['cli.js', ...args], { cwd: ROOT });
  let stdout = '', stderr = '';
  c.stdout.on('data', d => (stdout += d)); c.stderr.on('data', d => (stderr += d));
  c.on('close', status => ok({ status, stdout, stderr }));
});
const read = f => JSON.parse(fs.readFileSync(path.join(T, f), 'utf8'));
const exists = f => fs.existsSync(path.join(T, f));

// ---------- semver ----------
{
  const yes = [['1.2.3', '^1.2.0'], ['1.9.0', '^1.2.0'], ['0.2.9', '^0.2.3'], ['0.0.3', '^0.0.3'], ['1.2.9', '~1.2.3'], ['1.4.0', '1.x'],
    ['1.4.0', '1'], ['2.0.0', '*'], ['1.5.0', '>=1.2 <2'], ['1.5.0', '1.2 - 2.3'], ['2.3.9', '1.2 - 2.3'], ['3.1.0', '^1 || ^3'], ['1.2.3', '=1.2.3'],
    ['1.2.3', '>= 1.2.3'], ['2.0.0-beta.2', '^2.0.0-beta.1'], ['2.0.0-beta.2', '>=2.0.0-beta.1 <2.0.0'], ['1.0.0', ''], ['1.2.0', '<=1.2']];
  const no = [['2.0.0', '^1.2.0'], ['0.3.0', '^0.2.3'], ['0.0.4', '^0.0.3'], ['1.3.0', '~1.2.3'], ['2.4.0', '1.2 - 2.3'], ['2.0.0-beta.2', '^1.0.0'],
    ['2.0.0-beta.2', '*'], ['1.2.4', '1.2.3'], ['1.3.0', '<=1.2'], ['3.0.0-rc.1', '^2.0.0-beta.1']];
  for (const [v, r] of yes) assert.ok(pm.satisfies(v, r), `${v} should satisfy "${r}"`);
  for (const [v, r] of no) assert.ok(!pm.satisfies(v, r), `${v} should not satisfy "${r}"`);
  assert.deepEqual(['1.0.0', '1.0.0-rc.1', '1.0.0-alpha', '0.9.9', '1.0.0-alpha.2', '1.0.0-alpha.10'].sort(pm.compareVersions),
    ['0.9.9', '1.0.0-alpha', '1.0.0-alpha.2', '1.0.0-alpha.10', '1.0.0-rc.1', '1.0.0']);
  assert.equal(pm.maxSatisfying(['1.0.0', '1.4.2', '2.0.0', '1.5.0-beta'], '^1'), '1.4.2');
  assert.deepEqual(pm.parseSpec('@scope/x@^1.2'), { name: '@scope/x', range: '^1.2' });
  assert.deepEqual(pm.parseSpec('three'), { name: 'three', range: '' });
  assert.throws(() => pm.parseSpec('x@github:a/b'), /only registry versions/);
  assert.throws(() => pm.parseSpec('../evil'), /invalid package name/);
  assert.throws(() => pm.parseSpec('manifest.json'), /invalid package name/);
  assert.equal(pm.packageUrl('@scope/my lib/x.js'), '@scope/my%20lib/x.js');
}

// ---------- tar ----------
{
  const long = 'package/' + 'a/'.repeat(60) + 'f.js';
  const files = pm.untar(tar({ 'package/x.js': 'one', [long]: 'two' }));
  assert.deepEqual(files.map(f => [f.path, String(f.data)]), [['package/x.js', 'one'], [long, 'two']]);
}

// ---------- installing ----------
const reg = await startRegistry(PACKAGES);
fs.rmSync(T, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'test/fixtures/scripting'), T, { recursive: true });
fs.mkdirSync(path.join(T, 'packages'));
fs.writeFileSync(path.join(T, 'packages/manifest.json'), JSON.stringify({ registry: reg.url, dependencies: {} }));
try {
  let r = await pm.add(T, ['esm-lib']);
  assert.deepEqual(read('packages/manifest.json').dependencies, { 'esm-lib': '^1.2.0' }, 'no range: ^latest (the latest tag, not the newest prerelease)');
  let lock = read('packages/packages-lock.json').packages;
  assert.deepEqual(Object.keys(lock), ['dep-cjs', 'esm-lib']);
  assert.equal(lock['esm-lib'].version, '1.2.0'); assert.equal(lock['esm-lib'].format, 'esm'); assert.equal(lock['esm-lib'].direct, true);
  assert.equal(lock['dep-cjs'].version, '1.0.3'); assert.equal(lock['dep-cjs'].format, 'cjs'); assert.equal(lock['dep-cjs'].direct, false);
  assert.match(lock['esm-lib'].integrity, /^sha512-/);
  assert.deepEqual(r.installed.sort(), ['dep-cjs@1.0.3', 'esm-lib@1.2.0']);
  assert.ok(r.warnings.some(w => /esm-lib: added file extensions/.test(w)), r.warnings.join('|'));
  assert.ok(r.warnings.some(w => /dep-cjs: uses the Node module "fs"/.test(w)));
  assert.match(fs.readFileSync(path.join(T, 'packages/esm-lib/index.js'), 'utf8'), /from '\.\/lib\/math\.js'/, 'extensionless import fixed for the browser');
  // import map entries: main, exact subpaths, folder patterns, the package folder
  assert.deepEqual(pm.packageImports(read('packages/packages-lock.json')), {
    'dep-cjs': 'dep-cjs/gpsb.esm.js', 'dep-cjs/': 'dep-cjs/',
    'esm-lib': 'esm-lib/index.js', 'esm-lib/': 'esm-lib/', 'esm-lib/extra': 'esm-lib/extra.js', 'esm-lib/package.json': 'esm-lib/package.json', 'esm-lib/utils/': 'esm-lib/src/utils/',
  });
  // the CommonJS bundle runs as an ES module: relative requires, JSON, the browser field, named exports, a shebang
  const dep = await import(pathToFileURL(path.join(T, 'packages/dep-cjs/gpsb.esm.js')).href);
  assert.equal(dep.default.add(1, 2), 3); assert.equal(dep.add(2, 2), 4); assert.equal(dep.version, '1.0.3'); assert.equal(dep.env, 'browser');
  assert.deepEqual(lock['dep-cjs'].named, ['add', 'env', 'version']);

  r = await pm.add(T, ['umd-lib', '@scope/thing', 'css-only', 'old-lib']);
  lock = read('packages/packages-lock.json').packages;
  const umd = await import(pathToFileURL(path.join(T, 'packages/umd-lib/gpsb.esm.js')).href);
  assert.equal(umd.default.triple(3), 9, 'UMD -> its CommonJS branch -> default export');
  assert.equal(lock['@types/umd-lib'].typesOnly, true, '@types for a package without types'); assert.equal(lock['@types/umd-lib'].version, '3.1.2');
  assert.equal(lock['@scope/thing'].format, 'esm', '"module" field');
  assert.equal(lock['css-only'].format, 'none'); assert.deepEqual(lock['css-only'].imports, { 'css-only/': '' });
  assert.ok(r.warnings.some(w => /old-lib@1\.0\.0 is deprecated: use new-lib/.test(w)));
  assert.equal(r.installed.includes('esm-lib@1.2.0'), false, 'unchanged packages are not downloaded again');

  // types for the IDE: paths to each package's types (or its @types), `any` for the rest
  let b = await cli('types', T);
  assert.equal(b.status, 0, b.stderr);
  const tc = read('.gpsb/tsconfig.json');
  assert.deepEqual(tc.compilerOptions.paths['esm-lib'], ['../packages/esm-lib/index.d.ts']);
  assert.deepEqual(tc.compilerOptions.paths['umd-lib'], ['../packages/@types/umd-lib/index.d.ts']);
  assert.deepEqual(read('tsconfig.json'), { extends: './.gpsb/tsconfig.json' });
  const untyped = fs.readFileSync(path.join(T, '.gpsb/types/packages.d.ts'), 'utf8');
  assert.match(untyped, /declare module "dep-cjs";/); assert.match(untyped, /declare module "@scope\/thing";/); assert.doesNotMatch(untyped, /"esm-lib"|"umd-lib"/);

  // a build: an extension imports packages in Node, a behaviour in the browser through the page's import map
  fs.writeFileSync(path.join(T, 'extensions/Sum.ts'), "import { Extension, defineExtension, html } from '../gpsb/engine.js';\nimport { sum, depVersion } from 'esm-lib';\nimport { up } from 'esm-lib/utils/str.js';\nimport umd from 'umd-lib';\nclass Sum extends Extension { inner() { return html`<b class=\"sum\">${up('s')}${sum(2, 3)} ${depVersion} ${umd.triple(2)}</b>`; } }\nexport default defineExtension(Sum);\n");
  const page = read('pages/index.json');
  page.children.push({ id: 'sum', name: 'Sum', active: true, rect: page.children[0].rect, components: [{ type: 'Sum', props: {} }], children: [] });
  fs.writeFileSync(path.join(T, 'pages/index.json'), JSON.stringify(page));
  b = await cli('build', T);
  assert.equal(b.status, 0, b.stderr + b.stdout);
  assert.doesNotMatch(b.stderr, /MODULE_TYPELESS|ExperimentalWarning/, 'no Node warnings about package files');
  const html = fs.readFileSync(path.join(T, 'dist/index.html'), 'utf8');
  assert.match(html, /<b class="sum">S5 1\.0\.3 6<\/b>/, 'ESM + CommonJS + UMD packages used at build time');
  const map = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)[1]).imports;
  assert.equal(map['esm-lib'], './packages/esm-lib/index.js'); assert.equal(map['@scope/thing'], './packages/@scope/thing/esm.js');
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'the import map comes before module scripts');
  const dist = d => fs.readdirSync(path.join(T, 'dist', d));
  assert.deepEqual(dist('packages').sort(), ['@scope', 'css-only', 'dep-cjs', 'esm-lib', 'old-lib', 'umd-lib'], 'runtime packages only: no @types, manifest or lock');
  assert.ok(!fs.existsSync(path.join(T, 'dist/packages/esm-lib/index.d.ts')), 'no typings published');

  // remove: the package, its now unused dependencies and its @types go; the manifest follows
  r = await pm.remove(T, ['umd-lib']);
  assert.ok(!exists('packages/umd-lib') && !exists('packages/@types/umd-lib') && !exists('packages/@types'));
  assert.deepEqual(r.removed.sort(), ['@types/umd-lib', 'umd-lib']);
  assert.equal(read('packages/manifest.json').dependencies['umd-lib'], undefined);
  await assert.rejects(pm.remove(T, ['nope']), /not in packages\/manifest\.json/);
  fs.writeFileSync(path.join(T, 'extensions/Sum.ts'), fs.readFileSync(path.join(T, 'extensions/Sum.ts'), 'utf8').replace("import umd from 'umd-lib';\n", '').replace(' ${umd.triple(2)}', ''));

  // install: a fresh clone (package folders missing) is restored from the lock, nothing else is downloaded
  fs.rmSync(path.join(T, 'packages/dep-cjs'), { recursive: true });
  assert.deepEqual(await pm.problems(T), ['dep-cjs@1.0.3 is not installed (run gpsb install)']);
  const before = reg.hits('esm-lib');
  r = await pm.install(T);
  assert.deepEqual(r.installed, ['dep-cjs@1.0.3']); assert.equal(reg.hits('esm-lib'), before);
  assert.ok(exists('packages/dep-cjs/gpsb.esm.js')); assert.deepEqual(await pm.problems(T), []);
  // and the build does it on its own
  fs.rmSync(path.join(T, 'packages/esm-lib'), { recursive: true });
  b = await cli('build', T);
  assert.equal(b.status, 0, b.stderr); assert.ok(exists('packages/esm-lib/index.js'));

  // a new release: install keeps the locked version, update takes the newest the ranges allow
  reg.publish('dep-cjs', '1.0.4', PACKAGES['dep-cjs'].versions['1.0.3']);
  await pm.install(T);
  assert.equal(read('packages/packages-lock.json').packages['dep-cjs'].version, '1.0.3');
  r = await pm.update(T);
  assert.equal(read('packages/packages-lock.json').packages['dep-cjs'].version, '1.0.4');
  assert.deepEqual(r.installed, ['dep-cjs@1.0.4']);
  // an explicit version (or dist-tag)
  await pm.add(T, ['esm-lib@1.0.0']);
  assert.equal(read('packages/packages-lock.json').packages['esm-lib'].version, '1.0.0'); assert.equal(read('packages/manifest.json').dependencies['esm-lib'], '1.0.0');
  await pm.add(T, ['esm-lib@next']);
  assert.equal(read('packages/packages-lock.json').packages['esm-lib'].version, '2.0.0-beta.1'); assert.equal(read('packages/manifest.json').dependencies['esm-lib'], '^2.0.0-beta.1');
  await pm.add(T, ['esm-lib@^1']);

  // conflicts: one version per project; the highest requested wins, with a warning
  r = await pm.add(T, ['conf-a']);
  assert.equal(read('packages/packages-lock.json').packages['dep-cjs'].version, '2.0.0');
  assert.ok(r.warnings.some(w => /dep-cjs: no single version satisfies/.test(w)), r.warnings.join('|'));
  await pm.remove(T, ['conf-a']);

  // dependencies of dependencies; a git dependency is skipped with a warning
  r = await pm.add(T, ['chain-a']);
  lock = read('packages/packages-lock.json').packages;
  assert.deepEqual(['chain-a', 'chain-b', 'chain-c'].map(n => lock[n]?.version), ['1.0.0', '1.0.0', '1.1.5']);
  assert.ok(r.warnings.some(w => /chain-b: skipped from-git@github:x\/y/.test(w)), r.warnings.join('|'));
  // CommonJS requiring CommonJS packages, two levels deep, resolved by name in a build (Node, the CLI's hooks)
  fs.writeFileSync(path.join(T, 'extensions/Chain.ts'), "import a from 'chain-a';\nexport default { props: {}, inner: () => `<i class=\"chain\">${a}</i>` };\n");
  const pg = read('pages/index.json');
  pg.children.push({ id: 'chain', name: 'Chain', active: true, rect: pg.children[0].rect, components: [{ type: 'Chain', props: {} }], children: [] });
  fs.writeFileSync(path.join(T, 'pages/index.json'), JSON.stringify(pg));
  b = await cli('build', T);
  assert.equal(b.status, 0, b.stderr);
  assert.match(fs.readFileSync(path.join(T, 'dist/index.html'), 'utf8'), /<i class="chain">3<\/i>/);
  fs.rmSync(path.join(T, 'extensions/Chain.ts'));
  pg.children.pop();
  fs.writeFileSync(path.join(T, 'pages/index.json'), JSON.stringify(pg));
  await pm.remove(T, ['chain-a']);
  assert.ok(!exists('packages/chain-c'), 'unused dependencies are pruned');

  // refused: unknown packages and versions, tarballs escaping their folder, bad hashes. Nothing is left behind.
  const manifest = JSON.stringify(read('packages/manifest.json'));
  await assert.rejects(pm.add(T, ['no-such-package']), /not found/);
  await assert.rejects(pm.add(T, ['esm-lib@^9']), /no version matches "\^9"/);
  await assert.rejects(pm.add(T, ['bad-tar']), /unsafe path in package/);
  await assert.rejects(pm.add(T, ['bad-hash']), /doesn't match its integrity hash/);
  assert.equal(JSON.stringify(read('packages/manifest.json')), manifest);
  assert.ok(!exists('packages/bad-tar') && !exists('packages/bad-hash') && !fs.existsSync(path.join(T, '..', 'escaped.js')));
  assert.ok(!fs.readdirSync(path.join(T, 'packages')).some(f => f.endsWith('.gpsb-tmp')));

  // long tar names (GNU 'L' entries)
  await pm.add(T, ['long-names']);
  assert.equal((await import(pathToFileURL(path.join(T, 'packages/long-names', 'deep/'.repeat(22), 'file.js')).href)).default, 42);

  // CLI + registry search
  b = await cli('packages', '--dir', T);
  assert.equal(b.status, 0, b.stderr); assert.match(b.stdout, /^esm-lib\s+1\.2\.0\s+esm/m); assert.match(b.stdout, /^ {2}dep-cjs\s+1\.0\.4\s+cjs/m);
  b = await cli('remove', 'long-names', '--dir', T);
  assert.equal(b.status, 0, b.stderr); assert.match(b.stdout, /removed long-names/);
  assert.deepEqual((await pm.search(T, 'lib')).map(x => x.name).sort(), ['@types/umd-lib', 'esm-lib', 'old-lib', 'umd-lib']);
  assert.equal((await pm.info(T, 'esm-lib')).latest, '1.2.0');
  assert.deepEqual(await pm.outdated(T), { 'esm-lib': { current: '1.2.0', wanted: '1.2.0', latest: '1.2.0' }, '@scope/thing': { current: '0.1.0', wanted: '0.1.0', latest: '0.1.0' }, 'css-only': { current: '1.0.0', wanted: '1.0.0', latest: '1.0.0' }, 'old-lib': { current: '1.0.0', wanted: '1.0.0', latest: '1.0.0' } });
} finally {
  reg.close();
}
console.log('packages ok');
