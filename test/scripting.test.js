// node test/scripting.test.js: frame clock, tweens, engine API (against a stub runtime), TypeScript compile + build
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Time, manualFrames, step, markDirty } from '../lib/frame.js';
import { Vector2, Vector4, Color, Mathf, prop, Behaviour, WebObject, WebEvent, Extension, defineExtension, html, raw, wait, waitUntil,
  tween, sequence, delayedCall, Tween, Ease, easeFn } from '../lib/engine.js';
import { compileTS, compileComponent } from '../lib/compile.js';
import { registerComponent, unregisterComponent } from '../lib/components.js';
import { renderPage, makeCtx } from '../lib/render.js';
import { newNode } from '../lib/node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
manualFrames();
// one frame: let queued microtasks (auto-play, batched applies) run first, like a real frame boundary
const frames = async (n, dt = 0.1) => { for (let i = 0; i < n; i++) { await null; await null; step(dt); } await null; };

// a stub runtime: applyNode calls are recorded
const applied = [], invoked = [];
const nodes = {};
globalThis.GPSB = {
  node: id => nodes[id], find: p => Object.values(nodes).find(n => n.name === p) ?? null, parent: () => null,
  el: () => null, els: () => [], nodeFor: el => el.node, ctx: { customs: {} }, behaviour: () => null,
  applyNode: (n, p, els) => applied.push([n.id, els?.length ?? 'all']), invoke: (...a) => invoked.push(a),
  assets: { url: p => 'assets/' + p },
};
const mk = (id, components = []) => (nodes[id] = Object.assign(newNode(id, components), { id }));

// ---------- frame clock ----------
{
  const t0 = Time.time;
  step(0.05); near(Time.deltaTime, 0.05); near(Time.time - t0, 0.05);
  step(5); near(Time.unscaledDeltaTime, Time.maximumDeltaTime); // clamped
  Time.timeScale = 0.5; step(0.1); near(Time.deltaTime, 0.05); near(Time.unscaledDeltaTime, 0.1); Time.timeScale = 1;
  applied.length = 0;
  const n = mk('dirty');
  markDirty(n); markDirty(n); markDirty(n, { id: 'el' });
  await null;
  assert.deepEqual(applied, [['dirty', 'all']], 'marked nodes are applied once per task, all elements win over one');
}

// ---------- easing ----------
for (const [name, f] of Object.entries(Ease)) { near(f(0), 0, 1e-9); near(f(1), 1, 1e-9); }
near(easeFn('ease-in-out')(0.5), 0.5, 1e-3);
near(easeFn([0, 0, 1, 1])(0.3), 0.3, 1e-3);
assert.ok(Ease.outBack(0.6) > 1, 'outBack overshoots');
assert.throws(() => easeFn('nope'), /unknown ease/);

// ---------- tweens: plain objects ----------
{
  const o = { x: 0, c: '#000000', v: [0, 0], deep: { y: 1 } };
  const t = tween(o, { x: 10, c: '#ffffff', v: [4, 8], 'deep.y': 3 }, 1).ease('linear');
  await frames(5);
  near(o.x, 5); assert.equal(o.c, '#808080'); assert.deepEqual(o.v, [2, 4]); near(o.deep.y, 2);
  await frames(6);
  assert.equal(o.x, 10); assert.ok(t.isComplete); assert.equal(await t, true);

  const y = { x: 0 }, steps = [];
  tween(y, 'x', 1, 0.5).ease('linear').loops(2, 'yoyo').onStepComplete(i => steps.push(i));
  await frames(3); near(y.x, 0.6);
  await frames(10); assert.equal(y.x, 0); assert.deepEqual(steps, [0, 1]);

  const r = { x: 5 };
  tween(r, 'x', 3, 0.2).relative().loops(3, 'incremental').ease('linear');
  await frames(20); near(r.x, 14);

  const f = { x: 0 };
  tween(f, 'x', 10, 1).from(100).delay(0.5).ease('linear');
  await null; await null;
  assert.equal(f.x, 100, 'from() applies at once, even during the delay');
  await frames(10); near(f.x, 55);

  const k = { x: 0 }, kt = tween(k, 'x', 1, 1);
  await frames(2);
  assert.equal(Tween.isTweening(k), true);
  Tween.killOf(k);
  assert.equal(await kt, false, 'a killed tween resolves false');
  assert.equal(Tween.of(k).length, 0);

  const p = { x: 0 }, pt = tween(p, 'x', 1, 1).ease('linear');
  await frames(2); pt.pause(); const at = p.x; await frames(3); assert.equal(p.x, at, 'paused');
  pt.play(); await frames(2); assert.ok(p.x > at);
  pt.complete(); assert.equal(p.x, 1); assert.ok(pt.isComplete);

  let called = 0; delayedCall(0.25, () => called++);
  await frames(2); assert.equal(called, 0); await frames(2); assert.equal(called, 1);

  const vals = []; Tween.value(0, 10, 0.2, v => vals.push(v)).ease('linear');
  await frames(4); assert.equal(vals[0], 0); assert.equal(vals.at(-1), 10);

  // engine value types lerp themselves
  const vo = { p: Vector2.zero, c: Color.black };
  tween(vo, { p: new Vector2(10, 20), c: Color.white }, 1).ease('linear');
  await frames(5);
  assert.ok(vo.p instanceof Vector2 && vo.p.equals([5, 10]), String(vo.p)); near(vo.c.r, 0.5);
  await frames(6);
}

// ---------- sequences ----------
{
  const s = { a: 0, b: 0, c: 0 }, order = [];
  const seq = sequence()
    .append(tween(s, 'a', 1, 0.5).ease('linear'))
    .appendCallback(() => order.push('after a: ' + s.a))
    .append(tween(s, 'b', 1, 0.5).ease('linear'))
    .join(tween(s, 'c', 1, 0.25).ease('linear'))
    .appendInterval(0.2);
  assert.equal(seq.duration, 1.2);
  await frames(3); near(s.a, 0.6); assert.equal(s.b, 0);
  await frames(5); assert.equal(s.a, 1); near(s.b, 0.6); assert.equal(s.c, 1);
  assert.deepEqual(order, ['after a: 1']);
  await frames(5); assert.ok(seq.isComplete); assert.equal(s.b, 1);
  assert.equal(await seq, true);

  const y = { x: 0 };
  sequence().append(tween(y, 'x', 1, 0.5).ease('linear')).loops(2, 'yoyo');
  await frames(7); near(y.x, 0.6, 1e-6); // on the way back
  await frames(10); assert.equal(y.x, 0);

  const nest = { a: 0, b: 0, c: 0 };
  const inSeq = sequence().append(tween(nest, 'a', 1, 0.2).ease('linear')).append(tween(nest, 'b', 1, 0.2).ease('linear'));
  const outSeq = sequence().append(inSeq).append(tween(nest, 'c', 1, 0.2).ease('linear'));
  near(outSeq.duration, 0.6);
  await frames(3); assert.deepEqual([nest.a, nest.c], [1, 0]); near(nest.b, 0.5);
  await frames(4); assert.deepEqual(nest, { a: 1, b: 1, c: 1 }); assert.equal(await outSeq, true, 'sequences nest');

  const z = { x: 0 }, inner = tween(z, 'x', 1, 0.2);
  const outer = sequence().append(inner);
  assert.throws(() => sequence().append(inner), /already in a sequence/);
  await frames(1); outer.kill(); assert.ok(!inner.isActive, 'killing a sequence kills its tweens');
}

// ---------- tweens: node property paths ----------
{
  const n = mk('tw', [{ type: 'Image', props: { color: '#000000' } }]);
  applied.length = 0;
  tween(n, { 'rect.pos': [100, 0], 'Image.color': '#ffffff', 'rect.rotation': 90 }, 0.4).ease('linear');
  await frames(1);
  assert.deepEqual(n.rect._layoutPos, [0, 0], 'rect.pos moves with translate() while it plays');
  await frames(1);
  near(n.rect.pos[0], 50); assert.equal(n.components[0].props.color, '#808080'); near(n.rect.rotation, 45);
  assert.ok(applied.length >= 2 && applied.every(([id]) => id === 'tw'));
  const perFrame = applied.length; await frames(1); assert.equal(applied.length - perFrame, 1, 'one apply per frame, however many props');
  await frames(5);
  assert.deepEqual(n.rect.pos, [100, 0]); assert.equal(n.rect._layoutPos, undefined, '_layoutPos removed at the end');
  globalThis.GPSB.find = p => nodes[p] ?? null;
  tween('tw', 'rect.rotation', 0, 0.1); await frames(3); assert.equal(n.rect.rotation, 0, 'target by id/path');
  assert.throws(() => tween('missing', 'rect.rotation', 1, 1), /no object/);
}

// ---------- value types ----------
{
  assert.deepEqual(Vector2.up.toArray(), [0, -1]);
  assert.equal(new Vector2(3, 4).magnitude, 5);
  assert.ok(new Vector2(1, 2).add([1, 1]).mul(2).equals([4, 6]));
  assert.ok(Vector2.moveTowards([0, 0], [10, 0], 3).equals([3, 0]));
  near(Vector2.angle([1, 0], [0, 1]), 90);
  assert.throws(() => { 'use strict'; Vector2.zero.x = 1; }, TypeError, 'immutable');
  assert.deepEqual(JSON.parse(JSON.stringify({ v: new Vector2(1, 2), c: Color.red })), { v: [1, 2], c: '#ff0000' });
  assert.ok(Vector4.from([1, 2, 3, 4]).add(1).equals([2, 3, 4, 5]));
  assert.equal(Color.parse('#f008').toHex(), '#ff000088');
  assert.equal(Color.parse('#336699').withAlpha(0.5).toHex(), '#33669980');
  assert.equal(String(Color.lerp('#000000', '#ffffff', 0.5)), '#808080');
  assert.equal(String(Color.parse('$brand')), '$brand'); assert.equal(Color.parse('$brand').valid, false);
  assert.equal(Color.parse(''), null);
  assert.equal(Mathf.deltaAngle(350, 10), 20); assert.equal(Mathf.pingPong(3, 2), 1); assert.equal(Mathf.inverseLerp(10, 20, 15), 0.5);
  assert.equal(Mathf.moveTowardsAngle(350, 10, 5), 355);
  const st = {}; let x = 0; for (let i = 0; i < 200; i++) x = Mathf.smoothDamp(x, 10, st, 0.2, Infinity, 1 / 60); near(x, 10, 1e-3);
}

// ---------- props + behaviours ----------
{
  assert.deepEqual(prop.number(90, { min: 0 }), { type: 'number', default: 90, min: 0 });
  assert.deepEqual(prop.vec2(new Vector2(1, 2)), { type: 'vec2', default: [1, 2] });
  assert.deepEqual(prop.color(Color.red), { type: 'color', default: '#ff0000' });
  assert.deepEqual(prop.enum(['a', 'b']), { type: 'enum', options: ['a', 'b'], default: 'a' });
  assert.deepEqual(prop.asset('image'), { type: 'asset:image', default: '' });

  const label = mk('lbl', [{ type: 'Text', props: { text: 'hi', color: '#000000' } }]);
  const self = mk('self', [{ type: 'Image', props: { color: '#ff0000' } }]);
  class B extends Behaviour {
    static props = { speed: prop.number(1), offset: prop.vec2([1, 2]), tint: prop.color('#00ff00'), target: prop.node({ component: 'Text' }), done: prop.event() };
    shadow = 5; // not a prop: untouched
  }
  const b = new B();
  const el = { node: self, closest: () => null, parentElement: null, querySelector: () => null };
  Object.assign(b, { el, node: self, props: { speed: 3, offset: [5, 6], tint: '#0000ff', target: 'lbl', done: [{ target: 'x', call: 'setActive', arg: '' }] } });
  b._gpsbReady();
  assert.equal(b.speed, 3); b.speed = 7; assert.equal(b.props.speed, 7, 'fields write through to props (Animator, Inspector)');
  assert.ok(b.offset instanceof Vector2 && b.offset.equals([5, 6])); b.offset = new Vector2(9, 9); assert.deepEqual(b.props.offset, [9, 9]);
  assert.equal(String(b.tint), '#0000ff'); b.tint = Color.red; assert.equal(b.props.tint, '#ff0000');
  // node props resolve near the element (stub: near() walks parents, finds nothing) -> resolved via GPSB.node
  globalThis.GPSB.el = id => ({ node: nodes[id], dataset: { gpsb: id } });
  const realNear = (await import('../lib/components.js')).near;
  assert.equal(typeof realNear, 'function');
  b.props.target = '';
  assert.equal(b.target, null);
  b.target = WebObject.of(label); assert.equal(b.props.target, 'lbl', 'assigning a WebObject stores its id');

  b.done.addListener(a => invoked.push(['listener', a]));
  invoked.length = 0; b.done.invoke('v');
  assert.deepEqual(invoked, [['x', 'setActive', 'v', 'self'], ['listener', 'v']]);
  assert.ok(b.done instanceof WebEvent);

  // a class field named like a prop is replaced by the accessor (with a warning)
  class S extends Behaviour { static props = { speed: prop.number(1) }; speed = 99; }
  const s = new S(), warn = console.warn; let warned = '';
  console.warn = m => (warned = m);
  Object.assign(s, { el, node: self, props: { speed: 4 } }); s._gpsbReady();
  console.warn = warn;
  assert.equal(s.speed, 4); assert.match(warned, /declare speed/);
  assert.throws(() => { class R extends Behaviour { static props = { node: prop.number() }; } new R(); }, /clashes/);

  // wrappers: typed component fields + rect transform, applied at the end of the task
  applied.length = 0;
  const wo = WebObject.of(self);
  assert.equal(WebObject.of(self), wo, 'one wrapper per node');
  wo.rectTransform.anchoredPosition = new Vector2(10, 20);
  wo.rectTransform.rotation = 45;
  const img = wo.getComponent('Image');
  assert.equal(String(img.color), '#ff0000'); img.color = Color.blue;
  assert.equal(self.components[0].props.color, '#0000ff');
  assert.deepEqual(self.rect.pos, [10, 20]); assert.ok(wo.rectTransform.anchoredPosition.equals([10, 20]));
  assert.equal(applied.length, 0); await null;
  assert.deepEqual(applied, [['self', 'all']]);
  assert.equal(wo.getComponent('Text'), null);
  const cg = wo.addComponent('CanvasGroup'); assert.equal(cg.alpha, 1);
  wo.fadeTo(0, 0.2).ease('linear'); await frames(3); assert.equal(self.components.find(c => c.type === 'CanvasGroup').props.alpha, 0);
  wo.active = false; assert.equal(self.active, false); wo.setActive('toggle'); assert.equal(self.active, true);
}

// ---------- coroutines ----------
{
  const log = [], flag = { on: false };
  class C extends Behaviour {
    *run() {
      log.push('start');
      yield;
      log.push('frame');
      yield wait(0.25);
      log.push('waited');
      yield waitUntil(() => flag.on);
      log.push('until');
      yield tween({ x: 0 }, 'x', 1, 0.2);
      log.push('tween');
      yield (function* () { yield wait(0.1); log.push('nested'); })();
      log.push('end');
    }
  }
  const c = new C(), co = c.startCoroutine(c.run);
  assert.deepEqual(log, ['start'], 'runs to the first yield at once');
  await frames(1); assert.deepEqual(log, ['start', 'frame']);
  await frames(2); assert.equal(log.length, 2); await frames(1); assert.equal(log.at(-1), 'waited');
  await frames(3); assert.equal(log.at(-1), 'waited'); flag.on = true; await frames(1); assert.equal(log.at(-1), 'until');
  await frames(2); assert.equal(log.at(-1), 'until', 'waits for the tween');
  await frames(6); assert.deepEqual(log.slice(-4), ['until', 'tween', 'nested', 'end']);
  assert.equal(await co, true);
  const c2 = new C(), co2 = c2.startCoroutine(c2.run); c2.stopAllCoroutines();
  assert.equal(await co2, false);
}

// ---------- extensions ----------
{
  assert.equal(String(html`<b title="${'"x"'}">${'<i>'}${raw('<u>ok</u>')}${['a', html`<br>`]}${null}${false}</b>`), '<b title="&#34;x&#34;">&#60;i&#62;<u>ok</u>a<br></b>');
  const inits = [];
  class Badge extends Extension {
    static props = { label: prop.string('new'), color: prop.color('#3366ff'), pad: prop.vec2([4, 8]), clicks: prop.int(0) };
    static category = 'Test';
    tag() { return 'section'; }
    style() { return { color: this.color, padding: `${this.pad.y}px ${this.pad.x}px` }; }
    attrs() { return { 'data-label': this.label }; }
    inner() { return html`<span>${this.label}</span>`; }
    head() { return [html`<meta name="badge">`]; }
    init(el) { inits.push([el, this.label, this.webObject.node.id]); this.clicks++; }
  }
  const def = defineExtension(Badge);
  assert.equal(def.category, 'Test'); assert.equal(def.patch, undefined, 'only the hooks the class has');
  registerComponent('TBadge', def);
  const root = newNode('Canvas', [{ type: 'Canvas', props: {} }, { type: 'CanvasScaler', props: {} }]);
  root.children.push(Object.assign(newNode('B', [{ type: 'TBadge', props: { label: 'a<b' } }]), { id: 'bdg' }));
  const r = renderPage(root, makeCtx({}));
  assert.match(r.body, /<section class="b" data-gpsb="bdg" data-label="a&#60;b"><span>a&#60;b<\/span><\/section>/);
  assert.match(r.css, /color: #3366ff;/); assert.match(r.css, /padding: 8px 4px;/);
  const node = nodes.bdg = root.children[0], el = { node };
  applied.length = 0;
  def.init({ el, GPSB: globalThis.GPSB, ci: 0 });
  assert.deepEqual(inits, [[el, 'a<b', 'bdg']]);
  assert.equal(node.components[0].props.clicks, 1, 'prop fields write to the live node data');
  await null; assert.deepEqual(applied, [['bdg', 1]], '…and re-apply that element');
  unregisterComponent('TBadge');
}

// ---------- TypeScript ----------
{
  const r = compileTS('import { a } from "./x.ts";\nexport { b } from \'../y/z.ts\';\nconst c = import("./w.ts");\nenum E { A, B }\nexport default class K { declare p: number; constructor(private q: string) {} f(): E { return E.B; } }\n', 'behaviours/K.ts');
  assert.match(r.code, /from "\.\/x\.js"/); assert.match(r.code, /from '\.\.\/y\/z\.js'/); assert.match(r.code, /import\("\.\/w\.js"\)/);
  assert.doesNotMatch(r.code, /declare|: number|private/);
  assert.deepEqual(r.map.sources, ['K.ts']); assert.match(r.map.sourcesContent[0], /enum E/);
  assert.throws(() => compileTS('let x: = 1;', 'bad.ts'));
  const c = compileComponent('T', '<template>x</template><script lang="ts">export default class { n: number = 1 }</script>');
  assert.match(c['T.script.js'], /n = 1/); assert.doesNotMatch(c['T.script.js'], /: number/);
}

// ---------- TypeScript project: build ----------
{
  const tmp = path.join(ROOT, '.tmp', 'scripting-test'), out = path.join(tmp, 'dist');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'test/fixtures/scripting'), tmp, { recursive: true });
  const cli = (...a) => spawnSync(process.execPath, ['cli.js', ...a], { cwd: ROOT, encoding: 'utf8' });
  let b = cli('build', tmp);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.stderr, '', 'no warnings printed');
  const list = d => fs.readdirSync(path.join(out, d), { recursive: true }).sort();
  assert.deepEqual(list('behaviours'), ['Spinner.js', 'Spinner.js.map', 'TweenDemo.js', 'TweenDemo.js.map']);
  assert.deepEqual(list('extensions'), ['Badge.js', 'Badge.js.map', 'lib', 'lib/format.js', 'lib/format.js.map']);
  assert.ok(!fs.readdirSync(path.join(out, 'gpsb')).some(f => f.endsWith('.d.ts')), 'typings are not published');
  assert.ok(!fs.existsSync(path.join(out, 'gpsb/tween.js')), 'tweens are part of gpsb/engine.js');
  assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /<span class="badge-text">BETA<\/span>/, 'TS extension + TS helper ran at build time');
  assert.match(fs.readFileSync(path.join(out, 'extensions/Badge.js'), 'utf8'), /from '\.\/lib\/format\.js'[\s\S]*sourceMappingURL=Badge\.js\.map/);
  // typings
  b = cli('types', tmp);
  assert.equal(b.status, 0, b.stderr);
  const pd = fs.readFileSync(path.join(tmp, '.gpsb/types/gpsb/project.d.ts'), 'utf8');
  assert.match(pd, /"Text": \{[^}]*text: string;/); assert.match(pd, /"Badge": \{\s*label: string;\s*color: Color;\s*clicks: number;/);
  assert.ok(fs.existsSync(path.join(tmp, 'tsconfig.json')) && fs.existsSync(path.join(tmp, '.gpsb/types/gpsb/engine.d.ts')));
  fs.writeFileSync(path.join(tmp, '.gpsb/types/gpsb/tween.d.ts'), '// from an older gpsb\n');
  cli('types', tmp);
  assert.deepEqual(fs.readdirSync(path.join(tmp, '.gpsb/types/gpsb')).sort(), ['engine.d.ts', 'project.d.ts'], 'stale typings removed');
  // errors name the file
  fs.writeFileSync(path.join(tmp, 'extensions/Broken.ts'), 'export default { props: { x: } };\n');
  b = cli('build', tmp);
  assert.notEqual(b.status, 0); assert.match(b.stderr, /extensions\/Broken\.ts/);
  fs.rmSync(path.join(tmp, 'extensions/Broken.ts'));
  fs.writeFileSync(path.join(tmp, 'behaviours/Spinner.js'), 'export default class {}\n');
  b = cli('build', tmp);
  assert.notEqual(b.status, 0); assert.match(b.stderr, /both Spinner\.js and Spinner\.ts exist/);
}

console.log('scripting ok');
process.exit(0); // the frame loop holds no handles, but the stub tweens' promises may
