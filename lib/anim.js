// Keyframe animation maths (isomorphic): easing, interpolation, clip sampling, key editing helpers.
// Clip format: see CONTRACT.md "Animation".
import { nodeAtPath, getProp, setProp, componentPath } from './node.js';
import { componentDef, withDefaults } from './components.js';
import { defaultRect } from './rect.js';

export const AXES = ['x', 'y', 'z', 'w'];
const r6 = n => Math.round(n * 1e6) / 1e6;

// ---------- easing ----------
export const EASES = { linear: [0, 0, 1, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };

const bz = (a, b, s) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
const dbz = (a, b, s) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;

// CSS cubic-bezier(x1,y1,x2,y2) at progress x: solve x(s) = x (Newton, bisection fallback), return y(s)
export function cubicBezier(x1, y1, x2, y2, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  x1 = Math.min(1, Math.max(0, x1)); x2 = Math.min(1, Math.max(0, x2));
  let s = x;
  for (let i = 0; i < 8; i++) {
    const err = bz(x1, x2, s) - x;
    if (Math.abs(err) < 1e-7) return bz(y1, y2, s);
    const d = dbz(x1, x2, s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
    if (s < 0 || s > 1) break;
  }
  let lo = 0, hi = 1;
  s = x;
  for (let i = 0; i < 60; i++) {
    const v = bz(x1, x2, s);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return bz(y1, y2, s);
}

export function ease(e = 'linear', u) {
  if (e === 'step') return u >= 1 ? 1 : 0;
  const b = Array.isArray(e) ? e : e === 'linear' ? null : EASES[e];
  return b ? cubicBezier(...b, u) : u;
}

// ---------- interpolation ----------
const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const rgba = v => {
  const m = typeof v === 'string' && v.match(HEX);
  return m && [0, 2, 4, 6].map(i => (i < 6 ? parseInt(m[1].slice(i, i + 2), 16) : m[2] ? parseInt(m[2], 16) : 255));
};
const hex2 = n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

export function lerpValue(a, b, u) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((x, i) => lerpValue(x, b[i], u));
  const ca = rgba(a), cb = rgba(b);
  if (ca && cb) {
    const c = ca.map((x, i) => x + (cb[i] - x) * u);
    return '#' + c.slice(0, 3).map(hex2).join('') + (HEX.exec(a)[2] || HEX.exec(b)[2] ? hex2(c[3]) : '');
  }
  return u < 1 ? a : b; // strings, bools, enums, assets: step
}

// ---------- sampling ----------
export function evalTrack(track, t) {
  const k = track.keys;
  if (!k?.length) return undefined;
  let v;
  if (t <= k[0].t) v = k[0].v;
  else if (t >= k.at(-1).t) v = k.at(-1).v;
  else {
    const i = k.findIndex(x => x.t > t) - 1, a = k[i], b = k[i + 1];
    v = lerpValue(a.v, b.v, ease(a.ease, (t - a.t) / (b.t - a.t)));
  }
  return v && typeof v === 'object' ? structuredClone(v) : v;
}

export const sampleClip = (clip, t) =>
  (clip?.tracks ?? []).filter(tr => tr.keys?.length).map(tr => ({ path: tr.path, prop: tr.prop, value: evalTrack(tr, t) }));

export function clipLength(clip) {
  if (clip?.length > 0) return clip.length;
  return Math.max(0, ...(clip?.tracks ?? []).flatMap(tr => tr.keys.map(k => k.t)), ...(clip?.events ?? []).map(e => e.t));
}

// Advance playback from t0 by dt (> 0): -> { time, events crossed (t0 < e.t <= time, across loop wraps), ended }.
// Pass t0 < 0 when starting so events at 0 fire.
export function advance(clip, t0, dt) {
  const len = clipLength(clip), ev = clip.events ?? [];
  const hit = (a, b) => ev.filter(e => e.t > a && e.t <= b);
  const t = Math.max(t0, 0) + dt;
  if (t < len) return { time: t, events: hit(t0, t), ended: false };
  if (!clip.loop || len <= 0) return { time: len, events: hit(t0, len), ended: true };
  const time = t % len;
  return { time, events: [...hit(t0, len), ...hit(-1, time)], ended: false };
}

export const snapTime = (t, fps = 60) => r6(Math.round(t * fps) / fps);

// ---------- nodes ----------
// Node clone (children shared, not cloned) with component props defaults-filled.
export const fillNode = (n, { customs = {}, behaviours = {} } = {}) => ({
  ...n, rect: structuredClone(n.rect ?? defaultRect()),
  components: (n.components ?? []).map(c => ({ ...c, props: withDefaults(componentDef(c.type, customs, behaviours), structuredClone(c.props ?? {})) })),
});
export const baseValue = (node, prop, meta) => getProp(fillNode(node, meta), prop);

// Editor preview: clones of every node the clip touches, with sampled values set. Map<id, clone>
export function applyClip(animNode, clip, t, meta) {
  const out = new Map();
  for (const { path, prop, value } of sampleClip(clip, t)) {
    const n = nodeAtPath(animNode, path);
    if (!n) continue;
    if (!out.has(n.id)) out.set(n.id, fillNode(n, meta));
    setProp(out.get(n.id), prop, value);
  }
  return out;
}

// Everything animatable in the Animator's subtree, generated from the schemas.
// -> [{ path, id, comp, prop, group, type, options, kind: 'float'|'color'|'step', label }]
// vec2/vec4 expand to per-axis float tracks; ints, strings, bools, enums, assets step; event/list are not animatable.
export function animatableProps(animNode, { customs = {}, behaviours = {} } = {}) {
  const out = [], seen = new Set();
  const visit = (n, path) => {
    const add = (comp, prop, s) => {
      if (s.type === 'event' || s.type === 'list' || seen.has(prop)) return;
      seen.add(prop);
      const vec = { vec2: 2, vec4: 4 }[s.type];
      if (vec) for (let i = 0; i < vec; i++) out.push({ path, id: n.id, comp, prop: `${prop}.${AXES[i]}`, group: prop, type: 'number', kind: 'float', label: s.labels?.[i] ?? AXES[i].toUpperCase() });
      else out.push({ path, id: n.id, comp, prop, group: prop, type: s.type, options: s.options, kind: s.type === 'number' ? 'float' : s.type === 'color' ? 'color' : 'step', label: prop.split('.').pop() });
    };
    seen.clear();
    add('GameObject', 'active', { type: 'bool' });
    for (const [k, v] of Object.entries(defaultRect())) add('Rect Transform', `rect.${k}`, { type: Array.isArray(v) ? 'vec2' : 'number' });
    for (const [i, c] of (n.components ?? []).entries()) {
      if (c.type === 'Animator' || c.type === 'Repeat') continue; // read once at boot / build time: not animatable
      const cp = componentPath(n, i);
      for (const [k, s] of Object.entries(componentDef(c.type, customs, behaviours)?.props ?? {})) add(c.type, `${cp}.${k}`, s);
    }
    for (const c of n.children ?? []) visit(c, path ? `${path}/${c.name}` : c.name);
  };
  visit(animNode, '');
  return out;
}

// ---------- key editing ----------
export const findTrack = (clip, path, prop) => clip.tracks.find(x => x.path === path && x.prop === prop);

// Insert or overwrite a key (keys within half a frame are the same key). Returns the key.
export function setKey(clip, path, prop, t, v, ease) {
  let tr = findTrack(clip, path, prop);
  if (!tr) clip.tracks.push(tr = { path, prop, keys: [] });
  t = r6(Math.max(0, t));
  let k = tr.keys.find(x => Math.abs(x.t - t) < 0.5 / (clip.fps || 60));
  if (k) k.v = v;
  else { tr.keys.push(k = { t, v }); tr.keys.sort((a, b) => a.t - b.t); }
  if (ease !== undefined) k.ease = ease;
  return k;
}

// After moving keys: sort, and drop other keys sharing a frame with a kept (moved) key.
export function dedupeKeys(track, keep = new Set(), fps = 60) {
  const eps = 0.5 / fps;
  track.keys = track.keys.filter(k => keep.has(k) || !track.keys.some(o => o !== k && keep.has(o) && Math.abs(o.t - k.t) < eps));
  track.keys.sort((a, b) => a.t - b.t);
  for (let i = track.keys.length - 1; i > 0; i--) if (Math.abs(track.keys[i].t - track.keys[i - 1].t) < eps) track.keys.splice(i - 1, 1);
}

export const newClip = name => ({ name, length: 1, loop: true, fps: 60, tracks: [], events: [] });
