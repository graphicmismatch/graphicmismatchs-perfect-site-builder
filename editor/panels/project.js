// Project window: folder tree, breadcrumb, search, thumbnail grid, import, create, rename, delete, drag out.
// Emits 'asset-select' with a project-relative path ('assets/img/a.png', 'components/Card.html',
// 'behaviours/Spin.js', 'animations/Intro.anim.json', or a folder 'assets/img/').
import * as S from '../state.js';
import { h, menu, fmtSize, hidden, setDragAsset } from '../fields.js';
import { icon } from '../icons.js';
import { openCode, createClip, uniqueName, renamePath, deletePath, behaviourTemplate, componentTemplate, extensionTemplate, validName } from '../files.js';

const ROOTS = { assets: 'Assets', components: 'Components', behaviours: 'Behaviours', extensions: 'Extensions', animations: 'Animations' };
const OPENABLE = ['component', 'behaviour', 'extension', 'json', 'text', 'file'];
let el, treeEl, gridEl, crumbs, footPath, searchEl, slider, fileIn;
let cur = 'assets', selPath = null, size = 72, query = '', renaming = false, pending = false, M = { items: [], folders: new Set() };
const expanded = new Set(['assets']);
try { size = +localStorage.gpsbTile || 72; cur = localStorage.gpsbFolder || 'assets'; } catch {}

export function mount(root) {
  el = root;
  el.classList.add('proj');
  const plus = h('button', { class: 'pj-plus', title: 'Create' }, '+ ▾');
  plus.onclick = () => { const r = plus.getBoundingClientRect(); createMenu(r.left, r.bottom); };
  searchEl = h('input', { class: 'pj-search', placeholder: 'Search (t:image)', spellcheck: 'false', oninput: () => { query = searchEl.value.trim(); draw(); } });
  crumbs = h('div', { class: 'pj-crumbs' });
  treeEl = h('div', { class: 'pj-tree' });
  gridEl = h('div', { class: 'pj-grid' });
  footPath = h('span', { class: 'pj-path' });
  slider = h('input', { type: 'range', min: 32, max: 128, step: 4, value: size, class: 'pj-size', title: 'Thumbnail size' });
  slider.oninput = () => { size = +slider.value; try { localStorage.gpsbTile = size; } catch {} layout(); };
  fileIn = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { importFiles([...fileIn.files], cur); fileIn.value = ''; } });
  el.append(
    h('div', { class: 'pj-bar' }, plus, crumbs, searchEl),
    treeEl, gridEl,
    h('div', { class: 'pj-foot' }, footPath, slider), fileIn);

  gridEl.onclick = e => { if (e.target === gridEl) { selPath = null; mark(); } };
  gridEl.oncontextmenu = e => { if (e.target === gridEl) { e.preventDefault(); createMenu(e.clientX, e.clientY); } };

  // OS file drops import into the folder under the pointer (or the current one)
  el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop-os');
    el.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
    e.target.closest?.('[data-folder]')?.classList.add('drop');
  });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) { el.classList.remove('drop-os'); el.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); } });
  el.addEventListener('drop', e => {
    el.classList.remove('drop-os');
    el.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    importFiles([...e.dataTransfer.files], e.target.closest?.('[data-folder]')?.dataset.folder ?? cur);
  });
  el.addEventListener('keydown', keys);

  for (const ev of ['assets', 'anim', 'load']) S.on(ev, draw);
  S.on('asset-ping', p => reveal(p));
  S.on('selection', () => { if (S.S.selection.length && selPath) { selPath = null; mark(); } });
  draw();
}

// ---------- model ----------
const join = (...a) => a.filter(Boolean).join('/');
const parentDir = d => d.slice(0, d.lastIndexOf('/'));
function model() {
  const P = S.S.P, items = [], folders = new Set(['assets']);
  if (!P) return { items, folders };
  for (const a of P.assets) {
    const segs = a.path.split('/');
    for (let i = 1; i < segs.length && !segs[i - 1].startsWith('.'); i++) folders.add('assets/' + segs.slice(0, i).join('/'));
    if (hidden(a.path)) continue;
    items.push({ path: 'assets/' + a.path, name: segs.at(-1), dir: join('assets', segs.slice(0, -1).join('/')), kind: a.type === 'other' ? 'file' : a.type, size: a.size, drag: a.path, ren: 'asset' });
  }
  for (const f of folders) if (f !== 'assets') items.push({ path: f + '/', name: f.split('/').pop(), dir: parentDir(f), kind: 'folder', folder: f, ren: 'folder' });
  for (const n of Object.keys(P.components)) items.push({ path: `components/${n}.html`, name: n, dir: 'components', kind: 'component', ren: 'component', comp: 'component:' + n });
  for (const [n, b] of Object.entries(P.behaviours)) items.push({ path: b.path, name: n, dir: 'behaviours', kind: 'behaviour', ren: 'behaviour', comp: 'behaviour:' + n });
  for (const [n, e] of Object.entries(P.extensions ?? {})) items.push({ path: e.path, name: n, dir: 'extensions', kind: 'extension', ren: 'extension', comp: n });
  for (const n of Object.keys(P.clips)) items.push({ path: `animations/${n}.anim.json`, name: n, dir: 'animations', kind: 'anim', drag: n, ren: 'anim' });
  const cmp = (a, b) => (a.kind === 'folder') !== (b.kind === 'folder') ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  items.sort(cmp);
  return { items, folders };
}
const isFolder = k => k in ROOTS || M.folders.has(k);

function visible() {
  if (!query) return M.items.filter(it => it.dir === cur);
  const t = /(?:^|\s)t:(\w+)/.exec(query)?.[1]?.toLowerCase(), q = query.replace(/(?:^|\s)t:\w+/, '').trim().toLowerCase();
  return M.items.filter(it => it.kind !== 'folder' && (!t || it.kind.startsWith(t)) && (!q || it.name.toLowerCase().includes(q)));
}

// ---------- drawing ----------
function draw() {
  if (renaming) { pending = true; return; }
  M = model();
  if (!isFolder(cur)) cur = 'assets';
  drawTree(); drawCrumbs(); drawGrid(); layout(); mark();
}

function drawTree() {
  const row = (key, label, depth, kids) => {
    const open = expanded.has(key);
    const ar = h('span', { class: 'pj-ar' + (kids.length ? (open ? ' open' : '') : ' none') });
    ar.onclick = e => { e.stopPropagation(); open ? expanded.delete(key) : expanded.add(key); drawTree(); };
    const r = h('div', { class: 'pj-row' + (cur === key && !query ? ' on' : ''), style: `padding-left:${4 + depth * 12}px`, 'data-folder': key, onclick: () => setFolder(key) },
      ar, h('span', { class: 'pj-ic', html: icon('folder') }), h('span', {}, label));
    const out = [r];
    if (open) for (const k of kids) out.push(...row(k, k.split('/').pop(), depth + 1, sub(k)));
    return out;
  };
  const sub = k => [...M.folders].filter(f => parentDir(f) === k).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  treeEl.replaceChildren(...row('assets', 'Assets', 0, sub('assets')), ...Object.keys(ROOTS).slice(1).flatMap(k => row(k, ROOTS[k], 0, [])));
}

function drawCrumbs() {
  if (query) return crumbs.replaceChildren(h('span', { class: 'dim' }, `Search: ${visible().length} result(s)`));
  const segs = cur.split('/'), out = [];
  segs.forEach((s, i) => {
    const key = segs.slice(0, i + 1).join('/');
    if (i) out.push(h('span', { class: 'pj-sep' }, '›'));
    out.push(h('span', { class: 'pj-crumb', 'data-folder': key, onclick: () => setFolder(key) }, i ? s : ROOTS[s]));
  });
  crumbs.replaceChildren(...out);
}

function preview(it) {
  if (it.kind === 'image') return h('img', { src: S.assetUrl(it.drag), loading: 'lazy', draggable: 'false' });
  if (it.kind === 'video') return h('video', { src: S.assetUrl(it.drag) + '#t=0.1', muted: true, preload: 'metadata', draggable: 'false' });
  return h('span', { class: 'pj-big', html: icon(it.kind) });
}

function drawGrid() {
  const its = visible();
  gridEl.replaceChildren(...its.map(tile));
  if (!its.length) gridEl.append(h('div', { class: 'pj-empty' }, query ? 'No results' : cur.startsWith('assets') ? 'Drop images, video, audio, JSON or fonts here to import them.' : `Empty. Use + to create one.`));
  footPath.textContent = selPath ?? `${its.length} item(s)`;
}

function tile(it) {
  const nm = h('div', { class: 'pi-n', title: it.path }, it.name);
  const t = h('div', { class: 'pi', tabindex: 0, draggable: 'true', 'data-path': it.path, title: it.size != null ? `${it.path}\n${fmtSize(it.size)}` : it.path },
    h('div', { class: 'pi-th' + (it.kind === 'image' ? ' checker' : '') }, preview(it)), nm);
  if (it.kind === 'folder') t.dataset.folder = it.folder;
  t.onclick = () => select(it);
  t.ondblclick = () => openItem(it);
  nm.ondblclick = e => { e.stopPropagation(); select(it); startRename(it); };
  t.oncontextmenu = e => { e.preventDefault(); select(it); itemMenu(it, e.clientX, e.clientY); };
  t.ondragstart = e => {
    if (it.kind === 'folder') return e.preventDefault();
    const dt = e.dataTransfer;
    if (it.drag != null) { dt.setData('application/x-gpsb-asset', it.drag); setDragAsset({ kind: it.kind, value: it.drag }); }
    if (it.comp) dt.setData('application/x-gpsb-component', it.comp);
    dt.setData('text/plain', it.drag ?? it.path);
    dt.effectAllowed = 'copyLink';
  };
  t.ondragend = () => setDragAsset(null);
  return t;
}

function layout() {
  gridEl.style.setProperty('--tile', size + 'px');
  gridEl.classList.toggle('list', size <= 40);
}

function mark() {
  for (const t of gridEl.children) t.classList?.toggle('on', t.dataset.path === selPath);
  footPath.textContent = selPath ?? `${gridEl.querySelectorAll('.pi').length} item(s)`;
}

// ---------- actions ----------
function setFolder(k) {
  cur = k; query = ''; searchEl.value = '';
  for (let d = k; d.includes('/'); d = parentDir(d)) expanded.add(parentDir(d));
  try { localStorage.gpsbFolder = k; } catch {}
  draw();
}

function select(it, focus = false) {
  selPath = it.path;
  mark();
  if (S.S.selection.length) S.select([]);
  S.emit('asset-select', it.path);
  if (focus) gridEl.querySelector(`[data-path="${CSS.escape(it.path)}"]`)?.focus();
}

function openItem(it) {
  if (it.kind === 'folder') return setFolder(it.folder);
  if (OPENABLE.includes(it.kind)) return openCode(it.path);
  if (it.kind === 'anim') { S.S.anim.clip = it.name; S.emit('anim'); S.emit('show-tab', 'animation'); return; }
  open(S.assetUrl(it.drag), '_blank');
}

function reveal(p) {
  const it = M.items.find(x => x.path === p);
  if (!it) return;
  selPath = null;
  setFolder(it.dir);
  const t = gridEl.querySelector(`[data-path="${CSS.escape(p)}"]`);
  if (!t) return;
  t.scrollIntoView({ block: 'nearest' });
  t.classList.remove('ping'); void t.offsetWidth; t.classList.add('ping');
}

const targetPath = (it, v) => ({
  asset: () => join(it.dir, v), folder: () => join(parentDir(it.folder), v),
  component: () => `components/${v}.html`, behaviour: () => `behaviours/${v}.js`, extension: () => `extensions/${v}.js`, anim: () => `animations/${v}.anim.json`,
}[it.ren]());

function startRename(it) {
  const t = gridEl.querySelector(`[data-path="${CSS.escape(it.path)}"]`);
  if (!t) return;
  renaming = true;
  const nm = t.querySelector('.pi-n'), base = it.name;
  const inp = h('input', { class: 'pi-ren', value: base, spellcheck: 'false' });
  nm.replaceWith(inp);
  t.draggable = false;
  inp.focus();
  const dot = it.ren === 'asset' ? base.lastIndexOf('.') : -1;
  inp.setSelectionRange(0, dot > 0 ? dot : base.length);
  let done = false;
  const finish = async ok => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    let err = '';
    if (ok && v && v !== base) {
      if (/[/\\]/.test(v) || v.startsWith('.')) err = `Invalid name "${v}"`;
      else if (!['asset', 'folder'].includes(it.ren) && !validName(v)) err = `"${v}" must be an identifier (letters, digits, _ or -)`;
      else if (it.ren === 'extension' && (!/^[A-Za-z_]\w*$/.test(v) || (S.builtins[v] && !S.builtins[v].extension))) err = `"${v}" must be a JS identifier and not a built-in component`;
      else if (M.items.some(x => x.path.replace(/\/$/, '') === targetPath(it, v))) err = `${v} already exists`;
      if (!err) try {
        const to = targetPath(it, v);
        await renamePath(it.path.replace(/\/$/, ''), to, it.ren);
        selPath = it.ren === 'folder' ? to + '/' : to;
        if (it.ren === 'folder' && (cur === it.folder || cur.startsWith(it.folder + '/'))) cur = to + cur.slice(it.folder.length);
      } catch (e) { err = `Rename failed: ${e.message}`; }
    }
    if (err) S.log(err, 'warn');
    renaming = false; pending = false;
    draw();
    const n = M.items.find(x => x.path === selPath);
    if (n) select(n, true);
  };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
  inp.onclick = inp.ondblclick = e => e.stopPropagation();
}

async function remove(it) {
  const n = it.kind === 'folder' ? M.items.filter(x => x.kind !== 'folder' && x.path.startsWith(it.path)).length : 0;
  if (!confirm(`Delete ${it.path}${n ? ` and the ${n} file(s) inside` : ''}?\nThis cannot be undone.`)) return;
  try {
    await deletePath(it.path.replace(/\/$/, ''), it.ren === 'anim' ? 'anim' : 'file');
    if (selPath === it.path) selPath = null;
  } catch (e) { S.log(`Delete failed: ${e.message}`, 'error'); }
}

async function create(kind) {
  const P = S.S.P, dir = cur.startsWith('assets') ? cur : 'assets', sub = dir.slice(7);
  const used = rel => P.assets.some(a => a.path === rel || a.path.startsWith(rel + '/'));
  let path;
  try {
    if (kind === 'folder') {
      const n = uniqueName('New Folder', x => used(join(sub, x)));
      await S.api.put(`assets/${join(sub, n, '.keep')}`, '');
      path = `assets/${join(sub, n)}/`;
    } else if (kind === 'json') {
      const n = uniqueName('New Data', x => used(join(sub, x + '.json'))) + '.json';
      path = `assets/${join(sub, n)}`;
      await S.api.put(path, '{\n  "title": "Hello",\n  "items": [\n    { "name": "One" },\n    { "name": "Two" }\n  ]\n}\n');
    } else if (kind === 'component') {
      const n = uniqueName('NewComponent', x => P.components[x], '');
      path = `components/${n}.html`;
      await S.api.put(path, componentTemplate(n));
    } else if (kind === 'behaviour') {
      const n = uniqueName('NewBehaviour', x => P.behaviours[x], '');
      path = `behaviours/${n}.js`;
      await S.api.put(path, behaviourTemplate(n));
    } else if (kind === 'extension') {
      const n = uniqueName('NewExtension', x => P.extensions?.[x] || S.builtins[x], '');
      path = `extensions/${n}.js`;
      await S.api.put(path, extensionTemplate(n));
    } else if (kind === 'anim') {
      const n = uniqueName('NewAnimation', x => P.clips[x], '');
      path = `animations/${n}.anim.json`;
      await createClip(n);
    }
    if (kind !== 'anim') await S.reloadMeta();
  } catch (e) { return S.log(`Create failed: ${e.message}`, 'error'); }
  const it = model().items.find(x => x.path === path);
  if (!it) return;
  setFolder(it.dir);
  select(it);
  startRename(it);
}

function createMenu(x, y) {
  menu([
    { label: 'Folder', action: () => create('folder') },
    '-',
    { label: 'JSON File', action: () => create('json') },
    { label: 'Component', action: () => create('component') },
    { label: 'Behaviour Script', action: () => create('behaviour') },
    { label: 'Extension Component', action: () => create('extension') },
    { label: 'Animation Clip', action: () => create('anim') },
    '-',
    { label: 'Import New Asset…', action: () => fileIn.click() },
    { label: 'Refresh', action: () => S.reloadMeta() },
  ], x, y);
}

function itemMenu(it, x, y) {
  menu([
    { label: it.kind === 'folder' ? 'Open' : OPENABLE.includes(it.kind) ? 'Open in Editor' : it.kind === 'anim' ? 'Open in Animation Window' : 'Open in New Tab', action: () => openItem(it) },
    { label: 'Rename', action: () => startRename(it) },
    { label: 'Delete', action: () => remove(it) },
    '-',
    { label: 'Copy Path', action: () => navigator.clipboard?.writeText(it.drag ?? it.path).then(() => S.log(`Copied ${it.drag ?? it.path}`)) },
  ], x, y);
}

async function importFiles(files, folder) {
  if (!files.length) return;
  S.log(`Importing ${files.length} file(s) into ${folder}…`);
  let meta = false, last = null, ok = 0;
  for (const [i, f] of files.entries()) {
    S.log(`Importing ${i + 1}/${files.length}: ${f.name} (${fmtSize(f.size)})`);
    try {
      if (folder === 'components' && f.name.endsWith('.html')) { await S.api.put('components/' + f.name, f); meta = true; last = 'components/' + f.name; }
      else if (folder === 'behaviours' && f.name.endsWith('.js')) { await S.api.put('behaviours/' + f.name, f); meta = true; last = 'behaviours/' + f.name; }
      else if (folder === 'extensions' && f.name.endsWith('.js')) { await S.api.put('extensions/' + f.name, f); meta = true; last = 'extensions/' + f.name; }
      else if (f.name.endsWith('.anim.json')) {
        const text = await f.text(), n = f.name.slice(0, -10);
        S.S.P.clips[n] = JSON.parse(text);
        await S.api.put('animations/' + f.name, text);
        S.emit('anim'); last = 'animations/' + f.name;
      } else last = 'assets/' + await S.upload(f, folder.startsWith('assets') ? folder.slice(7) : '');
      ok++;
    } catch (e) { S.log(`Import ${f.name} failed: ${e.message}`, 'error'); }
  }
  if (meta) await S.reloadMeta();
  S.log(`Imported ${ok}/${files.length} file(s)`, ok === files.length ? 'info' : 'warn');
  const it = M.items.find(x => x.path === last);
  if (it) { if (!query) setFolder(it.dir); select(it); }
}

// Panel-local keys (focus inside the Project window only)
function keys(e) {
  if (e.target.matches('input, textarea, select')) return;
  const tiles = [...gridEl.querySelectorAll('.pi')], i = tiles.findIndex(t => t.dataset.path === selPath);
  const it = M.items.find(x => x.path === selPath), k = e.key;
  const go = j => { const t = tiles[Math.max(0, Math.min(tiles.length - 1, j))]; const n = t && M.items.find(x => x.path === t.dataset.path); if (n) select(n, true); };
  const cols = Math.max(1, tiles.filter(t => t.offsetTop === tiles[0]?.offsetTop).length);
  if (k === 'F2' && it) startRename(it);
  else if (k === 'Delete' && it) remove(it);
  else if (k === 'Enter' && it) openItem(it);
  else if (k === 'Backspace' && cur.includes('/')) setFolder(parentDir(cur));
  else if (k === 'ArrowRight') go(i + 1);
  else if (k === 'ArrowLeft') go(i - 1);
  else if (k === 'ArrowDown') go(i < 0 ? 0 : i + (gridEl.classList.contains('list') ? 1 : cols));
  else if (k === 'ArrowUp') go(i - (gridEl.classList.contains('list') ? 1 : cols));
  else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'f') searchEl.focus();
  else return;
  e.preventDefault(); e.stopPropagation();
}
