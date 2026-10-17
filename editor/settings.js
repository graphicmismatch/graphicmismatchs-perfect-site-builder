// Project Settings window (File > Project Settings…): what the build writes. Values live in project.json and are
// saved with the project (Save). Same look as Preferences (.prefs-* in style.css).
import * as S from './state.js';
import { renameToken, tokenUses } from './files.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
let win = null;

// section id -> [label, render(body)]
const SECTIONS = {
  general: ['General', general],
  publishing: ['Publishing', publishing],
  tokens: ['Design Tokens', tokens],
  code: ['Custom Code', code],
};

export function openProjectSettings(section = 'general') {
  win?.close();
  const ov = document.createElement('div');
  ov.className = 'prefs-overlay';
  ov.innerHTML = `
    <div class="prefs-win" role="dialog" aria-modal="true" aria-label="Project Settings">
      <header><b>Project Settings</b><button class="prefs-x" title="Close (Esc)">✕</button></header>
      <div class="prefs-main">
        <nav>${Object.entries(SECTIONS).map(([k, [l]]) => `<button data-sec="${k}">${l}</button>`).join('')}</nav>
        <section class="prefs-body"></section>
      </div>
    </div>`;
  document.body.append(ov);
  const body = ov.querySelector('.prefs-body');
  const show = s => {
    ov.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.sec === s));
    SECTIONS[s][1](body);
  };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); };
  const close = () => { removeEventListener('keydown', onKey, true); ov.remove(); win = null; };
  addEventListener('keydown', onKey, true);
  ov.querySelector('.prefs-x').onclick = close;
  ov.onpointerdown = e => { if (e.target === ov) close(); };
  ov.querySelector('nav').onclick = e => e.target.dataset.sec && show(e.target.dataset.sec);
  show(SECTIONS[section] ? section : 'general');
  win = { close };
  return win;
}

const P = () => S.S.P.project;
// bind inputs with data-k="key" (or "inject.head") to project.json
function bind(body) {
  for (const i of body.querySelectorAll('[data-k]')) {
    const path = i.dataset.k.split('.'), get = () => path.reduce((o, k) => o?.[k], P());
    if (i.type === 'checkbox') i.checked = !!get(); else i.value = get() ?? '';
    i.onchange = () => S.setProjectSetting(i.dataset.k, i.type === 'checkbox' ? i.checked : i.value.trim() || undefined);
  }
}

function general(body) {
  body.innerHTML = `
    <h3>General</h3>
    <label class="prefs-row"><span>Project name</span><input class="prefs-in" data-k="name" spellcheck="false"></label>
    <label class="prefs-row"><span>Site URL</span><input class="prefs-in" data-k="siteUrl" placeholder="https://example.com/" spellcheck="false"></label>
    <p class="prefs-note">The public address the site is published at. It's used for sitemap.xml, robots.txt and the 404 page,
      and it lets pages under a sub-path (https://example.com/docs/) link correctly. Leave it empty if you don't know it yet.</p>`;
  bind(body);
}

function publishing(body) {
  body.innerHTML = `
    <h3>Publishing</h3>
    <label class="prefs-row"><span>Clean URLs</span><span><input type="checkbox" data-k="cleanUrls"> about/ instead of about.html</span></label>
    <label class="prefs-row"><span>Minify</span><span><input type="checkbox" data-k="minify"> compact HTML and CSS (scripts stay readable modules)</span></label>
    <p class="prefs-note">Every build also writes robots.txt and, with a Site URL, sitemap.xml (pages with Page Meta ▸ noindex
      are left out). A page named <b>404</b> is served by hosts for missing addresses. Files in the project's
      <b>public/</b> folder are copied to the site root as they are (CNAME, _redirects, .well-known/, your own robots.txt).</p>`;
  bind(body);
}

// ---------- design tokens ----------
const WEIGHTS = ['', 'normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const KINDS = {
  colors: { title: 'Colours', add: 'colour', dflt: () => '#3a79bb', help: 'Pick one in any colour field with ◆. Changing it here restyles every use.' },
  fonts: { title: 'Fonts', add: 'font', dflt: () => 'system-ui, sans-serif', help: 'A CSS font-family list or a font asset (fonts/Name.ttf).' },
  textStyles: { title: 'Text Styles', add: 'text style', dflt: () => ({ size: 16 }), help: 'Text ▸ Text Style applies these; empty fields keep the Text component\'s own value.' },
};
const tok = () => structuredClone(S.S.P.project.tokens ?? {});
const save = t => { for (const k of Object.keys(t)) if (!Object.keys(t[k]).length) delete t[k]; S.setProjectSetting('tokens', Object.keys(t).length ? t : undefined); };

function tokens(body) {
  const t = tok(), fontAssets = S.S.P.assets.filter(a => a.type === 'font').map(a => a.path);
  const rowHtml = (kind, name, v) => {
    const nm = `<input class="prefs-in tk-name" value="${esc(name)}" spellcheck="false" title="Name (letters, digits, - and _)">`;
    const del = `<button class="tk-x" title="Delete">✕</button>`;
    if (kind === 'colors') return `<tr data-kind="colors" data-name="${esc(name)}"><td>${nm}</td><td><input type="color" class="tk-color" value="${esc(String(v).slice(0, 7))}"> <input class="prefs-in tk-val" value="${esc(v)}" spellcheck="false"></td><td>${del}</td></tr>`;
    if (kind === 'fonts') return `<tr data-kind="fonts" data-name="${esc(name)}"><td>${nm}</td><td><input class="prefs-in tk-val tk-wide" value="${esc(v)}" list="tk-font-assets" spellcheck="false"></td><td>${del}</td></tr>`;
    const f = k => esc(v[k] ?? '');
    return `<tr data-kind="textStyles" data-name="${esc(name)}"><td>${nm}</td><td class="tk-ts">
      <input class="prefs-in" data-f="font" value="${f('font')}" placeholder="font ($token or family)" list="tk-fonts" spellcheck="false">
      <input class="prefs-in" data-f="size" type="number" value="${f('size')}" placeholder="size" title="Size (px)">
      <select class="prefs-in" data-f="weight" title="Weight">${WEIGHTS.map(w => `<option value="${w}"${String(v.weight ?? '') === w ? ' selected' : ''}>${w || 'weight'}</option>`).join('')}</select>
      <input class="prefs-in" data-f="lineHeight" type="number" step="0.05" value="${f('lineHeight')}" placeholder="line h." title="Line height">
      <input class="prefs-in" data-f="letterSpacing" type="number" step="0.1" value="${f('letterSpacing')}" placeholder="spacing" title="Letter spacing (px)"></td><td>${del}</td></tr>`;
  };
  body.innerHTML = `<h3>Design Tokens</h3>
    <datalist id="tk-font-assets">${fontAssets.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
    <datalist id="tk-fonts">${Object.keys(t.fonts ?? {}).map(n => `<option value="$${esc(n)}">`).join('')}</datalist>` +
    Object.entries(KINDS).map(([kind, k]) => `<h4 class="tk-h">${k.title}</h4><p class="prefs-note tk-help">${k.help}</p>
      <table class="tk-table"><tbody>${Object.entries(t[kind] ?? {}).map(([n, v]) => rowHtml(kind, n, v)).join('')}</tbody></table>
      <button class="btn tk-add" data-add="${kind}">Add ${k.add}</button>`).join('');
  const redraw = () => tokens(body);
  body.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    const kind = b.dataset.add, t2 = tok(), g = (t2[kind] ??= {});
    let i = 1; while (g[`${KINDS[kind].add.replace(' ', '-')}-${i}`]) i++;
    g[`${KINDS[kind].add.replace(' ', '-')}-${i}`] = KINDS[kind].dflt();
    save(t2); redraw();
  });
  for (const tr of body.querySelectorAll('tr[data-kind]')) {
    const kind = tr.dataset.kind, name = tr.dataset.name;
    const set = fn => { const t2 = tok(); fn(t2[kind] ??= {}, t2); save(t2); };
    tr.querySelector('.tk-name').onchange = e => {
      const to = e.target.value.trim();
      if (to === name) return;
      if (!/^[\w-]+$/.test(to) || tok()[kind]?.[to]) { S.log(`Token name "${to}" is invalid or taken`, 'warn'); return redraw(); }
      set((g, all) => {
        g[to] = g[name]; delete g[name];
        if (kind === 'fonts') for (const ts of Object.values(all.textStyles ?? {})) if (ts.font === '$' + name) ts.font = '$' + to;
      });
      renameToken(kind, name, to);
      redraw();
    };
    tr.querySelector('.tk-x').onclick = () => {
      const n = tokenUses(kind, name);
      if (n && !confirm(`"${name}" is used ${n} time(s). Delete it anyway? Those places will lose the value.`)) return;
      set(g => delete g[name]); redraw();
    };
    if (kind === 'colors') {
      const c = tr.querySelector('.tk-color'), v = tr.querySelector('.tk-val');
      c.oninput = () => { v.value = c.value; set(g => (g[name] = c.value)); };
      v.onchange = () => { if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.value.trim())) set(g => (g[name] = v.value.trim().toLowerCase())); else redraw(); };
    } else if (kind === 'fonts') tr.querySelector('.tk-val').onchange = e => set(g => (g[name] = e.target.value.trim()));
    else for (const i of tr.querySelectorAll('[data-f]')) i.onchange = () => set(g => {
      const v = i.value.trim(), f = i.dataset.f;
      if (v === '') delete g[name][f]; else g[name][f] = i.type === 'number' ? +v : v;
    });
  }
}

function code(body) {
  body.innerHTML = `
    <h3>Custom Code</h3>
    <label class="prefs-col"><span>Every page's &lt;head&gt;</span><textarea class="prefs-code" data-k="inject.head" spellcheck="false" placeholder="&lt;link rel=&quot;stylesheet&quot; href=&quot;https://fonts.googleapis.com/…&quot;&gt;"></textarea></label>
    <label class="prefs-col"><span>End of every page's &lt;body&gt;</span><textarea class="prefs-code" data-k="inject.bodyEnd" spellcheck="false" placeholder="&lt;script src=&quot;https://analytics.example/script.js&quot; defer&gt;&lt;/script&gt;"></textarea></label>
    <p class="prefs-note">Head code is also used in the editor's Scene (so web fonts show). Body-end code runs only in Play mode
      and on the published site. One page's own head code goes in its Page Meta component.</p>`;
  bind(body);
}

