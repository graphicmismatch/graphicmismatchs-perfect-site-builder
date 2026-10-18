// Section library, themes and project templates (lib/sections.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SECTIONS, THEMES, TEMPLATES, templateFiles, applyTheme, missingTokens, sectionById } from '../lib/sections.js';
import { renderPage, makeCtx } from '../lib/render.js';
import { componentDef } from '../lib/components.js';
import { walk, newNode } from '../lib/node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokens = applyTheme({}, 'clean');

// every section: known components, only the theme's tokens, unique ids, renders
const ids = new Set();
for (const s of SECTIONS) {
  const n = s.make({ site: 'Test' });
  for (const [x] of walk(n)) {
    assert.ok(!ids.has(x.id), `${s.id}: duplicate id`); ids.add(x.id);
    for (const c of x.components) {
      assert.ok(componentDef(c.type), `${s.id}: unknown component ${c.type}`);
      for (const [k, v] of Object.entries(c.props ?? {})) {
        const type = componentDef(c.type).props[k]?.type;
        if (typeof v === 'string' && /^\$[\w-]+$/.test(v) && (type === 'color' || k === 'font' || k === 'textStyle')) {
          const kind = k === 'textStyle' ? 'textStyles' : k === 'font' ? 'fonts' : 'colors';
          assert.ok(tokens[kind][v.slice(1)], `${s.id}: ${c.type}.${k} uses missing token ${v}`);
        }
        if (k === 'textStyle' && v) assert.ok(tokens.textStyles[v], `${s.id}: text style ${v}`);
      }
    }
  }
  const page = newNode('C', [{ type: 'Canvas', props: {} }, { type: 'VerticalLayoutGroup', props: { controlWidth: true, expandWidth: true } }]);
  page.children.push(n);
  const r = renderPage(page, makeCtx({ tokens }));
  assert.ok(r.body.length > 200 && r.css.includes('--gpsb-color-primary'), s.id);
}
assert.ok(SECTIONS.length >= 15);
assert.match(renderPage(Object.assign(newNode('C', [{ type: 'Canvas', props: {} }]), { children: [sectionById('header').make({ nav: [['A', '#a']] })] }), makeCtx({ tokens })).body, /<header[^>]*>[^]*<nav[^>]*aria-label="Main"/);

// themes
for (const [id, t] of Object.entries(THEMES)) {
  assert.deepEqual(Object.keys(t.tokens.colors).sort(), Object.keys(THEMES.clean.tokens.colors).sort(), id);
  assert.equal(missingTokens(applyTheme({}, id)).length, 0, id);
}
assert.deepEqual(missingTokens({ colors: { primary: '#000' } }).slice(0, 2), ['onPrimary', 'background']);
const mine = { colors: { primary: '#ff0000', brand: '#00ff00' }, textStyles: { h1: { size: 99 } } };
assert.equal(applyTheme(mine, 'bold').colors.primary, THEMES.bold.tokens.colors.primary, 'a theme replaces its own names');
assert.equal(applyTheme(mine, 'bold').colors.brand, '#00ff00', '… and keeps the others');
assert.equal(applyTheme(mine, 'bold', true).colors.primary, '#ff0000', 'onlyMissing keeps existing values');
assert.equal(applyTheme(mine, 'bold', true).textStyles.h1.size, 99);
assert.equal(mine.colors.primary, '#ff0000', 'not modified');

// templates: files, then a real build of each
for (const id of Object.keys(TEMPLATES)) {
  const files = templateFiles(id, 'Site', id === 'blog' ? 'mono' : undefined);
  assert.ok(files['project.json'] && files['pages/index.json'], id);
  const pj = JSON.parse(files['project.json']);
  assert.equal(pj.tokens.colors.primary, THEMES[id === 'blog' ? 'mono' : TEMPLATES[id].theme].tokens.colors.primary, `${id} theme`);
  for (const f of Object.keys(files)) if (f.endsWith('.json')) JSON.parse(files[f]);
}
assert.throws(() => templateFiles('nope'), /unknown template/);
const OUT = path.join(ROOT, '.tmp/sections-test');
fs.rmSync(OUT, { recursive: true, force: true });
for (const id of Object.keys(TEMPLATES)) {
  const dir = path.join(OUT, id);
  const n = spawnSync(process.execPath, ['cli.js', 'new', dir, '--template', id], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(n.status, 0, n.stderr);
  const b = spawnSync(process.execPath, ['cli.js', 'build', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  assert.ok(!fs.existsSync(path.join(dir, 'dist/gpsb/sections.js')), 'sections.js is not shipped');
  const warnings = b.stderr.split('\n').filter(l => l.startsWith('warning') && !/RSS feed needs/.test(l));
  assert.deepEqual(warnings, [], id);
}
const has = f => fs.existsSync(path.join(OUT, f));
assert.ok(has('business/dist/about.html') && has('business/dist/contact.html'));
assert.ok(has('portfolio/dist/project/lumen-coffee.html') && has('portfolio/dist/project/tidal.html'));
assert.ok(has('blog/dist/post/first-post.html') && has('blog/dist/tags/life.html') && has('blog/dist/assets/img/photo-1.svg'));
const blog = fs.readFileSync(path.join(OUT, 'blog/dist/index.html'), 'utf8');
assert.match(blog, /href="post\/notes-from-a-slow-week.html"/);
assert.match(blog, /href="tags\/life.html"/);
const post = fs.readFileSync(path.join(OUT, 'blog/dist/post/how-we-plan-a-project.html'), 'utf8');
assert.match(post, /April 18, 2026/);
assert.match(post, /<h2 id="a-heading">A heading<\/h2>/, 'Markdown body');
assert.match(post, /href="..\/tags\/process.html"/);
assert.match(fs.readFileSync(path.join(OUT, 'landing/dist/index.html'), 'utf8'), /id="pricing"[^]*Simple, honest prices/);
const empty = spawnSync(process.execPath, ['cli.js', 'new', path.join(OUT, 'empty')], { cwd: ROOT, encoding: 'utf8' });
assert.equal(empty.status, 0);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(OUT, 'empty/project.json'), 'utf8')), { name: 'empty' });
console.log('sections ok');
