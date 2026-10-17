// Project Settings window (File > Project Settings…): what the build writes. Values live in project.json and are
// saved with the project (Save). Same look as Preferences (.prefs-* in style.css).
import * as S from './state.js';

let win = null;

// section id -> [label, render(body)]
const SECTIONS = {
  general: ['General', general],
  publishing: ['Publishing', publishing],
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

function code(body) {
  body.innerHTML = `
    <h3>Custom Code</h3>
    <label class="prefs-col"><span>Every page's &lt;head&gt;</span><textarea class="prefs-code" data-k="inject.head" spellcheck="false" placeholder="&lt;link rel=&quot;stylesheet&quot; href=&quot;https://fonts.googleapis.com/…&quot;&gt;"></textarea></label>
    <label class="prefs-col"><span>End of every page's &lt;body&gt;</span><textarea class="prefs-code" data-k="inject.bodyEnd" spellcheck="false" placeholder="&lt;script src=&quot;https://analytics.example/script.js&quot; defer&gt;&lt;/script&gt;"></textarea></label>
    <p class="prefs-note">Head code is also used in the editor's Scene (so web fonts show). Body-end code runs only in Play mode
      and on the published site. One page's own head code goes in its Page Meta component.</p>`;
  bind(body);
}

