// Inspector field widgets, popups and pickers.
// A binding is { id, get(), set(v), state?(), mixed?(), sub?(k, dflt) }; every widget returns { el, update }.
import * as S from './state.js';
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...kids) {
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

// Unity's ObjectNames.NicifyVariableName
export const nice = s => String(s).replace(/[-_]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()).trim();
export const fmt = v => (v == null || Number.isNaN(+v) ? '' : String(Math.round(v * 1000) / 1000));
export const fmtSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const focused = e => e.contains(document.activeElement);
export const DEFAULTS = { number: 0, int: 0, bool: false, color: '#ffffff', vec2: [0, 0], vec4: [0, 0, 0, 0], event: [], list: [] };
export const dflt = t => structuredClone(DEFAULTS[t] ?? '');

function tint(el, b) {
  const st = b.state?.();
  el.classList.toggle('keyed', !!st?.keyed);
  el.classList.toggle('animated', !!st && !st.keyed);
}

// ---------- popups / menus ----------
let closeCur = null;
export const closePopup = () => closeCur?.();
export function popup(content, { anchor, x, y, cls = '' } = {}) {
  closePopup();
  const p = h('div', { class: `popup ${cls}` }, content);
  document.body.append(p);
  const r = anchor?.getBoundingClientRect();
  let left = r ? r.left : x, top = r ? r.bottom + 2 : y;
  left = Math.max(4, Math.min(left, innerWidth - p.offsetWidth - 4));
  if (top + p.offsetHeight > innerHeight - 4) top = Math.max(4, r ? r.top - p.offsetHeight - 2 : innerHeight - p.offsetHeight - 4);
  Object.assign(p.style, { left: left + 'px', top: top + 'px' });
  const off = e => { if (!p.contains(e.target)) close(); };
  const close = () => { p.remove(); removeEventListener('pointerdown', off, true); if (closeCur === close) closeCur = null; };
  setTimeout(() => addEventListener('pointerdown', off, true));
  p.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  closeCur = close;
  return { el: p, close };
}

// items: [{ label, action, disabled }] | '-'
export function menu(items, x, y) {
  const m = h('div', { class: 'menu' });
  const p = popup(m, { x, y, cls: 'menu-pop' });
  for (const it of items) {
    if (it === '-') { if (m.lastChild && m.lastChild.tagName !== 'HR') m.append(h('hr')); continue; }
    if (!it) continue;
    m.append(h('div', { class: it.disabled ? 'dis' : '', onclick: () => { if (it.disabled) return; p.close(); it.action(); } }, it.label));
  }
  if (m.lastChild?.tagName === 'HR') m.lastChild.remove();
  return p;
}

// Arrow/Enter navigation over `.pk-it` rows of `list`, driven from a search input.
export function listNav(input, list) {
  input.addEventListener('keydown', e => {
    const its = [...list.querySelectorAll('.pk-it')];
    let i = its.findIndex(x => x.classList.contains('hi'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      i = Math.max(0, Math.min(its.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      its.forEach((x, j) => x.classList.toggle('hi', j === i));
      its[i]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); (its[i] ?? its[0])?.click(); }
  });
}

// items: [{ value, label, sub?, thumb?(), indent? }]
export function picker(title, items, current, onPick, anchor) {
  const q = h('input', { class: 'pk-q', placeholder: 'Search…', spellcheck: 'false' });
  const list = h('div', { class: 'pk-list' });
  const draw = () => {
    const s = q.value.toLowerCase();
    list.replaceChildren(...items.filter(it => !s || it.value === '' || `${it.label} ${it.sub ?? ''}`.toLowerCase().includes(s)).map(it =>
      h('div', { class: 'pk-it' + (it.value === current ? ' on' : ''), style: it.indent && !s ? `padding-left:${6 + it.indent * 12}px` : null, title: it.sub ?? it.label, onclick: () => { p.close(); onPick(it.value); } },
        it.thumb?.() ?? null, h('span', { class: 'pk-l' }, it.label), it.sub ? h('small', {}, it.sub) : null)));
  };
  q.oninput = draw;
  listNav(q, list);
  const p = popup(h('div', { class: 'picker' }, h('div', { class: 'pk-title' }, title), q, list), { anchor, cls: 'pk' });
  draw();
  list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  q.focus();
  return p;
}

// ---------- assets ----------
export let dragAsset = null; // { kind, value } while dragging from the Project panel (dragover can't read data)
export const setDragAsset = a => (dragAsset = a);
export const KIND_LABEL = { image: 'Sprite', video: 'Video Clip', audio: 'Audio Clip', json: 'JSON', font: 'Font', anim: 'Animation Clip', text: 'Text Asset', any: 'Asset' };
export const hidden = p => p.split('/').some(s => s.startsWith('.'));
export const visibleAssets = () => (S.S.P?.assets ?? []).filter(a => !hidden(a.path));
export function assetKind(v) {
  if (dragAsset?.value === v) return dragAsset.kind;
  if (S.S.P?.clips?.[v]) return 'anim';
  return S.S.P?.assets.find(a => a.path === v)?.type;
}
const fits = (kind, want) => kind && (want === 'any' ? kind !== 'anim' : kind === want);
export function thumb(kind, value) {
  if (kind === 'image' && value) return h('img', { class: 'th', src: S.assetUrl(value), loading: 'lazy', draggable: 'false' });
  return h('span', { class: 'th', html: icon(kind ?? 'file') });
}
export function pickAsset(kind, current, onPick, anchor) {
  const vals = kind === 'anim' ? Object.keys(S.S.P?.clips ?? {}).map(v => ({ v, k: 'anim' }))
    : visibleAssets().filter(a => fits(a.type, kind)).map(a => ({ v: a.path, k: a.type }));
  const items = [{ value: '', label: 'None' }, ...vals.map(({ v, k }) => ({ value: v, label: v.split('/').pop(), sub: v.includes('/') ? v.slice(0, v.lastIndexOf('/')) : '', thumb: () => thumb(k, v) }))];
  return picker(`Select ${KIND_LABEL[kind] ?? 'Asset'}`, items, current, onPick, anchor);
}

export function accept(el, type, fn, ok = () => true) {
  el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes(type) || !ok(null)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'link';
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', e => {
    el.classList.remove('drop');
    const v = e.dataTransfer.getData(type);
    if (!v) return;
    e.preventDefault(); e.stopPropagation();
    if (ok(v)) fn(v); else S.log(`${v} can't be used here`, 'warn');
  });
}
const acceptAsset = (el, kind, fn) => accept(el, 'application/x-gpsb-asset', fn, v => (v == null ? !dragAsset || fits(dragAsset.kind, kind) : fits(assetKind(v), kind)));

// ---------- primitives ----------
const evalNum = s => {
  if (!/^[\d\s.+\-*/()eE]+$/.test(s)) return NaN;
  try { return +Function(`"use strict";return (${s})`)(); } catch { return NaN; }
};
export function clampN(v, sc = {}) {
  if (sc.min != null) v = Math.max(sc.min, v);
  if (sc.max != null) v = Math.min(sc.max, v);
  return sc.type === 'int' ? Math.round(v) : Math.round(v * 1e4) / 1e4;
}

export function numInput(b, sc = {}) {
  const inp = h('input', { class: 'num', spellcheck: 'false' });
  const show = () => { inp.value = b.mixed?.() ? '—' : fmt(b.get()); };
  inp.onfocus = () => setTimeout(() => inp.select());
  inp.onchange = () => { const v = evalNum(inp.value); if (Number.isFinite(v)) b.set(clampN(v, sc)); else show(); };
  inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); else if (e.key === 'Escape') { show(); inp.blur(); } };
  return { el: inp, update() { if (!focused(inp)) show(); tint(inp, b); } };
}

// Drag a label horizontally to change a number (Shift x10, Alt x0.1), like Unity.
export function scrub(label, b, sc = {}) {
  label.classList.add('scrub');
  const step = sc.step ?? (sc.min != null && sc.max != null ? (sc.max - sc.min) / 200 : 1);
  label.onpointerdown = e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = +b.get() || 0;
    let acc = 0;
    try { label.setPointerCapture(e.pointerId); } catch {}
    label.onpointermove = m => {
      acc += m.movementX * (m.shiftKey ? 10 : m.altKey ? 0.1 : 1);
      const v = clampN(start + acc * step, sc);
      if (v !== +b.get()) b.set(v);
    };
    label.onpointerup = label.onpointercancel = () => { label.onpointermove = null; };
  };
}

function textW(b, multi, mono) {
  const inp = multi ? h('textarea', { rows: mono ? 6 : 3, spellcheck: mono ? 'false' : 'true', class: mono ? 'mono' : '' }) : h('input', { type: 'text', spellcheck: 'false' });
  inp.oninput = () => b.set(inp.value);
  if (mono) inp.onkeydown = e => codeKeys(e, inp);
  return { el: inp, update() { if (!focused(inp)) inp.value = b.get() ?? ''; tint(inp, b); } };
}

function boolW(b) {
  const cb = h('input', { type: 'checkbox' });
  cb.onchange = () => b.set(cb.checked);
  return { el: h('div', { class: 'f-bool' }, cb), update() { cb.indeterminate = !!b.mixed?.(); cb.checked = !!b.get(); tint(cb, b); } };
}

function enumW(sc, b) {
  const sel = h('select', {}, (sc.options ?? []).map(o => h('option', { value: o }, nice(o))));
  sel.onchange = () => b.set(sel.value);
  return { el: sel, update() { if (!focused(sel)) sel.value = b.get() ?? ''; tint(sel, b); } };
}

const parseColor = v => {
  let m = /^#?([0-9a-f]{3,4})$/i.exec(v ?? '');
  if (m) v = '#' + [...m[1]].map(c => c + c).join('');
  m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v ?? '');
  return m ? ['#' + m[1].toLowerCase(), m[2] ? parseInt(m[2], 16) : 255] : ['#000000', 255];
};
const outColor = (rgb, a) => rgb + (a < 255 ? Math.round(a).toString(16).padStart(2, '0') : '');
function colorW(b) {
  const pick = h('input', { type: 'color', tabindex: -1 });
  const sw = h('span', { class: 'sw-c' }), al = h('span', { class: 'sw-a' });
  const swatch = h('label', { class: 'swatch', title: 'Click to pick a color' }, sw, h('span', { class: 'sw-ab' }, al), pick);
  const alpha = h('input', { type: 'range', min: 0, max: 255, step: 1, class: 'alpha', title: 'Alpha' });
  const hex = h('input', { class: 'hex', spellcheck: 'false', title: '#rrggbb or #rrggbbaa' });
  pick.oninput = () => b.set(outColor(pick.value, parseColor(b.get())[1]));
  alpha.oninput = () => b.set(outColor(parseColor(b.get())[0], +alpha.value));
  hex.onchange = () => { const s = hex.value.trim(); if (/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) b.set(outColor(...parseColor(s))); else w.update(); };
  hex.onkeydown = e => e.key === 'Enter' && hex.blur();
  const w = {
    el: h('div', { class: 'f-color' }, swatch, alpha, hex),
    update() {
      const v = b.get(), [rgb, a] = parseColor(v);
      sw.style.background = rgb; al.style.width = `${(a / 255) * 100}%`;
      if (!focused(w.el)) { pick.value = rgb; alpha.value = a; hex.value = v ?? ''; }
      tint(swatch, b); tint(hex, b);
    },
  };
  return w;
}

function vecW(sc, b, n) {
  const labels = sc.labels ?? ['X', 'Y', 'Z', 'W'];
  const parts = [...Array(n)].map((_, i) => {
    const sb = b.sub(i), lab = h('label', { class: 'v-lab', title: labels[i] }, labels[i].length > 1 ? labels[i][0] : labels[i]);
    scrub(lab, sb, sc);
    const ni = numInput(sb, sc);
    return { el: h('div', { class: 'v-cell' }, lab, ni.el), update: ni.update };
  });
  return { el: h('div', { class: 'f-vec' }, parts.map(p => p.el)), update: () => parts.forEach(p => p.update()) };
}

function hrefW(b) {
  const t = textW(b);
  const sel = h('select', { class: 'f-pages', title: 'Link to a page' });
  sel.onfocus = () => sel.replaceChildren(h('option', { value: '' }, 'Page…'), ...Object.keys(S.S.P?.pages ?? {}).map(p => h('option', { value: p }, p)));
  sel.onchange = () => { if (sel.value) b.set(sel.value); sel.value = ''; sel.blur(); };
  sel.onfocus();
  return { el: h('div', { class: 'f-href' }, t.el, sel), update: t.update };
}

// Unity object field for assets
function assetW(kind, b) {
  const nm = h('span', { class: 'obj-n' }), th = h('span', { class: 'obj-i' });
  const pick = h('button', { class: 'obj-p', html: icon('target'), title: `Select ${KIND_LABEL[kind] ?? 'Asset'}` });
  const box = h('div', { class: 'obj', tabindex: 0 }, th, nm, pick);
  pick.onclick = e => { e.stopPropagation(); pickAsset(kind, b.get() ?? '', v => b.set(v), box); };
  box.onclick = () => { const v = b.get(); if (v) S.emit('asset-ping', kind === 'anim' ? `animations/${v}.anim.json` : `assets/${v}`); };
  box.onkeydown = e => {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); b.set(''); }
    else if (e.key === 'Enter') { e.stopPropagation(); pick.click(); }
  };
  acceptAsset(box, kind, v => b.set(v));
  let last;
  return {
    el: box,
    update() {
      const v = b.get() ?? '';
      if (v !== last) {
        last = v;
        const k = v ? (kind === 'any' ? assetKind(v) : kind) : kind;
        th.replaceChildren(thumb(k, v));
        nm.textContent = v ? v.split('/').pop() : `None (${KIND_LABEL[kind] ?? 'Asset'})`;
        box.title = v || '';
        box.classList.toggle('none', !v);
        box.classList.toggle('missing', !!v && !assetKind(v));
      }
      tint(box, b);
    },
  };
}

function nodeW(b, none = 'None (Node)') {
  const nm = h('span', { class: 'obj-n' });
  const pick = h('button', { class: 'obj-p', html: icon('target'), title: 'Select Node' });
  const box = h('div', { class: 'obj', tabindex: 0, title: 'Drop a node from the Hierarchy; double-click to select it' }, h('span', { class: 'obj-i', html: icon('node') }), nm, pick);
  pick.onclick = e => { e.stopPropagation(); pickNode(b.get(), v => b.set(v), box); };
  box.ondblclick = () => b.get() && S.node(b.get()) && S.select(b.get());
  box.onkeydown = e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); b.set(''); } };
  accept(box, 'application/x-gpsb-node', v => b.set(v), v => v == null || !!S.node(v));
  return {
    el: box,
    update() {
      const id = b.get(), n = id && S.node(id);
      nm.textContent = n ? n.name : id ? `Missing (${id})` : none;
      box.classList.toggle('none', !n);
      box.classList.toggle('missing', !!id && !n);
      tint(box, b);
    },
  };
}
export function pickNode(current, onPick, anchor) {
  const items = [{ value: '', label: 'None' }];
  const go = (n, d) => { items.push({ value: n.id, label: n.name, indent: d, thumb: () => h('span', { class: 'th', html: icon('node') }) }); n.children?.forEach(c => go(c, d + 1)); };
  if (S.root()) go(S.root(), 0);
  return picker('Select Node', items, current, onPick, anchor);
}

// ---------- events (UnityEvent) ----------
const CALL_LABEL = { setActive: 'Node.SetActive', scrollTo: 'Node.ScrollTo', navigate: 'Node.Navigate' };
export function callGroups(tid) {
  const comps = S.node(tid)?.components ?? [], has = t => comps.some(c => c.type === t);
  const g = [['Node', ['setActive', 'scrollTo', 'navigate']]];
  if (has('Animator')) g.push(['Animator', ['Animator.play', 'Animator.stop', 'Animator.pause']]);
  if (has('Video') || has('Audio')) g.push(['Media', ['Media.play', 'Media.pause', 'Media.toggle']]);
  for (const name of new Set(comps.filter(c => c.type.startsWith('behaviour:')).map(c => c.type.slice(10))))
    g.push([`${name} (Script)`, (S.S.behaviourMeta[name]?.methods ?? []).filter(m => m !== 'start' && m !== 'update' && !m.startsWith('_')).map(m => `behaviour:${name}.${m}`)]);
  return g;
}
const callLabel = c => CALL_LABEL[c] ?? c.replace(/^behaviour:/, '');

let dl;
function pagesList() {
  dl ??= document.body.appendChild(h('datalist', { id: 'gpsb-pages' }));
  dl.replaceChildren(...Object.keys(S.S.P?.pages ?? {}).map(p => h('option', { value: p })));
  return 'gpsb-pages';
}

function argW(call, tid, b) {
  if (call === 'setActive') return enumW({ options: ['toggle', 'true', 'false'] }, b);
  if (call === 'Animator.play') {
    const clips = S.node(tid)?.components.find(c => c.type === 'Animator')?.props?.clips ?? [];
    const sel = h('select', {}, h('option', { value: '' }, '(default clip)'), clips.map(c => h('option', { value: c }, c)));
    sel.onchange = () => b.set(sel.value);
    return { el: sel, update() { if (!focused(sel)) sel.value = b.get() ?? ''; } };
  }
  if (call === 'navigate' || call.startsWith('behaviour:')) {
    const t = textW(b);
    t.el.placeholder = call === 'navigate' ? 'page, URL or #anchor' : 'argument (string)';
    if (call === 'navigate') t.el.setAttribute('list', pagesList());
    return t;
  }
  return null;
}

function eventW(sc, b, label) {
  const body = h('div', { class: 'ev-body' });
  const arr = () => structuredClone(b.get() ?? []);
  const put = (i, patch) => { const a = arr(); Object.assign(a[i], patch); b.set(a); };
  let sel = -1, n = -1, rows = [];
  const add = h('button', { class: 'mini', title: 'Add', onclick: () => { const a = arr(); a.push({ target: '', call: '', arg: '' }); sel = a.length - 1; b.set(a); } }, '+');
  const rem = h('button', { class: 'mini', title: 'Remove selected', onclick: () => { const a = arr(); if (!a.length) return; a.splice(sel >= 0 && sel < a.length ? sel : a.length - 1, 1); sel = -1; b.set(a); } }, '−');
  const el = h('div', { class: 'ev', title: sc.help ?? null }, h('div', { class: 'ev-head' }, `${label} ()`), body, h('div', { class: 'ev-foot' }, add, rem));
  const rowFor = i => {
    const entry = () => (b.get() ?? [])[i] ?? {};
    const tgt = nodeW({ id: b.id, get: () => entry().target ?? '', set: v => put(i, { target: v }), state: () => null }, 'Self');
    const call = h('select', { class: 'ev-call' });
    const argBox = h('div', { class: 'ev-arg' });
    call.onchange = () => put(i, { call: call.value, arg: call.value === 'setActive' ? 'toggle' : '' });
    const r = h('div', { class: 'ev-row' + (i === sel ? ' on' : ''), onpointerdown: () => { sel = i; [...body.children].forEach((x, j) => x.classList.toggle('on', j === i)); } }, tgt.el, call, argBox);
    let sig = '', arg = null;
    return {
      el: r,
      update() {
        const e = entry(), tid = e.target || b.id, groups = callGroups(tid);
        tgt.update();
        const s = JSON.stringify([tid, groups, e.call, S.node(tid)?.components.find(c => c.type === 'Animator')?.props?.clips]);
        if (s !== sig) {
          sig = s;
          const known = groups.some(([, cs]) => cs.includes(e.call));
          call.replaceChildren(h('option', { value: '' }, 'No Function'),
            ...(e.call && !known ? [h('option', { value: e.call }, `Missing: ${callLabel(e.call)}`)] : []),
            ...groups.map(([g, cs]) => h('optgroup', { label: g }, cs.map(c => h('option', { value: c }, callLabel(c))))));
          call.value = e.call ?? '';
          call.classList.toggle('missing', !!e.call && !known);
          arg = e.call ? argW(e.call, tid, { get: () => entry().arg ?? '', set: v => put(i, { arg: v }) }) : null;
          argBox.replaceChildren(arg?.el ?? '');
        }
        arg?.update();
      },
    };
  };
  return {
    el, full: true,
    update() {
      const a = b.get() ?? [];
      if (a.length !== n) {
        n = a.length; rows = a.map((_, i) => rowFor(i));
        body.replaceChildren(...(n ? rows.map(r => r.el) : [h('div', { class: 'ev-empty' }, 'List is Empty')]));
      }
      rows.forEach(r => r.update());
    },
  };
}

// ---------- reorderable list ----------
let listDrag = null;
function listW(sc, b, label) {
  const of = { type: sc.of ?? 'string' };
  const items = h('div', { class: 'ls-items' });
  const arr = () => structuredClone(b.get() ?? []);
  const count = h('input', { class: 'num ls-n', title: 'Size' });
  count.onchange = () => { const k = Math.max(0, Math.min(999, Math.round(+count.value) || 0)), a = arr(); while (a.length < k) a.push(a.length ? structuredClone(a.at(-1)) : dflt(of.type)); a.length = k; b.set(a); };
  count.onkeydown = e => e.key === 'Enter' && count.blur();
  const add = h('button', { class: 'mini', title: 'Add', onclick: () => { const a = arr(); a.push(dflt(of.type)); b.set(a); } }, '+');
  const rem = h('button', { class: 'mini', title: 'Remove last', onclick: () => { const a = arr(); a.pop(); b.set(a); } }, '−');
  const el = h('div', { class: 'ls', title: sc.help ?? null }, h('div', { class: 'ls-head' }, h('span', {}, label), count), items, h('div', { class: 'ev-foot' }, add, rem));
  if (of.type.startsWith('asset:')) acceptAsset(el, of.type.slice(6), v => { const a = arr(); a.push(v); b.set(a); });
  let n = -1, rows = [];
  const rowFor = i => {
    const f = field(of, b.sub(i), `Element ${i}`);
    const grip = h('span', { class: 'ls-grip', draggable: 'true', title: 'Drag to reorder' }, '≡');
    const x = h('button', { class: 'mini x', title: 'Remove', onclick: () => { const a = arr(); a.splice(i, 1); b.set(a); } }, '×');
    const r = h('div', { class: 'ls-row' }, grip, f.el, x);
    grip.ondragstart = e => { listDrag = { el, i }; e.dataTransfer.setData('application/x-gpsb-list', String(i)); e.dataTransfer.setDragImage(r, 8, 8); };
    grip.ondragend = () => (listDrag = null);
    r.ondragover = e => { if (listDrag?.el !== el) return; e.preventDefault(); e.stopPropagation(); r.classList.toggle('drop-above', e.offsetY < r.offsetHeight / 2); r.classList.toggle('drop-below', e.offsetY >= r.offsetHeight / 2); };
    r.ondragleave = () => r.classList.remove('drop-above', 'drop-below');
    r.ondrop = e => {
      if (listDrag?.el !== el) return;
      e.preventDefault(); e.stopPropagation();
      const below = r.classList.contains('drop-below');
      r.classList.remove('drop-above', 'drop-below');
      const a = arr(), from = listDrag.i;
      let to = i + (below ? 1 : 0);
      if (from < to) to--;
      if (from !== to) { a.splice(to, 0, a.splice(from, 1)[0]); b.set(a); }
    };
    return { el: r, update: f.update };
  };
  return {
    el, full: true,
    update() {
      const a = b.get() ?? [];
      if (a.length !== n) {
        n = a.length; rows = a.map((_, i) => rowFor(i));
        items.replaceChildren(...(n ? rows.map(r => r.el) : [h('div', { class: 'ev-empty' }, 'List is Empty')]));
      }
      if (!focused(count)) count.value = n;
      rows.forEach(r => r.update());
    },
  };
}

// ---------- field factory ----------
function widget(sc, b, label) {
  const t = sc.type ?? 'string';
  if (t === 'number' || t === 'int') {
    const n = numInput(b, sc);
    if (sc.min == null || sc.max == null) return n;
    const r = h('input', { type: 'range', min: sc.min, max: sc.max, step: sc.step ?? (t === 'int' ? 1 : 'any') });
    r.oninput = () => b.set(clampN(+r.value, sc));
    return { el: h('div', { class: 'f-slider' }, r, n.el), update() { n.update(); if (!focused(r)) r.value = b.get() ?? 0; tint(r, b); } };
  }
  if (t === 'string' && sc.asset) {
    const s = textW(b), kind = sc.asset;
    const pick = h('button', { class: 'obj-p', html: icon('target'), title: `Pick a ${kind} asset`, onclick: () => pickAsset(kind, b.get() ?? '', v => b.set(v), s.el) });
    acceptAsset(s.el, kind, v => b.set(v));
    return { el: h('div', { class: 'f-href' }, s.el, pick), update: s.update };
  }
  if (t === 'string') return textW(b);
  if (t === 'text') return { ...textW(b, true), wide: true };
  if (t === 'code') return { ...textW(b, true, true), wide: true };
  if (t === 'bool') return boolW(b);
  if (t === 'color') return colorW(b);
  if (t === 'enum') return enumW(sc, b);
  if (t === 'vec2') return vecW(sc, b, 2);
  if (t === 'vec4') return vecW(sc, b, 4);
  if (t === 'href') return hrefW(b);
  if (t === 'node') return nodeW(b);
  if (t === 'event') return eventW(sc, b, label);
  if (t === 'list') return listW(sc, b, label);
  if (t.startsWith('asset:')) return assetW(t.slice(6), b);
  return textW(b);
}

export function field(sc, b, label = '') {
  const w = widget(sc, b, label);
  if (w.full) return w;
  const lab = h('label', { class: 'f-lab' }, label);
  if (sc.type === 'number' || sc.type === 'int') scrub(lab, b, sc);
  return { el: h('div', { class: 'f-row' + (w.wide ? ' wide' : ''), title: sc.help ?? null }, lab, w.el), update: w.update };
}

// ---------- code textarea keys (Tab indent, Shift+Tab outdent, Enter keeps indentation) ----------
function insert(ta, text) {
  ta.focus();
  if (!document.execCommand('insertText', false, text)) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
}
export function codeKeys(e, ta) {
  const v = ta.value, a = ta.selectionStart, z = ta.selectionEnd;
  if (e.key === 'Tab') {
    e.preventDefault(); e.stopPropagation();
    if (!e.shiftKey && !v.slice(a, z).includes('\n')) return insert(ta, '  ');
    const s = v.lastIndexOf('\n', a - 1) + 1, block = v.slice(s, z);
    const nb = block.split('\n').map(l => (e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l)).join('\n');
    ta.setSelectionRange(s, z); insert(ta, nb); ta.setSelectionRange(s, s + nb.length);
  } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault(); e.stopPropagation();
    const s = v.lastIndexOf('\n', a - 1) + 1;
    insert(ta, '\n' + /^[ \t]*/.exec(v.slice(s))[0] + (/[{[(]$/.test(v.slice(s, a).trimEnd()) ? '  ' : ''));
  }
}
