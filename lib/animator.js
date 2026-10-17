// Page runtime animation: one controller per Animator node, driven by one shared rAF loop.
// Like Unity, sampled values overwrite the runtime node data (PSB.node) in place, then PSB.applyNode re-renders it.
import { walk, getComponent, getProp, setProp, nodeAtPath } from './node.js';
import { componentDef } from './components.js';
import { sampleClip, advance, clipLength } from './anim.js';

export function boot(PSB) {
  const ctls = new Map(), running = new Set();
  let last = 0, ready = false;
  const queue = [];
  addEventListener('psb:ready', () => { ready = true; queue.splice(0).forEach(f => f()); }, { once: true });

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const c of [...running]) c._tick(dt);
    if (running.size) requestAnimationFrame(frame);
  }
  const run = c => {
    if (!running.size) requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
    running.add(c);
  };

  for (const [anim] of walk(PSB.data.tree)) {
    const props = getComponent(anim, 'Animator')?.props;
    if (!props) continue;
    const clips = props.clips ?? [];
    const clipOf = name => PSB.data.clips?.[name];
    for (const name of clips) for (const tr of clipOf(name)?.tracks ?? []) {
      tr.keys.sort((a, b) => a.t - b.t);
      // preload sprite-swap frames
      const n = nodeAtPath(anim, tr.path), [type, prop] = tr.prop.split('.');
      if (n && componentDef(type, PSB.ctx.customs)?.props?.[prop]?.type === 'asset:image')
        for (const k of tr.keys) if (k.v) new Image().src = PSB.ctx.asset(k.v);
    }

    let base = null;
    const capture = () => {
      base = [];
      for (const name of clips) for (const tr of clipOf(name)?.tracks ?? []) {
        const n = nodeAtPath(anim, tr.path);
        if (n && !base.some(b => b.n === n && b.prop === tr.prop)) base.push({ n, prop: tr.prop, v: structuredClone(getProp(n, tr.prop)) });
      }
    };
    const applyAll = nodes => { for (const n of nodes) PSB.applyNode(n); };
    const fire = e => {
      if (!e.call) return;
      const go = () => {
        const target = e.target ? PSB.find(e.target, anim) : anim;
        if (!target) return console.warn(`Animator ${anim.name}: event target "${e.target}" not found`);
        try { PSB.invoke?.(target.id, e.call, e.arg ?? '', anim.id); } catch (err) { console.error(err); }
      };
      ready ? go() : queue.push(go);
    };

    const c = {
      id: anim.id, clip: null, time: 0, speed: props.speed ?? 1, playing: false, _rev: false, _prev: -1,
      sample() {
        const clip = clipOf(c.clip);
        if (!clip) return;
        const touched = new Set();
        for (const s of sampleClip(clip, c.time)) {
          const n = nodeAtPath(anim, s.path);
          if (n && setProp(n, s.prop, s.value)) touched.add(n);
        }
        applyAll(touched);
      },
      play(name = clips[0]) {
        if (!clipOf(name)) return console.warn(`Animator ${anim.name}: no clip "${name}"`);
        if (!base) capture();
        Object.assign(c, { clip: name, time: 0, _prev: -1, _rev: false, playing: true });
        c.sample();
        run(c);
      },
      stop() {
        c.playing = false; c._rev = false; c.time = 0; c._prev = -1;
        running.delete(c);
        if (!base) return;
        for (const b of base) setProp(b.n, b.prop, structuredClone(b.v));
        applyAll(new Set(base.map(b => b.n)));
      },
      pause() { c.playing = false; running.delete(c); },
      resume() { if (!c.clip) return c.play(); c._rev = false; c.playing = true; run(c); },
      rewind() { if (!c.clip) return; c._rev = true; c.playing = true; run(c); }, // play back to 0, then stop()
      seek(t) { if (!c.clip) { c.clip = clips[0]; if (!base) capture(); } c.time = Math.max(0, t); c._prev = c.time; c.sample(); },
      _tick(dt) {
        if (!c.playing) return running.delete(c);
        const clip = clipOf(c.clip), d = dt * c.speed;
        if (c._rev) {
          c.time = Math.max(0, c.time - d);
          if (c.time <= 0) return c.stop();
          return c.sample();
        }
        const r = advance(clip, c._prev, d);
        c.time = r.time; c._prev = r.time;
        c.sample();
        r.events.forEach(fire);
        if (r.ended) { c.playing = false; running.delete(c); }
      },
      get length() { return clipLength(clipOf(c.clip)); },
    };
    ctls.set(anim.id, c);

    const els = PSB.els(anim.id);
    const on = (ev, fn) => els.forEach(el => el.addEventListener(ev, fn));
    if (props.playOn === 'start') c.play();
    else if (props.playOn === 'hover') {
      on('pointerenter', () => (c.clip && c.time > 0 ? c.resume() : c.play()));
      on('pointerleave', () => c.rewind());
    } else if (props.playOn === 'click') on('click', () => {
      const clip = clipOf(c.clip ?? clips[0]);
      if (clip?.loop) return c.playing ? c.pause() : c.resume();
      const open = c.playing ? !c._rev : c.time > 0;
      open ? c.rewind() : c.time > 0 ? c.resume() : c.play();
    });
    else if (props.playOn === 'visible' && els.length) {
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); c.play(); } });
      els.forEach(el => io.observe(el));
    }
  }

  PSB.animator = id => ctls.get(id) ?? null;
}
