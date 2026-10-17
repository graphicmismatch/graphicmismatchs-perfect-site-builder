// Find & Replace (Edit > Find & Replace…): node names and text-like props across this page or every page.
// Replacing goes through S.setProp, so edits inside prefab instances become overrides and each page is one undo step.
import * as S from './state.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const TEXTY = new Set(['string', 'text', 'href', 'code']);
let win = null, run = 0, opts = { find: '', replace: '', matchCase: false, allPages: true, names: true };

// -> [{ page, id, node, path, value }]
function search() {
  if (!opts.find) return [];
  const f = opts.matchCase ? opts.find : opts.find.toLowerCase(), has = v => (opts.matchCase ? v : v.toLowerCase()).includes(f);
  const pages = opts.allPages ? Object.keys(S.S.P.pages) : [S.S.page], out = [];
  for (const page of pages) for (const [n] of S.walk(S.S.P.pages[page])) {
    if (opts.names && has(n.name)) out.push({ page, id: n.id, node: n.name, path: 'name', value: n.name });
    n.components.forEach((c, ci) => {
      const d = S.def(c.type), cp = S.componentPath(n, ci);
      for (const [k, sc] of Object.entries(d?.props ?? {})) {
        const v = c.props?.[k];
        if (typeof v === 'string' && TEXTY.has(sc.type) && has(v)) out.push({ page, id: n.id, node: n.name, path: `${cp}.${k}`, value: v });
      }
    });
  }
  return out;
}
const replaced = v => {
  const re = new RegExp(opts.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.matchCase ? 'g' : 'gi');
  return v.replace(re, () => opts.replace);
};
function apply(matches) {
  const back = S.S.page, byPage = Map.groupBy(matches, m => m.page);
  if (S.S.prefabEdit) S.closePrefab();
  run++;
  for (const [page, ms] of byPage) {
    S.S.page = page; // setProp works on the current page's nodes
    for (const m of ms) S.setProp(m.id, m.path, replaced(m.value), { label: `Replace on ${page} #${run}` }); // one undo step per page
  }
  S.S.page = back;
  S.emit('structure');
  S.log(`Replaced ${matches.length} occurrence(s) on ${byPage.size} page(s)`);
}

export function openFind() {
  win?.close();
  const ov = document.createElement('div');
  ov.className = 'prefs-overlay';
  ov.innerHTML = `
    <div class="prefs-win fr-win" role="dialog" aria-modal="true" aria-label="Find and Replace">
      <header><b>Find &amp; Replace</b><button class="prefs-x" title="Close (Esc)">✕</button></header>
      <section class="prefs-body">
        <div class="fr-row"><input class="prefs-in fr-find" placeholder="Find" spellcheck="false"><input class="prefs-in fr-rep" placeholder="Replace with" spellcheck="false"></div>
        <div class="fr-row fr-opts">
          <label><input type="checkbox" data-o="matchCase"> Match case</label>
          <label><input type="checkbox" data-o="allPages"> All pages</label>
          <label><input type="checkbox" data-o="names"> Object names</label>
          <span class="fr-count"></span>
          <button class="btn fr-all">Replace All</button>
        </div>
        <table class="fr-list"><tbody></tbody></table>
      </section>
    </div>`;
  document.body.append(ov);
  const $ = s => ov.querySelector(s), find = $('.fr-find'), rep = $('.fr-rep'), list = $('tbody');
  let matches = [];
  const draw = () => {
    matches = search();
    $('.fr-count').textContent = opts.find ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : '';
    $('.fr-all').disabled = !matches.length;
    list.innerHTML = matches.slice(0, 500).map((m, i) => {
      const at = (opts.matchCase ? m.value : m.value.toLowerCase()).indexOf(opts.matchCase ? opts.find : opts.find.toLowerCase());
      const snip = esc(m.value.slice(Math.max(0, at - 30), at)) + `<mark>${esc(m.value.slice(at, at + opts.find.length))}</mark>` + esc(m.value.slice(at + opts.find.length, at + opts.find.length + 40));
      return `<tr data-i="${i}"><td class="fr-where">${opts.allPages ? `${esc(m.page)} › ` : ''}${esc(m.node)}<small>${esc(m.path)}</small></td><td class="fr-snip">${snip}</td><td><button class="btn" data-rep>Replace</button></td></tr>`;
    }).join('') + (matches.length > 500 ? `<tr><td colspan="3" class="prefs-note">…and ${matches.length - 500} more</td></tr>` : '');
  };
  find.value = opts.find; rep.value = opts.replace;
  for (const c of ov.querySelectorAll('[data-o]')) { c.checked = opts[c.dataset.o]; c.onchange = () => { opts[c.dataset.o] = c.checked; draw(); }; }
  find.oninput = () => { opts.find = find.value; draw(); };
  rep.oninput = () => { opts.replace = rep.value; };
  $('.fr-all').onclick = () => { if (matches.length && confirm(`Replace ${matches.length} occurrence(s)?`)) { apply(matches); draw(); } };
  list.onclick = e => {
    const m = matches[+e.target.closest('tr')?.dataset.i];
    if (!m) return;
    if (e.target.closest('[data-rep]')) { apply([m]); return draw(); }
    if (S.S.prefabEdit) S.closePrefab();
    if (m.page !== S.S.page) S.setPage(m.page);
    S.select(m.id); S.emit('frame');
  };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter' && e.target === find) draw(); e.stopPropagation(); };
  const close = () => { removeEventListener('keydown', onKey, true); ov.remove(); win = null; };
  addEventListener('keydown', onKey, true);
  $('.prefs-x').onclick = close;
  ov.onpointerdown = e => { if (e.target === ov) close(); };
  draw();
  find.focus(); find.select();
  win = { close };
  return win;
}
