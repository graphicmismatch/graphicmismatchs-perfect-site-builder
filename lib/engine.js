// Unity-style scripting API (published as gpsb/engine.js). Docs: docs/engine-api.md, types: lib/engine.d.ts.
// A thin layer over the plain module contract (CONTRACT.md): a Behaviour subclass is still `export default class` with
// `static props`, and defineExtension(Class) returns an ordinary extension definition. Isomorphic: browser-only code
// runs inside methods, never at import time, so extensions can import this file in Node (build) too.
//
//   import { Behaviour, prop, Time } from '../gpsb/engine.js';
//   export default class Spin extends Behaviour {
//     static props = { speed: prop.number(90) };
//     update() { this.rectTransform.rotation += this.speed * Time.deltaTime; }   // applied automatically
//     spin() { this.tween('rect.rotation', 360, 1).ease('outBack'); }               // tweens are part of the API
//   }
import { Time, onFrame, markDirty } from './frame.js';
import { nodeAtPath, getComponent, getProp, setProp } from './node.js';
import { componentDef, withDefaults, esc, near } from './components.js';
import { cubicBezier, EASES, lerpValue } from './anim.js';

export { Time, markDirty };
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
  // a file inside an installed npm package, e.g. Assets.packageUrl('leaflet/dist/leaflet.css')
  packageUrl: p => G().ctx.package(p),
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

// ---------- tweening ----------
// tween(target, 'rect.rotation', 360, 1) animates a node / WebObject property path, an object field or (Tween.value) a
// setter. Chainable (.ease().delay().loops().onComplete()), auto-plays, awaitable (true = completed, false = killed),
// driven by the frame loop (order 20). Docs: docs/engine-api.md#tweening.

// easing
const { PI, sin, cos, sqrt } = Math;
const outBounce = t => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
const C1 = 1.70158, C3 = C1 + 1, C4 = (2 * PI) / 3;
const IN = {
  Sine: t => 1 - cos((t * PI) / 2), Quad: t => t * t, Cubic: t => t ** 3, Quart: t => t ** 4, Quint: t => t ** 5,
  Expo: t => (t === 0 ? 0 : 2 ** (10 * t - 10)), Circ: t => 1 - sqrt(1 - t * t), Back: t => C3 * t ** 3 - C1 * t * t,
  Elastic: t => (t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * sin((t * 10 - 10.75) * C4)), Bounce: t => 1 - outBounce(1 - t),
};
// Ease.linear, Ease.inQuad / outQuad / inOutQuad, … for Sine Quad Cubic Quart Quint Expo Circ Back Elastic Bounce
export const Ease = { linear: t => t };
for (const [n, f] of Object.entries(IN)) {
  Ease['in' + n] = f;
  Ease['out' + n] = t => 1 - f(1 - t);
  Ease['inOut' + n] = t => (t < 0.5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2);
}
// a name above, a CSS name ('ease-in-out'), a cubic-bezier [x1, y1, x2, y2], or a function u -> eased u
export function easeFn(e = 'outQuad') {
  if (typeof e === 'function') return e;
  if (Array.isArray(e)) return u => cubicBezier(...e, u);
  if (Ease[e]) return Ease[e];
  if (e === 'ease') return u => cubicBezier(0.25, 0.1, 0.25, 1, u);
  if (EASES[e]) return u => cubicBezier(...EASES[e], u);
  if (e === 'step') return u => (u >= 1 ? 1 : 0);
  throw new Error(`unknown ease "${e}"`);
}

// tweened values
// engine value types (Vector2, Color) lerp themselves; everything else as keyframes do (numbers, arrays, #hex colours)
const lerpAny = (a, b, u) => (a?.constructor?.lerpUnclamped ? a.constructor.lerpUnclamped(a, b, u) : lerpValue(a, b, u));
const addValue = (a, b) => typeof a === 'number' ? a + b : Array.isArray(a) ? a.map((x, i) => addValue(x, b[i] ?? 0)) : a?.add ? a.add(b) : b;
const subValue = (a, b) => typeof a === 'number' ? a - b : Array.isArray(a) ? a.map((x, i) => subValue(x, b[i] ?? 0)) : a?.sub ? a.sub(b) : 0;
const scaleValue = (a, k) => typeof a === 'number' ? a * k : Array.isArray(a) ? a.map(x => scaleValue(x, k)) : a?.mul ? a.mul(k) : a;
const stored = v => (v && typeof v === 'object' && typeof v.toJSON === 'function' ? v.toJSON() : v); // Vector2 -> [x, y], Color -> '#hex'
const copyValue = v => (Array.isArray(v) ? v.map(copyValue) : v);

const isNode = t => t && typeof t === 'object' && 'rect' in t && Array.isArray(t.components);
const isWebObject = t => t && typeof t === 'object' && isNode(t.node) && 'el' in t;

// target + path -> { key, get, set, raw, done? } for one animated value
function channel(target, path) {
  if (typeof target === 'string') {
    const G = globalThis.GPSB, n = G?.node(target) ?? G?.find(target);
    if (!n) throw new Error(`tween: no object "${target}"`);
    target = n;
  }
  if (isNode(target) || isWebObject(target)) {
    const node = isNode(target) ? target : target.node, el = isWebObject(target) ? target.el : null;
    const ch = { key: node, raw: true, get: () => copyValue(getProp(node, path)), set: v => { setProp(node, path, v); markDirty(node, el); } };
    if (path === 'rect.pos' || path.startsWith('rect.pos.')) { // move with translate() while it plays (no relayout), as the Animator does
      ch.begin = () => { if (!node.rect._layoutPos) { node.rect._layoutPos = [...node.rect.pos]; ch.owns = true; } };
      ch.end = () => { if (ch.owns) { delete node.rect._layoutPos; ch.owns = false; markDirty(node, el); } };
    }
    return ch;
  }
  if (target && typeof target === 'object') {
    const keys = String(path).split('.');
    const parent = () => keys.slice(0, -1).reduce((o, k) => o?.[k], target);
    return { key: target, get: () => parent()?.[keys.at(-1)], set: v => { const o = parent(); if (o) o[keys.at(-1)] = v; } };
  }
  throw new Error('tween: target must be a node, WebObject, node id/path or object');
}

// playback
const advancing = new Set(); // advanced every frame
const alive = new Set();  // created and not yet completed or killed (Tween.of, killAll)
let stopTweens = null;
function stepTweens(dt, udt) {
  for (const t of [...advancing]) if (advancing.has(t)) t._advance(t._unscaled ? udt : dt);
  if (!advancing.size && stopTweens) { stopTweens(); stopTweens = null; }
}
const startTween = t => { advancing.add(t); stopTweens ??= onFrame(stepTweens, 20); };

// Shared timeline for Tween and Sequence: delay, loops (restart / yoyo / incremental), speed, callbacks, promise.
class Timeline {
  constructor(duration) {
    Object.assign(this, { _duration: Math.max(0, duration), _delay: 0, _loops: 1, _loopType: 'restart', _ease: easeFn(), _speed: 1, _unscaled: false });
    Object.assign(this, { _elapsed: 0, _loop: -1, _started: false, _completed: false, _killed: false, _paused: false, _parent: null, _cb: {} });
    this._done = new Promise(r => (this._resolve = r));
    alive.add(this);
    queueMicrotask(() => { if (!this._parent && !this._killed && !this._paused && !this._completed) startTween(this); });
  }
  // ---- settings (chainable) ----
  ease(e) { this._ease = easeFn(e); return this; }
  delay(s) { this._delay = Math.max(0, s); return this; }
  // loops: total number of plays (-1 = forever); type: 'restart' | 'yoyo' (back and forth) | 'incremental' (keeps going)
  loops(n, type = 'restart') { this._loops = n < 0 ? Infinity : Math.max(1, n); this._loopType = type; return this; }
  speed(k) { this._speed = Math.max(0, k); return this; }
  unscaled(on = true) { this._unscaled = on; return this; } // ignore Time.timeScale
  onStart(fn) { this._cb.start = fn; return this; }
  onUpdate(fn) { this._cb.update = fn; return this; }
  onStepComplete(fn) { this._cb.step = fn; return this; }   // after each loop
  onComplete(fn) { this._cb.complete = fn; return this; }
  onKill(fn) { this._cb.kill = fn; return this; }
  // ---- state ----
  get duration() { return this._duration; }
  get totalDuration() { return this._delay + this._duration * this._loops; }
  get elapsed() { return this._elapsed; }
  get progress() { return this.totalDuration === Infinity ? 0 : Math.min(1, this._elapsed / (this.totalDuration || 1)); }
  get isPlaying() { return advancing.has(this) && !this._paused; }
  get isComplete() { return this._completed; }
  get isActive() { return !this._killed && !this._completed; }
  // ---- control ----
  play() {
    if (this._killed) return this;
    this._paused = false;
    if (!this._completed) { alive.add(this); if (!this._parent) startTween(this); }
    return this;
  }
  pause() { this._paused = true; advancing.delete(this); return this; }
  togglePause() { return this._paused ? this.play() : this.pause(); }
  // jump to time t (seconds from the start, delay included)
  goto(t, andPlay = false) { this._goto(Math.max(0, t)); this._elapsed = Math.max(0, t); if (andPlay) this.play(); return this; }
  restart() { this._completed = false; this._loop = -1; this.goto(0); return this.play(); }
  // jump to the end (infinite loops: end of the current loop); fires onComplete
  complete() {
    if (this._killed) return this;
    this.goto(this.totalDuration === Infinity ? this._delay + this._duration * (Math.max(0, this._loop) + 1) : this.totalDuration);
    if (!this._completed) this._finish();
    return this;
  }
  kill(complete = false) {
    if (this._killed) return this;
    if (complete && !this._completed) this.complete();
    this._killed = true;
    advancing.delete(this);
    alive.delete(this);
    this._release();
    this._call('kill');
    this._resolve(this._completed);
    return this;
  }
  then(ok, err) { return this._done.then(ok, err); } // await tween -> true (completed) / false (killed)
  // ---- internals ----
  _call(name, ...a) { try { this._cb[name]?.(...a); } catch (e) { console.error(`[tween] ${name}:`, e); } }
  _advance(dt) {
    if (this._paused || this._killed) return;
    this._elapsed += dt * this._speed;
    this._goto(this._elapsed);
    if (this._completed) advancing.delete(this);
  }
  _finish() { this._completed = true; alive.delete(this); this._release(); this._call('complete'); this._resolve(true); }
  _release() {}
  // time -> (loop index, eased local progress); calls _render(u, loop) and fires callbacks
  _goto(t) {
    const p = t - this._delay;
    if (p < 0) { if (this._started) this._render(this._ease(0), 0); return; }
    if (!this._started) { this._started = true; this._begin(); this._call('start'); }
    const d = this._duration, end = d * this._loops;
    let loop, u;
    if (d <= 0) { loop = this._loops === Infinity ? 0 : this._loops - 1; u = 1; }
    else if (p >= end) { loop = this._loops - 1; u = 1; }
    else { loop = Math.floor(p / d); u = (p - loop * d) / d; }
    if (this._loopType === 'yoyo' && loop % 2 === 1) u = 1 - u;
    this._render(this._ease(u), loop);
    this._call('update', this);
    if (loop > this._loop && this._loop >= 0) for (let i = this._loop; i < loop; i++) this._call('step', i);
    this._loop = loop;
    const finished = d <= 0 || p >= end;
    if (finished && !this._completed) { this._call('step', loop); this._finish(); }
    else if (!finished && this._completed) { this._completed = false; alive.add(this); } // rewound inside a sequence
  }
  _begin() {}
}

export class Tween extends Timeline {
  // channels: [{ ch, to, from? }]
  constructor(channels, duration) {
    super(duration);
    this._ch = channels;
    this._relative = false;
    this.target = channels[0]?.ch.key ?? null;
  }
  // start from these value(s) instead of the current one; applied as soon as the tween starts playing (also during delay)
  from(v) {
    for (const c of this._ch) c.from = this._ch.length > 1 && v && typeof v === 'object' && !Array.isArray(v) && c.path in v ? v[c.path] : v;
    queueMicrotask(() => { if (!this._started) for (const c of this._ch) if (c.from !== undefined) c.ch.set(c.ch.raw ? stored(c.from) : c.from); });
    return this;
  }
  relative(on = true) { this._relative = on; return this; } // `to` is an offset from the start value
  _begin() {
    for (const c of this._ch) {
      c.ch.begin?.();
      const cur = c.ch.get(), to = c.ch.raw ? stored(c.to) : c.to;
      c.a = c.from !== undefined ? (c.ch.raw ? stored(c.from) : c.from) : cur;
      c.b = this._relative ? addValue(c.a, to) : to;
    }
  }
  _render(e, loop) {
    for (const c of this._ch) {
      let v = lerpAny(c.a, c.b, e);
      if (this._loopType === 'incremental' && loop > 0) v = addValue(v, scaleValue(subValue(c.b, c.a), loop));
      c.ch.set(copyValue(v));
    }
  }
  _release() { for (const c of this._ch) c.ch.end?.(); }

  // ---- factories ----
  // to(target, path, to, duration) or to(target, { path: to, … }, duration)
  static to(target, path, to, duration) {
    if (path && typeof path === 'object') return new Tween(Object.entries(path).map(([p, v]) => ({ path: p, ch: channel(target, p), to: v })), to);
    return new Tween([{ path, ch: channel(target, path), to }], duration);
  }
  // animate from -> to, calling setter(value) every frame
  static value(from, to, duration, setter) {
    let cur = from;
    return new Tween([{ path: '', ch: { key: setter, get: () => cur, set: v => { cur = v; setter(v); } }, to }], duration).from(from);
  }
  // call fn after `seconds` (scaled time unless .unscaled())
  static delay(seconds, fn) { return new Tween([], 0).delay(seconds).onComplete(fn); }
  static sequence() { return new Sequence(); }
  // every running or paused tween animating `target` (node, WebObject, object, id) / all of them
  static of(target) {
    const key = isWebObject(target) ? target.node : typeof target === 'string' ? globalThis.GPSB?.node(target) ?? globalThis.GPSB?.find(target) : target;
    return [...alive].filter(t => t.target === key && t.isActive);
  }
  static killOf(target, complete = false) { for (const t of Tween.of(target)) t.kill(complete); }
  static killAll(complete = false) { for (const t of [...alive]) t.kill(complete); }
  static pauseAll() { for (const t of [...advancing]) t.pause(); }
  static isTweening(target) { return Tween.of(target).length > 0; }
  static get playing() { return advancing.size; }
}

// Tweens placed on one timeline. A tween added to a sequence is driven by it (it no longer plays on its own).
export class Sequence extends Timeline {
  constructor() { super(0); this._items = []; this._last = 0; this._ease = Ease.linear; }
  _add(at, t) {
    if (t._parent) throw new Error('tween is already in a sequence');
    t._parent = this;
    advancing.delete(t);
    if (t._loops === Infinity) { console.warn('[tween] infinite loops inside a sequence play once'); t._loops = 1; }
    this._items.push({ at, t });
    this._duration = Math.max(this._duration, at + t.totalDuration);
    return this;
  }
  append(t) { this._last = this._duration; return this._add(this._duration, t); }   // after everything so far
  join(t) { return this._add(this._last, t); }                                      // together with the last append
  insert(at, t) { return this._add(at, t); }                                         // at an absolute time
  appendInterval(s) { this._duration += Math.max(0, s); return this; }
  appendCallback(fn) { return this.insertCallback(this._duration, fn); }
  insertCallback(at, fn) { this._items.push({ at, fn }); this._duration = Math.max(this._duration, at); return this; }
  _render(e) {
    const t = e * this._duration, prev = this._t ?? -1;
    this._t = t;
    const items = t >= prev ? this._items : [...this._items].reverse();
    for (const it of items) {
      if (it.fn) { if (prev < it.at && it.at <= t) try { it.fn(); } catch (err) { console.error('[tween] callback:', err); } }
      else if (!it.t._killed) it.t._goto(t - it.at);
    }
  }
  _begin() { this._t = -1; }
  _release() { if (this._killed) for (const it of this._items) it.t?.kill(); }
}

export const tween = Tween.to;
export const sequence = Tween.sequence;
export const delayedCall = Tween.delay;

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
