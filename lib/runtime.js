// Page runtime (shipped as dist/gpsb/runtime.js). Boots the Canvas Scaler, exposes window.GPSB,
// then loads the animator and behaviours (not in editor mode — the editor drives the preview itself).
import { nodeStyle, nodeAttrs, makeCtx, propsOf, decl } from './render.js';
import { walk, nodeAtPath, getComponent, withOverrides } from './node.js';
import { componentDef } from './components.js';

const data = JSON.parse(document.getElementById('gpsb-data').textContent);
const ctx = makeCtx({ pages: data.pages, customs: data.customs });
const index = new Map();
const reindex = () => { index.clear(); for (const [node, parent] of walk(data.tree)) index.set(node.id, { node, parent }); };
reindex();

// responsive breakpoints: names of the active ones, widest first (kept current by matchMedia)
const bps = (data.breakpoints ?? []).map(b => ({ ...b, mq: matchMedia(`(max-width: ${b.maxWidth}px)`) }));
let active = [];
const updateActive = () => (active = bps.filter(b => b.mq.matches).map(b => b.name));
updateActive();

// per-element node data: Repeat clones get their own copy with {{item.*}} resolved; everything else is canonical
const perEl = new WeakMap();
function nodeFor(el) {
  const id = el.dataset.gpsb, node = index.get(id)?.node;
  const chain = [];
  for (let n = index.get(id)?.parent; n; n = index.get(n.id)?.parent) if (getComponent(n, 'Repeat')) chain.unshift(n);
  if (!node || !chain.length) return node;
  if (perEl.has(el)) return perEl.get(el);
  let scope = null;
  for (const rep of chain) {
    const repEl = el.closest(`[data-gpsb="${rep.id}"]`);
    let kid = el;
    while (kid && kid.parentElement !== repEl) kid = kid.parentElement;
    const index = Math.floor([...repEl.children].filter(c => c.dataset.gpsb).indexOf(kid) / Math.max(1, rep.children.length));
    scope = { ...scope, item: data.repeats?.[rep.id]?.[index], index, parent: scope };
  }
  const n = structuredClone(node);
  for (const c of n.components ?? []) c.props = propsOf(c, ctx, scope);
  perEl.set(el, n);
  return n;
}

// attributes/classes the renderer owns on each element, so applyNode can take away the ones a prop change removed
// (Button disabled, CanvasGroup inert, Link target...). Extra classes start from the built markup (after the slug class).
const MANAGED = ['role', 'aria-label', 'aria-hidden', 'disabled', 'inert', 'target', 'rel'];
const owned = new WeakMap();
for (const el of document.querySelectorAll('[data-gpsb]')) {
  const cls = [...el.classList].filter(c => c !== 'gpsb-canvas');
  owned.set(el, { attrs: new Set(MANAGED), cls: cls.slice(1) });
}
const splitCls = cls => cls.flatMap(c => String(c).split(/\s+/)).filter(Boolean);

export const GPSB = {
  data, ctx, editor: data.editor, scale: 1,
  canvas: document.querySelector('.gpsb-canvas'),
  node: id => index.get(id)?.node,
  parent: id => index.get(id)?.parent,
  el: id => document.querySelector(`[data-gpsb="${id}"]`),
  els: id => [...document.querySelectorAll(`[data-gpsb="${id}"]`)],
  // find('Header/Logo') from the root, or relative to a node; also finds by bare name anywhere
  find(path, from = data.tree) {
    const n = nodeAtPath(from, path);
    if (n) return n;
    for (const [x] of walk(from)) if (x.name === path) return x;
    return null;
  },
  nodeFor,
  breakpoints: () => active,
  effective: node => withOverrides(node, active),
  // Re-apply node data to its element(s): style, attributes, inner content, with the active breakpoint overrides.
  // Pure: never touches the tree. Runtime code mutates node data in place (GPSB.nodeFor(el) / GPSB.node(id)) and
  // calls this; the editor preview passes clones. A canonical node is applied per element via nodeFor.
  applyNode(node, parent = index.get(node.id)?.parent, els = GPSB.els(node.id)) {
    const canonical = index.get(node.id)?.node === node, p = parent && GPSB.effective(parent);
    for (const el of [els].flat()) {
      const n = GPSB.effective(canonical ? nodeFor(el) : node);
      el.style.cssText = decl(nodeStyle(n, p, ctx)).join(' ');
      const [attrs, extra] = nodeAttrs(n, ctx), cls = splitCls(extra), prev = owned.get(el) ?? { attrs: new Set(MANAGED), cls: [] };
      for (const k of prev.attrs) if (!(k in attrs)) el.removeAttribute(k);
      for (const [k, v] of Object.entries(attrs)) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
      el.classList.remove(...prev.cls.filter(c => !cls.includes(c)));
      if (cls.length) el.classList.add(...cls);
      owned.set(el, { attrs: new Set([...MANAGED, ...Object.keys(attrs)]), cls });
      for (const c of n.components ?? []) componentDef(c.type, ctx.customs)?.patch?.(el, propsOf(c, ctx), ctx);
    }
    if (!parent) layout();
  },
  // on: bool or 'toggle' (per element: Repeat clones toggle independently)
  setActive(id, on) { for (const el of GPSB.els(id)) { const n = nodeFor(el); n.active = on === 'toggle' ? n.active === false : !!on; GPSB.applyNode(n, undefined, el); } },
  assets: {
    url: p => ctx.asset(p),
    json: p => fetch(ctx.asset(p)).then(r => r.json()),
    text: p => fetch(ctx.asset(p)).then(r => r.text()),
  },
  reindex,
};
window.GPSB = GPSB;

// ---------- Canvas Scaler ----------
function layout() {
  const root = GPSB.effective(data.tree), cv = GPSB.canvas;
  const sc = propsOf(getComponent(root, 'CanvasScaler') ?? { type: 'CanvasScaler' }, ctx);
  const height = getComponent(root, 'Canvas')?.props?.height ?? 0;
  const W = document.documentElement.clientWidth, H = innerHeight;
  let s = 1;
  if (sc.mode === 'scale-with-screen') // Unity's logarithmic width/height match
    s = Math.exp((1 - sc.match) * Math.log(W / sc.refWidth) + sc.match * Math.log(H / sc.refHeight));
  GPSB.scale = s;
  if (s === 1) {
    Object.assign(cv.style, { position: '', transform: '', width: '' });
    document.body.style.height = '';
    return;
  }
  Object.assign(cv.style, {
    position: 'absolute', left: '0', top: '0', transform: `scale(${s})`,
    width: `${W / s}px`, minHeight: `${height > 0 ? height : H / s}px`,
  });
  document.body.style.height = `${cv.offsetHeight * s}px`;
}
// breakpoint change: re-apply overridden nodes (text/attrs aren't CSS) and anything the runtime already styled inline
function refresh() {
  updateActive();
  for (const [n] of walk(data.tree)) if (n.overrides) GPSB.applyNode(n);
  for (const el of document.querySelectorAll('[data-gpsb][style]')) { const n = index.get(el.dataset.gpsb)?.node; if (n && !n.overrides) GPSB.applyNode(n, undefined, el); }
  layout();
}
for (const b of bps) b.mq.addEventListener('change', refresh);
if (active.length) refresh(); else layout();
addEventListener('resize', layout);
new ResizeObserver(() => GPSB.scale !== 1 && (document.body.style.height = `${GPSB.canvas.offsetHeight * GPSB.scale}px`)).observe(GPSB.canvas);

if (!data.editor) {
  const [anim, beh] = await Promise.all([import('./animator.js'), import('./behaviours.js')]);
  anim.boot(GPSB);
  await beh.boot(GPSB);
}
dispatchEvent(new Event('gpsb:ready'));
