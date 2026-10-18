// Collections: arrays of items (posts, products, team members) inside JSON assets. Isomorphic: the build publishes them
// (drafts and scheduled items left out, tag pages, RSS), the editor's Content window edits them.
//
// A collection may have a schema next to it: assets/<file>.schema.json
//   { "path": "posts",                      where the array is inside the file ('' = the file is the array)
//     "fields": { "title": { "type": "string", "required": true }, "date": { "type": "date" }, "body": { "type": "markdown" },
//                 "cover": { "type": "image" }, "tags": { "type": "tags" }, "kind": { "type": "enum", "options": ["a", "b"] } },
//     "title": "title",                     field shown in lists and used by the RSS feed (default: title, name, …)
//     "summary": "excerpt", "date": "date", RSS description / date (defaults: description|summary|excerpt, date|publishAt)
//     "draft": "draft", "publishAt": "publishAt",   field names for drafts and scheduled publishing
//     "sort": "-date" }                     order the Content window shows (the file keeps its own order)
// Without one, fields and their types are inferred from the items.

export const SCHEMA_EXT = '.schema.json';
export const FIELD_TYPES = ['string', 'text', 'markdown', 'number', 'bool', 'date', 'datetime', 'image', 'asset', 'url', 'tags', 'enum', 'json'];

const at = (o, p) => String(p ?? '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((v, k) => v?.[k], o);
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
// URL-safe name for a value ("Café Life" -> cafe-life): group (tag) page slugs and the `| slug` binding filter
export const slugify = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

export const schemaFile = file => file.replace(/\.json$/i, SCHEMA_EXT);
export const schemaOf = (json, file) => (isObj(json?.[schemaFile(file)]) ? json[schemaFile(file)] : null);
const names = s => ({ draft: s?.draft || 'draft', publishAt: s?.publishAt || 'publishAt' });

// every collection in the project's JSON assets: [{ file, path, items, schema }]. A schema's path wins; otherwise a file
// that is an array of objects, or each top-level key holding one.
export function findCollections(json) {
  const out = [];
  for (const [file, data] of Object.entries(json ?? {})) {
    if (file.endsWith(SCHEMA_EXT) || data == null) continue;
    const schema = schemaOf(json, file);
    if (schema && typeof schema.path === 'string') {
      const items = schema.path ? at(data, schema.path) : data;
      if (Array.isArray(items)) out.push({ file, path: schema.path, items, schema });
      continue;
    }
    const ok = a => Array.isArray(a) && a.every(isObj);
    if (ok(data) && data.length) out.push({ file, path: '', items: data, schema });
    else if (isObj(data)) for (const [k, v] of Object.entries(data)) if (ok(v) && v.length) out.push({ file, path: k, items: v, schema });
  }
  return out;
}
export const collectionLabel = c => (c.path ? `${c.file} › ${c.path}` : c.file);

// ---------- fields ----------
const IMG = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/, DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export function inferType(name, values) {
  const vs = values.filter(v => v !== undefined && v !== null && v !== '');
  if (!vs.length) return /^(draft|published|featured|hidden)$/.test(name) ? 'bool' : /date|At$/.test(name) ? 'date' : 'string';
  if (vs.every(v => typeof v === 'boolean')) return 'bool';
  if (vs.every(v => typeof v === 'number')) return 'number';
  if (vs.every(v => Array.isArray(v) && v.every(x => typeof x === 'string'))) return 'tags';
  if (!vs.every(v => typeof v === 'string')) return 'json';
  if (vs.every(v => DATE.test(v))) return 'date';
  if (vs.every(v => DATETIME.test(v))) return 'datetime';
  if (vs.every(v => IMG.test(v) && !/^https?:/.test(v))) return 'image';
  if (vs.every(v => /^(https?:|mailto:)/.test(v))) return 'url';
  if (/^(body|content|text|markdown)$/i.test(name) || vs.some(v => v.includes('\n') || v.length > 160)) return 'markdown';
  return 'string';
}
// [{ name, type, label?, help?, options?, required? }]: the schema's fields first, then any other field the items use
export function fieldsOf(items, schema) {
  const out = [], seen = new Set();
  for (const [name, f] of Object.entries(schema?.fields ?? {})) {
    seen.add(name);
    out.push({ ...f, name, type: FIELD_TYPES.includes(f?.type) ? f.type : 'string' });
  }
  const n = names(schema), more = [];
  for (const it of items) if (isObj(it)) for (const k of Object.keys(it)) if (!seen.has(k)) { seen.add(k); more.push(k); }
  for (const name of more) if (name !== n.draft && name !== n.publishAt) out.push({ name, type: inferType(name, items.map(i => i?.[name])) });
  return out;
}
// a schema written from what the items hold (the Content window's "Create Schema")
export const inferSchema = (c) => ({ path: c.path, fields: Object.fromEntries(fieldsOf(c.items, null).map(f => [f.name, { type: f.type }])) });

export function titleOf(item, schema) {
  if (!isObj(item)) return String(item ?? '');
  const k = schema?.title ?? ['title', 'name', 'heading', 'label', 'slug'].find(x => typeof item[x] === 'string' && item[x]);
  const v = k ? item[k] : Object.values(item).find(x => typeof x === 'string' && x && x.length < 120);
  return v == null || v === '' ? '(untitled)' : String(v);
}

// ---------- publishing: drafts and scheduled items ----------
// 'draft' | 'scheduled' | 'published'
export function statusOf(item, schema, now = Date.now()) {
  if (!isObj(item)) return 'published';
  const n = names(schema);
  if (item[n.draft] === true) return 'draft';
  const t = item[n.publishAt] ? Date.parse(item[n.publishAt]) : NaN;
  return t > now ? 'scheduled' : 'published';
}
// What the published site sees: every JSON asset with draft and not-yet-due items taken out of its arrays (at any
// depth; per file, the schema's field names). Unchanged files are returned as they are.
export function publishedJSON(json, now = Date.now()) {
  const out = {};
  for (const [file, data] of Object.entries(json ?? {})) {
    const schema = schemaOf(json, file), hide = it => statusOf(it, schema, now) !== 'published';
    const walk = v => {
      if (Array.isArray(v)) {
        const kept = v.filter(x => !hide(x)).map(walk);
        return kept.length !== v.length || kept.some((x, i) => x !== v[i]) ? kept : v;
      }
      if (isObj(v)) {
        let c = false;
        const o = Object.fromEntries(Object.entries(v).map(([k, x]) => { const y = walk(x); if (y !== x) c = true; return [k, y]; }));
        return c ? o : v;
      }
      return v;
    };
    out[file] = file.endsWith(SCHEMA_EXT) ? data : walk(data);
  }
  return out;
}

// ---------- lists ----------
// sort by fields: "date", "-date" (descending), "category,-date"; numbers, dates and text compare naturally
export function sortItems(items, spec) {
  const keys = String(spec ?? '').split(',').map(s => s.trim()).filter(Boolean).map(s => (s[0] === '-' ? [s.slice(1), -1] : [s.replace(/^\+/, ''), 1]));
  if (!keys.length) return items;
  const empty = v => v == null || v === '';
  const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
  return [...items].sort((x, y) => {
    for (const [k, d] of keys) {
      const a = at(x, k), b = at(y, k);
      if (empty(a) || empty(b)) { if (empty(a) !== empty(b)) return empty(a) ? 1 : -1; continue; } // empty values last either way
      const r = cmp(a, b);
      if (r) return r * d;
    }
    return 0;
  });
}
// group items by a field (an array field puts an item in each of its groups):
// [{ name, slug, count, items }] in alphabetical order. Tag pages and tag clouds.
export function groupItems(items, field) {
  const groups = new Map();
  for (const it of items) {
    for (const v of [at(it, field)].flat()) {
      if (v == null || v === '') continue;
      const name = String(v), key = slugify(name);
      if (!groups.has(key)) groups.set(key, { name, slug: key, count: 0, items: [] });
      const g = groups.get(key); g.count++; g.items.push(it);
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

// ---------- RSS ----------
const xml = s => String(s ?? '').replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);
const rfc822 = d => { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toUTCString() : ''; };
// RSS 2.0. channel: { title, link, description, language, self }; items: [{ title, link, description, date, categories }]
export function rssFeed(channel, items) {
  const it = items.map(i => [
    '    <item>',
    `      <title>${xml(i.title)}</title>`,
    `      <link>${xml(i.link)}</link>`,
    `      <guid isPermaLink="true">${xml(i.link)}</guid>`,
    i.description && `      <description>${xml(i.description)}</description>`,
    rfc822(i.date) && `      <pubDate>${rfc822(i.date)}</pubDate>`,
    ...(i.categories ?? []).map(c => `      <category>${xml(c)}</category>`),
    '    </item>'].filter(Boolean).join('\n'));
  const newest = items.map(i => Date.parse(i.date)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(channel.title)}</title>
    <link>${xml(channel.link)}</link>
    <description>${xml(channel.description || channel.title)}</description>
${channel.language ? `    <language>${xml(channel.language)}</language>\n` : ''}${channel.self ? `    <atom:link href="${xml(channel.self)}" rel="self" type="application/rss+xml"/>\n` : ''}${newest ? `    <lastBuildDate>${new Date(newest).toUTCString()}</lastBuildDate>\n` : ''}${it.join('\n')}${it.length ? '\n' : ''}  </channel>
</rss>
`;
}
// the feed fields of an item (schema names, else the usual ones)
export function feedFields(item, schema) {
  const pick = (k, alts) => (k ? at(item, k) : alts.map(a => item?.[a]).find(v => v != null && v !== ''));
  return {
    title: titleOf(item, schema),
    description: pick(schema?.summary, ['description', 'summary', 'excerpt']) ?? '',
    date: pick(schema?.date, ['date', 'publishAt', 'published', 'created']) ?? '',
    categories: [pick(null, ['tags', 'categories', 'category']) ?? []].flat().filter(x => typeof x === 'string'),
  };
}
