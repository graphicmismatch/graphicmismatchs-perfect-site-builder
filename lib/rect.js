// RectTransform -> CSS.
// Y is top-down (web convention): anchor/pivot y=0 is the TOP edge, +pos.y moves DOWN.
// Per axis, with parent size P:  start = a0*P + pos - pivot*size,  extent = (a1-a0)*P + size
// (same maths as Unity's anchoredPosition/sizeDelta, so pivot only affects transform-origin).

export const defaultRect = () => ({
  anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5],
  pos: [0, 0], size: [100, 100], rotation: 0, scale: [1, 1],
});

const r = n => Math.round(n * 1000) / 1000;

// calc(frac*100% + off px), simplified
export function lin(frac, off) {
  const f = r(frac * 100), o = r(off);
  if (!f) return `${o}px`;
  if (!o) return `${f}%`;
  return `calc(${f}% ${o < 0 ? '-' : '+'} ${Math.abs(o)}px)`;
}

export function transform(rt) {
  const [sx, sy] = rt.scale ?? [1, 1], rot = rt.rotation ?? 0;
  const t = [];
  if (rot) t.push(`rotate(${r(rot)}deg)`);
  if (sx !== 1 || sy !== 1) t.push(`scale(${r(sx)}, ${r(sy)})`);
  return t.join(' ');
}

// inLayout: parent has a layout group -> position comes from flex/grid, size from rt.size
// (layout groups override width/height further via childStyle).
export function rectStyle(rt, inLayout = false) {
  const s = {};
  if (inLayout) {
    s.position = 'relative';
    s.width = `${r(rt.size[0])}px`;
    s.height = `${r(rt.size[1])}px`;
    s['flex-shrink'] = '0';
  } else {
    s.position = 'absolute';
    for (const i of [0, 1]) {
      const a0 = rt.anchorMin[i], a1 = rt.anchorMax[i], pv = rt.pivot[i];
      s[i ? 'top' : 'left'] = lin(a0, rt.pos[i] - pv * rt.size[i]);
      s[i ? 'height' : 'width'] = lin(a1 - a0, rt.size[i]);
    }
  }
  const [px, py] = rt.pivot;
  if (px !== 0.5 || py !== 0.5) s['transform-origin'] = `${r(px * 100)}% ${r(py * 100)}%`;
  const t = transform(rt);
  if (t) s.transform = t;
  return s;
}

// Pixel rect of a node inside a parent of size [W,H] (editor gizmos / tests).
export function rectPixels(rt, W, H) {
  const P = [W, H], out = [];
  for (const i of [0, 1]) {
    const a0 = rt.anchorMin[i], a1 = rt.anchorMax[i];
    out.push(a0 * P[i] + rt.pos[i] - rt.pivot[i] * rt.size[i], (a1 - a0) * P[i] + rt.size[i]);
  }
  return { x: out[0], w: out[1], y: out[2], h: out[3] };
}

// Change anchors/pivot while keeping the node visually in place (Unity's default behaviour
// when editing anchors in the inspector; Alt-less preset clicks).
export function reanchor(rt, W, H, next) {
  const px = rectPixels(rt, W, H), P = [W, H], o = { ...rt, ...next };
  const start = [px.x, px.y], ext = [px.w, px.h];
  o.size = [0, 1].map(i => ext[i] - (o.anchorMax[i] - o.anchorMin[i]) * P[i]);
  o.pos = [0, 1].map(i => start[i] - o.anchorMin[i] * P[i] + o.pivot[i] * o.size[i]);
  return o;
}
