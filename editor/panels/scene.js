// Scene | Web view (Unity style): double-buffered preview iframes, pan/zoom, selection overlay,
// rect/move/rotate/scale tools, anchor flower + pivot, asset drops, Web view for play mode.
import * as S from '../state.js';
import { reanchor } from '/lib/rect.js';
import { activeBreakpoints } from '/lib/node.js';

const RES = [[1920, 1080], [1280, 720], [1366, 768], [1440, 900], [390, 844, 'phone'], [768, 1024, 'tablet']];
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
const cfg = { grid: true, gizmos: true, snap: false, guides: true, inc: 10, scale: 1, res: null };
try { Object.assign(cfg, JSON.parse(localStorage.gpsbScene || '{}')); } catch {}
const saveCfg = () => { try { localStorage.gpsbScene = JSON.stringify(cfg); } catch {} };
const ROT = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><g fill='none' stroke-linecap='round'><path d='M5 11a5 5 0 1 0 5-5' stroke='white' stroke-width='4'/><path d='M5 11a5 5 0 1 0 5-5' stroke='black' stroke-width='1.6'/></g><path d='M10 2v8l4-4z' stroke='white' stroke-width='1'/></svg>")}") 10 10, crosshair`;

// page console/errors -> editor console (end of <head>: before any deferred module or body script runs)
const HOOK = `<script>(() => {
  const f = frameElement && frameElement.gpsbLog; if (!f) return;
  const str = a => a.map(x => typeof x === 'string' ? x : x instanceof Error ? x.stack || x.message : (() => { try { return JSON.stringify(x) ?? String(x); } catch { return String(x); } })()).join(' ');
  for (const [k, l] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) { const o = console[k]; console[k] = (...a) => { o.apply(console, a); f(str(a), l); }; }
  addEventListener('error', e => f(e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''), 'error'));
  addEventListener('unhandledrejection', e => f('Unhandled rejection: ' + (e.reason && e.reason.stack || e.reason), 'error'));
})();</script>`;

const r3 = n => Math.round(n * 1000) / 1000;
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
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
    // computed left/top are sub-pixel exact; the border box starts after the margin (Style CSS like `margin: 0 auto`)
    const cs = w.getComputedStyle(e), p = e.offsetParent, abs = cs.position === 'absolute';
    const l = new DOMMatrix().translateSelf((abs ? parseFloat(cs.left) + (parseFloat(cs.marginLeft) || 0) : e.offsetLeft) + (p ? p.clientLeft - p.scrollLeft : 0),
      (abs ? parseFloat(cs.top) + (parseFloat(cs.marginTop) || 0) : e.offsetTop) + (p ? p.clientTop - p.scrollTop : 0));
    if (cs.transform !== 'none') {
      const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
      l.translateSelf(ox, oy).multiplySelf(new DOMMatrix(cs.transform)).translateSelf(-ox, -oy);
    }
    m = l.multiplySelf(m);
  }
  return m;
}
function info(id) {
  const e = win?.GPSB?.el(id);
  if (!e?.offsetParent) return null; // inactive / missing
  const M = stage().multiplySelf(elMatrix(e)), [w, h] = box(e);
  return { e, M, w, h, q: [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => M.transformPoint({ x, y })) };
}
// parent's layout space (padding box, unscrolled) -> view
function parentFrame(id) {
  const p = S.parentOf(id), e = p && win?.GPSB?.el(p.id);
  if (!e) return null;
  return { M: stage().multiplySelf(elMatrix(e)).translateSelf(e.clientLeft - e.scrollLeft, e.clientTop - e.scrollTop), P: box(e) };
}
function inLayout(id) {
  const p = S.parentOf(id);
  return !!p && S.view(p.id).components.some(c => S.def(c.type)?.childStyle) && !S.getComponent(S.view(id), 'LayoutElement')?.props?.ignoreLayout;
}
// rect as currently displayed: breakpoint overrides applied, record mode's animated values win
function rect0(id) {
  const r = S.clone(S.view(id).rect), st = S.S.hooks.animState;
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
// selected nodes that can be transformed, minus descendants of other selected ones
const tops = () => {
  const sel = S.S.selection.filter(id => S.node(id) && S.parentOf(id));
  return sel.filter(id => !sel.some(o => o !== id && isAnc(o, id)));
};
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
  if (JSON.stringify(v) !== JSON.stringify(S.view(id)?.rect[k])) S.setProp(id, 'rect.' + k, v, { label });
}

// ---------- gizmo handles for the active node (ordered by hit priority) ----------
function geo() {
  const id = S.S.selection.at(-1), n = id && S.node(id), tool = S.S.tool;
  const i = n && S.parentOf(id) && tool !== 'hand' && info(id), pf = i && parentFrame(id);
  if (!pf) return null;
  const lay = inLayout(id), r = rect0(id), q = i.q, h = [], multi = tops().length > 1;
  const pv = i.M.transformPoint({ x: r.pivot[0] * i.w, y: r.pivot[1] * i.h });
  const add = (k, test, svg, o = {}) => h.push({ k, test, svg, key: k + [o.hx, o.hy, o.c, o.ax].join(), ...o });
  let rc = pv;
  if (tool === 'rect' && multi) { // combined bounds of the selection: resize scales every node, rotate turns each around its pivot
    const qs = tops().map(info).filter(Boolean).flatMap(x => x.q), xs = qs.map(p => p.x), ys = qs.map(p => p.y);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const B = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], CUR = ['nwse', 'nesw', 'nwse', 'nesw'], E = ['ns', 'ew', 'ns', 'ew'];
    rc = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    add('deco', () => false, () => poly(B, 'bnd'));
    const HC = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    B.forEach((p, j) => add('mresize', t => dist(t, p) < 7, hc => circ(p, 4, 'hnd' + hc), { hx: HC[j][0], hy: HC[j][1], cur: CUR[j] + '-resize', B: [x0, y0, x1, y1] }));
    B.forEach((p, j) => {
      const [hx, hy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][j];
      add('mresize', t => segDist(t, p, B[(j + 1) % 4]) < 5, () => '', { hx, hy, cur: E[j] + '-resize', B: [x0, y0, x1, y1] });
    });
    B.forEach(p => add('rotate', t => { const d = dist(t, p); return d > 6 && d < 24 && !inside(t, B); }, () => ''));
  } else if (tool === 'rect') {
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
  return { id, i, pf, pv, rc, lay, h };
}
const hit = v => geo()?.h.find(h => h.test(v));

// ---------- overlay ----------
function draw() {
  let s = '';
  if (win?.GPSB && S.root()) {
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
    if (drag?.guides?.length) s += drag.guides.join('');
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
  if (mode === 'web') {
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
  frames[front].style.height = (m === 'web' ? S.S.resolution[1] : pageH) + 'px';
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
    f.onload = () => waitGPSB(f, my, 0);
    f.srcdoc = S.previewHTML().replace('</head>', HOOK + '\n</head>');
  });
}
function waitGPSB(f, my, n) {
  if (my !== gen) return;
  if (f.contentWindow?.GPSB) return swap(f);
  if (n > 300) return S.log('Preview runtime did not start', 'error');
  setTimeout(() => waitGPSB(f, my, n + 1), 20);
}
function swap(f) {
  const old = frames[front], [, H] = S.S.resolution;
  front = 1 - front;
  pageH = Math.max(H, f.contentDocument.documentElement.scrollHeight);
  f.style.height = (mode === 'web' ? H : pageH) + 'px';
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
    const id = e.closest('[data-gpsb]')?.dataset.gpsb;
    if (id && id !== rootId && !ids.includes(id) && S.node(id)) ids.push(id);
  }
  return ids;
}
const vpt = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

function hoverAt(v) {
  const hand = spaceDown || S.S.tool === 'hand', h = hand ? null : hit(v);
  hotKey = h?.key ?? null;
  hover = hand || h ? null : picks(v)[0] ?? null;
  let c = hand ? 'grab' : h ? (h.k.endsWith('resize') ? h.cur : h.k === 'rotate' ? ROT : h.k === 'move' ? 'move' : 'pointer') : '';
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
      if (h.k === 'rotate') Object.assign(drag, { c: g.rc, last: ang(g.rc, v), acc: 0 });
      if (h.k === 'scale') drag.axes = [axis(t.M, 1, 0), axis(t.M, 0, 1)];
      if (h.k === 'rotate' || h.k === 'scale' || h.k === 'mresize') drag.targets = tops().map(snap0).filter(Boolean);
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

// ---------- smart guides: edges/centres of the moved boxes snap to siblings' and the parent's (screen space) ----------
const GUIDE_PX = 6;
const aabb = q => { const xs = q.map(p => p.x), ys = q.map(p => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
function guideLines(targets) {
  const ids = new Set(targets.map(t => t.id)), parents = new Set(targets.map(t => S.parentOf(t.id)?.id)), xs = [], ys = [];
  const addBox = ([x0, y0, x1, y1]) => { xs.push(x0, (x0 + x1) / 2, x1); ys.push(y0, (y0 + y1) / 2, y1); };
  for (const pid of parents) {
    const p = S.node(pid); if (!p) continue;
    const pi = info(pid); if (pi) addBox(aabb(pi.q));
    for (const c of p.children) if (!ids.has(c.id)) { const ci = info(c.id); if (ci) addBox(aabb(ci.q)); }
  }
  return { xs, ys, box: aabb(targets.flatMap(t => [[0, 0], [t.w, 0], [t.w, t.h], [0, t.h]].map(([x, y]) => t.M.transformPoint({ x, y })))) };
}
// screen delta (dx, dy) -> snapped delta + the guide lines to draw
function snapDelta(d, dx, dy, e) {
  d.guides = [];
  if (!cfg.guides || e.altKey || snapping(e)) return [dx, dy];
  d.lines ??= guideLines(d.targets);
  const [x0, y0, x1, y1] = d.lines.box, best = (cands, own) => {
    let m = null;
    for (const o of own) for (const c of cands) { const diff = c - o; if (Math.abs(diff) < GUIDE_PX && (!m || Math.abs(diff) < Math.abs(m.diff))) m = { diff, at: c }; }
    return m;
  };
  const bx = d.ax[0] ? best(d.lines.xs, [x0 + dx, (x0 + x1) / 2 + dx, x1 + dx]) : null, by = d.ax[1] ? best(d.lines.ys, [y0 + dy, (y0 + y1) / 2 + dy, y1 + dy]) : null;
  if (bx) { dx += bx.diff; d.guides.push(line({ x: bx.at, y: -1e4 }, { x: bx.at, y: 1e4 }, 'guide')); }
  if (by) { dy += by.diff; d.guides.push(line({ x: -1e4, y: by.at }, { x: 1e4, y: by.at }, 'guide')); }
  return [dx, dy];
}

// ---------- align / distribute (WebObject > Align): screen-space boxes, moved in each node's parent space ----------
export function align(kind) {
  const ts = movable().map(snap0).filter(Boolean);
  if (!ts.length) return;
  const bs = ts.map(t => aabb([[0, 0], [t.w, 0], [t.w, t.h], [0, t.h]].map(([x, y]) => t.M.transformPoint({ x, y }))));
  const pi = ts.length === 1 && info(S.parentOf(ts[0].id)?.id); // one object: align within its parent
  const ref = pi ? aabb(pi.q) : [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))];
  const label = 'Align#' + ++seq, moves = bs.map(() => [0, 0]);
  if (kind === 'distributeX' || kind === 'distributeY') {
    if (ts.length < 3) return S.log('Distribute needs 3 or more objects', 'warn');
    const i = kind === 'distributeX' ? 0 : 1, order = bs.map((b, k) => k).sort((a, b) => bs[a][i] - bs[b][i]);
    const total = bs[order.at(-1)][i + 2] - bs[order[0]][i], sizes = order.reduce((s, k) => s + bs[k][i + 2] - bs[k][i], 0), gap = (total - sizes) / (order.length - 1);
    let at = bs[order[0]][i];
    for (const k of order) { moves[k][i] = at - bs[k][i]; at += bs[k][i + 2] - bs[k][i] + gap; }
  } else bs.forEach((b, k) => {
    const [i, f] = { left: [0, 0], center: [0, 0.5], right: [0, 1], top: [1, 0], middle: [1, 0.5], bottom: [1, 1] }[kind];
    moves[k][i] = (ref[i] + (ref[i + 2] - ref[i]) * f) - (b[i] + (b[i + 2] - b[i]) * f);
  });
  ts.forEach((t, k) => {
    const o = t.M.transformPoint({ x: 0, y: 0 }), a = t.Mpi.transformPoint(o), b = t.Mpi.transformPoint({ x: o.x + moves[k][0], y: o.y + moves[k][1] });
    if (moves[k][0] || moves[k][1]) put(t.id, 'pos', [t.r.pos[0] + b.x - a.x, t.r.pos[1] + b.y - a.y], label);
  });
}

const TOOLS = {
  move(d, v, e) {
    const [dx, dy] = snapDelta(d, v.x - d.v.x, v.y - d.v.y, e), w = { x: d.v.x + dx, y: d.v.y + dy };
    for (const t of d.targets) {
      const a = t.Mpi.transformPoint(d.v), b = t.Mpi.transformPoint(w), dl = [b.x - a.x, b.y - a.y];
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
    for (const t of d.targets) { const r = t.r.rotation + d.acc; put(t.id, 'rotation', snapping(e) ? Math.round(r / 15) * 15 : r); }
  },
  scale(d, v, e) {
    const dx = v.x - d.v.x, dy = v.y - d.v.y, f = [1, 1];
    if (d.ax === 2) f[0] = f[1] = 1 + (dx - dy) / 100;
    else f[d.ax] = 1 + (dx * d.axes[d.ax].x + dy * d.axes[d.ax].y) / 80;
    for (const t of d.targets) {
      const s = t.r.scale.map((x, i) => x * f[i]);
      put(t.id, 'scale', snapping(e) ? s.map(x => Math.round(x * 10) / 10) : s);
    }
  },
  // multi-selection rect tool: map the combined bounds, move each pivot with it and scale each box along its own axes
  mresize(d, v, e) {
    const [x0, y0, x1, y1] = d.B, W = x1 - x0 || 1, H = y1 - y0 || 1, k = e.altKey ? 2 : 1;
    let w = W + d.hx * (v.x - d.v.x) * k, h = H + d.hy * (v.y - d.v.y) * k;
    if (e.shiftKey) { const f = !d.hy ? w / W : !d.hx ? h / H : Math.abs(w / W - 1) > Math.abs(h / H - 1) ? w / W : h / H; w = W * f; h = H * f; }
    w = Math.max(1, w); h = Math.max(1, h);
    const nx = e.altKey || !d.hx ? (x0 + x1 - w) / 2 : d.hx > 0 ? x0 : x1 - w, ny = e.altKey || !d.hy ? (y0 + y1 - h) / 2 : d.hy > 0 ? y0 : y1 - h;
    const fx = w / W, fy = h / H;
    for (const t of d.targets) {
      const u = axis(t.M, 1, 0), c2 = u.x * u.x, s2 = u.y * u.y; // node x axis on screen: blend factors (exact at 0/90°)
      const nw = t.w * (fx * c2 + fy * s2), nh = t.h * (fx * s2 + fy * c2);
      if (t.lay) { put(t.id, 'size', [t.r.size[0] + nw - t.w, t.r.size[1] + nh - t.h]); continue; }
      const p0 = t.M.transformPoint({ x: t.r.pivot[0] * t.w, y: t.r.pivot[1] * t.h });
      const c = t.Mpi.transformPoint({ x: nx + (p0.x - x0) * fx, y: ny + (p0.y - y0) * fy }), C = [c.x, c.y], E = [nw, nh], r = t.r;
      const span = i => r.anchorMax[i] - r.anchorMin[i];
      put(t.id, 'pos', [0, 1].map(i => C[i] - (r.anchorMin[i] + r.pivot[i] * span(i)) * t.P[i]));
      put(t.id, 'size', [0, 1].map(i => E[i] - span(i) * t.P[i]));
    }
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
  const v = vpt(e), parentId = picks(v)[0] ?? S.root().id, pe = win?.GPSB?.el(parentId);
  const local = pe ? stage().multiplySelf(elMatrix(pe)).translateSelf(pe.clientLeft - pe.scrollLeft, pe.clientTop - pe.scrollTop).inverse().transformPoint(v) : { x: 0, y: 0 };
  const P = pe ? box(pe) : S.S.resolution, dt = e.dataTransfer, paths = [];
  const asset = dt.getData('application/x-gpsb-asset');
  if (asset?.startsWith('prefab:')) { // a prefab from the Project window: an instance where it was dropped
    const n = S.instantiate(asset.slice(7), parentId);
    if (n) S.setProp(n.id, 'rect.pos', [r3(local.x - 0.5 * P[0]), r3(local.y - 0.5 * P[1])], { label: 'Place prefab' });
    return;
  }
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
    <div class="sc-bar">
      <nav class="sc-modes" title="Scene: edit with gizmos · Web: the page as visitors see it"><button data-mode-tab="scene">Scene</button><button data-mode-tab="web">Web</button></nav>
      <select class="sc-res" title="Resolution">${RES.map(([w, h, n]) => `<option value="${w}x${h}">${w}x${h}${n ? ' ' + n : ''}</option>`).join('')}<option value="custom">Custom…</option></select>
      <span class="sc-custom" hidden><input type="number" class="sc-w" min="1" title="Width"> × <input type="number" class="sc-h" min="1" title="Height"></span>
      <select class="sc-item" title="Collection page: the item shown here (the build writes one page per item)" hidden></select>
      <span class="sc-scene">
        <select class="sc-zoom" title="Zoom (wheel)"><option value="">100%</option><option value="fit">Fit</option>${ZOOMS.map(z => `<option value="${z}">${z * 100}%</option>`).join('')}</select>
        <button class="btn" data-k="grid" title="Show grid">Grid</button>
        <button class="btn" data-k="gizmos" title="Show anchor gizmos (rect tool)">Anchors</button>
        <button class="btn" data-k="snap" title="Snap to increment (or hold Ctrl while dragging)">Snap</button>
        <button class="btn" data-k="guides" title="Smart guides: snap to other objects' edges and centres while moving (hold Alt to skip)">Guides</button>
        <input type="number" class="sc-inc" min="0.01" step="any" title="Snap increment (px); rotation snaps to 15°">
      </span>
      <span class="sc-bps" title="Breakpoint being edited (lit = active at the current preview width)"></span>
      <span class="sc-web">Scale <input type="range" class="sc-scale" min="1" max="5" step="0.1"> <output></output></span>
    </div>
    <div class="sc-view" tabindex="0">
      <div class="sc-banner" hidden></div>
      <div class="sc-sizer"></div>
      <div class="sc-world"><iframe title="Preview"></iframe><iframe title="Preview"></iframe></div>
      <svg class="sc-ov"></svg>
    </div>`;
  const $ = s => el.querySelector(s);
  view = $('.sc-view'); world = $('.sc-world'); sizer = $('.sc-sizer'); svg = $('.sc-ov'); zoomSel = $('.sc-zoom');
  frames = [...el.querySelectorAll('iframe')];
  for (const f of frames) f.gpsbLog = (msg, level) => S.log(msg, level, { source: 'page' });

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
  // responsive breakpoints: editing context (Base | Tablet | Phone ...), like Unity's prefab mode
  const bpBar = $('.sc-bps'), banner = $('.sc-banner');
  let baseRes = null;
  const bpUI = () => {
    const bps = S.breakpoints(), W = S.S.resolution[0], live = activeBreakpoints(bps, W), cur = S.S.breakpoint, b = bps.find(x => x.name === cur);
    bpBar.innerHTML = [{ name: '', label: 'Base' }, ...bps.map(x => ({ name: x.name, label: `${x.name} ≤${x.maxWidth}` }))]
      .map(x => `<button class="btn${(x.name || null) === cur ? ' on' : ''}${(x.name ? live.includes(x.name) : !live.length) ? ' live' : ''}" data-bp="${esc(x.name)}">${esc(x.label)}</button>`).join('')
      + '<button class="btn" data-bp-edit title="Edit Breakpoints…">⋯</button>';
    bpBar.title = `Preview ${W}px: ${live.length ? live.join(' + ') + ' overrides apply' : 'base only'}`;
    el.classList.toggle('bp', !!b);
    banner.hidden = !b;
    if (b) banner.textContent = `Editing ${b.name} overrides — changes apply at ≤${b.maxWidth}px only`;
  };
  // keep the preview width inside the edited level's range (narrower levels would otherwise show through)
  const fitRes = () => {
    const bps = S.breakpoints(), i = bps.findIndex(b => b.name === S.S.breakpoint), [W] = S.S.resolution;
    if (!activeBreakpoints(bps, W).length) baseRes = [...S.S.resolution];
    const hi = i < 0 ? Infinity : bps[i].maxWidth, lo = (i < 0 ? bps[0] : bps[i + 1])?.maxWidth ?? 0, ok = w => w > lo && w <= hi;
    if (ok(W)) return;
    if (i < 0 && baseRes && ok(baseRes[0])) return setRes(...baseRes);
    const pr = RES.filter(([w]) => ok(w)).sort((a, b) => b[0] - a[0])[0];
    setRes(...(pr ? pr.slice(0, 2) : [hi === Infinity ? Math.max(1920, lo + 1) : hi, 800]));
  };
  let pop = null;
  const closePop = () => { pop?.remove(); pop = null; removeEventListener('pointerdown', outside, true); };
  const outside = e => pop && !pop.contains(e.target) && closePop();
  const editBps = btn => {
    if (pop) return closePop();
    const rows = S.breakpoints().map(b => ({ from: b.name, name: b.name, maxWidth: b.maxWidth }));
    pop = document.createElement('div');
    pop.className = 'sc-pop';
    const render = (err = '') => {
      pop.innerHTML = '<div class="sc-pop-h">Breakpoints <span>max viewport width</span></div>'
        + rows.map((r, i) => `<div class="sc-pop-r"><input data-i="${i}" data-f="name" value="${esc(r.name)}"><input type="number" min="1" data-i="${i}" data-f="maxWidth" value="${r.maxWidth}"> px <button class="btn" data-del="${i}" title="Remove">×</button></div>`).join('')
        + `<div class="sc-pop-f"><button class="btn" data-add>Add</button><span class="err">${esc(err)}</span><button class="btn" data-cancel>Cancel</button><button class="btn on" data-apply>Apply</button></div>`;
    };
    pop.oninput = e => { const { i, f } = e.target.dataset; if (i != null) rows[i][f] = e.target.value; };
    pop.onkeydown = e => { if (e.key === 'Escape') closePop(); else if (e.key === 'Enter') pop.querySelector('[data-apply]').click(); e.stopPropagation(); };
    pop.onclick = e => {
      const d = e.target.dataset;
      if (d.del != null) { rows.splice(+d.del, 1); render(); }
      else if ('add' in d) { rows.push({ name: 'Breakpoint ' + (rows.length + 1), maxWidth: 480 }); render(); }
      else if ('cancel' in d) closePop();
      else if ('apply' in d) {
        const list = rows.map(r => ({ name: String(r.name).trim(), maxWidth: Math.round(+r.maxWidth), ...(r.from ? { from: r.from } : {}) }));
        const bad = list.find(b => !b.name) ? 'Name required' : new Set(list.map(b => b.name)).size < list.length ? 'Names must be unique'
          : list.find(b => !(b.maxWidth > 0)) ? 'Width must be > 0' : '';
        if (bad) return render(bad);
        const cur = list.find(b => b.from === S.S.breakpoint);
        S.setBreakpoints(list);
        if (cur && cur.name !== cur.from) S.setBreakpoint(cur.name); // keep editing a renamed breakpoint
        closePop();
      }
    };
    render();
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    Object.assign(pop.style, { left: Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px', top: r.bottom + 4 + 'px' });
    addEventListener('pointerdown', outside, true);
  };
  bpBar.onclick = e => {
    const b = e.target.closest('button');
    if (b) 'bpEdit' in b.dataset ? editBps(b) : S.setBreakpoint(b.dataset.bp || null);
  };
  S.on('breakpoint', () => { fitRes(); bpUI(); });
  S.on('load', bpUI);
  el.querySelector('.sc-modes').onclick = e => e.target.dataset.modeTab && setMode(e.target.dataset.modeTab);
  togUI(); scaleUI(); resUI(); bpUI();
  const itemSel = el.querySelector('.sc-item');
  const itemUI = () => {
    const items = S.pageItems();
    itemSel.hidden = !items;
    if (!items) return;
    const sig = items.map(x => x.slug).join('\n');
    if (itemSel.dataset.sig !== sig) { itemSel.dataset.sig = sig; itemSel.innerHTML = items.length ? items.map((x, i) => `<option value="${i}">${x.slug.replace(/[<&]/g, '')}</option>`).join('') : '<option>no items</option>'; }
    itemSel.value = String(Math.min(S.S.collectionItem, items.length - 1));
  };
  itemSel.onchange = () => S.setCollectionItem(+itemSel.value);
  for (const ev of ['structure', 'page', 'load', 'assets']) S.on(ev, itemUI);

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
    if (mode !== 'scene' || ![...e.dataTransfer.types].some(t => t === 'application/x-gpsb-asset' || t === 'Files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  });
  view.addEventListener('drop', drop);
  new ResizeObserver(() => mode === 'web' && applyView()).observe(view);

  // store events
  for (const ev of ['structure', 'page', 'load']) S.on(ev, rebuild);
  S.on('resolution', () => { resUI(); bpUI(); fitted = false; rebuild(); });
  S.on('play', () => {
    el.classList.toggle('playing', S.S.playing);
    if (S.S.playing) { prevMode = mode; setMode('web'); } else setMode(prevMode);
    rebuild();
  });
  S.on('props', ids => {
    const GPSB = win?.GPSB;
    if (GPSB) for (const id of ids) {
      const n = S.node(id);
      if (n) try { GPSB.applyNode(n, S.parentOf(id)); } catch (e) { console.warn(e); }
    }
    if (!S.S.playing) rebuildLater(); // playing: keep the running page, patch only
  });
  S.on('frame', frameSel);
  S.on('align', align);
  S.on('tool', () => { hotKey = null; });
  S.on('page', () => { hover = null; });
  setMode('scene');
  loop();
}
