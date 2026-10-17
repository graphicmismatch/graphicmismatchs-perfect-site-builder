// Inspector: node mode (header, RectTransform, components, Add Component) and asset mode (preview).
import * as S from '../state.js';
import { reanchor } from '/lib/rect.js';
import { withDefaults } from '/lib/components.js';
import { h, nice, fmt, fmtSize, field, numInput, scrub, menu, popup, listNav, closePopup, accept, hidden } from '../fields.js';
import { icon, compIcon } from '../icons.js';
import { openCode, createScript, createComponent, validName } from '../files.js';

let el, live = [], sig = '', assetPath = null, clipboard = null, presetN = 0;
const fold = (() => { try { return JSON.parse(localStorage.psbFold || '{}'); } catch { return {}; } })();
const saveFold = () => { try { localStorage.psbFold = JSON.stringify(fold); } catch {} };

export function mount(root) {
  el = root;
  el.classList.add('insp');
  S.on('selection', () => { if (S.S.selection.length) assetPath = null; render(); });
  S.on('asset-select', p => { assetPath = p; render(); });
  for (const ev of ['structure', 'load', 'page']) S.on(ev, () => { if (!assetPath) nodeSig() !== sig ? render() : refresh(); });
  S.on('assets', () => (assetPath ? render() : nodeSig() !== sig ? render() : refresh()));
  S.on('props', ids => !assetPath && ids?.some(i => S.S.selection.includes(i)) && (nodeSig() !== sig ? render() : refresh()));
  S.on('anim', () => !assetPath && refresh());
  // drop a component/behaviour from the Project panel to add it (like dropping a script in Unity)
  accept(el, 'application/x-psb-component', t => S.S.selection.length && S.addComponent(S.S.selection.at(-1), t), () => !assetPath && S.S.selection.length > 0);
  render();
}

const refresh = () => live.forEach(u => u());

// Rebuild only when what we show changes shape; otherwise values update in place.
function nodeSig() {
  const n = S.S.P && S.active();
  if (!n) return 'none';
  const st = i => (n.rect.anchorMin[i] !== n.rect.anchorMax[i] ? 1 : 0);
  return JSON.stringify([S.S.selection, n.id === S.root()?.id, st(0), st(1),
    n.components.map(c => [c.type, Object.keys(S.def(c.type)?.props ?? {}), S.S.behaviourMeta[c.type.slice(10)]?.error])]);
}

function render() {
  closePopup();
  const top = el.scrollTop, fk = document.activeElement?.closest?.('[data-k]')?.dataset.k;
  live = [];
  el.replaceChildren();
  if (assetPath) renderAsset(assetPath);
  else renderNode();
  sig = assetPath ? '' : nodeSig();
  refresh();
  el.scrollTop = top;
  if (fk) el.querySelector(`[data-k="${CSS.escape(fk)}"] input:not([type=checkbox]), [data-k="${CSS.escape(fk)}"] textarea`)?.focus();
}

// ---------- bindings ----------
// Value as displayed: animation sample (if any) else the node data. Vector axes fall back to the whole-vector track.
function stateOf(id, path) {
  const hk = S.S.hooks.animState;
  if (!hk) return null;
  const st = hk(id, path);
  if (st) return st;
  const m = /^(.*)\.([xyzw]|\d+)$/.exec(path);
  if (m && !/\.\d+$/.test(m[1])) {
    const p = hk(id, m[1]);
    if (p && Array.isArray(p.value)) return { ...p, value: p.value['xyzw'.indexOf(m[2]) >= 0 ? 'xyzw'.indexOf(m[2]) : +m[2]] };
  }
  return null;
}
function val(id, path) {
  const st = stateOf(id, path);
  return st ? st.value : S.getProp(S.node(id), path);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sel = () => (S.S.P ? S.S.selection.filter(i => S.node(i)) : []);

function setMany(ids, path, v, label) {
  for (const i of ids) S.setProp(i, path, typeof v === 'function' ? v(i) : v, label || ids.length > 1 ? { label: label ?? `Set ${path} (multi)` } : {});
}

// path binding; ids = nodes edited together (multi-select for rect)
function pb(ids, path, dflt) {
  const id = ids.at(-1);
  return {
    id, path,
    get: () => val(id, path) ?? dflt,
    state: () => stateOf(id, path),
    mixed: () => ids.length > 1 && ids.some(i => !same(val(i, path), val(id, path))),
    set: v => setMany(ids, path, v),
    sub: (k, d) => pb(ids, `${path}.${k}`, d ?? dflt?.[k]),
  };
}
// Direct binding for a component that isn't the first of its type (paths only address the first one).
function db(id, ci, key, dflt) {
  const props = () => S.node(id)?.components[ci]?.props;
  const b = {
    id,
    get: () => props()?.[key] ?? dflt,
    set: v => S.edit(`Set ${key} ${id}#${ci}`, () => { const c = S.node(id).components[ci]; (c.props ??= {})[key] = v; }, { kind: 'props', ids: [id], merge: true }),
    sub: (k, d) => arrSub(b, k, d ?? dflt?.[k]),
  };
  return b;
}
function arrSub(b, k, d) {
  const s = { id: b.id, get: () => b.get()?.[k] ?? d, set: v => { const a = structuredClone(b.get() ?? []); a[k] = v; b.set(a); }, sub: (j, dd) => arrSub(s, j, dd) };
  return s;
}
const add = (parent, w, key) => { if (key) w.el.dataset.k = key; parent.append(w.el); live.push(w.update); return w; };

// ---------- node mode ----------
function renderNode() {
  const ids = sel(), n = S.S.P && S.active();
  if (!n) { el.append(h('div', { class: 'in-empty' }, S.S.P ? 'Select a node in the Hierarchy or an asset in the Project window.' : '')); return; }
  const isRoot = n.id === S.root()?.id;

  // header (GameObject)
  const act = h('input', { type: 'checkbox', title: 'Active' });
  act.onchange = () => setMany(ids, 'active', act.checked);
  const name = h('input', { class: 'in-name', spellcheck: 'false' });
  name.onchange = () => name.value.trim() && S.setProp(n.id, 'name', name.value.trim());
  name.onkeydown = e => { if (e.key === 'Enter') name.blur(); else if (e.key === 'Escape') { name.value = n.name; name.blur(); } };
  const head = h('div', { class: 'in-head' }, h('span', { class: 'in-cube', html: icon('node') }), act, name);
  head.dataset.k = 'name';
  live.push(() => {
    const m = S.node(n.id); if (!m) return;
    act.checked = val(n.id, 'active') !== false;
    act.indeterminate = ids.length > 1 && ids.some(i => (val(i, 'active') !== false) !== act.checked);
    if (document.activeElement !== name) name.value = m.name;
    const st = stateOf(n.id, 'active');
    act.classList.toggle('keyed', !!st?.keyed); act.classList.toggle('animated', !!st && !st.keyed);
  });
  el.append(head);
  if (ids.length > 1) el.append(h('div', { class: 'in-multi' }, `${ids.length} objects selected · showing ${n.name}. RectTransform edits apply to all.`));

  el.append(isRoot
    ? section('rect', 'Rect Transform', icon('rect'), null, h('div', { class: 'in-note' }, 'Some values driven by Canvas.'))
    : rectSection(ids, n));

  n.components.forEach((c, ci) => el.append(compSection(n, c, ci)));

  const addBtn = h('button', { class: 'btn in-add' }, 'Add Component');
  addBtn.onclick = () => addComponentPopup(n, addBtn);
  el.append(h('div', { class: 'in-addwrap' }, addBtn));
}

function section(key, title, ic, onMenu, ...body) {
  const open = fold[key] !== false;
  const arrow = h('span', { class: 'sec-ar' });
  const dots = onMenu ? h('button', { class: 'sec-menu', html: icon('dots'), title: 'Options' }) : null;
  const hd = h('div', { class: 'sec-h' }, arrow, h('span', { class: 'sec-ic', html: ic }), h('span', { class: 'sec-t' }, title), dots);
  const bd = h('div', { class: 'sec-b' }, ...body);
  const s = h('div', { class: 'sec' + (open ? ' open' : '') }, hd, bd);
  hd.onclick = e => { if (e.target.closest('.sec-menu')) return; s.classList.toggle('open'); fold[key] = s.classList.contains('open'); saveFold(); };
  if (onMenu) {
    dots.onclick = e => { const r = dots.getBoundingClientRect(); onMenu(r.right - 180, r.bottom); };
    hd.oncontextmenu = e => { e.preventDefault(); onMenu(e.clientX, e.clientY); };
  }
  s.body = bd;
  return s;
}

// ---------- RectTransform ----------
const AX = [[0, 0], [0.5, 0.5], [1, 1], [0, 1]]; // per-axis preset: min/start, center, max/end, stretch
const axisOf = (rt, i) => AX.findIndex(([a, b]) => rt.anchorMin[i] === a && rt.anchorMax[i] === b);

function rectSection(ids, n) {
  const id = n.id, rt = n.rect;
  const stretch = [0, 1].map(i => rt.anchorMin[i] !== rt.anchorMax[i]);
  const pv = i => val(id, `rect.pivot.${i}`);
  // offsetMin / -offsetMax helpers (Unity Left/Top, Right/Bottom)
  const off = (i, nid = id) => { const p = val(nid, `rect.pos.${i}`), s = val(nid, `rect.size.${i}`), v = val(nid, `rect.pivot.${i}`); return [p - v * s, p + (1 - v) * s]; };
  const tintAny = i => () => stateOf(id, `rect.pos.${i}`) ?? stateOf(id, `rect.size.${i}`);
  const offB = (i, end) => ({
    id,
    get: () => (end ? -off(i)[1] : off(i)[0]),
    state: tintAny(i),
    mixed: () => ids.length > 1 && ids.some(x => off(i, x)[end] !== off(i)[end]),
    set: v => {
      const label = `Offset ${i}${end} ${ids.join()}`;
      for (const x of ids) {
        let [mn, mx] = off(i, x);
        end ? (mx = -v) : (mn = v);
        const piv = val(x, `rect.pivot.${i}`), size = mx - mn;
        S.setProp(x, `rect.size.${i}`, Math.round(size * 1e4) / 1e4, { label });
        S.setProp(x, `rect.pos.${i}`, Math.round((mn + piv * size) * 1e4) / 1e4, { label });
      }
    },
  });
  const cell = (lab, b, key, sc = { step: 1 }) => {
    const l = h('label', { class: 'rt-lab' }, lab), ni = numInput(b, sc);
    scrub(l, b, sc);
    const c = h('div', { class: 'rt-cell' }, l, ni.el);
    c.dataset.k = key;
    live.push(ni.update);
    return c;
  };
  const [x, y] = [0, 1];
  const top = h('div', { class: 'rt-grid' },
    stretch[x] ? cell('Left', offB(x, 0), 'rt-l') : cell('Pos X', pb(ids, 'rect.pos.x', 0), 'rt-px'),
    stretch[y] ? cell('Top', offB(y, 0), 'rt-t') : cell('Pos Y', pb(ids, 'rect.pos.y', 0), 'rt-py'),
    stretch[x] ? cell('Right', offB(x, 1), 'rt-r') : cell('Width', pb(ids, 'rect.size.x', 0), 'rt-w'),
    stretch[y] ? cell('Bottom', offB(y, 1), 'rt-b') : cell('Height', pb(ids, 'rect.size.y', 0), 'rt-h'));

  const btn = h('button', { class: 'rt-preset', title: 'Anchor presets' });
  const drawBtn = () => { const r = S.node(id)?.rect; if (r) btn.innerHTML = presetSvg(axisOf(r, 0), axisOf(r, 1)); };
  live.push(drawBtn);
  btn.onclick = () => presetPopup(ids, btn);

  const v2 = (label, path, key, sc) => add(sub, field({ type: 'vec2', ...sc }, pb(ids, path, [0, 0]), label), key);
  const sub = h('div', { class: 'rt-sub' });
  const anchors = h('details', { class: 'rt-anchors' }, h('summary', {}, 'Anchors'));
  anchors.open = fold['rt-anchors'] ?? false;
  anchors.ontoggle = () => { fold['rt-anchors'] = anchors.open; saveFold(); };
  const sc01 = { step: 0.01 };
  add(anchors, field({ type: 'vec2', ...sc01 }, anchorB(ids, 'anchorMin'), 'Min'), 'rt-amin');
  add(anchors, field({ type: 'vec2', ...sc01 }, anchorB(ids, 'anchorMax'), 'Max'), 'rt-amax');
  sub.append(anchors);
  add(sub, field({ type: 'vec2', ...sc01 }, anchorB(ids, 'pivot'), 'Pivot'), 'rt-pv');
  add(sub, field({ type: 'number', step: 1 }, pb(ids, 'rect.rotation', 0), 'Rotation'), 'rt-rot');
  v2('Scale', 'rect.scale', 'rt-sc', sc01);

  const inLayout = S.parentOf(id)?.components.some(c => S.def(c.type)?.childStyle) && !n.components.find(c => c.type === 'LayoutElement')?.props?.ignoreLayout;
  return section('rect', 'Rect Transform', icon('rect'), null,
    inLayout ? h('div', { class: 'in-note' }, 'Position driven by the parent layout group.') : null,
    h('div', { class: 'rt-top' }, btn, top), sub);
}

// mini diagram: ax/ay = preset index per axis (-1 custom)
const SPAN = [[[7, 15], [13, 23], [21, 29], [8, 28]], [[4, 12], [13, 23], [24, 32], [4, 32]]], EDGE = [4, 18, 32];
function presetSvg(ax, ay, shift = false, alt = false) {
  const o = '<rect x="4" y="4" width="28" height="28" class="ps-o"/>';
  if (ax < 0 || ay < 0) return `<svg viewBox="0 0 36 36" class="ps">${o}<text x="18" y="21" class="ps-tx">custom</text></svg>`;
  const [x0, x1] = SPAN[+alt][ax], [y0, y1] = SPAN[+alt][ay];
  const g = [ax === 3 ? 'M4 1V35M32 1V35' : `M${EDGE[ax]} 1V35`, ay === 3 ? 'M1 4H35M1 32H35' : `M1 ${EDGE[ay]}H35`];
  const arrows = (ax === 3 ? 'M10 18H26M10 18l2-2M10 18l2 2M26 18l-2-2M26 18l-2 2' : '') + (ay === 3 ? 'M18 10V26M18 10l-2 2M18 10l2 2M18 26l-2-2M18 26l2-2' : '');
  const pv = shift ? `<circle cx="${ax === 3 ? 18 : [x0, (x0 + x1) / 2, x1][ax]}" cy="${ay === 3 ? 18 : [y0, (y0 + y1) / 2, y1][ay]}" r="2" class="ps-p"/>` : '';
  return `<svg viewBox="0 0 36 36" class="ps">${o}<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" class="ps-i"/><path d="${g.join('')}" class="ps-a"/>${arrows ? `<path d="${arrows}" class="ps-w"/>` : ''}${pv}</svg>`;
}

function applyPreset(ids, ax, ay, shift, alt) {
  const label = `Anchor preset ${++presetN}`;
  for (const id of ids) {
    const n = S.node(id); if (!n || id === S.root().id) continue;
    const [W, H] = S.parentSize(id), rt = structuredClone(n.rect), next = { anchorMin: [...rt.anchorMin], anchorMax: [...rt.anchorMax], pivot: [...rt.pivot] };
    [ax, ay].forEach((a, i) => {
      if (a == null) return;
      [next.anchorMin[i], next.anchorMax[i]] = AX[a];
      if (shift) next.pivot[i] = a === 3 ? 0.5 : AX[a][0];
    });
    const o = reanchor(rt, W, H, next);
    if (alt) [ax, ay].forEach((a, i) => { if (a == null) return; o.pos[i] = 0; if (a === 3) o.size[i] = 0; });
    writeRect(id, rt, o, label);
  }
}

function writeRect(id, rt, o, label) {
  const r4 = v => v.map(z => Math.round(z * 1e4) / 1e4);
  for (const k of ['anchorMin', 'anchorMax', 'pivot', 'pos', 'size']) if (!same(r4(o[k]), rt[k])) S.setProp(id, `rect.${k}`, r4(o[k]), { label });
}

// Anchors/pivot fields keep the rect in place (reanchor), like Unity outside Raw edit mode.
function anchorB(ids, key) {
  const id = ids.at(-1), path = `rect.${key}`;
  const apply = fn => {
    const label = `Set ${key} ${ids.join()}`;
    for (const x of ids) {
      const rt = structuredClone(S.node(x).rect);
      writeRect(x, rt, reanchor(rt, ...S.parentSize(x), { [key]: fn(rt[key]) }), label);
    }
  };
  return {
    id, get: () => val(id, path), state: () => stateOf(id, path),
    mixed: () => ids.length > 1 && ids.some(i => !same(val(i, path), val(id, path))),
    set: v => apply(() => v),
    sub: i => ({
      id, get: () => val(id, path)?.[i], state: () => stateOf(id, `${path}.${i}`),
      mixed: () => ids.length > 1 && ids.some(x => val(x, path)?.[i] !== val(id, path)?.[i]),
      set: v => apply(cur => cur.map((z, j) => (j === i ? v : z))),
    }),
  };
}

function presetPopup(ids, anchor) {
  const rt = S.node(ids.at(-1)).rect, cur = [axisOf(rt, 0), axisOf(rt, 1)];
  const grid = h('div', { class: 'ap-grid' });
  const cells = [];
  const LX = ['left', 'center', 'right', 'stretch'], LY = ['top', 'middle', 'bottom', 'stretch'];
  // header row: horizontal-only presets; first column: vertical-only presets (like Unity's row/column labels)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const b = h('button', { class: 'ap-cell' + (cur[0] === c && cur[1] === r ? ' on' : ''), title: `${LY[r]} ${LX[c]}` });
    b.onclick = e => { pop.close(); applyPreset(ids, c, r, e.shiftKey, e.altKey); };
    cells.push([b, c, r]);
    grid.append(b);
  }
  const colLab = LX.map((l, c) => h('div', { class: 'ap-lab', title: `${l} only (keep vertical)`, onclick: e => { pop.close(); applyPreset(ids, c, null, e.shiftKey, e.altKey); } }, l));
  const rowLab = LY.map((l, r) => h('div', { class: 'ap-lab ap-rl', title: `${l} only (keep horizontal)`, onclick: e => { pop.close(); applyPreset(ids, null, r, e.shiftKey, e.altKey); } }, l));
  const draw = (shift, alt) => cells.forEach(([b, c, r]) => (b.innerHTML = presetSvg(c, r, shift, alt)));
  const hint = h('div', { class: 'ap-hint' }, h('b', {}, 'Anchor Presets'), h('span', {}, 'Shift: Also set pivot   Alt: Also set position'));
  const body = h('div', { class: 'ap' }, hint, h('div', { class: 'ap-main' }, h('div'), h('div', { class: 'ap-cols' }, colLab), h('div', { class: 'ap-rows' }, rowLab), grid));
  body.onpointermove = e => draw(e.shiftKey, e.altKey);
  draw(false, false);
  const pop = popup(body, { anchor, cls: 'ap-pop' });
}

// ---------- components ----------
const compTitle = t => (t.startsWith('component:') ? `${t.slice(10)} (Component)` : t.startsWith('behaviour:') ? `${t.slice(10)} (Script)` : nice(t));

function compSection(n, c, ci) {
  const id = n.id, t = c.type, d = S.def(t);
  const first = n.components.findIndex(x => x.type === t) === ci;
  const key = `${t}`;
  const body = [];
  const missing = !d || (d.custom && !S.S.P.components[t.slice(10)]) || (d.behaviour && !S.S.behaviourMeta[t.slice(10)]);
  const err = d?.behaviour ? S.S.behaviourMeta[t.slice(10)]?.error : d?.custom ? S.S.P.components[t.slice(10)]?.error : null;
  if (missing) body.push(h('div', { class: 'in-warn', html: `${icon('warn')}<span>The associated ${t.startsWith('behaviour:') ? 'script' : 'component'} can not be loaded. Fix or recreate <b>${t.slice(t.indexOf(':') + 1) || t}</b>, or remove it.</span>` }));
  if (err) body.push(h('div', { class: 'in-warn', html: icon('warn') }, h('span', {}, err)));
  const props = Object.entries(d?.props ?? {});
  if (!props.length && !missing && !err) body.push(h('div', { class: 'in-note' }, d?.behaviour ? 'No exposed props. Export `props` from the script to show fields here.' : 'No properties.'));
  const wrap = h('div');
  for (const [k, sc] of props) {
    const b = first ? pb([id], `${t}.${k}`, sc.default) : db(id, ci, k, sc.default);
    add(wrap, field(sc, b, nice(k)), `${ci}.${k}`);
  }
  body.push(wrap);
  if (d?.behaviour || d?.custom) body.push(h('div', { class: 'in-src' }, h('a', { onclick: () => openCode(d.behaviour ? S.S.P.behaviours[t.slice(10)]?.path : `components/${t.slice(10)}.html`) }, 'Edit Script')));

  const count = n.components.length;
  const onMenu = (x, y) => menu([
    { label: 'Reset', disabled: !d, action: () => S.edit('Reset ' + t, () => { S.node(id).components[ci].props = withDefaults(d, {}); }) },
    '-',
    { label: 'Remove Component', action: () => S.removeComponent(id, ci) },
    { label: 'Move Up', disabled: ci === 0, action: () => S.moveComponent(id, ci, ci - 1) },
    { label: 'Move Down', disabled: ci === count - 1, action: () => S.moveComponent(id, ci, ci + 1) },
    '-',
    { label: 'Copy Component', action: () => { clipboard = structuredClone(S.node(id).components[ci]); S.log(`Copied ${compTitle(t)} values`); } },
    { label: 'Paste Component Values', disabled: clipboard?.type !== t, action: () => S.edit('Paste ' + t, () => { S.node(id).components[ci].props = structuredClone(clipboard.props); }) },
    { label: 'Paste Component As New', disabled: !clipboard || (!clipboard.type.startsWith('behaviour:') && S.node(id).components.some(x => x.type === clipboard.type)), action: () => S.edit('Paste new ' + clipboard.type, () => S.node(id).components.splice(ci + 1, 0, structuredClone(clipboard))) },
    ...(d?.behaviour || d?.custom ? ['-', { label: 'Edit Script', action: () => openCode(d.behaviour ? S.S.P.behaviours[t.slice(10)]?.path : `components/${t.slice(10)}.html`) }] : []),
  ], x, y);
  const s = section(key, compTitle(t), compIcon(t, d), onMenu, ...body);
  if (missing) s.classList.add('broken');
  return s;
}

// ---------- Add Component popup ----------
function addComponentPopup(n, anchor) {
  const isRoot = n.id === S.root()?.id, has = t => n.components.some(c => c.type === t);
  const entries = [];
  for (const [t, d] of Object.entries(S.builtins)) if (!has(t) && (!d.root || isRoot)) entries.push({ t, label: nice(t), cat: d.category, ic: compIcon(t, d) });
  for (const name of Object.keys(S.S.P.components)) if (!has('component:' + name)) entries.push({ t: 'component:' + name, label: name, cat: 'Custom Components', ic: icon('component') });
  for (const name of Object.keys(S.S.P.behaviours)) entries.push({ t: 'behaviour:' + name, label: name, cat: 'Scripts', ic: icon('behaviour') });
  const cats = [...new Set(entries.map(e => e.cat))];

  const q = h('input', { class: 'pk-q', placeholder: 'Search', spellcheck: 'false' });
  const title = h('div', { class: 'pk-title ac-title' });
  const list = h('div', { class: 'pk-list ac-list' });
  let view = { cat: null, create: null };
  const pick = t => { pop.close(); S.addComponent(n.id, t); };
  const row = (label, ic, onclick, more) => h('div', { class: 'pk-it', onclick }, h('span', { class: 'th', html: ic ?? '' }), h('span', { class: 'pk-l' }, label), more ? h('span', { class: 'ac-more' }, '›') : null);
  const NEW = [['New Script', 'behaviour'], ['New Component', 'component']];

  function draw() {
    const s = q.value.trim().toLowerCase();
    title.replaceChildren();
    q.hidden = !!view.create;
    if (view.create) return drawCreate();
    if (s) {
      title.append('Search');
      list.replaceChildren(...entries.filter(e => `${e.label} ${e.t} ${e.cat}`.toLowerCase().includes(s)).map(e => row(e.label, e.ic, () => pick(e.t))),
        ...NEW.map(([l, k]) => row(`${l} "${q.value.trim()}"…`, icon(k), () => { view.create = k; draw(); })));
    } else if (view.cat) {
      title.append(h('span', { class: 'ac-back', onclick: () => { view.cat = null; draw(); } }, '‹'), view.cat);
      list.replaceChildren(...entries.filter(e => e.cat === view.cat).map(e => row(e.label, e.ic, () => pick(e.t))));
      if (!list.childElementCount) list.append(h('div', { class: 'ev-empty' }, 'Nothing to add'));
    } else {
      title.append('Component');
      list.replaceChildren(...cats.map(c => row(c, icon('folder'), () => { view.cat = c; q.value = ''; draw(); }, true)),
        ...NEW.map(([l, k]) => row(`${l}…`, icon(k), () => { view.create = k; draw(); })));
    }
    list.firstElementChild?.classList.add('hi');
  }
  function drawCreate() {
    const k = view.create;
    title.append(h('span', { class: 'ac-back', onclick: () => { view.create = null; draw(); q.focus(); } }, '‹'), k === 'behaviour' ? 'New Script' : 'New Component');
    const base = q.value.trim().replace(/[^\w-]/g, '') || (k === 'behaviour' ? 'NewBehaviour' : 'NewComponent');
    const name = h('input', { class: 'pk-q', value: base.replace(/^[^A-Za-z_]+/, '') || 'New', spellcheck: 'false' });
    const msg = h('div', { class: 'ac-msg' });
    const go = h('button', { class: 'btn' }, 'Create and Add');
    const exists = v => (k === 'behaviour' ? S.S.P.behaviours : S.S.P.components)[v];
    const check = () => { const v = name.value.trim(); const bad = !validName(v) ? 'Use letters, digits, _ or -, starting with a letter.' : exists(v) ? `${v} already exists.` : ''; msg.textContent = bad; go.disabled = !!bad; return !bad; };
    name.oninput = check;
    go.onclick = async () => {
      if (!check()) return;
      const v = name.value.trim();
      go.disabled = true;
      try {
        await (k === 'behaviour' ? createScript(v) : createComponent(v));
        pop.close();
        S.addComponent(n.id, `${k}:${v}`);
      } catch (e) { msg.textContent = e.message; go.disabled = false; }
    };
    name.onkeydown = e => { if (e.key === 'Enter') go.click(); };
    list.replaceChildren(h('div', { class: 'ac-create' }, h('label', {}, 'Name'), name, msg,
      h('div', { class: 'in-note' }, k === 'behaviour' ? `Creates behaviours/<name>.js from a template (props, start, update, methods).` : `Creates components/<name>.html (template, style, props, script).`), go));
    check();
    setTimeout(() => { name.focus(); name.select(); });
  }
  q.oninput = () => { view.cat = null; draw(); };
  q.addEventListener('keydown', e => { if (e.key === 'Backspace' && !q.value && view.cat) { view.cat = null; draw(); } });
  listNav(q, list);
  const pop = popup(h('div', { class: 'picker ac' }, title, q, list), { anchor, cls: 'pk ac-pop' });
  pop.el.style.left = `${anchor.getBoundingClientRect().left + anchor.offsetWidth / 2 - pop.el.offsetWidth / 2}px`;
  draw();
  q.focus();
}

// ---------- asset mode ----------
function assetMeta(p) {
  if (p.endsWith('/')) return { kind: 'folder' };
  if (p.startsWith('assets/')) { const a = S.S.P.assets.find(x => x.path === p.slice(7)); return a && { kind: a.type === 'other' ? 'file' : a.type, size: a.size, rel: a.path }; }
  if (p.startsWith('components/')) { const n = p.slice(11, -5); return S.S.P.components[n] && { kind: 'component', name: n }; }
  if (p.startsWith('behaviours/')) { const n = Object.keys(S.S.P.behaviours).find(k => S.S.P.behaviours[k].path === p); return n && { kind: 'behaviour', name: n }; }
  if (p.startsWith('animations/')) { const n = p.slice(11, -10); return S.S.P.clips[n] && { kind: 'anim', name: n }; }
}
const KIND_NAME = { image: 'Image', video: 'Video', audio: 'Audio', json: 'JSON', font: 'Font', text: 'Text', file: 'File', component: 'Custom Component', behaviour: 'Behaviour Script', anim: 'Animation Clip', folder: 'Folder' };
const EDITABLE = ['json', 'text', 'component', 'behaviour', 'anim', 'file'];

function renderAsset(p) {
  const m = assetMeta(p);
  if (!m) { el.append(h('div', { class: 'in-empty' }, `${p} no longer exists.`)); return; }
  const fname = p.replace(/\/$/, '').split('/').pop();
  const info = h('span', { class: 'as-info' }, `${KIND_NAME[m.kind] ?? m.kind}${m.size != null ? ' · ' + fmtSize(m.size) : ''}`);
  const open = EDITABLE.includes(m.kind) && m.kind !== 'anim' ? h('button', { class: 'btn', onclick: () => openCode(p) }, 'Open') : null;
  el.append(h('div', { class: 'in-head as-head' }, h('span', { class: 'as-ic', html: icon(m.kind === 'file' ? 'file' : m.kind) }), h('div', { class: 'as-t' }, h('div', { class: 'as-name' }, fname), info), open));
  el.append(h('div', { class: 'as-path', title: 'Project path' }, p));
  const body = h('div', { class: 'as-body' }), hint = h('div', { class: 'as-hint' });
  el.append(body, hint);
  const url = m.rel != null ? S.assetUrl(m.rel) : null, rel = m.rel;
  const code = s => h('code', { title: 'Click to copy', onclick: () => copy(s) }, s);
  const usage = (...parts) => hint.append(h('b', {}, 'Usage'), h('div', {}, ...parts));
  const sizeOf = text => { if (m.size == null) info.textContent += ` · ${fmtSize(new Blob([text]).size)}`; };

  if (m.kind === 'folder') {
    const dir = p.slice(7, -1), items = S.S.P.assets.filter(a => a.path.startsWith(dir + '/') && !hidden(a.path));
    body.append(h('div', { class: 'in-note' }, `${items.length} file(s), ${fmtSize(items.reduce((s, a) => s + a.size, 0))}`));
    usage('Drop files here in the Project window to import them into ', code(`assets/${dir}/`));
  } else if (m.kind === 'image') {
    const img = h('img', { class: 'as-img', src: url, draggable: 'false' });
    const dims = h('div', { class: 'as-dims' });
    img.onload = () => { dims.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; };
    body.append(h('div', { class: 'as-prev checker' }, img), dims);
    usage('Drag onto an Image ', h('i', {}, 'Sprite'), ' field or into the Scene. Path: ', code(rel), ' · CSS: ', code(`url(assets/${rel})`));
  } else if (m.kind === 'video') {
    const v = h('video', { class: 'as-img', src: url, controls: true, muted: true, preload: 'metadata' });
    const dims = h('div', { class: 'as-dims' });
    v.onloadedmetadata = () => { dims.textContent = `${v.videoWidth} × ${v.videoHeight} · ${v.duration.toFixed(2)} s`; };
    body.append(h('div', { class: 'as-prev' }, v), dims);
    usage('Drag onto a Video ', h('i', {}, 'Src'), ' field (or a Video ', h('i', {}, 'Poster'), ' for images). Path: ', code(rel));
  } else if (m.kind === 'audio') {
    const a = h('audio', { src: url, controls: true, preload: 'metadata', class: 'as-audio' });
    const dims = h('div', { class: 'as-dims' });
    a.onloadedmetadata = () => { dims.textContent = `${a.duration.toFixed(2)} s`; };
    body.append(a, dims);
    usage('Drag onto an Audio ', h('i', {}, 'Src'), ' field; trigger with ', code('Media.play'), ' from a Button event. Path: ', code(rel));
  } else if (m.kind === 'json') {
    const data = S.S.P.json[rel];
    body.append(data === null || data === undefined ? h('div', { class: 'in-warn', html: icon('warn') }, h('span', {}, 'Invalid JSON (could not parse).')) : jsonTree(data, rel));
    usage('Bind any text prop: ', code(`{{${rel}:key.path}}`), '. Click a key to copy its binding. Arrays drive a ', h('i', {}, 'Repeat'), ' (Source = this file, Path = the array key; use ', code('{{item.x}}'), ' inside).');
  } else if (m.kind === 'font') {
    const fam = 'psb-prev-' + rel.replace(/\W/g, '_');
    new FontFace(fam, `url("${url}")`).load().then(f => document.fonts.add(f)).catch(e => S.log(`Font ${rel}: ${e.message}`, 'warn'));
    body.append(h('div', { class: 'as-font', style: `font-family:"${fam}"` }, h('div', { style: 'font-size:28px' }, 'Aa Bb Cc 123'), h('div', {}, 'The quick brown fox jumps over the lazy dog.')));
    usage('Drag onto a Text or Canvas ', h('i', {}, 'Font'), ' field, or type ', code(rel), '.');
  } else if (m.kind === 'anim') {
    const c = S.S.P.clips[m.name];
    body.append(h('div', { class: 'as-kv' }, ...kv({ Length: `${c.length ?? 0} s`, FPS: c.fps ?? 60, Loop: c.loop ? 'yes' : 'no', Tracks: c.tracks?.length ?? 0, Events: c.events?.length ?? 0 })));
    if (c.tracks?.length) body.append(h('div', { class: 'as-list' }, c.tracks.map(tr => h('div', {}, h('span', { class: 'dim' }, (tr.path || '(self)') + ' · '), tr.prop, h('span', { class: 'dim' }, ` · ${tr.keys?.length ?? 0} keys`)))));
    body.append(h('button', { class: 'btn', onclick: () => { S.S.anim.clip = m.name; S.emit('anim'); S.emit('show-tab', 'animation'); } }, 'Open in Animation window'));
    usage('Add to an Animator ', h('i', {}, 'Clips'), ' list (drag it there), or play it from an event: ', code('Animator.play'), ' with arg ', code(m.name), '.');
  } else {
    const pre = h('pre', { class: 'as-src' }, 'Loading…');
    body.append(pre);
    if (m.kind === 'component') {
      const c = S.S.P.components[m.name];
      if (c.error) body.prepend(h('div', { class: 'in-warn', html: icon('warn') }, h('span', {}, c.error)));
      body.prepend(h('div', { class: 'as-kv' }, ...kv({ Tag: `<${c.tag}>`, Props: Object.keys(c.props ?? {}).join(', ') || '—' })));
      usage('Add Component › Custom Components › ', h('b', {}, m.name), ', or drag it onto the Inspector. Renders as ', code(`<${c.tag}>`), '.');
    } else if (m.kind === 'behaviour') {
      const bm = S.S.behaviourMeta[m.name] ?? {};
      if (bm.error) body.prepend(h('div', { class: 'in-warn', html: icon('warn') }, h('span', {}, bm.error)));
      body.prepend(h('div', { class: 'as-kv' }, ...kv({ Props: Object.keys(bm.props ?? {}).join(', ') || '—', Methods: (bm.methods ?? []).join(', ') || '—' })));
      usage('Add Component › Scripts › ', h('b', {}, m.name), ', or drag it onto the Inspector. Call methods from events: ', code(`behaviour:${m.name}.${(bm.methods ?? []).find(x => x !== 'start' && x !== 'update') ?? 'method'}`), '.');
    } else usage('Path: ', code(rel ?? p), m.kind === 'text' ? ' · load at runtime with ' : '', m.kind === 'text' ? code(`PSB.assets.text('${rel}')`) : '');
    S.api.get(p).then(t => { sizeOf(t); pre.textContent = t.length > 20000 ? t.slice(0, 20000) + '\n…' : t; }, e => (pre.textContent = e.message));
  }
}
const kv = o => Object.entries(o).flatMap(([k, v]) => [h('span', { class: 'dim' }, k), h('span', {}, String(v))]);

function copy(s) {
  (navigator.clipboard?.writeText(s) ?? Promise.reject(new Error('no clipboard'))).then(() => S.log(`Copied ${s}`), () => S.log(s));
}

function jsonTree(data, rel) {
  const isObj = v => v && typeof v === 'object';
  const preview = v => (Array.isArray(v) ? `Array(${v.length})` : isObj(v) ? `{${Object.keys(v).length}}` : JSON.stringify(v));
  const node = (k, v, path, depth) => {
    const key = h('span', { class: 'jk', title: `Copy {{${rel}:${path}}}`, onclick: e => { e.preventDefault(); e.stopPropagation(); copy(`{{${rel}:${path}}}`); if (Array.isArray(v)) S.log(`Repeat: Source = ${rel}, Path = ${path}`); } }, k);
    if (!isObj(v)) return h('div', { class: 'jl' }, key, ': ', h('span', { class: 'jv ' + typeof v }, JSON.stringify(v)));
    const d = h('details', { class: 'jd' }, h('summary', {}, key, h('span', { class: 'jp' }, ' ' + preview(v))));
    d.open = depth < 1;
    let filled = false;
    const fill = () => { if (filled) return; filled = true; for (const [ck, cv] of Object.entries(v)) d.append(node(Array.isArray(v) ? `[${ck}]` : ck, cv, Array.isArray(v) ? `${path}[${ck}]` : path ? `${path}.${ck}` : ck, depth + 1)); };
    d.ontoggle = fill;
    if (d.open) fill();
    return d;
  };
  const root = h('div', { class: 'jtree' });
  if (isObj(data)) for (const [k, v] of Object.entries(data)) root.append(node(Array.isArray(data) ? `[${k}]` : k, v, Array.isArray(data) ? `[${k}]` : k, 0));
  else root.append(h('div', { class: 'jl' }, h('span', { class: 'jv' }, JSON.stringify(data))));
  return root;
}
