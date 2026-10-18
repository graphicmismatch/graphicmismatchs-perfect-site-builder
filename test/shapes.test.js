// Shape and SVG components (lib/shapes.js).
import assert from 'node:assert/strict';
import { cleanSVG, shapeGeometry } from '../lib/shapes.js';
import { renderPage, makeCtx, nodeStyle } from '../lib/render.js';
import { newNode } from '../lib/node.js';

// ---------- cleanSVG ----------
const file = `<?xml version="1.0"?><!DOCTYPE svg><!-- hi -->
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" class="x" onload="alert(1)">
  <defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="c.1"><rect width="1" height="1"/></clipPath></defs>
  <script>alert(2)</script><script src="x.js"/>
  <rect fill="url(#g)" clip-path="url('#c.1')" onclick="alert(3)" width="40" height="20"/>
  <use href="#g"/><use xlink:href="#c.1"/><a href="javascript:alert(4)"><text>t</text></a>
  <foreignObject><div>html</div></foreignObject>
</svg>`;
const out = cleanSVG(file, { prefix: 's-n1', fit: 'cover', title: 'A "logo"' });
assert.match(out, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 40 20" class="gpsb-svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A &#34;logo&#34;">/);
assert.ok(!/<script|onload=|onclick=|javascript:|foreignObject/i.test(out), out);
assert.match(out, /id="s-n1-g"[^]*id="s-n1-c.1"[^]*fill="url\(#s-n1-g\)" clip-path="url\(#s-n1-c.1\)"[^]*<use href="#s-n1-g"\/><use xlink:href="#s-n1-c.1"\/>/);
assert.match(cleanSVG('<svg viewBox="0 0 1 1"><path/></svg>'), /preserveAspectRatio="xMidYMid meet" aria-hidden="true"/);
assert.equal(cleanSVG('<html>not svg</html>'), '');

// ---------- Shape geometry ----------
assert.equal(shapeGeometry({ shape: 'triangle' }), '<polygon points="50,0 100,100 0,100"/>');
const pts = s => shapeGeometry(s).match(/points="([^"]+)"/)[1].split(' ').map(p => p.split(',').map(Number));
const box = ps => [Math.min(...ps.map(p => p[0])), Math.max(...ps.map(p => p[0])), Math.min(...ps.map(p => p[1])), Math.max(...ps.map(p => p[1]))];
assert.equal(pts({ shape: 'polygon', sides: 5 }).length, 5);
assert.deepEqual(box(pts({ shape: 'polygon', sides: 5 })), [0, 100, 0, 100], 'fills the box');
assert.equal(pts({ shape: 'star', points: 6, innerRadius: 0.5 }).length, 12);
assert.equal(pts({ shape: 'polygon', sides: 99 }).length, 24, 'clamped');
assert.match(shapeGeometry({ shape: 'arrow', arrowHead: 0.5, arrowShaft: 0.5 }), /points="0,25 50,25 50,0 100,50 50,100 50,75 0,75"/);
assert.match(shapeGeometry({ shape: 'path', path: 'M0,0 L100,100"/><script>' }), /^<path d="M0,0 L100,100[a-z]*"\/>$/, 'path data only: no quotes or tags get through');

// ---------- rendering ----------
const page = newNode('C', [{ type: 'Canvas', props: {} }]);
const rect = newNode('R', [{ type: 'Shape', props: { shape: 'rectangle', radius: 12, strokeWidth: 2, dash: 4, fill: '$primary' } }]);
const ell = newNode('E', [{ type: 'Shape', props: { shape: 'ellipse', fillType: 'linear', angle: 45 } }]);
const star = newNode('S', [{ type: 'Shape', props: { shape: 'star', fillType: 'linear', angle: 90, strokeWidth: 3 } }]);
const line = newNode('L', [{ type: 'Shape', props: { shape: 'line', strokeWidth: 2, lineCap: 'butt' } }]);
const svg = newNode('V', [{ type: 'SVG', props: { src: 'logo.svg', color: '#ff0000' } }]);
const svg2 = newNode('W', [{ type: 'SVG', props: { code: '<svg viewBox="0 0 2 2"><circle id="a" r="1"/></svg>' } }]);
page.children.push(rect, ell, star, line, svg, svg2);
const ctx = makeCtx({ text: { 'logo.svg': '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>' }, tokens: { colors: { primary: '#123456' } } });
const r = renderPage(page, ctx);
const rs = nodeStyle(rect, page, ctx), es = nodeStyle(ell, page, ctx);
assert.equal(rs['background-color'], 'var(--gpsb-fill)');
assert.equal(rs['--gpsb-fill'], 'var(--gpsb-color-primary)', 'design tokens');
assert.equal(rs.border, 'var(--gpsb-sw) dashed var(--gpsb-stroke)');
assert.equal(rs['border-radius'], '12px');
assert.equal(es['border-radius'], '50%');
assert.equal(es['background-image'], 'linear-gradient(45deg, var(--gpsb-fill), var(--gpsb-fill2))');
assert.ok(!r.body.includes(`data-gpsb="${rect.id}"><svg`), 'rectangles are CSS');
assert.match(r.body, new RegExp(`data-gpsb="${star.id}"><svg class="gpsb-shape" data-k="\\w+" viewBox="0 0 100 100" preserveAspectRatio="none"[^>]*><defs><linearGradient id="gpsb-grad-${star.id}" x1="0.0000" y1="0.5000" x2="1.0000" y2="0.5000">`));
assert.equal(nodeStyle(star, page, ctx)['--gpsb-paint'], `url(#gpsb-grad-${star.id})`);
assert.match(r.css, /\.s > \.gpsb-shape > :not\(defs\) \{ fill: var\(--gpsb-paint\); stroke: var\(--gpsb-stroke\); stroke-width: var\(--gpsb-sw\);[^}]*vector-effect: non-scaling-stroke;/);
assert.match(r.css, /\.l > \.gpsb-shape > :not\(defs\) \{ fill: none;[^}]*stroke-linecap: butt;/);
assert.match(r.body, new RegExp(`data-gpsb="${svg.id}"><svg viewBox="0 0 10 10" class="gpsb-svg" data-k="\\w+" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="M0 0h10v10z"/></svg>`));
assert.match(r.css, /\.v > \.gpsb-svg :is\(path,[^)]*\):not\(\[fill="none"\]\)[^{]*\{ fill: var\(--gpsb-svg-fill\) !important; \}/);
assert.ok(!/\.w > \.gpsb-svg :is/.test(r.css), 'no recolouring when the colour is transparent');
assert.match(r.body, new RegExp(`<circle id="s-${svg2.id}-a" r="1"/>`), 'pasted code, ids made unique');
assert.match(renderPage(Object.assign(newNode('C', [{ type: 'Canvas', props: {} }]), { children: [newNode('X', [{ type: 'SVG', props: { src: 'a.png' } }])] }), makeCtx({ editor: true })).body, /Not an .svg file/);
console.log('shapes ok');
