// Page runtime (shipped as dist/psb/runtime.js). Boots the Canvas Scaler, exposes window.PSB,
// then loads the animator and behaviours (not in editor mode — the editor drives the preview itself).
import { nodeStyle, nodeAttrs, makeCtx, propsOf, decl } from './render.js';
import { walk, nodeAtPath, getComponent, withOverrides } from './node.js';
import { componentDef } from './components.js';

const data = JSON.parse(document.getElementById('psb-data').textContent);
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
  const id = el.dataset.psb, node = index.get(id)?.node;
  const chain = [];
  for (let n = index.get(id)?.parent; n; n = index.get(n.id)?.parent) if (getComponent(n, 'Repeat')) chain.unshift(n);
  if (!node || !chain.length) return node;
  if (perEl.has(el)) return perEl.get(el);
  let scope = null;
  for (const rep of chain) {
    const repEl = el.closest(`[data-psb="${rep.id}"]`);
    let kid = el;
    while (kid && kid.parentElement !== repEl) kid = kid.parentElement;
    const index = Math.floor([...repEl.children].filter(c => c.dataset.psb).indexOf(kid) / Math.max(1, rep.children.length));
    scope = { ...scope, item: data.repeats?.[rep.id]?.[index], index, parent: scope };
  }
  const n = structuredClone(node);
  for (const c of n.components ?? []) c.props = propsOf(c, ctx, scope);
  perEl.set(el, n);
  return n;
}

export const PSB = {
  data, ctx, editor: data.editor, scale: 1,
  canvas: document.querySelector('.psb-canvas'),
  node: id => index.get(id)?.node,
  parent: id => index.get(id)?.parent,
  el: id => document.querySelector(`[data-psb="${id}"]`),
  els: id => [...document.querySelectorAll(`[data-psb="${id}"]`)],
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
  // Pure: never touches the tree. Runtime code mutates node data in place (PSB.nodeFor(el) / PSB.node(id)) and
  // calls this; the editor preview passes clones. A canonical node is applied per element via nodeFor.
  applyNode(node, parent = index.get(node.id)?.parent, els = PSB.els(node.id)) {
    const canonical = index.get(node.id)?.node === node, p = parent && PSB.effective(parent);
    for (const el of [els].flat()) {
      const n = PSB.effective(canonical ? nodeFor(el) : node);
      el.style.cssText = decl(nodeStyle(n, p, ctx)).join(' ');
      for (const [k, v] of Object.entries(nodeAttrs(n, ctx)[0])) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
      for (const c of n.components ?? []) componentDef(c.type, ctx.customs)?.patch?.(el, propsOf(c, ctx), ctx);
    }
    if (!parent) layout();
  },
  setActive(id, on) { for (const el of PSB.els(id)) { const n = nodeFor(el); n.active = on; PSB.applyNode(n, undefined, el); } },
  assets: {
    url: p => ctx.asset(p),
    json: p => fetch(ctx.asset(p)).then(r => r.json()),
    text: p => fetch(ctx.asset(p)).then(r => r.text()),
  },
  reindex,
};
window.PSB = PSB;

// ---------- Canvas Scaler ----------
function layout() {
  const root = PSB.effective(data.tree), cv = PSB.canvas;
  const sc = propsOf(getComponent(root, 'CanvasScaler') ?? { type: 'CanvasScaler' }, ctx);
  const height = getComponent(root, 'Canvas')?.props?.height ?? 0;
  const W = document.documentElement.clientWidth, H = innerHeight;
  let s = 1;
  if (sc.mode === 'scale-with-screen') // Unity's logarithmic width/height match
    s = Math.exp((1 - sc.match) * Math.log(W / sc.refWidth) + sc.match * Math.log(H / sc.refHeight));
  PSB.scale = s;
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
  for (const [n] of walk(data.tree)) if (n.overrides) PSB.applyNode(n);
  for (const el of document.querySelectorAll('[data-psb][style]')) { const n = index.get(el.dataset.psb)?.node; if (n && !n.overrides) PSB.applyNode(n, undefined, el); }
  layout();
}
for (const b of bps) b.mq.addEventListener('change', refresh);
if (active.length) refresh(); else layout();
addEventListener('resize', layout);
new ResizeObserver(() => PSB.scale !== 1 && (document.body.style.height = `${PSB.canvas.offsetHeight * PSB.scale}px`)).observe(PSB.canvas);

if (!data.editor) {
  const [anim, beh] = await Promise.all([import('./animator.js'), import('./behaviours.js')]);
  anim.boot(PSB);
  await beh.boot(PSB);
}
dispatchEvent(new Event('psb:ready'));
