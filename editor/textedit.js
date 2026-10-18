// Text editing on the canvas: double-click a Text in the Scene to type into it where it is, with a small toolbar
// (bold, italic, underline, link, clear formatting). The text is written back through S.setProp when you're done
// (Escape, Ctrl+Enter, or a click elsewhere), so it is one undo step and follows the prefab / breakpoint rules.
import * as S from './state.js';
import { h } from './fields.js';
import { componentPath } from '/lib/node.js';

let cur = null;
export const editingText = () => !!cur;
export const endTextEdit = (commit = true) => cur?.end(commit);

// the Text component path of a node (Text, or the label of a Button / Link made of one), or null
export const textPathOf = id => {
  const n = S.node(id), i = n?.components.findIndex(c => c.type === 'Text') ?? -1;
  return i < 0 ? null : `${componentPath(n, i)}.text`;
};

// el: the node's element in the Scene preview (the clicked one when it repeats)
export function startTextEdit(id, el, at) {
  endTextEdit();
  const path = textPathOf(id), span = el?.querySelector(':scope > .gpsb-text');
  if (!path || !span) return false;
  const raw = String(S.getProp(S.view(id), path) ?? '');
  if (/\{\{/.test(raw)) { S.log('This text comes from data ({{…}}): change it in the Inspector, or the data in Window ▸ Content', 'warn'); return false; }
  const doc = el.ownerDocument, frame = doc.defaultView.frameElement;
  span.innerHTML = raw; // as written (page links unresolved), not as rendered
  span.contentEditable = 'true';
  span.spellcheck = true;
  frame.classList.add('editing');
  doc.documentElement.classList.add('gpsb-editing');
  const style = doc.head.appendChild(Object.assign(doc.createElement('style'), { textContent: '.gpsb-editing .gpsb-text[contenteditable] { outline: 2px solid #3a79bb; outline-offset: 2px; cursor: text; min-width: 1ch; } .gpsb-editing a { pointer-events: none; }' }));
  span.focus();
  doc.execCommand('styleWithCSS', false, false); // <b>, <i>, <u> rather than style attributes
  // caret where the double-click was, else everything selected
  const sel = doc.getSelection(), pos = at && (doc.caretPositionFromPoint?.(at.x, at.y) ?? doc.caretRangeFromPoint?.(at.x, at.y));
  if (pos && span.contains(pos.offsetNode ?? pos.startContainer)) {
    const r = doc.createRange();
    if (pos.offsetNode) r.setStart(pos.offsetNode, pos.offset); else r.setStart(pos.startContainer, pos.startOffset);
    sel.removeAllRanges(); sel.addRange(r);
    sel.modify?.('move', 'backward', 'word'); sel.modify?.('extend', 'forward', 'word'); // the word under the pointer
  } else doc.execCommand('selectAll');

  // ---------- toolbar (in the editor document, above the text) ----------
  const cmd = (c, v) => () => { span.focus(); doc.execCommand(c, false, v); };
  const link = () => {
    const a = sel.anchorNode?.parentElement?.closest('a'), href = prompt('Link to (a page name like about, a URL, or #anchor; empty removes it):', a?.getAttribute('href') ?? '');
    span.focus();
    if (href === null) return;
    if (!href.trim()) doc.execCommand('unlink'); else doc.execCommand('createLink', false, href.trim());
  };
  const btn = (label, title, fn, cls = '') => h('button', { class: `te-b ${cls}`, title, onmousedown: e => e.preventDefault(), onclick: fn }, label);
  const bar = h('div', { class: 'te-bar' },
    btn('B', 'Bold (Ctrl+B)', cmd('bold'), 'b'), btn('I', 'Italic (Ctrl+I)', cmd('italic'), 'i'), btn('U', 'Underline (Ctrl+U)', cmd('underline'), 'u'),
    btn('🔗', 'Link (Ctrl+K)', link), btn('⌫', 'Clear formatting', cmd('removeFormat')), h('span', { class: 'te-sep' }),
    btn('Done', 'Done (Esc or Ctrl+Enter)', () => end(true), 'done'));
  document.body.append(bar);
  const place = () => {
    const fr = frame.getBoundingClientRect(), z = fr.width / (frame.offsetWidth || 1), r = span.getBoundingClientRect();
    const top = fr.top + r.top * z - bar.offsetHeight - 8, left = fr.left + r.left * z;
    Object.assign(bar.style, { left: Math.max(4, Math.min(left, innerWidth - bar.offsetWidth - 4)) + 'px', top: (top < 4 ? fr.top + r.bottom * z + 8 : top) + 'px' });
  };
  place();
  const tick = setInterval(place, 100); // follows pan, zoom and the text growing

  const key = e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); end(true); }
    else if (e.key === 'Enter') { e.preventDefault(); doc.execCommand('insertText', false, '\n'); } // the text keeps its line breaks (white-space: pre-wrap)
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); link(); }
    e.stopPropagation();
  };
  const paste = e => { // plain text only
    e.preventDefault();
    doc.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };
  const outside = e => { if (!span.contains(e.target) && !bar.contains(e.target)) end(true); };
  span.addEventListener('keydown', key);
  span.addEventListener('paste', paste);
  doc.addEventListener('pointerdown', outside, true);
  addEventListener('pointerdown', outside, true);

  function end(commit) {
    if (cur?.span !== span) return;
    cur = null;
    clearInterval(tick);
    span.removeEventListener('keydown', key); span.removeEventListener('paste', paste);
    doc.removeEventListener('pointerdown', outside, true); removeEventListener('pointerdown', outside, true);
    bar.remove(); style.remove();
    frame.classList.remove('editing'); doc.documentElement.classList.remove('gpsb-editing');
    span.removeAttribute('contenteditable');
    const html = clean(span.innerHTML);
    if (commit && html !== raw) S.setProp(id, path, html, { label: `Edit text ${id}` });
    else S.S.previewWin?.GPSB?.applyNode(S.node(id)); // put the rendered text back
  }
  cur = { span, end };
  return true;
}

// what contentEditable leaves behind: <div>/<br> line breaks -> \n, &nbsp; -> space, a trailing <br>
function clean(html) {
  return html.replace(/<br\s*\/?>(?=$)/i, '').replace(/<div>(.*?)<\/div>/gi, '\n$1').replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ');
}
