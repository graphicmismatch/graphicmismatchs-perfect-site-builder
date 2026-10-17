// Editor shell: mounts panels, bottom tabs, splitters.
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
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === name);
  for (const p of tabs.parentElement.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== name;
  try { localStorage.psbTab = name; } catch {}
}
tabs.onclick = e => e.target.dataset.tab && showTab(e.target.dataset.tab);
try { if (localStorage.psbTab) showTab(localStorage.psbTab); } catch {}
S.on('show-tab', showTab);

// splitters
const rootStyle = document.documentElement.style;
for (const s of document.querySelectorAll('.split')) {
  const v = s.dataset.var, dir = +s.dataset.dir, horiz = s.classList.contains('h');
  try { if (localStorage['psb' + v]) rootStyle.setProperty(v, localStorage['psb' + v]); } catch {}
  s.onpointerdown = e => {
    s.setPointerCapture(e.pointerId);
    const start = horiz ? e.clientY : e.clientX;
    const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v));
    s.onpointermove = m => rootStyle.setProperty(v, `${Math.max(120, base + dir * ((horiz ? m.clientY : m.clientX) - start))}px`);
    s.onpointerup = () => { s.onpointermove = null; try { localStorage['psb' + v] = rootStyle.getPropertyValue(v); } catch {} dispatchEvent(new Event('resize')); };
  };
}

S.on('log', e => { document.getElementById('status').textContent = e.msg; });
addEventListener('beforeunload', e => { if (S.S.dirty.size) e.preventDefault(); });
await S.load();
