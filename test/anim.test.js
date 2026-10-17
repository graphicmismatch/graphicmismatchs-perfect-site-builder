// node test/anim.test.js
import assert from 'node:assert/strict';
import { ease, cubicBezier, lerpValue, evalTrack, sampleClip, applyClip, advance, clipLength, animatableProps, setKey, dedupeKeys, snapTime, fillNode } from '../lib/anim.js';
import { newNode } from '../lib/node.js';

const near = (a, b, e = 1e-4) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

// easing
near(ease('linear', 0.3), 0.3);
assert.equal(ease('step', 0.99), 0);
assert.equal(ease('step', 1), 1);
near(ease('ease-in', 0.5), 0.3153, 1e-3);   // CSS ease-in at 50%
near(ease('ease-out', 0.5), 0.6847, 1e-3);
near(ease('ease-in-out', 0.5), 0.5);
near(ease([0.25, 0.1, 0.25, 1], 0.5), 0.8024, 1e-3); // CSS 'ease'
near(cubicBezier(0, 0, 1, 1, 0.37), 0.37);
assert.equal(ease([0.9, 0, 0.1, 1], 0), 0);
assert.equal(ease([0.9, 0, 0.1, 1], 1), 1);
for (let u = 0; u <= 1; u += 0.05) { const y = ease('ease-in-out', u); assert.ok(y >= -1e-9 && y <= 1 + 1e-9); }

// lerp: numbers, colors (RGBA), arrays, step for everything else
assert.equal(lerpValue(0, 10, 0.25), 2.5);
assert.equal(lerpValue('#000000', '#ffffff', 0.5), '#808080');
assert.equal(lerpValue('#ff000000', '#ff0000ff', 0.5), '#ff000080');
assert.equal(lerpValue('#ffffff', '#00000000', 1), '#00000000');
assert.deepEqual(lerpValue([0, 10], [10, 20], 0.5), [5, 15]);
assert.equal(lerpValue('img/a.png', 'img/b.png', 0.9), 'img/a.png');
assert.equal(lerpValue(true, false, 0.5), true);
assert.equal(lerpValue('left', 'right', 1), 'right');

// tracks
const vec = { path: '', prop: 'rect.pos.x', keys: [{ t: 0, v: -50, ease: 'step' }, { t: 1, v: 0 }, { t: 2, v: 100, ease: 'ease-out' }, { t: 3, v: 0 }] };
assert.equal(evalTrack(vec, -1), -50);
assert.equal(evalTrack(vec, 0.999), -50);  // step holds
assert.equal(evalTrack(vec, 1), 0);
near(evalTrack(vec, 1.5), 50);
assert.ok(evalTrack(vec, 2.5) < 50);          // ease-out front-loads
assert.equal(evalTrack(vec, 9), 0);
const sprite = { path: 'Logo', prop: 'Image.sprite', keys: [{ t: 0, v: 'a.png' }, { t: 0.5, v: 'b.png' }] };
assert.equal(evalTrack(sprite, 0.49), 'a.png');
assert.equal(evalTrack(sprite, 0.5), 'b.png');
const whole = { path: '', prop: 'rect.scale', keys: [{ t: 0, v: [1, 1] }, { t: 1, v: [2, 3] }] };
assert.deepEqual(evalTrack(whole, 0.5), [1.5, 2]);
assert.notEqual(evalTrack(whole, 5), whole.keys[1].v); // copies, never the key's own array

// sampleClip / applyClip
const clip = {
  name: 'T', length: 2, loop: true, fps: 60,
  tracks: [vec, sprite, { path: 'Title', prop: 'Image.color', keys: [{ t: 0, v: '#ffffff00' }, { t: 1, v: '#ffffffff' }] }, { path: 'Nope', prop: 'active', keys: [{ t: 0, v: false }] }],
  events: [{ t: 0, call: 'a' }, { t: 1, call: 'b' }, { t: 2, call: 'c' }],
};
const s = sampleClip(clip, 0.5);
assert.equal(s.length, 4);
assert.deepEqual(s[2], { path: 'Title', prop: 'Image.color', value: '#ffffff80' });

const root = newNode('Hero', [{ type: 'Animator', props: { clips: ['T'] } }]);
const logo = newNode('Logo', [{ type: 'Image', props: { sprite: 'a.png' } }]);
const title = newNode('Title', [{ type: 'Image', props: {} }, { type: 'Text', props: {} }]);
root.children.push(logo, title);
const m = applyClip(root, clip, 1.5);
assert.deepEqual([...m.keys()].sort(), [root.id, logo.id, title.id].sort());
near(m.get(root.id).rect.pos[0], 50);
assert.equal(m.get(logo.id).components[0].props.sprite, 'b.png');
assert.equal(m.get(title.id).components[0].props.color, '#ffffffff');
assert.equal(m.get(title.id).components[1].props.size, 24); // defaults filled
assert.equal(root.rect.pos[0], 0);                          // originals untouched
assert.equal(title.components[0].props.color, undefined);

// event crossing
const names = r => r.events.map(e => e.call);
assert.deepEqual(names(advance(clip, -1, 0.1)), ['a']);       // start fires t=0
assert.deepEqual(names(advance(clip, 0.1, 0.5)), []);
assert.deepEqual(names(advance(clip, 0.9, 0.2)), ['b']);
let r = advance(clip, 1.9, 0.2);                              // loop wrap: end + start events
assert.deepEqual(names(r), ['c', 'a']);
near(r.time, 0.1); assert.equal(r.ended, false);
r = advance({ ...clip, loop: false }, 1.9, 0.5);              // hold last frame
assert.deepEqual([r.time, r.ended, names(r)], [2, true, ['c']]);
assert.equal(clipLength({ tracks: [vec], events: [] }), 3);

// animatable properties come from the schemas
const props = animatableProps(root, { customs: { Card: { props: { title: { type: 'string', default: '' }, pad: { type: 'vec4', default: [0, 0, 0, 0] } } } }, behaviours: { Spin: { props: { speed: { type: 'number', default: 90 } } } } });
const has = (path, prop) => props.find(p => p.path === path && p.prop === prop);
for (const p of ['active', 'rect.pos.x', 'rect.pos.y', 'rect.size.x', 'rect.size.y', 'rect.anchorMin.x', 'rect.anchorMin.y', 'rect.anchorMax.x', 'rect.anchorMax.y', 'rect.pivot.x', 'rect.pivot.y', 'rect.rotation', 'rect.scale.x', 'rect.scale.y', 'rect.zIndex'])
  assert.ok(has('Title', p), p);
assert.equal(has('Title', 'rect.zIndex').kind, 'step');
assert.equal(has('Title', 'Image.color').kind, 'color');
assert.equal(has('Logo', 'Image.sprite').kind, 'step');
assert.equal(has('Title', 'Text.size').kind, 'float');
assert.equal(has('Title', 'Text.align').kind, 'step');
assert.equal(has('Title', 'Text.align').options.length, 4);
assert.ok(!has('', 'Animator.clips'));       // lists/events are not animatable
title.components.push({ type: 'component:Card', props: {} }, { type: 'behaviour:Spin', props: {} }, { type: 'Button', props: {} });
const p2 = animatableProps(root, { customs: { Card: { props: { title: { type: 'string', default: '' }, pad: { type: 'vec4', default: [0, 0, 0, 0] } } } }, behaviours: { Spin: { props: { speed: { type: 'number', default: 90 } } } } });
assert.ok(p2.find(p => p.prop === 'component:Card.pad.w' && p.kind === 'float'));
assert.ok(p2.find(p => p.prop === 'behaviour:Spin.speed'));
assert.ok(!p2.find(p => p.prop === 'Button.onClick'));
assert.ok(animatableProps(root).length > 0);  // tolerates missing customs meta
assert.equal(fillNode(title).components[2].props.speed, undefined);

// key insertion + dedupe
const c2 = { fps: 30, tracks: [], events: [] };
setKey(c2, 'A', 'rect.rotation', 0.5, 10);
setKey(c2, 'A', 'rect.rotation', 0, 0, 'ease-in');
const k = setKey(c2, 'A', 'rect.rotation', 0.51, 20);   // same frame -> overwrite
assert.equal(c2.tracks.length, 1);
assert.deepEqual(c2.tracks[0].keys.map(k => [k.t, k.v]), [[0, 0], [0.5, 20]]);
assert.equal(c2.tracks[0].keys[0].ease, 'ease-in');
k.t = 0;                                                 // dragged onto the other key: the moved one wins
dedupeKeys(c2.tracks[0], new Set([k]), 30);
assert.deepEqual(c2.tracks[0].keys.map(k => k.v), [20]);
assert.equal(snapTime(0.512, 30), 0.5);

console.log('anim tests passed');
