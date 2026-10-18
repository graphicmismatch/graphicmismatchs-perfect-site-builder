// Project file helpers shared by the Inspector and Project panels: templates, create/rename with
// reference fix-up, and the built-in code editor modal.
import * as S from './state.js';
import { h, codeKeys } from './fields.js';

export const behaviourTemplate = name => `// ${name}: attach with Add Component > Scripts > ${name}.
// Props show up in the Inspector. Any method can be called from an event: behaviour:${name}.<method>
export const props = {
  speed: { type: 'number', default: 1, help: 'example property' },
};

export default class ${name} {
  // injected: this.el, this.node, this.props, this.GPSB, this.find(path), this.apply(), this.animator, this.setActive(bool)
  start() {}

  update(dt) {}

  onClick(e) {}

  doSomething(arg) {
    console.log('${name}.doSomething', arg, this.props.speed);
  }
}
`;

// TypeScript versions use the engine API (gpsb/engine.js, docs/engine-api.md): typed prop fields, applied automatically
export const behaviourTemplateTS = name => `// ${name}: attach with Add Component > Scripts > ${name}.
// Props show up in the Inspector. Any public method can be called from an event: behaviour:${name}.<method>
import { Behaviour, prop, Time, wait } from '../gpsb/engine.js';

export default class ${name} extends Behaviour {
  static props = {
    speed: prop.number(90, { help: 'degrees per second' }),
  };
  declare speed: number; // typed field for the prop above (reads and writes this.props.speed)

  start() {}

  update() {
    this.rectTransform.rotation += this.speed * Time.deltaTime; // changes are applied at the end of the frame
  }

  onClick() {
    this.webObject.punchScale(0.15, 0.3);
  }

  // behaviour:${name}.pulse
  pulse() {
    this.startCoroutine(function* (this: ${name}) {
      yield this.webObject.scaleTo(1.2, 0.2).ease('outBack');
      yield wait(0.1);
      yield this.webObject.scaleTo(1, 0.2);
    });
  }
}
`;

export const extensionTemplateTS = name => `// ${name}: an extension component. Add it with Add Component > Extensions > ${name}.
// It works like a built-in: props show in the Inspector, can be animated and overridden per breakpoint.
// This file runs at build time (Node) and in the browser, so keep browser-only code inside init / patch.
import { Extension, defineExtension, prop, html, type Color } from '../gpsb/engine.js';

class ${name} extends Extension {
  static props = {
    text: prop.string('Hello'),
    color: prop.color('#202020'),
  };
  declare text: string;
  declare color: Color;

  // CSS declarations for the element
  style() { return { color: this.color }; }
  // HTML written into the page at build time (and shown in the editor); values are escaped
  inner() { return html\`<span class="ext-text">\${this.text}</span>\`; }
  // a prop changed (Inspector, animation, breakpoint): update the element
  patch(el: HTMLElement) { const t = el.querySelector(':scope > .ext-text'); if (t) t.textContent = this.text; }
  // published page / Play mode, once per element (setting a prop field re-applies the element)
  init(el: HTMLElement) {}
}

export default defineExtension(${name});
`;

export const extensionTemplate = name => `// ${name}: an extension component. Add it with Add Component > Extensions > ${name}.
// It works like a built-in: props show in the Inspector, can be animated and overridden per breakpoint.
// This file runs at build time (Node) and in the browser, so keep browser-only code inside init / patch.
// Hooks: style, attrs, inner, rules, head, patch, init, state (see CONTRACT.md "Extension components").
export default ({ esc }) => ({
  category: 'Extensions',
  props: {
    text: { type: 'string', default: 'Hello' },
    src: { type: 'string', default: '', help: 'optional URL of JSON { "text": "..." } loaded on the published page' },
  },
  // HTML written into the page at build time (and shown in the editor)
  inner: p => \`<span class="ext-text">\${esc(p.text)}</span>\`,
  // a prop changed (Inspector, animation, breakpoint): update the element
  patch: (el, p) => { const t = el.querySelector(':scope > .ext-text'); if (t) t.textContent = p.text; },
  // published page / Play mode, once per element: fetch data, start widgets, listen to events
  init({ el, GPSB, ci }) {
    const n = GPSB.nodeFor(el), p = n.components[ci].props;
    if (!p.src) return;
    fetch(p.src).then(r => r.json()).then(d => { p.text = String(d.text ?? ''); GPSB.applyNode(n, undefined, el); });
  },
});
`;

export const componentTemplate = name => `<template>
  <div class="box">
    <h3>{{title}}</h3>
    <slot></slot>
  </div>
</template>

<style>
  :host { display: block; }
  .box { width: 100%; height: 100%; box-sizing: border-box; padding: 12px; border-radius: 6px; background: #f4f4f4; font: 14px system-ui, sans-serif; }
  h3 { margin: 0 0 8px; cursor: pointer; }
</style>

<script type="application/json" props>
{
  "title": { "type": "string", "default": "${name}", "help": "heading text" }
}
</script>

<script>
  import { Component } from '../gpsb/component.js';
  export default class extends Component {
    rendered() {
      this.$('h3').onclick = () => this.emit('picked', this.props.title);
    }
  }
</script>
`;

export const clipTemplate = name => ({ name, length: 1, loop: true, fps: 60, tracks: [], events: [] });

export const validName = n => /^[A-Za-z_][\w-]*$/.test(n);
export function uniqueName(base, taken, sep = ' ') {
  if (!taken(base)) return base;
  for (let i = 1; ; i++) if (!taken(`${base}${sep}${i}`)) return `${base}${sep}${i}`;
}

export async function createScript(name, lang = 'js') {
  await S.api.put(`behaviours/${name}.${lang}`, (lang === 'ts' ? behaviourTemplateTS : behaviourTemplate)(name));
  await S.reloadMeta();
  S.log(`Created behaviours/${name}.${lang}`);
}
// the language new scripts default to: TypeScript once the project has any
export const defaultLang = () => [...Object.values(S.S.P.behaviours ?? {}), ...Object.values(S.S.P.extensions ?? {})].some(x => x.lang === 'ts') ? 'ts' : 'js';
export async function createComponent(name) {
  await S.api.put(`components/${name}.html`, componentTemplate(name));
  await S.reloadMeta();
  S.log(`Created components/${name}.html`);
}
export async function createClip(name) {
  const clip = clipTemplate(name);
  S.S.P.clips[name] = clip;
  await S.api.put(`animations/${name}.anim.json`, JSON.stringify(clip, null, 2));
  S.S.dirty.delete(`animations/${name}.anim.json`);
  S.emit('anim');
  S.log(`Created animations/${name}.anim.json`);
}

// Rewrite references in every page (and clip) after a rename. map(str) -> str | undefined.
// keyMap (same shape) also renames breakpoint override keys (property paths such as 'behaviour:Spin.speed').
function retarget(map, label, keyMap) {
  const files = [];
  const fix = (o, pk) => {
    let hit = 0;
    for (const k in o) {
      const v = o[k];
      if (typeof v === 'string') { const n = map(v, o, k, pk); if (n !== undefined && n !== v) { o[k] = n; hit++; } }
      else if (v && typeof v === 'object') hit += fix(v, k);
    }
    return hit;
  };
  S.edit(label, () => {
    for (const [name, tree] of Object.entries(S.S.P.pages)) {
      let hit = fix(tree);
      if (keyMap) for (const [n] of S.walk(tree)) for (const [bp, o] of Object.entries(n.overrides ?? {})) {
        if (!Object.keys(o).some(k => (keyMap(k) ?? k) !== k)) continue;
        n.overrides[bp] = Object.fromEntries(Object.entries(o).map(([k, v]) => [keyMap(k) ?? k, v]));
        hit++;
      }
      if (hit) files.push(`pages/${name}.json`);
    }
    for (const [name, clip] of Object.entries(S.S.P.clips)) if (fix(clip)) files.push(`animations/${name}.anim.json`);
  }, { files: [] });
  files.forEach(f => S.S.dirty.add(f));
  if (files.length) { S.log(`Updated references in ${files.join(', ')} (unsaved)`); S.emit('anim'); }
}

// ---------- design tokens ----------
// where a token is used: colours/fonts are "$name" values, text styles are Text.textStyle names
const tokenMatch = (kind, name) => kind === 'textStyles' ? (v, o, k) => k === 'textStyle' && v === name : v => v === '$' + name;
export function tokenUses(kind, name) {
  let n = 0;
  const m = tokenMatch(kind, name);
  const count = (o, pk) => { for (const k in o) { const v = o[k]; if (typeof v === 'string') n += m(v, o, k, pk) ? 1 : 0; else if (v && typeof v === 'object') count(v, k); } };
  for (const t of Object.values(S.S.P.pages)) count(t);
  for (const c of Object.values(S.S.P.clips)) count(c);
  return n;
}
export function renameToken(kind, from, to) {
  const m = tokenMatch(kind, from), out = kind === 'textStyles' ? to : '$' + to;
  retarget((v, o, k, pk) => (m(v, o, k, pk) ? out : undefined), `Rename token ${from}`);
}

// component type a -> b in a type, property path ('behaviour:Spin.speed', 'behaviour:Spin[1].speed') or event call
const typeRef = (a, b) => v => (v === a ? b : v.startsWith(a + '.') || v.startsWith(a + '[') ? b + v.slice(a.length) : undefined);

// from/to are project-relative paths; kind: 'asset' | 'folder' | 'component' | 'behaviour' | 'anim'
export async function renamePath(from, to, kind) {
  if (from === to) return;
  if (kind === 'prefab') return S.renamePrefab(from.slice(8, -12), to.slice(8, -12));
  if (kind === 'anim') {
    const a = from.slice(11, -10), b = to.slice(11, -10);
    if (S.S.P.clips[b]) throw new Error(`${b} exists`);
    const clip = { ...S.S.P.clips[a], name: b };
    await S.api.put(to, JSON.stringify(clip, null, 2));
    await S.api.del(from);
    delete S.S.P.clips[a]; S.S.P.clips[b] = clip;
    S.S.dirty.delete(from); S.S.dirty.delete(to);
    if (S.S.anim.clip === a) S.S.anim.clip = b;
    retarget((v, o, k, pk) => (v === a && (pk === 'clips' || (k === 'arg' && o.call === 'Animator.play')) ? b : undefined), 'Rename clip');
    S.emit('anim');
  } else {
    const r = await S.api.rename(from, to);
    if (!r?.ok) throw new Error('rename failed');
    if (kind === 'asset' || kind === 'folder') {
      const a = from.slice(7), b = to.slice(7);
      retarget(v => {
        if (v === a) return b;
        if (kind === 'folder' && v.startsWith(a + '/')) return b + v.slice(a.length);
        if (v.includes(`{{`)) return v.replace(/\{\{(\s*)([^{}:]+?):/g, (m, sp, p) => (p === a ? `{{${sp}${b}:` : kind === 'folder' && p.startsWith(a + '/') ? `{{${sp}${b}${p.slice(a.length)}:` : m));
      }, 'Rename asset');
    } else if (kind === 'component') {
      const m = typeRef('component:' + from.slice(11, -5), 'component:' + to.slice(11, -5));
      retarget(m, 'Rename component', m);
    } else if (kind === 'behaviour') {
      const m = typeRef('behaviour:' + from.slice(11, -3), 'behaviour:' + to.slice(11, -3));
      retarget(m, 'Rename behaviour', m);
    } else if (kind === 'extension') { // plain names: only component types, track props and override keys
      const a = from.slice(11, -3), b = to.slice(11, -3), m = typeRef(a, b);
      retarget((v, o, k) => (k === 'type' && v === a ? b : k === 'prop' && v !== a ? m(v) : undefined), 'Rename extension', v => (v === a ? undefined : m(v)));
    }
    await S.reloadMeta();
  }
  S.log(`Renamed ${from} -> ${to}`);
}

export async function deletePath(path, kind) {
  if (kind === 'anim') {
    const n = path.slice(11, -10);
    delete S.S.P.clips[n];
    S.S.dirty.delete(path);
    await S.api.del(path);
    S.emit('anim');
  } else { await S.api.del(path); await S.reloadMeta(); }
  S.log(`Deleted ${path}`);
}

// ---------- code editor modal ----------
let modal = null;
export async function openCode(path) {
  if (modal) modal.close();
  let src;
  try { src = await S.api.get(path); } catch (e) { return S.log(`Open ${path}: ${e.message}`, 'error'); }
  const ta = h('textarea', { class: 'cm-ta', spellcheck: 'false', wrap: 'off' });
  const gutter = h('pre', { class: 'cm-gut' });
  const title = h('span', { class: 'cm-title' }, path);
  const status = h('span', { class: 'cm-status' }, 'Ctrl+S save · Esc close · Tab indent');
  let saved = src, armed = false;
  const lines = () => { const n = ta.value.split('\n').length; if (gutter.childElementCount !== n) gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); };
  const dirty = () => { title.textContent = path + (ta.value !== saved ? ' *' : ''); };
  async function save() {
    const text = ta.value;
    if (path.endsWith('.json')) try { JSON.parse(text); } catch (e) { S.log(`${path}: invalid JSON (${e.message}), saved anyway`, 'warn'); }
    try {
      await S.api.put(path, text);
      saved = text; dirty(); armed = false;
      status.textContent = `Saved ${new Date().toLocaleTimeString()}`;
      S.log(`Saved ${path}`);
      const clip = path.match(/^animations\/(.+)\.anim\.json$/)?.[1];
      if (clip) try { S.S.P.clips[clip] = JSON.parse(text); S.S.dirty.delete(path); S.emit('anim'); } catch {}
    } catch (e) { S.log(`Save ${path} failed: ${e.message}`, 'error'); }
  }
  const close = () => { wrap.remove(); modal = null; };
  ta.value = src;
  ta.oninput = () => { lines(); dirty(); armed = false; };
  ta.onscroll = () => { gutter.scrollTop = ta.scrollTop; };
  const wrap = h('div', { class: 'cm-wrap' },
    h('div', { class: 'cm' },
      h('div', { class: 'cm-head' }, title, status, h('button', { class: 'btn', onclick: save }, 'Save'), h('button', { class: 'btn', onclick: () => tryClose() }, 'Close')),
      h('div', { class: 'cm-body' }, gutter, ta)));
  function tryClose() {
    if (ta.value === saved || armed) return close();
    armed = true;
    status.textContent = 'Unsaved changes: Esc again to discard, Ctrl+S to save';
  }
  wrap.addEventListener('keydown', e => {
    e.stopPropagation(); // keep editor shortcuts (undo, delete, tools) out of the modal
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); tryClose(); }
    else if (e.target === ta) codeKeys(e, ta);
  });
  wrap.onpointerdown = e => e.target === wrap && tryClose();
  document.body.append(wrap);
  lines();
  ta.focus(); ta.setSelectionRange(0, 0);
  modal = { close, ta, save };
  return modal;
}
