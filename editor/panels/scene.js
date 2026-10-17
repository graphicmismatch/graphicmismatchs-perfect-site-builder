// Scene | Game view (Unity style): double-buffered preview iframes, pan/zoom, selection overlay,
// rect/move/rotate/scale tools, anchor flower + pivot, asset drops, Game view for play mode.
import * as S from '../state.js';
import { reanchor } from '/lib/rect.js';

const RES = [[1920, 1080], [1280, 720], [1366, 768], [1440, 900], [390, 844, 'phone'], [768, 1024, 'tablet']];
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
const cfg = { grid: true, gizmos: true, snap: false, inc: 10, scale: 1, res: null };
try { Object.assign(cfg, JSON.parse(localStorage.psbScene || '{}')); } catch {}
const saveCfg = () => { try { localStorage.psbScene = JSON.stringify(cfg); } catch {} };
const ROT = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><g fill='none' stroke-linecap='round'><path d='M5 11a5 5 0 1 0 5-5' stroke='white' stroke-width='4'/><path d='M5 11a5 5 0 1 0 5-5' stroke='black' stroke-width='1.6'/></g><path d='M10 2v8l4-4z' stroke='white' stroke-width='1'/></svg>")}") 10 10, crosshair`;

// page console/errors -> editor console (end of <head>: before any deferred module or body script runs)
const HOOK = `<script>(() => {
  const f = frameElement && frameElement.psbLog; if (!f) return;
  const str = a => a.map(x => typeof x === 'string' ? x : x instanceof Error ? x.stack || x.message : (() => { try { return JSON.stringify(x) ?? String(x); } catch { return String(x); } })()).join(' ');
  for (const [k, l] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) { const o = console[k]; console[k] = (...a) => { o.apply(console, a); f(str(a), l); }; }
  addEventListener('error', e => f(e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''), 'error'));
  addEventListener('unhandledrejection', e => f('Unhandled rejection: ' + (e.reason && e.reason.stack || e.reason), 'error'));
})();</script>`;

const r3 = n => Math.round(n * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
const vec = (M, x, y) => { const a = M.transformPoint({ x: 0, y: 0 }), b = M.transformPoint({ x, y }); return { x: b.x - a.x, y: b.y - a.y }; };
const axis = (M, x, y) => { const v = vec(M, x, y); return norm(v.x, v.y); };
const along = (p, u, l) => ({ x: p.x + u.x * l, y: p.y + u.y * l });
const ang = (c, p) => Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI;
const f1 = n => n.toFixed(1);
const pts = a => a.map(p => f1(p.x) + ',' + f1(p.y)).join(' ');
const line = (a, b, c) => `<line class="${c}" x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}"/>`;
const poly = (p, c) => `<polygon class="${c}" points="${pts(p)}"/>`;
const circ = (p, r, c) => `<circle class="${c}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${r}"/>`;
const sq = (p, r, c) => `<rect class="${c}" x="${f1(p.x - r)}" y="${f1(p.y - r)}" width="${2 * r}" height="${2 * r}"/>`;
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function inside(p, q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], c = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    if (c) { if (s && c !== s) return false; s = c; }
  }
  return true;
}

let el, view, world, sizer, svg, frames, zoomSel;
let front = 0, gen = 0, win = null, pageH = 0, fitted = false, queued = false, propsTimer = 0;
let pan = { x: 40, y: 40 }, zoom = 0.5, mode = 'scene', prevMode = 'scene';
let drag = null, hover = null, hotKey = null, spaceDown = false, lastClick = null, seq = 0, lastSvg = '';

// ---------- geometry ----------
const stage = () => new DOMMatrix([zoom, 0, 0, zoom, pan.x, pan.y]);
const box = e => { const cs = e.ownerDocument.defaultView.getComputedStyle(e); return [parseFloat(cs.width) || e.offsetWidth, parseFloat(cs.height) || e.offsetHeight]; };
// element box -> iframe document coords: cumulative transform along the offsetParent chain (exact for rotated/scaled nesting)
function elMatrix(e) {
  const w = e.ownerDocument.defaultView;
  let m = new DOMMatrix();
  for (; e; e = e.offsetParent) {
    const cs = w.getComputedStyle(e), p = e.offsetParent, abs = cs.position === 'absolute'; // computed left/top are sub-pixel exact
    const l = new DOMMatrix().translateSelf((abs ? parseFloat(cs.left) : e.offsetLeft) + (p ? p.clientLeft - p.scrollLeft : 0),
      (abs ? parseFloat(cs.top) : e.offsetTop) + (p ? p.clientTop - p.scrollTop : 0));
    if (cs.transform !== 'none') {
      const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
      l.translateSelf(ox, oy).multiplySelf(new DOMMatrix(cs.transform)).translateSelf(-ox, -oy);
    }
    m = l.multiplySelf(m);
  }
  return m;
}
function info(id) {
  const e = win?.PSB?.el(id);
  if (!e?.offsetParent) return null; // inactive / missing
  const M = stage().multiplySelf(elMatrix(e)), [w, h] = box(e);
  return { e, M, w, h, q: [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => M.transformPoint({ x, y })) };
}
// parent's layout space (padding box, unscrolled) -> view
function parentFrame(id) {
  const p = S.parentOf(id), e = p && win?.PSB?.el(p.id);
  if (!e) return null;
  return { M: stage().multiplySelf(elMatrix(e)).translateSelf(e.clientLeft - e.scrollLeft, e.clientTop - e.scrollTop), P: box(e) };
}
function inLayout(id) {
  const p = S.parentOf(id);
  return !!p?.components.some(c => S.def(c.type)?.childStyle) && !S.getComponent(S.node(id), 'LayoutElement')?.props?.ignoreLayout;
}
// rect as currently displayed (record mode shows animated values)
function rect0(id) {
  const r = S.clone(S.node(id).rect), st = S.S.hooks.animState;
  if (st) for (const k of Object.keys(r)) {
    const v = st(id, 'rect.' + k)?.value;
    if (v !== undefined) r[k] = S.clone(v);
    else if (Array.isArray(r[k])) r[k] = r[k].map((x, i) => st(id, `rect.${k}.${'xy'[i]}`)?.value ?? x);
  }
  return r;
}
// drag-start snapshot: every drag is computed from this, so it never drifts
function snap0(id) {
  const i = info(id), pf = parentFrame(id);
  if (!i || !pf) return null;
  return { id, r: rect0(id), M: i.M, Mi: i.M.inverse(), w: i.w, h: i.h, Mp: pf.M, Mpi: pf.M.inverse(), P: pf.P, Mn: pf.M.inverse().multiplySelf(i.M), lay: inLayout(id) };
}
const isAnc = (a, id) => { for (let p = S.parentOf(id); p; p = S.parentOf(p.id)) if (p.id === a) return true; return false; };
const movable = () => {
  const sel = S.S.selection.filter(id => S.node(id) && S.parentOf(id) && !inLayout(id));
  return sel.filter(id => !sel.some(o => o !== id && isAnc(o, id)));
};
// new pos/size for box [l,t,w,h] given in the node's start-local px, pivot pv, keeping its on-screen placement
function place(t, l, tp, w, h, pv = t.r.pivot) {
  const { r, P } = t, c = t.Mn.transformPoint({ x: l + pv[0] * w, y: tp + pv[1] * h }), C = [c.x, c.y], E = [w, h], pos = [], size = [];
  for (const i of [0, 1]) {
    const span = r.anchorMax[i] - r.anchorMin[i];
    pos[i] = C[i] - (r.anchorMin[i] + pv[i] * span) * P[i];
    size[i] = E[i] - span * P[i];
  }
  return { pos, size };
}
const snapping = e => cfg.snap || e.ctrlKey || e.metaKey;
const snapv = x => { const s = +cfg.inc || 1; return Math.round(x / s) * s; };
function put(id, k, v, label = drag?.label) {
  v = Array.isArray(v) ? v.map(r3) : r3(v);
  if (JSON.stringify(v) !== JSON.stringify(S.node(id)?.rect[k])) S.setProp(id, 'rect.' + k, v, { label });
}

// ---------- gizmo handles for the active node (ordered by hit priority) ----------
function geo() {
  const id = S.S.selection.at(-1), n = id && S.node(id), tool = S.S.tool;
  const i = n && S.parentOf(id) && tool !== 'hand' && info(id), pf = i && parentFrame(id);
  if (!pf) return null;
  const lay = inLayout(id), r = n.rect, q = i.q, h = [];
  const pv = i.M.transformPoint({ x: r.pivot[0] * i.w, y: r.pivot[1] * i.h });
  const add = (k, test, svg, o = {}) => h.push({ k, test, svg, key: k + [o.hx, o.hy, o.c, o.ax].join(), ...o });
  if (tool === 'rect') {
    if (cfg.gizmos && !lay) {
      const ux = axis(pf.M, 1, 0), uy = axis(pf.M, 0, 1), mn = r.anchorMin, mx = r.anchorMax;
      const A = (fx, fy) => pf.M.transformPoint({ x: fx * pf.P[0], y: fy * pf.P[1] });
      for (const c of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const T = A(c[0] ? mx[0] : mn[0], c[1] ? mx[1] : mn[1]), sx = c[0] ? 1 : -1, sy = c[1] ? 1 : -1;
        const d = norm(sx * ux.x + sy * uy.x, sx * ux.y + sy * uy.y), b = along(T, d, 13);
        const tri = [T, { x: b.x - d.y * 6, y: b.y + d.x * 6 }, { x: b.x + d.y * 6, y: b.y - d.x * 6 }], cen = along(T, d, 9);
        add('anchor', p => dist(p, cen) < 7, hc => poly(tri, 'anc' + hc), { c });
      }
      const split = mn[0] !== mx[0] || mn[1] !== mx[1], C = A((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2);
      if (split) add('deco', () => false, () => poly([A(mn[0], mn[1]), A(mx[0], mn[1]), A(mx[0], mx[1]), A(mn[0], mx[1])], 'arect'));
      add('anchor', p => dist(p, C) < 6 && (split || dist(p, pv) > 8), hc => (split ? circ(C, 3.5, 'anc' + hc) : ''), { c: 'all' });
    }
    add('pivot', p => dist(p, pv) < 7, hc => circ(pv, 5, 'piv' + hc));
    const HC = [[-1, -1], [1, -1], [1, 1], [-1, 1]], cur = (hx, hy) => {
      const u = axis(i.M, hx, hy);
      return ['ew', 'nwse', 'ns', 'nesw'][((Math.round(Math.atan2(u.y, u.x) / (Math.PI / 4)) % 4) + 4) % 4] + '-resize';
    };
    q.forEach((p, j) => add('resize', t => dist(t, p) < 7, hc => circ(p, 4, 'hnd' + hc), { hx: HC[j][0], hy: HC[j][1], cur: cur(...HC[j]) }));
    q.forEach((p, j) => {
      const [hx, hy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][j], b = q[(j + 1) % 4];
      add('resize', t => segDist(t, p, b) < 5, () => '', { hx, hy, cur: cur(hx, hy) });
    });
    q.forEach(p => add('rotate', t => { const d = dist(t, p); return d > 6 && d < 24 && !inside(t, q); }, () => ''));
  } else if (tool === 'move' && !lay) {
    for (const [ax, u, c] of [[[1, 0], axis(pf.M, 1, 0), 'ax'], [[0, 1], axis(pf.M, 0, 1), 'ay']]) {
      const E = along(pv, u, 80), tip = along(E, u, 14);
      add('move', t => (segDist(t, pv, E) < 6 && dist(t, pv) > 9) || dist(t, along(E, u, 6)) < 9,
        hc => line(pv, E, c + hc) + poly([tip, { x: E.x - u.y * 5, y: E.y + u.x * 5 }, { x: E.x + u.y * 5, y: E.y - u.x * 5 }], c + 'f' + hc), { ax });
    }
    add('move', t => Math.abs(t.x - pv.x) < 8 && Math.abs(t.y - pv.y) < 8, hc => sq(pv, 7, 'mc' + hc), { ax: [1, 1] });
  } else if (tool === 'rotate') {
    add('rotate', t => Math.abs(dist(t, pv) - 70) < 6, hc => circ(pv, 70, 'ring' + hc));
  } else if (tool === 'scale') {
    for (const [ax, u, c] of [[0, axis(i.M, 1, 0), 'ax'], [1, axis(i.M, 0, 1), 'ay']]) {
      const E = along(pv, u, 80);
      add('scale', t => (segDist(t, pv, E) < 6 && dist(t, pv) > 9) || dist(t, E) < 8, hc => line(pv, E, c + hc) + sq(E, 4.5, c + 'f' + hc), { ax });
    }
    add('scale', t => Math.abs(t.x - pv.x) < 8 && Math.abs(t.y - pv.y) < 8, hc => sq(pv, 6, 'scc' + hc), { ax: 2 });
  }
  return { id, i, pf, pv, lay, h };
}
const hit = v => geo()?.h.find(h => h.test(v));

// ---------- overlay ----------
function draw() {
  let s = '';
  if (win?.PSB && S.root()) {
    const [W, H] = S.S.resolution, a = stage().transformPoint({ x: 0, y: 0 });
    s += `<rect class="cv" x="${f1(a.x)}" y="${f1(a.y)}" width="${f1(W * zoom)}" height="${f1(pageH * zoom)}"/>`;
    if (pageH > H) s += line({ x: a.x, y: a.y + H * zoom }, { x: a.x + W * zoom, y: a.y + H * zoom }, 'fold');
    const hv = hover && !S.S.selection.includes(hover) && info(hover);
    if (hv) s += poly(hv.q, 'hov');
    for (const id of S.S.selection) { const i = info(id); if (i) s += poly(i.q, 'sel'); }
    const g = !drag || drag.t ? geo() : null;
    if (g) {
      if (drag?.k === 'anchor' || hotKey?.startsWith('anchor')) s += poly([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => g.pf.M.transformPoint({ x: x * g.pf.P[0], y: y * g.pf.P[1] })), 'par');
      const hk = drag?.key ?? hotKey;
      s += g.h.map(h => h.svg(h.key === hk ? ' hot' : '')).reverse().join('');
    }
    if (drag?.k === 'marquee' && drag.cur) {
      const { v, cur } = drag;
      s += `<rect class="marq" x="${f1(Math.min(v.x, cur.x))}" y="${f1(Math.min(v.y, cur.y))}" width="${f1(Math.abs(cur.x - v.x))}" height="${f1(Math.abs(cur.y - v.y))}"/>`;
    }
  }
  if (s !== lastSvg) svg.innerHTML = lastSvg = s;
}
function loop() {
  requestAnimationFrame(loop);
  if (mode !== 'scene') return;
  // content that grows after load (fonts, components) -> grow the scene frame instead of scrolling it
  const sh = win?.document?.documentElement?.scrollHeight;
  if (sh > pageH && sh < 1e5) frames[front].style.height = (pageH = sh) + 'px';
  draw();
}

// ---------- view ----------
function applyView() {
  const [W, H] = S.S.resolution;
  if (mode === 'game') {
    const vw = view.clientWidth, vh = view.clientHeight, gz = Math.min(vw / W, vh / H) * cfg.scale || 1;
    const ox = Math.max(0, (vw - W * gz) / 2), oy = Math.max(0, (vh - H * gz) / 2);
    Object.assign(sizer.style, { width: W * gz + 2 * ox + 'px', height: H * gz + 2 * oy + 'px' });
    world.style.transform = `translate(${ox}px, ${oy}px) scale(${gz})`;
    view.style.backgroundImage = 'none';
    return;
  }
  Object.assign(sizer.style, { width: '0', height: '0' });
  world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  zoomSel.options[0].text = Math.round(zoom * 100) + '%';
  if (!cfg.grid) { view.style.backgroundImage = 'none'; return; }
  let step = +cfg.inc > 0 ? +cfg.inc : 10;
  while (step * zoom < 8) step *= 10;
  const a = step * zoom, b = a * 10, ln = (c, d) => `linear-gradient(${d}, ${c} 1px, transparent 1px)`;
  Object.assign(view.style, {
    backgroundImage: [ln('#ffffff16', '0deg'), ln('#ffffff16', '90deg'), ln('#ffffff0a', '0deg'), ln('#ffffff0a', '90deg')].join(),
    backgroundSize: `${b}px ${b}px, ${b}px ${b}px, ${a}px ${a}px, ${a}px ${a}px`,
    backgroundPosition: `${pan.x}px ${pan.y}px`,
  });
}
function zoomAt(v, z) {
  z = clamp(z, 0.02, 16);
  pan = { x: v.x - (v.x - pan.x) * z / zoom, y: v.y - (v.y - pan.y) * z / zoom };
  zoom = z; applyView();
}
function frameRect(x0, y0, x1, y1, maxZ = 8) {
  const W = view.clientWidth, H = view.clientHeight, pad = 30;
  if (!W || !H) return;
  zoom = clamp(Math.min((W - 2 * pad) / Math.max(x1 - x0, 1), (H - 2 * pad) / Math.max(y1 - y0, 1)), 0.02, maxZ);
  pan = { x: W / 2 - (x0 + x1) / 2 * zoom, y: H / 2 - (y0 + y1) / 2 * zoom };
  applyView();
}
const frameCanvas = () => frameRect(0, 0, ...S.S.resolution);
function frameSel() {
  if (mode !== 'scene') return;
  const si = stage().inverse(), ps = S.S.selection.map(info).filter(Boolean).flatMap(i => i.q.map(p => si.transformPoint(p)));
  if (!ps.length) return frameCanvas();
  const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
  frameRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 4);
}
function setMode(m) {
  mode = m; el.dataset.mode = m;
  for (const b of el.querySelectorAll('[data-mode-tab]')) b.classList.toggle('on', b.dataset.modeTab === m);
  frames[front].style.height = (m === 'game' ? S.S.resolution[1] : pageH) + 'px';
  hover = null; lastSvg = ''; svg.innerHTML = '';
  view.scrollTo(0, 0);
  applyView();
}

// ---------- preview iframes (double-buffered) ----------
function rebuild() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    if (!S.root()) return;
    clearTimeout(propsTimer);
    const my = ++gen, f = frames[1 - front], [W, H] = S.S.resolution;
    Object.assign(f.style, { width: W + 'px', height: H + 'px' });
    f.onload = () => waitPSB(f, my, 0);
    // absolute <base>: Chrome's srcdoc preload scanner resolves a relative one against the editor URL (404s)
    f.srcdoc = S.previewHTML().replace('<base href="/', `<base href="${location.origin}/`).replace('</head>', HOOK + '\n</head>');
  });
}
function waitPSB(f, my, n) {
  if (my !== gen) return;
  if (f.contentWindow?.PSB) return swap(f);
  if (n > 300) return S.log('Preview runtime did not start', 'error');
  setTimeout(() => waitPSB(f, my, n + 1), 20);
}
function swap(f) {
  const old = frames[front], [, H] = S.S.resolution;
  front = 1 - front;
  pageH = Math.max(H, f.contentDocument.documentElement.scrollHeight);
  f.style.height = (mode === 'game' ? H : pageH) + 'px';
  f.classList.add('on'); old.classList.remove('on');
  old.onload = null; old.removeAttribute('srcdoc'); old.src = 'about:blank';
  win = S.S.previewWin = f.contentWindow;
  if (!fitted) { fitted = true; frameCanvas(); }
  S.emit('preview-ready');
}
const rebuildLater = () => { clearTimeout(propsTimer); propsTimer = setTimeout(() => (drag ? rebuildLater() : rebuild()), 300); };

// ---------- picking ----------
function picks(v) {
  const doc = win?.document, rootId = S.root()?.id, ids = [];
  if (!doc) return ids;
  const f = stage().inverse().transformPoint(v);
  for (const e of doc.elementsFromPoint(f.x, f.y)) {
    const id = e.closest('[data-psb]')?.dataset.psb;
    if (id && id !== rootId && !ids.includes(id) && S.node(id)) ids.push(id);
  }
  return ids;
}
const vpt = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

function hoverAt(v) {
  const hand = spaceDown || S.S.tool === 'hand', h = hand ? null : hit(v);
  hotKey = h?.key ?? null;
  hover = hand || h ? null : picks(v)[0] ?? null;
  let c = hand ? 'grab' : h ? (h.k === 'resize' ? h.cur : h.k === 'rotate' ? ROT : h.k === 'move' ? 'move' : 'pointer') : '';
  if (!c && S.S.tool === 'rect') { const g = geo(); if (g && !g.lay && inside(v, g.i.q)) c = 'move'; }
  view.style.cursor = c;
}

// ---------- drags ----------
function down(e) {
  if (mode !== 'scene') return;
  view.focus({ preventScroll: true });
  const v = vpt(e), tool = S.S.tool;
  if (e.button === 1 || (e.button === 0 && (spaceDown || tool === 'hand'))) {
    drag = { k: 'pan', v, pan: { ...pan } };
    view.style.cursor = 'grabbing';
  } else if (e.button === 0) {
    const g = geo(), h = g?.h.find(x => x.test(v)), t = h && snap0(g.id);
    if (t) {
      drag = { ...h, v, t, label: h.k + '#' + ++seq };
      if (h.k === 'rotate') Object.assign(drag, { c: g.pv, last: ang(g.pv, v), acc: 0 });
      if (h.k === 'scale') drag.axes = [axis(t.M, 1, 0), axis(t.M, 0, 1)];
      if (h.k === 'move') drag.targets = movable().map(snap0).filter(Boolean);
    } else {
      const ids = picks(v), add = e.shiftKey || e.ctrlKey || e.metaKey, onSel = ids.some(id => S.S.selection.includes(id));
      if (ids.length && !add && !onSel) S.select(ids[0]);
      drag = { k: 'pending', v, ids, add, fresh: !onSel, move: tool === 'rect' && ids.length && (onSel || !add) };
    }
  } else return;
  e.preventDefault();
  try { view.setPointerCapture(e.pointerId); } catch {}
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

function move(e) {
  const d = drag, v = vpt(e);
  if (!d) return;
  if (d.k === 'pending') {
    if (dist(v, d.v) <= 3) return;
    const ts = d.move ? movable().map(snap0).filter(Boolean) : null;
    Object.assign(d, !d.move ? { k: 'marquee' } : ts.length ? { k: 'move', ax: [1, 1], targets: ts, label: 'move#' + ++seq } : { k: 'none' });
  }
  if (d.k === 'pan') { pan = { x: d.pan.x + v.x - d.v.x, y: d.pan.y + v.y - d.v.y }; applyView(); }
  else if (d.k === 'marquee') d.cur = v;
  else TOOLS[d.k]?.(d, v, e);
}

function up(e) {
  removeEventListener('pointermove', move);
  removeEventListener('pointerup', up);
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.k === 'pending') {
    if (!d.ids.length) { if (!d.add) S.select([]); }
    else if (d.add) S.select(d.ids[0], true);
    else if (!d.fresh) { // click again on the same spot cycles through stacked nodes
      const cur = d.ids.indexOf(S.S.selection.at(-1)), same = lastClick && dist(lastClick, d.v) < 4;
      S.select(same && cur >= 0 ? d.ids[(cur + 1) % d.ids.length] : d.ids[0]);
    }
    lastClick = d.v;
  } else if (d.k === 'marquee' && d.cur) {
    const x0 = Math.min(d.v.x, d.cur.x), x1 = Math.max(d.v.x, d.cur.x), y0 = Math.min(d.v.y, d.cur.y), y1 = Math.max(d.v.y, d.cur.y);
    const rootId = S.root().id, ids = [];
    for (const [n] of S.walk(S.root())) {
      const q = n.id !== rootId && info(n.id)?.q;
      if (q && q.every(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)) ids.push(n.id);
    }
    S.select(d.add ? [...new Set([...S.S.selection, ...ids])] : ids);
  }
  hoverAt(vpt(e));
}

const TOOLS = {
  move(d, v, e) {
    for (const t of d.targets) {
      const a = t.Mpi.transformPoint(d.v), b = t.Mpi.transformPoint(v), dl = [b.x - a.x, b.y - a.y];
      put(t.id, 'pos', t.r.pos.map((p, i) => (!d.ax[i] ? p : snapping(e) ? snapv(p + dl[i]) : p + dl[i])));
    }
  },
  resize(d, v, e) {
    const t = d.t, a = t.Mi.transformPoint(d.v), b = t.Mi.transformPoint(v), k = e.altKey ? 2 : 1;
    let w = t.w + d.hx * (b.x - a.x) * k, h = t.h + d.hy * (b.y - a.y) * k;
    if (snapping(e)) { if (d.hx) w = snapv(w); if (d.hy) h = snapv(h); }
    if (e.shiftKey && t.w && t.h) {
      const fw = w / t.w, fh = h / t.h, f = !d.hy ? fw : !d.hx ? fh : Math.abs(fw - 1) > Math.abs(fh - 1) ? fw : fh;
      w = t.w * f; h = t.h * f;
    }
    w = Math.max(0, w); h = Math.max(0, h);
    if (t.lay) return put(t.id, 'size', [t.r.size[0] + w - t.w, t.r.size[1] + h - t.h]);
    // fixed side: opposite edge, or the center (Alt / axis not dragged)
    const side = (hd, n, o) => (e.altKey || !hd ? (o - n) / 2 : hd > 0 ? 0 : o - n);
    const o = place(t, side(d.hx, w, t.w), side(d.hy, h, t.h), w, h);
    put(t.id, 'pos', o.pos); put(t.id, 'size', o.size);
  },
  rotate(d, v, e) {
    const a = ang(d.c, v);
    d.acc += ((a - d.last + 540) % 360) - 180;
    d.last = a;
    const r = d.t.r.rotation + d.acc;
    put(d.t.id, 'rotation', snapping(e) ? Math.round(r / 15) * 15 : r);
  },
  scale(d, v, e) {
    const t = d.t, dx = v.x - d.v.x, dy = v.y - d.v.y;
    let s = [...t.r.scale];
    if (d.ax === 2) s = s.map(x => x * (1 + (dx - dy) / 100));
    else s[d.ax] *= 1 + (dx * d.axes[d.ax].x + dy * d.axes[d.ax].y) / 80;
    put(t.id, 'scale', snapping(e) ? s.map(x => Math.round(x * 10) / 10) : s);
  },
  pivot(d, v, e) {
    const t = d.t, a = t.Mi.transformPoint(d.v), b = t.Mi.transformPoint(v);
    let pv = [t.r.pivot[0] + (b.x - a.x) / (t.w || 1), t.r.pivot[1] + (b.y - a.y) / (t.h || 1)];
    if (snapping(e)) pv = pv.map(x => Math.round(x * 4) / 4);
    pv = pv.map(r3);
    put(t.id, 'pivot', pv);
    if (!t.lay) put(t.id, 'pos', place(t, 0, 0, t.w, t.h, pv).pos);
  },
  anchor(d, v, e) {
    const t = d.t, a = t.Mpi.transformPoint(d.v), b = t.Mpi.transformPoint(v), dl = [b.x - a.x, b.y - a.y];
    const px = [Math.hypot(...Object.values(vec(t.Mp, 1, 0))), Math.hypot(...Object.values(vec(t.Mp, 0, 1)))];
    const mn = [...t.r.anchorMin], mx = [...t.r.anchorMax];
    const snapOff = (xs, th) => { let o = 0, best = th; for (const x of xs) for (const s of [0, 0.5, 1]) if (Math.abs(s - x) < best) { best = Math.abs(s - x); o = s - x; } return o; };
    for (const i of [0, 1]) {
      const th = 6 / (px[i] * t.P[i] || 1), df = dl[i] / (t.P[i] || 1);
      if (d.c === 'all' || e.shiftKey) {
        const span = mx[i] - mn[i];
        let lo = clamp(mn[i] + df, 0, 1 - span);
        lo += snapOff([lo, lo + span / 2, lo + span], th);
        mn[i] = lo; mx[i] = lo + span;
      } else {
        let x = (d.c[i] ? mx[i] : mn[i]) + df;
        x = clamp(x + snapOff([x], th), 0, 1);
        if (d.c[i]) mx[i] = Math.max(x, mn[i]); else mn[i] = Math.min(x, mx[i]);
      }
    }
    const o = reanchor(t.r, t.P[0], t.P[1], { anchorMin: mn.map(r3), anchorMax: mx.map(r3) });
    for (const k of ['anchorMin', 'anchorMax', 'pos', 'size']) put(t.id, k, o[k]);
  },
};

// ---------- drops ----------
const natural = p => new Promise(ok => {
  const i = new Image();
  i.onload = () => ok([i.naturalWidth || 100, i.naturalHeight || 100]);
  i.onerror = () => ok([100, 100]);
  i.src = S.assetUrl(p);
});
async function drop(e) {
  if (mode !== 'scene') return;
  e.preventDefault();
  const v = vpt(e), parentId = picks(v)[0] ?? S.root().id, pe = win?.PSB?.el(parentId);
  const local = pe ? stage().multiplySelf(elMatrix(pe)).translateSelf(pe.clientLeft - pe.scrollLeft, pe.clientTop - pe.scrollTop).inverse().transformPoint(v) : { x: 0, y: 0 };
  const P = pe ? box(pe) : S.S.resolution, dt = e.dataTransfer, paths = [];
  const asset = dt.getData('application/x-psb-asset');
  try { if (asset) paths.push(asset); else for (const f of dt.files) paths.push(await S.upload(f)); }
  catch (err) { return S.log(`Import failed: ${err.message}`, 'error'); }
  for (const p of paths) {
    const type = S.S.P.assets.find(a => a.path === p)?.type;
    const make = { image: 'Image', video: 'Video', audio: 'Audio', json: 'Repeat' }[type];
    if (!make) { S.log(`Can't place ${p} in the scene (${type ?? 'unknown'} asset)`, 'warn'); continue; }
    const n = S.PRESETS[make](), props = n.components[0].props;
    n.name = p.split('/').pop().replace(/\.[^.]+$/, '');
    if (type === 'image') { props.sprite = p; n.rect.size = await natural(p); }
    else if (type === 'json') props.source = p;
    else props.src = p;
    n.rect.pos = [r3(local.x - 0.5 * P[0]), r3(local.y - 0.5 * P[1])];
    S.addNode(n, parentId);
  }
}

// ---------- mount ----------
export function mount(root) {
  el = root;
  el.classList.add('sc');
  if (cfg.res) S.S.resolution = [...cfg.res];
  el.innerHTML = `
    <nav class="tabs"><button data-mode-tab="scene">Scene</button><button data-mode-tab="game">Game</button></nav>
    <div class="sc-bar">
      <select class="sc-res" title="Resolution">${RES.map(([w, h, n]) => `<option value="${w}x${h}">${w}x${h}${n ? ' ' + n : ''}</option>`).join('')}<option value="custom">Custom…</option></select>
      <span class="sc-custom" hidden><input type="number" class="sc-w" min="1" title="Width"> × <input type="number" class="sc-h" min="1" title="Height"></span>
      <span class="sc-scene">
        <select class="sc-zoom" title="Zoom (wheel)"><option value="">100%</option><option value="fit">Fit</option>${ZOOMS.map(z => `<option value="${z}">${z * 100}%</option>`).join('')}</select>
        <button class="btn" data-k="grid" title="Show grid">Grid</button>
        <button class="btn" data-k="gizmos" title="Show anchor gizmos (rect tool)">Anchors</button>
        <button class="btn" data-k="snap" title="Snap to increment (or hold Ctrl while dragging)">Snap</button>
        <input type="number" class="sc-inc" min="0.01" step="any" title="Snap increment (px); rotation snaps to 15°">
      </span>
      <span class="sc-game">Scale <input type="range" class="sc-scale" min="1" max="5" step="0.1"> <output></output></span>
    </div>
    <div class="sc-view" tabindex="0">
      <div class="sc-sizer"></div>
      <div class="sc-world"><iframe title="Preview"></iframe><iframe title="Preview"></iframe></div>
      <svg class="sc-ov"></svg>
    </div>`;
  const $ = s => el.querySelector(s);
  view = $('.sc-view'); world = $('.sc-world'); sizer = $('.sc-sizer'); svg = $('.sc-ov'); zoomSel = $('.sc-zoom');
  frames = [...el.querySelectorAll('iframe')];
  for (const f of frames) f.psbLog = (msg, level) => S.log(msg, level, { source: 'page' });

  // toolbar
  const resSel = $('.sc-res'), custom = $('.sc-custom'), wIn = $('.sc-w'), hIn = $('.sc-h'), inc = $('.sc-inc'), scale = $('.sc-scale');
  const resUI = () => {
    const [W, H] = S.S.resolution, key = W + 'x' + H;
    if (resSel.value !== 'custom' || RES.some(([w, h]) => w + 'x' + h === key)) resSel.value = RES.some(([w, h]) => w + 'x' + h === key) ? key : 'custom';
    custom.hidden = resSel.value !== 'custom';
    wIn.value = W; hIn.value = H;
  };
  const setRes = (w, h) => { S.S.resolution = [w, h]; cfg.res = [w, h]; saveCfg(); S.emit('resolution'); };
  resSel.onchange = () => (resSel.value === 'custom' ? resUI() : setRes(...resSel.value.split('x').map(Number)));
  wIn.onchange = hIn.onchange = () => setRes(Math.max(1, Math.round(+wIn.value) || 1), Math.max(1, Math.round(+hIn.value) || 1));
  zoomSel.onchange = () => {
    const z = zoomSel.value;
    zoomSel.value = '';
    if (z === 'fit') frameCanvas(); else if (z) zoomAt({ x: view.clientWidth / 2, y: view.clientHeight / 2 }, +z);
  };
  const toggles = el.querySelectorAll('[data-k]');
  const togUI = () => toggles.forEach(b => b.classList.toggle('on', !!cfg[b.dataset.k]));
  toggles.forEach(b => (b.onclick = () => { cfg[b.dataset.k] = !cfg[b.dataset.k]; saveCfg(); togUI(); applyView(); }));
  inc.value = cfg.inc;
  inc.onchange = () => { cfg.inc = +inc.value > 0 ? +inc.value : 10; inc.value = cfg.inc; saveCfg(); applyView(); };
  const scaleUI = () => { scale.value = cfg.scale; scale.nextElementSibling.textContent = (+cfg.scale).toFixed(1) + 'x'; };
  scale.oninput = () => { cfg.scale = +scale.value; saveCfg(); scaleUI(); applyView(); };
  el.querySelector('.tabs').onclick = e => e.target.dataset.modeTab && setMode(e.target.dataset.modeTab);
  togUI(); scaleUI(); resUI();

  // view input
  view.addEventListener('pointerdown', down);
  view.addEventListener('mousedown', e => e.button === 1 && e.preventDefault()); // no autoscroll
  view.addEventListener('pointermove', e => !drag && mode === 'scene' && hoverAt(vpt(e)));
  view.addEventListener('pointerleave', () => { if (!drag) hover = hotKey = null; });
  view.addEventListener('wheel', e => {
    if (mode !== 'scene') return;
    e.preventDefault();
    zoomAt(vpt(e), zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
  }, { passive: false });
  view.addEventListener('keydown', e => {
    if (mode !== 'scene') return;
    if (e.code === 'Space') { if (!spaceDown) { spaceDown = true; view.style.cursor = 'grab'; } }
    else {
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
      const m = e.shiftKey ? 10 : 1;
      for (const id of movable()) { const p = rect0(id).pos; put(id, 'pos', [p[0] + k[0] * m, p[1] + k[1] * m], 'Nudge'); }
    }
    e.preventDefault(); e.stopPropagation();
  });
  view.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; view.style.cursor = ''; e.stopPropagation(); } });
  view.addEventListener('blur', () => (spaceDown = false));
  view.addEventListener('dragover', e => {
    if (mode !== 'scene' || ![...e.dataTransfer.types].some(t => t === 'application/x-psb-asset' || t === 'Files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  });
  view.addEventListener('drop', drop);
  new ResizeObserver(() => mode === 'game' && applyView()).observe(view);

  // store events
  for (const ev of ['structure', 'page', 'load']) S.on(ev, rebuild);
  S.on('resolution', () => { resUI(); fitted = false; rebuild(); });
  S.on('play', () => {
    el.classList.toggle('playing', S.S.playing);
    if (S.S.playing) { prevMode = mode; setMode('game'); } else setMode(prevMode);
    rebuild();
  });
  S.on('props', ids => {
    const PSB = win?.PSB;
    if (PSB) for (const id of ids) {
      const n = S.node(id);
      if (n) try { PSB.applyNode(n, S.parentOf(id)); } catch (e) { console.warn(e); }
    }
    if (!S.S.playing) rebuildLater(); // playing: keep the running page, patch only
  });
  S.on('frame', frameSel);
  S.on('tool', () => { hotKey = null; });
  S.on('page', () => { hover = null; });
  setMode('scene');
  loop();
}
