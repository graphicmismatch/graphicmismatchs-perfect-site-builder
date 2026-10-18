// Shared frame clock for scripts (published as gpsb/frame.js): Time, one ordered per-frame loop (behaviours,
// coroutines, tweens) and batched re-applies. Isomorphic: nothing runs until something subscribes in a browser;
// tests drive it with manualFrames() + step(dt).
export const Time = {
  deltaTime: 0, unscaledDeltaTime: 0, // seconds since the last frame (scaled by timeScale / real), at most maximumDeltaTime
  time: 0, unscaledTime: 0, frameCount: 0,
  timeScale: 1, maximumDeltaTime: 0.1,
};

// order: behaviours update 0, coroutines 10, tweens 20, lateUpdate 30
const subs = [];
let raf = 0, last = -1, manual = false;
const hasRaf = () => !manual && typeof requestAnimationFrame === 'function';

function tick(now) {
  raf = 0;
  const dt = last < 0 ? 0 : (now - last) / 1000;
  last = now;
  step(dt);
  if (subs.length && hasRaf()) raf = requestAnimationFrame(tick);
}

// fn(deltaTime, unscaledDeltaTime) every frame until the returned function is called
export function onFrame(fn, order = 0) {
  const s = { fn, order };
  subs.push(s);
  subs.sort((a, b) => a.order - b.order);
  if (!raf && hasRaf()) { last = -1; raf = requestAnimationFrame(tick); }
  return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
}

// advance one frame by `dt` real seconds
export function step(dt) {
  const u = Math.min(Time.maximumDeltaTime, Math.max(0, dt));
  Time.unscaledDeltaTime = u;
  Time.deltaTime = u * Time.timeScale;
  Time.unscaledTime += u;
  Time.time += Time.deltaTime;
  Time.frameCount++;
  for (const s of [...subs]) {
    if (!subs.includes(s)) continue; // removed by an earlier subscriber this frame
    try { s.fn(Time.deltaTime, u); } catch (e) { console.error('[frame]', e); }
  }
}

// tests / non-browser hosts: stop the rAF loop and advance with step(dt)
export function manualFrames(on = true) {
  manual = on;
  if (on && raf) { cancelAnimationFrame(raf); raf = 0; }
}

// Batched applyNode: changes made through the engine API (wrappers, tweens) mark their node, and every marked node is
// re-applied once at the end of the current task. els: the element(s) to update (a Repeat copy), or all of the node's.
const dirty = new Map();
let queued = false;
export function markDirty(node, el) {
  if (!node) return;
  const prev = dirty.get(node);
  if (!el) dirty.set(node, null);
  else if (prev !== null) dirty.set(node, (prev ?? new Set()).add(el));
  if (!queued) { queued = true; queueMicrotask(flush); }
}
export function flush() {
  queued = false;
  const G = globalThis.GPSB, list = [...dirty];
  dirty.clear();
  if (!G?.applyNode) return;
  for (const [n, els] of list) {
    try { G.applyNode(n, undefined, els ? [...els] : undefined); } catch (e) { console.error('[apply]', e); }
  }
}
