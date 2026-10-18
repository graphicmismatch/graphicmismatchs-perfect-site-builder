// Node tree helpers + property paths, shared by renderer, runtime, editor and animation.
//
// Property path syntax (Inspector edits and animation tracks both use it):
//   name | active
//   rect.pos | rect.pos.x | rect.size.y | rect.anchorMin.x | rect.pivot.y | rect.rotation | rect.scale.x | rect.zIndex
//   <Type>.<prop>[.x|.y|.z|.w|.<n>]       first component of that type, e.g. Image.color, Text.text
//   component:Card.title | behaviour:Spin.speed
//   <Type>[n].<prop>                      n-th component of that type (0-based), e.g. behaviour:Spin[1].speed
import { defaultRect } from './rect.js';

export const newId = () => Math.random().toString(36).slice(2, 8);

export const newNode = (name = 'WebObject', components = []) =>
  ({ id: newId(), name, active: true, rect: defaultRect(), components, children: [] });

export function* walk(node, parent = null) {
  yield [node, parent];
  for (const c of node.children ?? []) yield* walk(c, node);
}

export function findNode(root, id) {
  for (const [n, p] of walk(root)) if (n.id === id) return { node: n, parent: p };
  return null;
}

// Unity-style relative path "Child/Grandchild" from root ('' = root itself)
export function nodeAtPath(root, path) {
  let n = root;
  for (const name of path ? path.split('/') : []) {
    n = n.children?.find(c => c.name === name);
    if (!n) return null;
  }
  return n;
}

export function pathOf(root, id) {
  const names = [];
  const go = (n, acc) => {
    if (n.id === id) { names.push(...acc); return true; }
    return (n.children ?? []).some(c => go(c, [...acc, c.name]));
  };
  return go(root, []) ? names.join('/') : null;
}

export const getComponent = (node, type) => node.components?.find(c => c.type === type);

const IDX = { x: 0, y: 1, z: 2, w: 3 };
const key = k => (k in IDX ? IDX[k] : /^\d+$/.test(k) ? +k : k);

// -> [targetObject, keys[]] where keys index into targetObject
function resolve(node, path) {
  const parts = path.split('.');
  const head = parts.shift();
  if (head === 'name' || head === 'active') return [node, [head]];
  if (head === 'rect') return [node.rect, parts.map(key)];
  const m = head.match(/^(.+)\[(\d+)\]$/);
  const comp = m ? node.components?.filter(c => c.type === m[1])[+m[2]] : getComponent(node, head);
  if (!comp) return [null, []];
  comp.props ??= {};
  return [comp.props, parts.map(key)];
}

export function getProp(node, path) {
  let [o, keys] = resolve(node, path);
  for (const k of keys) { if (o == null) return undefined; o = o[k]; }
  return o;
}

export function setProp(node, path, value) {
  let [o, keys] = resolve(node, path);
  if (!o) return false;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
  return true;
}

export const clone = v => structuredClone(v);

// Path for the i-th component of a node: 'Image' or, for a repeated type, 'behaviour:Spin[1]'.
export function componentPath(node, i) {
  const t = node.components[i].type, n = node.components.slice(0, i).filter(c => c.type === t).length;
  return n ? `${t}[${n}]` : t;
}

// ---------- responsive breakpoints ----------
// node.overrides = { <breakpoint name>: { <property path>: value } }. A breakpoint applies when the viewport is
// at most maxWidth wide; overrides cascade from the widest active breakpoint to the narrowest.
export const DEFAULT_BREAKPOINTS = [{ name: 'Tablet', maxWidth: 1024 }, { name: 'Phone', maxWidth: 600 }];
export const sortBreakpoints = bps => [...(bps ?? DEFAULT_BREAKPOINTS)].sort((a, b) => b.maxWidth - a.maxWidth);
// names of the breakpoints active at `width` (widest first)
export const activeBreakpoints = (bps, width) => sortBreakpoints(bps).filter(b => width <= b.maxWidth).map(b => b.name);

// Node with the overrides of `names` applied (a shallow clone sharing children), or the node itself if none apply.
export function withOverrides(node, names) {
  const o = node.overrides;
  if (!o || !names.some(n => o[n])) return node;
  const c = { ...node, rect: structuredClone(node.rect), components: structuredClone(node.components) };
  for (const n of names) for (const [p, v] of Object.entries(o[n] ?? {})) setProp(c, p, structuredClone(v));
  return c;
}

// Whole tree with overrides applied (unchanged subtrees are shared).
export function effectiveTree(root, names) {
  const n = withOverrides(root, names);
  const kids = root.children?.map(c => effectiveTree(c, names));
  return kids?.some((k, i) => k !== root.children[i]) ? { ...n, children: kids } : n;
}

const under = (p, q) => p === q || p.startsWith(q + '.');
// Record an override; a narrower path is merged into an existing wider one (rect.pos.x into rect.pos).
export function setOverride(node, bp, path, value) {
  const o = ((node.overrides ??= {})[bp] ??= {});
  const wider = Object.keys(o).find(k => k !== path && under(path, k));
  if (wider) {
    const tmp = { ...node, rect: structuredClone(node.rect), components: structuredClone(node.components) };
    setProp(tmp, wider, structuredClone(o[wider]));
    setProp(tmp, path, value);
    o[wider] = getProp(tmp, wider);
    return;
  }
  for (const k of Object.keys(o)) if (under(k, path)) delete o[k];
  o[path] = value;
}
export function clearOverride(node, bp, path) {
  const o = node.overrides?.[bp];
  if (!o) return;
  for (const k of Object.keys(o)) if (!path || under(k, path) || under(path, k)) delete o[k];
  if (!Object.keys(o).length) delete node.overrides[bp];
  if (!Object.keys(node.overrides).length) delete node.overrides;
}
// true if `path` (or a part of it, or a whole containing it) is overridden at breakpoint `bp`
export const isOverridden = (node, bp, path) => Object.keys(node.overrides?.[bp] ?? {}).some(k => under(k, path) || under(path, k));
