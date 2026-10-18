// Project Hub (served at /): registered projects, New / Add / Locate / Remove, preferences. API: CONTRACT.md "Project Hub".
import * as prefs from './prefs.js';
import { icon } from './icons.js';

const $ = s => document.querySelector(s);
const list = $('#list'), search = $('#search'), sortSel = $('#sort');
const NAME = /^[\w.-][\w .-]*$/; // same rule as POST /api/hub/create
const TEMPLATES = [
  { id: 'empty', name: 'Empty', desc: 'One blank page with a Canvas. Start from scratch.' },
  { id: 'showcase', name: 'Showcase', desc: 'The demo site: animations, custom components, behaviours and responsive breakpoints.' },
];
let D = { projects: [], home: '/' };
const modal = () => document.querySelector('dialog[open], .prefs-overlay'); // ours or the shared Preferences window

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e[k] = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter(k => k != null && k !== false));
  return e;
}
const btn = (label, onclick, cls = '', attrs = {}) => h('button', { type: 'button', class: 'hb-btn ' + cls, onclick, ...attrs }, label);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const join = (L, name) => (L.path.endsWith(L.sep) ? L.path : L.path + L.sep) + name;

async function api(url, body) {
  const r = await fetch(url, body && { method: 'POST', headers: { 'x-gpsb': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text()) || `${r.status} ${r.statusText}`);
  return r.json();
}

function toast(msg, level = 'info') {
  const t = h('div', { class: 'hb-toast ' + level, role: level === 'error' ? 'alert' : null }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), level === 'error' ? 7000 : 3000);
}
const fail = e => toast(e.message ?? String(e), 'error');

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(t) {
  if (!t) return 'never';
  let s = (t - Date.now()) / 1000;
  if (s > -45) return 'just now';
  for (const [u, n] of [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]]) {
    if (Math.abs(s) < n) return rtf.format(Math.round(s), u);
    s /= n;
  }
}

function badge(name) {
  let n = 0;
  for (const c of name) n = (n * 31 + c.codePointAt(0)) | 0;
  const ini = name.split(/[\s_.-]+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '?';
  return h('span', { class: 'hb-badge', style: `--hue: ${Math.abs(n) % 360}`, 'aria-hidden': 'true' }, ini);
}

// ---------- list ----------
async function load() {
  try { D = await api('/api/hub/projects'); } catch (e) { fail(e); }
  draw();
}

function draw() {
  const q = search.value.trim().toLowerCase(), focused = document.activeElement?.closest?.('.hb-row')?.dataset.path;
  const cmp = sortSel.value === 'name'
    ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : (a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0);
  const ps = D.projects.filter(p => !q || `${p.name} ${p.path}`.toLowerCase().includes(q)).sort(cmp);
  document.body.classList.toggle('hb-none-reg', !D.projects.length);
  list.replaceChildren(...ps.map(row));
  if (!D.projects.length) list.append(h('div', { class: 'hb-empty' },
    h('div', { class: 'hb-logo big', 'aria-hidden': 'true' }),
    h('h3', {}, 'No projects yet'),
    h('p', {}, 'Create a site from a template, or add a folder that already contains a project.json.'),
    h('div', { class: 'hb-actions' }, btn('Add existing…', () => addProject()), btn('New project', newProject, 'hb-primary'))));
  else if (!ps.length) list.append(h('div', { class: 'hb-nomatch' }, `No projects match “${search.value.trim()}”.`));
  const rows = [...list.querySelectorAll('.hb-row')];
  const cur = rows.find(r => r.dataset.path === focused);
  if (cur) focusRow(cur); else if (rows[0]) rows[0].tabIndex = 0;
}

function row(p) {
  const r = h('div', {
    class: `hb-row${p.exists ? '' : ' missing'}${p.open ? ' open' : ''}`, role: 'option', tabindex: '-1', 'aria-selected': 'false',
    'data-path': p.path, 'aria-label': `${p.name}, ${p.path}${p.open ? ', open' : ''}${p.exists ? '' : ', folder missing'}`,
  },
  badge(p.name),
  h('div', { class: 'hb-id' },
    h('div', { class: 'hb-name' }, h('span', {}, p.name), p.open && h('span', { class: 'hb-tag on' }, 'open'), !p.exists && h('span', { class: 'hb-tag warn' }, 'missing')),
    h('div', { class: 'hb-path', title: p.path }, p.path)),
  p.exists
    ? [h('div', { class: 'hb-meta' }, `${plural(p.pages, 'page')} · ${plural(p.assets, 'asset')}`),
      h('div', { class: 'hb-meta', title: p.lastOpened ? new Date(p.lastOpened).toLocaleString() : '' }, ago(p.lastOpened))]
    : h('div', { class: 'hb-fix' }, h('span', {}, 'Folder not found'), btn('Locate…', e => { e.stopPropagation(); locate(p); }), btn('Remove', e => { e.stopPropagation(); remove(p); })),
  h('button', { type: 'button', class: 'hb-icon', title: 'More actions', 'aria-label': `Actions for ${p.name}`, 'aria-haspopup': 'menu',
    onclick: e => { e.stopPropagation(); rowMenu(p, e.currentTarget); } }, '⋮'));
  r.onclick = () => activate(p);
  r.onfocus = () => focusRow(r);
  r.oncontextmenu = e => { e.preventDefault(); rowMenu(p, r.querySelector('.hb-icon')); };
  return r;
}

function focusRow(r) {
  for (const x of list.querySelectorAll('.hb-row')) { x.tabIndex = -1; x.setAttribute('aria-selected', 'false'); }
  r.tabIndex = 0; r.setAttribute('aria-selected', 'true');
  if (document.activeElement !== r) r.focus();
  r.scrollIntoView({ block: 'nearest' });
}
const projOf = r => D.projects.find(p => p.path === r?.dataset.path);

list.onkeydown = e => {
  const rows = [...list.querySelectorAll('.hb-row')], i = rows.indexOf(e.target);
  if (i < 0) return;
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1, PageDown: i + 10, PageUp: i - 10 }[e.key];
  if (to != null) { e.preventDefault(); focusRow(rows[Math.max(0, Math.min(rows.length - 1, to))]); }
  else if (e.key === 'Enter') { e.preventDefault(); activate(projOf(e.target)); }
  else if (e.key === 'Delete') { e.preventDefault(); remove(projOf(e.target)); }
  else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); rowMenu(projOf(e.target), e.target.querySelector('.hb-icon')); }
};

// ---------- actions ----------
async function open(path) {
  await api('/api/hub/open', { path });
  location = '/editor/';
}
const activate = p => (p.exists ? open(p.path).catch(fail) : locate(p));

async function remove(p) {
  const ok = await ask('Remove from list', [`Remove “${p.name}” from the project list?`, h('br'), h('small', {}, `The files stay on disk at ${p.path}`)], 'Remove');
  if (!ok) return;
  try { await api('/api/hub/remove', { path: p.path }); toast(`Removed ${p.name} from the list`); } catch (e) { fail(e); }
  load();
}

function rowMenu(p, anchor) {
  menu([
    ['Open', () => open(p.path).catch(fail), !p.exists],
    !p.exists && ['Locate…', () => locate(p)],
    ['Copy path', () => navigator.clipboard.writeText(p.path).then(() => toast('Path copied'), fail)],
    '-',
    ['Remove from list…', () => remove(p)],
  ], anchor);
}

let closeMenu = null;
function menu(items, anchor) {
  closeMenu?.();
  const m = h('div', { class: 'menu hb-menu', role: 'menu' }, items.filter(Boolean).map(it => it === '-' ? h('hr')
    : h('div', { role: 'menuitem', tabindex: '-1', class: it[2] ? 'off' : '', 'aria-disabled': it[2] ? 'true' : null, onclick: () => { if (it[2]) return; close(); it[1](); } }, h('span', {}, it[0]))));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 4))}px`;
  m.style.top = `${r.bottom + m.offsetHeight + 2 > innerHeight ? Math.max(4, r.top - m.offsetHeight - 2) : r.bottom + 2}px`;
  const its = [...m.querySelectorAll('[role=menuitem]:not(.off)')];
  const off = e => { if (!m.contains(e.target)) close(false); };
  function close(refocus = true) {
    m.remove(); removeEventListener('pointerdown', off, true); closeMenu = null;
    if (refocus) anchor.closest('.hb-row')?.focus();
  }
  m.onkeydown = e => {
    e.stopPropagation();
    const i = its.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length]?.focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement.click(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
  };
  setTimeout(() => addEventListener('pointerdown', off, true));
  closeMenu = close;
  its[0]?.focus();
}

// ---------- dialogs ----------
// onOk may be async; a thrown error is shown inside the dialog and keeps it open. Resolving to false keeps it open too.
function dialog({ title, body, ok = 'OK', onOk = () => {}, cancel = 'Cancel', cls = '', danger = false }) {
  const err = h('div', { class: 'hb-err', role: 'alert' });
  const okBtn = h('button', { type: 'submit', class: `hb-btn ${danger ? 'hb-danger' : 'hb-primary'}` }, ok);
  const form = h('form', { novalidate: true }, h('h3', {}, title), body, err,
    h('div', { class: 'hb-actions' }, cancel && btn(cancel, () => d.close()), okBtn));
  const d = h('dialog', { class: 'hb-dlg ' + cls, 'aria-label': title }, form);
  form.onsubmit = async e => {
    e.preventDefault();
    if (okBtn.disabled) return;
    err.textContent = ''; okBtn.disabled = true;
    try { if ((await onOk(d)) !== false) d.close(); } catch (x) { err.textContent = x.message ?? String(x); } finally { okBtn.disabled = false; }
  };
  d.addEventListener('close', () => d.remove());
  Object.assign(d, { okBtn, err: m => (err.textContent = m) });
  document.body.append(d);
  d.showModal();
  return d;
}

const ask = (title, msg, ok) => new Promise(res => {
  const d = dialog({ title, body: h('p', { class: 'hb-msg' }, msg), ok, danger: true, onOk: () => res(true) });
  d.addEventListener('close', () => res(false));
  d.okBtn.focus();
});

// Folder browser over GET /api/hub/ls. pick: project folders are selected (b.sel) instead of entered.
function browser(start, { pick = false, onChange = () => {}, onPick = () => {} } = {}) {
  const crumbs = h('div', { class: 'hb-crumbs' }), dirs = h('div', { class: 'hb-dirs', role: 'list' });
  const up = btn('↑', null, 'hb-sq', { title: 'Parent folder', 'aria-label': 'Parent folder' });
  const home = btn('⌂', () => b.go(D.home), 'hb-sq', { title: 'Home folder', 'aria-label': 'Home folder' });
  const b = { el: h('div', { class: 'hb-browser' }, h('div', { class: 'hb-bpath' }, up, home, crumbs), dirs), cur: null, sel: null };
  b.go = async dir => {
    let L;
    try { L = await api('/api/hub/ls?path=' + encodeURIComponent(dir)); } catch (e) { return fail(e); }
    b.cur = L; b.sel = pick && L.project ? L.path : null;
    prefs.set('hub.lastDir', L.path);
    up.disabled = !L.parent; up.onclick = () => b.go(L.parent);
    const parts = L.path.split(L.sep).filter(Boolean);
    let acc = L.sep === '/' ? '/' : parts.shift() + L.sep;
    const segs = [[acc, acc], ...parts.map(n => [n, acc = (acc.endsWith(L.sep) ? acc : acc + L.sep) + n])];
    crumbs.replaceChildren(...segs.flatMap(([n, p], i) => [i > 1 && h('span', { class: 'hb-csep', 'aria-hidden': 'true' }, '›'),
      h('button', { type: 'button', class: 'hb-crumb', title: p, onclick: () => b.go(p), 'aria-current': i === segs.length - 1 ? 'location' : null }, n)]).filter(Boolean));
    crumbs.scrollLeft = 1e6;
    dirs.replaceChildren(...L.dirs.map(x => {
      const full = join(L, x.name);
      const it = h('button', { type: 'button', class: 'hb-dir' + (x.project ? ' proj' : ''), title: full, role: 'listitem' },
        h('span', { class: 'hb-dic', html: icon('folder') }), h('span', { class: 'hb-dn' }, x.name), x.project && h('em', {}, 'project'));
      const select = () => {
        b.sel = full;
        for (const o of dirs.children) o.classList.toggle('on', o === it);
        onChange(b);
      };
      it.onclick = () => (pick && x.project ? select() : b.go(full));
      if (pick && x.project) it.ondblclick = () => { select(); onPick(b); };
      return it;
    }), ...(L.dirs.length ? [] : [h('div', { class: 'hb-nomatch' }, 'No subfolders')]));
    dirs.scrollTop = 0;
    onChange(b);
  };
  b.go(start || D.home);
  return b;
}

function newProject() {
  if (modal()) return;
  const tpls = h('div', { class: 'hb-tpls', role: 'radiogroup', 'aria-label': 'Template' }, TEMPLATES.map((t, i) =>
    h('label', { class: 'hb-tpl' }, h('input', { type: 'radio', name: 'tpl', value: t.id, checked: i === 0 }),
      h('div', { class: `hb-art ${t.id}`, 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('b', {}, t.name), h('span', {}, t.desc))));
  const name = h('input', { id: 'np-name', value: 'My Site', autocomplete: 'off', spellcheck: 'false', required: true });
  const out = h('div', { class: 'hb-out', 'aria-live': 'polite' });
  const br = browser(prefs.get('hub.lastDir'), { onChange: upd });
  function upd() {
    const n = name.value.trim(), L = br.cur;
    if (!L) return;
    const bad = !NAME.test(n), exists = L.dirs.some(x => x.name === n);
    out.className = 'hb-out' + (bad ? ' bad' : exists ? ' warn' : '');
    out.textContent = bad ? 'Name: letters, digits, spaces, . _ - (not starting with a space)'
      : join(L, n) + (exists ? '  (folder exists; it must be empty)' : '');
  }
  name.oninput = () => { d.err(''); upd(); };
  const d = dialog({
    title: 'New project', cls: 'hb-new', ok: 'Create',
    body: [tpls,
      h('div', { class: 'hb-field' }, h('label', { for: 'np-name' }, 'Project name'), name),
      h('div', { class: 'hb-field' }, h('label', {}, 'Location'), br.el),
      h('div', { class: 'hb-field' }, h('label', {}, 'Creates'), out)],
    onOk: async () => {
      const n = name.value.trim();
      if (!NAME.test(n)) { name.focus(); throw new Error('Invalid project name: use letters, digits, spaces, . _ -'); }
      if (!br.cur) throw new Error('Pick a location first');
      const r = await api('/api/hub/create', { dir: br.cur.path, name: n, template: d.querySelector('input[name=tpl]:checked').value });
      toast(`Created ${r.path}`);
      await open(r.path);
      return false; // navigating away
    },
  });
  name.focus(); name.select();
}

// pick a folder that contains project.json; fn(path) does the work
function pickProject(title, ok, start, fn) {
  const info = h('div', { class: 'hb-out' });
  const br = browser(start, {
    pick: true,
    onChange: b => { d.okBtn.disabled = !b.sel; info.className = 'hb-out' + (b.sel ? '' : ' dim'); info.textContent = b.sel ?? 'Select a folder marked “project” (it contains project.json).'; },
    onPick: () => d.querySelector('form').requestSubmit(),
  });
  const d = dialog({ title, ok, cls: 'hb-pick', body: [br.el, info], onOk: async () => { if (!br.sel) throw new Error('Select a project folder'); await fn(br.sel); await load(); } });
  d.okBtn.disabled = true;
}
const addProject = () => modal() || pickProject('Add existing project', 'Add', prefs.get('hub.lastDir'), async p => {
  await api('/api/hub/add', { path: p });
  toast(`Added ${p}`);
});
const locate = p => pickProject(`Locate “${p.name}”`, 'Use this folder', prefs.get('hub.lastDir'), async np => {
  await api('/api/hub/add', { path: np });
  if (np !== p.path) await api('/api/hub/remove', { path: p.path });
  toast(`${p.name} now points to ${np}`);
});

// ---------- preferences ----------
async function openPrefs() {
  try { (await import('./preferences.js')).openPreferences(); } catch { fallbackPrefs(); }
}
function fallbackPrefs() {
  const theme = h('select', { id: 'pf-theme', onchange: () => prefs.set('theme', theme.value) },
    ['dark', 'light'].map(v => h('option', { value: v, selected: prefs.get('theme') === v }, v[0].toUpperCase() + v.slice(1))));
  const accent = h('input', { id: 'pf-accent', type: 'color', value: prefs.get('accent'), oninput: () => prefs.set('accent', accent.value) });
  const size = h('input', { id: 'pf-size', type: 'number', min: 9, max: 20, step: 1, value: prefs.get('fontSize'), oninput: () => size.value && prefs.set('fontSize', Math.max(9, Math.min(20, +size.value))) });
  const field = (id, label, input) => h('div', { class: 'hb-field row' }, h('label', { for: id }, label), input);
  dialog({ title: 'Preferences', ok: 'Done', cancel: false, cls: 'hb-prefs',
    body: [field('pf-theme', 'Theme', theme), field('pf-accent', 'Accent colour', accent), field('pf-size', 'Font size (px)', size),
      h('div', { class: 'hb-actions start' }, btn('Reset to defaults', () => { for (const k of ['theme', 'accent', 'fontSize']) prefs.set(k, undefined); theme.value = prefs.get('theme'); accent.value = prefs.get('accent'); size.value = prefs.get('fontSize'); }))] });
  theme.focus();
}

// ---------- boot ----------
await prefs.load();
prefs.onChange(() => prefs.apply());
sortSel.value = prefs.get('hub.sort', 'opened');
sortSel.onchange = () => { prefs.set('hub.sort', sortSel.value); draw(); };
search.oninput = draw;
search.onkeydown = e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); const r = list.querySelector('.hb-row'); if (r) focusRow(r); }
  else if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; draw(); }
};
$('#new').onclick = newProject;
$('#add').onclick = () => addProject();
$('#prefs').onclick = openPrefs;
// Ctrl+N is reserved by Chrome in normal tabs (works in app windows / Firefox), so plain N works too outside inputs
addEventListener('keydown', e => {
  if (modal() || e.altKey || e.shiftKey) return;
  const typing = e.target.closest?.('input, select, textarea');
  if (e.key.toLowerCase() === 'n' && ((e.ctrlKey || e.metaKey) || (!typing && !e.ctrlKey && !e.metaKey))) { e.preventDefault(); newProject(); }
  else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement === document.body) {
    const r = list.querySelector('.hb-row[tabindex="0"]') ?? list.querySelector('.hb-row');
    if (r) { e.preventDefault(); focusRow(r); }
  }
});
addEventListener('pageshow', e => e.persisted && load()); // back from the editor via bfcache: refresh the "open" marker
load();
