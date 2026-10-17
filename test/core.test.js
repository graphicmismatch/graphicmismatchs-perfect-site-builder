// node test/core.test.js
import assert from 'node:assert/strict';
import { rectStyle, rectPixels, reanchor, defaultRect } from '../lib/rect.js';
import { newNode, getProp, setProp, nodeAtPath, setOverride, clearOverride, isOverridden, withOverrides, effectiveTree, activeBreakpoints, componentPath } from '../lib/node.js';
import { renderPage, makeCtx, bind, nodeStyle } from '../lib/render.js';

const rt = o => ({ ...defaultRect(), ...o });

// centered 100x100, pivot center -> left = 50% - 50px
let s = rectStyle(rt({}));
assert.equal(s.left, 'calc(50% - 50px)');
assert.equal(s.width, '100px');
assert.equal(s['transform-origin'], undefined);

// top-left anchor, pivot top-left, pos (10, 20) -> left 10px, top 20px
s = rectStyle(rt({ anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0, 0], pos: [10, 20], size: [30, 40] }));
assert.deepEqual([s.left, s.top, s.width, s.height], ['10px', '20px', '30px', '40px']);
assert.equal(s['transform-origin'], '0% 0%');

// full stretch with 10px insets: offsetMin (10,10) offsetMax (-10,-10) -> size -20, pos 0
s = rectStyle(rt({ anchorMin: [0, 0], anchorMax: [1, 1], size: [-20, -20], pos: [0, 0] }));
assert.deepEqual([s.left, s.width], ['10px', 'calc(100% - 20px)']);

// rotation + scale + pivot
s = rectStyle(rt({ rotation: 45, scale: [2, 1], pivot: [1, 0] }));
assert.equal(s.transform, 'rotate(45deg) scale(2, 1)');
assert.equal(s['transform-origin'], '100% 0%');

// explicit z ordering: 0 / missing = DOM order, otherwise z-index (rounded), also in layouts
assert.equal(rectStyle(rt({}))['z-index'], undefined);
assert.equal(rectStyle({ ...rt({}), zIndex: undefined })['z-index'], undefined);
assert.equal(rectStyle(rt({ zIndex: 3 }))['z-index'], '3');
assert.equal(rectStyle(rt({ zIndex: -1.6 }), true)['z-index'], '-2');

// pixels + reanchor keeps the rect in place
const a = rt({ pos: [30, -10], size: [80, 60] });
const before = rectPixels(a, 800, 600);
const moved = reanchor(a, 800, 600, { anchorMin: [0, 0], anchorMax: [1, 0], pivot: [0, 1] });
assert.deepEqual(rectPixels(moved, 800, 600), before);

// layout children ignore position
s = rectStyle(rt({ pos: [99, 99], size: [50, 20] }), true);
assert.deepEqual([s.position, s.left, s.width], ['relative', undefined, '50px']);

// property paths
const n = newNode('A', [{ type: 'Image', props: { color: '#ff0000' } }]);
setProp(n, 'rect.pos.x', 12); setProp(n, 'Image.color', '#00ff00'); setProp(n, 'rect.scale', [3, 3]);
assert.equal(getProp(n, 'rect.pos.0'), 12);
assert.equal(getProp(n, 'Image.color'), '#00ff00');
assert.equal(getProp(n, 'rect.scale.y'), 3);
assert.equal(setProp(n, 'Text.text', 'x'), false);
n.children.push(newNode('B'));
n.children[0].children.push(newNode('C'));
assert.equal(nodeAtPath(n, 'B/C').name, 'C');

// binding + repeat
const ctx = makeCtx({ json: { 'site.json': { hero: { title: 'Hi' }, posts: [{ t: 'one' }, { t: 'two' }] } } });
assert.equal(bind('{{site.json:hero.title}}!', ctx), 'Hi!');
assert.equal(bind('{{ site.json:posts[1].t }}', ctx), 'two');
assert.equal(bind('{{missing.json:x}}', ctx), '{{missing.json:x}}');
const root = newNode('Canvas', [{ type: 'Canvas', props: {} }]);
const list = newNode('List', [{ type: 'Repeat', props: { source: 'site.json', path: 'posts' } }, { type: 'VerticalLayoutGroup', props: {} }]);
list.children.push(newNode('Item', [{ type: 'Text', props: { text: '{{index}}: {{item.t}}' } }]));
root.children.push(list);
const out = renderPage(root, ctx);
assert.match(out.body, /0: one/);
assert.match(out.body, /1: two/);
assert.match(out.css, /\.item \{\n  position: relative;/);
assert.equal(out.css.match(/\.item \{/g).length, 1);

// indexed component paths
const twin = newNode('Twin', [{ type: 'behaviour:Spin', props: { speed: 1 } }, { type: 'Image', props: {} }, { type: 'behaviour:Spin', props: { speed: 2 } }]);
assert.equal(getProp(twin, 'behaviour:Spin.speed'), 1);
assert.equal(getProp(twin, 'behaviour:Spin[1].speed'), 2);
setProp(twin, 'behaviour:Spin[1].speed', 5);
assert.equal(twin.components[2].props.speed, 5);
assert.equal(componentPath(twin, 2), 'behaviour:Spin[1]');
assert.equal(componentPath(twin, 1), 'Image');

// breakpoint overrides
const bpsT = [{ name: 'Tablet', maxWidth: 1024 }, { name: 'Phone', maxWidth: 600 }];
assert.deepEqual(activeBreakpoints(bpsT, 500), ['Tablet', 'Phone']);
assert.deepEqual(activeBreakpoints(bpsT, 800), ['Tablet']);
assert.deepEqual(activeBreakpoints(bpsT, 1200), []);
const o = newNode('O', [{ type: 'Text', props: { size: 40 } }]);
setOverride(o, 'Phone', 'rect.pos', [5, 6]);
setOverride(o, 'Phone', 'rect.pos.y', 9);           // merged into the wider rect.pos override
assert.deepEqual(o.overrides.Phone, { 'rect.pos': [5, 9] });
setOverride(o, 'Tablet', 'Text.size', 30);
setOverride(o, 'Phone', 'Text.size', 20);
assert.ok(isOverridden(o, 'Phone', 'rect.pos.x') && isOverridden(o, 'Phone', 'rect') && !isOverridden(o, 'Tablet', 'rect.pos'));
assert.equal(withOverrides(o, ['Tablet']).components[0].props.size, 30);
const ph = withOverrides(o, ['Tablet', 'Phone']);
assert.equal(ph.components[0].props.size, 20);
assert.deepEqual(ph.rect.pos, [5, 9]);
assert.equal(o.components[0].props.size, 40);        // base untouched
assert.equal(withOverrides(o, []), o);
clearOverride(o, 'Phone', 'rect.pos.x');
assert.deepEqual(Object.keys(o.overrides.Phone), ['Text.size']);
clearOverride(o, 'Phone'); clearOverride(o, 'Tablet');
assert.equal(o.overrides, undefined);

// effectiveTree shares untouched subtrees; render emits only diffs inside @media
const page = newNode('Canvas', [{ type: 'Canvas', props: {} }]);
const row = newNode('Row', [{ type: 'HorizontalLayoutGroup', props: { spacing: 10 } }]);
const cell = newNode('Cell', [{ type: 'Image', props: {} }]);
const still = newNode('Still', [{ type: 'Image', props: {} }]);
row.children.push(cell); page.children.push(row, still);
setOverride(row, 'Phone', 'HorizontalLayoutGroup.spacing', 2);
setOverride(still, 'Tablet', 'rect.size.x', 50);
const eff = effectiveTree(page, ['Tablet', 'Phone']);
assert.notEqual(eff, page);
assert.equal(eff.children[0].children[0], cell);
const css = renderPage(page, makeCtx({ breakpoints: bpsT })).css;
assert.match(css, /@media \(max-width: 1024px\) \{\n  \.still \{\n    left: calc\(50% - 25px\);\n    width: 50px;\n  \}\n\}/);
assert.match(css, /@media \(max-width: 600px\) \{\n  \.row \{\n    gap: 2px;\n  \}\n\}/);
assert.ok(!/@media[^}]*\.cell/.test(css));
assert.equal(renderPage(page, makeCtx({ breakpoints: [] })).css.includes('@media'), false);

// ---- regressions (bugs.md) ----
const canvasNode = () => newNode('Canvas', [{ type: 'Canvas', props: {} }]);
// reversed layout groups keep their alignment
let pg = canvasNode();
const rev = newNode('Rev', [{ type: 'HorizontalLayoutGroup', props: { reverse: true, childAlignment: 'upper-left' } }]);
assert.deepEqual([nodeStyle(rev, pg, makeCtx())['flex-direction'], nodeStyle(rev, pg, makeCtx())['justify-content']], ['row-reverse', 'flex-end']);
rev.components[0] = { type: 'VerticalLayoutGroup', props: { reverse: true, childAlignment: 'lower-center' } };
assert.deepEqual([nodeStyle(rev, pg, makeCtx())['justify-content'], nodeStyle(rev, pg, makeCtx())['align-items']], ['flex-start', 'center']);
// tinted Button over a sprite: no background box, tint layer masked to the sprite
const sb = newNode('Sb', [{ type: 'Image', props: { sprite: 'img/b.png' } }, { type: 'Button', props: {} }]);
const sbs = nodeStyle(sb, pg, makeCtx());
assert.equal(sbs['background-color'], 'transparent');
assert.equal(sbs['--gpsb-tint'], '#ffffff');
pg.children.push(sb);
const sbCss = renderPage(pg, makeCtx()).css;
assert.match(sbCss, /\.sb::before \{[^}]*mask: var\(--gpsb-sprite\)/);
assert.match(sbCss, /\.sb:hover \{ --gpsb-tint: #f5f5f5 !important; \}/);
assert.ok(!/\.sb:hover \{ background-color/.test(sbCss));
// a font used only in an override still gets @font-face
pg = canvasNode();
const ft = newNode('Ft', [{ type: 'Text', props: {} }]);
setOverride(ft, 'Phone', 'Text.font', 'fonts/X.ttf');
pg.children.push(ft);
assert.match(renderPage(pg, makeCtx()).css, /@font-face \{\n {2}font-family: "gpsb-fonts-x-ttf"/);
// overrides under an empty Repeat: no .undefined rule
pg = canvasNode();
const emptyRep = newNode('List', [{ type: 'Repeat', props: { source: 'none.json' } }]), ghost = newNode('Ghost');
setOverride(ghost, 'Phone', 'rect.size.x', 1);
emptyRep.children.push(ghost); pg.children.push(emptyRep);
assert.ok(!renderPage(pg, makeCtx()).css.includes('.undefined'));
// Style.className is escaped
pg = canvasNode();
pg.children.push(newNode('Cls', [{ type: 'Style', props: { className: 'a" data-x="1' } }]));
assert.ok(renderPage(pg, makeCtx()).body.includes('class="cls a&#34; data-x=&#34;1"'));

// ---- added built-ins ----
pg = canvasNode();
const add = (name, comps) => { const n = newNode(name, comps); pg.children.push(n); return n; };
add('Tog', [{ type: 'Toggle', props: { isOn: false } }]);
add('Sl', [{ type: 'Slider', props: { maxValue: 10, wholeNumbers: true, value: 4 } }]);
add('In', [{ type: 'InputField', props: { text: 'a"<', placeholder: 'p', characterLimit: 3 } }]);
add('Ta', [{ type: 'InputField', props: { lineType: 'multi', text: '<b>' } }]);
add('Dd', [{ type: 'Dropdown', props: { options: ['A', '<B>'], value: 1 } }]);
add('Fr', [{ type: 'IFrame', props: { src: 'about', title: 'T' } }]);
const sect = add('Sect', [{ type: 'Element', props: { tag: 'nav', id: 'top', ariaHidden: true } }]);
const raw = add('Raw', [{ type: 'RawImage', props: { texture: 'img/a.png', uvRect: [0.25, 0, 0.5, 1] } }]);
const asp = add('Asp', [{ type: 'AspectRatioFitter', props: { aspectMode: 'height-controls-width', aspectRatio: 1.5 } }]);
const fx = add('Fx', [{ type: 'Shadow', props: {} }, { type: 'Outline', props: { distance: [2, 3] } }]);
const html = renderPage(pg, makeCtx({ pages: ['about'] })).body;
assert.match(html, /<input type="checkbox" style=/);
assert.match(html, /<input type="range" min="0" max="10" step="1" value="4" style=/);
assert.match(html, /<input type="text" value="a&#34;&#60;" placeholder="p" maxlength="3"/);
assert.match(html, /<textarea style="[^"]*">&#60;b&#62;<\/textarea>/);
assert.match(html, /<option value="0">A<\/option><option value="1" selected>&#60;B&#62;<\/option>/);
assert.match(html, /<iframe src="about.html" title="T" loading="lazy"/);
assert.match(html, /<nav class="sect" data-gpsb="[^"]+" id="top" aria-hidden="true">/);
const rs = nodeStyle(raw, pg, makeCtx());
assert.deepEqual([rs['background-size'], rs['background-position']], ['200% 100%', '50% 0%']);
assert.deepEqual([nodeStyle(asp, pg, makeCtx()).width, nodeStyle(asp, pg, makeCtx())['aspect-ratio']], ['auto', '1.5']);
assert.equal(nodeStyle(fx, pg, makeCtx()).filter.match(/drop-shadow/g).length, 5); // Shadow + 4 Outline copies stack

console.log('core ok');
