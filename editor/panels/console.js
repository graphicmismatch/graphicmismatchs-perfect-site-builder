// Console: S.log entries with level filters, collapse, search, and a detail pane (Unity Console).
import * as S from '../state.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const svg = inner => `<svg viewBox="0 0 16 16" width="14" height="14">${inner}</svg>`;
const ICON = {
  info: svg('<circle cx="8" cy="8" r="7" fill="#a8a8a8"/><rect x="7" y="7" width="2" height="5" fill="#2a2a2a"/><rect x="7" y="4" width="2" height="2" fill="#2a2a2a"/>'),
  warn: svg('<path d="M8 1l7.5 13.5H.5z" fill="#e8b730"/><rect x="7" y="5.5" width="2" height="5" fill="#2a2a2a"/><rect x="7" y="11.5" width="2" height="2" fill="#2a2a2a"/>'),
  error: svg('<circle cx="8" cy="8" r="7" fill="#e05252"/><path d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6" stroke="#fff" stroke-width="1.8"/>'),
};
const MAX = 2000;
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const keyOf = e => `${e.level}|${e.source ?? ''}|${e.msg}`;
const store = (k, v) => { try { localStorage['psbCon' + k] = JSON.stringify(v); } catch {} };
const stored = (k, d) => { try { return JSON.parse(localStorage['psbCon' + k] ?? 'null') ?? d; } catch { return d; } };

let entries = [], selected = null, queued = false;
const opts = stored('Opts', { collapse: false, clearOnPlay: true, info: true, warn: true, error: true });

export function mount(el) {
  el.classList.add('con');
  el.innerHTML = `
    <div class="con-bar">
      <button class="con-btn" data-a="clear">Clear</button>
      <button class="con-btn tog" data-o="collapse">Collapse</button>
      <button class="con-btn tog" data-o="clearOnPlay">Clear on Play</button>
      <span class="con-spacer"></span>
      <input class="con-search" type="search" placeholder="Search" spellcheck="false">
      ${['info', 'warn', 'error'].map(l => `<button class="con-btn tog lv" data-o="${l}" title="Show ${l} messages">${ICON[l]}<span>0</span></button>`).join('')}
    </div>
    <div class="con-list" tabindex="0"></div>
    <div class="con-split"></div>
    <div class="con-detail"></div>`;
  const list = el.querySelector('.con-list'), detail = el.querySelector('.con-detail'), search = el.querySelector('.con-search');
  const bar = el.querySelector('.con-bar');

  const syncBar = () => bar.querySelectorAll('[data-o]').forEach(b => b.classList.toggle('on', !!opts[b.dataset.o]));
  function render() {
    queued = false;
    const counts = { info: 0, warn: 0, error: 0 };
    for (const e of entries) counts[e.level] = (counts[e.level] ?? 0) + 1;
    bar.querySelectorAll('.lv').forEach(b => { const n = counts[b.dataset.o]; b.querySelector('span').textContent = n > 999 ? '999+' : n; });
    const q = search.value.trim().toLowerCase();
    const shown = entries.flatMap((e, i) => (opts[e.level] !== false && (!q || e.msg.toLowerCase().includes(q)) ? [{ e, i, n: 1 }] : []));
    let groups = shown;
    if (opts.collapse) {
      const m = new Map();
      for (const g of shown) { const k = keyOf(g.e); m.has(k) ? m.get(k).n++ : m.set(k, g); }
      groups = [...m.values()];
    }
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    const selKey = selected && keyOf(selected);
    list.innerHTML = groups.slice(-1000).map(({ e, i: idx, n }, i) => {
      const [first, ...rest] = e.msg.split('\n');
      const sub = [e.source === 'page' ? '<b>page</b>' : 'editor', esc(rest.find(l => l.trim()) ?? e.stack?.split('\n')[1]?.trim() ?? '')].filter(Boolean).join(' · ');
      const sel = opts.collapse ? keyOf(e) === selKey : e === selected;
      return `<div class="con-ent ${e.level}${sel ? ' sel' : ''}${i % 2 ? ' odd' : ''}" data-i="${idx}">${ICON[e.level] ?? ICON.info}` +
        `<div class="con-txt"><div>[${stamp(e.time)}] ${esc(first)}</div><div class="con-sub">${sub}</div></div>${opts.collapse ? `<span class="con-count">${n}</span>` : ''}</div>`;
    }).join('');
    if (atBottom) list.scrollTop = list.scrollHeight;
    showDetail();
  }
  function showDetail() {
    if (!selected) { detail.innerHTML = ''; return; }
    const { msg, level, time, source, ...extra } = selected;
    const more = Object.entries(extra).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`);
    detail.innerHTML = `<pre>${esc(msg)}\n\n<span>${esc([`${level} · ${time.toLocaleString()} · ${source === 'page' ? 'page (preview iframe)' : 'editor'}`, ...more].join('\n'))}</span></pre>`;
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };

  bar.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'clear') { entries = []; selected = null; }
    if (b.dataset.o) { opts[b.dataset.o] = !opts[b.dataset.o]; store('Opts', opts); syncBar(); }
    schedule();
  };
  search.oninput = schedule;
  list.onclick = e => {
    const r = e.target.closest('.con-ent');
    selected = r ? entries[+r.dataset.i] : null;
    list.querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
    r?.classList.add('sel');
    showDetail();
  };
  list.onkeydown = e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); e.stopPropagation();
    const rows = [...list.children], i = rows.findIndex(r => r.classList.contains('sel'));
    const r = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (r) { r.click(); r.scrollIntoView({ block: 'nearest' }); }
  };

  // detail pane resize
  const split = el.querySelector('.con-split');
  el.style.setProperty('--detail-h', stored('DetailH', 90) + 'px');
  split.onpointerdown = e => {
    split.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = detail.offsetHeight;
    split.onpointermove = m => el.style.setProperty('--detail-h', Math.max(30, Math.min(el.clientHeight - 80, h0 - (m.clientY - y0))) + 'px');
    split.onpointerup = () => { split.onpointermove = null; store('DetailH', detail.offsetHeight); };
  };

  S.on('log', e => {
    entries.push(e);
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
    if (e.level === 'error' && el.hidden) document.querySelector('[data-tab=console]')?.classList.add('alert');
    schedule();
  });
  S.on('show-tab', name => name === 'console' && document.querySelector('[data-tab=console]')?.classList.remove('alert'));
  S.on('play', () => { if (S.S.playing && opts.clearOnPlay) { entries = []; selected = null; schedule(); } });
  syncBar();
  render();
}
