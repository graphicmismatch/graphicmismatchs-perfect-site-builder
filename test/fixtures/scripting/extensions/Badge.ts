// A class-form extension: static HTML at build time, counts clicks on the page.
import { Extension, defineExtension, prop, html, type Color } from '../gpsb/engine.js';
import { shout } from './lib/format.ts';

class Badge extends Extension {
  static props = { label: prop.string('new'), color: prop.color('#3366ff'), clicks: prop.int(0) };
  declare label: string;
  declare color: Color;
  declare clicks: number;

  style() { return { color: this.color, 'font-weight': '700' }; }
  inner() { return html`<span class="badge-text">${shout(this.label)}</span>`; }
  patch(el: HTMLElement) {
    const t = el.querySelector(':scope > .badge-text');
    if (t) t.textContent = shout(this.label) + (this.clicks ? ` x${this.clicks}` : '');
  }
  init(el: HTMLElement) { el.addEventListener('click', () => { this.clicks++; }); }
}

export default defineExtension(Badge);
