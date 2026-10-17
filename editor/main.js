// Editor shell: mounts panels, bottom tabs, splitters, global shortcuts, title + status bar.
import * as S from './state.js';

const PANELS = ['toolbar', 'hierarchy', 'scene', 'inspector', 'project', 'console', 'animation', 'code'];
for (const name of PANELS) {
  const el = name === 'toolbar' ? document.getElementById('toolbar') : document.querySelector(`[data-panel="${name}"]`);
  try { (await import(`./panels/${name}.js`)).mount(el); }
  catch (e) { console.error(e); el.textContent = `${name}: ${e.message}`; }
}

// bottom tabs
const tabs = document.querySelector('[data-tabs]');
export function showTab(name) {
  if (![...tabs.children].some(b => b.dataset.tab === name)) return;
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === name);
  for (const p of tabs.parentElement.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== name;
  try { localStorage.psbTab = name; } catch {}
}
S.on('show-tab', showTab);
tabs.onclick = e => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) S.emit('show-tab', t); };
try { if (localStorage.psbTab) S.emit('show-tab', localStorage.psbTab); } catch {}

// splitters
const rootStyle = document.documentElement.style;
for (const s of document.querySelectorAll('.split')) {
  const v = s.dataset.var, dir = +s.dataset.dir, horiz = s.classList.contains('h');
  try { if (localStorage['psb' + v]) rootStyle.setProperty(v, localStorage['psb' + v]); } catch {}
  s.onpointerdown = e => {
    s.setPointerCapture(e.pointerId);
    s.classList.add('drag'); document.body.classList.add(horiz ? 'resizing-h' : 'resizing-v');
    const start = horiz ? e.clientY : e.clientX;
    const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v));
    const max = (horiz ? innerHeight : innerWidth) - 240;
    s.onpointermove = m => rootStyle.setProperty(v, `${Math.min(max, Math.max(120, base + dir * ((horiz ? m.clientY : m.clientX) - start)))}px`);
    s.onpointerup = () => {
      s.onpointermove = null; s.classList.remove('drag'); document.body.classList.remove('resizing-h', 'resizing-v');
      try { localStorage['psb' + v] = rootStyle.getPropertyValue(v); } catch {}
      dispatchEvent(new Event('resize'));
    };
  };
  s.ondblclick = () => { rootStyle.removeProperty(v); try { delete localStorage['psb' + v]; } catch {} dispatchEvent(new Event('resize')); };
}

// global shortcuts (Unity keys). Panels may stopPropagation their own local keys.
const typing = t => t?.isContentEditable || t?.matches?.('textarea, select, input:not([type=checkbox], [type=radio], [type=button], [type=range], [type=color])');
const TOOLS = { q: 'hand', w: 'move', e: 'rotate', r: 'scale', t: 'rect' };
export function onKey(e) {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), act = f => { e.preventDefault(); f(); };
  if (mod && !e.altKey && k === 's') return act(() => { if (typing(e.target)) e.target.blur(); S.save(); }); // blur commits a pending field edit
  if (typing(e.target) || !S.S.P) return;
  if (mod && !e.altKey) {
    if (k === 'z') return act(e.shiftKey ? S.redo : S.undo);
    if (k === 'y') return act(S.redo);
    if (k === 'd') return act(() => S.S.selection.some(id => id !== S.root().id) && S.duplicate());
    if (k === 'p') return act(() => S.setPlaying(!S.S.playing));
    if (k === 'a') return act(() => S.select([...S.walk(S.root())].slice(1).map(([n]) => n.id)));
    return;
  }
  if (e.altKey || e.shiftKey) return;
  if (TOOLS[k]) return act(() => S.setTool(TOOLS[k]));
  if (k === 'f') return act(() => S.emit('frame'));
  if (k === 'delete' || k === 'backspace') return act(() => S.S.selection.some(id => id !== S.root().id) && S.deleteNodes());
  if (k === 'f2') return act(() => S.S.selection.length && S.emit('rename'));
}
document.addEventListener('keydown', onKey);
// keys pressed while the Scene iframe has focus (in play mode the page owns its keys, except Ctrl+P / Ctrl+S)
const frameKey = e => (!S.S.playing || ((e.ctrlKey || e.metaKey) && /^[ps]$/i.test(e.key))) && onKey(e);
S.on('preview-ready', () => { try { S.S.previewWin?.document.addEventListener('keydown', frameKey); } catch {} });

// no browser context menu / file-drop navigation outside panels that handle them
document.addEventListener('contextmenu', e => { if (!typing(e.target)) e.preventDefault(); });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => e.preventDefault());

// editor errors -> Console
addEventListener('error', e => S.log(e.message, 'error', { stack: e.error?.stack }));
addEventListener('unhandledrejection', e => S.log(e.reason?.message ?? e.reason, 'error', { stack: e.reason?.stack }));

// title (dirty marker), play tint, status bar
const title = () => {
  if (!S.S.P) return;
  document.title = `${S.S.page}${S.S.dirty.size ? '*' : ''} - ${S.S.P.project?.name ?? 'project'} - graphicmismatch's perfect site builder`;
};
for (const ev of ['load', 'page', 'structure', 'props', 'anim', 'saved']) S.on(ev, title);
S.on('play', () => document.body.classList.toggle('playing', S.S.playing));
const status = document.getElementById('status');
S.on('log', e => {
  status.className = e.level;
  status.textContent = e.msg.split('\n')[0];
  status.title = e.msg;
});
status.onclick = () => S.emit('show-tab', 'console');
addEventListener('beforeunload', e => { if (S.S.dirty.size) e.preventDefault(); });
await S.load();
