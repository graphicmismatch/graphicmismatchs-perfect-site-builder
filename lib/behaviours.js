// MonoBehaviour-style scripts (behaviours/<Name>.js) + UnityEvent dispatch. Browser only.
import { walk, getComponent } from './node.js';
import { componentDef } from './components.js';

const fail = (name, what, e) => console.error(`[behaviour ${name}] ${what}:`, e);

export async function boot(PSB) {
  const instances = [], meta = {};
  let done;
  const ready = new Promise(r => (done = r));

  PSB.behaviour = (id, name) => instances.find(i => i.node.id === id && i.name === name)?.inst ?? null;

  // one event entry; target: '' (= source), node id, or path relative to the source node
  PSB.invoke = (targetId, call, arg = '', sourceId) => {
    const id = !targetId ? sourceId : PSB.node(targetId) ? targetId : (PSB.find(targetId, PSB.node(sourceId)) ?? PSB.find(targetId))?.id;
    if (!id) return console.warn(`[invoke] ${call}: no target "${targetId}"`);
    const els = PSB.els(id), media = () => els.map(el => el.matches('video,audio') ? el : el.querySelector('video,audio')).filter(Boolean);
    const a = String(arg ?? '');
    if (call === 'setActive') return PSB.setActive(id, a === 'toggle' ? 'toggle' : a !== 'false');
    if (call === 'navigate') return void (location.href = PSB.ctx.href(a));
    if (call === 'scrollTo') return els[0]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (call.startsWith('Media.')) {
      for (const m of media()) {
        const play = call === 'Media.play' || (call === 'Media.toggle' && m.paused);
        if (play) m.play().catch(e => console.warn('[invoke] media:', e.message)); else m.pause();
      }
      return;
    }
    if (call.startsWith('Animator.')) {
      const c = PSB.animator?.(id);
      if (!c) return console.warn(`[invoke] ${call}: no Animator on ${PSB.node(id)?.name}`);
      const m = call.slice(9);
      return m === 'play' ? c.play(a || undefined) : c[m]?.();
    }
    const b = call.match(/^behaviour:([^.]+)\.(.+)$/);
    if (b) return ready.then(() => {
      const inst = PSB.behaviour(id, b[1]);
      if (typeof inst?.[b[2]] !== 'function') return console.warn(`[invoke] ${call}: not found on ${PSB.node(id)?.name}`);
      try { return inst[b[2]](a); } catch (e) { fail(b[1], b[2], e); }
    });
    console.warn(`[invoke] unknown call "${call}"`);
  };

  // load modules (failures are logged and skipped)
  const mods = {};
  await Promise.all((PSB.data.behaviours ?? []).map(name =>
    import(new URL(`../behaviours/${encodeURIComponent(name)}.js`, import.meta.url))
      .then(m => { mods[name] = m; meta[name] = { props: m.props ?? m.default?.props ?? {} }; }, e => fail(name, 'load', e))));

  for (const [node] of walk(PSB.data.tree)) {
    for (const [ci, c] of (node.components ?? []).entries()) {
      if (!c.type.startsWith('behaviour:')) continue;
      const name = c.type.slice(10), mod = mods[name];
      if (!mod?.default) continue;
      for (const el of PSB.els(node.id)) {
        const n = PSB.nodeFor(el), np = (n.components[ci].props ??= {}); // per-element data, shared with the animator
        for (const [k, s] of Object.entries(meta[name].props)) np[k] ??= structuredClone(s.default);
        let inst;
        try { inst = new mod.default(); } catch (e) { fail(name, 'constructor', e); continue; }
        const parent = PSB.parent(node.id);
        Object.assign(inst, {
          el, node: n, PSB, props: np,
          find: path => PSB.find(path, n),
          apply: () => PSB.applyNode(n, parent, el),
          animator: animatorOf(PSB, node, el),
          setActive: on => { n.active = !!on; PSB.applyNode(n, parent, el); },
        });
        if (inst.onClick) el.addEventListener('click', e => { try { inst.onClick(e); } catch (err) { fail(name, 'onClick', err); } });
        instances.push({ name, node: n, inst });
      }
    }
  }

  // event props (Button.onClick, custom component events) -> click
  for (const [node] of walk(PSB.data.tree)) {
    for (const [ci, c] of (node.components ?? []).entries()) {
      if (c.type.startsWith('behaviour:')) continue;
      const def = componentDef(c.type, PSB.ctx.customs, meta);
      for (const [k, s] of Object.entries(def?.props ?? {})) {
        if (s.type !== 'event') continue;
        for (const el of PSB.els(node.id)) el.addEventListener('click', () => { // per-element props: {{item.*}} resolved
          for (const e of [PSB.nodeFor(el).components[ci].props?.[k] ?? []].flat()) if (e?.call) PSB.invoke(e.target, e.call, e.arg, node.id);
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

function animatorOf(PSB, node, el) {
  if (!PSB.animator) return null;
  for (let n = node; n; n = PSB.parent(n.id)) if (getComponent(n, 'Animator')) return PSB.animator(n.id, el) ?? null;
  return null;
}
