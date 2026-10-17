// Editor state store. Every panel imports this; see CONTRACT.md "Editor".
import { findNode, walk, setProp as setPath, getProp, newNode, newId, clone, getComponent } from '/lib/node.js';
import { componentDef, withDefaults, builtins } from '/lib/components.js';
import { renderDocument, makeCtx } from '/lib/render.js';

export const S = {
  P: null,                 // { project, pages, components, behaviours, clips, json, assets } from /api/project
  page: 'index',
  selection: [],           // node ids, last = active
  tool: 'rect',            // hand | move | rotate | scale | rect   (Q W E R T)
  resolution: [1920, 1080],
  playing: false,
  behaviourMeta: {},       // Name -> { props, methods } (imported from behaviours/Name.js)
  anim: { clip: null, time: 0, recording: false, playing: false, animatorId: null },
  dirty: new Set(),        // project-relative files with unsaved changes
  previewWin: null,        // Scene iframe contentWindow once loaded (window.PSB inside it)
  hooks: {
    setProp: null,         // (id, path, value) => true if handled (animation record mode)
    animState: null,       // (id, path) => null | { value, keyed } (inspector tint / displayed value)
  },
};

// ---------- events ----------
// load | structure | props(ids) | selection | tool | page | anim | assets | log(entry) | play | resolution | saved | preview-ready
const subs = {};
export const on = (ev, fn) => ((subs[ev] ??= []).push(fn), () => (subs[ev] = subs[ev].filter(f => f !== fn)));
export const emit = (ev, ...a) => subs[ev]?.forEach(f => { try { f(...a); } catch (e) { console.error(e); if (ev !== 'log') log(`${ev} handler: ${e.message}`, 'error'); } });

export function log(msg, level = 'info', extra = {}) { emit('log', { msg: String(msg), level, time: new Date(), ...extra }); }

// ---------- lookups ----------
export const root = () => S.P?.pages[S.page];
export const node = id => findNode(root(), id)?.node ?? null;
export const parentOf = id => findNode(root(), id)?.parent ?? null;
export const selected = () => S.selection.map(node).filter(Boolean);
export const active = () => node(S.selection.at(-1));
export const def = type => componentDef(type, S.P?.components, S.behaviourMeta);
export const propsOf = c => withDefaults(def(c.type), c.props);
export const assetUrl = p => '/project/assets/' + String(p).split('/').map(encodeURIComponent).join('/');
export { getProp, walk, clone, newId, builtins, getComponent };

// ---------- undo / edits ----------
const undoStack = [], redoStack = [];
let lastEdit = { label: '', t: 0 };
const snap = () => JSON.stringify({ page: S.page, tree: root(), clips: S.P.clips });
function restore(json) {
  const s = JSON.parse(json);
  S.page = s.page; S.P.pages[s.page] = s.tree; S.P.clips = s.clips;
  S.dirty.add(`pages/${s.page}.json`);
  for (const k of Object.keys(s.clips)) S.dirty.add(`animations/${k}.anim.json`);
  S.selection = S.selection.filter(id => node(id));
  emit('structure'); emit('anim'); emit('selection');
}
export function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); }
export function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); }

// Wrap every mutation. kind: 'structure' (preview rebuild) | 'props' (patch nodes `ids`) | 'anim'.
// merge: consecutive edits with the same label within 1s share one undo step (drags, typing).
export function edit(label, fn, { kind = 'structure', ids = [], merge = false, files } = {}) {
  const now = performance.now();
  if (!(merge && lastEdit.label === label && now - lastEdit.t < 1000)) { undoStack.push(snap()); if (undoStack.length > 200) undoStack.shift(); }
  redoStack.length = 0;
  lastEdit = { label, t: now };
  fn();
  for (const f of files ?? [`pages/${S.page}.json`]) S.dirty.add(f);
  emit(kind, ids);
}

// Central property setter (Inspector, Scene gizmos, ...). Record mode may intercept it.
export function setProp(id, path, value, opts = {}) {
  if (S.hooks.setProp?.(id, path, value)) return;
  edit(`Set ${path} ${id}`, () => setPath(node(id), path, value), { kind: 'props', ids: [id], merge: true, ...opts });
}

// ---------- selection / tools ----------
export function select(ids, additive = false) {
  ids = [ids].flat().filter(Boolean);
  S.selection = additive ? [...S.selection.filter(i => !ids.includes(i)), ...ids.filter(i => !S.selection.includes(i))] : ids;
  emit('selection');
}
export function setTool(t) { S.tool = t; emit('tool'); }

// ---------- node operations ----------
const rect = (o = {}) => ({ anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], pos: [0, 0], size: [100, 100], rotation: 0, scale: [1, 1], ...o });
const stretch = { anchorMin: [0, 0], anchorMax: [1, 1], size: [0, 0] };
// GameObject > UI menu. Each returns a node.
export const PRESETS = {
  'Create Empty': () => newNode('GameObject'),
  Panel: () => Object.assign(newNode('Panel', [{ type: 'Image', props: { color: '#ffffffc0' } }]), { rect: rect(stretch) }),
  Image: () => newNode('Image', [{ type: 'Image', props: {} }]),
  Text: () => Object.assign(newNode('Text', [{ type: 'Text', props: {} }]), { rect: rect({ size: [200, 50] }) }),
  Button: () => {
    const b = Object.assign(newNode('Button', [{ type: 'Image', props: { color: '#ffffff', radius: 4 } }, { type: 'Button', props: {} }]), { rect: rect({ size: [160, 30] }) });
    b.children.push(Object.assign(newNode('Text', [{ type: 'Text', props: { text: 'Button', size: 14, align: 'center', valign: 'middle' } }]), { rect: rect(stretch) }));
    return b;
  },
  Link: () => Object.assign(newNode('Link', [{ type: 'Text', props: { text: 'Link', color: '#2060ff' } }, { type: 'Link', props: {} }]), { rect: rect({ size: [160, 30] }) }),
  Video: () => Object.assign(newNode('Video', [{ type: 'Video', props: {} }]), { rect: rect({ size: [320, 180] }) }),
  Audio: () => Object.assign(newNode('Audio', [{ type: 'Audio', props: {} }]), { rect: rect({ size: [300, 54] }) }),
  'Horizontal Layout': () => Object.assign(newNode('Horizontal Layout', [{ type: 'HorizontalLayoutGroup', props: { spacing: 8 } }]), { rect: rect({ size: [400, 100] }) }),
  'Vertical Layout': () => Object.assign(newNode('Vertical Layout', [{ type: 'VerticalLayoutGroup', props: { spacing: 8 } }]), { rect: rect({ size: [200, 400] }) }),
  'Grid Layout': () => Object.assign(newNode('Grid Layout', [{ type: 'GridLayoutGroup', props: { spacing: [8, 8] } }]), { rect: rect({ size: [400, 400] }) }),
  'Scroll View': () => {
    const s = Object.assign(newNode('Scroll View', [{ type: 'Image', props: { color: '#ffffff80' } }, { type: 'ScrollRect', props: {} }]), { rect: rect({ size: [300, 300] }) });
    s.children.push(Object.assign(newNode('Content', [{ type: 'VerticalLayoutGroup', props: { spacing: 8, padding: [8, 8, 8, 8], controlWidth: true, expandWidth: true } }, { type: 'ContentSizeFitter', props: { vertical: 'preferred' } }]), { rect: rect({ anchorMin: [0, 0], anchorMax: [1, 0], pivot: [0.5, 0], size: [0, 300] }) }));
    return s;
  },
  Repeat: () => {
    const r = Object.assign(newNode('Repeat', [{ type: 'Repeat', props: {} }, { type: 'VerticalLayoutGroup', props: { spacing: 8 } }]), { rect: rect({ size: [300, 400] }) });
    r.children.push(Object.assign(newNode('Item', [{ type: 'Text', props: { text: '{{index}}: {{item}}' } }]), { rect: rect({ size: [300, 30] }) }));
    return r;
  },
};

export function addNode(n, parentId = root().id, index) {
  edit('Create ' + n.name, () => { const p = node(parentId) ?? root(); index == null ? p.children.push(n) : p.children.splice(index, 0, n); });
  select(n.id);
  return n;
}
export const create = (preset, parentId) => addNode(PRESETS[preset](), parentId);

export function deleteNodes(ids = S.selection) {
  ids = ids.filter(id => id !== root().id);
  if (!ids.length) return;
  edit('Delete', () => { for (const id of ids) { const p = parentOf(id); if (p) p.children = p.children.filter(c => c.id !== id); } });
  select([]);
}

const reid = n => { n.id = newId(); n.children?.forEach(reid); return n; };
export function duplicate(ids = S.selection) {
  const out = [];
  edit('Duplicate', () => {
    for (const id of ids) {
      const p = parentOf(id); if (!p) continue;
      const c = reid(clone(node(id)));
      p.children.splice(p.children.findIndex(x => x.id === id) + 1, 0, c);
      out.push(c.id);
    }
  });
  select(out);
}

export function reparent(id, newParentId, index) {
  if (id === root().id) return;
  const target = node(newParentId);
  for (const [n] of walk(node(id))) if (n === target) return; // no cycles
  edit('Reparent', () => {
    const p = parentOf(id), n = node(id);
    const old = p.children.indexOf(n);
    p.children.splice(old, 1);
    if (p === target && index != null && index > old) index--;
    index == null ? target.children.push(n) : target.children.splice(index, 0, n);
  });
}

export function addComponent(id, type) {
  const d = def(type);
  if (!d) return log(`Unknown component ${type}`, 'error');
  const n = node(id);
  if (getComponent(n, type) && !type.startsWith('behaviour:')) return log(`${n.name} already has ${type}`, 'warn');
  edit('Add ' + type, () => n.components.push({ type, props: withDefaults(d, {}) }));
}
export function removeComponent(id, i) { edit('Remove component', () => node(id).components.splice(i, 1)); }
export function moveComponent(id, i, to) {
  edit('Move component', () => { const c = node(id).components; c.splice(to, 0, c.splice(i, 1)[0]); });
}

// ---------- pages ----------
export function setPage(name) { if (!S.P.pages[name]) return; S.page = name; S.selection = []; emit('page'); emit('structure'); emit('selection'); }
export function newPage(name) {
  if (S.P.pages[name]) return log(`Page ${name} exists`, 'warn');
  const canvas = newNode('Canvas', [{ type: 'Canvas', props: { title: name } }, { type: 'CanvasScaler', props: {} }]);
  S.P.pages[name] = canvas; S.dirty.add(`pages/${name}.json`);
  setPage(name);
}

// ---------- preview / generated code ----------
export const ctx = extra => makeCtx({ pages: Object.keys(S.P.pages), customs: S.P.components, behaviours: S.behaviourMeta, json: S.P.json, clips: S.P.clips, ...extra });
// editor=true: behaviours/animators don't auto-run (Scene). Play mode passes editor=false.
export const previewHTML = (editor = !S.playing) =>
  renderDocument(root(), ctx({ editor, base: '/project/' }), { name: S.page, cssHref: null }).html;
export const generatedCode = () => renderDocument(root(), ctx(), { name: S.page }); // { html, css } exactly as built

export function setPlaying(on) { S.playing = on; emit('play'); }

// ---------- files / server ----------
export const api = {
  get: p => fetch('/api/file?path=' + encodeURIComponent(p)).then(r => (r.ok ? r.text() : Promise.reject(new Error(r.statusText)))),
  put: (p, body) => fetch('/api/file?path=' + encodeURIComponent(p), { method: 'PUT', body }).then(r => (r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(t))))),
  del: p => fetch('/api/file?path=' + encodeURIComponent(p), { method: 'DELETE' }).then(r => r.json()),
  rename: (from, to) => fetch(`/api/rename?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: 'POST' }).then(r => r.json()),
  build: () => fetch('/api/build', { method: 'POST' }).then(r => (r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(t))))),
};

export async function save() {
  const files = [...S.dirty];
  for (const f of files) {
    let body;
    if (f === 'project.json') body = S.P.project;
    else if (f.startsWith('pages/')) body = S.P.pages[f.slice(6, -5)];
    else if (f.startsWith('animations/')) body = S.P.clips[f.slice(11, -10)];
    try {
      if (body === undefined) await api.del(f); else await api.put(f, JSON.stringify(body, null, 2));
      S.dirty.delete(f);
    } catch (e) { log(`Save ${f} failed: ${e.message}`, 'error'); }
  }
  log(`Saved ${files.length} file(s)`);
  emit('saved');
}

export async function build() {
  await save();
  try { const r = await api.build(); log(`Built ${r.pages.length} page(s) -> ${r.out}`); }
  catch (e) { log(`Build failed: ${e.message}`, 'error'); }
}

export async function upload(file, dir = '') {
  const p = ['assets', dir, file.name].filter(Boolean).join('/');
  await api.put(p, file);
  log(`Imported ${p}`);
  await reloadMeta();
  return p.slice(7);
}

async function loadBehaviours() {
  S.behaviourMeta = {};
  for (const [name, b] of Object.entries(S.P.behaviours)) {
    try {
      const m = await import(`/project/${b.path}?t=${Date.now()}`);
      const proto = m.default?.prototype ?? {};
      const methods = Object.getOwnPropertyNames(proto).filter(k => k !== 'constructor' && typeof proto[k] === 'function');
      S.behaviourMeta[name] = { props: m.props ?? m.default?.props ?? {}, methods };
    } catch (e) { S.behaviourMeta[name] = { props: {}, methods: [], error: String(e) }; log(`Behaviour ${name}: ${e.message}`, 'error'); }
  }
}

export async function load() {
  S.P = await fetch('/api/project').then(r => r.json());
  if (!S.P.pages[S.page]) S.page = Object.keys(S.P.pages)[0];
  await loadBehaviours();
  emit('load'); emit('page'); emit('assets'); emit('structure'); emit('selection'); emit('anim');
}

// Re-read assets / components / behaviours / json without touching pages or clips (unsaved edits survive).
export async function reloadMeta() {
  const P = await fetch('/api/project').then(r => r.json());
  for (const k of ['components', 'behaviours', 'assets', 'json']) S.P[k] = P[k];
  await loadBehaviours();
  emit('assets'); emit('structure');
}

// external file edits (VS Code etc.) -> hot reload components/behaviours/assets
new EventSource('/api/events').onmessage = e => {
  const { file } = JSON.parse(e.data);
  if (/^(components|behaviours|assets)\//.test(file)) { clearTimeout(load.t); load.t = setTimeout(reloadMeta, 150); }
};
