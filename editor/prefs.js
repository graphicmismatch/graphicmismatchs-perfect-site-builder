// User preferences shared by the Project Hub and the editor. Stored by the server in
// ~/.config/perfect-site-builder/prefs.json, so they follow the user across projects and ports.
const H = { 'x-psb': '1', 'content-type': 'application/json' };
export const DEFAULTS = { theme: 'dark', accent: '#3a79bb', fontSize: 12 };
let P = {}, timer;
const subs = new Set();

export async function load() {
  P = await fetch('/api/prefs').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  apply();
  return P;
}
export const get = (k, d = DEFAULTS[k]) => P[k] ?? d;
export const all = () => ({ ...DEFAULTS, ...P });
// undefined resets to the default
export function set(k, v) {
  if (v === undefined) delete P[k]; else P[k] = v;
  apply();
  for (const f of subs) f(k, v);
  clearTimeout(timer);
  timer = setTimeout(() => fetch('/api/prefs', { method: 'PUT', headers: H, body: JSON.stringify(P) }).catch(() => {}), 300);
}
export const onChange = fn => (subs.add(fn), () => subs.delete(fn));

// theme tokens live in editor/style.css under :root[data-theme=…]; accent / font size are variables on top
export function apply(doc = document) {
  const r = doc.documentElement;
  r.dataset.theme = get('theme');
  r.style.setProperty('--accent-hi', get('accent'));
  r.style.setProperty('--ui-font-size', `${get('fontSize')}px`);
}
