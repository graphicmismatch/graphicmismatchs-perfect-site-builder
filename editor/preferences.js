// Preferences window (Appearance, Shortcuts) + the shortcut table main.js dispatches from.
// Depends only on prefs.js + style.css so the Project Hub can open it without a project.
import * as prefs from './prefs.js';

// id, category, label, default key combos
export const ACTIONS = [
  ['tool.hand', 'Tools', 'View Tool', ['Q']], ['tool.move', 'Tools', 'Move Tool', ['W']], ['tool.rotate', 'Tools', 'Rotate Tool', ['E']],
  ['tool.scale', 'Tools', 'Scale Tool', ['R']], ['tool.rect', 'Tools', 'Rect Tool', ['T']],
  ['save', 'File', 'Save', ['Ctrl+S']], ['build', 'File', 'Build Site', ['Ctrl+B']], ['prefs', 'File', 'Preferences…', ['Ctrl+,']],
  ['undo', 'Edit', 'Undo', ['Ctrl+Z']], ['redo', 'Edit', 'Redo', ['Ctrl+Shift+Z', 'Ctrl+Y']],
  ['duplicate', 'Edit', 'Duplicate', ['Ctrl+D']],
  ['nudge.left', 'Edit', 'Nudge Left (1px)', ['ArrowLeft']], ['nudge.right', 'Edit', 'Nudge Right (1px)', ['ArrowRight']],
  ['nudge.up', 'Edit', 'Nudge Up (1px)', ['ArrowUp']], ['nudge.down', 'Edit', 'Nudge Down (1px)', ['ArrowDown']],
  ['nudge.left10', 'Edit', 'Nudge Left (10px)', ['Shift+ArrowLeft']], ['nudge.right10', 'Edit', 'Nudge Right (10px)', ['Shift+ArrowRight']],
  ['nudge.up10', 'Edit', 'Nudge Up (10px)', ['Shift+ArrowUp']], ['nudge.down10', 'Edit', 'Nudge Down (10px)', ['Shift+ArrowDown']], ['delete', 'Edit', 'Delete', ['Delete', 'Backspace']],
  ['selectAll', 'Edit', 'Select All', ['Ctrl+A']], ['find', 'Edit', 'Find & Replace…', ['Ctrl+Shift+F']], ['rename', 'Edit', 'Rename', ['F2']], ['frame', 'Edit', 'Frame Selected', ['F']],
  ['play', 'Play Mode', 'Play / Stop', ['Ctrl+P']], ['pause', 'Play Mode', 'Pause', ['Ctrl+Shift+P']], ['step', 'Play Mode', 'Step', ['Ctrl+Alt+P']],
  ['bp.0', 'Breakpoints', 'Edit Base', ['Alt+1']],
  ...[1, 2, 3, 4, 5].map(i => [`bp.${i}`, 'Breakpoints', `Edit Breakpoint ${i} (widest first)`, [`Alt+${i + 1}`]]),
  ['maximize', 'Window', 'Maximize Panel Under Mouse', ['Shift+Space']],
].map(([id, cat, label, keys]) => ({ id, cat, label, keys }));

const MODS = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'];
// normalized combo like "Ctrl+Shift+Z" (letters/digits by physical key so Alt+1 works on every layout)
export function comboOf(e) {
  if (MODS.includes(e.key)) return null;
  const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5)
    : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}
export const keysOf = id => prefs.get('shortcuts', {})[id] ?? ACTIONS.find(a => a.id === id)?.keys ?? [];
export const shortcut = id => keysOf(id)[0] ?? '';
// combo -> [action ids]
export function keymap() {
  const m = {};
  for (const a of ACTIONS) for (const k of keysOf(a.id)) (m[k] ??= []).push(a.id);
  return m;
}
function setKeys(id, keys) {
  const o = { ...prefs.get('shortcuts', {}) }, def = ACTIONS.find(a => a.id === id).keys;
  if (keys && keys.join() !== def.join()) o[id] = keys; else delete o[id];
  prefs.set('shortcuts', Object.keys(o).length ? o : undefined);
}

// ---------- window ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ACCENTS = ['#3a79bb', '#5b6ee1', '#8a5cd6', '#c2549b', '#d0583f', '#d79a2b', '#4a9e5c', '#2a9d9a'];
let win = null;

export function openPreferences(section = 'appearance') {
  win?.close();
  const ov = document.createElement('div');
  ov.className = 'prefs-overlay';
  ov.innerHTML = `
    <div class="prefs-win" role="dialog" aria-modal="true" aria-label="Preferences">
      <header><b>Preferences</b><button class="prefs-x" title="Close (Esc)">✕</button></header>
      <div class="prefs-main">
        <nav>${[['appearance', 'Appearance'], ['saving', 'Saving'], ['shortcuts', 'Shortcuts']].map(([k, l]) => `<button data-sec="${k}">${l}</button>`).join('')}</nav>
        <section class="prefs-body"></section>
      </div>
    </div>`;
  document.body.append(ov);
  const body = ov.querySelector('.prefs-body');
  let sec = section, capture = null, filter = '';

  const appearance = () => {
    const p = prefs.all();
    body.innerHTML = `
      <h3>Appearance</h3>
      <label class="prefs-row"><span>Theme</span><span class="prefs-seg">${['dark', 'light'].map(t => `<button data-theme="${t}" class="${p.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</span></label>
      <div class="prefs-row"><span>Accent color</span><span class="prefs-accents">
        ${ACCENTS.map(c => `<button data-accent="${c}" style="background:${c}" class="${p.accent === c ? 'on' : ''}" title="${c}"></button>`).join('')}
        <input type="color" value="${esc(p.accent)}" title="Custom color"></span></div>
      <label class="prefs-row"><span>UI font size</span><span><input type="range" min="10" max="16" step="1" data-k="fontSize" value="${p.fontSize}"> <output>${p.fontSize}px</output></span></label>
      <p class="prefs-note">Preferences are stored in your user config and apply to every project.</p>
      <div class="prefs-actions"><button class="btn" data-reset>Reset Appearance</button></div>`;
    body.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => { prefs.set('theme', b.dataset.theme); appearance(); });
    body.querySelectorAll('[data-accent]').forEach(b => b.onclick = () => { prefs.set('accent', b.dataset.accent); appearance(); });
    body.querySelector('input[type=color]').oninput = e => prefs.set('accent', e.target.value);
    body.querySelectorAll('input[type=range]').forEach(r => {
      r.oninput = () => { r.nextElementSibling.textContent = r.value + 'px'; };
      r.onchange = () => prefs.set(r.dataset.k, +r.value);
    });
    body.querySelector('[data-reset]').onclick = () => { for (const k of ['theme', 'accent', 'fontSize']) prefs.set(k, undefined); appearance(); };
  };

  const saving = () => {
    const v = prefs.get('autosave', 0);
    body.innerHTML = `
      <h3>Saving</h3>
      <label class="prefs-row"><span>Autosave</span><select class="prefs-in" data-autosave>${[[0, 'Off'], [30, '30 seconds after the last change'], [60, '1 minute after the last change'], [300, '5 minutes after the last change']]
        .map(([s, l]) => `<option value="${s}"${s === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="prefs-note">Independently of this, unsaved changes are kept in the browser every few seconds. If the editor closes
        before you save (crash, closed tab), they are offered back the next time you open the project.</p>`;
    body.querySelector('[data-autosave]').onchange = e => prefs.set('autosave', +e.target.value || undefined);
  };
  const shortcuts = () => {
    const km = keymap(), q = filter.toLowerCase();
    const conflicts = id => keysOf(id).flatMap(k => km[k].filter(x => x !== id).map(x => `${k} is also ${ACTIONS.find(a => a.id === x).label}`));
    const rows = ACTIONS.filter(a => !q || a.label.toLowerCase().includes(q) || a.cat.toLowerCase().includes(q) || keysOf(a.id).join(' ').toLowerCase().includes(q));
    let cat = '';
    body.innerHTML = `
      <h3>Shortcuts</h3>
      <div class="prefs-toolbar"><input type="search" placeholder="Search actions or keys" value="${esc(filter)}"><button class="btn" data-reset-all>Reset All</button></div>
      <table class="prefs-keys"><tbody>${rows.map(a => {
        const c = conflicts(a.id), custom = !!prefs.get('shortcuts', {})[a.id];
        const head = a.cat !== cat ? `<tr class="cat"><td colspan="3">${esc(cat = a.cat)}</td></tr>` : '';
        return head + `<tr data-id="${a.id}" class="${c.length ? 'conflict' : ''}${custom ? ' custom' : ''}"><td>${esc(a.label)}${c.length ? `<div class="warn">⚠ ${esc(c.join('; '))}</div>` : ''}</td>` +
          `<td><button class="keys${capture === a.id ? ' capturing' : ''}" title="Click, then press the new shortcut">${capture === a.id ? 'Press keys… (Esc cancels)' : keysOf(a.id).map(k => `<kbd>${esc(k)}</kbd>`).join(' ') || '<i>none</i>'}</button></td>` +
          `<td class="ops"><button data-op="clear" title="Remove shortcut">✕</button><button data-op="reset" title="Reset to default" ${custom ? '' : 'disabled'}>↺</button></td></tr>`;
      }).join('')}</tbody></table>`;
    const s = body.querySelector('input[type=search]');
    s.oninput = () => { filter = s.value; shortcuts(); body.querySelector('input[type=search]').focus(); };
    body.querySelector('[data-reset-all]').onclick = () => { if (confirm('Reset every shortcut to its default?')) { prefs.set('shortcuts', undefined); shortcuts(); } };
    body.querySelector('tbody').onclick = e => {
      const id = e.target.closest('tr')?.dataset.id, op = e.target.closest('[data-op]')?.dataset.op;
      if (!id) return;
      if (op === 'clear') setKeys(id, []);
      else if (op === 'reset') setKeys(id, null);
      else if (e.target.closest('.keys')) capture = capture === id ? null : id;
      shortcuts();
    };
  };
  const show = s => {
    sec = s; capture = null;
    ov.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.sec === s));
    ({ shortcuts, saving }[s] ?? appearance)();
  };

  // capture-phase key handling: rebinding, Esc closes; nothing reaches the editor's global shortcuts while open
  const onKey = e => {
    if (capture) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { capture = null; return shortcuts(); }
      const c = comboOf(e);
      if (!c) return;
      setKeys(capture, [c]); capture = null; shortcuts();
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  };
  const close = () => { removeEventListener('keydown', onKey, true); ov.remove(); win = null; };
  addEventListener('keydown', onKey, true);
  ov.querySelector('.prefs-x').onclick = close;
  ov.onpointerdown = e => { if (e.target === ov) close(); };
  ov.querySelector('nav').onclick = e => e.target.dataset.sec && show(e.target.dataset.sec);
  show(sec);
  win = { close };
  return win;
}
