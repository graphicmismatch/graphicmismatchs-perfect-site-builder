// Crop & Focus window (Inspector ▸ Image ▸ Crop & Focus…): drag a crop rectangle over the picture and a focal point.
// Applying a crop writes a new image asset next to the original (cut with a canvas, so it works in every browser and
// the page downloads only what shows); the original and the rectangle are kept (Image.cropSource / crop), so the crop
// can be changed or undone later. The focal point is Image.focus (CSS object-position).
import * as S from './state.js';
import { h } from './fields.js';
import { componentPath } from '/lib/node.js';

const RATIOS = [['Free', 0], ['Original', -1], ['This object', -2], ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['3:4', 3 / 4], ['2:3', 2 / 3], ['9:16', 9 / 16]];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
let win = null;

export async function openCropper(id, ci) {
  win?.close();
  const n = S.node(id), cp = componentPath(n, ci), p = S.propsOf(S.view(id).components[ci]);
  const src = p.cropSource || p.sprite;
  if (!src) return S.log('Set the Image\'s Sprite first, then crop it', 'warn');
  if (/\{\{/.test(src)) return S.log('This picture comes from data ({{…}}): crop the image file itself', 'warn');
  const img = new Image();
  img.src = S.assetUrl(src);
  try { await img.decode(); } catch { return S.log(`Could not load ${src}`, 'error'); }
  const W = img.naturalWidth || 1200, H = img.naturalHeight || 800;
  // state, in fractions of the original: crop [x, y, w, h], focus [x, y] (in the original)
  const c0 = p.cropSource ? [...p.crop] : [0, 0, 1, 1];
  let crop = [...c0], ratio = 0;
  let focus = [c0[0] + p.focus[0] * c0[2], c0[1] + p.focus[1] * c0[3]];
  const el = S.S.previewWin?.GPSB?.el(id), objAspect = el?.offsetWidth && el?.offsetHeight ? el.offsetWidth / el.offsetHeight : 0;

  // ---------- window ----------
  const pic = h('img', { class: 'cr-img', src: img.src, alt: '', draggable: 'false' });
  const box = h('div', { class: 'cr-box' }, ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(k => h('i', { class: `cr-h ${k}`, 'data-h': k })));
  const dot = h('div', { class: 'cr-dot', title: 'Focal point: drag it onto what must stay in view' });
  const stage = h('div', { class: 'cr-stage' }, pic, box, dot);
  const ratios = h('select', { class: 'prefs-in' }, ...RATIOS.filter(([, r]) => r !== -2 || objAspect).map(([l, r]) => h('option', { value: r }, l)));
  const info = h('span', { class: 'cr-info' });
  const ov = h('div', { class: 'prefs-overlay' },
    h('div', { class: 'prefs-win cr-win', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Crop and focus' },
      h('header', {}, h('b', {}, `Crop & Focus · ${src.split('/').pop()}`), h('button', { class: 'prefs-x', title: 'Close (Esc)', onclick: () => close() }, '✕')),
      h('div', { class: 'cr-bar' }, h('label', {}, 'Aspect ', ratios), info, h('span', { class: 'cr-grow' }),
        h('span', { class: 'cr-hint' }, 'Drag the frame to crop · drag the dot to set the focal point')),
      stage,
      h('footer', { class: 'cr-foot' },
        h('button', { class: 'btn', onclick: () => { crop = [0, 0, 1, 1]; focus = [0.5, 0.5]; ratios.value = '0'; ratio = 0; draw(); } }, 'Reset'),
        h('span', { class: 'cr-grow' }),
        h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => apply() }, 'Apply'))));
  document.body.append(ov);
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter') { e.preventDefault(); apply(); } e.stopPropagation(); };
  const close = () => { removeEventListener('keydown', onKey, true); ov.remove(); win = null; };
  addEventListener('keydown', onKey, true);
  win = { close };

  // the picture fitted into the stage; fractions <-> stage pixels
  let fit = { x: 0, y: 0, w: 1, h: 1 };
  const layout = () => {
    const r = stage.getBoundingClientRect(), s = Math.min((r.width - 32) / W, (r.height - 32) / H);
    fit = { w: W * s, h: H * s, x: (r.width - W * s) / 2, y: (r.height - H * s) / 2 };
    Object.assign(pic.style, { left: fit.x + 'px', top: fit.y + 'px', width: fit.w + 'px', height: fit.h + 'px' });
  };
  const draw = () => {
    const [x, y, w, hh] = crop;
    Object.assign(box.style, { left: fit.x + x * fit.w + 'px', top: fit.y + y * fit.h + 'px', width: w * fit.w + 'px', height: hh * fit.h + 'px' });
    focus = [clamp(focus[0], x, x + w), clamp(focus[1], y, y + hh)];
    Object.assign(dot.style, { left: fit.x + focus[0] * fit.w + 'px', top: fit.y + focus[1] * fit.h + 'px' });
    info.textContent = `${Math.round(w * W)} × ${Math.round(hh * H)} px`;
  };
  // keep the crop at the chosen aspect (in pixels), around its centre, inside the picture
  const constrain = (anchor = 'c') => {
    if (!ratio) return;
    let [x, y, w, hh] = crop;
    const cx = x + w / 2, cy = y + hh / 2, want = ratio * H / W; // w / h in fractions
    if (w / hh > want) w = hh * want; else hh = w / want;
    if (w > 1) { w = 1; hh = w / want; } if (hh > 1) { hh = 1; w = hh * want; }
    if (anchor === 'c') { x = cx - w / 2; y = cy - hh / 2; }
    crop = [clamp(x, 0, 1 - w), clamp(y, 0, 1 - hh), w, hh];
  };
  ratios.onchange = () => {
    const r = +ratios.value;
    ratio = r === -1 ? W / H : r === -2 ? objAspect : r;
    if (ratio) { crop = [0, 0, 1, 1]; constrain(); }
    draw();
  };

  // ---------- dragging ----------
  stage.addEventListener('pointerdown', e => {
    const k = e.target === dot ? 'dot' : e.target.dataset.h ?? (e.target === box ? 'move' : null);
    if (!k) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const c = [...crop], f0 = [...focus];
    const mv = ev => {
      const dx = (ev.clientX - e.clientX) / fit.w, dy = (ev.clientY - e.clientY) / fit.h;
      if (k === 'dot') { focus = [clamp(f0[0] + dx, 0, 1), clamp(f0[1] + dy, 0, 1)]; return draw(); }
      if (k === 'move') { crop = [clamp(c[0] + dx, 0, 1 - c[2]), clamp(c[1] + dy, 0, 1 - c[3]), c[2], c[3]]; focus = [f0[0] + crop[0] - c[0], f0[1] + crop[1] - c[1]]; return draw(); }
      let [x0, y0, x1, y1] = [c[0], c[1], c[0] + c[2], c[1] + c[3]];
      const MIN = 16 / Math.min(fit.w, fit.h);
      if (k.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN);
      if (k.includes('e')) x1 = clamp(x1 + dx, x0 + MIN, 1);
      if (k.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN);
      if (k.includes('s')) y1 = clamp(y1 + dy, y0 + MIN, 1);
      crop = [x0, y0, x1 - x0, y1 - y0];
      if (ratio) { // the dragged edge leads; the other side follows
        const want = ratio * H / W;
        if (k === 'n' || k === 's') crop[2] = Math.min(crop[3] * want, k.includes('w') ? x1 : 1 - x0);
        else crop[3] = Math.min(crop[2] / want, 1 - y0);
        if (k.includes('w')) crop[0] = x1 - crop[2];
        if (k.includes('n')) crop[1] = y1 - crop[3];
        constrain('keep');
      }
      draw();
    };
    const upH = () => { stage.removeEventListener('pointermove', mv); stage.removeEventListener('pointerup', upH); };
    stage.addEventListener('pointermove', mv);
    stage.addEventListener('pointerup', upH);
  });
  new ResizeObserver(() => { layout(); draw(); }).observe(stage);
  layout(); draw();

  // ---------- apply ----------
  async function apply() {
    const full = crop.every((v, i) => Math.abs(v - [0, 0, 1, 1][i]) < 0.002);
    const f = [+((focus[0] - crop[0]) / crop[2]).toFixed(4), +((focus[1] - crop[1]) / crop[3]).toFixed(4)]; // relative to what shows
    const same = !full && p.cropSource && crop.every((v, i) => Math.abs(v - c0[i]) < 0.0005);
    let sprite = full ? src : same ? p.sprite : null;
    if (sprite == null) {
      const [x, y, w, hh] = crop, cw = Math.max(1, Math.round(w * W)), ch = Math.max(1, Math.round(hh * H));
      const cv = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
      cv.getContext('2d').drawImage(img, x * W, y * H, w * W, hh * H, 0, 0, cw, ch);
      const ext = src.split('.').pop().toLowerCase(), out = MIME[ext] ? ext : 'png';
      const blob = await new Promise(r => cv.toBlob(r, MIME[out], 0.9));
      const base = src.split('/').pop().replace(/\.[^.]+$/, ''), dir = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : '';
      const tag = crop.map(v => Math.round(v * 1000).toString(36)).join('');
      try { sprite = await S.upload(new File([blob], `${base}.crop-${tag}.${out}`, { type: MIME[out] }), dir); }
      catch (e) { return S.log(`Crop failed: ${e.message}`, 'error'); }
    }
    const label = `Crop ${cp} ${Date.now()}`, set = (k, v) => S.setProp(id, `${cp}.${k}`, v, { label });
    set('sprite', sprite);
    set('cropSource', full ? '' : src);
    set('crop', full ? [0, 0, 1, 1] : crop.map(v => +v.toFixed(5)));
    set('focus', f);
    S.log(full ? `${src}: crop removed` : `Cropped ${src} → ${sprite}`);
    close();
  }
}
