// Prefabs (Unity-style reusable node trees). Isomorphic: build, dev server and editor all expand pages with it.
//
// prefabs/<Name>.prefab.json  a node subtree (its root rect is the default for new instances)
// An instance in a page (or inside another prefab) is saved as a reference:
//   { id, name, active, rect, prefab: 'Name', prefabOverrides?: { '<key>|<path>': value }, overrides? }
// expandPrefabs materialises it in place: the root keeps its id/name/active/rect/overrides (instance-owned), components
// and children come from the prefab, and every descendant gets the id `<instance id>-<id in the prefab>` (deterministic,
// so nested instances give `<outer>-<inner>-<x>`). Override keys name a node by that suffix ('' = the instance root):
//   'a1b2|Text.text' (base value), 'a1b2|@Phone|rect.size.x' (breakpoint override), '|Image.color' (instance root).
// Expanded nodes carry runtime-only marks: `_inst` (id of the outermost instance they belong to) and `_pf` (instance
// roots, = prefab name). collapsePrefabs turns an expanded tree back into references for saving.
import { walk, setProp, setOverride } from './node.js';

export const OWN = /^(name|active|rect)(\.|$)/; // instance-owned paths on the instance root
const INSTANCE_KEYS = ['id', 'name', 'active', 'rect', 'prefab', 'prefabOverrides', 'overrides'];

// the stored (reference) form of a node tree: instances lose their materialised content, marks are removed
export function collapsePrefabs(node) {
  if (node.prefab) {
    const out = {};
    for (const k of INSTANCE_KEYS) if (node[k] !== undefined && !(k === 'prefabOverrides' && !Object.keys(node[k]).length)) out[k] = structuredClone(node[k]);
    return out;
  }
  const { _inst, _pf, children, ...rest } = node;
  return { ...structuredClone(rest), children: (children ?? []).map(collapsePrefabs) };
}

// Expand every instance in `tree` in place. prefabs: { Name: tree } (stored or expanded form). Returns the tree.
// Missing or cyclic prefabs leave an empty instance marked `_missing`.
export function expandPrefabs(tree, prefabs, stack = []) {
  const visit = (n, outer) => {
    if (n.prefab && !outer) materialize(n, prefabs, stack); // nested instances were expanded inside their outer one
    const inst = outer ?? (n.prefab ? n.id : null);
    for (const c of n.children ?? []) { if (inst) c._inst = inst; visit(c, inst); }
  };
  visit(tree, null);
  return tree;
}

function materialize(n, prefabs, stack) {
  const name = n.prefab, src = prefabs[name];
  delete n._missing;
  if (!src || stack.includes(name)) {
    Object.assign(n, { components: [], children: [], _pf: name, _missing: src ? 'cycle' : 'missing' });
    return;
  }
  const m = collapsePrefabs(src); // stored form: nested instances are references again
  expandPrefabs(m, prefabs, [...stack, name]);
  // ids: <instance>-<prefab id>; references between the prefab's own nodes (event targets, node props) follow
  const ids = new Map();
  for (const [x] of walk(m)) ids.set(x.id, x === m ? n.id : `${n.id}-${x.id}`);
  for (const [x] of walk(m)) {
    x.id = ids.get(x.id);
    fixRefs(x.components, ids);
    if (x.overrides) fixRefs(x.overrides, ids);
  }
  n.components = m.components ?? [];
  n.children = m.children ?? [];
  n._pf = name;
  applyOverrides(n);
}

function fixRefs(o, ids) {
  for (const k in o) {
    const v = o[k];
    if (typeof v === 'string') { if (ids.has(v)) o[k] = ids.get(v); } else if (v && typeof v === 'object') fixRefs(v, ids);
  }
}

// key for node `id` inside the instance rooted at `rootId`
export const overrideKey = (rootId, id, path, bp) => `${id === rootId ? '' : id.slice(rootId.length + 1)}|${bp ? `@${bp}|` : ''}${path}`;

export function applyOverrides(inst) {
  const byId = new Map([...walk(inst)].map(([x]) => [x.id, x]));
  for (const [key, value] of Object.entries(inst.prefabOverrides ?? {})) {
    const [suffix, ...rest] = key.split('|'), node = byId.get(suffix ? `${inst.id}-${suffix}` : inst.id);
    if (!node) continue; // the prefab changed and that node is gone
    if (rest[0]?.startsWith('@')) setOverride(node, rest[0].slice(1), rest.slice(1).join('|'), structuredClone(value));
    else setProp(node, rest.join('|'), structuredClone(value));
  }
}

// The prefab content an expanded instance shows now (its overrides baked in): for "Apply to prefab".
// The prefab root keeps its own name/active/rect (instance-owned values are not applied).
export function bakeInstance(inst, prefabRoot) {
  // overrides that reach into a nested instance become that instance's own overrides (collapsing drops its content)
  for (const [x] of walk(inst)) {
    if (x === inst || !x.prefab) continue;
    const suffix = x.id.slice(inst.id.length + 1);
    for (const [k, v] of Object.entries(inst.prefabOverrides ?? {})) {
      const [s, ...rest] = k.split('|');
      if (s !== suffix && !s.startsWith(suffix + '-')) continue;
      (x.prefabOverrides ??= {})[[s === suffix ? '' : s.slice(suffix.length + 1), ...rest].join('|')] = structuredClone(v);
    }
  }
  const strip = id => (id === inst.id ? prefabRoot.id : id.slice(inst.id.length + 1));
  const ids = new Map([...walk(inst)].map(([x]) => [x.id, strip(x.id)]));
  const out = structuredClone(collapseInside(inst));
  for (const [x] of walk(out)) { x.id = ids.get(x.id) ?? x.id; fixRefs(x.components, ids); if (x.overrides) fixRefs(x.overrides, ids); }
  Object.assign(out, { id: prefabRoot.id, name: prefabRoot.name, active: prefabRoot.active, rect: structuredClone(prefabRoot.rect) });
  if (prefabRoot.overrides) out.overrides = structuredClone(prefabRoot.overrides); else delete out.overrides;
  delete out.prefab; delete out.prefabOverrides;
  return out;
}
// like collapsePrefabs, but keeps this node's own materialised content (nested instances still collapse)
const collapseInside = n => { const { _inst, _pf, _missing, children, ...rest } = n; return { ...rest, children: (children ?? []).map(collapsePrefabs) }; };

// plain nodes from an instance (Unpack): ids stay, references stay valid, nested instances are unpacked too
export function unpackInstance(inst) {
  for (const [x] of walk(inst)) { delete x.prefab; delete x.prefabOverrides; delete x._inst; delete x._pf; delete x._missing; }
  return inst;
}

// strip runtime marks (page data shipped to the browser)
export function stripMarks(tree) {
  for (const [x] of walk(tree)) { delete x._inst; delete x._pf; delete x._missing; delete x.prefabOverrides; }
  return tree;
}
