// node test/prefab.test.js
import { expandPrefabs, collapsePrefabs, overrideKey, bakeInstance, unpackInstance } from '../lib/prefab.js';
import assert from 'node:assert/strict';
const N = (id, name, comps = [], kids = []) => ({ id, name, active: true, rect: { pos: [0, 0] }, components: comps, children: kids });
const prefabs = {
  Badge: N('b0', 'Badge', [{ type: 'Image', props: { color: '#111111' } }], [N('bt', 'Label', [{ type: 'Text', props: { text: 'NEW' } }])]),
  Card: N('c0', 'Card', [{ type: 'Image', props: {} }], [
    N('ti', 'Title', [{ type: 'Text', props: { text: 'Title' } }]),
    N('bn', 'Btn', [{ type: 'Button', props: { onClick: [{ target: 'ti', call: 'setActive', arg: 'toggle' }] } }]),
    { id: 'bd', name: 'Badge', active: true, rect: { pos: [5, 5] }, prefab: 'Badge', prefabOverrides: { 'bt|Text.text': 'HOT' } },
  ]),
};
const page = N('root', 'Canvas', [], [{ id: 'i1', name: 'My Card', active: true, rect: { pos: [100, 0] }, prefab: 'Card',
  prefabOverrides: { 'ti|Text.text': 'Hello', 'bd-bt|Text.text': 'SALE', '|Image.color': '#ff0000', 'ti|@Phone|Text.size': 12 } }]);
const stored = structuredClone(page);
expandPrefabs(page, prefabs);
const inst = page.children[0], ids = n => [n.id, ...(n.children ?? []).flatMap(ids)];
assert.deepEqual(ids(inst), ['i1', 'i1-ti', 'i1-bn', 'i1-bd', 'i1-bd-bt']);
assert.equal(inst.children[0].components[0].props.text, 'Hello');
assert.equal(inst.children[2].children[0].components[0].props.text, 'SALE');      // outer override into nested instance
assert.equal(inst.components[0].props.color, '#ff0000');
assert.equal(inst.children[1].components[0].props.onClick[0].target, 'i1-ti');      // internal reference followed
assert.deepEqual(inst.children[0].overrides, { Phone: { 'Text.size': 12 } });
assert.deepEqual(inst.rect.pos, [100, 0]);                                           // instance-owned
assert.ok([inst.children[0], inst.children[2], inst.children[2].children[0]].every(x => x._inst === 'i1'));
assert.deepEqual(collapsePrefabs(page), stored);                                     // round trip
assert.equal(overrideKey('i1', 'i1-bd-bt', 'Text.text'), 'bd-bt|Text.text');
assert.equal(overrideKey('i1', 'i1', 'Image.color', 'Phone'), '|@Phone|Image.color');
// bake: the prefab now holds the instance's look; nested overrides move to the nested instance
const baked = bakeInstance(structuredClone(inst), prefabs.Card);
assert.equal(baked.id, 'c0'); assert.deepEqual(baked.rect, prefabs.Card.rect);
assert.equal(baked.children[0].components[0].props.text, 'Hello');
assert.equal(baked.children[1].components[0].props.onClick[0].target, 'ti');
assert.deepEqual(baked.children[2].prefabOverrides, { 'bt|Text.text': 'SALE' });
assert.equal(baked.children[2].children, undefined);
// re-expanding with the baked prefab and no overrides gives the same content
const p2 = { ...prefabs, Card: baked }, again = expandPrefabs({ ...structuredClone(stored), children: [{ ...stored.children[0], prefabOverrides: {} }] }, p2);
assert.equal(again.children[0].children[2].children[0].components[0].props.text, 'SALE');
// cycles / missing
const cyc = expandPrefabs(N('r', 'r', [], [{ id: 'x', name: 'x', rect: {}, prefab: 'Loop' }]), { Loop: N('l', 'l', [], [{ id: 'y', name: 'y', rect: {}, prefab: 'Loop' }]) });
assert.equal(cyc.children[0].children[0]._missing, 'cycle');
assert.equal(expandPrefabs(N('r', 'r', [], [{ id: 'x', name: 'x', rect: {}, prefab: 'Nope' }]), {}).children[0]._missing, 'missing');
unpackInstance(inst); assert.ok(!inst.prefab && !inst.children[2].prefab && !inst.children[0]._inst);
console.log('prefab ok');
