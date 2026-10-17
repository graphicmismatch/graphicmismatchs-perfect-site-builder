// Built-in components. Isomorphic: used by the build (Node), the editor and the page runtime.
//
// Component definition:
//   category              Add Component menu group
//   props                 { name: { type, default, ...opts } }  (prop types: see CONTRACT.md)
//   tag(p)                element tag; the first component that returns one wins (default 'div')
//   style(p, ctx, node)   CSS declarations for the node element  { 'css-prop': value }
//   attrs(p, ctx)         element attributes
//   inner(p, ctx)         HTML placed before the node's children
//   rules(p, sel, ctx, node) extra CSS text (e.g. :hover) for selector `sel`
//   childStyle(p, child)  declarations for each direct child (layout groups); marks children in-layout
//   patch(el, p, ctx)     runtime: refresh inner content after a prop changed (animation)
//   state: { prop, read } form controls: the prop the user edits; read(control(el)) -> its current value. The runtime
//                         writes it back into the node data on input/change, and passes it to event entries with no arg
// Event props may set `on: 'change' | 'input' | ...` (DOM event; default 'click').
//
// ctx: { asset(path) -> url, font(path) -> font-family name }

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export const cssUrl = u => `url("${String(u).replace(/["\\\n]/g, '\\$&')}")`;
const FONT_EXT = /\.(woff2?|ttf|otf)$/i;

const ALIGN = ['upper-left', 'upper-center', 'upper-right', 'middle-left', 'middle-center', 'middle-right', 'lower-left', 'lower-center', 'lower-right'];
// reverse: the container is row/column-reverse, where flex-start is the far edge; flip the main axis so the
// alignment stays put and only the order reverses (Unity's Reverse Arrangement)
const FLIP = { 'flex-start': 'flex-end', 'flex-end': 'flex-start', center: 'center' };
const alignFlex = (a, row, reverse = false) => {
  const [v, h] = a.split('-');
  const mainH = { left: 'flex-start', center: 'center', right: 'flex-end' }[h];
  const mainV = { upper: 'flex-start', middle: 'center', lower: 'flex-end' }[v];
  const main = row ? mainH : mainV, cross = row ? mainV : mainH;
  return { 'justify-content': reverse ? FLIP[main] : main, 'align-items': cross };
};
const padding = p => `${p[2]}px ${p[1]}px ${p[3]}px ${p[0]}px`; // vec4 is [left, right, top, bottom] like Unity

// :hover declarations must win over inline styles the runtime writes while animating
const important = css => css.split(';').map(d => d.trim()).filter(Boolean).map(d => (/!important$/.test(d) ? d : d + ' !important')).join('; ') + ';';
const layoutElement = child => child.components?.find(c => c.type === 'LayoutElement')?.props ?? {};
const hasSprite = node => !!node?.components?.find(c => c.type === 'Image')?.props?.sprite;

function linearGroup(row) {
  return {
    category: 'Layout',
    props: {
      padding: { type: 'vec4', default: [0, 0, 0, 0], labels: ['Left', 'Right', 'Top', 'Bottom'] },
      spacing: { type: 'number', default: 0 },
      childAlignment: { type: 'enum', options: ALIGN, default: 'upper-left' },
      reverse: { type: 'bool', default: false },
      controlWidth: { type: 'bool', default: false },
      controlHeight: { type: 'bool', default: false },
      expandWidth: { type: 'bool', default: false },
      expandHeight: { type: 'bool', default: false },
      wrap: { type: 'bool', default: false },
    },
    style: p => ({
      display: 'flex',
      'flex-direction': (row ? 'row' : 'column') + (p.reverse ? '-reverse' : ''),
      'flex-wrap': p.wrap ? 'wrap' : 'nowrap',
      gap: `${p.spacing}px`,
      padding: padding(p.padding),
      ...alignFlex(p.childAlignment, row, p.reverse),
    }),
    childStyle(p, child) {
      const le = layoutElement(child), s = {};
      const [ctlMain, expMain, ctlCross, expCross] = row
        ? [p.controlWidth, p.expandWidth, p.controlHeight, p.expandHeight]
        : [p.controlHeight, p.expandHeight, p.controlWidth, p.expandWidth];
      const main = row ? 'width' : 'height', cross = row ? 'height' : 'width';
      if (ctlMain) s[main] = expMain ? '0' : 'auto';
      if (ctlMain && expMain) s['flex-grow'] = '1';
      if (ctlCross) { s[cross] = 'auto'; if (expCross) s['align-self'] = 'stretch'; }
      return { ...s, ...layoutElementStyle(le, row) };
    },
  };
}

function layoutElementStyle(le, row) {
  const s = {};
  if (le.minWidth > 0) s['min-width'] = `${le.minWidth}px`;
  if (le.minHeight > 0) s['min-height'] = `${le.minHeight}px`;
  if (le.preferredWidth > 0) s.width = `${le.preferredWidth}px`;
  if (le.preferredHeight > 0) s.height = `${le.preferredHeight}px`;
  const flex = row ? le.flexibleWidth : le.flexibleHeight;
  if (flex > 0) { s['flex-grow'] = String(flex); s['flex-basis'] = '0'; }
  return s;
}

// form controls / embeds are rendered inside the node element, filling its rect
export const control = el => el.querySelector(':scope > input, :scope > select, :scope > textarea, :scope > iframe');
const FILL = 'width:100%;height:100%;margin:0;display:block';
const SLIDER_DIR = { leftToRight: '', rightToLeft: 'direction:rtl', topToBottom: 'writing-mode:vertical-lr', bottomToTop: 'writing-mode:vertical-lr;direction:rtl' };
const sliderStyle = p => [FILL, SLIDER_DIR[p.direction]].filter(Boolean).join(';');
const optionsHTML = p => p.options.map((o, i) => `<option value="${i}"${i === p.value ? ' selected' : ''}>${esc(o)}</option>`).join('');
const setAttr = (el, k, v) => (v == null || v === false ? el.removeAttribute(k) : el.setAttribute(k, v === true ? '' : v));

const media = (kind, p, ctx) => {
  if (!p.src) return '';
  const a = [`src="${esc(ctx.asset(p.src))}"`];
  for (const k of ['autoplay', 'loop', 'muted', 'controls']) if (p[k]) a.push(k);
  if (kind === 'video') {
    a.push('playsinline', `style="width:100%;height:100%;object-fit:${p.fit};display:block"`);
    if (p.poster) a.push(`poster="${esc(ctx.asset(p.poster))}"`);
  } else a.push('style="width:100%;height:100%;display:block"');
  return `<${kind} ${a.join(' ')}></${kind}>`;
};

export const builtins = {
  // ---- root ----
  Canvas: {
    category: 'UI', root: true,
    props: {
      title: { type: 'string', default: '' },
      description: { type: 'string', default: '' },
      background: { type: 'color', default: '#ffffff' },
      height: { type: 'number', default: 0, help: '0 = screen height; larger = scrolling page' },
      font: { type: 'string', default: 'system-ui, sans-serif', asset: 'font' },
    },
    style: (p, ctx) => ({ background: p.background, 'font-family': fontFamily(p.font, ctx), 'min-height': p.height > 0 ? `${p.height}px` : '100vh' }),
  },
  CanvasScaler: {
    category: 'UI', root: true,
    props: {
      mode: { type: 'enum', options: ['constant', 'scale-with-screen'], default: 'constant' },
      refWidth: { type: 'number', default: 1920 },
      refHeight: { type: 'number', default: 1080 },
      match: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, help: '0 = match width, 1 = match height' },
    },
  },

  // ---- visuals ----
  Image: {
    category: 'UI',
    props: {
      sprite: { type: 'asset:image', default: '' },
      color: { type: 'color', default: '#ffffff' },
      fit: { type: 'enum', options: ['fill', 'contain', 'cover', 'none'], default: 'fill' },
      radius: { type: 'number', default: 0 },
      alt: { type: 'string', default: '' },
    },
    style: (p, ctx) => {
      const size = p.fit === 'fill' ? '100% 100%' : p.fit === 'none' ? 'auto' : p.fit;
      const s = p.sprite
        ? {
          'background-image': cssUrl(ctx.asset(p.sprite)),
          'background-size': size,
          'background-position': 'center', 'background-repeat': 'no-repeat',
          'background-color': 'transparent',
          '--gpsb-sprite': cssUrl(ctx.asset(p.sprite)), '--gpsb-sprite-size': size, // Button tint layer mask
        }
        : { 'background-image': 'none', 'background-color': p.color };
      if (p.radius) s['border-radius'] = `${p.radius}px`;
      return s;
    },
    attrs: p => (p.alt ? { role: 'img', 'aria-label': p.alt } : {}),
  },
  Text: {
    category: 'UI',
    props: {
      text: { type: 'text', default: 'New Text' },
      tag: { type: 'enum', options: ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'label'], default: 'div' },
      font: { type: 'string', default: '', asset: 'font', help: 'CSS font-family or a font asset' },
      size: { type: 'number', default: 24 },
      color: { type: 'color', default: '#202020' },
      weight: { type: 'enum', options: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'], default: 'normal' },
      italic: { type: 'bool', default: false },
      align: { type: 'enum', options: ['left', 'center', 'right', 'justify'], default: 'left' },
      valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'top' },
      lineHeight: { type: 'number', default: 1.2, step: 0.05 },
      letterSpacing: { type: 'number', default: 0 },
      wrap: { type: 'bool', default: true },
    },
    tag: p => (p.tag === 'div' ? '' : p.tag), // let Button/Link pick the tag when left at div
    style: (p, ctx) => ({
      display: 'flex', 'flex-direction': 'column',
      'justify-content': { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[p.valign],
      'text-align': p.align,
      ...(p.font ? { 'font-family': fontFamily(p.font, ctx) } : {}),
      'font-size': `${p.size}px`, color: p.color, 'font-weight': p.weight,
      'font-style': p.italic ? 'italic' : 'normal', 'line-height': String(p.lineHeight),
      'letter-spacing': `${p.letterSpacing}px`, 'white-space': p.wrap ? 'pre-wrap' : 'pre',
      margin: '0',
    }),
    inner: p => `<span class="gpsb-text">${p.text}</span>`, // rich text: HTML allowed
    patch: (el, p) => { const t = el.querySelector(':scope > .gpsb-text'); if (t) t.innerHTML = p.text; },
  },
  Button: {
    category: 'UI',
    props: {
      interactable: { type: 'bool', default: true },
      transition: { type: 'enum', options: ['tint', 'sprite', 'none'], default: 'tint' },
      normal: { type: 'color', default: '#ffffff' },
      highlighted: { type: 'color', default: '#f5f5f5' },
      pressed: { type: 'color', default: '#c8c8c8' },
      disabled: { type: 'color', default: '#c8c8c880' },
      highlightedSprite: { type: 'asset:image', default: '' },
      pressedSprite: { type: 'asset:image', default: '' },
      onClick: { type: 'event', default: [] },
    },
    tag: () => 'button',
    // tint over a sprite: a ::before layer masked to the sprite and multiplied (like Unity, transparent areas stay
    // transparent and child graphics are not tinted); without a sprite the background colour is the tint
    style: (p, ctx, node) => {
      const tint = p.interactable ? p.normal : p.disabled, s = { cursor: p.interactable ? 'pointer' : 'default' };
      if (p.transition !== 'tint') return s;
      return hasSprite(node) ? { ...s, '--gpsb-tint': tint, isolation: 'isolate' } : { ...s, 'background-color': tint, transition: 'background-color .1s' };
    },
    attrs: p => (p.interactable ? { type: 'button' } : { type: 'button', disabled: '' }),
    rules(p, sel, ctx, node) {
      if (p.transition === 'tint' && hasSprite(node)) {
        const mask = 'var(--gpsb-sprite) center / var(--gpsb-sprite-size, 100% 100%) no-repeat';
        const layer = `${sel}::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; background-color: var(--gpsb-tint); mix-blend-mode: multiply; -webkit-mask: ${mask}; mask: ${mask}; transition: background-color .1s; }`;
        return p.interactable ? `${layer}\n${sel}:hover { --gpsb-tint: ${p.highlighted} !important; }\n${sel}:active { --gpsb-tint: ${p.pressed} !important; }` : layer;
      }
      if (!p.interactable) return '';
      if (p.transition === 'tint')
        return `${sel}:hover { background-color: ${p.highlighted} !important; }\n${sel}:active { background-color: ${p.pressed} !important; }`;
      if (p.transition === 'sprite')
        return [p.highlightedSprite && `${sel}:hover { background-image: ${cssUrl(ctx.asset(p.highlightedSprite))} !important; }`,
          p.pressedSprite && `${sel}:active { background-image: ${cssUrl(ctx.asset(p.pressedSprite))} !important; }`].filter(Boolean).join('\n');
      return '';
    },
  },
  Link: {
    category: 'Web',
    props: {
      href: { type: 'href', default: '', help: 'page name (about), URL, or #anchor' },
      newTab: { type: 'bool', default: false },
    },
    tag: () => 'a',
    style: () => ({ color: 'inherit', 'text-decoration': 'none', display: 'block' }),
    attrs: (p, ctx) => ({ href: ctx.href(p.href), ...(p.newTab ? { target: '_blank', rel: 'noopener' } : {}) }),
  },
  Video: {
    category: 'Media',
    props: {
      src: { type: 'asset:video', default: '' },
      poster: { type: 'asset:image', default: '' },
      autoplay: { type: 'bool', default: true },
      loop: { type: 'bool', default: true },
      muted: { type: 'bool', default: true },
      controls: { type: 'bool', default: false },
      fit: { type: 'enum', options: ['fill', 'contain', 'cover'], default: 'cover' },
    },
    inner: (p, ctx) => media('video', p, ctx),
    patch: (el, p, ctx) => { const v = el.querySelector(':scope > video'); if (v && p.src && !v.src.endsWith(ctx.asset(p.src))) v.src = ctx.asset(p.src); },
  },
  Audio: {
    category: 'Media',
    props: {
      src: { type: 'asset:audio', default: '' },
      autoplay: { type: 'bool', default: false },
      loop: { type: 'bool', default: false },
      controls: { type: 'bool', default: true },
    },
    inner: (p, ctx) => media('audio', p, ctx),
  },
  RawImage: {
    category: 'UI',
    props: {
      texture: { type: 'asset:image', default: '' },
      uvRect: { type: 'vec4', default: [0, 0, 1, 1], labels: ['X', 'Y', 'W', 'H'], help: 'part of the texture shown (0-1); X/Y have no effect while W/H is 1' },
      alt: { type: 'string', default: '' },
    },
    style: (p, ctx) => {
      if (!p.texture) return { 'background-image': 'none' };
      const [x, y, w, h] = p.uvRect, at = (o, s) => (s === 1 ? 0 : Math.round((o / (1 - s)) * 1e5) / 1e3);
      return {
        'background-image': cssUrl(ctx.asset(p.texture)), 'background-repeat': 'no-repeat',
        'background-size': `${Math.round(1e5 / (w || 1)) / 1e3}% ${Math.round(1e5 / (h || 1)) / 1e3}%`,
        'background-position': `${at(x, w)}% ${at(y, h)}%`,
      };
    },
    attrs: p => (p.alt ? { role: 'img', 'aria-label': p.alt } : {}),
  },
  Toggle: {
    category: 'UI',
    props: {
      isOn: { type: 'bool', default: true },
      interactable: { type: 'bool', default: true },
      onValueChanged: { type: 'event', default: [], on: 'change' },
    },
    inner: p => `<input type="checkbox"${p.isOn ? ' checked' : ''}${p.interactable ? '' : ' disabled'} style="${FILL}">`,
    patch: (el, p) => { const c = control(el); if (c) { c.checked = !!p.isOn; c.disabled = !p.interactable; } },
    state: { prop: 'isOn', read: c => c.checked },
  },
  Slider: {
    category: 'UI',
    props: {
      direction: { type: 'enum', options: ['leftToRight', 'rightToLeft', 'bottomToTop', 'topToBottom'], default: 'leftToRight' },
      minValue: { type: 'number', default: 0 },
      maxValue: { type: 'number', default: 1 },
      wholeNumbers: { type: 'bool', default: false },
      value: { type: 'number', default: 0 },
      interactable: { type: 'bool', default: true },
      onValueChanged: { type: 'event', default: [], on: 'input' },
    },
    inner: p => `<input type="range" min="${+p.minValue}" max="${+p.maxValue}" step="${p.wholeNumbers ? 1 : 'any'}" value="${+p.value}"${p.interactable ? '' : ' disabled'} style="${sliderStyle(p)}">`,
    patch: (el, p) => {
      const c = control(el);
      if (!c) return;
      Object.assign(c, { min: p.minValue, max: p.maxValue, step: p.wholeNumbers ? 1 : 'any', disabled: !p.interactable });
      if (+c.value !== +p.value) c.value = p.value;
      c.style.cssText = sliderStyle(p);
    },
    state: { prop: 'value', read: c => +c.value },
  },
  InputField: {
    category: 'UI',
    props: {
      text: { type: 'string', default: '' },
      placeholder: { type: 'string', default: '' },
      contentType: { type: 'enum', options: ['text', 'password', 'email', 'number', 'tel', 'url', 'search'], default: 'text' },
      lineType: { type: 'enum', options: ['single', 'multi'], default: 'single' },
      characterLimit: { type: 'int', default: 0, help: '0 = unlimited' },
      readOnly: { type: 'bool', default: false },
      interactable: { type: 'bool', default: true },
      onValueChanged: { type: 'event', default: [], on: 'input' },
      onEndEdit: { type: 'event', default: [], on: 'change' },
    },
    inner: p => {
      const a = [p.placeholder && `placeholder="${esc(p.placeholder)}"`, p.characterLimit > 0 && `maxlength="${p.characterLimit}"`,
        p.readOnly && 'readonly', !p.interactable && 'disabled', `style="${FILL}"`].filter(Boolean).join(' ');
      return p.lineType === 'multi' ? `<textarea ${a}>${esc(p.text)}</textarea>` : `<input type="${p.contentType}" value="${esc(p.text)}" ${a}>`;
    },
    patch: (el, p) => {
      const c = control(el);
      if (!c) return;
      if (c.value !== p.text) c.value = p.text;
      if (c.tagName === 'INPUT') c.type = p.contentType;
      setAttr(c, 'placeholder', p.placeholder || null);
      setAttr(c, 'maxlength', p.characterLimit > 0 ? p.characterLimit : null);
      c.readOnly = !!p.readOnly; c.disabled = !p.interactable;
    },
    state: { prop: 'text', read: c => c.value },
  },
  Dropdown: {
    category: 'UI',
    props: {
      options: { type: 'list', of: 'string', default: ['Option A', 'Option B', 'Option C'] },
      value: { type: 'int', default: 0, help: 'index of the selected option' },
      interactable: { type: 'bool', default: true },
      onValueChanged: { type: 'event', default: [], on: 'change' },
    },
    inner: p => `<select${p.interactable ? '' : ' disabled'} style="${FILL}">${optionsHTML(p)}</select>`,
    patch: (el, p) => {
      const c = control(el);
      if (!c) return;
      if ([...c.options].map(o => o.text).join('\n') !== p.options.join('\n')) c.innerHTML = optionsHTML(p);
      c.selectedIndex = p.value; c.disabled = !p.interactable;
    },
    state: { prop: 'value', read: c => c.selectedIndex },
  },
  IFrame: {
    category: 'Web',
    props: {
      src: { type: 'href', default: '', help: 'page name or URL' },
      title: { type: 'string', default: '', help: 'accessible name of the embedded content' },
      allow: { type: 'string', default: '', help: 'permissions policy, e.g. fullscreen; autoplay' },
      lazy: { type: 'bool', default: true },
    },
    inner: (p, ctx) => {
      if (!p.src) return '';
      const a = [`src="${esc(ctx.href(p.src))}"`, p.title && `title="${esc(p.title)}"`, p.allow && `allow="${esc(p.allow)}"`, p.lazy && 'loading="lazy"'];
      return `<iframe ${a.filter(Boolean).join(' ')} style="${FILL}"></iframe>`;
    },
    patch: (el, p, ctx) => { const c = control(el); if (c && p.src && c.getAttribute('src') !== ctx.href(p.src)) c.src = ctx.href(p.src); },
  },
  Element: {
    category: 'Web',
    props: {
      tag: { type: 'enum', options: ['div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside', 'figure', 'ul', 'ol', 'li', 'span'], default: 'div' },
      id: { type: 'string', default: '', help: 'HTML id (target of #anchor links)' },
      tooltip: { type: 'string', default: '', help: 'title attribute' },
      role: { type: 'string', default: '' },
      ariaLabel: { type: 'string', default: '' },
      ariaHidden: { type: 'bool', default: false },
    },
    tag: p => (p.tag === 'div' ? '' : p.tag),
    attrs: p => Object.fromEntries([['id', p.id], ['title', p.tooltip], ['role', p.role], ['aria-label', p.ariaLabel], ['aria-hidden', p.ariaHidden && 'true']].filter(([, v]) => v)),
  },
  HTML: {
    category: 'Web',
    props: { html: { type: 'code', lang: 'html', default: '<p>Hello</p>' } },
    inner: p => p.html,
  },
  Style: {
    category: 'Web',
    props: {
      className: { type: 'string', default: '', help: 'extra CSS classes' },
      css: { type: 'code', lang: 'css', default: '', help: 'declarations for this element' },
      hover: { type: 'code', lang: 'css', default: '', help: 'declarations on :hover' },
      rules: { type: 'code', lang: 'css', default: '', help: 'full CSS; & = this element' },
    },
    attrs: p => (p.className ? { class: p.className } : {}),
    rules: (p, sel) => [p.css && `${sel} { ${p.css} }`, p.hover && `${sel}:hover { ${important(p.hover)} }`, p.rules && p.rules.replaceAll('&', sel)].filter(Boolean).join('\n'),
  },

  // ---- layout ----
  HorizontalLayoutGroup: linearGroup(true),
  VerticalLayoutGroup: linearGroup(false),
  GridLayoutGroup: {
    category: 'Layout',
    props: {
      padding: { type: 'vec4', default: [0, 0, 0, 0], labels: ['Left', 'Right', 'Top', 'Bottom'] },
      cellSize: { type: 'vec2', default: [100, 100] },
      spacing: { type: 'vec2', default: [0, 0] },
      constraint: { type: 'enum', options: ['flexible', 'fixedColumns', 'fixedRows'], default: 'flexible' },
      count: { type: 'int', default: 2 },
      childAlignment: { type: 'enum', options: ALIGN, default: 'upper-left' },
    },
    style: p => {
      const [w, h] = p.cellSize, a = alignFlex(p.childAlignment, true);
      const s = { display: 'grid', gap: `${p.spacing[1]}px ${p.spacing[0]}px`, padding: padding(p.padding), 'justify-content': a['justify-content'], 'align-content': a['align-items'] };
      if (p.constraint === 'fixedRows') Object.assign(s, { 'grid-auto-flow': 'column', 'grid-template-rows': `repeat(${p.count}, ${h}px)`, 'grid-auto-columns': `${w}px` });
      else Object.assign(s, { 'grid-template-columns': p.constraint === 'fixedColumns' ? `repeat(${p.count}, ${w}px)` : `repeat(auto-fill, ${w}px)`, 'grid-auto-rows': `${h}px` });
      return s;
    },
    childStyle: () => ({ width: 'auto', height: 'auto' }),
  },
  LayoutElement: {
    category: 'Layout',
    props: {
      ignoreLayout: { type: 'bool', default: false },
      minWidth: { type: 'number', default: 0 }, minHeight: { type: 'number', default: 0 },
      preferredWidth: { type: 'number', default: 0 }, preferredHeight: { type: 'number', default: 0 },
      flexibleWidth: { type: 'number', default: 0 }, flexibleHeight: { type: 'number', default: 0 },
    },
  },
  ContentSizeFitter: {
    category: 'Layout',
    props: {
      horizontal: { type: 'enum', options: ['unconstrained', 'preferred'], default: 'unconstrained' },
      vertical: { type: 'enum', options: ['unconstrained', 'preferred'], default: 'unconstrained' },
    },
    style: p => ({
      ...(p.horizontal === 'preferred' ? { width: 'max-content' } : {}),
      ...(p.vertical === 'preferred' ? { height: 'auto' } : {}),
    }),
  },
  ScrollRect: {
    category: 'Layout',
    props: { horizontal: { type: 'bool', default: false }, vertical: { type: 'bool', default: true } },
    style: p => ({ 'overflow-x': p.horizontal ? 'auto' : 'hidden', 'overflow-y': p.vertical ? 'auto' : 'hidden' }),
  },
  Mask: { category: 'Layout', props: {}, style: () => ({ overflow: 'hidden' }) },

  // ---- effects ----
  CanvasGroup: {
    category: 'Effects',
    props: {
      alpha: { type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
      interactable: { type: 'bool', default: true },
      blocksRaycasts: { type: 'bool', default: true },
    },
    style: p => ({ opacity: String(p.alpha), ...(p.blocksRaycasts ? {} : { 'pointer-events': 'none' }) }),
    attrs: p => (p.interactable ? {} : { inert: '' }),
  },
  Shadow: {
    category: 'Effects',
    props: {
      color: { type: 'color', default: '#00000080' },
      distance: { type: 'vec2', default: [0, 4] },
      blur: { type: 'number', default: 8 },
    },
    style: p => ({ filter: `drop-shadow(${p.distance[0]}px ${p.distance[1]}px ${p.blur}px ${p.color})` }),
  },
  Outline: {
    category: 'Effects',
    props: {
      color: { type: 'color', default: '#00000080' },
      distance: { type: 'vec2', default: [1, 1] },
    },
    // Unity's Outline: copies offset to the four diagonals, following the graphic's alpha
    style: p => {
      const [x, y] = p.distance;
      return { filter: [[x, y], [-x, y], [x, -y], [-x, -y]].map(([a, b]) => `drop-shadow(${a}px ${b}px 0 ${p.color})`).join(' ') };
    },
  },

  AspectRatioFitter: {
    category: 'Layout',
    props: {
      aspectMode: { type: 'enum', options: ['none', 'width-controls-height', 'height-controls-width'], default: 'none' },
      aspectRatio: { type: 'number', default: 1, help: 'width / height' },
    },
    style: p => (p.aspectMode === 'none' || !(p.aspectRatio > 0) ? {}
      : { [p.aspectMode === 'width-controls-height' ? 'height' : 'width']: 'auto', 'aspect-ratio': String(p.aspectRatio) }),
  },

  // ---- animation / data (behaviour lives in runtime/animator & render) ----
  Animator: {
    category: 'Animation',
    props: {
      clips: { type: 'list', of: 'asset:anim', default: [], help: 'first clip is the default' },
      playOn: { type: 'enum', options: ['start', 'hover', 'click', 'visible', 'manual'], default: 'start' },
      speed: { type: 'number', default: 1 },
    },
  },
  Repeat: {
    category: 'Data',
    props: {
      source: { type: 'asset:json', default: '' },
      path: { type: 'string', default: '', help: 'dot path to an array inside the JSON, e.g. posts' },
      limit: { type: 'int', default: 0, help: '0 = all' },
    },
  },
};

export function fontFamily(v, ctx) {
  return FONT_EXT.test(v ?? '') ? `"${ctx.font(v)}", system-ui, sans-serif` : v;
}
export const isFontAsset = v => FONT_EXT.test(v ?? '');

// Definition lookup for any component type (built-in, component:X, behaviour:X).
// customs: { Card: { props, tag } } from components/*.html; behaviours: { Spin: { props } }
export function componentDef(type, customs = {}, behaviours = {}) {
  if (type.startsWith('component:')) {
    const m = customs[type.slice(10)];
    return m && { category: 'Custom', props: m.props, tag: () => m.tag, custom: true };
  }
  if (type.startsWith('behaviour:')) {
    const m = behaviours[type.slice(10)];
    return { category: 'Scripts', props: m?.props ?? {}, behaviour: true };
  }
  return builtins[type];
}

// Props with schema defaults filled in.
export function withDefaults(def, props = {}) {
  const out = {};
  for (const [k, s] of Object.entries(def?.props ?? {})) out[k] = props[k] ?? structuredClone(s.default);
  for (const k in props) if (!(k in out)) out[k] = props[k];
  return out;
}
