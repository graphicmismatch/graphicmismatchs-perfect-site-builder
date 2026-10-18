// Autosave (Preferences > Saving) and crash recovery: unsaved edits are mirrored to IndexedDB every few seconds, per
// project; if the editor reopens a project with a copy newer than its last save, a bar offers Restore / Discard.
import * as S from './state.js';
import * as prefs from './prefs.js';
import { collapsePrefabs } from '/lib/prefab.js';

const DB = 'gpsb-recovery', STORE = 'projects';
const db = () => new Promise((ok, err) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
});
const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, err) => { const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE)); t.oncomplete = () => ok(r?.result); t.onerror = () => err(t.error); }); };
const key = () => S.S.P?.root;

// what Save would write right now: { file: stored JSON } for every dirty file (deleted files -> null)
function snapshot() {
  const files = {};
  for (const f of S.S.dirty) {
    const tree = f.startsWith('pages/') ? S.S.P.pages[f.slice(6, -5)] : f.startsWith('prefabs/') ? S.S.P.prefabs[f.slice(8, -12)] : null;
    files[f] = f === 'project.json' ? S.S.P.project : tree ? collapsePrefabs(tree) : f.startsWith('animations/') ? S.S.P.clips[f.slice(11, -10)] ?? null : null;
  }
  return files;
}

let mirrorT = 0, autoT = 0, last = '';
function mirror() {
  if (!key()) return;
  const files = snapshot(), json = JSON.stringify(files);
  if (json === last) return;
  last = json;
  (S.S.dirty.size ? tx('readwrite', s => s.put({ time: Date.now(), page: S.S.page, files }, key())) : tx('readwrite', s => s.delete(key()))).catch(() => {});
}
const changed = () => {
  clearTimeout(mirrorT); mirrorT = setTimeout(mirror, 3000);
  const secs = prefs.get('autosave', 0);
  clearTimeout(autoT);
  if (secs > 0 && S.S.dirty.size) autoT = setTimeout(() => S.S.dirty.size && S.save(), secs * 1000);
};
for (const ev of ['structure', 'props', 'anim', 'assets', 'project', 'saved']) S.on(ev, changed);
S.on('saved', () => { if (!S.S.dirty.size) { last = ''; tx('readwrite', s => s.delete(key())).catch(() => {}); } });
addEventListener('pagehide', mirror); // closing the tab: write the latest state now

// on load: offer what the previous session didn't save
S.on('load', async () => {
  const rec = await tx('readonly', s => s.get(key())).catch(() => null);
  if (!rec?.files || !Object.keys(rec.files).length) return;
  const bar = document.createElement('div');
  bar.className = 'recovery-bar';
  bar.innerHTML = `<span>Unsaved changes from ${new Date(rec.time).toLocaleString()} were found (the editor closed before saving): ${Object.keys(rec.files).map(f => f.replace(/[<&]/g, '')).join(', ')}</span>
    <button class="btn" data-r="restore">Restore</button><button class="btn" data-r="discard">Discard</button>`;
  document.body.append(bar);
  bar.onclick = e => {
    const r = e.target.dataset.r;
    if (!r) return;
    if (r === 'restore') restore(rec);
    else tx('readwrite', s => s.delete(key())).catch(() => {});
    bar.remove();
  };
});
function restore(rec) {
  for (const [f, v] of Object.entries(rec.files)) {
    if (f === 'project.json') S.S.P.project = v;
    else if (f.startsWith('pages/')) { if (v) S.S.P.pages[f.slice(6, -5)] = v; else delete S.S.P.pages[f.slice(6, -5)]; }
    else if (f.startsWith('prefabs/')) { if (v) S.S.P.prefabs[f.slice(8, -12)] = v; else delete S.S.P.prefabs[f.slice(8, -12)]; }
    else if (f.startsWith('animations/')) { if (v) S.S.P.clips[f.slice(11, -10)] = v; else delete S.S.P.clips[f.slice(11, -10)]; }
    S.S.dirty.add(f);
  }
  S.refreshInstances();
  if (rec.page && S.S.P.pages[rec.page]) S.setPage(rec.page); else S.setPage(Object.keys(S.S.P.pages)[0]);
  S.emit('anim'); S.emit('assets');
  S.log(`Restored ${Object.keys(rec.files).length} unsaved file(s); save to keep them`, 'warn');
}
