// Package Manager window (Window > Package Manager…), like Unity's: the project's npm packages and the npm registry.
// Lists, versions and changes go through the dev server (/api/packages*, pm.js); the files land in packages/.
import * as S from './state.js';
import { h } from './fields.js';

const get = (p, q = {}) => fetch(`${p}?${new URLSearchParams(q)}`).then(r => (r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(t)))));
let win = null;

export function openPackageManager(tab = 'project') {
  win?.close();
  const st = { tab, list: null, outdated: {}, results: [], sel: null, info: null, busy: false, changed: false };
  const q = h('input', { class: 'prefs-in pm-q', placeholder: 'Search npm', spellcheck: 'false' });
  const add = h('input', { class: 'prefs-in pm-add', placeholder: 'name or name@version', spellcheck: 'false' });
  const tabs = h('div', { class: 'prefs-seg' },
    h('button', { 'data-tab': 'project', onclick: () => show('project') }, 'In Project'),
    h('button', { 'data-tab': 'registry', onclick: () => show('registry') }, 'npm Registry'));
  const list = h('div', { class: 'pm-list' }), detail = h('div', { class: 'pm-detail' });
  const status = h('div', { class: 'pm-status' }), reload = h('button', { class: 'btn', hidden: true, onclick: reloadEditor }, 'Save and Reload Editor');
  const ov = h('div', { class: 'prefs-overlay' },
    h('div', { class: 'prefs-win pm-win', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Package Manager' },
      h('header', {}, h('b', {}, 'Package Manager'), h('button', { class: 'prefs-x', title: 'Close (Esc)', onclick: () => close() }, '✕')),
      h('div', { class: 'pm-bar' }, tabs, q, h('span', { class: 'pm-grow' }), add, h('button', { class: 'btn', onclick: () => addSpec() }, 'Add')),
      h('div', { class: 'pm-main' }, list, detail),
      h('footer', { class: 'pm-foot' }, status, reload)));
  document.body.append(ov);
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); };
  const close = () => { removeEventListener('keydown', onKey, true); ov.remove(); win = null; };
  addEventListener('keydown', onKey, true);
  ov.onpointerdown = e => { if (e.target === ov) close(); };
  win = { close };

  const say = (msg, kind = '') => { status.className = `pm-status ${kind}`; status.textContent = msg; };
  const installed = name => st.list?.packages.find(p => p.name === name);

  // ---------- data ----------
  async function loadList() {
    try { st.list = await get('/api/packages'); } catch (e) { say(e.message, 'err'); st.list = { packages: [], dependencies: {} }; }
    drawList();
    get('/api/packages/outdated').then(o => { st.outdated = o; drawList(); if (st.sel) drawDetail(); }, () => {});
  }
  let searchT = 0, searchN = 0;
  function search() {
    clearTimeout(searchT);
    const text = q.value.trim();
    if (st.tab === 'project') return drawList();
    if (!text) { st.results = []; return drawList(); }
    searchT = setTimeout(async () => {
      const n = ++searchN;
      say('Searching…');
      try { const r = await get('/api/packages/search', { q: text }); if (n === searchN) { st.results = r; say(r.length ? '' : 'Nothing found.'); drawList(); } }
      catch (e) { if (n === searchN) say(e.message, 'err'); }
    }, 300);
  }
  async function select(name) {
    st.sel = name; st.info = null;
    drawList(); drawDetail();
    try { const i = await get('/api/packages/info', { name }); if (st.sel === name) { st.info = i; drawDetail(); } }
    catch (e) { if (st.sel === name) { st.info = { error: e.message }; drawDetail(); } }
  }
  async function change(op, body, label) {
    if (st.busy) return;
    st.busy = true; drawDetail();
    say(`${label}… (downloading from npm)`);
    try {
      const r = await S.api.post(`/api/packages/${op}`, body);
      st.list = r.list;
      const what = [r.installed.length && `installed ${r.installed.join(', ')}`, r.removed.length && `removed ${r.removed.join(', ')}`].filter(Boolean).join('; ') || 'nothing to change';
      say(r.warnings.length ? `Done: ${what}. ${r.warnings.join(' · ')}` : `Done: ${what}.`, r.warnings.length ? 'warn' : 'ok');
      S.log(`Packages: ${what}`);
      for (const w of r.warnings) S.log(`Packages: ${w}`, 'warn');
      st.changed = true; reload.hidden = false;
      await S.packagesChanged();
      get('/api/packages/outdated').then(o => { st.outdated = o; drawList(); drawDetail(); }, () => {});
    } catch (e) { say(e.message, 'err'); S.log(`Packages: ${e.message}`, 'error'); }
    st.busy = false;
    drawList(); drawDetail();
  }
  function addSpec() {
    const v = add.value.trim();
    if (v) change('add', { specs: [v] }, `Adding ${v}`).then(() => { add.value = ''; });
  }
  async function reloadEditor() {
    if (S.S.dirty.size) await S.save();
    location.reload();
  }

  // ---------- drawing ----------
  function show(t) {
    st.tab = t;
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    q.placeholder = t === 'project' ? 'Filter' : 'Search npm';
    search(); drawList();
    if (t === 'registry') q.focus();
  }
  const badge = (text, cls = '') => h('span', { class: `pm-badge ${cls}` }, text);
  function row(name, version, tags = [], desc = '') {
    return h('div', { class: `pm-row${st.sel === name ? ' on' : ''}`, onclick: () => select(name), title: desc },
      h('span', { class: 'pm-name' }, name), ...tags, h('span', { class: 'pm-ver' }, version ?? ''));
  }
  function drawList() {
    const f = q.value.trim().toLowerCase();
    if (st.tab === 'registry') {
      list.replaceChildren(...st.results.map(r => row(r.name, r.version, installed(r.name) ? [badge('✓ in project', 'ok')] : [], r.description)));
      if (!st.results.length) list.append(h('p', { class: 'pm-empty' }, q.value.trim() ? '' : 'Type to search the npm registry.'));
      return;
    }
    if (!st.list) return list.replaceChildren(h('p', { class: 'pm-empty' }, 'Loading…'));
    const pk = st.list.packages.filter(p => !f || p.name.toLowerCase().includes(f));
    const direct = pk.filter(p => p.direct), deps = pk.filter(p => !p.direct && !p.typesOnly), types = pk.filter(p => p.typesOnly);
    const up = p => { const o = st.outdated[p.name]; return o?.latest && o.latest !== p.version ? [badge(`↑ ${o.latest}`, 'up')] : []; };
    const group = (title, items, tags) => items.length ? [h('div', { class: 'pm-group' }, title), ...items.map(p => row(p.name, p.version, [...tags(p), ...(p.installed ? [] : [badge('missing', 'err')])], p.description))] : [];
    list.replaceChildren(...group('Packages', direct, up), ...group('Dependencies', deps, () => []), ...group('Types', types, () => []));
    if (!direct.length) list.append(h('p', { class: 'pm-empty' }, f ? 'No match.' : 'No packages yet. Search the npm Registry tab, or type a name above and press Add.'));
  }
  function usage(p) {
    const id = p.name.replace(/^@[^/]+\//, '').replace(/[^\w$]+(\w)?/g, (m, c) => (c ? c.toUpperCase() : '')).replace(/^\d/, '_$&') || 'pkg';
    if (p.format === 'none') return `/* files only: ctx.package('${p.name}/…') / Assets.packageUrl('${p.name}/…') */`;
    if (p.format === 'cjs') return [`import ${id} from '${p.name}';`, p.named?.length ? `import { ${p.named.slice(0, 4).join(', ')}${p.named.length > 4 ? ', …' : ''} } from '${p.name}';` : ''].filter(Boolean).join('\n');
    return `import * as ${id} from '${p.name}';   // or the names it exports`;
  }
  function drawDetail() {
    const name = st.sel, p = name && installed(name), i = st.info;
    if (!name) return detail.replaceChildren(h('p', { class: 'pm-empty' }, 'Select a package.'));
    const versions = i?.versions?.filter(v => !v.includes('-') || v === p?.version) ?? [];
    const pickV = h('select', { class: 'prefs-in pm-vsel', disabled: !versions.length || st.busy },
      ...versions.slice(0, 200).map(v => h('option', { value: v }, v + (v === i?.latest ? '  (latest)' : '') + (v === p?.version ? '  (installed)' : ''))));
    pickV.value = p?.version && versions.includes(p.version) ? p.version : i?.latest ?? '';
    const spec = () => (pickV.value === i?.latest ? name : `${name}@${pickV.value}`);
    const actions = [];
    if (!p || !p.direct) actions.push(h('button', { class: 'btn', disabled: st.busy || !i?.versions, onclick: () => change('add', { specs: [spec()] }, `Installing ${spec()}`) }, p ? 'Add to Project' : 'Install'));
    if (p?.direct) {
      const upd = h('button', { class: 'btn', disabled: st.busy, onclick: () => change('add', { specs: [spec()] }, `Changing ${name} to ${pickV.value}`) }, 'Update');
      const sync = () => { upd.hidden = pickV.value === p.version || pickV.value === st.outdated[name]?.latest; upd.textContent = `${compare(pickV.value, p.version) < 0 ? 'Downgrade' : 'Update'} to ${pickV.value}`; };
      pickV.onchange = sync; sync();
      const latest = st.outdated[name]?.latest;
      if (latest && latest !== p.version) actions.push(h('button', { class: 'btn', disabled: st.busy, onclick: () => change('add', { specs: [name] }, `Updating ${name} to ${latest}`) }, `Update to ${latest}`));
      actions.push(upd, h('button', { class: 'btn', disabled: st.busy, onclick: () => confirm(`Remove ${name} from the project?`) && change('remove', { names: [name] }, `Removing ${name}`) }, 'Remove'));
    }
    const dependents = st.list?.packages.filter(x => x.dependencies?.[name]).map(x => x.name) ?? [];
    detail.replaceChildren(...[
      h('div', { class: 'pm-head' }, h('h3', {}, name), pickV, ...actions),
      i?.error ? h('p', { class: 'pm-err' }, i.error) : !i ? h('p', { class: 'pm-empty' }, 'Loading…') : h('p', {}, i.description || p?.description || 'No description.'),
      i?.deprecated ? h('p', { class: 'pm-err' }, `Deprecated: ${i.deprecated}`) : null,
      h('dl', { class: 'pm-dl' },
        ...kv('License', i?.license || p?.license),
        ...kv('Homepage', i?.homepage && h('a', { href: i.homepage, target: '_blank', rel: 'noopener' }, i.homepage)),
        ...(p ? [
          ...kv('Installed', `${p.version}${p.direct ? ` (packages/manifest.json: "${st.list.dependencies[name]}")` : ''}`),
          ...kv('Module', p.typesOnly ? 'types only (for TypeScript; not published)' : { esm: 'ES module', cjs: 'CommonJS, bundled into an ES module', none: 'files only (no script entry)' }[p.format]),
          ...kv('Types', p.types ? 'included' : st.list.packages.some(x => x.name === `@types/${name.replace(/^@/, '').replace('/', '__')}`) ? `@types/${name.replace(/^@/, '').replace('/', '__')}` : p.typesOnly ? '' : 'none (imports are typed any)'),
          ...kv('Used by', dependents.join(', ')),
          ...kv('Depends on', Object.keys(p.dependencies ?? {}).join(', ')),
        ] : kv('Depends on', Object.keys(i?.dependencies ?? {}).join(', ')))),
      p && !p.typesOnly ? h('div', { class: 'pm-use' }, h('div', { class: 'pm-group' }, 'Use it in a behaviour or extension'), h('pre', {}, usage(p))) : null,
    ].filter(Boolean));
  }
  const kv = (k, v) => (v ? [h('dt', {}, k), h('dd', {}, v)] : []);

  q.oninput = search;
  add.onkeydown = e => { if (e.key === 'Enter') addSpec(); };
  show(tab);
  drawDetail();
  loadList();
}

// semver order of two plain versions (enough for Update / Downgrade labels)
function compare(a, b) {
  const x = String(a).split(/[.-]/).map(n => (isNaN(n) ? n : +n)), y = String(b).split(/[.-]/).map(n => (isNaN(n) ? n : +n));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
