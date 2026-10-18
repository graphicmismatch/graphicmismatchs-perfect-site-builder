// Tweening (published as gpsb/tween.js): animate values from code over time.
//   tween(target, 'rect.rotation', 360, 1)              a node / WebObject property path (anything the Inspector shows)
//   tween(target, { 'rect.pos': [0, 40], 'CanvasGroup.alpha': 0 }, 0.5)   several properties at once
//   tween(obj, 'x', 100, 1) / tween(obj, { x: 100 }, 1) fields of a plain object
//   Tween.value(0, 1, 2, v => ...)                      a custom setter
//   sequence().append(a).join(b).appendInterval(0.2).append(c)
// Every tween is chainable (.ease('outBack').delay(0.2).loops(-1, 'yoyo').onComplete(fn)), auto-plays, and is awaitable
// (resolves true when it completes, false when killed). Driven by the shared frame loop (gpsb/frame.js, order 20).
// Docs: docs/tweening.md.
import { onFrame, markDirty } from './frame.js';
import { getProp, setProp } from './node.js';
import { cubicBezier, EASES, lerpValue } from './anim.js';

// ---------- easing ----------
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

// ---------- values ----------
// engine value types (Vector2, Color) lerp themselves; everything else as keyframes do (numbers, arrays, #hex colours)
const lerp = (a, b, u) => (a?.constructor?.lerpUnclamped ? a.constructor.lerpUnclamped(a, b, u) : lerpValue(a, b, u));
const add = (a, b) => typeof a === 'number' ? a + b : Array.isArray(a) ? a.map((x, i) => add(x, b[i] ?? 0)) : a?.add ? a.add(b) : b;
const sub = (a, b) => typeof a === 'number' ? a - b : Array.isArray(a) ? a.map((x, i) => sub(x, b[i] ?? 0)) : a?.sub ? a.sub(b) : 0;
const scale = (a, k) => typeof a === 'number' ? a * k : Array.isArray(a) ? a.map(x => scale(x, k)) : a?.mul ? a.mul(k) : a;
const raw = v => (v && typeof v === 'object' && typeof v.toJSON === 'function' ? v.toJSON() : v); // Vector2 -> [x, y], Color -> '#hex'
const copy = v => (Array.isArray(v) ? v.map(copy) : v);

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
    const ch = { key: node, raw: true, get: () => copy(getProp(node, path)), set: v => { setProp(node, path, v); markDirty(node, el); } };
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

// ---------- playback ----------
const active = new Set(); // advanced every frame
const all = new Set();    // created and not yet completed or killed (Tween.of, killAll)
let stopLoop = null;
function update(dt, udt) {
  for (const t of [...active]) if (active.has(t)) t._advance(t._unscaled ? udt : dt);
  if (!active.size && stopLoop) { stopLoop(); stopLoop = null; }
}
const play = t => { active.add(t); stopLoop ??= onFrame(update, 20); };

// Shared timeline for Tween and Sequence: delay, loops (restart / yoyo / incremental), speed, callbacks, promise.
class Timeline {
  constructor(duration) {
    Object.assign(this, { _duration: Math.max(0, duration), _delay: 0, _loops: 1, _loopType: 'restart', _ease: easeFn(), _speed: 1, _unscaled: false });
    Object.assign(this, { _elapsed: 0, _loop: -1, _started: false, _completed: false, _killed: false, _paused: false, _parent: null, _cb: {} });
    this._done = new Promise(r => (this._resolve = r));
    all.add(this);
    queueMicrotask(() => { if (!this._parent && !this._killed && !this._paused && !this._completed) play(this); });
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
  get isPlaying() { return active.has(this) && !this._paused; }
  get isComplete() { return this._completed; }
  get isActive() { return !this._killed && !this._completed; }
  // ---- control ----
  play() {
    if (this._killed) return this;
    this._paused = false;
    if (!this._completed) { all.add(this); if (!this._parent) play(this); }
    return this;
  }
  pause() { this._paused = true; active.delete(this); return this; }
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
    active.delete(this);
    all.delete(this);
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
    if (this._completed) active.delete(this);
  }
  _finish() { this._completed = true; all.delete(this); this._release(); this._call('complete'); this._resolve(true); }
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
    else if (!finished && this._completed) { this._completed = false; all.add(this); } // rewound inside a sequence
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
    queueMicrotask(() => { if (!this._started) for (const c of this._ch) if (c.from !== undefined) c.ch.set(c.ch.raw ? raw(c.from) : c.from); });
    return this;
  }
  relative(on = true) { this._relative = on; return this; } // `to` is an offset from the start value
  _begin() {
    for (const c of this._ch) {
      c.ch.begin?.();
      const cur = c.ch.get(), to = c.ch.raw ? raw(c.to) : c.to;
      c.a = c.from !== undefined ? (c.ch.raw ? raw(c.from) : c.from) : cur;
      c.b = this._relative ? add(c.a, to) : to;
    }
  }
  _render(e, loop) {
    for (const c of this._ch) {
      let v = lerp(c.a, c.b, e);
      if (this._loopType === 'incremental' && loop > 0) v = add(v, scale(sub(c.b, c.a), loop));
      c.ch.set(copy(v));
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
    return [...all].filter(t => t.target === key && t.isActive);
  }
  static killOf(target, complete = false) { for (const t of Tween.of(target)) t.kill(complete); }
  static killAll(complete = false) { for (const t of [...all]) t.kill(complete); }
  static pauseAll() { for (const t of [...active]) t.pause(); }
  static isTweening(target) { return Tween.of(target).length > 0; }
  static get playing() { return active.size; }
}

// Tweens placed on one timeline. A tween added to a sequence is driven by it (it no longer plays on its own).
export class Sequence extends Timeline {
  constructor() { super(0); this._items = []; this._last = 0; this._ease = Ease.linear; }
  _add(at, t) {
    if (t._parent) throw new Error('tween is already in a sequence');
    t._parent = this;
    active.delete(t);
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
