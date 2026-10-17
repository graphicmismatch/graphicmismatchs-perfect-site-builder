// Node tree helpers + property paths, shared by renderer, runtime, editor and animation.
//
// Property path syntax (Inspector edits and animation tracks both use it):
//   name | active
//   rect.pos | rect.pos.x | rect.size.y | rect.anchorMin.x | rect.pivot.y | rect.rotation | rect.scale.x
//   <Type>.<prop>[.x|.y|.z|.w|.<n>]       first component of that type, e.g. Image.color, Text.text
//   component:Card.title | behaviour:Spin.speed
import { defaultRect } from './rect.js';

export const newId = () => Math.random().toString(36).slice(2, 8);

export const newNode = (name = 'GameObject', components = []) =>
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
  const comp = getComponent(node, head);
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
