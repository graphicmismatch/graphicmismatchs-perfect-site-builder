// Collections: lib/content.js, binding filters, Repeat sort/group/paging, and a built blog (drafts, tag pages, pages, RSS).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findCollections, fieldsOf, inferType, statusOf, publishedJSON, sortItems, groupItems, slugify, titleOf, rssFeed, feedFields, inferSchema } from '../lib/content.js';
import { bind, makeCtx, repeatItems, collectionItems, pageCount } from '../lib/render.js';
import { newNode } from '../lib/node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- content.js ----------
const posts = [
  { title: 'B', date: '2024-02-01', tags: ['JS', 'Café'], draft: true },
  { title: 'A', date: '2024-03-01', tags: ['js'], cover: 'img/a.png', body: 'x\ny' },
  { title: 'C', tags: [], publishAt: '2999-01-01T00:00:00Z' },
];
const json = { 'data/p.json': { posts, site: { name: 'x' } }, 'data/team.json': [{ name: 'Ann' }], 'data/p.schema.json': { path: 'posts', fields: { title: { type: 'string' } } }, 'data/empty.json': { list: [] } };
assert.deepEqual(findCollections(json).map(c => [c.file, c.path, c.items.length, !!c.schema]), [['data/p.json', 'posts', 3, true], ['data/team.json', '', 1, false]]);
assert.deepEqual(fieldsOf(posts, json['data/p.schema.json']).map(f => `${f.name}:${f.type}`), ['title:string', 'date:date', 'tags:tags', 'cover:image', 'body:markdown']);
assert.equal(inferType('x', [1, 2]), 'number');
assert.equal(inferType('x', [true]), 'bool');
assert.equal(inferType('when', ['2024-01-01T10:00']), 'datetime');
assert.equal(inferType('link', ['https://a.b']), 'url');
assert.equal(inferType('meta', [{ a: 1 }]), 'json');
assert.equal(inferType('draft', []), 'bool');
assert.deepEqual(inferSchema({ path: 'posts', items: posts }).fields.date, { type: 'date' });
assert.deepEqual(posts.map(p => statusOf(p, null)), ['draft', 'published', 'scheduled']);
assert.equal(statusOf({ hidden: true }, { draft: 'hidden' }), 'draft', 'schema field names');
const pub = publishedJSON(json);
assert.deepEqual(pub['data/p.json'].posts.map(p => p.title), ['A']);
assert.equal(pub['data/team.json'], json['data/team.json'], 'unchanged files are the same object');
assert.equal(pub['data/p.json'].site, json['data/p.json'].site);
assert.equal(json['data/p.json'].posts.length, 3, 'the source is not modified');
assert.deepEqual(sortItems(posts, '-date').map(p => p.title), ['A', 'B', 'C'], 'empty last, descending');
assert.deepEqual(sortItems(posts, 'date').map(p => p.title), ['B', 'A', 'C'], 'empty last, ascending');
assert.deepEqual(sortItems([{ n: 'item 10' }, { n: 'item 9' }], 'n').map(x => x.n), ['item 9', 'item 10'], 'natural order');
assert.deepEqual(groupItems(posts, 'tags').map(g => `${g.name}/${g.slug}/${g.count}`), ['Café/cafe/1', 'JS/js/2']);
assert.equal(slugify('Café Life & C++'), 'cafe-life-c');
assert.equal(titleOf({ name: 'Ann' }), 'Ann');
assert.equal(titleOf({ x: '' }), '(untitled)');
const rss = rssFeed({ title: 'T & co', link: 'https://x/', self: 'https://x/f.xml' }, [{ title: '<A>', link: 'https://x/a', date: '2024-03-01', description: 'd', categories: ['js'] }]);
assert.match(rss, /<title>T &#38; co<\/title>/);
assert.match(rss, /<title>&#60;A&#62;<\/title>\n\s+<link>https:\/\/x\/a<\/link>/);
assert.match(rss, /<pubDate>Fri, 01 Mar 2024 00:00:00 GMT<\/pubDate>/);
assert.deepEqual(feedFields({ title: 'A', summary: 's', date: 'd', tags: ['x'] }), { title: 'A', description: 's', date: 'd', categories: ['x'] });

// ---------- binding filters ----------
const ctx = makeCtx({ json: { 'p.json': { posts } } });
const sc = { item: { title: 'Café Life', date: '2024-03-01', tags: ['a', 'b'], n: '' } };
assert.equal(bind('{{item.title | slug}}', ctx, sc), 'cafe-life');
assert.equal(bind('{{item.title | upper}} {{item.tags | length}}', ctx, sc), 'CAFÉ LIFE 2');
assert.equal(bind('{{item.date | date}}', ctx, sc), 'March 1, 2024');
assert.equal(bind('{{item.date | date: short}}', { ...ctx, lang: 'de' }, sc), '01.03.24');
assert.equal(bind('{{item.tags | join: " / "}}', ctx, sc), 'a / b');
assert.equal(bind('{{item.tags | first | upper}}', ctx, sc), 'A');
assert.equal(bind('{{item.n | default: none}} {{item.missing | default: -}}', ctx, sc), 'none -');
assert.equal(bind('{{item.title | nope}} {{item.missing | upper}}', ctx, sc), '{{item.title | nope}} {{item.missing | upper}}', 'unknown / unresolved stay as written');
assert.equal(bind('{{p.json:posts[1].title | lower}}', ctx), 'a');

// ---------- Repeat: sort, group, paging ----------
const rp = { source: 'p.json', path: 'posts', sortBy: '-date', groupBy: '', limit: 0, pageSize: 2 };
assert.deepEqual(repeatItems(rp, ctx, null).map(p => p.title), ['A', 'B']);
assert.deepEqual(repeatItems(rp, ctx, { pagination: { page: 2 } }).map(p => p.title), ['C']);
assert.deepEqual(repeatItems({ ...rp, pageSize: 0, groupBy: 'tags' }, ctx, null).map(g => g.slug), ['cafe', 'js']);
const page = newNode('C', [{ type: 'Canvas', props: {} }]);
page.children.push(newNode('L', [{ type: 'Repeat', props: rp }]));
assert.equal(pageCount(page, ctx), 2);
const tpl = newNode('T', [{ type: 'Canvas', props: { collection: 'p.json', collectionPath: 'posts', groupBy: 'tags' } }]);
assert.deepEqual(collectionItems(tpl, ctx).map(x => [x.slug, x.item.count]), [['cafe', 1], ['js', 2]]);

// ---------- a built blog: test/fixtures/blog ----------
const OUT = path.join(ROOT, '.tmp/content-blog');
fs.rmSync(OUT, { recursive: true, force: true });
const b = spawnSync(process.execPath, ['cli.js', 'build', 'test/fixtures/blog', '--out', OUT], { cwd: ROOT, encoding: 'utf8' });
assert.equal(b.status, 0, b.stderr);
const read = f => fs.readFileSync(path.join(OUT, f), 'utf8'), text = f => read(f).replace(/<script[^]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const has = f => fs.existsSync(path.join(OUT, f));
assert.ok(has('post/rivers.html') && !has('post/secret.html') && !has('post/future.html'), 'drafts and scheduled posts are not published');
assert.ok(has('tags/travel.html') && has('tags/travel/2.html') && has('tags/cafe-life.html') && has('blog/2.html') && !has('blog/3.html'));
assert.match(text('blog.html'), /Rivers · April 12, 2026 Mountains · March 1, 2026 ← Previous 1 2 Next →/);
assert.match(text('blog/2.html'), /Café mornings · February 10, 2026 First light · January 5, 2026/);
assert.match(read('blog/2.html'), /<a class="gpsb-pg-prev" href="..\/blog.html">← Previous<\/a><a class="gpsb-pg-n" href="..\/blog.html">1<\/a><a class="gpsb-pg-n" href="..\/blog\/2.html" aria-current="page">2<\/a><span class="gpsb-pg-next" aria-disabled="true">/);
assert.match(text('blog.html'), /Café Life \(1\) Photography \(2\) Travel \(3\)/, 'tag cloud: drafts not counted');
assert.match(read('post/rivers.html'), /href="..\/tags\/travel.html"[^]*href="..\/tags\/photography.html"/);
assert.match(text('post/rivers.html'), /Apr 12, 2026 · Travel\/Photography/);
assert.match(text('tags/travel.html'), /Travel: 3 posts Rivers Mountains/);
assert.match(text('tags/travel/2.html'), /First light/);
const feed = read('post/feed.xml');
assert.deepEqual([...feed.matchAll(/<item>\s*<title>([^<]+)/g)].map(m => m[1]), ['Rivers', 'Mountains', 'Café mornings', 'First light']);
assert.match(read('index.html'), /<link rel="alternate" type="application\/rss\+xml" title="Field Notes" href="post\/feed.xml">/);
assert.match(read('sitemap.xml'), /blog\/2.html[^]*tags\/travel\/2.html/);
const clean = spawnSync(process.execPath, ['-e', `
  const { build } = await import('./cli.js');
  const fs = await import('node:fs');
  fs.cpSync('test/fixtures/blog', '.tmp/content-clean', { recursive: true });
  fs.writeFileSync('.tmp/content-clean/project.json', JSON.stringify({ name: 'x', siteUrl: 'https://x.example/', cleanUrls: true }));
  await build('.tmp/content-clean', '.tmp/content-clean-out');`], { cwd: ROOT, encoding: 'utf8', input: '' });
assert.equal(clean.status, 0, clean.stderr);
const c2 = fs.readFileSync(path.join(ROOT, '.tmp/content-clean-out/blog/2/index.html'), 'utf8');
assert.match(c2, /<a class="gpsb-pg-prev" href="..\/..\/blog\/">/, 'clean URLs');
assert.ok(fs.existsSync(path.join(ROOT, '.tmp/content-clean-out/tags/travel/2/index.html')));
fs.rmSync(path.join(ROOT, '.tmp/content-clean'), { recursive: true, force: true });
console.log('content ok');
