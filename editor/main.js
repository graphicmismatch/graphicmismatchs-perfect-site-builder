// Editor shell: prefs, docking layout, panel mounting, global shortcuts, title + status bar.
import * as S from './state.js';
import * as prefs from './prefs.js';
import * as layout from './layout.js';
import { keymap, comboOf, openPreferences } from './preferences.js';
import { buildSite, togglePause, step } from './panels/toolbar.js';

await prefs.load();
const panelEls = Object.fromEntries([...document.querySelectorAll('#dock > .panel')].map(p => [p.dataset.panel, p]));
layout.init(document.getElementById('dock'), panelEls);

for (const name of ['toolbar', 'hierarchy', 'scene', 'inspector', 'project', 'console', 'animation', 'code']) {
  const el = name === 'toolbar' ? document.getElementById('toolbar') : panelEls[name];
  try { (await import(`./panels/${name}.js`)).mount(el); }
  catch (e) { console.error(e); el.textContent = `${name}: ${e.message}`; }
}

// ---------- global shortcuts: dispatched from the rebindable table in preferences.js ----------
const typing = t => t?.isContentEditable || t?.matches?.('textarea, select, input:not([type=checkbox], [type=radio], [type=button], [type=range], [type=color])');
const nonRoot = () => S.S.selection.some(id => id !== S.root().id);
const bp = i => () => { const b = S.breakpoints(); if (i === 0) S.setBreakpoint(null); else if (b[i - 1]) S.setBreakpoint(b[i - 1].name); };
const RUN = {
  'tool.hand': () => S.setTool('hand'), 'tool.move': () => S.setTool('move'), 'tool.rotate': () => S.setTool('rotate'),
  'tool.scale': () => S.setTool('scale'), 'tool.rect': () => S.setTool('rect'),
  save: () => S.save(), build: buildSite, prefs: () => openPreferences(),
  undo: S.undo, redo: S.redo,
  duplicate: () => nonRoot() && S.duplicate(), delete: () => nonRoot() && S.deleteNodes(),
  selectAll: () => S.select([...S.walk(S.root())].slice(1).map(([n]) => n.id)),
  rename: () => S.S.selection.length && S.emit('rename'), frame: () => S.emit('frame'),
  play: () => S.setPlaying(!S.S.playing), pause: togglePause, step,
  maximize: () => layout.toggleMaximize(),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map(i => [`bp.${i}`, bp(i)])),
};
const IN_FIELDS = new Set(['save', 'prefs']), PLAY_FRAME = new Set(['save', 'play', 'pause', 'step']);
export function onKey(e, allowed) {
  const c = comboOf(e), id = c && keymap()[c]?.[0];
  if (!id || !RUN[id] || (allowed && !allowed.has(id))) return;
  if (typing(e.target) && !IN_FIELDS.has(id)) return;
  if (!S.S.P && id !== 'prefs') return;
  e.preventDefault();
  if (id === 'save' && typing(e.target)) e.target.blur(); // commits a pending field edit
  RUN[id]();
}
document.addEventListener('keydown', e => onKey(e));
// keys pressed while the Scene iframe has focus (in play mode the page owns its keys, except play/save)
const frameKey = e => onKey(e, S.S.playing ? PLAY_FRAME : null);
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
status.innerHTML = '<span class="bp"></span><span class="msg"></span>';
const [bpEl, msgEl] = status.children;
S.on('log', e => {
  msgEl.className = 'msg ' + e.level;
  msgEl.textContent = e.msg.split('\n')[0];
  msgEl.title = e.msg;
});
S.on('breakpoint', () => {
  const b = S.breakpoints().find(x => x.name === S.S.breakpoint);
  status.classList.toggle('editing-bp', !!b);
  bpEl.textContent = b ? `Editing ${b.name} overrides (≤${b.maxWidth}px)` : '';
});
status.onclick = () => S.emit('show-tab', 'console');
addEventListener('beforeunload', e => { if (S.S.dirty.size) e.preventDefault(); });
await S.load();
