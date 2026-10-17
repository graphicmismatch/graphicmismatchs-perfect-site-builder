// Custom component base (components/<Name>.html compile to define(tag, spec, Cls) calls). Browser only.
import { esc } from './components.js';
import { getPath } from './render.js';

const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const JSONISH = /^(vec\d|list|event|json)$/;
const TPL = /\{\{\{\s*([\w$.[\]-]+)\s*\}\}\}|\{\{\s*([\w$.[\]-]+)\s*\}\}/g;
const str = v => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// attribute string -> typed prop value (assets arrive as URLs, so they stay strings)
export function parseProp(schema = {}, raw) {
  const d = () => structuredClone(schema.default);
  if (raw == null) return d();
  const t = schema.type ?? 'string';
  if (t === 'number' || t === 'int') { const n = Number(raw); return raw === '' || isNaN(n) ? d() : t === 'int' ? Math.round(n) : n; }
  if (t === 'bool') return raw !== 'false';
  if (JSONISH.test(t) || (schema.default !== null && typeof schema.default === 'object')) { try { return JSON.parse(raw); } catch { return d(); } }
  return raw;
}

// {{{raw}}} and {{escaped}} (dot paths) against a scope object
export const interpolate = (tpl, scope) => tpl.replace(TPL, (_, raw, e) => (raw ? str(getPath(scope, raw)) : esc(str(getPath(scope, e)))));

export class Component extends HTMLElement {
  static spec = { template: '', style: '', props: {} };
  static get observedAttributes() { return Object.keys(this.spec.props ?? {}).map(kebab); }

  constructor() {
    super();
    this.root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    this.props = {};
    this._attr = {};
    for (const [k, s] of Object.entries(this.constructor.spec.props ?? {})) { this._attr[kebab(k)] = k; this.props[k] = parseProp(s, this.getAttribute(kebab(k))); }
  }

  attributeChangedCallback(attr, old, raw) {
    const k = this._attr[attr];
    if (!k || old === raw) return;
    const v = this.props[k] = parseProp(this.constructor.spec.props[k], raw);
    if (!this._rendered) return; // upgrade: first render happens in connectedCallback
    this.propChanged(k, v);
    if (!this._queued) { this._queued = true; queueMicrotask(() => { this._queued = false; this.refresh(); }); }
  }
  connectedCallback() { if (!this._rendered) this.refresh(); this.connected(); }
  disconnectedCallback() { this.disconnected(); }

  // HTML for the shadow root (style is added by refresh). Override for custom markup.
  render() { return interpolate(this.constructor.spec.template ?? '', this.props); }
  refresh() {
    this.root.innerHTML = `<style>:host{display:block}\n${this.constructor.spec.style ?? ''}</style>${this.render()}`;
    this._rendered = true;
    this.rendered();
  }
  $(sel) { return this.root.querySelector(sel); }
  $$(sel) { return [...this.root.querySelectorAll(sel)]; }
  emit(name, detail) { return this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }
  rendered() {}
  connected() {}
  disconnected() {}
  propChanged() {}
}

export function define(tag, spec, Cls = Component) {
  if (customElements.get(tag)) return customElements.get(tag);
  const C = class extends Cls {};
  C.spec = { template: '', style: '', props: {}, ...spec };
  customElements.define(tag, C);
  return C;
}
