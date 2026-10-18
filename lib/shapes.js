// Vector graphics (merged into the registry by components.js):
//   Shape  rectangle, ellipse, triangle, polygon, star, arrow, line or a custom path, with a solid or gradient fill
//          and an outline. Rectangle and ellipse are plain CSS; the others an inline SVG stretched over the rect, with
//          outlines kept at their pixel width (vector-effect: non-scaling-stroke).
//   SVG    an SVG file (or pasted SVG code) written into the page as markup, so it can be recoloured, styled and
//          animated: scripts and event handlers are removed, ids are made unique per object.
// Colours and widths are CSS variables set by style(), so animation, breakpoints and scripts can change them without
// re-rendering; only geometry changes re-render the markup (patch).

const POINTS = 100; // shapes are drawn in a 0..100 box
// a short hash of what the markup was made from (data-k), so patch() knows when the props no longer match it
const hash = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
// a point list scaled to fill the box (a regular pentagon doesn't touch every side on its own)
const fitPoints = pts => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
  const sx = POINTS / (Math.max(...xs) - x0 || 1), sy = POINTS / (Math.max(...ys) - y0 || 1);
  return pts.map(([x, y]) => `${+((x - x0) * sx).toFixed(3)},${+((y - y0) * sy).toFixed(3)}`).join(' ');
};
const around = (n, r = () => 1) => Array.from({ length: n }, (_, i) => { const a = (-90 + (i * 360) / n) * Math.PI / 180; return [Math.cos(a) * r(i), Math.sin(a) * r(i)]; });
const clampN = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
export const shapeGeometry = p => {
  switch (p.shape) {
    case 'triangle': return `<polygon points="50,0 100,100 0,100"/>`;
    case 'polygon': return `<polygon points="${fitPoints(around(clampN(p.sides, 3, 24, 6) | 0))}"/>`;
    case 'star': { const n = clampN(p.points, 3, 24, 5) | 0, k = clampN(p.innerRadius, 0.05, 0.95, 0.45); return `<polygon points="${fitPoints(around(n * 2, i => (i % 2 ? k : 1)))}"/>`; }
    case 'arrow': {
      const h = clampN(p.arrowHead, 0.05, 0.95, 0.4) * 100, t = clampN(p.arrowShaft, 0.05, 1, 0.4) * 50;
      return `<polygon points="0,${50 - t} ${100 - h},${50 - t} ${100 - h},0 100,50 ${100 - h},100 ${100 - h},${50 + t} 0,${50 + t}"/>`;
    }
    case 'line': return '<line x1="0" y1="50" x2="100" y2="50"/>';
    case 'path': return `<path d="${String(p.path ?? '').replace(/[^\d\s.,+\-eMmLlHhVvCcSsQqTtAaZz]/g, '')}"/>`;
    default: return '';
  }
};
const CSS_SHAPES = new Set(['rectangle', 'ellipse']);
// CSS linear-gradient angles (0 = to top, 90 = to right) as an SVG gradient vector in the box
const gradVector = deg => { const a = (deg * Math.PI) / 180, s = Math.sin(a) / 2, c = Math.cos(a) / 2; return `x1="${(0.5 - s).toFixed(4)}" y1="${(0.5 + c).toFixed(4)}" x2="${(0.5 + s).toFixed(4)}" y2="${(0.5 - c).toFixed(4)}"`; };
const gradId = node => `gpsb-grad-${node?.id ?? 'x'}`;
const shapeSVG = (p, node) => {
  const id = gradId(node), stops = '<stop offset="0" style="stop-color:var(--gpsb-fill)"/><stop offset="1" style="stop-color:var(--gpsb-fill2)"/>';
  const grad = p.fillType === 'linear' ? `<defs><linearGradient id="${id}" ${gradVector(+p.angle || 0)}>${stops}</linearGradient></defs>`
    : p.fillType === 'radial' ? `<defs><radialGradient id="${id}">${stops}</radialGradient></defs>` : '';
  return `<svg class="gpsb-shape" data-k="${geoKey(p)}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${grad}${shapeGeometry(p)}</svg>`;
};
const geoKey = p => hash(JSON.stringify([p.shape, p.sides, p.points, p.innerRadius, p.arrowHead, p.arrowShaft, p.path, p.fillType, p.angle]));

// ---------- SVG markup ----------
// The <svg> element of a file, made safe and sized to its object. prefix makes its ids unique (several on a page).
export function cleanSVG(src, { prefix = 'svg', fit = 'contain', title = '', key = '' } = {}) {
  let s = String(src ?? '').replace(/<\?xml[^]*?\?>|<!DOCTYPE[^>[]*(\[[^]*?\])?>|<!--[^]*?-->/gi, '');
  const m = /<svg\b[^]*<\/svg>/i.exec(s);
  if (!m) return '';
  s = m[0]
    .replace(/<script\b[^]*?<\/script\s*>|<script\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[^]*?<\/foreignObject\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#');
  // unique ids, and every reference to them
  const ids = [...s.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map(x => x[1]);
  for (const id of new Set(ids)) {
    const e = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), to = `${prefix}-${id}`;
    s = s.replace(new RegExp(`(\\sid\\s*=\\s*["'])${e}(["'])`, 'g'), `$1${to}$2`)
      .replace(new RegExp(`url\\(\\s*(['"]?)#${e}\\1\\s*\\)`, 'g'), `url(#${to})`)
      .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*["'])#${e}(["'])`, 'g'), `$1#${to}$2`);
  }
  // the root: a viewBox (from width / height if it has none), sized by CSS, aligned by fit
  s = s.replace(/^<svg\b([^>]*)>/i, (_, attrs) => {
    const num = k => parseFloat(new RegExp(`\\s${k}\\s*=\\s*["']?([\\d.]+)`, 'i').exec(attrs)?.[1]);
    let a = attrs.replace(/\s(width|height|preserveAspectRatio|class)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    if (!/\sviewBox\s*=/i.test(a) && num('width') && num('height')) a += ` viewBox="0 0 ${num('width')} ${num('height')}"`;
    const par = { contain: 'xMidYMid meet', cover: 'xMidYMid slice', fill: 'none' }[fit] ?? 'xMidYMid meet';
    return `<svg${a} class="gpsb-svg"${key ? ` data-k="${key}"` : ''} preserveAspectRatio="${par}"${title ? ` role="img" aria-label="${title.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)}"` : ' aria-hidden="true"'}>`;
  });
  return s;
}

export default () => {
  const svgText = (p, ctx) => (p.code?.trim() ? p.code : p.src ? ctx?.text?.[p.src] : '') ?? '';
  const svgKey = p => hash(JSON.stringify([p.src, p.code, p.fit, p.title]));
  const svgHTML = (p, ctx, id, text = svgText(p, ctx)) => cleanSVG(text, { prefix: `s-${id ?? 'x'}`, fit: p.fit, title: p.title, key: svgKey(p) });
  const placeholder = (p, ctx) => (ctx?.editor ? `<div class="gpsb-svg-empty" data-k="${svgKey(p)}">${p.src && !/\.svg$/i.test(p.src) ? 'Not an .svg file' : 'SVG: pick an .svg file or paste SVG code'}</div>` : '');
  return {
    Shape: {
      category: 'UI',
      props: {
        shape: { type: 'enum', options: ['rectangle', 'ellipse', 'triangle', 'polygon', 'star', 'arrow', 'line', 'path'], default: 'rectangle' },
        fill: { type: 'color', default: '#3366ff', when: p => p.shape !== 'line' },
        fillType: { type: 'enum', options: ['solid', 'linear', 'radial'], default: 'solid', help: 'a gradient from Fill to Fill 2', when: p => p.shape !== 'line' },
        fill2: { type: 'color', default: '#9b5cff', help: 'gradient end colour', when: p => p.fillType !== 'solid' },
        angle: { type: 'number', default: 90, min: 0, max: 360, help: 'linear gradient direction (degrees, 90 = left to right)', when: p => p.fillType === 'linear' },
        stroke: { type: 'color', default: '#1a1a1a', help: 'outline colour' },
        strokeWidth: { type: 'number', default: 0, min: 0, max: 40, step: 0.5, help: 'outline width (px); 0 = none. Lines need one.' },
        dash: { type: 'number', default: 0, min: 0, max: 40, help: 'dashed outline: dash length (px); 0 = solid' },
        radius: { type: 'number', default: 0, help: 'rectangle: corner radius (px)', when: p => p.shape === 'rectangle' },
        sides: { type: 'int', default: 6, min: 3, max: 24, help: 'polygon', when: p => p.shape === 'polygon' },
        points: { type: 'int', default: 5, min: 3, max: 24, help: 'star', when: p => p.shape === 'star' },
        innerRadius: { type: 'number', default: 0.45, min: 0.05, max: 0.95, step: 0.05, help: 'star: inner points, as a share of the outer ones', when: p => p.shape === 'star' },
        arrowHead: { type: 'number', default: 0.4, min: 0.05, max: 0.95, step: 0.05, help: 'arrow: head length, as a share of the width', when: p => p.shape === 'arrow' },
        arrowShaft: { type: 'number', default: 0.4, min: 0.05, max: 1, step: 0.05, help: 'arrow: shaft thickness, as a share of the height', when: p => p.shape === 'arrow' },
        lineCap: { type: 'enum', options: ['round', 'butt', 'square'], default: 'round', help: 'line and outline ends', when: p => !['rectangle', 'ellipse'].includes(p.shape) },
        path: { type: 'string', default: 'M0,100 C20,0 80,0 100,100 Z', help: 'path: SVG path data in a 100 × 100 box (stretched to the object)', when: p => p.shape === 'path' },
      },
      style: (p, ctx, node) => {
        const s = { '--gpsb-fill': p.fill, '--gpsb-fill2': p.fill2, '--gpsb-stroke': p.stroke, '--gpsb-sw': `${+p.strokeWidth || 0}px` };
        if (!CSS_SHAPES.has(p.shape)) return { ...s, '--gpsb-paint': p.fillType === 'solid' ? 'var(--gpsb-fill)' : `url(#${gradId(node)})`, '--gpsb-dash': +p.dash > 0 ? `${+p.dash}px ${+p.dash}px` : 'none' };
        const bg = p.fillType === 'linear' ? `linear-gradient(${+p.angle || 0}deg, var(--gpsb-fill), var(--gpsb-fill2))` : p.fillType === 'radial' ? 'radial-gradient(closest-side, var(--gpsb-fill), var(--gpsb-fill2))' : null;
        return { ...s, ...(bg ? { 'background-image': bg, 'background-color': 'transparent' } : { 'background-color': 'var(--gpsb-fill)', 'background-image': 'none' }),
          border: +p.strokeWidth > 0 ? `var(--gpsb-sw) ${+p.dash > 0 ? 'dashed' : 'solid'} var(--gpsb-stroke)` : 'none',
          'border-radius': p.shape === 'ellipse' ? '50%' : `${+p.radius || 0}px` };
      },
      inner: (p, ctx, node) => (CSS_SHAPES.has(p.shape) ? '' : shapeSVG(p, node)),
      rules: (p, sel) => (CSS_SHAPES.has(p.shape) ? '' : `${sel} > .gpsb-shape { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
${sel} > .gpsb-shape > :not(defs) { fill: ${p.shape === 'line' ? 'none' : 'var(--gpsb-paint)'}; stroke: var(--gpsb-stroke); stroke-width: var(--gpsb-sw); stroke-dasharray: var(--gpsb-dash); stroke-linecap: ${p.lineCap}; stroke-linejoin: round; vector-effect: non-scaling-stroke; }`),
      patch(el, p) { // geometry changed (or the shape went between CSS and SVG): new markup
        const cur = el.querySelector(':scope > .gpsb-shape'), want = CSS_SHAPES.has(p.shape) ? null : geoKey(p);
        if ((cur?.dataset.k ?? null) === want) return;
        cur?.remove();
        if (want) el.insertAdjacentHTML('afterbegin', shapeSVG(p, { id: el.dataset.gpsb }));
      },
    },
    SVG: {
      category: 'UI',
      props: {
        src: { type: 'asset:image', default: '', help: 'an .svg file from assets/' },
        code: { type: 'code', lang: 'html', default: '', help: 'or paste SVG markup here (used instead of the file)' },
        fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain' },
        color: { type: 'color', default: '#00000000', help: 'recolour: every filled part in this colour (transparent = the original colours)' },
        strokeColor: { type: 'color', default: '#00000000', help: 'recolour every outline (transparent = the original)' },
        title: { type: 'string', default: '', help: 'what it shows, for screen readers (empty = decorative)' },
      },
      style: p => ({ '--gpsb-svg-fill': p.color, '--gpsb-svg-stroke': p.strokeColor }),
      inner: (p, ctx, node) => svgHTML(p, ctx, node?.id) || placeholder(p, ctx),
      // recolouring: only when a colour is set (an alpha of 00 keeps the file's own colours)
      rules: (p, sel) => [`${sel} > .gpsb-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; }`,
        `${sel} > .gpsb-svg-empty { height: 100%; display: grid; place-items: center; padding: 8px; text-align: center; border: 2px dashed #0003; color: #0008; font: 12px system-ui, sans-serif; }`,
        // (!important: SVG files often colour their parts with style="fill: …")
        !/^#[0-9a-f]{6}00$/i.test(p.color) && `${sel} > .gpsb-svg :is(path, rect, circle, ellipse, polygon, polyline, line, text, tspan, use):not([fill="none"]):not([style*="fill:none"]):not([style*="fill: none"]) { fill: var(--gpsb-svg-fill) !important; }`,
        !/^#[0-9a-f]{6}00$/i.test(p.strokeColor) && `${sel} > .gpsb-svg :is([stroke], [style*="stroke"]):not([stroke="none"]):not([style*="stroke:none"]):not([style*="stroke: none"]) { stroke: var(--gpsb-svg-stroke) !important; }`].filter(Boolean).join('\n'),
      patch(el, p, ctx) { // a new file or code at runtime (animation, scripts): fetched if the page doesn't have it
        const key = svgKey(p), cur = el.querySelector(':scope > .gpsb-svg, :scope > .gpsb-svg-empty');
        if (cur?.dataset.k === key || el.gpsbSvgWant === key) return;
        el.gpsbSvgWant = key;
        const put = text => { if (el.gpsbSvgWant !== key) return; el.querySelector(':scope > .gpsb-svg, :scope > .gpsb-svg-empty')?.remove(); el.insertAdjacentHTML('afterbegin', svgHTML(p, ctx, el.dataset.gpsb, text) || placeholder(p, ctx)); };
        const t = svgText(p, ctx);
        if (t || !p.src) put(t);
        else fetch(ctx.asset(p.src)).then(r => (r.ok ? r.text() : '')).then(put, () => {});
      },
    },
  };
};
