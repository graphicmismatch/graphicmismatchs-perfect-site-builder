// Main toolbar: menu bar, transform tools, play/pause/step, page dropdown, save/build.
// Also exports the shared popup menu helper (hierarchy uses it).
import * as S from '../state.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d ? `<path d="${d}"/>` : ''}${extra}</svg>`;
export const ICONS = {
  hand: svg('M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15'),
  move: svg('M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20'),
  rotate: svg('M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5'),
  scale: svg('M14 3h7v7M21 3l-9 9', '<rect x="3" y="12" width="9" height="9" rx="1"/>'),
  rect: svg('', '<rect x="4" y="4" width="16" height="16" rx="1"/><circle cx="4" cy="4" r="1.6" fill="currentColor"/><circle cx="20" cy="4" r="1.6" fill="currentColor"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="20" cy="20" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  play: svg('', '<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
  pause: svg('', '<rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/>'),
  step: svg('', '<path d="M5 4l11 8-11 8z" fill="currentColor"/><rect x="17" y="5" width="3" height="14" fill="currentColor"/>'),
  scene: svg('M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10'),
  save: svg('M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8'),
  build: svg('M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12'),
};
const TOOLS = [['hand', 'Q', 'View Tool'], ['move', 'W', 'Move Tool'], ['rotate', 'E', 'Rotate Tool'], ['scale', 'R', 'Scale Tool'], ['rect', 'T', 'Rect Tool']];
const words = t => t.replace(/(?<=[a-z])(?=[A-Z])/g, ' ');

// ---------- popup menu ----------
// items: [{ label, action, shortcut, disabled, checked, sub: items }, '-' ]. owner: element whose clicks don't close it.
const stack = [];
let owner = null, onClose = null;
export function closeMenus(from = 0) {
  for (const m of stack.splice(from)) m.remove();
  if (stack.length) return;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', escKey, true);
  removeEventListener('blur', closeAll);
  const f = onClose; owner = onClose = null; f?.();
}
const closeAll = () => closeMenus();
const outside = e => { if (!e.target.closest?.('.menu') && !owner?.contains(e.target)) closeMenus(); };
const escKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenus(stack.length > 1 ? stack.length - 1 : 0); } };

export function menu(items, x, y, opts = {}, level = 0) {
  if (level === 0) { closeMenus(); owner = opts.owner ?? null; onClose = opts.onClose ?? null; }
  else closeMenus(level);
  const m = document.createElement('div');
  m.className = 'menu';
  for (const it of items) {
    if (it === '-') { m.append(document.createElement('hr')); continue; }
    const d = document.createElement('div');
    d.className = [it.disabled && 'off', it.sub && 'sub'].filter(Boolean).join(' ');
    d.innerHTML = `<i>${it.checked ? '✓' : ''}</i><span>${esc(it.label)}</span><kbd>${esc(it.shortcut ?? '')}</kbd>`;
    d.onpointerenter = () => {
      if (stack.length > level + 1) closeMenus(level + 1);
      if (!it.sub || it.disabled) return;
      const r = d.getBoundingClientRect();
      const sm = menu(it.sub, r.right, r.top - 5, opts, level + 1);
      if (r.right + sm.offsetWidth > innerWidth) sm.style.left = Math.max(0, r.left - sm.offsetWidth) + 'px';
    };
    d.onclick = e => { e.stopPropagation(); if (it.disabled || it.sub) return; closeMenus(); it.action?.(); };
    m.append(d);
  }
  document.body.append(m);
  m.style.left = Math.max(0, Math.min(x, innerWidth - m.offsetWidth)) + 'px';
  m.style.top = Math.max(0, Math.min(y, innerHeight - m.offsetHeight)) + 'px';
  stack.push(m);
  if (level === 0) {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escKey, true);
    addEventListener('blur', closeAll);
  }
  return m;
}
export const menuAt = (items, el, opts = {}) => { const r = el.getBoundingClientRect(); return menu(items, r.left, r.bottom, { owner: el, ...opts }); };

// ---------- shared actions ----------
const customNode = name => {
  const type = 'component:' + name, n = S.PRESETS['Create Empty']();
  return Object.assign(n, { name, components: [{ type, props: S.propsOf({ type, props: {} }) }], rect: { ...n.rect, size: [300, 200] } });
};
// GameObject create entries (presets except Create Empty + custom components) under parentId.
export function createItems(parentId) {
  const customs = Object.keys(S.S.P?.components ?? {});
  return [
    ...Object.keys(S.PRESETS).filter(k => k !== 'Create Empty').map(k => ({ label: k, action: () => S.create(k, parentId) })),
    ...(customs.length ? ['-', ...customs.map(n => ({ label: n, action: () => S.addNode(customNode(n), parentId) }))] : []),
  ];
}
export function newPagePrompt() {
  const name = prompt('New page name (letters, digits, - and _):', 'page' + (Object.keys(S.S.P.pages).length + 1))?.trim();
  if (!name) return;
  if (!/^[\w-]+$/.test(name)) return S.log(`Invalid page name "${name}"`, 'error');
  S.newPage(name);
}
export function deletePage(name = S.S.page) {
  const names = Object.keys(S.S.P.pages);
  if (names.length < 2) return S.log('Cannot delete the only page', 'warn');
  if (!confirm(`Delete page "${name}"? The file is removed on the next save.`)) return;
  delete S.S.P.pages[name];
  S.S.dirty.add(`pages/${name}.json`);
  S.setPage(name !== S.S.page ? S.S.page : names.includes('index') && name !== 'index' ? 'index' : names.find(n => n !== name));
  S.log(`Deleted page ${name}`);
}
let building = false, refreshFiles = () => {};
export async function buildSite() {
  if (building) return;
  building = true; refreshFiles();
  try { await S.build(); } finally { building = false; refreshFiles(); }
}
export const resetLayout = () => {
  for (const v of ['--left-w', '--right-w', '--bottom-h']) { document.documentElement.style.removeProperty(v); try { delete localStorage['psb' + v]; } catch {} }
  dispatchEvent(new Event('resize'));
};

// ---------- menus ----------
const allIds = () => [...S.walk(S.root())].slice(1).map(([n]) => n.id);
const nonRoot = () => S.S.selection.some(id => id !== S.root()?.id);
function componentItems() {
  const n = S.active();
  if (!n) return [{ label: 'Select a GameObject first', disabled: true }];
  const isRoot = n === S.root(), cats = {};
  for (const [t, d] of Object.entries(S.builtins)) if (!d.root || isRoot) (cats[d.category] ??= []).push(t);
  const item = (t, label = words(t)) => ({ label, disabled: !t.startsWith('behaviour:') && !!S.getComponent(n, t), action: () => S.addComponent(n.id, t) });
  const out = Object.entries(cats).map(([c, types]) => ({ label: c, sub: types.map(t => item(t)) }));
  const customs = Object.keys(S.S.P.components), behs = Object.keys(S.S.P.behaviours);
  out.push('-',
    { label: 'Custom Components', disabled: !customs.length, sub: customs.map(c => item('component:' + c, c)) },
    { label: 'Scripts', disabled: !behs.length, sub: behs.map(b => item('behaviour:' + b, b)) });
  return out;
}
const MENUS = {
  File: () => [
    { label: 'New Page…', action: newPagePrompt },
    { label: 'Delete Page…', action: () => deletePage(), disabled: Object.keys(S.S.P.pages).length < 2 },
    '-',
    { label: 'Save', shortcut: 'Ctrl+S', action: S.save },
    { label: 'Build Site', action: buildSite },
  ],
  Edit: () => {
    const sel = S.S.selection.length > 0;
    return [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: S.undo },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: S.redo },
      '-',
      { label: 'Select All', shortcut: 'Ctrl+A', action: () => S.select(allIds()) },
      { label: 'Deselect All', action: () => S.select([]), disabled: !sel },
      '-',
      { label: 'Rename', shortcut: 'F2', action: () => S.emit('rename'), disabled: !sel },
      { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => S.duplicate(), disabled: !nonRoot() },
      { label: 'Delete', shortcut: 'Del', action: () => S.deleteNodes(), disabled: !nonRoot() },
      '-',
      { label: 'Frame Selected', shortcut: 'F', action: () => S.emit('frame'), disabled: !sel },
      '-',
      { label: S.S.playing ? 'Stop' : 'Play', shortcut: 'Ctrl+P', action: () => S.setPlaying(!S.S.playing) },
      { label: 'Pause', checked: paused, action: togglePause },
    ];
  },
  GameObject: () => {
    const a = S.active();
    return [
      { label: 'Create Empty', action: () => S.create('Create Empty') },
      { label: 'Create Empty Child', action: () => S.create('Create Empty', a.id), disabled: !a },
      '-',
      ...createItems(a?.id),
    ];
  },
  Component: componentItems,
  Window: () => [
    ...[['project', 'Project'], ['console', 'Console'], ['animation', 'Animation'], ['code', 'Generated Code']]
      .map(([t, label]) => ({ label, action: () => S.emit('show-tab', t) })),
    '-',
    { label: 'Reset Layout', action: resetLayout },
  ],
};

// ---------- pause (freezes the play-mode preview: rAF loop, CSS animations, media) ----------
let paused = false, held = [], frozen = [], pauseT = 0;
function applyPause() {
  const w = S.S.previewWin;
  el.querySelector('[data-act=pause]').classList.toggle('on', paused);
  if (!w || !S.S.playing) return;
  try {
    w.psbRaf ??= w.requestAnimationFrame;
    if (paused) {
      w.requestAnimationFrame = cb => (held.push(cb), 0);
      pauseT = w.performance.now();
      frozen = [...w.document.getAnimations().filter(a => a.playState === 'running'), ...[...w.document.querySelectorAll('video, audio')].filter(m => !m.paused)];
      frozen.forEach(a => a.pause());
    } else {
      w.requestAnimationFrame = w.psbRaf;
      held.splice(0).forEach(cb => w.psbRaf.call(w, cb));
      frozen.splice(0).forEach(a => a.play()?.catch?.(() => {}));
    }
  } catch (e) { S.log(`Pause: ${e.message}`, 'warn'); }
}
function togglePause() { paused = !paused; applyPause(); }
function step() {
  if (!S.S.playing) return;
  if (!paused) { paused = true; applyPause(); return; }
  pauseT += 1000 / 60; // one frame: runtimes compute dt from the rAF timestamp
  held.splice(0).forEach(cb => { try { cb(pauseT); } catch (e) { S.log(e.message, 'error', { source: 'page' }); } });
}

// ---------- mount ----------
let el;
export function mount(root) {
  el = root;
  el.innerHTML = `
    <div class="menubar">${Object.keys(MENUS).map(m => `<button data-menu="${m}">${m}</button>`).join('')}</div>
    <div class="tb">
      <div class="tb-left"><div class="tb-group tools">${TOOLS.map(([t, k, tip]) => `<button data-tool="${t}" title="${tip} (${k})">${ICONS[t]}</button>`).join('')}</div></div>
      <div class="tb-center"><div class="tb-group">
        <button data-act="play" title="Play (Ctrl+P)">${ICONS.play}</button><button data-act="pause" title="Pause">${ICONS.pause}</button><button data-act="step" title="Step">${ICONS.step}</button>
      </div></div>
      <div class="tb-right">
        <button class="tb-btn tb-page" data-act="page" title="Current page">${ICONS.scene}<span></span><b>▾</b></button>
        <button class="tb-btn" data-act="save" title="Save (Ctrl+S)">${ICONS.save}<span>Save</span></button>
        <button class="tb-btn primary" data-act="build" title="Save and build the static site">${ICONS.build}<span>Build Site</span></button>
      </div>
    </div>`;

  // menu bar: click opens, hovering another title while open switches (like native menus)
  const bar = el.querySelector('.menubar');
  let openName = null;
  const open = b => {
    if (!S.S.P) return;
    bar.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    openName = b.dataset.menu;
    menuAt(MENUS[openName](), b, { owner: bar, onClose: () => { openName = null; bar.querySelectorAll('.on').forEach(x => x.classList.remove('on')); } });
  };
  bar.onpointerdown = e => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); openName === b.dataset.menu ? closeMenus() : open(b); };
  bar.onpointerover = e => { const b = e.target.closest('button'); if (b && openName && openName !== b.dataset.menu) open(b); };

  el.querySelector('.tools').onclick = e => { const b = e.target.closest('[data-tool]'); if (b) S.setTool(b.dataset.tool); };
  const pageBtn = el.querySelector('[data-act=page]');
  el.querySelector('.tb').onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !S.S.P) return;
    if (act === 'play') S.setPlaying(!S.S.playing);
    else if (act === 'pause') togglePause();
    else if (act === 'step') step();
    else if (act === 'save') S.save();
    else if (act === 'build') buildSite();
    else if (act === 'page') {
      if (stack.length && owner === pageBtn) return closeMenus();
      menuAt([
        ...Object.keys(S.S.P.pages).sort().map(n => ({ label: n, checked: n === S.S.page, action: () => S.setPage(n) })),
        '-',
        { label: 'New Page…', action: newPagePrompt },
        { label: `Delete "${S.S.page}"…`, action: () => deletePage(), disabled: Object.keys(S.S.P.pages).length < 2 },
      ], pageBtn);
    }
  };

  const tool = () => el.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.S.tool));
  const play = () => {
    el.classList.toggle('playing', S.S.playing);
    el.querySelector('[data-act=play]').classList.toggle('on', S.S.playing);
    if (!S.S.playing) { held = []; frozen = []; }
    applyPause();
  };
  const files = refreshFiles = () => {
    if (!S.S.P) return;
    pageBtn.querySelector('span').textContent = S.S.page;
    const save = el.querySelector('[data-act=save]');
    save.classList.toggle('dirty', S.S.dirty.size > 0);
    save.title = S.S.dirty.size ? `Save (Ctrl+S) — unsaved: ${[...S.S.dirty].join(', ')}` : 'Save (Ctrl+S) — no changes';
    const build = el.querySelector('[data-act=build]');
    build.disabled = building;
    build.querySelector('span').textContent = building ? 'Building…' : 'Build Site';
  };
  S.on('tool', tool);
  S.on('play', play);
  S.on('preview-ready', () => paused && applyPause());
  for (const ev of ['load', 'page', 'structure', 'props', 'anim', 'saved']) S.on(ev, files);
  tool();
}
