// Project Settings window (File > Project Settings…): what the build writes. Values live in project.json and are
// saved with the project (Save). Same look as Preferences (.prefs-* in style.css).
import * as S from './state.js';
import { renameToken, tokenUses } from './files.js';
import { THEMES, applyTheme } from '/lib/sections.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
let win = null;

// section id -> [label, render(body)]
const SECTIONS = {
  general: ['General', general],
  publishing: ['Publishing', publishing],
  tokens: ['Design Tokens', tokens],
  languages: ['Languages', languagesSection],
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
    <label class="prefs-row"><span>Keep in output</span><input class="prefs-in" id="ps-keep" placeholder=".git/, CNAME" spellcheck="false"></label>
    <p class="prefs-note">Every build also writes robots.txt and, with a Site URL, sitemap.xml (pages with Page Meta ▸ noindex
      are left out). A page named <b>404</b> is served by hosts for missing addresses. Files in the project's
      <b>public/</b> folder are copied to the site root as they are (CNAME, _redirects, .well-known/, your own robots.txt).
      <b>Keep in output</b> lists files and folders in the output folder that builds never delete: end a folder with /
      (<b>.git/</b> when the output folder is the repository you publish from), write a file as is (<b>CNAME</b>); paths may
      be nested (<b>docs/notes.txt</b>).</p>`;
  bind(body);
  const keep = body.querySelector('#ps-keep'); // comma-separated in the field, a list in project.json
  keep.value = (P().keep ?? []).join(', ');
  keep.onchange = () => { const l = keep.value.split(',').map(s => s.trim()).filter(Boolean); S.setProjectSetting('keep', l.length ? l : undefined); };
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
  const sw = th => ['background', 'surface', 'primary', 'text'].map(c => `<i style="background:${esc(th.tokens.colors[c])}"></i>`).join('');
  body.innerHTML = `<h3>Design Tokens</h3>
    <h4 class="tk-h">Theme</h4><p class="prefs-note tk-help">Sets the colours, fonts and text styles that sections and templates use. Other tokens you added stay.</p>
    <div class="tk-themes">${Object.entries(THEMES).map(([id, th]) => `<button class="tk-theme" data-theme="${id}" title="${esc(th.desc)}"><span class="tk-sw" style="font-family:${esc(th.tokens.fonts.heading)}">${sw(th)}</span>${esc(th.name)}</button>`).join('')}</div>
    <datalist id="tk-font-assets">${fontAssets.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
    <datalist id="tk-fonts">${Object.keys(t.fonts ?? {}).map(n => `<option value="$${esc(n)}">`).join('')}</datalist>` +
    Object.entries(KINDS).map(([kind, k]) => `<h4 class="tk-h">${k.title}</h4><p class="prefs-note tk-help">${k.help}</p>
      <table class="tk-table"><tbody>${Object.entries(t[kind] ?? {}).map(([n, v]) => rowHtml(kind, n, v)).join('')}</tbody></table>
      <button class="btn tk-add" data-add="${kind}">Add ${k.add}</button>`).join('');
  const redraw = () => tokens(body);
  body.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => {
    const th = THEMES[b.dataset.theme];
    if (!confirm(`Apply the ${th.name} theme? Its colours, fonts and text styles replace the ones with the same names.`)) return;
    save(applyTheme(tok(), b.dataset.theme)); redraw(); S.log(`Applied the ${th.name} theme`);
  });
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


// ---------- languages ----------
const COMMON = [['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['sv', 'Svenska'], ['pl', 'Polski'], ['ja', '日本語'], ['zh', '中文'], ['ar', 'العربية']];
function languagesSection(body) {
  const list = S.languages();
  body.innerHTML = `<h3>Languages</h3>
    <p class="prefs-note">The first language is the default: its pages are at the site root. Every other language gets the same pages under
      <code>/&lt;code&gt;/</code> (fr/about.html), with <code>&lt;html lang&gt;</code> and <code>hreflang</code> links set. To translate, pick a language in the
      Scene toolbar and change texts, pictures or links: they become that language's overrides, and the rest stays as in the default.
      Translated data goes in <code>&lt;name&gt;.&lt;code&gt;.json</code> next to a JSON file; words used in many places go in
      <code>assets/locales/&lt;code&gt;.json</code> and are used as <code>{{t:key}}</code>. Add a <b>Language Switcher</b> (Add Component ▸ Navigation) to link the versions.</p>
    <table class="tk-table lg-table"><tbody>${list.map((l, i) => `<tr data-i="${i}"><td><input class="prefs-in lg-code" value="${esc(l.code)}" spellcheck="false" title="Language code (en, fr, pt-BR)"></td>
      <td><input class="prefs-in lg-name" value="${esc(l.name)}" spellcheck="false" title="Name shown to visitors"></td>
      <td>${i ? '<button class="tk-x lg-def" title="Make it the default">↑ Default</button>' : '<span class="prefs-note">default</span>'}</td><td><button class="tk-x lg-del" title="Remove">✕</button></td></tr>`).join('')}</tbody></table>
    <div class="lg-add"><select class="prefs-in lg-pick"><option value="">Add a language…</option>${COMMON.filter(([c]) => !list.some(l => l.code === c)).map(([c, n]) => `<option value="${c}">${esc(n)} (${c})</option>`).join('')}<option value="?">Other…</option></select></div>
    ${list.length === 1 ? '<p class="prefs-note">Add a second language to start translating.</p>' : ''}`;
  const redraw = () => languagesSection(body), save = l => { S.setLanguages(l); redraw(); };
  body.querySelector('.lg-pick').onchange = e => {
    let code = e.target.value, name = COMMON.find(([c]) => c === code)?.[1];
    if (code === '?') { code = prompt('Language code (like ko, pt-BR):')?.trim(); name = code && prompt('Its name, as visitors see it:', code)?.trim(); }
    if (!code || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code) || list.some(l => l.code === code)) { if (code) S.log(`"${code}" is not a language code, or is already there`, 'warn'); return redraw(); }
    // the first language added also names the default (the site's current language)
    const cur = list.length ? list : [{ code: S.S.P.project.languages?.[0]?.code ?? 'en', name: 'English' }];
    save([...cur.filter(l => l.code !== code), { code, name: name || code }]);
  };
  for (const tr of body.querySelectorAll('tr[data-i]')) {
    const i = +tr.dataset.i, l = list.map(x => ({ ...x, from: x.code }));
    tr.querySelector('.lg-code').onchange = e => { const v = e.target.value.trim(); if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v) && !list.some((x, j) => j !== i && x.code === v)) { l[i].code = v; save(l); } else redraw(); };
    tr.querySelector('.lg-name').onchange = e => { l[i].name = e.target.value.trim() || l[i].code; save(l); };
    tr.querySelector('.lg-del').onclick = () => { if (confirm(`Remove ${list[i].name}? Its translations stay in the pages, unused, until you add it again.`)) save(l.filter((_, j) => j !== i)); };
    tr.querySelector('.lg-def')?.addEventListener('click', () => {
      if (!confirm(`Make ${list[i].name} the default? Its pages move to the site root and its translations become the base texts (the current ones become ${list[0].name} translations). This can't be undone with Undo.`)) return;
      S.makeDefaultLanguage(list[i].code); redraw();
    });
  }
}
