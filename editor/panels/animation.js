// Animation window (Unity's): clip toolbar, property list, dopesheet / curves, events row, record mode, Scene preview.
import * as S from '../state.js';
import { menu } from './toolbar.js';
import { evalTrack, applyClip, animatableProps, setKey, dedupeKeys, clipLength, snapTime, baseValue, findTrack, newClip, EASES, AXES } from '/lib/anim.js';
import { pathOf, nodeAtPath, getComponent } from '/lib/node.js';
import { withDefaults } from '/lib/components.js';

const ROW = 22, PAD = 14;
const A = () => S.S.anim;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const r6 = n => Math.round(n * 1e6) / 1e6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const EASE_NAMES = [['Linear', 'linear'], ['Constant', 'step'], ['Ease In', 'ease-in'], ['Ease Out', 'ease-out'], ['Ease In-Out', 'ease-in-out']];
const AXIS_COLOR = { x: '#e45a5a', y: '#6cc46c', z: '#5a8ee4', w: '#d6c24a' };

let el, ui = null, mode = '';
let view = 'dope', zoom = 200, ox = PAD, fitted = null, preview = false, raf = 0;
let sel = new Set(), selEv = new Set(), rowSel = new Set(), clipboard = null, drag = null, listSig = '', props = [];
const folds = new Set();
let applied = new Set();

// ---------- lookups ----------
const animator = () => (S.root() ? S.node(A().animatorId) : null);
const clip = () => S.S.P?.clips?.[A().clip] ?? null;
const meta = () => ({ customs: S.S.P?.components ?? {}, behaviours: S.S.behaviourMeta ?? {} });
const fps = () => clip()?.fps || 60;
const len = () => clipLength(clip()) || 1;
const clipFile = n => `animations/${n}.anim.json`;
const clipsOf = an => getComponent(an, 'Animator')?.props?.clips ?? [];
const editClip = (label, fn, merge = false) => S.edit(label, fn, { kind: 'anim', files: [clipFile(A().clip)], merge });
const X = t => ox + t * zoom, T = x => (x - ox) / zoom;
const snap = t => snapTime(Math.max(0, t), fps());
const tid = tr => tr.path + '|' + tr.prop;
const keyAt = (tr, t = A().time) => tr.keys.find(k => Math.abs(k.t - t) < 0.5 / fps());
const nodeOf = path => { const an = animator(); return an && nodeAtPath(an, path); };
const base = (path, prop) => { const n = nodeOf(path); return n ? baseValue(n, prop, meta()) : undefined; };
const current = tr => (tr.keys.length ? evalTrack(tr, A().time) : base(tr.path, tr.prop));
const info = (path, prop) => props.find(p => p.path === path && p.prop === prop);
const label = prop => prop === 'active' ? 'Active' : prop.replace(/^rect\./, 'Rect.').replace(/^(component|behaviour):/, '');
const fmt = t => { const f = fps(), n = Math.round(t * f), w = String(f - 1).length; return `${Math.floor(n / f)}:${String(n % f).padStart(w, '0')}`; };
const local = (e, t) => { const r = t.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const allKeys = () => (clip()?.tracks ?? []).flatMap(tr => tr.keys.map(k => [k, tr]));
const isNum = tr => { const i = info(tr.path, tr.prop); return i ? i.kind === 'float' : typeof tr.keys[0]?.v === 'number'; };
// new keys on int tracks are Constant (Unity animates ints discretely)
function putKey(c, path, prop, t, v) {
  const tr = findTrack(c, path, prop), fresh = !tr || !keyAt(tr, t);
  return setKey(c, path, prop, t, v, fresh && info(path, prop)?.type === 'int' ? 'step' : undefined);
}

// ---------- modes ----------
function setTime(t) { A().time = r6(Math.max(0, t)); S.emit('anim'); }
function setPreview(on) {
  preview = on;
  if (!on) { A().recording = false; play(false); }
  S.emit('anim');
}
function setRecording(on) { A().recording = on; if (on) preview = true; S.emit('anim'); }
function play(on = !A().playing) {
  cancelAnimationFrame(raf);
  A().playing = on;
  if (on) {
    preview = true;
    let last = performance.now();
    const step = now => {
      A().time = r6((A().time + (now - last) / 1000) % len());
      last = now;
      S.emit('anim');
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  S.emit('anim');
}
const stepFrame = d => setTime(snap(A().time + d / fps()));
function jumpKey(d) {
  const ts = [...new Set(allKeys().map(([k]) => k.t))].sort((a, b) => a - b), t = A().time, e = 0.5 / fps();
  const n = d > 0 ? ts.find(x => x > t + e) : ts.reverse().find(x => x < t - e);
  if (n != null) setTime(n);
}

// ---------- target ----------
function retarget() {
  const s = S.S.P && S.active();
  let n = s;
  while (n && !getComponent(n, 'Animator')) n = S.parentOf(n.id);
  const prev = [A().animatorId, A().clip];
  if (n) A().animatorId = n.id;
  else if (s || !animator()) A().animatorId = null;
  const an = animator(), list = an ? clipsOf(an) : [];
  if (!list.includes(A().clip)) A().clip = list.find(c => S.S.P?.clips?.[c]) ?? null;
  if (prev[0] !== A().animatorId || prev[1] !== A().clip) {
    if (prev[0] !== A().animatorId) { cancelAnimationFrame(raf); Object.assign(A(), { playing: false, recording: false, time: 0 }); preview = false; }
    sel.clear(); selEv.clear(); rowSel.clear(); fitted = null;
    S.emit('anim');
  } else refresh();
}

// ---------- Scene preview ----------
// Selecting an element inside the Animator previews only that element's (and its children's) tracks;
// selecting the Animator itself, or nothing inside it, previews the whole clip.
function inScope() {
  const an = animator();
  if (!an) return () => true;
  const under = id => { for (let n = S.node(id); n; n = S.parentOf(n.id)) if (n.id === an.id) return true; return false; };
  const ids = S.S.selection.filter(under);
  if (!ids.length || ids.includes(an.id)) return () => true;
  return id => { for (let n = S.node(id); n && n.id !== an.id; n = S.parentOf(n.id)) if (ids.includes(n.id)) return true; return false; };
}
function applyPreview() {
  const W = S.S.previewWin?.GPSB;
  if (!W?.applyNode || S.S.playing) return;
  const an = animator(), c = clip(), ok = inScope();
  const map = preview && an && c ? applyClip(an, c, A().time, meta()) : new Map();
  for (const id of map.keys()) if (!ok(id)) map.delete(id);
  try {
    for (const id of applied) if (!map.has(id)) { const n = S.node(id); if (n) W.applyNode(n, S.parentOf(id)); }
    for (const [id, n] of map) { const p = S.parentOf(id); W.applyNode(n, (p && map.get(p.id)) ?? p); }
  } catch (e) { console.warn('animation preview:', e); }
  applied = new Set(map.keys());
}

// ---------- hooks (record mode + inspector tint) ----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function recordHook(id, path, value) {
  if (!A().recording) return false;
  const an = animator(), c = clip(), rel = an && c ? pathOf(an, id) : null;
  if (rel == null || path === 'name' || path.startsWith('Animator.')) return false; // Animator config is read once at boot
  const all = animatableProps(an, meta()), n = S.node(id), writes = [];
  let unhandled = false;
  const expand = (prop, v, direct) => {
    if (findTrack(c, rel, prop) || all.some(p => p.path === rel && p.prop === prop)) return void writes.push([prop, v, direct]); // existing whole-vector tracks win
    if (Array.isArray(v)) v.forEach((x, i) => expand(`${prop}.${AXES[i] ?? i}`, x, false));
    else if (v && typeof v === 'object') for (const k in v) expand(`${prop}.${k}`, v[k], false);
    else unhandled = true;
  };
  expand(path, value, true);
  if (!writes.length) return false;
  const todo = writes.filter(([prop, v, direct]) => {
    const tr = findTrack(c, rel, prop);
    return direct || !same(tr?.keys.length ? evalTrack(tr, A().time) : baseValue(n, prop, meta()), v);
  });
  if (todo.length) editClip(`Record ${id} ${path}`, () => {
    for (const [prop, v] of todo) {
      if (!findTrack(c, rel, prop)?.keys.length && A().time > 0) putKey(c, rel, prop, 0, baseValue(n, prop, meta()));
      putKey(c, rel, prop, A().time, structuredClone(v));
    }
  }, true);
  return true;
}
function animState(id, path) {
  if (!preview && !A().recording) return null;
  const an = animator(), c = clip(), rel = an && c ? pathOf(an, id) : null;
  if (rel == null || !inScope()(id)) return null;
  const tr = findTrack(c, rel, path);
  if (tr?.keys.length) return { value: evalTrack(tr, A().time), keyed: !!keyAt(tr) };
  const axes = c.tracks.filter(x => x.path === rel && x.keys.length && x.prop.startsWith(path + '.'));
  const v = structuredClone(baseValue(S.node(id), path, meta()));
  if (!axes.length || !Array.isArray(v)) return null;
  for (const x of axes) { const k = x.prop.slice(path.length + 1), i = AXES.includes(k) ? AXES.indexOf(k) : +k; if (i >= 0 && i < v.length) v[i] = evalTrack(x, A().time); }
  return { value: v, keyed: axes.some(x => keyAt(x)) };
}

// ---------- mount ----------
export function mount(root) {
  el = root;
  S.S.hooks.setProp = recordHook;
  S.S.hooks.animState = animState;
  el.tabIndex = -1;
  el.addEventListener('keydown', onKey);
  for (const ev of ['load', 'page', 'structure', 'selection']) S.on(ev, retarget);
  S.on('anim', refresh);
  S.on('props', ids => { if (ids?.includes?.(A().animatorId)) retarget(); applyPreview(); });
  S.on('preview-ready', () => applyPreview());
  S.on('play', () => {
    if (!S.S.playing) return;
    cancelAnimationFrame(raf);
    Object.assign(A(), { playing: false, recording: false });
    preview = false; applied.clear();
    S.emit('anim');
  });
  S.on('show-tab', () => requestAnimationFrame(draw));
  retarget();
}

// ---------- layout ----------
let emptySig = '';
function renderEmpty(an) {
  const n = an ?? (S.S.P && S.active()), sig = `${n?.id}|${n?.name}|${!!an}`;
  if (mode === 'empty' && sig === emptySig) return;
  ui = null; mode = 'empty'; emptySig = sig;
  el.className = 'panel anim-empty';
  if (!n) { el.innerHTML = `<div class="an-msg">No animatable object selected.</div>`; return; }
  el.innerHTML = `<div class="an-msg"><p>To begin animating <b>${esc(n.name)}</b>, create ${an ? '' : 'an Animator and '}an Animation Clip.</p><button class="btn">Create</button></div>`;
  el.querySelector('button').onclick = e => popover(e, 'Create New Animation', [{ label: 'Name', value: n.name }], ([name]) => createClip(name, n.id));
}

function createClip(name, nodeId) {
  name = String(name).replace(/[^\w\- ]+/g, '').trim() || 'New Animation';
  for (let i = 1, b = name; S.S.P.clips[name]; i++) name = `${b} ${i}`;
  const n = S.node(nodeId);
  if (!n) return;
  S.edit('Create Clip ' + name, () => {
    S.S.P.clips[name] = newClip(name);
    let a = getComponent(n, 'Animator');
    if (!a) n.components.push(a = { type: 'Animator', props: withDefaults(S.def('Animator'), {}) });
    a.props ??= {};
    a.props.clips = [...(a.props.clips ?? []), name];
  }, { kind: 'structure', files: [`pages/${S.S.page}.json`, clipFile(name)] });
  Object.assign(A(), { animatorId: n.id, clip: name, time: 0 });
  sel.clear(); fitted = null;
  S.log(`Created animations/${name}.anim.json`);
  S.emit('anim');
}

function ensureMain() {
  if (mode === 'main') return;
  mode = 'main'; listSig = '';
  el.className = 'panel anim';
  el.innerHTML = `
  <div class="an-left an-tools">
    <button data-a="preview" title="Preview the clip in the Scene">Preview</button>
    <button data-a="rec" class="an-recbtn" title="Record mode: changes write keys">●</button>
    <span class="an-sep"></span>
    <button data-a="first" title="First frame">⏮</button><button data-a="prev" title="Previous frame (,)">◀|</button>
    <button data-a="play" title="Play (Space)">▶</button>
    <button data-a="next" title="Next frame (.)">|▶</button><button data-a="last" title="Last frame">⏭</button>
    <input data-a="frame" type="number" min="0" step="1" title="Current frame">
  </div>
  <canvas class="an-ruler"></canvas>
  <div class="an-left an-clipbar">
    <select data-a="clip" title="Clip"></select>
    <label title="Length (seconds)">len<input data-a="len" type="number" min="0.01" step="0.1"></label>
    <label title="Samples per second">fps<input data-a="fps" type="number" min="1" max="240" step="1"></label>
    <label title="Loop time"><input data-a="loop" type="checkbox">loop</label>
    <button data-a="addkey" title="Add keyframe at the playhead">◆+</button>
    <button data-a="addev" title="Add event at the playhead">▮+</button>
  </div>
  <canvas class="an-events" title=""></canvas>
  <div class="an-body"><div class="an-list"></div><canvas class="an-tl"></canvas></div>
  <div class="an-left an-foot"><button class="btn" data-a="addprop">Add Property</button></div>
  <div class="an-foot2"><div class="an-keyinfo"></div><div class="an-views"><button data-a="dope">Dopesheet</button><button data-a="curves">Curves</button></div></div>`;
  const q = s => el.querySelector(s);
  ui = { ruler: q('.an-ruler'), events: q('.an-events'), body: q('.an-body'), list: q('.an-list'), tl: q('.an-tl'), keyinfo: q('.an-keyinfo') };
  for (const b of el.querySelectorAll('[data-a]')) ui[b.dataset.a] = b;

  ui.preview.onclick = () => setPreview(!preview);
  ui.rec.onclick = () => setRecording(!A().recording);
  ui.first.onclick = () => { preview = true; setTime(0); };
  ui.prev.onclick = () => { preview = true; stepFrame(-1); };
  ui.next.onclick = () => { preview = true; stepFrame(1); };
  ui.last.onclick = () => { preview = true; setTime(len()); };
  ui.play.onclick = () => play();
  ui.frame.onchange = () => { preview = true; setTime(Math.max(0, +ui.frame.value || 0) / fps()); };
  ui.clip.onchange = () => {
    const v = ui.clip.value;
    ui.clip.value = A().clip ?? '';
    if (v === '__new__') return popover(ui.clip, 'Create New Clip', [{ label: 'Name', value: 'New Animation' }], ([name]) => createClip(name, A().animatorId));
    A().clip = v; sel.clear(); selEv.clear(); fitted = null; S.emit('anim');
  };
  ui.len.onchange = () => { const v = +ui.len.value; if (v > 0) editClip('Clip Length', () => { clip().length = r6(v); }); };
  ui.fps.onchange = () => { const v = Math.round(+ui.fps.value); if (v > 0) editClip('Clip Sample Rate', () => { clip().fps = v; }); };
  ui.loop.onchange = () => editClip('Clip Loop', () => { clip().loop = ui.loop.checked; });
  ui.addkey.onclick = () => addKeys(rowTracks(), A().time);
  ui.addev.onclick = e => addEvent(A().time, e);
  ui.addprop.onclick = () => addPropertyPopup(ui.addprop);
  ui.dope.onclick = () => { view = 'dope'; listSig = ''; refresh(); };
  ui.curves.onclick = () => { view = 'curves'; listSig = ''; refresh(); };

  for (const c of [ui.ruler, ui.events, ui.tl]) {
    c.addEventListener('wheel', e => wheel(e, c !== ui.tl || view === 'curves'), { passive: false });
    c.addEventListener('pointerdown', e => { el.focus({ preventScroll: true }); if (e.button === 1 || (e.button === 0 && e.altKey)) { e.preventDefault(); pan(e); } });
  }
  ui.ruler.addEventListener('pointerdown', rulerDown);
  ui.events.addEventListener('pointerdown', eventsDown);
  ui.events.ondblclick = eventsDbl;
  ui.events.oncontextmenu = eventsMenu;
  ui.events.onpointermove = e => { const ev = hitEvent(local(e, ui.events).x); ui.events.title = ev ? `${ev.call}(${ev.arg ?? ''})${ev.target ? ' → ' + ev.target : ''}` : ''; };
  ui.tl.addEventListener('pointerdown', tlDown);
  ui.tl.ondblclick = tlDbl;
  ui.tl.oncontextmenu = tlMenu;
  ui.body.onscroll = draw;
  new ResizeObserver(() => draw()).observe(ui.body);
}

// ---------- refresh ----------
// object identity in the list signature: undo/redo replaces track objects, so rows must rebuild
const oids = new WeakMap();
let oc = 0;
const objId = o => oids.get(o) ?? (oids.set(o, ++oc), oc);
function refresh() {
  if (!el) return;
  if (A().recording) preview = true;
  document.body.classList.toggle('anim-recording', !!A().recording);
  const an = animator();
  if (!S.S.P || !an || !clip()) { renderEmpty(an); applyPreview(); return; }
  ensureMain();
  el.classList.toggle('rec', !!A().recording);
  const live = new Set(allKeys().map(([k]) => k));
  for (const k of sel) if (!live.has(k)) sel.delete(k);
  for (const e of selEv) if (!clip().events?.includes(e)) selEv.delete(e);
  syncToolbar();
  const sig = JSON.stringify([A().animatorId, A().clip, view, clip().tracks.map(t => tid(t) + objId(t)), [...folds], [...rowSel], S.S.P.clips && Object.keys(S.S.P.clips)]);
  if (sig !== listSig) { listSig = sig; props = animatableProps(an, meta()); rebuildList(); }
  else updateValues();
  keyInfo();
  draw();
  applyPreview();
}

function syncToolbar() {
  const c = clip(), a = A();
  ui.preview.classList.toggle('on', preview);
  ui.rec.classList.toggle('on', !!a.recording);
  ui.play.classList.toggle('on', !!a.playing);
  ui.play.textContent = a.playing ? '❚❚' : '▶';
  if (document.activeElement !== ui.frame) ui.frame.value = Math.round(a.time * fps());
  const names = clipsOf(animator()).filter(n => S.S.P.clips[n]);
  const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('') + '<option disabled>──────</option><option value="__new__">Create New Clip…</option>';
  if (ui.clip.dataset.o !== opts) { ui.clip.innerHTML = opts; ui.clip.dataset.o = opts; }
  ui.clip.value = a.clip;
  if (document.activeElement !== ui.len) ui.len.value = c.length;
  if (document.activeElement !== ui.fps) ui.fps.value = c.fps;
  ui.loop.checked = !!c.loop;
  ui.dope.classList.toggle('on', view === 'dope');
  ui.curves.classList.toggle('on', view === 'curves');
}

// ---------- property list ----------
function buildRows() {
  const c = clip(), rows = [{ type: 'summary', tracks: c.tracks }], groups = new Map();
  for (const tr of c.tracks) { if (!groups.has(tr.path)) groups.set(tr.path, []); groups.get(tr.path).push(tr); }
  for (const [path, trs] of groups) {
    rows.push({ type: 'group', path, tracks: trs });
    if (!folds.has(path)) for (const tr of trs) rows.push({ type: 'track', tr, tracks: [tr] });
  }
  return rows;
}
let rows = [];
const rowKey = r => r.type === 'track' ? tid(r.tr) : r.type === 'group' ? 'g:' + r.path : 'sum';
// tracks of the selected rows (or all)
const rowTracks = () => { const t = rows.filter(r => rowSel.has(rowKey(r))).flatMap(r => r.tracks); return t.length ? [...new Set(t)] : clip().tracks; };

function rebuildList() {
  rows = buildRows();
  const an = animator();
  ui.list.innerHTML = '';
  for (const r of rows) {
    const d = document.createElement('div');
    d.className = `an-row an-${r.type}` + (rowSel.has(rowKey(r)) ? ' sel' : '');
    if (r.type === 'summary') d.innerHTML = `<span class="an-dim">${esc(A().clip)}</span>`;
    else if (r.type === 'group') {
      const missing = !nodeOf(r.path);
      d.innerHTML = `<span class="an-fold">${folds.has(r.path) ? '▸' : '▾'}</span><span class="an-name" title="${esc(r.path || an.name)}">${esc(r.path || an.name)}</span>${missing ? '<span class="an-missing">(Missing!)</span>' : ''}`;
      d.querySelector('.an-fold').onclick = e => { e.stopPropagation(); folds.has(r.path) ? folds.delete(r.path) : folds.add(r.path); refresh(); };
    } else {
      const tr = r.tr, i = info(tr.path, tr.prop);
      d.dataset.tid = tid(tr);
      d.innerHTML = `<span class="an-name" title="${esc(tr.prop)}">${esc(label(tr.prop))}</span><span class="an-val"></span><button class="an-more" title="Options">⋮</button>`;
      if (view === 'curves' && isNum(tr)) d.querySelector('.an-name').style.borderLeft = `3px solid ${color(tr)}`;
      d.querySelector('.an-val').append(field(tr, i));
      d.querySelector('.an-more').onclick = e => { e.stopPropagation(); trackMenu(tr, e.clientX, e.clientY); };
    }
    d.onpointerdown = e => {
      if (e.target.closest('input, select, button')) return;
      const k = rowKey(r);
      if (e.shiftKey || e.ctrlKey) rowSel.has(k) ? rowSel.delete(k) : rowSel.add(k); else { rowSel.clear(); rowSel.add(k); }
      refresh();
    };
    d.oncontextmenu = e => { if (r.tr) { e.preventDefault(); trackMenu(r.tr, e.clientX, e.clientY); } };
    ui.list.append(d);
  }
  updateValues();
}

function field(tr, i) {
  const type = i?.type ?? (typeof current(tr) === 'number' ? 'number' : typeof current(tr) === 'boolean' ? 'bool' : 'string');
  const write = v => writeKey(tr, v);
  let f;
  if (Array.isArray(current(tr))) { // whole-vector track, e.g. rect.pos = [x, y]
    f = document.createElement('input'); f.type = 'text'; f.spellcheck = false;
    f.onchange = () => { const v = f.value.split(/[\s,]+/).filter(Boolean).map(Number); if (v.every(Number.isFinite)) write(v); };
  } else if (type === 'bool') { f = document.createElement('input'); f.type = 'checkbox'; f.onchange = () => write(f.checked); }
  else if (type === 'enum') { f = document.createElement('select'); f.innerHTML = (i.options ?? []).map(o => `<option>${esc(o)}</option>`).join(''); f.onchange = () => write(f.value); }
  else if (type === 'color') {
    f = document.createElement('span'); f.className = 'an-color';
    f.innerHTML = '<input type="color"><input type="text" spellcheck="false">';
    const [sw, tx] = f.children;
    sw.oninput = () => { const cur = String(current(tr) ?? ''); write(sw.value + (cur.length === 9 ? cur.slice(7) : '')); };
    tx.onchange = () => write(tx.value.trim());
  } else if (type === 'number' || type === 'int') { f = document.createElement('input'); f.type = 'number'; f.step = type === 'int' ? '1' : 'any'; f.onchange = () => f.value !== '' && write(type === 'int' ? Math.round(+f.value) : +f.value); }
  else {
    f = document.createElement('input'); f.type = 'text'; f.spellcheck = false; f.onchange = () => write(f.value);
    f.ondragover = e => e.dataTransfer.types.includes('application/x-gpsb-asset') && e.preventDefault();
    f.ondrop = e => { const p = e.dataTransfer.getData('application/x-gpsb-asset'); if (p) { e.preventDefault(); write(p); } };
  }
  f.classList.add('an-field');
  return f;
}

function updateValues() {
  for (const d of ui.list.querySelectorAll('.an-track')) {
    const tr = clip().tracks.find(t => tid(t) === d.dataset.tid);
    if (!tr) continue;
    const v = current(tr), f = d.querySelector('.an-field');
    d.classList.toggle('keyed', !!keyAt(tr));
    d.classList.toggle('animated', !!tr.keys.length && !keyAt(tr));
    if (f.contains(document.activeElement)) continue;
    if (f.type === 'checkbox') f.checked = !!v;
    else if (f.classList.contains('an-color')) { f.children[1].value = v ?? ''; f.children[0].value = String(v ?? '#000000').slice(0, 7); }
    else f.value = typeof v === 'number' ? r6(+v.toFixed(4)) : Array.isArray(v) ? v.map(x => r6(+(+x).toFixed(3))).join(', ') : v ?? '';
  }
}

function writeKey(tr, v) {
  preview = true;
  editClip(`Key ${tr.prop}`, () => putKey(clip(), tr.path, tr.prop, A().time, v));
}

function trackMenu(tr, x, y) {
  const k = keyAt(tr);
  menu([
    { label: 'Add Key', action: () => addKeys([tr], A().time) },
    { label: 'Delete Key', disabled: !k, action: () => editClip('Delete Key', () => { tr.keys = tr.keys.filter(o => o !== keyAt(tr)); }) },
    '-',
    { label: 'Remove Property', action: () => editClip('Remove Property', () => { const c = clip(); c.tracks = c.tracks.filter(t => tid(t) !== tid(tr)); }) },
  ], x, y);
}

function addKeys(trs, t) {
  if (!trs.length) return;
  preview = true;
  t = snap(t);
  editClip('Add Key', () => { for (const tr of trs) putKey(clip(), tr.path, tr.prop, t, tr.keys.length ? evalTrack(tr, t) : base(tr.path, tr.prop)); });
}

// ---------- Add Property ----------
let pop = null;
function closePop() { pop?.remove(); pop = null; document.removeEventListener('pointerdown', popOutside, true); }
const popOutside = e => { if (pop && !pop.contains(e.target) && !e.target.closest('.menu')) closePop(); };
function openPop(node, x, y) {
  closePop();
  pop = node;
  document.body.append(pop);
  pop.style.left = clamp(x, 4, innerWidth - pop.offsetWidth - 4) + 'px';
  pop.style.top = clamp(y, 4, innerHeight - pop.offsetHeight - 4) + 'px';
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); e.stopPropagation(); });
  setTimeout(() => document.addEventListener('pointerdown', popOutside, true));
}

function addPropertyPopup(btn) {
  const an = animator(), all = animatableProps(an, meta()), open = new Set();
  const selPath = S.active() && pathOf(an, S.active().id);
  if (selPath != null) open.add(selPath);
  const p = document.createElement('div');
  p.className = 'an-pop an-addprop';
  p.innerHTML = '<input class="an-search" placeholder="Search properties"><div class="an-tree"></div>';
  const [search, tree] = p.children;
  const groups = [];
  const by = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    let h = '';
    groups.length = 0;
    for (const [path, es] of by(all, e => e.path)) {
      const name = path || an.name, isOpen = q || open.has(path);
      const items = [];
      for (const [comp, ces] of by(es, e => e.comp)) for (const [g, ges] of by(ces, e => e.group)) {
        if (q && !`${name} ${comp} ${g}`.toLowerCase().includes(q)) continue;
        items.push([comp, g, ges]);
      }
      if (!items.length) continue;
      h += `<div class="an-tnode" data-path="${esc(path)}">${isOpen ? '▾' : '▸'} ${esc(name)}</div>`;
      if (!isOpen) continue;
      let lastComp = null;
      for (const [comp, g, ges] of items) {
        if (comp !== lastComp) { h += `<div class="an-tcomp">${esc(comp.replace(/^(component|behaviour):/, ''))}</div>`; lastComp = comp; }
        const done = ges.every(e => findTrack(clip(), e.path, e.prop));
        groups.push(ges);
        h += `<div class="an-tleaf${done ? ' off' : ''}" data-g="${groups.length - 1}"><span>${esc(g.split('.').pop())}${ges.length > 1 ? ` <i>(${ges.map(e => e.label).join(', ')})</i>` : ''}</span><b>${done ? '' : '+'}</b></div>`;
      }
    }
    tree.innerHTML = h || '<div class="an-dim">No properties</div>';
  };
  search.oninput = paint;
  tree.onclick = e => {
    const t = e.target.closest('[data-path], [data-g]');
    if (!t) return;
    if (t.dataset.path != null) { open.has(t.dataset.path) ? open.delete(t.dataset.path) : open.add(t.dataset.path); return paint(); }
    if (t.classList.contains('off')) return;
    const es = groups[+t.dataset.g];
    // Unity: new properties get keys at the start and end of the clip holding the current value
    editClip('Add Property', () => {
      for (const e of es) if (!findTrack(clip(), e.path, e.prop)) {
        const v = base(e.path, e.prop);
        putKey(clip(), e.path, e.prop, 0, v);
        putKey(clip(), e.path, e.prop, len(), structuredClone(v));
      }
    });
    paint();
  };
  search.onkeydown = e => { if (e.key === 'Enter') tree.querySelector('.an-tleaf:not(.off)')?.click(); };
  paint();
  const r = btn.getBoundingClientRect();
  openPop(p, r.left, r.top - 330);
  search.focus();
}

// small form popover: fields [{ label, value, list }] -> ok(values)
function popover(at, title, fields, ok) {
  const f = document.createElement('form');
  f.className = 'an-pop an-form';
  f.innerHTML = `<b>${esc(title)}</b>` + fields.map((x, i) =>
    `<label><span>${esc(x.label)}</span><input name="f${i}" value="${esc(x.value ?? '')}" spellcheck="false"${x.list ? ` list="an-dl${i}"` : ''}></label>` +
    (x.list ? `<datalist id="an-dl${i}">${x.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '')).join('') +
    '<div class="an-btns"><button class="btn" type="submit">OK</button><button class="btn" type="button">Cancel</button></div>';
  f.onsubmit = e => { e.preventDefault(); const v = fields.map((x, i) => f.elements['f' + i].value); closePop(); ok(v); };
  f.querySelector('[type=button]').onclick = closePop;
  const r = at.getBoundingClientRect ? at.getBoundingClientRect() : { left: at.clientX, bottom: at.clientY };
  openPop(f, r.left, r.bottom + 2);
  f.elements.f0.focus(); f.elements.f0.select();
  return f;
}

// ---------- keys: selection, copy/paste, ease ----------
function deleteSel() {
  if (!sel.size && !selEv.size) return;
  editClip('Delete Keys', () => {
    const c = clip();
    for (const tr of c.tracks) tr.keys = tr.keys.filter(k => !sel.has(k));
    c.events = (c.events ?? []).filter(e => !selEv.has(e));
  });
}
function copySel() {
  const ks = allKeys().filter(([k]) => sel.has(k));
  if (!ks.length) return;
  const t0 = Math.min(...ks.map(([k]) => k.t));
  clipboard = ks.map(([k, tr]) => ({ path: tr.path, prop: tr.prop, dt: k.t - t0, v: structuredClone(k.v), ease: structuredClone(k.ease) }));
  S.log(`Copied ${ks.length} key(s)`);
}
function paste() {
  if (!clipboard?.length) return;
  const out = [];
  editClip('Paste Keys', () => { for (const k of clipboard) out.push(setKey(clip(), k.path, k.prop, snap(A().time + k.dt), structuredClone(k.v), k.ease)); });
  sel = new Set(out.filter(k => allKeys().some(([x]) => x === k)));
  refresh();
}
const commonEase = () => { const e = [...sel].map(k => JSON.stringify(k.ease ?? 'linear')); return e.length && e.every(x => x === e[0]) ? JSON.parse(e[0]) : null; };
function setEase(v) { editClip('Set Ease', () => { for (const k of sel) v === 'linear' ? delete k.ease : (k.ease = structuredClone(v)); }); }
function bezierOf(e) { return Array.isArray(e) ? e : e === 'linear' || !e ? [1 / 3, 1 / 3, 2 / 3, 2 / 3] : EASES[e]; }
function easeMenu(x, y) {
  const ce = commonEase();
  menu([
    ...EASE_NAMES.map(([l, v]) => ({ label: l, checked: ce === v, action: () => setEase(v) })),
    { label: 'Custom Bezier…', checked: Array.isArray(ce), action: () => {
      const b = bezierOf(ce ?? 'ease-in-out').map(n => r6(+n.toFixed(3)));
      popover({ clientX: x, clientY: y }, 'cubic-bezier(x1, y1, x2, y2)', [{ label: 'x1, y1, x2, y2', value: b.join(', ') }], ([s]) => {
        const v = s.split(/[\s,]+/).filter(Boolean).map(Number);
        if (v.length === 4 && v.every(Number.isFinite)) setEase([clamp(v[0], 0, 1), v[1], clamp(v[2], 0, 1), v[3]]);
        else S.log('Bezier needs 4 numbers', 'warn');
      });
    } },
    '-',
    { label: 'Copy', shortcut: 'Ctrl+C', action: copySel },
    { label: 'Paste at Playhead', shortcut: 'Ctrl+V', disabled: !clipboard, action: paste },
    { label: 'Delete Keys', shortcut: 'Del', action: deleteSel },
  ], x, y);
}

function keyInfo() {
  const ks = allKeys().filter(([k]) => sel.has(k));
  if (!ks.length) { ui.keyinfo.dataset.sig = ''; ui.keyinfo.innerHTML = selEv.size ? `<span class="an-dim">${selEv.size} event(s) selected — double-click to edit</span>` : ''; return; }
  const ce = commonEase(), easeVal = Array.isArray(ce) ? 'custom' : ce ?? '';
  const one = ks.length === 1 ? ks[0] : null;
  const sig = JSON.stringify([one && [one[0].t, one[0].v, one[1].prop], ks.length, ce, fps()]);
  if (ui.keyinfo.dataset.sig === sig) return;
  ui.keyinfo.dataset.sig = sig;
  ui.keyinfo.innerHTML = (one
    ? `<b>${esc(label(one[1].prop))}</b><label>time<input data-k="t" type="number" step="${r6(1 / fps())}" value="${one[0].t}"></label><span class="an-dim">(${fmt(one[0].t)})</span><label>value<input data-k="v" value="${esc(typeof one[0].v === 'number' ? r6(+one[0].v.toFixed(4)) : one[0].v)}"></label>`
    : `<b>${ks.length} keys</b>`) +
    `<label>ease<select data-k="e"><option value="" ${ce == null ? 'selected' : ''} disabled>—</option>${EASE_NAMES.map(([l, v]) => `<option value="${v}" ${easeVal === v ? 'selected' : ''}>${l}</option>`).join('')}<option value="custom" ${easeVal === 'custom' ? 'selected' : ''}>Custom</option></select></label>` +
    (Array.isArray(ce) ? `<input data-k="b" class="an-bez" value="${ce.map(n => r6(+n.toFixed(3))).join(', ')}">` : '');
  const q = s => ui.keyinfo.querySelector(`[data-k=${s}]`);
  if (one) {
    q('t').onchange = () => { const t = snap(+q('t').value); editClip('Move Key', () => { one[0].t = t; dedupeKeys(one[1], new Set([one[0]]), fps()); }); };
    q('v').onchange = () => { const raw = q('v').value, old = one[0].v; const v = typeof old === 'number' ? +raw : typeof old === 'boolean' ? raw === 'true' : raw; editClip('Key Value', () => { one[0].v = v; }); };
  }
  q('e').onchange = () => setEase(q('e').value === 'custom' ? bezierOf(ce) : q('e').value);
  if (q('b')) q('b').onchange = () => { const v = q('b').value.split(/[\s,]+/).map(Number); if (v.length === 4 && v.every(Number.isFinite)) setEase([clamp(v[0], 0, 1), v[1], clamp(v[2], 0, 1), v[3]]); };
}

// ---------- canvas helpers ----------
function size(cv, w, h) {
  const d = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  const g = cv.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = '10px system-ui, sans-serif';
  return g;
}
function diamond(g, x, y, s, fill, stroke = '#111') {
  g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath();
  g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.lineWidth = 1; g.stroke();
}
// ruler ticks: [major frame step, minor frame step]
function steps() {
  const f = fps(), ppf = zoom / f;
  const c = [...new Set([1, 2, 5, 10, f / 6, f / 4, f / 2, f, 2 * f, 5 * f, 10 * f, 30 * f, 60 * f, 300 * f].filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const major = c.find(n => n * ppf >= 64) ?? c.at(-1);
  const minor = [...c].reverse().find(n => n < major && major % n === 0 && n * ppf >= 7) ?? major;
  return [major, minor];
}
function grid(g, w, h, labels) {
  const f = fps(), [major, minor] = steps();
  const a = Math.floor(T(0) * f / minor) * minor, b = T(w) * f;
  for (let n = Math.max(0, a); n <= b; n += minor) {
    const x = Math.round(X(n / f)) + 0.5, maj = n % major === 0;
    g.strokeStyle = labels ? '#777' : maj ? '#ffffff14' : '#ffffff07';
    g.beginPath(); g.moveTo(x, labels ? h - (maj ? 10 : 5) : 0); g.lineTo(x, h); g.stroke();
    if (labels && maj) { g.fillStyle = '#aaa'; g.fillText(fmt(n / f), x + 3, 11); }
  }
}
function shade(g, w, h) {
  g.fillStyle = '#00000038';
  const x0 = X(0), x1 = X(len());
  if (x0 > 0) g.fillRect(0, 0, x0, h);
  if (x1 < w) g.fillRect(x1, 0, w - x1, h);
}
function playhead(g, h, head) {
  const x = Math.round(X(A().time)) + 0.5;
  g.strokeStyle = A().recording ? '#ff4b4b' : '#e8e8e8';
  g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  if (head) { g.fillStyle = g.strokeStyle; g.beginPath(); g.moveTo(x - 5, h - 8); g.lineTo(x + 5, h - 8); g.lineTo(x, h); g.fill(); }
}

function draw() {
  if (!ui || mode !== 'main' || !clip()) return;
  const w = ui.ruler.clientWidth;
  if (!w) return;
  if (fitted !== A().clip) { fitted = A().clip; zoom = (w - 2 * PAD) / len(); ox = PAD; }
  const rh = ui.ruler.clientHeight, eh = ui.events.clientHeight;
  let g = size(ui.ruler, w, rh);
  g.fillStyle = A().recording ? '#4a2626' : '#303030'; g.fillRect(0, 0, w, rh);
  shade(g, w, rh); grid(g, w, rh, true); playhead(g, rh, true);
  g = size(ui.events, w, eh);
  g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, w, eh);
  shade(g, w, eh); grid(g, w, eh, false);
  for (const e of clip().events ?? []) {
    const x = Math.round(X(e.t));
    g.fillStyle = selEv.has(e) ? '#4fa3ff' : '#d8d8d8';
    g.fillRect(x - 3, 3, 6, eh - 9); g.beginPath(); g.moveTo(x - 3, eh - 6); g.lineTo(x + 3, eh - 6); g.lineTo(x, eh - 2); g.fill();
  }
  playhead(g, eh);
  const h = ui.body.clientHeight, tw = ui.tl.clientWidth;
  ui.tl.style.height = h + 'px';
  view === 'curves' ? drawCurves(tw, h) : drawSheet(tw, h);
}

// ---------- dopesheet ----------
const timesOf = r => [...new Set(r.tracks.flatMap(tr => tr.keys.map(k => k.t)))];
const keysAtTime = (r, t) => r.tracks.flatMap(tr => tr.keys.filter(k => Math.abs(k.t - t) < 1e-6));
function drawSheet(w, h) {
  const g = size(ui.tl, w, h), top = ui.body.scrollTop;
  g.fillStyle = '#262626'; g.fillRect(0, 0, w, h);
  rows.forEach((r, i) => {
    const y = i * ROW - top;
    if (y < -ROW || y > h) return;
    g.fillStyle = rowSel.has(rowKey(r)) ? '#2c3e52' : r.type === 'summary' ? '#2e2e2e' : r.type === 'group' ? '#2b2b2b' : i % 2 ? '#262626' : '#292929';
    g.fillRect(0, y, w, ROW);
    g.fillStyle = '#1e1e1e'; g.fillRect(0, y + ROW - 1, w, 1);
  });
  shade(g, w, h); grid(g, w, h, false);
  rows.forEach((r, i) => {
    const y = i * ROW - top + ROW / 2;
    if (y < -ROW || y > h + ROW) return;
    for (const t of timesOf(r)) {
      const x = X(t);
      if (x < -8 || x > w + 8) continue;
      const ks = keysAtTime(r, t), on = ks.every(k => sel.has(k));
      diamond(g, x, y, r.type === 'track' ? 5 : 6, on ? '#4fa3ff' : r.type === 'track' ? '#cfcfcf' : r.type === 'group' ? '#9ab1cc' : '#7d93ad');
    }
  });
  if (drag?.box) {
    const [x0, y0, x1, y1] = drag.box;
    g.fillStyle = '#4fa3ff22'; g.strokeStyle = '#4fa3ff';
    g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  playhead(g, h);
}
const rowAt = y => rows[Math.floor((y + ui.body.scrollTop) / ROW)];
function hitKeys(r, x) {
  let best = null, bd = 7;
  for (const t of timesOf(r)) { const d = Math.abs(X(t) - x); if (d < bd) { bd = d; best = t; } }
  return best == null ? [] : keysAtTime(r, best);
}

// drag helper: pointer capture + move/up
function track(e, move, up) {
  const t = e.currentTarget;
  try { t.setPointerCapture(e.pointerId); } catch {}
  t.onpointermove = move;
  t.onpointerup = t.onpointercancel = u => { t.onpointermove = t.onpointerup = t.onpointercancel = null; up?.(u); };
}
function pan(e) {
  let lx = e.clientX;
  track(e, m => { ox += m.clientX - lx; lx = m.clientX; draw(); });
}
function wheel(e, zoomPlain) {
  const x = local(e, e.currentTarget).x;
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) ox -= e.shiftKey ? e.deltaY : e.deltaX;
  else if (zoomPlain || e.ctrlKey || e.altKey) { const t = T(x); zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0015), 4, 40000); ox = x - t * zoom; }
  else return;
  e.preventDefault();
  draw();
}
const sortAll = () => { for (const tr of clip().tracks) tr.keys.sort((a, b) => a.t - b.t); };

// move keys by a frame-snapped dt (live), commit one undo step on release
function dragKeys(e, x0, keys, vals) {
  const orig = keys.map(k => [k.t, k.v]), f = fps(), minT = Math.min(...orig.map(o => o[0]));
  let moved = false;
  track(e, m => {
    const p = local(m, ui.tl);
    const dt = Math.max(-minT, Math.round((T(p.x) - T(x0)) * f) / f);
    const dv = vals ? vals(p.y) : 0;
    keys.forEach((k, i) => { k.t = r6(orig[i][0] + dt); if (vals && typeof orig[i][1] === 'number') k.v = r6(orig[i][1] + dv); });
    moved = moved || dt !== 0 || dv !== 0;
    sortAll(); refresh();
  }, () => {
    if (!moved) return;
    const fin = keys.map(k => [k.t, k.v]);
    keys.forEach((k, i) => { [k.t, k.v] = orig[i]; });
    sortAll();
    editClip('Move Keys', () => {
      keys.forEach((k, i) => { [k.t, k.v] = fin[i]; });
      for (const tr of clip().tracks) dedupeKeys(tr, new Set(keys), f);
    });
  });
}

function tlDown(e) {
  if (e.button !== 0 || e.altKey) return;
  const { x, y } = local(e, ui.tl);
  if (view === 'curves') return curvesDown(e, x, y);
  const r = rowAt(y), hit = r ? hitKeys(r, x) : [];
  selEv.clear();
  if (hit.length) {
    const all = hit.every(k => sel.has(k));
    if (e.shiftKey || e.ctrlKey) { hit.forEach(k => (all ? sel.delete(k) : sel.add(k))); return refresh(); }
    if (!all) sel = new Set(hit);
    refresh();
    return dragKeys(e, x, [...sel]);
  }
  const before = e.shiftKey ? new Set(sel) : new Set();
  sel = new Set(before);
  drag = { box: [x, y, x, y] };
  track(e, m => {
    const p = local(m, ui.tl);
    drag.box = [x, y, p.x, p.y];
    const [t0, t1] = [T(Math.min(x, p.x)), T(Math.max(x, p.x))], top = ui.body.scrollTop;
    sel = new Set(before);
    rows.forEach((r, i) => {
      const cy = i * ROW + ROW / 2 - top;
      if (cy < Math.min(y, p.y) || cy > Math.max(y, p.y)) return;
      for (const tr of r.tracks) for (const k of tr.keys) if (k.t >= t0 && k.t <= t1) sel.add(k);
    });
    draw();
  }, () => { drag = null; refresh(); });
  refresh();
}
function tlDbl(e) {
  const { x, y } = local(e, ui.tl);
  if (view === 'curves') {
    const t = snap(T(x)), tr = nearestCurve(x, y);
    if (tr) addKeys([tr], t);
    return;
  }
  const r = rowAt(y);
  if (r && !hitKeys(r, x).length) addKeys(r.tracks, T(x));
}
function tlMenu(e) {
  e.preventDefault();
  const { x, y } = local(e, ui.tl);
  let hit = [];
  if (view === 'curves') { const k = curveHit(x, y); if (k?.key) hit = [k.key]; }
  else { const r = rowAt(y); hit = r ? hitKeys(r, x) : []; }
  if (hit.length && !hit.every(k => sel.has(k))) { sel = new Set(hit); refresh(); }
  if (sel.size) return easeMenu(e.clientX, e.clientY);
  const r = view === 'dope' && rowAt(y);
  menu([{ label: 'Add Key', disabled: !r, action: () => addKeys(r.tracks, T(x)) }, { label: 'Paste at Playhead', disabled: !clipboard, action: paste }], e.clientX, e.clientY);
}

// ---------- ruler / events ----------
function rulerDown(e) {
  if (e.button !== 0 || e.altKey) return;
  preview = true;
  const go = m => setTime(snap(T(local(m, ui.ruler).x)));
  go(e);
  track(e, go);
}
const hitEvent = x => { let best = null, bd = 6; for (const ev of clip()?.events ?? []) { const d = Math.abs(X(ev.t) - x); if (d < bd) { bd = d; best = ev; } } return best; };
function eventsDown(e) {
  if (e.button !== 0 || e.altKey) return;
  const x0 = local(e, ui.events).x, ev = hitEvent(x0);
  sel.clear();
  if (!ev) { if (!e.shiftKey) selEv.clear(); return refresh(); }
  if (e.shiftKey) { selEv.has(ev) ? selEv.delete(ev) : selEv.add(ev); return refresh(); }
  if (!selEv.has(ev)) selEv = new Set([ev]);
  refresh();
  const evs = [...selEv], orig = evs.map(v => v.t), f = fps(), minT = Math.min(...orig);
  let dt = 0;
  track(e, m => {
    dt = Math.max(-minT, Math.round((T(local(m, ui.events).x) - T(x0)) * f) / f);
    evs.forEach((v, i) => { v.t = r6(orig[i] + dt); });
    draw();
  }, () => {
    if (!dt) return;
    const fin = evs.map(v => v.t);
    evs.forEach((v, i) => { v.t = orig[i]; });
    editClip('Move Event', () => { evs.forEach((v, i) => { v.t = fin[i]; }); clip().events.sort((a, b) => a.t - b.t); });
  });
}
function callables(target) {
  const out = ['setActive', 'navigate', 'scrollTo', 'Animator.play', 'Animator.stop', 'Animator.pause', 'Media.play', 'Media.pause', 'Media.toggle'];
  for (const c of target?.components ?? []) if (c.type.startsWith('behaviour:')) for (const m of S.S.behaviourMeta?.[c.type.slice(10)]?.methods ?? []) out.push(`${c.type}.${m}`);
  return out;
}
function editEvent(ev, at) {
  const an = animator(), paths = [];
  const walkP = (n, p) => { if (p) paths.push(p); for (const c of n.children ?? []) walkP(c, p ? `${p}/${c.name}` : c.name); };
  walkP(an, '');
  popover(at, `Event at ${fmt(ev.t)}`, [
    { label: 'Function', value: ev.call ?? '', list: callables(nodeOf(ev.target ?? '') ?? an) },
    { label: 'Argument', value: ev.arg ?? '' },
    { label: 'Target', value: ev.target ?? '', list: paths },
  ], ([call, arg, target]) => editClip('Edit Event', () => {
    Object.assign(ev, { call: call.trim(), arg });
    target.trim() ? (ev.target = target.trim()) : delete ev.target;
  }));
}
function addEvent(t, at) {
  const ev = { t: snap(t), call: '', arg: '' };
  editClip('Add Event', () => { const c = clip(); (c.events ??= []).push(ev); c.events.sort((a, b) => a.t - b.t); });
  const live = clip().events.find(x => x.t === ev.t && x.call === '');
  selEv = new Set([live]); sel.clear(); refresh();
  editEvent(live, at);
}
function eventsDbl(e) {
  const x = local(e, ui.events).x, ev = hitEvent(x);
  ev ? editEvent(ev, e) : addEvent(T(x), e);
}
function eventsMenu(e) {
  e.preventDefault();
  const x = local(e, ui.events).x, ev = hitEvent(x);
  if (ev && !selEv.has(ev)) { selEv = new Set([ev]); refresh(); }
  menu(ev
    ? [{ label: 'Edit Event…', action: () => editEvent(ev, e) }, { label: 'Delete Event', action: () => editClip('Delete Event', () => { clip().events = clip().events.filter(v => !selEv.has(v)); }) }]
    : [{ label: 'Add Animation Event', action: () => addEvent(T(x), e) }], e.clientX, e.clientY);
}

// ---------- curves ----------
function color(tr) {
  const ax = tr.prop.split('.').pop();
  if (/\.[xyzw]$/.test(tr.prop)) return AXIS_COLOR[ax];
  let h = 0; for (const c of tid(tr)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 60% 62%)`;
}
const curveTracks = () => rowTracks().filter(tr => tr.keys.length && isNum(tr));
let vr = [0, 1];
function fitRange(trs) {
  let lo = Infinity, hi = -Infinity;
  const L = Math.max(len(), ...trs.flatMap(tr => tr.keys.map(k => k.t)));
  for (const tr of trs) {
    for (const k of tr.keys) { lo = Math.min(lo, k.v); hi = Math.max(hi, k.v); }
    for (let i = 0; i <= 80; i++) { const v = evalTrack(tr, (i / 80) * L); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const p = (hi - lo) * 0.12;
  return [lo - p, hi + p];
}
const CM = 12;
const Y = v => CM + (vr[1] - v) / (vr[1] - vr[0]) * (ui.tl.clientHeight - 2 * CM);
const V = y => vr[1] - (y - CM) / (ui.tl.clientHeight - 2 * CM) * (vr[1] - vr[0]);
// tangent handles of the segments next to selected keys: { tr, a (segment start key), which: 1|2, x, y }
function handles(trs) {
  const out = [];
  for (const tr of trs) tr.keys.forEach((a, i) => {
    const b = tr.keys[i + 1];
    if (!b || a.ease === 'step' || !(sel.has(a) || sel.has(b))) return;
    const [x1, y1, x2, y2] = bezierOf(a.ease), dt = b.t - a.t, dv = (b.v - a.v) || (vr[1] - vr[0]) * 0.25;
    out.push({ tr, a, b, which: 1, px: X(a.t + x1 * dt), py: Y(a.v + y1 * dv), ox: X(a.t), oy: Y(a.v), dt, dv });
    out.push({ tr, a, b, which: 2, px: X(a.t + x2 * dt), py: Y(a.v + y2 * dv), ox: X(b.t), oy: Y(b.v), dt, dv });
  });
  return out;
}
function curveHit(x, y) {
  const trs = curveTracks();
  for (const h of handles(trs)) if (Math.hypot(h.px - x, h.py - y) < 6) return { handle: h };
  for (const tr of trs) for (const k of tr.keys) if (Math.hypot(X(k.t) - x, Y(k.v) - y) < 6) return { key: k, tr };
  return null;
}
function nearestCurve(x, y) {
  let best = null, bd = 10;
  for (const tr of curveTracks()) { const d = Math.abs(Y(evalTrack(tr, T(x))) - y); if (d < bd) { bd = d; best = tr; } }
  return best;
}
function drawCurves(w, h) {
  const g = size(ui.tl, w, h), trs = curveTracks();
  if (!drag?.freeze) vr = fitRange(trs);
  g.fillStyle = '#242424'; g.fillRect(0, 0, w, h);
  shade(g, w, h); grid(g, w, h, false);
  // value grid
  const span = vr[1] - vr[0], stepV = 10 ** Math.floor(Math.log10(span / 4)) * ([1, 2, 5].find(m => span / (10 ** Math.floor(Math.log10(span / 4)) * m) <= 8) ?? 10);
  g.fillStyle = '#888';
  for (let v = Math.ceil(vr[0] / stepV) * stepV; v <= vr[1]; v += stepV) {
    const y = Math.round(Y(v)) + 0.5;
    g.strokeStyle = Math.abs(v) < stepV / 2 ? '#ffffff30' : '#ffffff10';
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    g.fillText(String(r6(+v.toFixed(6))), 3, y - 2);
  }
  if (!trs.length) { g.fillStyle = '#888'; g.fillText('No numeric properties selected', 12, 24); }
  for (const tr of trs) {
    g.strokeStyle = color(tr); g.lineWidth = 1.5; g.beginPath();
    for (let x = 0; x <= w; x += 2) { const y = Y(evalTrack(tr, T(x))); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.lineWidth = 1;
    for (const k of tr.keys) diamond(g, X(k.t), Y(k.v), sel.has(k) ? 5 : 4, sel.has(k) ? '#ffffff' : color(tr));
  }
  for (const hd of handles(trs)) {
    g.strokeStyle = '#bbbbbb'; g.beginPath(); g.moveTo(hd.ox, hd.oy); g.lineTo(hd.px, hd.py); g.stroke();
    g.fillStyle = '#e0e0e0'; g.beginPath(); g.arc(hd.px, hd.py, 3.5, 0, 7); g.fill();
  }
  if (drag?.box) { const [x0, y0, x1, y1] = drag.box; g.strokeStyle = '#4fa3ff'; g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0)); }
  playhead(g, h);
}
function curvesDown(e, x, y) {
  const hit = curveHit(x, y);
  selEv.clear();
  if (hit?.handle) {
    const hd = hit.handle, orig = structuredClone(hd.a.ease);
    drag = { freeze: true };
    track(e, m => {
      const p = local(m, ui.tl), b = [...bezierOf(hd.a.ease)];
      const nx = clamp((T(p.x) - hd.a.t) / hd.dt, 0, 1), ny = (V(p.y) - hd.a.v) / hd.dv;
      if (hd.which === 1) [b[0], b[1]] = [nx, ny]; else [b[2], b[3]] = [nx, ny];
      hd.a.ease = b.map(n => Math.round(n * 1000) / 1000);
      refresh();
    }, () => {
      drag = null;
      const fin = hd.a.ease;
      orig === undefined ? delete hd.a.ease : (hd.a.ease = orig);
      if (JSON.stringify(fin) !== JSON.stringify(orig)) editClip('Edit Tangent', () => { hd.a.ease = fin; });
      else refresh();
    });
    return;
  }
  if (hit?.key) {
    if (e.shiftKey || e.ctrlKey) { sel.has(hit.key) ? sel.delete(hit.key) : sel.add(hit.key); return refresh(); }
    if (!sel.has(hit.key)) sel = new Set([hit.key]);
    const shown = new Set(curveTracks().flatMap(tr => tr.keys));
    drag = { freeze: true };
    const v0 = V(y);
    refresh();
    dragKeys(e, x, [...sel].filter(k => shown.has(k)), py => V(py) - v0);
    const up = ui.tl.onpointerup;
    ui.tl.onpointerup = ui.tl.onpointercancel = u => { drag = null; up(u); refresh(); };
    return;
  }
  const before = e.shiftKey ? new Set(sel) : new Set();
  sel = new Set(before);
  drag = { box: [x, y, x, y], freeze: true };
  track(e, m => {
    const p = local(m, ui.tl);
    drag.box = [x, y, p.x, p.y];
    sel = new Set(before);
    for (const tr of curveTracks()) for (const k of tr.keys) {
      const kx = X(k.t), ky = Y(k.v);
      if (kx >= Math.min(x, p.x) && kx <= Math.max(x, p.x) && ky >= Math.min(y, p.y) && ky <= Math.max(y, p.y)) sel.add(k);
    }
    draw();
  }, () => { drag = null; refresh(); });
  refresh();
}

// ---------- local keys (only while focus is inside the window) ----------
function onKey(e) {
  if (mode !== 'main' || e.target.closest?.('input, select, textarea, .an-pop')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  let done = true;
  if (k === 'delete' || k === 'backspace') deleteSel();
  else if (mod && k === 'c') copySel();
  else if (mod && k === 'v') paste();
  else if (mod && k === 'a') { sel = new Set(allKeys().map(([x]) => x)); refresh(); }
  else if (!mod && e.code === 'Space') play();
  else if (!mod && e.code === 'Comma') { preview = true; e.altKey ? jumpKey(-1) : stepFrame(-1); }
  else if (!mod && e.code === 'Period') { preview = true; e.altKey ? jumpKey(1) : stepFrame(1); }
  else if (!mod && k === 'k') addKeys(rowTracks(), A().time);
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
}
