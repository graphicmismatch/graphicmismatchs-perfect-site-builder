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

export async function createScript(name) {
  await S.api.put(`behaviours/${name}.js`, behaviourTemplate(name));
  await S.reloadMeta();
  S.log(`Created behaviours/${name}.js`);
}
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

// component type a -> b in a type, property path ('behaviour:Spin.speed', 'behaviour:Spin[1].speed') or event call
const typeRef = (a, b) => v => (v === a ? b : v.startsWith(a + '.') || v.startsWith(a + '[') ? b + v.slice(a.length) : undefined);

// from/to are project-relative paths; kind: 'asset' | 'folder' | 'component' | 'behaviour' | 'anim'
export async function renamePath(from, to, kind) {
  if (from === to) return;
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
