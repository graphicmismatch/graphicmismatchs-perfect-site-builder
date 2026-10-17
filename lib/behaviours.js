// MonoBehaviour-style scripts (behaviours/<Name>.js) + UnityEvent dispatch. Browser only.
import { walk, getComponent } from './node.js';
import { componentDef, control } from './components.js';

const fail = (name, what, e) => console.error(`[behaviour ${name}] ${what}:`, e);

export async function boot(GPSB) {
  const instances = [], meta = {};
  let done;
  const ready = new Promise(r => (done = r));

  GPSB.behaviour = (id, name) => instances.find(i => i.node.id === id && i.name === name)?.inst ?? null;

  // one event entry; target: '' (= source), node id, or path relative to the source node
  GPSB.invoke = (targetId, call, arg = '', sourceId) => {
    const id = !targetId ? sourceId : GPSB.node(targetId) ? targetId : (GPSB.find(targetId, GPSB.node(sourceId)) ?? GPSB.find(targetId))?.id;
    if (!id) return console.warn(`[invoke] ${call}: no target "${targetId}"`);
    const els = GPSB.els(id), media = () => els.map(el => el.matches('video,audio') ? el : el.querySelector('video,audio')).filter(Boolean);
    const a = String(arg ?? '');
    if (call === 'setActive') return GPSB.setActive(id, a === 'toggle' ? 'toggle' : a !== 'false');
    if (call === 'navigate') return void (location.href = GPSB.ctx.href(a));
    if (call === 'scrollTo') return els[0]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (call.startsWith('Media.')) {
      for (const m of media()) {
        const play = call === 'Media.play' || (call === 'Media.toggle' && m.paused);
        if (play) m.play().catch(e => console.warn('[invoke] media:', e.message)); else m.pause();
      }
      return;
    }
    if (call.startsWith('Animator.')) {
      const c = GPSB.animator?.(id);
      if (!c) return console.warn(`[invoke] ${call}: no Animator on ${GPSB.node(id)?.name}`);
      const m = call.slice(9);
      return m === 'play' ? c.play(a || undefined) : c[m]?.();
    }
    const b = call.match(/^behaviour:([^.]+)\.(.+)$/);
    if (b) return ready.then(() => {
      const inst = GPSB.behaviour(id, b[1]);
      if (typeof inst?.[b[2]] !== 'function') return console.warn(`[invoke] ${call}: not found on ${GPSB.node(id)?.name}`);
      try { return inst[b[2]](a); } catch (e) { fail(b[1], b[2], e); }
    });
    console.warn(`[invoke] unknown call "${call}"`);
  };

  // load modules (failures are logged and skipped)
  const mods = {};
  await Promise.all((GPSB.data.behaviours ?? []).map(name =>
    import(new URL(`../behaviours/${encodeURIComponent(name)}.js`, import.meta.url))
      .then(m => { mods[name] = m; meta[name] = { props: m.props ?? m.default?.props ?? {} }; }, e => fail(name, 'load', e))));

  for (const [node] of walk(GPSB.data.tree)) {
    for (const [ci, c] of (node.components ?? []).entries()) {
      if (!c.type.startsWith('behaviour:')) continue;
      const name = c.type.slice(10), mod = mods[name];
      if (!mod?.default) continue;
      for (const el of GPSB.els(node.id)) {
        const n = GPSB.nodeFor(el), np = (n.components[ci].props ??= {}); // per-element data, shared with the animator
        for (const [k, s] of Object.entries(meta[name].props)) np[k] ??= structuredClone(s.default);
        let inst;
        try { inst = new mod.default(); } catch (e) { fail(name, 'constructor', e); continue; }
        const parent = GPSB.parent(node.id);
        Object.assign(inst, {
          el, node: n, GPSB, props: np,
          find: path => GPSB.find(path, n),
          apply: () => GPSB.applyNode(n, parent, el),
          animator: animatorOf(GPSB, node, el),
          setActive: on => { n.active = !!on; GPSB.applyNode(n, parent, el); },
        });
        if (inst.onClick) el.addEventListener('click', e => { try { inst.onClick(e); } catch (err) { fail(name, 'onClick', err); } });
        instances.push({ name, node: n, inst });
      }
    }
  }

  // event props (Button.onClick, Toggle.onValueChanged, custom component events) -> DOM event `on` (default click).
  // Form controls first write the edited value back into the element's node data (def.state), so events, behaviours
  // and later re-applies see it; an entry with an empty arg receives that value.
  for (const [node] of walk(GPSB.data.tree)) {
    for (const [ci, c] of (node.components ?? []).entries()) {
      if (c.type.startsWith('behaviour:')) continue;
      const def = componentDef(c.type, GPSB.ctx.customs, meta), st = def?.state;
      const value = el => (st && control(el) ? String(st.read(control(el))) : '');
      if (st) for (const el of GPSB.els(node.id)) for (const ev of ['input', 'change']) el.addEventListener(ev, e => {
        if (e.target !== control(el)) return;
        (GPSB.nodeFor(el).components[ci].props ??= {})[st.prop] = st.read(e.target);
      });
      for (const [k, s] of Object.entries(def?.props ?? {})) {
        if (s.type !== 'event') continue;
        for (const el of GPSB.els(node.id)) el.addEventListener(s.on ?? 'click', e => { // per-element props: {{item.*}} resolved
          if (s.on && e.target !== control(el)) return;
          for (const x of [GPSB.nodeFor(el).components[ci].props?.[k] ?? []].flat())
            if (x?.call) GPSB.invoke(x.target, x.call, st && !x.arg ? value(el) : x.arg, node.id);
        });
      }
    }
  }

  for (const { name, inst } of instances) {
    try { const r = inst.start?.(); if (r?.catch) r.catch(e => fail(name, 'start', e)); } catch (e) { fail(name, 'start', e); }
  }
  done();

  const ticking = instances.filter(i => typeof i.inst.update === 'function');
  if (!ticking.length) return;
  let last = performance.now();
  requestAnimationFrame(function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    for (const i of ticking) {
      if (i.dead) continue;
      try { i.inst.update(dt); } catch (e) { i.dead = true; fail(i.name, 'update (disabled)', e); }
    }
    requestAnimationFrame(tick);
  });
}

function animatorOf(GPSB, node, el) {
  if (!GPSB.animator) return null;
  for (let n = node; n; n = GPSB.parent(n.id)) if (getComponent(n, 'Animator')) return GPSB.animator(n.id, el) ?? null;
  return null;
}
