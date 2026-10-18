// Unity-style scripting API (published as gpsb/engine.js). Docs: docs/engine-api.md, types: lib/engine.d.ts.
// A thin layer over the plain module contract (CONTRACT.md): a Behaviour subclass is still `export default class` with
// `static props`, and defineExtension(Class) returns an ordinary extension definition. Isomorphic: browser-only code
// runs inside methods, never at import time, so extensions can import this file in Node (build) too.
//
//   import { Behaviour, prop, Time } from '../gpsb/engine.js';
//   export default class Spin extends Behaviour {
//     static props = { speed: prop.number(90) };
//     update() { this.rectTransform.rotation += this.speed * Time.deltaTime; }   // applied automatically
//   }
import { Time, onFrame, markDirty } from './frame.js';
import { nodeAtPath, getComponent } from './node.js';
import { componentDef, withDefaults, esc, near } from './components.js';
import { Tween, Sequence, Ease, tween, sequence, delayedCall } from './tween.js';

export { Time, markDirty, Tween, Sequence, Ease, tween, sequence, delayedCall };
const G = () => globalThis.GPSB;

// ---------- value types ----------
const num = v => (typeof v === 'number' ? v : Number(v) || 0);

// Immutable 2D vector. The y axis points down (as on the web), so Vector2.up is (0, -1).
export class Vector2 {
  constructor(x = 0, y = 0) { this.x = num(x); this.y = num(y); Object.freeze(this); }
  static from(v) { return v instanceof Vector2 ? v : Array.isArray(v) ? new Vector2(v[0], v[1]) : v && typeof v === 'object' ? new Vector2(v.x, v.y) : new Vector2(v, v); }
  add(v) { v = Vector2.from(v); return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v) { v = Vector2.from(v); return new Vector2(this.x - v.x, this.y - v.y); }
  mul(k) { const v = Vector2.from(k); return new Vector2(this.x * v.x, this.y * v.y); } // scalar or per axis
  div(k) { const v = Vector2.from(k); return new Vector2(this.x / v.x, this.y / v.y); }
  neg() { return new Vector2(-this.x, -this.y); }
  withX(x) { return new Vector2(x, this.y); }
  withY(y) { return new Vector2(this.x, y); }
  dot(v) { v = Vector2.from(v); return this.x * v.x + this.y * v.y; }
  get magnitude() { return Math.hypot(this.x, this.y); }
  get sqrMagnitude() { return this.x * this.x + this.y * this.y; }
  get normalized() { const m = this.magnitude; return m > 1e-9 ? this.div(m) : Vector2.zero; }
  equals(v, eps = 1e-6) { v = Vector2.from(v); return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps; }
  toArray() { return [this.x, this.y]; }
  toJSON() { return this.toArray(); }
  toString() { return `(${this.x}, ${this.y})`; }
  static distance(a, b) { return Vector2.from(a).sub(b).magnitude; }
  static lerpUnclamped(a, b, t) { a = Vector2.from(a); b = Vector2.from(b); return new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
  static lerp(a, b, t) { return Vector2.lerpUnclamped(a, b, Mathf.clamp01(t)); }
  static moveTowards(a, b, maxDelta) {
    a = Vector2.from(a); const d = Vector2.from(b).sub(a), m = d.magnitude;
    return m <= maxDelta || m === 0 ? Vector2.from(b) : a.add(d.div(m).mul(maxDelta));
  }
  // degrees, clockwise on screen (y down)
  static angle(a, b) { a = Vector2.from(a); b = Vector2.from(b); const m = a.magnitude * b.magnitude; return m ? Math.acos(Mathf.clamp(a.dot(b) / m, -1, 1)) * Mathf.Rad2Deg : 0; }
}
for (const [k, v] of Object.entries({ zero: [0, 0], one: [1, 1], up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }))
  Object.defineProperty(Vector2, k, { value: new Vector2(...v) });

export class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 0) { this.x = num(x); this.y = num(y); this.z = num(z); this.w = num(w); Object.freeze(this); }
  static from(v) { return v instanceof Vector4 ? v : Array.isArray(v) ? new Vector4(...v) : v && typeof v === 'object' ? new Vector4(v.x, v.y, v.z, v.w) : new Vector4(v, v, v, v); }
  add(v) { v = Vector4.from(v); return new Vector4(this.x + v.x, this.y + v.y, this.z + v.z, this.w + v.w); }
  sub(v) { v = Vector4.from(v); return new Vector4(this.x - v.x, this.y - v.y, this.z - v.z, this.w - v.w); }
  mul(k) { const v = Vector4.from(k); return new Vector4(this.x * v.x, this.y * v.y, this.z * v.z, this.w * v.w); }
  equals(v, eps = 1e-6) { v = Vector4.from(v); return ['x', 'y', 'z', 'w'].every(k => Math.abs(this[k] - v[k]) <= eps); }
  toArray() { return [this.x, this.y, this.z, this.w]; }
  toJSON() { return this.toArray(); }
  toString() { return `(${this.toArray().join(', ')})`; }
  static lerpUnclamped(a, b, t) { a = Vector4.from(a); b = Vector4.from(b); return a.add(b.sub(a).mul(t)); }
  static lerp(a, b, t) { return Vector4.lerpUnclamped(a, b, Mathf.clamp01(t)); }
}
Object.defineProperty(Vector4, 'zero', { value: new Vector4() });
Object.defineProperty(Vector4, 'one', { value: new Vector4(1, 1, 1, 1) });

// Immutable RGBA colour, channels 0..1. Colour props hold '#rrggbb(aa)' strings; a value that isn't a hex colour
// (a design token '$brand', or 'var(--…)' in an extension) is kept as-is in `css` and has NaN channels.
export class Color {
  constructor(r = 0, g = 0, b = 0, a = 1, css = null) { Object.assign(this, { r, g, b, a, css }); Object.freeze(this); }
  static parse(v) {
    if (v instanceof Color) return v;
    if (v == null || v === '') return null;
    const s = String(v).trim(), m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (!m) return new Color(NaN, NaN, NaN, NaN, s);
    const h = m[1].length <= 4 ? [...m[1]].map(c => c + c).join('') : m[1];
    const n = i => parseInt(h.slice(i, i + 2), 16) / 255;
    return new Color(n(0), n(2), n(4), h.length === 8 ? n(6) : 1);
  }
  static hex(s) { return Color.parse(s); }
  static rgba(r, g, b, a = 1) { return new Color(r, g, b, a); }
  static rgb255(r, g, b, a = 255) { return new Color(r / 255, g / 255, b / 255, a / 255); }
  static token(name) { return new Color(NaN, NaN, NaN, NaN, '$' + name); }
  get valid() { return !Number.isNaN(this.r); }
  withAlpha(a) { return this.valid ? new Color(this.r, this.g, this.b, a) : this; }
  toHex() {
    if (!this.valid) return this.css;
    const x = v => Math.round(Mathf.clamp01(v) * 255).toString(16).padStart(2, '0');
    return '#' + x(this.r) + x(this.g) + x(this.b) + (this.a < 1 ? x(this.a) : '');
  }
  toJSON() { return this.toHex(); }
  toString() { return this.toHex(); }
  static lerpUnclamped(a, b, t) {
    a = Color.parse(a); b = Color.parse(b);
    if (!a?.valid || !b?.valid) return t < 1 ? a : b; // tokens: step
    return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
  }
  static lerp(a, b, t) { return Color.lerpUnclamped(a, b, Mathf.clamp01(t)); }
}
for (const [k, v] of Object.entries({ white: [1, 1, 1], black: [0, 0, 0], clear: [0, 0, 0, 0], red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], yellow: [1, 0.92, 0.016], cyan: [0, 1, 1], magenta: [1, 0, 1], gray: [0.5, 0.5, 0.5] }))
  Object.defineProperty(Color, k, { value: new Color(...v) });

export const Mathf = {
  PI: Math.PI, Deg2Rad: Math.PI / 180, Rad2Deg: 180 / Math.PI, Epsilon: Number.EPSILON, Infinity,
  clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
  clamp01: v => Math.min(1, Math.max(0, v)),
  lerp: (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t)),
  lerpUnclamped: (a, b, t) => a + (b - a) * t,
  inverseLerp: (a, b, v) => (a === b ? 0 : Mathf.clamp01((v - a) / (b - a))),
  repeat: (t, len) => Mathf.clamp(t - Math.floor(t / len) * len, 0, len),
  pingPong: (t, len) => len - Math.abs(Mathf.repeat(t, len * 2) - len),
  deltaAngle: (a, b) => { let d = Mathf.repeat(b - a, 360); if (d > 180) d -= 360; return d; },
  lerpAngle: (a, b, t) => a + Mathf.deltaAngle(a, b) * Mathf.clamp01(t),
  moveTowards: (a, b, maxDelta) => (Math.abs(b - a) <= maxDelta ? b : a + Math.sign(b - a) * maxDelta),
  moveTowardsAngle: (a, b, maxDelta) => { const d = Mathf.deltaAngle(a, b); return -maxDelta < d && d < maxDelta ? b : Mathf.moveTowards(a, a + d, maxDelta); },
  smoothStep: (a, b, t) => { t = Mathf.clamp01(t); t = t * t * (3 - 2 * t); return a + (b - a) * t; },
  // critically damped spring (Unity's SmoothDamp); state = { velocity } persists between calls
  smoothDamp(current, target, state, smoothTime, maxSpeed = Infinity, dt = Time.deltaTime) {
    smoothTime = Math.max(0.0001, smoothTime);
    const o = 2 / smoothTime, x = o * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const maxChange = maxSpeed * smoothTime, change = Mathf.clamp(current - target, -maxChange, maxChange), to = current - change;
    const temp = ((state.velocity ?? 0) + o * change) * dt;
    state.velocity = ((state.velocity ?? 0) - o * temp) * e;
    let out = to + (change + temp) * e;
    if (target - current > 0 === out > target) { out = target; state.velocity = (out - target) / (dt || 1); }
    return out;
  },
  approximately: (a, b) => Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), Number.EPSILON * 8),
};

export const Random = {
  get value() { return Math.random(); },
  range: (min, max) => min + Math.random() * (max - min),
  int: (min, max) => Math.floor(min + Math.random() * (max - min)), // max exclusive, like Unity's int Range
  pick: list => list[Math.floor(Math.random() * list.length)],
  get insideUnitCircle() { const a = Math.random() * 2 * Math.PI, r = Math.sqrt(Math.random()); return new Vector2(Math.cos(a) * r, Math.sin(a) * r); },
  get onUnitCircle() { const a = Math.random() * 2 * Math.PI; return new Vector2(Math.cos(a), Math.sin(a)); },
};

// project assets (paths inside assets/), as on GPSB.assets
export const Assets = {
  url: p => G().assets.url(p),
  json: p => G().assets.json(p),
  text: p => G().assets.text(p),
};

// ---------- props ----------
// Schema builders: prop.number(90, { min: 0, help: '…' }) -> { type: 'number', default: 90, min: 0, help: '…' }
const P = (type, d) => (dflt = d, opts = {}) => ({ type, default: dflt, ...opts });
export const prop = {
  number: P('number', 0), int: P('int', 0), string: P('string', ''), text: P('text', ''), bool: P('bool', false), href: P('href', ''),
  code: (dflt = '', lang = 'js', opts = {}) => ({ type: 'code', lang, default: dflt, ...opts }),
  color: (dflt = '#ffffff', opts = {}) => ({ type: 'color', default: String(dflt), ...opts }),
  vec2: (dflt = [0, 0], opts = {}) => ({ type: 'vec2', default: Vector2.from(dflt).toArray(), ...opts }),
  vec4: (dflt = [0, 0, 0, 0], opts = {}) => ({ type: 'vec4', default: Vector4.from(dflt).toArray(), ...opts }),
  enum: (options, dflt = options[0], opts = {}) => ({ type: 'enum', options, default: dflt, ...opts }),
  // kind: image | video | audio | json | font | text | anim | any
  asset: (kind = 'any', dflt = '', opts = {}) => ({ type: `asset:${kind}`, default: dflt, ...opts }),
  // opts.component: 'Text' -> the field holds that component of the picked object
  node: (opts = {}) => ({ type: 'node', default: '', ...opts }),
  event: (opts = {}) => ({ type: 'event', default: [], ...opts }),
  list: (of = 'string', dflt = [], opts = {}) => ({ type: 'list', of, default: dflt, ...opts }),
};

// raw prop value <-> script value: vec2 <-> Vector2, vec4 <-> Vector4, color <-> Color, node id <-> WebObject (or
// component), event entries <-> WebEvent. host: the element the script runs on (null at build time: node props stay ids).
const listeners = new WeakMap(); // props object -> { key: [fn] } (WebEvent.addListener)
function read(s, v, host, props, key) {
  switch (s.type) {
    case 'vec2': return Vector2.from(v ?? s.default);
    case 'vec4': return Vector4.from(v ?? s.default);
    case 'color': return Color.parse(v ?? s.default);
    case 'node': {
      if (!host?.el || !v) return host?.el ? null : v;
      const o = WebObject.of(v, host.el);
      return s.component && o ? o.getComponent(s.component) : o;
    }
    case 'event': {
      if (!host?.el) return v;
      let l = listeners.get(props);
      if (!l) listeners.set(props, (l = {}));
      return new WebEvent(() => props[key] ?? [], host.node?.id, (l[key] ??= []));
    }
    default: return v === undefined ? structuredClone(s.default) : v;
  }
}
function write(s, v) {
  if (v == null) return s.type === 'node' ? '' : v;
  if (s.type === 'node') return typeof v === 'string' ? v : (v.webObject ?? v).id ?? '';
  if (s.type === 'event') return v instanceof WebEvent ? v.entries : v;
  return typeof v === 'object' && typeof v.toJSON === 'function' ? v.toJSON() : v;
}
// define one accessor per schema prop on obj, reading and writing props() (the live props object)
const RESERVED = new Set(['el', 'node', 'props', 'GPSB', 'find', 'apply', 'setActive', 'animator', 'webObject', 'rectTransform', 'ci', 'ctx', 'type']);
function bindProps(obj, schema, props, host, changed) {
  for (const [k, s] of Object.entries(schema ?? {})) {
    if (RESERVED.has(k)) throw new Error(`prop "${k}" clashes with a built-in member; rename it`);
    Object.defineProperty(obj, k, {
      configurable: true, enumerable: true,
      get: () => read(s, props()[k], host, props(), k),
      set: v => { props()[k] = write(s, v); changed?.(); },
    });
  }
}

// An event list (an `event` prop): the entries page authors set up in the Inspector, plus listeners added in code.
export class WebEvent {
  constructor(entries, sourceId, fns = []) { this._entries = entries; this._src = sourceId; this._fns = fns; }
  get entries() { return this._entries(); }
  addListener(fn) { this._fns.push(fn); return this; }
  removeListener(fn) { const i = this._fns.indexOf(fn); if (i >= 0) this._fns.splice(i, 1); return this; }
  // run every entry (an entry with an empty argument receives `arg`) and every listener
  invoke(arg = '') {
    for (const e of [this.entries].flat()) if (e?.call) G()?.invoke(e.target, e.call, e.arg ? e.arg : String(arg ?? ''), this._src);
    for (const fn of [...this._fns]) try { fn(arg); } catch (err) { console.error('[event] listener:', err); }
  }
}

// ---------- objects ----------
const objects = new WeakMap(); // node -> Map(el|null -> WebObject)

// A node on the page (Unity's GameObject). `el` pins it to one element (a Repeat copy); null = every element of the node.
export class WebObject {
  constructor(node, el = null) { this.node = node; this.el = el; }
  // node data, node id or path -> WebObject; nearEl: resolve inside the same Repeat copy as that element
  static of(x, nearEl = null) {
    const g = G();
    let node = typeof x === 'string' ? g?.node(x) ?? g?.find(x) : x?.node && 'el' in x ? x.node : x;
    if (!node) return null;
    let el = typeof x === 'object' && x?.el ? x.el : null;
    if (!el && nearEl && g) { el = near(nearEl, node.id) ?? null; if (el) node = g.nodeFor(el); }
    let m = objects.get(node);
    if (!m) objects.set(node, (m = new Map()));
    if (!m.has(el)) m.set(el, new WebObject(node, el));
    return m.get(el);
  }
  // by path from the page root ('Header/Logo') or a unique name
  static find(path) { return WebObject.of(G()?.find(path)); }
  get id() { return this.node.id; }
  get name() { return this.node.name; }
  set name(v) { this.node.name = v; }
  get active() { return this.node.active !== false; }
  set active(v) { this.node.active = !!v; this.changed(); }
  setActive(on) { this.active = on === 'toggle' ? !this.active : on; }
  get elements() { return this.el ? [this.el] : G()?.els(this.id) ?? []; }
  get element() { return this.el ?? G()?.el(this.id) ?? null; }
  get parent() {
    const pel = this.el?.parentElement?.closest('[data-gpsb]');
    if (pel) return WebObject.of({ node: G().nodeFor(pel), el: pel });
    const p = G()?.parent(this.id);
    return p ? WebObject.of(p) : null;
  }
  get children() { return (this.node.children ?? []).map(c => this._inside(c)); }
  // a descendant by path of names ('Panel/Icon'), within the same Repeat copy
  find(path) {
    const n = nodeAtPath(this.node, path);
    return n && n !== this.node ? this._inside(n) : n ? this : null;
  }
  _inside(n) {
    const el = this.el?.querySelector(`[data-gpsb="${n.id}"]`);
    return el ? WebObject.of({ node: G().nodeFor(el), el }) : WebObject.of(n);
  }
  get rectTransform() { return (this._rt ??= new RectTransform(this)); }
  // getComponent('Text'), getComponent('Text', 1) for the second one, getComponent('behaviour:Spin') / (SpinClass)
  getComponent(type, index = 0) {
    if (typeof type === 'function') type = 'behaviour:' + (type.scriptName ?? type.name);
    if (type.startsWith('behaviour:')) return G()?.behaviour(this.id, type.slice(10)) ?? null;
    const c = (this.node.components ?? []).filter(x => x.type === type)[index];
    return c ? ComponentRef.of(this, c) : null;
  }
  getComponents(type) { return (this.node.components ?? []).filter(x => x.type === type).map(c => ComponentRef.of(this, c)); }
  // add a built-in or extension component with its defaults (e.g. a CanvasGroup to fade)
  addComponent(type, props = {}) {
    const c = { type, props: withDefaults(componentDef(type, G()?.ctx?.customs), props) };
    (this.node.components ??= []).push(c);
    this.changed();
    return ComponentRef.of(this, c);
  }
  // re-apply now (changes made through the API are applied automatically at the end of the frame)
  apply() { G()?.applyNode(this.node, undefined, this.el ?? undefined); }
  changed() { markDirty(this.node, this.el); }

  // ---- tween shortcuts (seconds; return the Tween) ----
  tween(path, to, duration) { return tween(this, path, to, duration); }
  moveTo(pos, duration) { return tween(this, 'rect.pos', Vector2.from(pos), duration); }
  moveBy(offset, duration) { return tween(this, 'rect.pos', Vector2.from(offset), duration).relative(); }
  rotateTo(deg, duration) { return tween(this, 'rect.rotation', deg, duration); }
  scaleTo(s, duration) { return tween(this, 'rect.scale', Vector2.from(s), duration); }
  sizeTo(size, duration) { return tween(this, 'rect.size', Vector2.from(size), duration); }
  // opacity through a CanvasGroup (added if the object has none)
  fadeTo(alpha, duration) {
    if (!getComponent(this.node, 'CanvasGroup')) this.addComponent('CanvasGroup');
    return tween(this, 'CanvasGroup.alpha', alpha, duration);
  }
  // Image colour, else Text colour
  colorTo(color, duration) {
    const type = getComponent(this.node, 'Image') ? 'Image' : 'Text';
    return tween(this, `${type}.color`, Color.parse(color), duration);
  }
  // shake the position or punch the scale; both settle back where they started
  shake(strength = 10, duration = 0.5, vibrato = 10) {
    const base = [...this.node.rect.pos], s = Vector2.from(strength);
    return Tween.value(0, 1, duration, u => {
      const k = 1 - u, a = u * vibrato * 2 * Math.PI;
      this.node.rect.pos = u >= 1 ? base : [base[0] + Math.sin(a * 1.3) * s.x * k, base[1] + Math.cos(a) * s.y * k];
      this.changed();
    }).ease('linear');
  }
  punchScale(amount = 0.2, duration = 0.4, vibrato = 6) {
    const base = [...this.node.rect.scale], p = Vector2.from(amount);
    return Tween.value(0, 1, duration, u => {
      const k = Math.sin(u * vibrato * Math.PI) * (1 - u);
      this.node.rect.scale = u >= 1 ? base : [base[0] + p.x * k, base[1] + p.y * k];
      this.changed();
    }).ease('linear');
  }
  killTweens(complete = false) { Tween.killOf(this, complete); }
}

// Unity's RectTransform over node.rect. Vectors are immutable: assign a new one (rt.anchoredPosition = v.add(...)).
const RECT = { anchoredPosition: 'pos', sizeDelta: 'size', anchorMin: 'anchorMin', anchorMax: 'anchorMax', pivot: 'pivot', localScale: 'scale' };
export class RectTransform {
  constructor(owner) { this.webObject = owner; }
  get _r() { return this.webObject.node.rect; }
  get rotation() { return this._r.rotation ?? 0; }
  set rotation(v) { this._r.rotation = v; this.webObject.changed(); }
  get zIndex() { return this._r.zIndex ?? 0; }
  set zIndex(v) { this._r.zIndex = v; this.webObject.changed(); }
  // the element's box on screen (CSS px)
  getBoundingClientRect() { return this.webObject.element?.getBoundingClientRect() ?? null; }
}
for (const [k, f] of Object.entries(RECT)) Object.defineProperty(RectTransform.prototype, k, {
  get() { return Vector2.from(this._r[f]); },
  set(v) { this._r[f] = Vector2.from(v).toArray(); this.webObject.changed(); },
});

// One component of an object, with its props as typed fields (text.text = 'Hi', image.color = Color.red).
const refs = new WeakMap();
export class ComponentRef {
  constructor(owner, comp) {
    this.webObject = owner;
    this.type = comp.type;
    this.data = comp;
    const g = G(), def = componentDef(comp.type, g?.ctx?.customs ?? {});
    bindProps(this, def?.props, () => (comp.props ??= {}), owner, () => owner.changed());
  }
  static of(owner, comp) {
    let m = refs.get(comp);
    if (!m) refs.set(comp, (m = new Map()));
    if (!m.has(owner)) m.set(owner, new ComponentRef(owner, comp));
    return m.get(owner);
  }
  get props() { return this.data.props; }
  tween(prop, to, duration) { return tween(this.webObject, `${this.type}.${prop}`, to, duration); }
}

// ---------- coroutines ----------
// yield inside a generator method: nothing (next frame), wait(s), waitUntil(fn), waitWhile(fn), a promise, a tween,
// or another coroutine. this.startCoroutine(function* () { yield wait(1); … }) or this.startCoroutine(this.blink()).
export const wait = seconds => ({ seconds });
export const waitRealtime = seconds => ({ seconds, unscaled: true });
export const waitUntil = fn => ({ until: fn });
export const waitWhile = fn => ({ until: () => !fn() });
export const nextFrame = null;

const running = new Set();
let stopCo = null;
export class Coroutine {
  constructor(it, owner) {
    Object.assign(this, { it, owner, wait: null, done: false });
    this._p = new Promise(r => (this._resolve = r));
    running.add(this);
    stopCo ??= onFrame(runCoroutines, 10);
    this._step(); // runs to the first yield right away, like Unity
  }
  stop() { if (!this.done) { this.done = true; running.delete(this); this._resolve(false); } }
  then(ok, err) { return this._p.then(ok, err); }
  _step() {
    let r;
    try { r = this.it.next(); } catch (e) { console.error('[coroutine]', e); return this.stop(); }
    if (r.done) { this.done = true; running.delete(this); return this._resolve(true); }
    const y = r.value;
    if (y == null) this.wait = null;
    else if (typeof y.then === 'function') { const w = (this.wait = { pending: true }); y.then(() => (w.pending = false), () => (w.pending = false)); }
    else if (typeof y.next === 'function') this.wait = { co: new Coroutine(y, this.owner) };
    else this.wait = { ...y };
  }
  _tick(dt, udt) {
    const w = this.wait;
    if (w?.pending || (w?.co && !w.co.done)) return;
    if (w?.until && !w.until()) return;
    if (w?.seconds != null && (w.seconds -= w.unscaled ? udt : dt) > 0) return;
    this._step();
  }
}
function runCoroutines(dt, udt) {
  for (const c of [...running]) if (!c.done) c._tick(dt, udt);
  if (!running.size) { stopCo(); stopCo = null; }
}

// ---------- behaviours ----------
// Base class for behaviours (Unity's MonoBehaviour). The runtime creates one instance per element and injects el, node,
// props, GPSB, find, apply, setActive and animator; `static props` become typed fields that read and write this.props
// (so the Inspector, breakpoints and the Animator see the same values). Hooks: start, update(dt), lateUpdate(dt),
// onClick(e); any other public method can be called from event lists.
export class Behaviour {
  constructor() {
    bindProps(this, this.constructor.props, () => (this.props ??= {}), this, null);
  }
  // called by the runtime once el, node and props are injected. A class field named like a prop (`speed = 1`, or
  // `speed: number` in TypeScript) replaces its accessor: put the accessor back (the Inspector's value wins) and warn.
  _gpsbReady() {
    const schema = this.constructor.props ?? {};
    for (const k of Object.keys(schema)) {
      if (!('value' in (Object.getOwnPropertyDescriptor(this, k) ?? {}))) continue;
      console.warn(`[behaviour ${this.constructor.name}] the field "${k}" hides the prop "${k}": remove it (TypeScript: write \`declare ${k}: …\`)`);
      delete this[k];
    }
    bindProps(this, schema, () => this.props, this, null);
  }
  get webObject() { return (this._wo ??= WebObject.of({ node: this.node, el: this.el })); }
  get rectTransform() { return this.webObject.rectTransform; }
  get name() { return this.node?.name; }
  getComponent(type, index) { return this.webObject.getComponent(type, index); }
  getComponents(type) { return this.webObject.getComponents(type); }
  findObject(path) { return this.webObject.find(path) ?? WebObject.find(path); }
  tween(path, to, duration) { return tween(this.webObject, path, to, duration); }
  startCoroutine(gen, ...args) { return new Coroutine(typeof gen === 'function' ? gen.apply(this, args) : gen, this); }
  stopCoroutine(c) { c?.stop(); }
  stopAllCoroutines() { for (const c of [...running]) if (c.owner === this) c.stop(); }
}

// ---------- extensions ----------
// HTML with escaping by default: html`<b>${name}</b>` escapes name; raw(s) and nested html`` pass through.
export class SafeHtml { constructor(s) { this.s = s; } toString() { return this.s; } toJSON() { return this.s; } }
export const raw = s => new SafeHtml(String(s ?? ''));
const part = v => (v == null || v === false ? '' : v instanceof SafeHtml ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));
export const html = (strings, ...vals) => new SafeHtml(strings[0] + vals.map((v, i) => part(v) + strings[i + 1]).join(''));

// Base class for class-form extension components; see defineExtension.
export class Extension {
  get webObject() { return this.el ? (this._wo ??= WebObject.of({ node: this.node, el: this.el })) : null; }
  apply() { this.webObject?.apply(); }
}

// class -> extension definition. Static: props, category, state, last. Methods (all optional) map to the hooks with
// the props as fields on `this`: tag(), style(ctx, node), attrs(ctx), inner(ctx), rules(sel, ctx, node),
// childStyle(child), head(ctx), patch(el, ctx), init(el) (this.el, this.node, this.ci, this.GPSB are set; writing a
// prop field re-applies the element). Build-time hooks run in Node: keep browser code in patch and init.
export function defineExtension(Cls) {
  const schema = Cls.props ?? {}, proto = Cls.prototype, has = m => typeof proto[m] === 'function';
  const view = (p, extra) => { const o = Object.create(proto); bindProps(o, schema, () => p, null, null); return Object.assign(o, extra); };
  const str = v => (v == null ? v : String(v));
  const def = { category: Cls.category ?? 'Extensions', props: schema };
  if (Cls.state) def.state = Cls.state;
  if (Cls.last) def.last = true;
  if (has('tag')) def.tag = p => view(p).tag();
  if (has('style')) def.style = (p, ctx, node) => view(p, { ctx, node }).style(ctx, node);
  if (has('attrs')) def.attrs = (p, ctx) => view(p, { ctx }).attrs(ctx);
  if (has('inner')) def.inner = (p, ctx) => str(view(p, { ctx }).inner(ctx)) ?? '';
  if (has('rules')) def.rules = (p, sel, ctx, node) => str(view(p, { ctx, node }).rules(sel, ctx, node)) ?? '';
  if (has('childStyle')) def.childStyle = (p, child) => view(p).childStyle(child);
  if (has('head')) def.head = (p, ctx) => { const r = view(p, { ctx }).head(ctx); return Array.isArray(r) ? r.map(String) : str(r); };
  if (has('patch')) def.patch = (el, p, ctx) => view(p, { el, ctx }).patch(el, ctx);
  if (has('init')) def.init = ({ el, GPSB, ci }) => {
    const node = GPSB.nodeFor(el), o = Object.create(proto);
    Object.assign(o, { el, node, ci, GPSB, ctx: GPSB.ctx });
    bindProps(o, schema, () => (node.components[ci].props ??= {}), o, () => markDirty(node, el));
    return o.init(el);
  };
  return def;
}
