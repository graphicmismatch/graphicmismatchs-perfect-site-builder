// Generated Code: the current page's HTML / CSS exactly as built, highlighted, with line numbers.
import * as S from '../state.js';
import { buildSite } from './toolbar.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const tok = (cls, s) => (s ? (cls ? `<span class="c-${cls}">${esc(s)}</span>` : esc(s)) : '');

// one tokenizing pass per language over the raw text; every piece is escaped exactly once
const HTML_RE = /(<!--[\s\S]*?-->)|(<\/?)([\w-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)(\s*\/?>)|([^<]+)|(<)/g;
const ATTR_RE = /(\s+)([^\s=>/]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g;
export const highlightHTML = src => src.replace(HTML_RE, (m, com, open, name, attrs, close, text, lt) =>
  com ? tok('com', com)
  : name ? tok('pun', open) + tok('tag', name) + attrs.replace(ATTR_RE, (_, ws, a, eq, v) => esc(ws) + tok('att', a) + tok('pun', eq) + tok('str', v)) + tok('pun', close)
  : esc(text ?? lt));

const CSS_RE = /(\/\*[\s\S]*?\*\/)|(@[\w-]+)([^{;]*)|([^{};@]+)(?=\{)|([\w-]+)(\s*:\s*)([^;{}]*)|([\s\S])/g;
const VAL_RE = /(#[\da-f]{3,8}\b)|("(?:[^"\\]|\\.)*"|'[^']*')|(-?(?:\d*\.)?\d+(?:%|[a-z]+)?)|([\w-]+(?=\())|([\w-]+|[\s\S])/gi;
const value = v => v.replace(VAL_RE, (m, hex, str, num, fn) => tok(hex || num ? 'num' : str ? 'str' : fn ? 'fn' : '', m));
// @media prelude: keyword + highlighted params (feature names, px values)
export const highlightCSS = src => src.replace(CSS_RE, (m, com, at, pre, sel, prop, colon, val, ch) =>
  com ? tok('com', com) : at ? tok('kw', at) + pre.replace(/([\w-]+)(\s*:)|[^()\s:]+|[\s\S]/g, (x, f, c) => (f ? tok('prop', f) + tok('pun', c) : value(x))) : sel ? tok('sel', sel) : ch ? tok(/[{};]/.test(ch) ? 'pun' : '', ch)
  : tok('prop', prop) + tok('pun', colon) + value(val));

let el, view, tab = 'html', visible = false, timer, code = null;

function update() {
  clearTimeout(timer);
  if (!visible || !S.S.P) return;
  const info = el.querySelector('.code-info');
  try { code = S.generatedCode(); }
  catch (e) { code = null; view.innerHTML = `<pre class="code-err">${esc(e.stack ?? e.message)}</pre>`; info.textContent = 'render error'; return; }
  const src = code[tab] ?? '', lines = src.split('\n').length;
  info.textContent = `${S.S.page}.${tab} · ${lines} lines · ${(new Blob([src]).size / 1024).toFixed(1)} KB`;
  view.innerHTML = `<pre class="code-gut">${Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre><pre class="code-src">${(tab === 'html' ? highlightHTML : highlightCSS)(src)}\n</pre>`;
}
const refresh = () => { if (visible) { clearTimeout(timer); timer = setTimeout(update, 250); } };

async function copy() {
  if (!code) return;
  try { await navigator.clipboard.writeText(code[tab]); }
  catch {
    const r = document.createRange(); r.selectNodeContents(view.querySelector('.code-src'));
    getSelection().removeAllRanges(); getSelection().addRange(r);
    if (!document.execCommand('copy')) return S.log('Copy failed: clipboard unavailable', 'warn');
  }
  S.log(`Copied ${S.S.page}.${tab} to the clipboard`);
}

export function mount(root) {
  el = root;
  el.classList.add('code');
  el.innerHTML = `
    <div class="code-bar">
      <div class="code-tabs"><button data-t="html" class="on">HTML</button><button data-t="css">CSS</button></div>
      <span class="code-info"></span>
      <button class="code-btn" data-a="copy" title="Copy to clipboard">Copy</button>
      <button class="code-btn primary" data-a="build" title="Save and build the static site">Build Site</button>
    </div>
    <div class="code-view" tabindex="0"></div>`;
  view = el.querySelector('.code-view');
  el.querySelector('.code-bar').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.t) { tab = b.dataset.t; el.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); view.scrollTo(0, 0); update(); }
    if (b.dataset.a === 'copy') copy();
    if (b.dataset.a === 'build') buildSite();
  };
  // Ctrl+A selects the code instead of every object (local key)
  view.onkeydown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault(); e.stopPropagation();
      const r = document.createRange(); r.selectNodeContents(view.querySelector('.code-src') ?? view);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') e.stopPropagation();
  };
  S.on('show-tab', name => { visible = name === 'code'; if (visible) update(); });
  for (const ev of ['load', 'structure', 'props', 'page', 'assets', 'anim']) S.on(ev, refresh);
}
