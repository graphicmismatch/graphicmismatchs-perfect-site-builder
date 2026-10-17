// Hierarchy: page (scene) tree with selection, drag & drop reparenting, inline rename, copy/paste, asset drops.
import * as S from '../state.js';
import { menu, menuAt, createItems, newPagePrompt, deletePage, buildSite, prefabItems } from './toolbar.js';
import { shortcut as sc } from '../preferences.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const svg = (d, extra = '') => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">${d ? `<path d="${d}"/>` : ''}${extra}</svg>`;
const ICON = {
  node: svg('M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM2.5 4.5L8 7.5l5.5-3M8 7.5v7'),
  Canvas: svg('', '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M1.5 5.5h13"/>'),
  custom: svg('M6 2h4v2.2a1.4 1.4 0 1 0 2.2 1.3H14v4h-1.8a1.4 1.4 0 1 0 0 2.2H14V14H2V2h4z'),
  Text: svg('M3 3.5h10M8 3.5v9.5M6 13h4'),
  Image: svg('M2 11l3.5-4 3 3 2-2L14 11', '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><circle cx="11" cy="5.5" r="1.2"/>'),
  Button: svg('M9 9l4.5 1.5-2 .8-.8 2z', '<rect x="1.5" y="4" width="11" height="6" rx="2"/>'),
  Link: svg('M7 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.7.7M9 6.5a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12l.7-.7'),
  Video: svg('M11 6.5l3.5-2v7l-3.5-2', '<rect x="1.5" y="4" width="9.5" height="8" rx="1"/>'),
  Audio: svg('M2 6h2.5L8 3v10L4.5 10H2zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9'),
  HTML: svg('M5 4L1.5 8 5 12M11 4l3.5 4-3.5 4M9.5 2.5l-3 11'),
  Repeat: svg('', '<rect x="1.5" y="2" width="13" height="3" rx=".5"/><rect x="1.5" y="6.5" width="13" height="3" rx=".5"/><rect x="1.5" y="11" width="13" height="3" rx=".5"/>'),
  HorizontalLayoutGroup: svg('', '<rect x="1.5" y="3" width="3.5" height="10" rx=".5"/><rect x="6.25" y="3" width="3.5" height="10" rx=".5"/><rect x="11" y="3" width="3.5" height="10" rx=".5"/>'),
  VerticalLayoutGroup: svg('', '<rect x="3" y="1.5" width="10" height="3.5" rx=".5"/><rect x="3" y="6.25" width="10" height="3.5" rx=".5"/><rect x="3" y="11" width="10" height="3.5" rx=".5"/>'),
  GridLayoutGroup: svg('', '<rect x="2" y="2" width="5" height="5" rx=".5"/><rect x="9" y="2" width="5" height="5" rx=".5"/><rect x="2" y="9" width="5" height="5" rx=".5"/><rect x="9" y="9" width="5" height="5" rx=".5"/>'),
  ScrollRect: svg('M13 4v8', '<rect x="1.5" y="1.5" width="13" height="13" rx="1"/><rect x="11.5" y="3" width="2" height="4" rx="1" fill="currentColor"/>'),
  Animator: svg('M5 4l7 4-7 4z', '<circle cx="8" cy="8" r="6.5"/>'),
  RawImage: svg('M2 11l3.5-4 3 3 2-2L14 11', '<rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke-dasharray="2 1.5"/>'),
  Toggle: svg('M4.5 8l2.5 2.5 4.5-5', '<rect x="1.5" y="1.5" width="13" height="13" rx="2"/>'),
  Slider: svg('M1.5 8h13', '<circle cx="6" cy="8" r="2.5" fill="currentColor"/>'),
  InputField: svg('M4 5.5v5', '<rect x="1.5" y="4" width="13" height="8" rx="1"/>'),
  Dropdown: svg('M10 7l1.5 1.5L13 7', '<rect x="1.5" y="4" width="13" height="8" rx="1"/>'),
  Scrollbar: svg('', '<rect x="5.5" y="1.5" width="5" height="13" rx="2.5"/><rect x="6.5" y="3.5" width="3" height="5" rx="1.5" fill="currentColor"/>'),
  Form: svg('M4 5h8M4 8h8M4 11h4', '<rect x="1.5" y="2" width="13" height="12" rx="1"/>'),
  IFrame: svg('M1.5 5.5h13M4 4h0M6 4h0', '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/>'),
  scene: svg('M8 1.5l6 3.3v6.4L8 14.5l-6-3.3V4.8zM2 4.8l6 3.3 6-3.3M8 8.1v6.4'),
  prefab: svg('M8 1.5l6 3.3v6.4L8 14.5l-6-3.3V4.8zM2 4.8l6 3.3 6-3.3M8 8.1v6.4', '<path d="M8 8.1v6.4l6-3.3V4.8z" fill="currentColor" stroke="none" opacity=".45"/>'),
};
const PRIMARY = ['Canvas', 'Button', 'Toggle', 'Slider', 'Scrollbar', 'InputField', 'Dropdown', 'Form', 'Link', 'Video', 'Audio', 'IFrame', 'Text', 'Image', 'RawImage', 'Repeat', 'ScrollRect', 'HorizontalLayoutGroup', 'VerticalLayoutGroup', 'GridLayoutGroup', 'HTML', 'Animator'];
function icon(n) {
  if (n.prefab) return ['prefab', ICON.prefab];
  const types = n.components.map(c => c.type);
  if (types.includes('Canvas')) return ['Canvas', ICON.Canvas];
  const custom = types.find(t => t.startsWith('component:'));
  if (custom) return ['custom', ICON.custom];
  const t = PRIMARY.find(p => types.includes(p));
  return t ? [t, ICON[t]] : ['node', ICON.node];
}
const EXT = { image: /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i, video: /\.(mp4|webm|ogv|mov)$/i, audio: /\.(mp3|wav|ogg|m4a|flac|aac)$/i, json: /\.json$/i };
const assetType = p => S.S.P.assets.find(a => a.path === p)?.type ?? Object.keys(EXT).find(t => EXT[t].test(p));

let el, tree, search, collapsed = new Set(), sceneOpen = true, order = [], anchor = null;
let renaming = false, dragging = false, dragIds = null, clip = [];

const rootId = () => S.root()?.id;
const ancestors = id => { const out = []; for (let p = S.parentOf(id); p; p = S.parentOf(p.id)) out.push(p.id); return out; };
// drop ids whose ancestor is also selected; keep visible order
const topLevel = ids => ids.filter(id => !ancestors(id).some(a => ids.includes(a))).sort((a, b) => order.indexOf(a) - order.indexOf(b));

function matches(n, q) {
  if (q.startsWith('o:')) { const bp = q.slice(2).trim(); return Object.entries(n.overrides ?? {}).some(([k, o]) => Object.keys(o).length && (!bp || k.toLowerCase() === bp)); }
  if (q.startsWith('t:')) { const t = q.slice(2).trim(); return n.components.some(c => c.type.toLowerCase().includes(t)); }
  return n.name.toLowerCase().includes(q);
}

function render() {
  if (renaming || dragging || !S.S.P) return;
  const root = S.root(), q = search.value.trim().toLowerCase(), sel = new Set(S.S.selection), act = S.S.selection.at(-1);
  const dim = new Map(), out = [];
  for (const [n, p] of S.walk(root)) dim.set(n.id, !n.active || (p && dim.get(p.id)));
  const bp = S.S.breakpoint;
  const row = (n, d) => {
    const [kind, ic] = icon(n), kids = n.children?.length > 0, open = !collapsed.has(n.id);
    const ov = bp ? Object.keys(n.overrides?.[bp] ?? {}) : [];
    const pf = n._missing ? ' pf-missing' : n.prefab ? ' pf pf-root' : n._inst ? ' pf' : '';
    out.push(`<div class="row${sel.has(n.id) ? ' sel' : ''}${n.id === act ? ' act' : ''}${dim.get(n.id) ? ' dim' : ''}${ov.length ? ' ovr' : ''}${pf}" data-id="${n.id}" draggable="true" style="--d:${d}"` +
      `${n._missing ? ` title="${esc(n._missing === 'cycle' ? `Prefab ${n.prefab} contains itself` : `Missing prefab ${n.prefab}`)}"` : ''}` +
      `${ov.length ? ` title="${esc(`${bp} overrides:\n${ov.join('\n')}`)}"` : ''}>` +
      `<span class="arrow${kids && !q ? (open ? ' open' : ' shut') : ''}"></span><span class="ico ico-${kind}">${ic}</span><span class="name">${esc(n.name)}</span></div>`);
    order.push(n.id);
    if (kids && open && !q) n.children.forEach(c => row(c, d + 1));
  };
  order = [];
  if (q) { for (const [n] of S.walk(root)) if (matches(n, q)) row(n, 0); }
  else if (sceneOpen) row(root, 1);
  const pe = S.S.prefabEdit;
  tree.innerHTML = (q ? '' : pe
    ? `<div class="scene-row pf-stage"><button class="pf-back" title="Back to the page (every instance updates)">◀</button><span class="ico">${ICON.prefab}</span><b>${esc(pe.name)}${S.S.dirty.has(`prefabs/${pe.name}.prefab.json`) ? '*' : ''}</b><small>prefab</small></div>`
    : `<div class="scene-row"><span class="arrow ${sceneOpen ? 'open' : 'shut'}"></span><span class="ico">${ICON.scene}</span><b>${esc(S.S.page)}${S.S.dirty.has(`pages/${S.S.page}.json`) ? '*' : ''}</b><button class="dots" title="Page menu">⋮</button></div>`) +
    out.join('') + (q && !out.length ? '<div class="empty">No matches</div>' : '');
}

function reveal() {
  if (!S.S.P) return;
  for (const id of S.S.selection) for (const a of ancestors(id)) collapsed.delete(a);
  if (S.S.selection.length) sceneOpen = true;
  render();
  rowEl(S.S.selection.at(-1))?.scrollIntoView({ block: 'nearest' });
}
const rowEl = id => id && tree.querySelector(`.row[data-id="${CSS.escape(id)}"]`);

// ---------- rename ----------
function rename(id = S.S.selection.at(-1)) {
  if (!id || renaming) return;
  if (search.value) { search.value = ''; }
  reveal();
  const r = rowEl(id), n = S.node(id);
  if (!r || !n) return;
  const inp = Object.assign(document.createElement('input'), { className: 'rename', value: n.name, spellcheck: false });
  r.querySelector('.name').replaceWith(inp);
  r.draggable = false;
  renaming = true;
  inp.focus(); inp.select();
  const done = ok => {
    if (!renaming) return;
    renaming = false;
    const v = inp.value.trim();
    if (ok && v && v !== n.name) S.setProp(id, 'name', v, { label: `Rename ${id}`, merge: false }); // inside a prefab instance: an override
    else render();
  };
  inp.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') { done(e.key === 'Enter'); tree.focus({ preventScroll: true }); }
  };
  inp.onblur = () => done(true);
  inp.onclick = inp.ondblclick = e => e.stopPropagation();
}

// ---------- clipboard ----------
const copy = () => { clip = topLevel(S.S.selection.filter(id => id !== rootId())).map(id => S.clone(S.node(id))); if (clip.length) S.log(`Copied ${clip.length} object(s)`); };
function paste(asChild = false) {
  if (!clip.length) return;
  const a = S.active();
  let parent = a ?? S.root(), index;
  if (!asChild && a && a !== S.root()) { parent = S.parentOf(a.id); index = parent.children.indexOf(a) + 1; }
  if (S.structureLocked(parent.id, true)) return;
  const nodes = clip.map(n => S.cloneTree(n));
  S.edit('Paste', () => { const p = S.node(parent.id); index == null ? p.children.push(...nodes) : p.children.splice(index, 0, ...nodes); });
  S.select(nodes.map(n => n.id));
}

// ---------- drag & drop ----------
function dropTarget(e) {
  const r = e.target.closest('.row');
  if (!r) return { zone: 'end', id: rootId() };
  const id = r.dataset.id, b = r.getBoundingClientRect(), y = (e.clientY - b.top) / b.height;
  return { row: r, id, zone: id === rootId() ? 'into' : y < 0.25 ? 'above' : y > 0.75 ? 'below' : 'into' };
}
// -> [parentId, index] for a drop target
function place(t) {
  if (t.zone === 'into' || t.zone === 'end') return [t.id, undefined];
  const p = S.parentOf(t.id);
  return [p.id, p.children.findIndex(c => c.id === t.id) + (t.zone === 'below' ? 1 : 0)];
}
const clearMarks = () => { tree.classList.remove('drop-end'); tree.querySelectorAll('.drop-above, .drop-below, .drop-into').forEach(r => r.classList.remove('drop-above', 'drop-below', 'drop-into')); };
const validMove = (ids, t) => { const [pid] = place(t); return ids.length && !ids.includes(t.id) && !ids.some(id => id === rootId() || id === pid || ancestors(pid).includes(id)); };

function moveNodes(ids, parentId, index) {
  if (ids.some(id => S.structureLocked(id)) || S.structureLocked(parentId, true)) return render();
  S.edit('Reparent', () => {
    const target = S.node(parentId);
    for (const id of ids) {
      const n = S.node(id), p = S.parentOf(id), old = p.children.indexOf(n);
      p.children.splice(old, 1);
      if (p === target && index != null && index > old) index--;
      index == null ? target.children.push(n) : target.children.splice(index++, 0, n);
    }
  });
  S.select(ids);
}

async function assetNode(path, parentId, index) {
  if (path.startsWith('prefab:')) return S.instantiate(path.slice(7), parentId);
  path = path.replace(/^assets\//, '');
  const type = assetType(path);
  const [preset, comp, prop] = { image: ['Image', 'Image', 'sprite'], video: ['Video', 'Video', 'src'], audio: ['Audio', 'Audio', 'src'], json: ['Repeat', 'Repeat', 'source'] }[type] ?? [];
  if (!preset) return S.log(`Can't create an object from ${type ?? 'unknown'} asset ${path}`, 'warn');
  const n = S.PRESETS[preset]();
  n.name = path.split('/').pop().replace(/\.[^.]+$/, '');
  S.getComponent(n, comp).props[prop] = path;
  if (type === 'image') { // Set Native Size
    const img = new Image();
    img.src = S.assetUrl(path);
    await img.decode().then(() => { if (img.naturalWidth) n.rect.size = [img.naturalWidth, img.naturalHeight]; }, () => {});
  }
  S.addNode(n, parentId, index);
}

// ---------- menus ----------
const sceneMenu = () => [
  { label: 'Save', shortcut: sc('save'), action: S.save },
  { label: 'Build Site', action: buildSite },
  '-',
  { label: 'New Page…', action: () => newPagePrompt() },
  { label: 'New Flowing Page…', action: () => newPagePrompt('flow') },
  { label: `Delete Page "${S.S.page}"…`, action: () => deletePage(), disabled: Object.keys(S.S.P.pages).length < 2 },
  '-',
  { label: 'Expand All', action: () => { collapsed.clear(); render(); } },
  { label: 'Collapse All', action: () => { for (const [n] of S.walk(S.root())) if (n.children.length && n !== S.root()) collapsed.add(n.id); render(); } },
  '-',
  { label: 'Create Empty', action: () => S.create('Create Empty') },
  { label: 'UI', sub: createItems() },
];
function rowMenu(onRow) {
  const sel = S.S.selection.length > 0, a = S.active(), pid = onRow ? a?.id : undefined, nonRoot = S.S.selection.some(id => id !== rootId());
  return [
    { label: 'Copy', shortcut: 'Ctrl+C', action: copy, disabled: !nonRoot },
    { label: 'Paste', shortcut: 'Ctrl+V', action: () => paste(), disabled: !clip.length },
    { label: 'Paste As Child', action: () => paste(true), disabled: !clip.length || !a },
    '-',
    { label: 'Rename', shortcut: sc('rename'), action: () => rename(), disabled: !sel },
    { label: 'Duplicate', shortcut: sc('duplicate'), action: () => S.duplicate(), disabled: !nonRoot },
    { label: 'Delete', shortcut: sc('delete'), action: () => S.deleteNodes(), disabled: !nonRoot },
    '-',
    { label: 'Select Children', action: () => S.select(S.selected().flatMap(n => [...S.walk(n)].slice(1).map(([c]) => c.id))), disabled: !a?.children.length },
    { label: a && !a.active ? 'Set Active' : 'Set Inactive', action: () => { const v = !a.active; S.selected().forEach(n => S.setProp(n.id, 'active', v)); }, disabled: !sel || a === S.root() },
    '-',
    { label: onRow ? 'Create Empty Child' : 'Create Empty', action: () => S.create('Create Empty', pid) },
    { label: 'UI', sub: createItems(pid) },
    '-',
    ...prefabItems(a),
  ];
}

// ---------- mount ----------
export function mount(root) {
  el = root;
  el.classList.add('hier');
  el.innerHTML = `
    <div class="hier-bar">
      <button class="hier-add" title="Create">+<b>▾</b></button>
      <label class="hier-search"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4 4"/></svg><input type="search" placeholder="Search (t:Type, o:overrides)" spellcheck="false"></label>
    </div>
    <div class="hier-tree" tabindex="0"></div>`;
  tree = el.querySelector('.hier-tree');
  search = el.querySelector('input');
  search.oninput = () => render();
  search.onkeydown = e => { if (e.key === 'Escape') { search.value = ''; render(); } else if (e.key === 'ArrowDown') { e.preventDefault(); tree.focus(); } };

  const add = el.querySelector('.hier-add');
  add.onclick = () => S.S.P && menuAt([
    { label: 'Create Empty', action: () => S.create('Create Empty', S.active()?.id) },
    '-', ...createItems(S.active()?.id),
  ], add);

  tree.onclick = e => {
    if (e.target.closest('.pf-back')) return S.closePrefab();
    if (e.target.closest('.dots')) return menuAt(sceneMenu(), e.target);
    if (e.target.closest('.scene-row')) {
      if (e.target.closest('.arrow')) { sceneOpen = !sceneOpen; render(); } else S.select([]);
      return;
    }
    const r = e.target.closest('.row');
    if (!r) return S.select([]);
    const id = r.dataset.id;
    if (e.target.closest('.arrow')) { // Alt+click: expand/collapse recursively (Unity)
      const shut = !collapsed.has(id);
      for (const [n] of e.altKey ? S.walk(S.node(id)) : [[{ id }]]) shut ? collapsed.add(n.id) : collapsed.delete(n.id);
      return render();
    }
    if (e.shiftKey && order.includes(anchor ?? S.S.selection.at(-1))) {
      const a = order.indexOf(anchor ?? S.S.selection.at(-1)), b = order.indexOf(id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      if (a > b) range.reverse();
      return S.select(range, false);
    }
    anchor = id;
    S.select(id, e.ctrlKey || e.metaKey);
  };
  tree.ondblclick = e => { const r = e.target.closest('.row'); if (r && e.target.closest('.name')) rename(r.dataset.id); };
  tree.oncontextmenu = e => {
    e.preventDefault();
    if (e.target.closest('.scene-row')) return menu(sceneMenu(), e.clientX, e.clientY);
    const r = e.target.closest('.row');
    if (r && !S.S.selection.includes(r.dataset.id)) S.select(r.dataset.id);
    if (!r) S.select([]);
    menu(rowMenu(!!r), e.clientX, e.clientY);
  };
  tree.onkeydown = e => {
    const mod = e.ctrlKey || e.metaKey, k = e.key, cur = order.indexOf(S.S.selection.at(-1));
    const go = i => { if (order[i]) { anchor = order[i]; S.select(order[i]); } };
    if (mod && k.toLowerCase() === 'c') copy();
    else if (mod && k.toLowerCase() === 'v') paste(e.shiftKey);
    else if (k === 'ArrowDown') go(cur < 0 ? 0 : cur + 1);
    else if (k === 'ArrowUp') go(Math.max(0, cur - 1));
    else if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const n = S.active();
      if (!n) return;
      const open = n.children.length && !collapsed.has(n.id);
      if (k === 'ArrowRight') { if (n.children.length && !open) { collapsed.delete(n.id); render(); } else if (open) go(cur + 1); }
      else if (open && n !== S.root()) { collapsed.add(n.id); render(); }
      else { const p = S.parentOf(n.id); if (p) S.select(p.id); }
    } else return;
    e.preventDefault(); e.stopPropagation();
  };

  tree.ondragstart = e => {
    const r = e.target.closest('.row');
    if (!r) return;
    const id = r.dataset.id;
    e.dataTransfer.setData('application/x-gpsb-node', id);
    e.dataTransfer.setData('text/plain', S.node(id)?.name ?? id);
    e.dataTransfer.effectAllowed = 'all';
    dragging = true; // no re-render while dragging: replacing the source row cancels the drag
    if (!S.S.selection.includes(id)) { S.select(id); tree.querySelectorAll('.sel').forEach(x => x.classList.remove('sel', 'act')); r.classList.add('sel', 'act'); }
    dragIds = topLevel(S.S.selection);
  };
  tree.ondragend = () => { dragging = false; dragIds = null; clearMarks(); render(); };
  tree.ondragover = e => {
    const types = e.dataTransfer.types, isNode = types.includes('application/x-gpsb-node');
    if (!isNode && !types.includes('application/x-gpsb-asset') && !types.includes('Files')) return;
    e.preventDefault(); e.stopPropagation();
    const t = dropTarget(e);
    clearMarks();
    if (isNode && dragIds && !validMove(dragIds, t)) { e.dataTransfer.dropEffect = 'none'; return; }
    e.dataTransfer.dropEffect = isNode ? 'move' : 'copy';
    if (t.row) t.row.classList.add('drop-' + t.zone); else tree.classList.add('drop-end');
  };
  tree.ondragleave = e => { if (!tree.contains(e.relatedTarget)) clearMarks(); };
  tree.ondrop = async e => {
    e.preventDefault(); e.stopPropagation();
    clearMarks();
    if (!S.S.P) return;
    const t = dropTarget(e), dt = e.dataTransfer;
    let [parentId, index] = place(t);
    const nodeId = dt.getData('application/x-gpsb-node'), asset = dt.getData('application/x-gpsb-asset'), files = [...dt.files];
    dragging = false;
    if (nodeId) {
      const ids = dragIds ?? topLevel([nodeId]);
      dragIds = null;
      if (validMove(ids, t)) { collapsed.delete(parentId); moveNodes(ids, parentId, index); } else render();
      return;
    }
    collapsed.delete(parentId);
    if (asset) return assetNode(asset, parentId, index);
    for (const f of files) {
      try { await assetNode(await S.upload(f), parentId, index); if (index != null) index++; }
      catch (err) { S.log(`Import ${f.name} failed: ${err.message}`, 'error'); }
    }
  };

  S.on('rename', () => rename());
  S.on('selection', reveal);
  for (const ev of ['structure', 'props', 'page', 'saved', 'assets', 'breakpoint']) S.on(ev, render);
  S.on('page', () => { collapsed.clear(); anchor = null; search.value = ''; });
}
