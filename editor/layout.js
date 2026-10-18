// Docking layout: a tree of splits ({dir: 'row'|'col', sizes, children}) and tabbed areas ({tabs, active}).
// Every panel element is created once and only re-parented. Persisted in prefs 'layout' / 'layouts'.
import * as S from './state.js';
import * as prefs from './prefs.js';
import { menu } from './panels/toolbar.js';

export const TITLES = { hierarchy: 'Hierarchy', scene: 'Scene', inspector: 'Inspector', project: 'Project', console: 'Console', animation: 'Animation', code: 'Generated Code' };
const A = (...tabs) => ({ tabs, active: tabs[0] });
const R = (sizes, ...children) => ({ dir: 'row', sizes, children });
const C = (sizes, ...children) => ({ dir: 'col', sizes, children });
const BOTTOM = ['project', 'console', 'animation', 'code'];
export const PRESETS = {
  Default: () => R([79, 21], C([70, 30], R([20, 80], A('hierarchy'), A('scene')), A(...BOTTOM)), A('inspector')),
  '2 by 3': () => R([46, 16, 16, 22], C([62, 38], A('scene'), A('animation', 'console', 'code')), A('hierarchy'), A('project'), A('inspector')),
  '4 Split': () => R([78, 22], C([58, 42], R([24, 76], A('hierarchy'), A('scene')), R([40, 60], A('project', 'console'), A('animation', 'code'))), A('inspector')),
  Tall: () => R([56, 20, 24], A('scene'), C([45, 55], A('hierarchy'), A(...BOTTOM)), A('inspector')),
  Wide: () => R([78, 22], C([64, 36], A('scene'), R([28, 72], A('hierarchy'), A(...BOTTOM))), A('inspector')),
};

let L, dock, bin, panels = {}, maxArea = null, hoverArea = null, drag = null;
const areas = (n = L.root, out = []) => { if (n.tabs) out.push(n); else n.children.forEach(c => areas(c, out)); return out; };
const parentOf = (n, p = L.root) => p.children?.includes(n) ? p : p.children?.map(c => parentOf(n, c)).find(Boolean) ?? null;
const areaOf = name => areas().find(a => a.tabs.includes(name));
export const isOpen = name => !!areaOf(name);
export const layoutName = () => L.name;

// drop empty areas, unwrap single-child splits, merge nested splits of the same direction, keep each panel once
function normalize(n, seen = new Set()) {
  if (n.tabs) {
    n.tabs = n.tabs.filter(t => TITLES[t] && !seen.has(t) && seen.add(t));
    if (!n.tabs.includes(n.active)) n.active = n.tabs[0];
    return n.tabs.length ? n : null;
  }
  const kids = [], sizes = [];
  n.children.forEach((c, i) => {
    const k = normalize(c, seen), s = +n.sizes?.[i] || 1;
    if (!k) return;
    if (k.dir === n.dir) { const t = k.sizes.reduce((a, b) => a + b, 0); k.children.forEach((g, j) => { kids.push(g); sizes.push(s * k.sizes[j] / t); }); }
    else { kids.push(k); sizes.push(s); }
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  return Object.assign(n, { children: kids, sizes });
}

function save() { prefs.set('layout', structuredClone(L)); }
function render() {
  maxArea = null;
  dock.replaceChildren(build(L.root));
  for (const [name, el] of Object.entries(panels)) if (!isOpen(name)) bin.append(el);
  dispatchEvent(new Event('resize'));
  S.emit('layout');
}
function build(n) {
  if (n.tabs) {
    const a = document.createElement('section');
    a.className = 'area';
    a.node = n;
    const nav = document.createElement('nav');
    nav.className = 'tabs';
    for (const t of n.tabs) {
      const b = document.createElement('button');
      Object.assign(b, { textContent: TITLES[t], draggable: true, className: t === n.active ? 'on' : '' });
      b.dataset.tab = t;
      nav.append(b);
    }
    a.append(nav);
    for (const t of n.tabs) { panels[t].hidden = t !== n.active; a.append(panels[t]); }
    return a;
  }
  const box = document.createElement('div');
  box.className = 'dock-split dock-' + n.dir;
  n.children.forEach((c, i) => {
    if (i) box.append(splitter(n, i - 1, box));
    const el = build(c);
    el.style.flex = `${n.sizes[i]} 1 0`;
    box.append(el);
  });
  return box;
}
function splitter(n, i, box) {
  const s = document.createElement('div'), row = n.dir === 'row';
  s.className = 'split ' + (row ? 'v' : 'h');
  s.onpointerdown = e => {
    s.setPointerCapture(e.pointerId);
    s.classList.add('drag'); document.body.classList.add(row ? 'resizing-v' : 'resizing-h');
    const [a, b] = [s.previousElementSibling, s.nextElementSibling];
    const pa = row ? a.offsetWidth : a.offsetHeight, pb = row ? b.offsetWidth : b.offsetHeight;
    const sum = n.sizes[i] + n.sizes[i + 1], start = row ? e.clientX : e.clientY;
    s.onpointermove = m => {
      const d = Math.max(80 - pa, Math.min(pb - 80, (row ? m.clientX : m.clientY) - start));
      n.sizes[i] = sum * (pa + d) / (pa + pb); n.sizes[i + 1] = sum - n.sizes[i];
      a.style.flex = `${n.sizes[i]} 1 0`; b.style.flex = `${n.sizes[i + 1]} 1 0`;
    };
    s.onpointerup = () => {
      s.onpointermove = null; s.classList.remove('drag'); document.body.classList.remove('resizing-h', 'resizing-v');
      save(); dispatchEvent(new Event('resize'));
    };
  };
  return s;
}

// ---------- public API ----------
export function setLayout(name, root, persist = true) {
  L = { name, root: normalize(structuredClone(root)) ?? PRESETS.Default() };
  render();
  if (persist) save();
  S.emit('structure'); // the Scene's iframes reload when re-parented
}
export const applyPreset = name => setLayout(name, (PRESETS[name] ?? (() => prefs.get('layouts', {})[name]))());

export function show(name) {
  let a = areaOf(name);
  if (!a) { // reopen next to the bottom panels (or the last area)
    a = areas().find(x => x.tabs.some(t => BOTTOM.includes(t))) ?? areas().at(-1);
    a.tabs.push(name); a.active = name;
    render(); save(); S.emit('structure');
    return;
  }
  if (a.active === name) return;
  a.active = name;
  const el = [...dock.querySelectorAll('.area')].find(x => x.node === a);
  el.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  for (const t of a.tabs) panels[t].hidden = t !== name;
  save();
  dispatchEvent(new Event('resize'));
}
export function close(name) {
  const a = areaOf(name);
  if (!a) return;
  if (areas().length === 1 && a.tabs.length === 1) return S.log('Cannot close the last panel', 'warn');
  a.tabs.splice(a.tabs.indexOf(name), 1);
  L.root = normalize(L.root);
  render(); save(); S.emit('structure');
}
export function toggleMaximize(area = hoverArea) {
  const el = area && [...dock.querySelectorAll('.area')].find(x => x.node === area);
  const was = maxArea;
  dock.querySelectorAll('.area.max').forEach(x => x.classList.remove('max'));
  maxArea = was === area ? null : area;
  if (maxArea && el) el.classList.add('max');
  dispatchEvent(new Event('resize'));
}

// move tab `name` into `target` area at index, or to an edge ('left'|'right'|'top'|'bottom') of `target` (area or root)
function move(name, target, where, index) {
  const src = areaOf(name);
  if (where === 'center' && src === target) {
    const old = src.tabs.indexOf(name);
    src.tabs.splice(old, 1);
    src.tabs.splice(index != null && index > old ? index - 1 : index ?? src.tabs.length, 0, name);
    src.active = name;
    return commit();
  }
  if (where !== 'center' && src === target && src.tabs.length === 1) return;
  src?.tabs.splice(src.tabs.indexOf(name), 1);
  if (where === 'center') { target.tabs.splice(index ?? target.tabs.length, 0, name); target.active = name; return commit(); }
  const dir = where === 'left' || where === 'right' ? 'row' : 'col', first = where === 'left' || where === 'top';
  const fresh = A(name), p = parentOf(target);
  if (p?.dir === dir) {
    const i = p.children.indexOf(target), part = p.sizes[i] * 0.3;
    p.sizes[i] -= part;
    p.children.splice(first ? i : i + 1, 0, fresh); p.sizes.splice(first ? i : i + 1, 0, part);
  } else {
    const split = { dir, sizes: first ? [30, 70] : [70, 30], children: first ? [fresh, target] : [target, fresh] };
    if (p) p.children[p.children.indexOf(target)] = split; else L.root = split;
  }
  commit();
}
function commit() { L.root = normalize(L.root); render(); save(); S.emit('structure'); }

// ---------- menus ----------
const label = a => a.tabs.map(t => TITLES[t]).join(', ');
function tabMenu(name, area, x, y) {
  const closed = Object.keys(TITLES).filter(t => !isOpen(t));
  menu([
    { label: maxArea === area ? 'Restore' : 'Maximize', shortcut: 'Shift+Space', action: () => toggleMaximize(area) },
    { label: 'Close Tab', action: () => close(name) },
    '-',
    { label: 'Move to', sub: [
      ...areas().filter(a => a !== area).map(a => ({ label: label(a), action: () => move(name, a, 'center') })),
      '-',
      ...['left', 'right', 'top', 'bottom'].map(w => ({ label: `New area: ${w[0].toUpperCase() + w.slice(1)}`, action: () => move(name, L.root, w) })),
    ] },
    { label: 'Add Tab', disabled: !closed.length, sub: closed.map(t => ({ label: TITLES[t], action: () => move(t, area, 'center') })) },
  ], x, y);
}
export function layoutMenu() {
  const saved = Object.keys(prefs.get('layouts', {}));
  return [
    ...Object.keys(PRESETS).map(n => ({ label: n, checked: L.name === n, action: () => applyPreset(n) })),
    ...(saved.length ? ['-', ...saved.map(n => ({ label: n, checked: L.name === n, action: () => applyPreset(n) }))] : []),
    '-',
    { label: 'Save Layout…', action: () => {
      const n = prompt('Save the current layout as:', PRESETS[L.name] ? 'My Layout' : L.name)?.trim();
      if (!n) return;
      if (PRESETS[n]) return S.log(`"${n}" is a built-in layout name`, 'warn');
      prefs.set('layouts', { ...prefs.get('layouts', {}), [n]: structuredClone(L.root) });
      L.name = n; save(); S.emit('layout');
    } },
    { label: 'Delete Layout', disabled: !saved.length, sub: saved.map(n => ({ label: n, action: () => {
      if (!confirm(`Delete layout "${n}"?`)) return;
      const all = { ...prefs.get('layouts', {}) }; delete all[n];
      prefs.set('layouts', Object.keys(all).length ? all : undefined);
      if (L.name === n) { L.name = 'Default'; save(); }
      S.emit('layout');
    } })) },
    { label: 'Revert Factory Settings', action: () => {
      if (!confirm('Restore the default layout and delete all saved layouts?')) return;
      prefs.set('layouts', undefined);
      applyPreset('Default');
    } },
  ];
}
export const windowItems = () => Object.entries(TITLES).map(([t, l]) => ({ label: l, checked: isOpen(t), action: () => S.emit('show-tab', t) }));

// ---------- tab drag & drop ----------
const TYPE = 'application/x-gpsb-tab';
function zone(e) {
  const a = e.target.closest?.('.area');
  if (!a || !dock.contains(a)) return null;
  const nav = a.querySelector(':scope > .tabs');
  if (nav.contains(e.target) || e.clientY < nav.getBoundingClientRect().bottom) {
    const bs = [...nav.children], i = bs.findIndex(b => { const r = b.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
    return { el: a, area: a.node, where: 'center', index: i < 0 ? bs.length : i, nav };
  }
  const r = a.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const d = { left: x, right: 1 - x, top: y, bottom: 1 - y }, [where, v] = Object.entries(d).sort((p, q) => p[1] - q[1])[0];
  return { el: a, area: a.node, where: v < 0.25 ? where : 'center' };
}
function mark(z) {
  const box = document.getElementById('dock-drop'), ind = document.getElementById('dock-ind');
  box.hidden = ind.hidden = true;
  if (!z) return;
  if (z.nav) {
    const bs = [...z.nav.children], b = bs[z.index] ?? bs.at(-1), r = b.getBoundingClientRect();
    Object.assign(ind.style, { left: (z.index < bs.length ? r.left : r.right) - 1 + 'px', top: r.top + 'px', height: r.height + 'px' });
    ind.hidden = false;
  }
  const r = z.el.getBoundingClientRect(), s = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (z.where === 'left' || z.where === 'right') { s.width = r.width * 0.3; if (z.where === 'right') s.left = r.right - s.width; }
  if (z.where === 'top' || z.where === 'bottom') { s.height = r.height * 0.3; if (z.where === 'bottom') s.top = r.bottom - s.height; }
  Object.assign(box.style, Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v + 'px'])));
  box.hidden = false;
}

export function init(el, panelEls) {
  dock = el; panels = panelEls;
  bin = Object.assign(document.createElement('div'), { id: 'dock-closed' });
  document.body.append(bin,
    Object.assign(document.createElement('div'), { id: 'dock-drop', hidden: true }),
    Object.assign(document.createElement('div'), { id: 'dock-ind', hidden: true }));
  const l = prefs.get('layout');
  setLayout(l?.root ? l.name ?? 'Custom' : 'Default', l?.root ?? PRESETS.Default(), false);

  dock.addEventListener('pointerover', e => { hoverArea = e.target.closest('.area')?.node ?? hoverArea; });
  dock.addEventListener('click', e => { const b = e.target.closest('.tabs > button'); if (b) S.emit('show-tab', b.dataset.tab); });
  dock.addEventListener('dblclick', e => { const b = e.target.closest('.tabs > button'); if (b) toggleMaximize(b.closest('.area').node); });
  dock.addEventListener('contextmenu', e => {
    const b = e.target.closest('.tabs > button');
    if (!b) return;
    e.preventDefault();
    tabMenu(b.dataset.tab, b.closest('.area').node, e.clientX, e.clientY);
  });
  dock.addEventListener('dragstart', e => {
    const b = e.target.closest?.('.tabs > button');
    if (!b) return;
    drag = b.dataset.tab;
    e.dataTransfer.setData(TYPE, drag);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => document.body.classList.add('dock-dragging'));
  });
  dock.addEventListener('dragover', e => {
    if (!drag || !e.dataTransfer.types.includes(TYPE)) return;
    e.preventDefault(); e.stopPropagation();
    const z = zone(e);
    mark(z);
    e.dataTransfer.dropEffect = z ? 'move' : 'none';
  }, true);
  dock.addEventListener('drop', e => {
    if (!drag || !e.dataTransfer.types.includes(TYPE)) return;
    e.preventDefault(); e.stopPropagation();
    const z = zone(e), name = drag;
    end();
    if (z) move(name, z.area, z.where, z.index);
  }, true);
  const end = () => { drag = null; mark(null); document.body.classList.remove('dock-dragging'); };
  dock.addEventListener('dragend', end);
  S.on('show-tab', show);
  try { for (const k of ['gpsbTab', 'gpsb--left-w', 'gpsb--right-w', 'gpsb--bottom-h']) delete localStorage[k]; } catch {} // pre-prefs storage
}
