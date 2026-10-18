// More built-in components (merged into the registry by components.js): Icon, Divider, Marquee, Countdown,
// NavigationMenu, SocialLinks, Carousel, Tabs, Accordion, Modal, Gallery, VideoEmbed, Map, plus the shared lightbox.
// Same definition format as components.js. Everything renders real HTML at build time; init adds the interaction.
// Colours and sizes are CSS variables set in style(), so animation, breakpoints and scripts can change them.
let ICONS = null, BRANDS = null; // lib/icons.js: loaded in Node (build) here, by the editor, and on demand in pages
export const setIcons = m => { ICONS = m.ICONS; BRANDS = m.BRANDS; };
export const iconNames = () => Object.keys(ICONS ?? {});
if (typeof document === 'undefined') setIcons(await import('./icons.js'));
const loadIcons = () => (ICONS ? Promise.resolve() : import('./icons.js').then(setIcons));

export default ({ esc, markdown }) => {
  const icon = (name, sw = 2, cls = 'gpsb-icon') => (ICONS?.[name] != null
    ? `<svg class="${cls}" data-icon="${esc(name)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${+sw || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
    : `<svg class="${cls}" data-icon="${esc(name)}" viewBox="0 0 24 24" aria-hidden="true"></svg>`);
  const brandOf = url => {
    if (/^mailto:/i.test(url)) return { title: 'Email', icon: 'mail' };
    if (/^tel:/i.test(url)) return { title: 'Phone', icon: 'phone' };
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* not a URL */ }
    const b = Object.values(BRANDS ?? {}).find(x => x.hosts.some(h => host === h || host.endsWith('.' + h)));
    return b ?? { title: host || 'Link', icon: 'globe' };
  };
  const lines = t => String(t ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const fire = (el, type, detail) => el.dispatchEvent(new CustomEvent('gpsb:' + type, { detail, bubbles: true }));
  const kids = el => [...el.children].filter(c => c.dataset.gpsb);
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const props = (GPSB, el, ci) => GPSB.nodeFor(el).components[ci].props;
  // what patch() last rendered into an element, per component: re-render only when it changes
  const seen = new WeakMap(), changed = (el, k, v) => { const m = seen.get(el) ?? seen.set(el, {}).get(el), first = !(k in m); if (m[k] === v) return false; m[k] = v; return first ? 'first' : true; };

  // ---------- countdown ----------
  const UNITS = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
  const left = until => Math.max(0, Math.floor((Date.parse(until) - Date.now()) / 1000)) || 0;
  const cdParts = (p, secs) => {
    const show = { d: p.days, h: p.hours, m: p.minutes, s: p.seconds }, labels = String(p.labels).split(',').map(s => s.trim());
    let rest = secs;
    return UNITS.map(([k, n], i) => {
      if (!show[k]) return null;
      const v = Math.floor(rest / n); rest -= v * n;
      return { k, v: k === 'd' ? String(v) : String(v).padStart(2, '0'), label: labels[i] ?? '' };
    }).filter(Boolean);
  };
  const cdHTML = (p, secs) => (secs <= 0 && p.doneText ? `<span class="gpsb-cd-done">${esc(p.doneText)}</span>`
    : cdParts(p, secs).map(x => `<span class="gpsb-cd-u"><b data-k="${x.k}">${x.v}</b>${x.label ? `<small>${esc(x.label)}</small>` : ''}</span>`).join(''));
  const cdSet = (el, p) => {
    const h = cdHTML(p, left(p.until));
    if (!changed(el, 'cd', h)) return;
    el.querySelectorAll(':scope > .gpsb-cd-u, :scope > .gpsb-cd-done').forEach(x => x.remove());
    el.insertAdjacentHTML('afterbegin', h);
  };

  // ---------- navigation ----------
  const navItems = (p, ctx) => lines(p.items).map(l => { const [label, link = ''] = l.split('|').map(s => s.trim()); return { label, href: ctx?.href ? ctx.href(link || '#') : link }; });
  const navHTML = (p, ctx) => `<ul class="gpsb-nav-list">${navItems(p, ctx).map(i => `<li><a href="${esc(i.href)}">${esc(i.label)}</a></li>`).join('')}</ul>`;
  const BURGER = '<button type="button" class="gpsb-burger" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>';

  // ---------- accordion ----------
  // "## Question" lines start an item; what follows (Markdown) is the answer
  const faq = text => {
    const out = [];
    for (const l of String(text ?? '').split('\n')) {
      const m = /^#{1,6}\s+(.*)$/.exec(l);
      if (m) out.push({ q: m[1].trim(), a: [] }); else if (out.length) out.at(-1).a.push(l);
    }
    return out.map(x => ({ q: x.q, a: x.a.join('\n').trim() }));
  };
  const accHTML = (p, ctx, id) => faq(p.items).map((x, i) => `<details class="gpsb-acc"${p.allowMultiple ? '' : ` name="gpsb-acc-${esc(id ?? '')}"`}${p.firstOpen && i === 0 ? ' open' : ''}><summary>${esc(x.q)}</summary><div class="gpsb-acc-a">${markdown(x.a, { href: h => ctx.href(h), asset: a => ctx.asset(a) })}</div></details>`).join('');

  // ---------- media ----------
  const youtubeId = u => /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(u)?.[1] ?? null;
  const vimeoId = u => /vimeo\.com\/(?:video\/)?(\d+)/.exec(u)?.[1] ?? null;
  const embedUrl = p => {
    const y = youtubeId(p.url), v = vimeoId(p.url);
    if (y) return `https://www.${p.privacy ? 'youtube-nocookie' : 'youtube'}.com/embed/${y}?autoplay=1&rel=0`;
    if (v) return `https://player.vimeo.com/video/${v}?autoplay=1${p.privacy ? '&dnt=1' : ''}`;
    return null;
  };
  const mapUrl = p => {
    if (p.provider === 'google') return `https://maps.google.com/maps?q=${encodeURIComponent(p.query || `${p.lat},${p.lng}`)}&z=${p.zoom}&output=embed`;
    const dLng = 360 / 2 ** p.zoom, dLat = dLng * 0.6 * Math.cos((p.lat * Math.PI) / 180), f = n => n.toFixed(5);
    return `https://www.openstreetmap.org/export/embed.html?bbox=${f(p.lng - dLng / 2)},${f(p.lat - dLat / 2)},${f(p.lng + dLng / 2)},${f(p.lat + dLat / 2)}&layer=mapnik${p.marker ? `&marker=${f(p.lat)},${f(p.lng)}` : ''}`;
  };
  const galleryHTML = (p, ctx) => p.images.map((img, i) => {
    const im = `<img src="${esc(ctx.asset(img))}" alt="${esc((p.alts ?? [])[i] ?? '')}" loading="lazy" decoding="async">`;
    return p.lightbox ? `<button type="button" class="gpsb-gal-item" data-i="${i}" aria-label="Open image ${i + 1}">${im}</button>` : `<div class="gpsb-gal-item">${im}</div>`;
  }).join('');

  // ---------- carousel / tabs: which child is showing ----------
  // the visible child without JavaScript (and in the editor): number `start`, counted among the object's children
  const nth = (sel, i) => `${sel} > [data-gpsb]:nth-child(${(i | 0) + 1} of [data-gpsb])`;

  return {
    Icon: {
      category: 'UI',
      props: {
        icon: { type: 'string', default: 'star', icon: true, help: 'one of the built-in icons (Lucide)' },
        color: { type: 'color', default: '#202020' },
        strokeWidth: { type: 'number', default: 2, min: 0.5, max: 4, step: 0.25 },
        label: { type: 'string', default: '', help: 'what it means, for screen readers (empty = decorative)' },
      },
      style: p => ({ color: p.color, display: 'block' }),
      attrs: p => (p.label ? { role: 'img', 'aria-label': p.label } : { 'aria-hidden': 'true' }),
      inner: p => icon(p.icon, p.strokeWidth),
      rules: (p, sel) => `${sel} > .gpsb-icon { width: 100%; height: 100%; display: block; }`,
      patch(el, p) {
        const s = el.querySelector(':scope > .gpsb-icon');
        if (s && (s.dataset.icon !== p.icon || s.getAttribute('stroke-width') !== String(+p.strokeWidth || 2))) loadIcons().then(() => { s.outerHTML = icon(p.icon, p.strokeWidth); });
      },
    },
    Divider: {
      category: 'UI',
      props: {
        orientation: { type: 'enum', options: ['horizontal', 'vertical'], default: 'horizontal' },
        thickness: { type: 'number', default: 1, min: 0.5, max: 12, step: 0.5 },
        color: { type: 'color', default: '#d0d0d0' },
        lineStyle: { type: 'enum', options: ['solid', 'dashed', 'dotted', 'double'], default: 'solid' },
        inset: { type: 'number', default: 0, help: 'space left free at both ends (px)' },
      },
      style: p => ({ '--gpsb-line': `${p.thickness}px ${p.lineStyle} ${p.color}`, '--gpsb-inset': `${p.inset}px` }),
      attrs: p => ({ role: 'separator', 'aria-orientation': p.orientation }),
      rules: (p, sel) => p.orientation === 'vertical'
        ? `${sel}::before { content: ''; position: absolute; top: var(--gpsb-inset); bottom: var(--gpsb-inset); left: 50%; border-left: var(--gpsb-line); transform: translateX(-50%); }`
        : `${sel}::before { content: ''; position: absolute; left: var(--gpsb-inset); right: var(--gpsb-inset); top: 50%; border-top: var(--gpsb-line); transform: translateY(-50%); }`,
    },
    Marquee: {
      category: 'UI',
      props: {
        text: { type: 'string', default: 'Free shipping on all orders  •  New collection out now  •' },
        speed: { type: 'number', default: 60, min: 5, max: 400, help: 'pixels per second' },
        direction: { type: 'enum', options: ['left', 'right'], default: 'left' },
        gap: { type: 'number', default: 48 },
        color: { type: 'color', default: '#202020' },
        size: { type: 'number', default: 18 },
        weight: { type: 'enum', options: ['400', '500', '600', '700', '800'], default: '600' },
        pauseOnHover: { type: 'bool', default: true },
      },
      style: p => ({ color: p.color, 'font-size': `${p.size}px`, 'font-weight': p.weight, overflow: 'hidden', display: 'flex', 'align-items': 'center',
        '--gpsb-mq-gap': `${p.gap}px`, '--gpsb-mq-dur': `${Math.max(2, (String(p.text).length * p.size * 0.55 + p.gap) / p.speed).toFixed(2)}s` }),
      inner: p => `<div class="gpsb-mq" data-dir="${p.direction}"><span>${esc(p.text)}</span><span aria-hidden="true">${esc(p.text)}</span></div>`,
      rules: (p, sel) => [`${sel} > .gpsb-mq { display: flex; flex: none; gap: var(--gpsb-mq-gap); white-space: nowrap; animation: gpsb-mq var(--gpsb-mq-dur) linear infinite; }`,
        `${sel} > .gpsb-mq > span { padding-right: 0; }`, `${sel} > .gpsb-mq[data-dir="right"] { animation-direction: reverse; }`,
        p.pauseOnHover && `${sel}:hover > .gpsb-mq { animation-play-state: paused; }`,
        '@keyframes gpsb-mq { from { transform: translateX(0); } to { transform: translateX(calc(-50% - var(--gpsb-mq-gap) / 2)); } }',
        `@media (prefers-reduced-motion: reduce) { ${sel} > .gpsb-mq { animation: none; } }`].filter(Boolean).join('\n'),
      patch(el, p) { el.querySelectorAll(':scope > .gpsb-mq > span').forEach(s => { if (s.textContent !== p.text) s.textContent = p.text; }); el.querySelector(':scope > .gpsb-mq')?.setAttribute('data-dir', p.direction); },
    },
    Countdown: {
      category: 'UI',
      props: {
        until: { type: 'string', default: '2030-01-01T00:00:00Z', help: 'date and time to count down to (ISO, e.g. 2030-01-01T09:00:00+01:00)' },
        days: { type: 'bool', default: true }, hours: { type: 'bool', default: true }, minutes: { type: 'bool', default: true }, seconds: { type: 'bool', default: true },
        labels: { type: 'string', default: 'days, hours, minutes, seconds' },
        doneText: { type: 'string', default: '', help: 'shown when the time is up (empty = zeros)' },
        color: { type: 'color', default: '#202020' },
        size: { type: 'number', default: 36 },
        labelSize: { type: 'number', default: 12 },
        gap: { type: 'number', default: 16 },
        onComplete: { type: 'event', default: [], on: 'gpsb:done' },
      },
      style: p => ({ color: p.color, display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: `${p.gap}px`, '--gpsb-cd-size': `${p.size}px`, '--gpsb-cd-label': `${p.labelSize}px`, 'font-variant-numeric': 'tabular-nums' }),
      attrs: () => ({ role: 'timer' }),
      inner: p => cdHTML(p, left(p.until)),
      rules: (p, sel) => `${sel} .gpsb-cd-u { display: flex; flex-direction: column; align-items: center; line-height: 1; }\n${sel} .gpsb-cd-u b { font-size: var(--gpsb-cd-size); }\n${sel} .gpsb-cd-u small { font-size: var(--gpsb-cd-label); margin-top: .4em; opacity: .7; text-transform: uppercase; letter-spacing: .06em; }\n${sel} .gpsb-cd-done { font-size: var(--gpsb-cd-size); }`,
      patch: (el, p) => cdSet(el, p),
      init({ el, GPSB, ci }) {
        let done = false;
        const tick = () => {
          const p = props(GPSB, el, ci), secs = left(p.until);
          cdSet(el, p);
          if (secs <= 0 && !done) { done = true; fire(el, 'done', { until: p.until }); }
        };
        tick();
        setInterval(tick, 1000);
      },
    },
    NavigationMenu: {
      category: 'Navigation',
      props: {
        items: { type: 'text', default: 'Home | index\nAbout | about\nContact | #contact', help: 'one link per line: Label | page, URL or #anchor' },
        orientation: { type: 'enum', options: ['horizontal', 'vertical'], default: 'horizontal' },
        align: { type: 'enum', options: ['start', 'center', 'end', 'space-between'], default: 'end' },
        gap: { type: 'number', default: 28 },
        color: { type: 'color', default: '#202020' },
        hoverColor: { type: 'color', default: '#3366ff' },
        activeColor: { type: 'color', default: '#3366ff', help: 'the link to the current page' },
        size: { type: 'number', default: 16 },
        weight: { type: 'enum', options: ['400', '500', '600', '700'], default: '500' },
        collapseBelow: { type: 'int', default: 768, help: 'screen width (px) under which the links fold into a ☰ menu (0 = never)' },
        menuBackground: { type: 'color', default: '#ffffff' },
      },
      tag: () => 'nav',
      style: p => ({ '--gpsb-nav-c': p.color, '--gpsb-nav-h': p.hoverColor, '--gpsb-nav-a': p.activeColor, '--gpsb-nav-bg': p.menuBackground, '--gpsb-nav-gap': `${p.gap}px`, 'font-size': `${p.size}px`, 'font-weight': p.weight }),
      attrs: () => ({ 'aria-label': 'Main' }),
      inner: (p, ctx) => BURGER + navHTML(p, ctx),
      rules: (p, sel) => [
        `${sel} > .gpsb-nav-list { display: flex; flex-direction: ${p.orientation === 'vertical' ? 'column' : 'row'}; justify-content: ${p.align === 'start' || p.align === 'end' ? 'flex-' + p.align : p.align}; align-items: ${p.orientation === 'vertical' ? 'flex-start' : 'center'}; gap: var(--gpsb-nav-gap); list-style: none; margin: 0; padding: 0; width: 100%; height: 100%; }`,
        `${sel} a { color: var(--gpsb-nav-c); text-decoration: none; transition: color .15s; }`,
        `${sel} a:hover, ${sel} a:focus-visible { color: var(--gpsb-nav-h); }`,
        `${sel} a[aria-current="page"] { color: var(--gpsb-nav-a); }`,
        `${sel} > .gpsb-burger { display: none; position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 40px; height: 40px; border: 0; background: none; padding: 8px; cursor: pointer; flex-direction: column; justify-content: space-around; }`,
        `${sel} > .gpsb-burger span { display: block; height: 2px; border-radius: 1px; background: var(--gpsb-nav-c); transition: transform .2s, opacity .2s; }`,
        p.collapseBelow > 0 && `@media (max-width: ${p.collapseBelow}px) {
  ${sel} > .gpsb-burger { display: flex; }
  ${sel} > .gpsb-nav-list { display: none; position: absolute; top: 100%; right: 0; min-width: 220px; width: auto; height: auto; flex-direction: column; align-items: stretch; gap: 0; padding: 8px 0; background: var(--gpsb-nav-bg); box-shadow: 0 8px 24px rgba(0,0,0,.15); border-radius: 8px; z-index: 1000; }
  ${sel} > .gpsb-nav-list a { display: block; padding: 10px 20px; }
  ${sel}[data-open] > .gpsb-nav-list { display: flex; }
  ${sel}[data-open] > .gpsb-burger span:nth-child(1) { transform: translateY(9px) rotate(45deg); }
  ${sel}[data-open] > .gpsb-burger span:nth-child(2) { opacity: 0; }
  ${sel}[data-open] > .gpsb-burger span:nth-child(3) { transform: translateY(-9px) rotate(-45deg); }
}`].filter(Boolean).join('\n'),
      patch(el, p, ctx) { const ul = el.querySelector(':scope > .gpsb-nav-list'), h = navHTML(p, ctx); if (ul && ul.outerHTML !== h) { ul.outerHTML = h; markCurrent(el); } },
      init({ el }) {
        const b = el.querySelector(':scope > .gpsb-burger');
        const set = on => { el.toggleAttribute('data-open', on); b?.setAttribute('aria-expanded', String(on)); };
        b?.addEventListener('click', () => set(!el.hasAttribute('data-open')));
        el.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.hasAttribute('data-open')) { set(false); b?.focus(); } });
        document.addEventListener('pointerdown', e => { if (!el.contains(e.target)) set(false); });
        markCurrent(el);
      },
      methods: {
        open: el => { el.setAttribute('data-open', ''); el.querySelector(':scope > .gpsb-burger')?.setAttribute('aria-expanded', 'true'); },
        close: el => { el.removeAttribute('data-open'); el.querySelector(':scope > .gpsb-burger')?.setAttribute('aria-expanded', 'false'); },
        toggle: el => el.querySelector(':scope > .gpsb-burger')?.click(),
      },
    },
    SocialLinks: {
      category: 'Navigation',
      props: {
        links: { type: 'text', default: 'https://instagram.com/\nhttps://x.com/\nhttps://youtube.com/\nmailto:hello@example.com', help: 'one link per line; the icon comes from the address' },
        size: { type: 'number', default: 24 },
        gap: { type: 'number', default: 14 },
        color: { type: 'color', default: '#202020' },
        brandColors: { type: 'bool', default: false, help: "each network's own colour" },
        shape: { type: 'enum', options: ['none', 'circle', 'square'], default: 'none' },
        background: { type: 'color', default: '#f0f0f0', help: 'circle / square' },
        newTab: { type: 'bool', default: true },
      },
      style: p => ({ display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: `${p.gap}px`, color: p.color, '--gpsb-sl-size': `${p.size}px`, '--gpsb-sl-bg': p.background }),
      inner: p => lines(p.links).map(url => {
        const b = brandOf(url), svg = b.path ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${b.path}"/></svg>` : icon(b.icon);
        return `<a class="gpsb-sl" href="${esc(url)}" aria-label="${esc(b.title)}"${p.newTab && /^https?:/i.test(url) ? ' target="_blank" rel="noopener"' : ''}${p.brandColors && b.color ? ` style="color:${b.color}"` : ''}>${svg}</a>`;
      }).join(''),
      rules: (p, sel) => `${sel} > .gpsb-sl { display: inline-flex; color: inherit; width: var(--gpsb-sl-size); height: var(--gpsb-sl-size); transition: transform .15s, opacity .15s; }\n${sel} > .gpsb-sl:hover { transform: translateY(-2px); opacity: .85; }\n${sel} > .gpsb-sl svg { width: 100%; height: 100%; }`
        + (p.shape !== 'none' ? `\n${sel} > .gpsb-sl { box-sizing: content-box; padding: calc(var(--gpsb-sl-size) * .35); background: var(--gpsb-sl-bg); border-radius: ${p.shape === 'circle' ? '50%' : '6px'}; }` : ''),
    },
    Carousel: {
      category: 'Interactive',
      props: {
        autoplay: { type: 'bool', default: true },
        interval: { type: 'number', default: 5, min: 1, max: 30, help: 'seconds per slide' },
        transition: { type: 'enum', options: ['slide', 'fade'], default: 'slide' },
        duration: { type: 'number', default: 0.5, min: 0.1, max: 2, step: 0.05 },
        loop: { type: 'bool', default: true },
        arrows: { type: 'bool', default: true },
        dots: { type: 'bool', default: true },
        pauseOnHover: { type: 'bool', default: true },
        startSlide: { type: 'int', default: 0, help: 'the slide shown first (and while you edit: change it to work on another slide)' },
        controlColor: { type: 'color', default: '#ffffff' },
        label: { type: 'string', default: 'Slideshow' },
        onChange: { type: 'event', default: [], on: 'gpsb:change' },
      },
      style: p => ({ overflow: 'hidden', '--gpsb-car-c': p.controlColor, '--gpsb-car-d': `${p.duration}s` }),
      attrs: p => ({ role: 'region', 'aria-roledescription': 'carousel', 'aria-label': p.label, tabindex: '0' }),
      // slides: every child, filling the carousel
      childStyle: p => ({ position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', transition: `transform var(--gpsb-car-d) ease, opacity var(--gpsb-car-d) ease, visibility var(--gpsb-car-d)` }),
      inner: (p, ctx, node) => {
        const n = node?.children?.length ?? 0;
        return (p.arrows ? `<button type="button" class="gpsb-car-btn" data-dir="-1" aria-label="Previous slide">${icon('chevron-left')}</button><button type="button" class="gpsb-car-btn" data-dir="1" aria-label="Next slide">${icon('chevron-right')}</button>` : '')
          + (p.dots && n > 1 ? `<div class="gpsb-car-dots">${Array.from({ length: n }, (_, i) => `<button type="button" aria-label="Slide ${i + 1}"${i === p.startSlide ? ' aria-current="true"' : ''}></button>`).join('')}</div>` : '');
      },
      rules: (p, sel) => [
        p.transition === 'fade'
          ? `${sel} > [data-gpsb] { opacity: 0; visibility: hidden; }`
          : `${sel} > [data-gpsb] { transform: translateX(100%); visibility: hidden; }\n${sel} > [data-gpsb][data-slide="before"] { transform: translateX(-100%); }`,
        `${nth(sel, p.startSlide)}:not([data-slide]), ${sel} > [data-gpsb][data-slide="current"] { transform: none; opacity: 1; visibility: visible; z-index: 1; }`,
        `${sel} > [data-gpsb][data-slide="before"], ${sel} > [data-gpsb][data-slide="after"] { visibility: visible; }`,
        `${sel} > [data-jump] { transition: none !important; }`,
        `${sel} > .gpsb-car-btn { position: absolute; top: 50%; z-index: 3; transform: translateY(-50%); width: 44px; height: 44px; border: 0; border-radius: 50%; background: rgba(0,0,0,.28); color: var(--gpsb-car-c); cursor: pointer; padding: 10px; display: grid; place-items: center; }`,
        `${sel} > .gpsb-car-btn:hover { background: rgba(0,0,0,.45); }`,
        `${sel} > .gpsb-car-btn[data-dir="-1"] { left: 12px; }\n${sel} > .gpsb-car-btn[data-dir="1"] { right: 12px; }\n${sel} > .gpsb-car-btn svg { width: 24px; height: 24px; }`,
        `${sel} > .gpsb-car-dots { position: absolute; left: 0; right: 0; bottom: 14px; z-index: 3; display: flex; justify-content: center; gap: 8px; }`,
        `${sel} > .gpsb-car-dots button { width: 10px; height: 10px; border-radius: 50%; border: 0; padding: 0; background: var(--gpsb-car-c); opacity: .45; cursor: pointer; }`,
        `${sel} > .gpsb-car-dots button[aria-current="true"] { opacity: 1; }`,
        `@media (prefers-reduced-motion: reduce) { ${sel} > [data-gpsb] { transition: none !important; } }`].join('\n'),
      state: { events: ['gpsb:change'], read: el => Number(el.dataset.current ?? 0) },
      init({ el, GPSB, ci }) {
        const p0 = props(GPSB, el, ci), slides = kids(el), n = slides.length;
        if (!n) return;
        let cur = Math.min(Math.max(0, p0.startSlide | 0), n - 1), timer = 0, paused = false, gen = 0;
        // once the transition is over, the slide that left is hidden (moved back without animating)
        const jump = (s, state) => { s.setAttribute('data-jump', ''); s.dataset.slide = state; void s.offsetWidth; s.removeAttribute('data-jump'); };
        const settle = g => g === gen && slides.forEach((s, k) => k !== cur && s.dataset.slide !== 'hidden' && jump(s, 'hidden'));
        slides.forEach((s, i) => { s.setAttribute('role', 'group'); s.setAttribute('aria-roledescription', 'slide'); s.setAttribute('aria-label', `${i + 1} of ${n}`); });
        const show = (i, dir = Math.sign(i - cur) || 1) => {
          const p = props(GPSB, el, ci);
          i = p.loop ? ((i % n) + n) % n : Math.min(Math.max(0, i), n - 1);
          if (i === cur && el.dataset.current != null) return;
          const from = cur;
          if (p.transition === 'slide' && el.dataset.current != null) jump(slides[i], dir > 0 ? 'after' : 'before'); // the new slide starts on the side it comes from
          slides.forEach((s, k) => { s.dataset.slide = k === i ? 'current' : k === from && el.dataset.current != null ? (dir > 0 ? 'before' : 'after') : 'hidden'; s.toggleAttribute('inert', k !== i); });
          cur = i; el.dataset.current = String(i);
          const g = ++gen;
          setTimeout(() => settle(g), p.duration * 1000 + 50);
          el.querySelectorAll(':scope > .gpsb-car-dots button').forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
          fire(el, 'change', { index: i, count: n });
        };
        const go = d => show(cur + d, d);
        const restart = () => { clearInterval(timer); const p = props(GPSB, el, ci); if (p.autoplay && !paused && n > 1 && !reduced()) timer = setInterval(() => go(1), Math.max(1, p.interval) * 1000); };
        el.gpsbCarousel = { go, show: i => { show(i); restart(); }, play: () => { paused = false; restart(); }, pause: () => { paused = true; clearInterval(timer); } };
        el.querySelectorAll(':scope > .gpsb-car-btn').forEach(b => b.addEventListener('click', () => { go(+b.dataset.dir); restart(); }));
        el.querySelectorAll(':scope > .gpsb-car-dots button').forEach((b, k) => b.addEventListener('click', () => { show(k); restart(); }));
        el.addEventListener('keydown', e => { if (e.target !== el) return; if (e.key === 'ArrowRight') { go(1); restart(); } if (e.key === 'ArrowLeft') { go(-1); restart(); } });
        if (p0.pauseOnHover) { el.addEventListener('pointerenter', () => clearInterval(timer)); el.addEventListener('pointerleave', restart); }
        el.addEventListener('focusin', () => clearInterval(timer)); el.addEventListener('focusout', restart);
        let x0 = null; // swipe
        el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') x0 = e.clientX; });
        el.addEventListener('pointerup', e => { if (x0 != null && Math.abs(e.clientX - x0) > 40) { go(e.clientX < x0 ? 1 : -1); restart(); } x0 = null; });
        show(cur); restart();
      },
      methods: {
        next: el => el.gpsbCarousel?.go(1), prev: el => el.gpsbCarousel?.go(-1),
        goTo: (el, arg) => el.gpsbCarousel?.show((parseInt(arg, 10) || 1) - 1), // 1-based, as people count
        play: el => el.gpsbCarousel?.play(), pause: el => el.gpsbCarousel?.pause(),
      },
    },
    Tabs: {
      category: 'Interactive',
      props: {
        startTab: { type: 'int', default: 0, help: 'the tab shown first (and while you edit)' },
        barHeight: { type: 'number', default: 48 },
        align: { type: 'enum', options: ['start', 'center', 'end', 'stretch'], default: 'start' },
        size: { type: 'number', default: 15 },
        textColor: { type: 'color', default: '#555555' },
        activeTextColor: { type: 'color', default: '#111111' },
        indicatorColor: { type: 'color', default: '#3366ff' },
        barColor: { type: 'color', default: '#00000000' },
        lineColor: { type: 'color', default: '#e2e2e2' },
        onChange: { type: 'event', default: [], on: 'gpsb:change' },
      },
      style: p => ({ '--gpsb-tab-h': `${p.barHeight}px`, '--gpsb-tab-c': p.textColor, '--gpsb-tab-a': p.activeTextColor, '--gpsb-tab-i': p.indicatorColor, '--gpsb-tab-bg': p.barColor, '--gpsb-tab-line': p.lineColor, 'font-size': `${p.size}px` }),
      // panels: every child, under the tab bar; each tab is labelled with its panel's object name
      childStyle: () => ({ position: 'absolute', left: '0', right: '0', top: 'var(--gpsb-tab-h)', bottom: '0', width: 'auto', height: 'auto' }),
      inner: (p, ctx, node) => `<div class="gpsb-tablist" role="tablist">${(node?.children ?? []).map((c, i) => `<button type="button" role="tab" aria-selected="${i === p.startTab}" tabindex="${i === p.startTab ? 0 : -1}">${esc(c.name)}</button>`).join('')}</div>`,
      rules: (p, sel) => [
        `${sel} > .gpsb-tablist { position: absolute; left: 0; right: 0; top: 0; height: var(--gpsb-tab-h); display: flex; justify-content: ${p.align === 'start' || p.align === 'end' ? 'flex-' + p.align : 'center'}; background: var(--gpsb-tab-bg); border-bottom: 1px solid var(--gpsb-tab-line); }`,
        `${sel} > .gpsb-tablist [role="tab"] { ${p.align === 'stretch' ? 'flex: 1;' : ''} border: 0; background: none; padding: 0 20px; font: inherit; color: var(--gpsb-tab-c); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }`,
        `${sel} > .gpsb-tablist [role="tab"][aria-selected="true"] { color: var(--gpsb-tab-a); border-bottom-color: var(--gpsb-tab-i); }`,
        `${sel} > [data-gpsb] { visibility: hidden; }`,
        `${nth(sel, p.startTab)}:not([data-tab]), ${sel} > [data-gpsb][data-tab="active"] { visibility: visible; }`].join('\n'),
      state: { events: ['gpsb:change'], read: el => Number(el.dataset.current ?? 0) },
      init({ el, GPSB, ci }) {
        const panels = kids(el), tabs = [...el.querySelectorAll(':scope > .gpsb-tablist [role="tab"]')], id = el.dataset.gpsb;
        panels.forEach((pn, i) => { pn.setAttribute('role', 'tabpanel'); pn.id ||= `${id}-panel-${i}`; tabs[i]?.setAttribute('aria-controls', pn.id); if (tabs[i]) { tabs[i].id ||= `${id}-tab-${i}`; pn.setAttribute('aria-labelledby', tabs[i].id); } });
        const select = (i, focus) => {
          i = Math.min(Math.max(0, i), panels.length - 1);
          tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
          panels.forEach((pn, k) => { pn.dataset.tab = k === i ? 'active' : 'hidden'; });
          if (focus) tabs[i]?.focus();
          if (el.dataset.current !== String(i)) { el.dataset.current = String(i); fire(el, 'change', { index: i, name: GPSB.nodeFor(panels[i])?.name }); }
        };
        el.gpsbTabs = { select };
        tabs.forEach((t, i) => {
          t.addEventListener('click', () => select(i));
          t.addEventListener('keydown', e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); select((i + d + tabs.length) % tabs.length, true); } if (e.key === 'Home') select(0, true); if (e.key === 'End') select(tabs.length - 1, true); });
        });
        select(props(GPSB, el, ci).startTab | 0);
      },
      methods: { select: (el, arg) => el.gpsbTabs?.select((parseInt(arg, 10) || 1) - 1) },
    },
    Accordion: {
      category: 'Interactive',
      props: {
        items: { type: 'text', default: '## What is this?\nA question and its answer. Answers can use **Markdown**.\n\n## How do I add a question?\nStart a line with ## followed by the question; the lines below it are the answer.\n\n## Can several be open?\nTurn on Allow Multiple.', help: '"## Question" lines, each followed by its answer (Markdown)' },
        allowMultiple: { type: 'bool', default: false },
        firstOpen: { type: 'bool', default: false },
        size: { type: 'number', default: 17 },
        questionColor: { type: 'color', default: '#111111' },
        answerColor: { type: 'color', default: '#444444' },
        lineColor: { type: 'color', default: '#e2e2e2' },
        padding: { type: 'number', default: 18 },
      },
      style: p => ({ '--gpsb-acc-q': p.questionColor, '--gpsb-acc-a': p.answerColor, '--gpsb-acc-line': p.lineColor, '--gpsb-acc-pad': `${p.padding}px`, 'font-size': `${p.size}px` }),
      inner: (p, ctx, node) => accHTML(p, ctx, node?.id),
      rules: (p, sel) => [
        `${sel} > .gpsb-acc { border-bottom: 1px solid var(--gpsb-acc-line); }`,
        `${sel} > .gpsb-acc > summary { list-style: none; cursor: pointer; padding: var(--gpsb-acc-pad) 36px var(--gpsb-acc-pad) 0; position: relative; font-weight: 600; color: var(--gpsb-acc-q); }`,
        `${sel} > .gpsb-acc > summary::-webkit-details-marker { display: none; }`,
        `${sel} > .gpsb-acc > summary::after { content: ''; position: absolute; right: 8px; top: 50%; width: 9px; height: 9px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: translateY(-75%) rotate(45deg); transition: transform .2s; }`,
        `${sel} > .gpsb-acc[open] > summary::after { transform: translateY(-25%) rotate(-135deg); }`,
        `${sel} > .gpsb-acc > .gpsb-acc-a { color: var(--gpsb-acc-a); padding: 0 0 var(--gpsb-acc-pad); line-height: 1.6; }`,
        `${sel} > .gpsb-acc > .gpsb-acc-a > :first-child { margin-top: 0; }\n${sel} > .gpsb-acc > .gpsb-acc-a > :last-child { margin-bottom: 0; }`].join('\n'),
      patch(el, p, ctx) {
        const c = changed(el, 'acc', JSON.stringify([p.items, p.allowMultiple, p.firstOpen])); // first call: the built markup is current
        if (c !== true) return;
        el.querySelectorAll(':scope > .gpsb-acc').forEach(d => d.remove());
        el.insertAdjacentHTML('afterbegin', accHTML(p, ctx, el.dataset.gpsb));
      },
      init({ el, GPSB, ci }) { // exclusive without native <details name> support
        if ('name' in HTMLDetailsElement.prototype || props(GPSB, el, ci).allowMultiple) return;
        el.addEventListener('toggle', e => { if (e.target.open) el.querySelectorAll(':scope > .gpsb-acc[open]').forEach(d => d !== e.target && (d.open = false)); }, true);
      },
      methods: {
        openAll: el => el.querySelectorAll(':scope > .gpsb-acc').forEach(d => (d.open = true)),
        closeAll: el => el.querySelectorAll(':scope > .gpsb-acc').forEach(d => (d.open = false)),
      },
    },
    Modal: {
      category: 'Interactive',
      props: {
        openOn: { type: 'enum', options: ['manual', 'load', 'delay', 'exit'], default: 'manual', help: 'manual: Modal.open from an event; load / delay: by itself; exit: when the mouse leaves the page' },
        delay: { type: 'number', default: 5, help: 'seconds (openOn = delay)' },
        once: { type: 'bool', default: true, help: 'open by itself only once per visitor' },
        closeOnBackdrop: { type: 'bool', default: true },
        closeButton: { type: 'bool', default: true },
        closeColor: { type: 'color', default: '#333333' },
        backdrop: { type: 'color', default: '#00000080' },
        showInEditor: { type: 'bool', default: true, help: 'show it open while you edit (it stays hidden on the page until opened)' },
        onOpen: { type: 'event', default: [], on: 'gpsb:open' },
        onClose: { type: 'event', default: [], on: 'gpsb:close' },
      },
      tag: () => 'dialog',
      // the RectTransform's size, centred in the window
      style: p => ({ position: 'fixed', inset: '0', margin: 'auto', 'max-width': 'calc(100vw - 32px)', 'max-height': 'calc(100vh - 32px)', padding: '0', border: 'none', overflow: 'auto', '--gpsb-backdrop': p.backdrop, '--gpsb-x': p.closeColor }),
      attrs: (p, ctx) => (ctx?.editor && p.showInEditor ? { open: '' } : {}),
      inner: p => (p.closeButton ? `<button type="button" class="gpsb-modal-x" aria-label="Close">${icon('x')}</button>` : ''),
      rules: (p, sel) => `${sel}::backdrop { background: var(--gpsb-backdrop); }\n${sel}:not([open]) { display: none; }\n${sel} > .gpsb-modal-x { position: absolute; top: 10px; right: 10px; z-index: 10; width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--gpsb-x); cursor: pointer; padding: 6px; }\n${sel} > .gpsb-modal-x:hover { background: rgba(0,0,0,.08); }\n${sel} > .gpsb-modal-x svg { width: 24px; height: 24px; }`,
      init({ el, GPSB, ci }) {
        const p = props(GPSB, el, ci), key = `gpsb-modal-${el.dataset.gpsb}`;
        el.querySelector(':scope > .gpsb-modal-x')?.addEventListener('click', () => el.close());
        el.addEventListener('click', e => {
          if (e.target !== el || !props(GPSB, el, ci).closeOnBackdrop) return;
          const r = el.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) el.close();
        });
        el.addEventListener('close', () => fire(el, 'close', {}));
        const auto = () => {
          try { if (p.once && localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* no storage */ }
          openModal(el);
        };
        if (p.openOn === 'load') auto();
        else if (p.openOn === 'delay') setTimeout(auto, Math.max(0, p.delay) * 1000);
        else if (p.openOn === 'exit') document.addEventListener('mouseout', function exit(e) { if (!e.relatedTarget && e.clientY <= 0) { document.removeEventListener('mouseout', exit); auto(); } });
      },
      methods: { open: el => openModal(el), close: el => el.close(), toggle: el => (el.open ? el.close() : openModal(el)) },
    },
    Gallery: {
      category: 'Media',
      props: {
        images: { type: 'list', of: 'asset:image', default: [] },
        alts: { type: 'list', of: 'string', default: [], help: 'a description per image, in the same order (for screen readers and the lightbox)' },
        columns: { type: 'int', default: 3, min: 1, max: 8 },
        gap: { type: 'number', default: 8 },
        aspect: { type: 'enum', options: ['1/1', '4/3', '3/2', '16/9', '3/4', '2/3'], default: '1/1' },
        fit: { type: 'enum', options: ['cover', 'contain'], default: 'cover' },
        radius: { type: 'number', default: 4 },
        lightbox: { type: 'bool', default: true, help: 'click an image to see it full screen' },
      },
      style: p => ({ display: 'grid', 'grid-template-columns': `repeat(${Math.max(1, p.columns | 0)}, minmax(0, 1fr))`, gap: `${p.gap}px`, 'align-content': 'start', '--gpsb-gal-r': `${p.radius}px`, '--gpsb-gal-fit': p.fit, '--gpsb-gal-ar': p.aspect }),
      inner: (p, ctx) => (!p.images.length && ctx?.editor ? '<div class="gpsb-gal-empty">Gallery: add images in the Inspector</div>' : galleryHTML(p, ctx)),
      rules: (p, sel) => `${sel} > .gpsb-gal-item { aspect-ratio: var(--gpsb-gal-ar); border: 0; padding: 0; overflow: hidden; border-radius: var(--gpsb-gal-r); background: #0000000d; display: block; ${p.lightbox ? 'cursor: zoom-in;' : ''} }\n${sel} > .gpsb-gal-item img { width: 100%; height: 100%; object-fit: var(--gpsb-gal-fit); display: block; transition: transform .3s; }\n${sel} > button.gpsb-gal-item:hover img { transform: scale(1.03); }\n${sel} > .gpsb-gal-empty { grid-column: 1 / -1; height: 100%; display: grid; place-items: center; border: 2px dashed #0003; color: #0008; font: 14px system-ui, sans-serif; }`,
      patch(el, p, ctx) { const h = galleryHTML(p, ctx); if (changed(el, 'gal', h) === true) { el.querySelectorAll(':scope > .gpsb-gal-item').forEach(x => x.remove()); el.insertAdjacentHTML('afterbegin', h); } },
      init({ el, GPSB, ci }) {
        el.addEventListener('click', e => {
          const b = e.target.closest('.gpsb-gal-item[data-i]');
          if (!b || b.parentElement !== el) return;
          const p = props(GPSB, el, ci);
          openLightbox(p.images.map((img, i) => ({ src: GPSB.ctx.asset(img), alt: p.alts?.[i] ?? '' })), +b.dataset.i);
        });
      },
    },
    VideoEmbed: {
      category: 'Media',
      props: {
        url: { type: 'string', default: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', help: 'a YouTube or Vimeo link' },
        poster: { type: 'asset:image', default: '', help: "image shown before playing (YouTube: the video's own if empty)" },
        title: { type: 'string', default: 'Video' },
        privacy: { type: 'bool', default: true, help: "YouTube's no-cookie player / Vimeo's do-not-track" },
        radius: { type: 'number', default: 0 },
      },
      style: p => ({ overflow: 'hidden', background: '#000', 'border-radius': `${p.radius}px` }),
      // a link with the poster until clicked: no player (and no tracking) until the visitor asks for it
      inner: (p, ctx) => {
        const y = youtubeId(p.url), poster = p.poster ? ctx.asset(p.poster) : y ? `https://i.ytimg.com/vi/${y}/hqdefault.jpg` : '';
        return `<a class="gpsb-vid" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="Play: ${esc(p.title)}">${poster ? `<img src="${esc(poster)}" alt="" loading="lazy" decoding="async">` : ''}<span class="gpsb-vid-play">${icon('play', 2)}</span></a>`;
      },
      rules: (p, sel) => `${sel} > .gpsb-vid { position: absolute; inset: 0; display: grid; place-items: center; }\n${sel} > .gpsb-vid img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }\n${sel} > .gpsb-vid .gpsb-vid-play { position: relative; width: 72px; height: 72px; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; display: grid; place-items: center; transition: transform .15s, background .15s; }\n${sel} > .gpsb-vid:hover .gpsb-vid-play { transform: scale(1.08); background: #e00; }\n${sel} > .gpsb-vid .gpsb-vid-play svg { width: 32px; height: 32px; margin-left: 4px; fill: currentColor; }\n${sel} > iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }`,
      init({ el, GPSB, ci }) {
        el.querySelector(':scope > .gpsb-vid')?.addEventListener('click', e => {
          const p = props(GPSB, el, ci), src = embedUrl(p);
          if (!src) return; // not YouTube/Vimeo: the link opens it
          e.preventDefault();
          const f = document.createElement('iframe');
          Object.assign(f, { src, title: p.title, allowFullscreen: true });
          f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
          e.currentTarget.replaceWith(f);
        });
      },
      methods: { play: el => el.querySelector(':scope > .gpsb-vid')?.click() },
    },
    // links to this page in the project's other languages (project.json `languages`, lib/i18n.js)
    LanguageSwitcher: {
      category: 'Navigation',
      props: {
        display: { type: 'enum', options: ['links', 'dropdown'], default: 'links' },
        label: { type: 'enum', options: ['name', 'code'], default: 'name', help: 'Français, or FR' },
        color: { type: 'color', default: '#202020' },
        activeColor: { type: 'color', default: '#3366ff', help: 'the language being shown' },
        size: { type: 'number', default: 15 },
        gap: { type: 'number', default: 14 },
      },
      style: p => ({ display: 'flex', 'align-items': 'center', gap: `${p.gap}px`, color: p.color, 'font-size': `${p.size}px`, '--gpsb-ls-a': p.activeColor }),
      attrs: () => ({ role: 'navigation', 'aria-label': 'Language' }),
      inner: (p, ctx) => {
        const alts = ctx?.alternates ?? (ctx?.languages ?? []).map((l, i) => ({ ...l, href: '#', current: ctx.lang ? l.code === ctx.lang : !i })); // the editor: links nowhere
        if (!alts.length) return ctx?.editor ? '<span class="gpsb-ls-none">Add languages in Project Settings ▸ Languages</span>' : '';
        const text = a => (p.label === 'code' ? a.code.toUpperCase() : a.name);
        return p.display === 'dropdown'
          ? `<select class="gpsb-ls" aria-label="Language">${alts.map(a => `<option value="${esc(a.href)}" lang="${esc(a.code)}"${a.current ? ' selected' : ''}>${esc(text(a))}</option>`).join('')}</select>`
          : alts.map(a => `<a class="gpsb-ls" href="${esc(a.href)}" hreflang="${esc(a.code)}" lang="${esc(a.code)}"${a.current ? ' aria-current="true"' : ''}>${esc(text(a))}</a>`).join('');
      },
      rules: (p, sel) => `${sel} > a.gpsb-ls { color: inherit; text-decoration: none; }\n${sel} > a.gpsb-ls:hover { text-decoration: underline; }\n${sel} > a.gpsb-ls[aria-current] { color: var(--gpsb-ls-a); font-weight: 700; }\n${sel} > select.gpsb-ls { font: inherit; color: inherit; padding: 4px 8px; border-radius: 6px; }\n${sel} > .gpsb-ls-none { opacity: .6; font-size: 12px; }`,
      init({ el }) { el.querySelector(':scope > select.gpsb-ls')?.addEventListener('change', e => { location.href = e.target.value; }); },
    },
    Map: {
      category: 'Media',
      props: {
        provider: { type: 'enum', options: ['openstreetmap', 'google'], default: 'openstreetmap' },
        lat: { type: 'number', default: 51.5074 },
        lng: { type: 'number', default: -0.1278 },
        zoom: { type: 'int', default: 14, min: 1, max: 19 },
        query: { type: 'string', default: '', help: 'google: an address or place name (instead of lat / lng)' },
        marker: { type: 'bool', default: true },
        title: { type: 'string', default: 'Map' },
      },
      inner: p => `<iframe src="${esc(mapUrl(p))}" title="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" style="width:100%;height:100%;border:0;display:block"></iframe>`,
      patch(el, p) { const f = el.querySelector(':scope > iframe'), u = mapUrl(p); if (f && f.getAttribute('src') !== u) f.setAttribute('src', u); },
    },
  };
};

// the current page's links get aria-current="page" (NavigationMenu)
function markCurrent(el) {
  const here = location.pathname.replace(/(index)?(\.html)?$/, '').replace(/\/$/, '');
  for (const a of el.querySelectorAll('a[href]')) {
    const u = new URL(a.getAttribute('href'), location.href);
    const same = u.origin === location.origin && !u.hash && u.pathname.replace(/(index)?(\.html)?$/, '').replace(/\/$/, '') === here;
    if (same) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function openModal(el) {
  if (el.open) return;
  if (el.showModal) el.showModal(); else el.setAttribute('open', '');
  el.dispatchEvent(new CustomEvent('gpsb:open', { detail: {}, bubbles: true }));
}

// ---------- lightbox (Gallery, Image.lightbox) ----------
const LIGHTBOX_CSS = `.gpsb-lightbox{padding:0;border:0;background:transparent;max-width:100vw;max-height:100vh;width:100vw;height:100vh;overflow:hidden}
.gpsb-lightbox::backdrop{background:rgba(0,0,0,.92)}
.gpsb-lightbox figure{margin:0;position:absolute;inset:48px 64px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.gpsb-lightbox img{max-width:100%;max-height:calc(100% - 40px);object-fit:contain;user-select:none}
.gpsb-lightbox figcaption{color:#ddd;font:14px/1.4 system-ui,sans-serif;text-align:center}
.gpsb-lightbox button{position:absolute;border:0;background:rgba(255,255,255,.12);color:#fff;width:48px;height:48px;border-radius:50%;cursor:pointer;font:28px/1 system-ui;display:grid;place-items:center}
.gpsb-lightbox button:hover{background:rgba(255,255,255,.25)}
.gpsb-lightbox .lb-x{top:12px;right:12px}.gpsb-lightbox .lb-prev{left:12px;top:50%;transform:translateY(-50%)}.gpsb-lightbox .lb-next{right:12px;top:50%;transform:translateY(-50%)}
.gpsb-lightbox .lb-n{position:absolute;top:22px;left:20px;color:#bbb;font:14px system-ui}`;
let lb = null;
export function openLightbox(items, index = 0) {
  if (!items.length) return;
  if (!lb) {
    const style = document.createElement('style');
    style.textContent = LIGHTBOX_CSS;
    document.head.append(style);
    lb = document.createElement('dialog');
    lb.className = 'gpsb-lightbox';
    lb.setAttribute('aria-label', 'Image viewer');
    lb.innerHTML = '<span class="lb-n"></span><figure><img alt=""><figcaption></figcaption></figure><button class="lb-prev" aria-label="Previous image">‹</button><button class="lb-next" aria-label="Next image">›</button><button class="lb-x" aria-label="Close">×</button>';
    document.body.append(lb);
    lb.querySelector('.lb-x').onclick = () => lb.close();
    lb.querySelector('.lb-prev').onclick = () => lb.go(-1);
    lb.querySelector('.lb-next').onclick = () => lb.go(1);
    lb.addEventListener('click', e => { if (e.target === lb || e.target.tagName === 'FIGURE') lb.close(); });
    lb.addEventListener('keydown', e => { if (e.key === 'ArrowRight') lb.go(1); if (e.key === 'ArrowLeft') lb.go(-1); });
    let x0 = null;
    lb.addEventListener('pointerdown', e => (x0 = e.clientX));
    lb.addEventListener('pointerup', e => { if (x0 != null && Math.abs(e.clientX - x0) > 40) lb.go(e.clientX < x0 ? 1 : -1); x0 = null; });
  }
  let i = index;
  const show = () => {
    const it = lb.items[i];
    Object.assign(lb.querySelector('img'), { src: it.src, alt: it.alt });
    lb.querySelector('figcaption').textContent = it.alt;
    lb.querySelector('.lb-n').textContent = lb.items.length > 1 ? `${i + 1} / ${lb.items.length}` : '';
    for (const b of lb.querySelectorAll('.lb-prev, .lb-next')) b.hidden = lb.items.length < 2;
  };
  lb.items = items;
  lb.go = d => { i = (i + d + lb.items.length) % lb.items.length; show(); };
  show();
  if (!lb.open) lb.showModal();
}
