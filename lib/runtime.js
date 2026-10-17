// Page runtime (shipped as dist/psb/runtime.js). Boots the Canvas Scaler, exposes window.PSB,
// then loads the animator and behaviours (not in editor mode — the editor drives the preview itself).
import { nodeStyle, nodeAttrs, makeCtx, propsOf, decl } from './render.js';
import { walk, nodeAtPath, getComponent } from './node.js';
import { componentDef } from './components.js';

const data = JSON.parse(document.getElementById('psb-data').textContent);
const ctx = makeCtx({ pages: data.pages, customs: data.customs });
const index = new Map();
const reindex = () => { index.clear(); for (const [node, parent] of walk(data.tree)) index.set(node.id, { node, parent }); };
reindex();

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
  // Re-apply a node's data to its element(s): style, attributes, inner content. Pure: never touches the tree,
  // so callers mutate PSB.node(id) in place (animator, behaviours) or pass clones (editor preview).
  applyNode(node, parent = index.get(node.id)?.parent, els = PSB.els(node.id)) {
    const css = decl(nodeStyle(node, parent, ctx)).join(' ');
    const [attrs] = nodeAttrs(node, ctx);
    for (const el of [els].flat()) {
      el.style.cssText = css;
      for (const [k, v] of Object.entries(attrs)) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
      for (const c of node.components ?? []) componentDef(c.type, ctx.customs)?.patch?.(el, propsOf(c, ctx), ctx);
    }
    if (!parent) layout();
  },
  setActive(id, on) { const n = PSB.node(id); if (n) { n.active = on; PSB.applyNode(n); } },
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
  const root = data.tree, cv = PSB.canvas;
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
layout();
addEventListener('resize', layout);
new ResizeObserver(() => PSB.scale !== 1 && (document.body.style.height = `${PSB.canvas.offsetHeight * PSB.scale}px`)).observe(PSB.canvas);

if (!data.editor) {
  const [anim, beh] = await Promise.all([import('./animator.js'), import('./behaviours.js')]);
  anim.boot(PSB);
  await beh.boot(PSB);
}
dispatchEvent(new Event('psb:ready'));
