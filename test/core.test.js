// node test/core.test.js
import assert from 'node:assert/strict';
import { rectStyle, rectPixels, reanchor, defaultRect } from '../lib/rect.js';
import { newNode, getProp, setProp, nodeAtPath, setOverride, clearOverride, isOverridden, withOverrides, effectiveTree, activeBreakpoints, componentPath } from '../lib/node.js';
import { renderPage, renderDocument, makeCtx, bind, nodeStyle, collectionItems } from '../lib/render.js';
import { registerComponent, unregisterComponent, componentDef, isExtension } from '../lib/components.js';

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
// Style css: the node's own declarations, after every other component's (whatever the order), kept inline at runtime
pg = canvasNode();
const so = newNode('So', [{ type: 'Style', props: { css: 'columns: 4; margin: 3px; background: url("a;b.png") /* c */' } }, { type: 'Text', props: {} }]);
so.active = false;
let soStyle = nodeStyle(so, pg, makeCtx());
assert.deepEqual([soStyle.columns, soStyle.margin, soStyle.background, soStyle.display], ['4', '3px', 'url("a;b.png")', 'none']); // Text's margin: 0 loses; inactive still hides
so.active = true;
// breakpoint overrides: css diffs like any declaration, hover/rules are re-emitted in the @media block
setOverride(so, 'Phone', 'Style.css', 'columns: 1;');
setOverride(so, 'Phone', 'Style.hover', 'color: red;');
pg.children.push(so);
const soCss = renderPage(pg, makeCtx({ breakpoints: [{ name: 'Phone', maxWidth: 600 }] })).css;
const soMedia = soCss.slice(soCss.indexOf('@media'));
for (const d of ['columns: 1;', 'margin: 0;', 'background: unset;']) assert.ok(soMedia.includes(d), d);
assert.match(soCss, /@media \(max-width: 600px\) \{[^@]*\.so:hover \{ color: red !important; \}/);
// a font list: each asset gets @font-face, the rest is plain CSS fallback
pg = canvasNode();
pg.children.push(newNode('Fl', [{ type: 'Text', props: { font: 'fonts/A.ttf, fonts/B.otf, monospace' } }]));
const flCss = renderPage(pg, makeCtx()).css;
assert.match(flCss, /font-family: "gpsb-fonts-a-ttf", "gpsb-fonts-b-otf", monospace;/);
assert.match(flCss, /font-family: "gpsb-fonts-b-otf";\n {2}src:/);
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
assert.match(html, /<option value="A">A<\/option><option value="&#60;B&#62;" selected>&#60;B&#62;<\/option>/);
assert.match(html, /<iframe src="about.html" title="T" loading="lazy"/);
assert.match(html, /<nav class="sect" data-gpsb="[^"]+" id="top" aria-hidden="true">/);
const rs = nodeStyle(raw, pg, makeCtx());
assert.deepEqual([rs['background-size'], rs['background-position']], ['200% 100%', '50% 0%']);
assert.deepEqual([nodeStyle(asp, pg, makeCtx()).width, nodeStyle(asp, pg, makeCtx())['aspect-ratio']], ['auto', '1.5']);
assert.equal(nodeStyle(fx, pg, makeCtx()).filter.match(/drop-shadow/g).length, 5); // Shadow + 4 Outline copies stack

// ---- scroll views, toggle groups, masks, forms, page meta ----
pg = canvasNode();
const vp = add('Viewport', [{ type: 'ScrollRect', props: { nativeScrollbars: 'hidden', snap: 'mandatory', snapAlign: 'center', smooth: true } }]);
const vps = nodeStyle(vp, pg, makeCtx());
assert.deepEqual([vps['overflow-y'], vps['scroll-snap-type'], vps['scroll-behavior'], vps['scrollbar-width']], ['auto', 'y mandatory', 'smooth', 'none']);
const bar = add('Bar', [{ type: 'Scrollbar', props: { handle: 'hnd', direction: 'bottomToTop', value: 1, size: 0.25 } }]);
assert.deepEqual([nodeStyle(bar, pg, makeCtx())['--gpsb-bar-start'], nodeStyle(bar, pg, makeCtx())['--gpsb-bar-size']], ['0', '0.25']); // value 1 = top
const msk = add('Msk', [{ type: 'Image', props: { sprite: 'img/m.png' } }, { type: 'Mask', props: { showMaskGraphic: false } }]);
assert.match(nodeStyle(msk, pg, makeCtx()).mask, /var\(--gpsb-sprite\)/);
assert.equal(nodeStyle(add('Plain', [{ type: 'Mask', props: {} }]), pg, makeCtx()).mask, undefined);
assert.equal(nodeStyle(add('R2d', [{ type: 'RectMask2D', props: { padding: [1, 2, 3, 4] } }]), pg, makeCtx())['clip-path'], 'inset(3px 2px 4px 1px)');
add('Radio', [{ type: 'Toggle', props: { group: 'grp1' } }]);
add('Fm', [{ type: 'Form', props: { action: 'https://x.test/f', method: 'post' } }]);
add('Sub', [{ type: 'Button', props: { type: 'submit' } }]);
const page2 = renderPage(pg, makeCtx());
assert.match(page2.css, /\.viewport::-webkit-scrollbar \{ display: none; \}/);
assert.match(page2.css, /\.viewport > \* > \* \{ scroll-snap-align: center; \}/);
assert.match(page2.css, /\.bar \[data-gpsb="hnd"\] \{ top: calc\(var\(--gpsb-bar-start\) \* 100%\) !important; height: calc\(var\(--gpsb-bar-size\) \* 100%\) !important; \}/);
assert.match(page2.css, /\.msk \{ background-image: none !important;/);
assert.match(page2.body, /<input type="radio" name="gpsb-group-grp1" checked/);
assert.match(page2.body, /<form class="fm" data-gpsb="[^"]+" action="https:\/\/x.test\/f" method="post">/);
assert.match(page2.body, /<button class="sub" data-gpsb="[^"]+" type="submit">/);
pg.components.push({ type: 'PageMeta', props: { language: 'de', favicon: 'img/f.png', socialImage: 'img/s.png', url: 'https://site.test/a/' } });
const doc = renderDocument(pg, makeCtx()).html;
assert.match(doc, /<html lang="de">/);
assert.match(doc, /<link rel="icon" href="assets\/img\/f.png">/);
assert.match(doc, /<meta property="og:image" content="https:\/\/site.test\/a\/assets\/img\/s.png">/);
assert.match(doc, /<link rel="canonical" href="https:\/\/site.test\/a\/">/);

// ---- extension components ----
assert.throws(() => registerComponent('Image', {}), /built-in/);
assert.throws(() => registerComponent('bad-name', {}), /invalid/);
registerComponent('Badge', ({ esc }) => ({
  props: { label: { type: 'string', default: 'New' } },
  style: () => ({ 'border-radius': '9px' }),
  inner: p => `<b>${esc(p.label)}</b>`,
  head: p => `<link rel="preconnect" href="https://cdn.test">`,
}));
assert.ok(isExtension('Badge') && componentDef('Badge').category === 'Extensions');
pg = canvasNode();
pg.children.push(newNode('B1', [{ type: 'Badge', props: { label: '<x>' } }]), newNode('B2', [{ type: 'Badge', props: {} }]));
const extDoc = renderDocument(pg, makeCtx({ extensionVersions: { Badge: 'abc' }, inject: { head: '<meta name="h">', bodyEnd: '<script>1</script>' } })).html;
assert.match(extDoc, /<b>&#60;x&#62;<\/b>/);
assert.equal(extDoc.match(/rel="preconnect"/g).length, 1); // head() deduplicated
assert.match(extDoc, /"extensions":\{"Badge":"abc"\}/);
assert.match(extDoc, /<meta name="h">/);
assert.match(extDoc, /<script>1<\/script>/);
assert.ok(!renderDocument(pg, makeCtx({ editor: true, inject: { bodyEnd: '<script>1</script>' } })).html.includes('<script>1</script>')); // not while editing
registerComponent('Badge', { props: {}, inner: () => 'v2' }); // re-registering an extension replaces it (hot reload)
assert.equal(componentDef('Badge').inner(), 'v2');
unregisterComponent('Badge');
assert.equal(componentDef('Badge'), undefined);

// ---- production output: URL prefix, clean URLs, noindex, minify ----
const cx = makeCtx({ pages: ['index', 'about'], cleanUrls: true, prefix: '../' });
assert.deepEqual([cx.href('index'), cx.href('about'), cx.href('about#team'), cx.href('#top'), cx.href('https://x.test/'), cx.asset('img/a b.png')],
  ['../', '../about/', '../about/#team', '#top', 'https://x.test/', '../assets/img/a%20b.png']);
assert.deepEqual([makeCtx({ pages: ['index'], cleanUrls: true }).href('index'), makeCtx({ pages: ['about'] }).href('about#x')], ['./', 'about.html#x']);
pg = canvasNode();
pg.components.push({ type: 'PageMeta', props: { noindex: true } });
pg.children.push(newNode('Box', [{ type: 'Image', props: {} }]), newNode('Txt', [{ type: 'Text', props: { text: 'a\n  b' } }]));
const pretty = renderDocument(pg, makeCtx({ prefix: '../' })).html, mini = renderDocument(pg, makeCtx({ prefix: '../', minify: true }));
assert.match(pretty, /<meta name="robots" content="noindex">/);
assert.match(pretty, /href="\.\.\/gpsb\/base\.css"/);
assert.match(pretty, /src="\.\.\/gpsb\/runtime\.js"/);
assert.match(pretty, /"prefix":"\.\.\/"/);
assert.ok(mini.html.length < pretty.length && !/\n {2}<div/.test(mini.html));
assert.ok(mini.html.includes('a\n  b')); // text content is never touched
assert.match(mini.css, /\.box\{position:absolute;/);

// ---- Image as <img>; animated position via translate ----
pg = canvasNode();
const photo = newNode('Photo', [{ type: 'Image', props: { sprite: 'img/p.jpg', element: 'img', alt: 'A "cat"', fit: 'cover', loading: 'eager' } }]);
pg.children.push(photo);
const imgHtml = renderPage(pg, makeCtx()).body;
assert.match(imgHtml, /<img class="gpsb-img" src="assets\/img\/p\.jpg" alt="A &#34;cat&#34;" loading="eager" decoding="async"[^>]*object-fit:cover;z-index:-1/);
assert.ok(!/role="img"/.test(imgHtml)); // the <img> carries the alt, not the element
assert.deepEqual([nodeStyle(photo, pg, makeCtx())['background-image'], nodeStyle(photo, pg, makeCtx()).isolation], ['none', 'isolate']);
const moving = rt({ anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0, 0], pos: [30, 5], size: [10, 10], rotation: 45 });
moving._layoutPos = [10, 5];
s = rectStyle(moving);
assert.deepEqual([s.left, s.top, s.transform], ['10px', '5px', 'translate(20px, 0px) rotate(45deg)']);
assert.equal(rectStyle(moving, true).transform, 'rotate(45deg)'); // layout children: position comes from the layout

// ---- design tokens ----
const tokens = { colors: { brand: '#ff3366' }, fonts: { heading: 'fonts/H.ttf', body: 'Georgia, serif' }, textStyles: { h1: { font: '$heading', size: 48, weight: '800' } } };
pg = canvasNode();
const tt = newNode('Tt', [{ type: 'Text', props: { color: '$brand', font: '$body', size: 12, textStyle: 'h1' } }]);
const btn = newNode('Bt', [{ type: 'Image', props: { color: '$brand' } }, { type: 'Button', props: { highlighted: '$brand' } }]);
pg.children.push(tt, btn);
const tc = makeCtx({ tokens }), tts = nodeStyle(tt, pg, tc);
assert.deepEqual([tts.color, tts['font-size'], tts['font-weight'], tts['font-family']], ['var(--gpsb-color-brand)', '48px', '800', 'var(--gpsb-font-heading)']);
const tokCss = renderPage(pg, tc).css;
assert.match(tokCss, /^:root \{\n  --gpsb-color-brand: #ff3366;\n  --gpsb-font-heading: "gpsb-fonts-h-ttf", system-ui, sans-serif;\n  --gpsb-font-body: Georgia, serif;\n\}/);
assert.match(tokCss, /@font-face \{\n  font-family: "gpsb-fonts-h-ttf"/); // font token assets get @font-face
assert.match(tokCss, /\.bt:hover \{ background-color: var\(--gpsb-color-brand\) !important; \}/);
assert.match(renderPage(pg, tc).body, /"textStyles"|data-gpsb/); // body renders
assert.deepEqual(renderPage(pg, tc).data.tokens, { textStyles: tokens.textStyles });

// ---- content: max-width column, Markdown, collection pages ----
pg = canvasNode();
const colm = newNode('Col', [{ type: 'VerticalLayoutGroup', props: {} }]), kid = newNode('Kid', [{ type: 'LayoutElement', props: { maxWidth: 720 } }]);
colm.children.push(kid); pg.children.push(colm);
const ks = nodeStyle(kid, colm, makeCtx());
assert.deepEqual([ks['max-width'], ks.width, ks['margin-left'], ks['margin-right']], ['720px', '100%', 'auto', 'auto']);
const json = { 'data/b.json': { posts: [{ title: 'Hello World', body: 'Hi *there*' }, { title: 'Hello World', body: 'x' }, { title: 'Second', tags: ['a', 'b'] }] } };
const tpl = newNode('Canvas', [{ type: 'Canvas', props: { collection: 'data/b.json', collectionPath: 'posts', slugField: 'title', title: '{{item.title}}' } }]);
const mdNode = newNode('Body', [{ type: 'Markdown', props: { text: '# {{item.title}}\n\n{{item.body}} [home](index) [next](post/second)' } }]);
const tags = newNode('Tags', [{ type: 'Repeat', props: { path: 'item.tags' } }]); tags.children.push(newNode('Tag', [{ type: 'Text', props: { text: '{{item}}' } }]));
tpl.children.push(mdNode, tags);
const cctx = makeCtx({ json, pages: ['index', 'post'], collections: ['post'], cleanUrls: true, prefix: '../../' });
const its = collectionItems(tpl, cctx);
assert.deepEqual(its.map(x => x.slug), ['hello-world', 'hello-world-2', 'second']);
const d0 = renderDocument(tpl, cctx, { name: 'hello-world', scope: { item: its[0].item, index: 0 } });
assert.match(d0.html, /<title>Hello World<\/title>/);
assert.match(d0.html, /<div class="gpsb-md"><h1 id="hello-world">Hello World<\/h1>\n<p>Hi <em>there<\/em> <a href="\.\.\/\.\.\/">home<\/a> <a href="\.\.\/\.\.\/post\/second\/">next<\/a><\/p><\/div>/);
const d2 = renderDocument(tpl, cctx, { name: 'second', scope: { item: its[2].item, index: 2 } }).html;
assert.equal((d2.match(/class="gpsb-text">[ab]</g) ?? []).length, 2); // Repeat over an array of the item
assert.equal(collectionItems(canvasNode(), cctx), null);

// build: project.json `keep` paths survive rebuilds (`x/` a folder, `x` a file, nested ok), everything else is cleared;
// kept paths may sit in an otherwise empty output folder
{
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { build, create } = await import('../cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpsb-keep-')), out = path.join(dir, 'out'), o = (...p) => path.join(out, ...p);
  await create(dir);
  fs.mkdirSync(o('.git'), { recursive: true });
  const setKeep = keep => fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ name: 'k', keep }));
  setKeep(['.git']); // a file entry doesn't match the folder
  await assert.rejects(build(dir, out), /not empty/);
  setKeep(['.git/', 'CNAME', 'docs/notes.txt', 'docs/']);
  await build(dir, out);
  fs.writeFileSync(o('CNAME'), 'x');
  fs.mkdirSync(o('docs'));
  fs.writeFileSync(o('stray.txt'), '');
  setKeep(['.git/', 'CNAME', 'assets/notes.txt', 'docs']); // `docs` is a file entry now: the docs/ folder goes
  fs.writeFileSync(o('assets', 'notes.txt'), 'n');
  fs.writeFileSync(o('assets', 'other.txt'), '');
  await build(dir, out);
  const has = p => fs.existsSync(o(p));
  assert.deepEqual(['.git', 'CNAME', 'assets/notes.txt', 'index.html', 'stray.txt', 'docs', 'assets/other.txt'].map(has), [true, true, true, true, false, false, false]);
  fs.rmSync(dir, { recursive: true, force: true });
}
// drivenBy: values another piece overrides, so editing them changes nothing
{
  const { drivenBy } = await import('../lib/render.js');
  const ctx = makeCtx({ tokens: { textStyles: { h1: { size: 40 } } } }), row = canvasNode();
  row.components.push({ type: 'VerticalLayoutGroup', props: { controlWidth: true } });
  const t = newNode('T', [{ type: 'Text', props: { size: 16 } }, { type: 'ContentSizeFitter', props: { vertical: 'preferred' } }, { type: 'Style', props: { css: 'font-size: 2rem;' } }]);
  const by = p => drivenBy(t, row, ctx, p);
  assert.deepEqual(by('Text.size'), [{ type: 'Style', parent: false }]);
  assert.deepEqual(by('rect.size.y'), [{ type: 'ContentSizeFitter', parent: false }]);
  assert.deepEqual(by('rect.size.x'), [{ type: 'VerticalLayoutGroup', parent: true }]);
  assert.deepEqual(by('rect.pos.x'), [{ type: 'VerticalLayoutGroup', parent: true }]); // positioned by the layout group
  assert.equal(by('Text.lineHeight'), null); // still has an effect
  t.components[2].props.css += ' letter-spacing: 1px;';
  assert.deepEqual(by('Text.letterSpacing'), [{ type: 'Style', parent: false }]); // unset: judged at its default
  assert.equal(drivenBy(t, null, ctx, 'Text.size') && 1, 1);
  t.components[2].props.css = '';
  assert.equal(by('Text.size'), null);
  t.components[0].props.textStyle = 'h1';
  assert.deepEqual(by('Text.size'), [{ textStyle: 'h1' }]);
  const free = newNode('F', [{ type: 'Text', props: {} }]);
  assert.equal(drivenBy(free, canvasNode(), ctx, 'rect.size.x'), null);
  assert.equal(drivenBy(free, canvasNode(), ctx, 'rect.pos.y'), null);
}
// rich text links: a page name resolves to its URL (nested pages and #anchors too), URLs stay as written
{
  pg = canvasNode();
  pg.children.push(newNode('Rt', [{ type: 'Text', props: { text: '<a href="about">A</a> <a href=\'blog/post#top\'>B</a> <a href="https://x.y/about">C</a> <b>about</b>' } }]));
  const body = renderPage(pg, makeCtx({ pages: ['about', 'blog/post'] })).body;
  assert.ok(body.includes('<a href="about.html">A</a> <a href=\'blog/post.html#top\'>B</a> <a href="https://x.y/about">C</a> <b>about</b>'), body);
}
// forms: Netlify markup, honeypot names per service, Captcha script + widget, validation attributes
{
  const pg = newNode('C', [{ type: 'Canvas', props: {} }]);
  const f = newNode('F', [{ type: 'Form', props: { provider: 'netlify', formId: 'quote' } }]);
  f.children.push(newNode('E', [{ type: 'InputField', props: { name: 'email', contentType: 'email', required: true, pattern: '.+@.+', minLength: 5, autocomplete: 'email' } }]),
    newNode('Cap', [{ type: 'Captcha', props: { siteKey: 'k"1' } }]));
  pg.children.push(f, newNode('G', [{ type: 'Form', props: { provider: 'formspree', formId: 'abc', honeypot: true } }]));
  const r = renderPage(pg, makeCtx({}));
  assert.match(r.body, /<form class="f" data-gpsb="[^"]+" method="post" name="quote" data-netlify="true" netlify-honeypot="bot-field"><input type="hidden" name="form-name" value="quote"><input class="gpsb-hp" type="text" name="bot-field"/);
  assert.match(r.body, /<input type="email" value="" name="email" minlength="5" pattern="\.\+@\.\+" autocomplete="email" required/);
  assert.match(r.body, /<div class="cf-turnstile" data-sitekey="k&#34;1" data-theme="auto"><\/div>/);
  assert.deepEqual(r.heads, ['<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>']);
  assert.match(r.body, /name="_gotcha"/, 'Formspree honeypot');
  assert.equal(typeof componentDef('Form').methods.submit, 'function');
}
console.log('core ok');
