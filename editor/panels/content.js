// Content: edit the items of the project's collections (lists of objects in JSON assets: posts, products, team) as a
// list and a form, like a CMS. Changes are undoable, saved with the project, and show in the Scene at once.
// Fields come from <file>.schema.json or are inferred (lib/content.js); drafts and publish dates control what's built.
import * as S from '../state.js';
import { h, menu, pickAsset, nice, accept } from '../fields.js';
import { translationFile, translationOf } from '/lib/i18n.js';
import { findCollections, collectionLabel, fieldsOf, titleOf, statusOf, slugify, sortItems, schemaFile, inferSchema, FIELD_TYPES } from '/lib/content.js';

const keyOf = c => `${c.file}|${c.path}`;
const itemsIn = (data, p) => (p ? p.split('.').reduce((v, k) => v?.[k], data) : data);
const today = () => new Date().toISOString().slice(0, 10);
const store = (k, v) => { try { localStorage['gpsbContent' + k] = v; } catch { /* private mode */ } };
const stored = k => { try { return localStorage['gpsbContent' + k] ?? ''; } catch { return ''; } };
const STATUS = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' };

export function mount(el) {
  el.classList.add('cnt');
  const sel = h('select', { class: 'cnt-col', title: 'Collection' });
  const q = h('input', { class: 'cnt-q', type: 'search', placeholder: 'Search', spellcheck: 'false' });
  const add = h('button', { class: 'cnt-btn', title: 'Add an item' }, '+ New');
  const more = h('button', { class: 'cnt-btn', title: 'More' }, '⋯');
  const list = h('div', { class: 'cnt-list', tabindex: '0' }), form = h('div', { class: 'cnt-form' });
  el.append(h('div', { class: 'cnt-bar' }, sel, q, add, h('span', { class: 'cnt-grow' }), more), h('div', { class: 'cnt-main' }, list, form));

  let curKey = stored('Col'), cur = -1, formSig = '', widgets = [];
  const cols = () => (S.S.P ? findCollections(S.S.P.json) : []);
  const col = () => cols().find(c => keyOf(c) === curKey) ?? null;
  const fields = c => fieldsOf(c.items, c.schema);
  const titleField = c => c.schema?.title ?? ['title', 'name', 'heading', 'label'].find(k => c.items.some(i => typeof i?.[k] === 'string')) ?? null;
  const change = (c, label, fn, opts) => S.editContent(c.file, label, data => fn(itemsIn(data, c.path)), opts);
  // the template page showing this collection's items (Preview)
  const pageOf = c => Object.keys(S.S.P.pages).find(n => { const p = S.getComponent(S.S.P.pages[n], 'Canvas')?.props; return p?.collection === c.file && (p.collectionPath ?? '') === c.path && !p.groupBy; });

  // ---------- list ----------
  function order(c) {
    const idx = c.items.map((_, i) => i);
    if (!c.schema?.sort) return idx;
    const sorted = sortItems(c.items.map((it, i) => ({ it, i, ...it })), c.schema.sort);
    return sorted.map(x => x.i);
  }
  function draw(force = false) {
    const all = cols();
    if (!all.some(c => keyOf(c) === curKey)) curKey = all[0] ? keyOf(all[0]) : '';
    sel.replaceChildren(...all.map(c => h('option', { value: keyOf(c) }, `${collectionLabel(c)} (${c.items.length})`)));
    sel.value = curKey;
    const c = col();
    add.disabled = !c;
    if (!c) {
      list.replaceChildren(h('div', { class: 'cnt-empty' },
        h('p', {}, 'No collections yet. A collection is a list of items (blog posts, products, team members) in a JSON file in your assets.'),
        h('button', { class: 'btn', onclick: newCollection }, 'New Collection…')));
      form.replaceChildren();
      formSig = '';
      return;
    }
    if (cur >= c.items.length) cur = c.items.length - 1;
    const s = q.value.trim().toLowerCase(), d = c.schema?.date ?? (fields(c).find(f => f.type === 'date' || f.type === 'datetime')?.name);
    list.replaceChildren(...order(c).filter(i => !s || JSON.stringify(c.items[i]).toLowerCase().includes(s)).map(i => {
      const it = c.items[i], st = statusOf(it, c.schema);
      return h('div', { class: 'cnt-row' + (i === cur ? ' sel' : ''), 'data-i': i, onclick: () => pick(i), oncontextmenu: e => { e.preventDefault(); pick(i); menu(itemMenu(c, i), e.clientX, e.clientY); } },
        h('span', { class: `cnt-st ${st}`, title: STATUS[st] }),
        h('span', { class: 'cnt-t' }, titleOf(it, c.schema)),
        d && it?.[d] ? h('span', { class: 'cnt-d' }, String(it[d]).slice(0, 10)) : null);
    }));
    if (!list.childElementCount) list.append(h('div', { class: 'cnt-empty' }, s ? 'Nothing matches.' : 'No items yet: + New adds one.'));
    drawForm(c, force);
  }
  const pick = i => { cur = i; draw(); };

  // ---------- form ----------
  function drawForm(c, force) {
    const it = c.items[cur];
    if (!it || typeof it !== 'object') { form.replaceChildren(h('div', { class: 'cnt-empty' }, c.items.length ? 'Select an item.' : '')); formSig = ''; return; }
    const fs = fields(c), sig = `${curKey}|${cur}|${fs.map(f => f.name + f.type).join()}`;
    if (sig === formSig) { for (const w of widgets) w.update(force); return drawStatus(c); } // same item: refresh values (not the one being typed in)
    formSig = sig;
    widgets = fs.map(f => fieldWidget(c, f));
    const page = pageOf(c);
    form.replaceChildren(
      h('div', { class: 'cnt-head' },
        h('b', { class: 'cnt-title' }), h('span', { class: 'cnt-grow' }),
        page ? h('button', { class: 'cnt-btn', title: `Show it in the Scene (page ${page})`, onclick: () => preview(c) }, 'Preview') : null,
        h('button', { class: 'cnt-btn', title: 'Move up (Alt+↑)', onclick: () => move(c, cur, -1) }, '↑'),
        h('button', { class: 'cnt-btn', title: 'Move down (Alt+↓)', onclick: () => move(c, cur, 1) }, '↓'),
        h('button', { class: 'cnt-btn', onclick: () => duplicate(c, cur) }, 'Duplicate'),
        h('button', { class: 'cnt-btn danger', onclick: () => remove(c, cur) }, 'Delete')),
      h('div', { class: 'cnt-status' }),
      ...widgets.map(w => w.row),
      addFieldRow(c));
    for (const w of widgets) w.update();
    drawStatus(c);
  }
  function drawStatus(c) {
    const box = form.querySelector('.cnt-status'), it = c.items[cur];
    if (!box || !it) return;
    form.querySelector('.cnt-title').textContent = titleOf(it, c.schema);
    const dk = c.schema?.draft || 'draft', pk = c.schema?.publishAt || 'publishAt', st = statusOf(it, c.schema);
    const draft = h('input', { type: 'checkbox' }), when = h('input', { type: 'datetime-local', class: 'cnt-in' });
    draft.checked = it[dk] === true;
    when.value = it[pk] ? String(it[pk]).slice(0, 16) : '';
    draft.onchange = () => change(c, 'Set draft', items => { if (draft.checked) items[cur][dk] = true; else delete items[cur][dk]; });
    when.onchange = () => change(c, 'Set publish date', items => { if (when.value) items[cur][pk] = when.value; else delete items[cur][pk]; });
    const say = { draft: 'Draft: not on the published site.', scheduled: `Scheduled: on the site in the first build after ${String(it[pk]).replace('T', ' ')}.`, published: 'On the published site.' }[st];
    box.className = `cnt-status ${st}`;
    box.replaceChildren(h('span', { class: `cnt-st ${st}` }), h('span', { class: 'cnt-say' }, say), h('span', { class: 'cnt-grow' }),
      h('label', {}, draft, ' Draft'), h('label', {}, 'Publish at ', when));
  }
  // one field: label + input by type
  function fieldWidget(c, f) {
    const get = () => col()?.items[cur]?.[f.name];
    const set = (v, merge = true) => {
      const c2 = col(), tk = titleField(c2), it = c2.items[cur];
      // a slug that followed the title keeps following it
      const follow = f.name === tk && typeof it?.slug === 'string' && it.slug === slugify(it[tk] ?? '') && typeof v === 'string';
      change(c2, `Edit ${f.name} of item ${cur + 1}`, items => {
        if (v === undefined) delete items[cur][f.name]; else items[cur][f.name] = v; // '' stays: the field keeps its place
        if (follow) items[cur].slug = slugify(v);
      }, { merge });
    };
    let input, update;
    const t = f.type;
    if (t === 'bool') {
      input = h('input', { type: 'checkbox' });
      input.onchange = () => set(input.checked, false);
      update = () => { input.checked = get() === true; };
    } else if (t === 'enum') {
      input = h('select', { class: 'cnt-in' }, h('option', { value: '' }, '—'), ...(f.options ?? []).map(o => h('option', { value: o }, o)));
      input.onchange = () => set(input.value, false);
      update = () => { input.value = get() ?? ''; };
    } else if (t === 'tags') {
      input = h('input', { class: 'cnt-in', placeholder: 'comma, separated' });
      input.oninput = () => set(input.value.split(',').map(x => x.trim()).filter(Boolean));
      update = () => { const v = [get() ?? []].flat().join(', '); if (input.value.split(',').map(x => x.trim()).filter(Boolean).join(', ') !== v) input.value = v; };
    } else if (t === 'json') {
      input = h('textarea', { class: 'cnt-in mono', rows: 4, spellcheck: 'false' });
      input.oninput = () => { try { const v = JSON.parse(input.value || 'null'); input.classList.remove('bad'); set(v ?? undefined); } catch { input.classList.add('bad'); } };
      update = () => { if (!input.classList.contains('bad')) input.value = get() === undefined ? '' : JSON.stringify(get(), null, 2); };
    } else if (t === 'text' || t === 'markdown') {
      input = h('textarea', { class: 'cnt-in' + (t === 'markdown' ? ' mono' : ''), rows: t === 'markdown' ? 10 : 3, spellcheck: 'true' });
      input.oninput = () => set(input.value);
      update = () => { input.value = get() ?? ''; };
    } else if (t === 'number') {
      input = h('input', { class: 'cnt-in', type: 'number', step: 'any' });
      input.oninput = () => set(input.value === '' ? undefined : +input.value);
      update = () => { input.value = get() ?? ''; };
    } else {
      input = h('input', { class: 'cnt-in', type: t === 'date' ? 'date' : t === 'datetime' ? 'datetime-local' : t === 'url' ? 'url' : 'text', spellcheck: t === 'string' ? 'true' : 'false' });
      input.oninput = () => set(input.value, t !== 'date' && t !== 'datetime');
      update = () => { input.value = t === 'datetime' ? String(get() ?? '').slice(0, 16) : get() ?? ''; };
    }
    const upd = force => { if (force || document.activeElement !== input) update(); };
    let ctl = input;
    if (t === 'image' || t === 'asset') { // asset path: pick or drop from the Project panel
      const kind = t === 'image' ? 'image' : 'any', img = t === 'image' ? h('img', { class: 'cnt-thumb', alt: '' }) : null;
      const pickB = h('button', { class: 'cnt-btn', onclick: () => pickAsset(kind, get() ?? '', v => set(v, false), pickB) }, 'Pick…');
      accept(input, 'application/x-gpsb-asset', v => set(v, false));
      const u0 = upd;
      ctl = h('div', { class: 'cnt-asset' }, img, input, pickB);
      return { row: row(f, ctl), update: force => { u0(force); if (img) { const v = get(); img.src = v ? S.assetUrl(v) : ''; img.hidden = !v; } } };
    }
    return { row: row(f, ctl), update: upd };
  }
  const row = (f, ctl) => h('label', { class: 'cnt-field' + (f.type === 'bool' ? ' inline' : '') },
    h('span', { class: 'cnt-lab', title: `${f.name}: ${f.type}${f.help ? ` — ${f.help}` : ''}` }, f.label ?? nice(f.name), f.required ? h('i', {}, ' *') : null), ctl);
  function addFieldRow(c) {
    const name = h('input', { class: 'cnt-in', placeholder: 'new field name', spellcheck: 'false' });
    const type = h('select', { class: 'cnt-in' }, ...FIELD_TYPES.map(t => h('option', { value: t }, t)));
    const go = () => {
      const n = name.value.trim();
      if (!/^[A-Za-z_][\w-]*$/.test(n)) return S.log('A field name starts with a letter and has letters, digits, - and _', 'warn');
      const empty = { bool: false, number: 0, tags: [], json: null }[type.value] ?? '';
      change(c, `Add field ${n}`, items => { items[cur][n] ??= empty === '' ? `New ${n}` : empty; });
      name.value = '';
    };
    name.onkeydown = e => { if (e.key === 'Enter') go(); };
    return h('div', { class: 'cnt-addf' }, name, type, h('button', { class: 'cnt-btn', onclick: go }, 'Add Field'));
  }

  // ---------- item actions ----------
  function newItem(c) {
    const fs = fields(c), tk = titleField(c) ?? 'title', it = {};
    const n = c.items.length + 1;
    it[tk] = `New item ${n}`;
    if (fs.some(f => f.name === 'slug') || pageOf(c)) it.slug = slugify(it[tk]);
    for (const f of fs) if ((f.type === 'date') && !(f.name in it)) it[f.name] = today();
    change(c, 'New item', items => { items.push(it); });
    cur = col().items.length - 1;
    draw();
    form.querySelector('.cnt-in')?.focus();
    form.querySelector('.cnt-in')?.select?.();
  }
  function duplicate(c, i) {
    const copy = structuredClone(c.items[i]), tk = titleField(c);
    if (tk && typeof copy[tk] === 'string') copy[tk] += ' (copy)';
    if (typeof copy.slug === 'string') { const used = new Set(c.items.map(x => x?.slug)); let s = copy.slug + '-copy', k = 2; while (used.has(s)) s = `${copy.slug}-copy-${k++}`; copy.slug = s; }
    change(c, 'Duplicate item', items => { items.splice(i + 1, 0, copy); });
    cur = i + 1; draw();
  }
  function remove(c, i) { change(c, 'Delete item', items => { items.splice(i, 1); }); draw(); }
  function move(c, i, d) {
    const j = i + d;
    if (j < 0 || j >= c.items.length) return;
    if (c.schema?.sort) return S.log(`This collection is shown sorted by "${c.schema.sort}" (its schema): the order in the file doesn't show here`, 'warn');
    change(c, 'Move item', items => { const [x] = items.splice(i, 1); items.splice(j, 0, x); });
    cur = j; draw();
  }
  function preview(c) {
    const page = pageOf(c), item = c.items[cur];
    if (!page) return;
    if (S.S.page !== page) S.setPage(page);
    const i = S.pageItems()?.findIndex(x => x.item === item) ?? -1;
    if (i >= 0) S.setCollectionItem(i);
    S.emit('show-tab', 'scene');
  }
  const itemMenu = (c, i) => [
    { label: 'Duplicate', action: () => duplicate(c, i) },
    { label: 'Delete', action: () => remove(c, i) },
    '-',
    { label: 'Move Up', action: () => move(c, i, -1), disabled: i === 0 },
    { label: 'Move Down', action: () => move(c, i, 1), disabled: i === c.items.length - 1 },
    pageOf(c) && '-', pageOf(c) && { label: 'Preview', action: () => preview(c) },
  ];

  // ---------- collections ----------
  async function newCollection() {
    const name = prompt('Name of the new collection (e.g. posts, products, team):')?.trim();
    if (!name) return;
    const file = `data/${slugify(name)}.json`;
    if (S.S.P.json[file] !== undefined) return S.log(`assets/${file} exists`, 'warn');
    const body = { [slugify(name).replace(/-/g, '_')]: [{ title: 'First item', slug: 'first-item', date: today() }] };
    try { await S.api.put(`assets/${file}`, JSON.stringify(body, null, 2)); await S.reloadMeta(); }
    catch (e) { return S.log(`Could not create assets/${file}: ${e.message}`, 'error'); }
    curKey = `${file}|${Object.keys(body)[0]}`; store('Col', curKey); cur = 0;
    S.log(`Created the collection assets/${file}. Make a page show it: Canvas ▸ Collection.`);
    draw();
  }
  async function createSchema(c) {
    const f = schemaFile(c.file);
    try { await S.api.put(`assets/${f}`, JSON.stringify(inferSchema(c), null, 2) + '\n'); await S.reloadMeta(); S.log(`Wrote assets/${f}: edit it to change field types, labels and order`); }
    catch (e) { S.log(`Could not write assets/${f}: ${e.message}`, 'error'); }
  }
  // a copy of the file as <name>.<code>.json: the pages in that language read it instead (lib/i18n.js)
  async function translate(c, l) {
    const f = translationFile(c.file, l.code);
    try { await S.api.put(`assets/${f}`, JSON.stringify(S.S.P.json[c.file], null, 2) + '\n'); await S.reloadMeta(); }
    catch (e) { return S.log(`Could not create assets/${f}: ${e.message}`, 'error'); }
    S.log(`Created assets/${f}: translate its items here; the ${l.name} pages use it`);
    showFile(f, c.path);
  }
  const showFile = (f, p) => { curKey = `${f}|${p}`; store('Col', curKey); cur = 0; formSig = ''; draw(); };
  more.onclick = () => {
    const c = col(), r = more.getBoundingClientRect(), page = c && pageOf(c);
    menu([
      { label: 'New Collection…', action: newCollection },
      c && !c.schema && { label: 'Create Schema File', action: () => createSchema(c) },
      page && { label: `Open Template Page (${page})`, action: () => S.setPage(page) },
      ...(c && !translationOf(c.file, S.languages().map(l => l.code)) ? S.languages().slice(1).map(l => {
        const f = translationFile(c.file, l.code), has = S.S.P.json[f] !== undefined;
        return { label: has ? `Edit the ${l.name} version` : `Translate into ${l.name}…`, action: () => (has ? showFile(f, c.path) : translate(c, l)) };
      }) : []),
    ], r.left, r.bottom);
  };

  sel.onchange = () => { curKey = sel.value; store('Col', curKey); cur = 0; formSig = ''; draw(); };
  q.oninput = () => draw();
  add.onclick = () => col() && newItem(col());
  list.addEventListener('keydown', e => {
    const c = col();
    if (!c) return;
    const vis = [...list.querySelectorAll('.cnt-row')].map(r => +r.dataset.i), k = vis.indexOf(cur);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) move(c, cur, e.key === 'ArrowDown' ? 1 : -1);
    else if (e.key === 'ArrowDown' && k < vis.length - 1) pick(vis[k + 1]);
    else if (e.key === 'ArrowUp' && k > 0) pick(vis[k - 1]);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && cur >= 0) remove(c, cur);
    else if ((e.ctrlKey || e.metaKey) && e.key === 'd' && cur >= 0) duplicate(c, cur);
    else return;
    e.preventDefault(); e.stopPropagation();
    list.querySelector('.cnt-row.sel')?.scrollIntoView({ block: 'nearest' });
  });
  S.on('content', how => draw(how === 'undo'));
  for (const ev of ['load', 'assets']) S.on(ev, () => draw());
  if (S.S.P) draw();
}
