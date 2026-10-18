// Insert Section window (WebObject ▸ Section…): the section library (lib/sections.js) as live previews in the
// project's own theme, by category. A click inserts one into the page after the selected section.
import * as S from './state.js';
import { h } from './fields.js';
import { SECTIONS, applyTheme } from '/lib/sections.js';
import { renderPage } from '/lib/render.js';
import { newNode } from '/lib/node.js';

let win = null;
const W = 1200, SCALE = 0.25;

// a section rendered on its own (no scripts), in the project's tokens or the default theme where they're missing
function previewDoc(sec) {
  const tokens = applyTheme(S.S.P.project.tokens, 'clean', true);
  const page = newNode('Canvas', [{ type: 'Canvas', props: { background: '$background', font: '$body', height: 1 } }, { type: 'VerticalLayoutGroup', props: { controlWidth: true, expandWidth: true } }]);
  page.children.push(sec.make({ site: S.S.P.project.name }));
  const r = renderPage(page, S.ctx({ editor: false, tokens, inject: null }));
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/project/"><link rel="stylesheet" href="/lib/base.css"><style>${r.css}</style>
<style>html,body{margin:0;overflow:hidden} *{pointer-events:none}</style></head><body>${r.body}</body></html>`;
}

export function openSectionPicker() {
  win?.close();
  const cats = [...new Set(SECTIONS.map(s => s.category))];
  let cat = 'All';
  const nav = h('div', { class: 'sp-cats' }), grid = h('div', { class: 'sp-grid' });
  const ov = h('div', { class: 'prefs-overlay' },
    h('div', { class: 'prefs-win sp-win', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Insert Section' },
      h('header', {}, h('b', {}, 'Insert Section'), h('button', { class: 'prefs-x', title: 'Close (Esc)', onclick: () => close() }, '✕')),
      h('div', { class: 'sp-main' }, nav, grid),
      h('footer', { class: 'sp-foot' }, 'Sections stretch across the page, wrap on phones and use your design tokens: change the theme in Project Settings ▸ Design Tokens.')));
  document.body.append(ov);
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); };
  const close = () => { removeEventListener('keydown', onKey, true); ov.remove(); win = null; };
  addEventListener('keydown', onKey, true);
  ov.onpointerdown = e => { if (e.target === ov) close(); };
  win = { close };

  const card = sec => {
    const f = h('iframe', { class: 'sp-frame', tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy' });
    f.style.width = `${W}px`;
    f.srcdoc = previewDoc(sec);
    const box = h('div', { class: 'sp-shot' }, f);
    f.onload = () => { // fit the preview's height to the section
      try { const ht = Math.min(1400, f.contentDocument.body.scrollHeight); f.style.height = ht + 'px'; box.style.height = Math.round(ht * SCALE) + 'px'; } catch { /* about:blank */ }
    };
    return h('button', { class: 'sp-card', title: sec.desc, onclick: () => { close(); S.insertSection(sec.id); } },
      box, h('b', {}, sec.name), h('span', {}, sec.desc));
  };
  const draw = () => {
    nav.replaceChildren(...['All', ...cats].map(c => h('button', { class: 'sp-cat' + (c === cat ? ' on' : ''), onclick: () => { cat = c; draw(); } }, c)));
    grid.replaceChildren(...SECTIONS.filter(s => cat === 'All' || s.category === cat).map(card));
    grid.scrollTop = 0;
  };
  draw();
}
