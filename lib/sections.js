// Section library, themes and project templates. Used by the editor (WebObject ▸ Section…, Project Settings ▸ Theme)
// and by `gpsb new --template` / the Project Hub. Not shipped with built sites.
//
// Sections are node subtrees for flowing pages (a Canvas with a vertical layout): each stretches across the page and
// grows with its content, wraps its rows on narrow screens, and takes its colours, fonts and text styles from the
// project's design tokens, so a theme restyles all of them at once.
import { newNode } from './node.js';

// ---------- themes: design tokens (project.json `tokens`) ----------
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif';
const ROUNDED = 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace';
const textStyles = (heading = {}) => ({
  h1: { font: '$heading', size: 56, weight: '800', lineHeight: 1.08, letterSpacing: -1, ...heading },
  h2: { font: '$heading', size: 38, weight: '700', lineHeight: 1.15, letterSpacing: -0.5, ...heading },
  h3: { font: '$heading', size: 21, weight: '700', lineHeight: 1.3, letterSpacing: 0 },
  lead: { font: '$body', size: 20, weight: '400', lineHeight: 1.55, letterSpacing: 0 },
  body: { font: '$body', size: 17, weight: '400', lineHeight: 1.65, letterSpacing: 0 },
  small: { font: '$body', size: 14, weight: '400', lineHeight: 1.5, letterSpacing: 0 },
  eyebrow: { font: '$body', size: 13, weight: '700', lineHeight: 1.4, letterSpacing: 1.5 },
  button: { font: '$body', size: 16, weight: '600', lineHeight: 1, letterSpacing: 0 },
});
export const THEMES = {
  clean: { name: 'Clean', desc: 'White, blue accent, system fonts.', tokens: {
    colors: { primary: '#3b5bfd', onPrimary: '#ffffff', background: '#ffffff', surface: '#f4f6f9', text: '#15171a', muted: '#5f6672', border: '#e3e6eb' },
    fonts: { heading: SANS, body: SANS }, textStyles: textStyles() } },
  editorial: { name: 'Editorial', desc: 'Warm paper, serif headings.', tokens: {
    colors: { primary: '#b4441c', onPrimary: '#ffffff', background: '#fbf8f3', surface: '#f2ece2', text: '#1d1a16', muted: '#6b6359', border: '#e2d9cb' },
    fonts: { heading: SERIF, body: SANS }, textStyles: textStyles({ weight: '600', letterSpacing: -0.5 }) } },
  bold: { name: 'Bold', desc: 'Dark, lime accent, big type.', tokens: {
    colors: { primary: '#a3e635', onPrimary: '#0b0d0a', background: '#0e1012', surface: '#181b1f', text: '#f2f4f5', muted: '#a0a7af', border: '#2a2f35' },
    fonts: { heading: SANS, body: SANS }, textStyles: textStyles({ weight: '900', letterSpacing: -1.5 }) } },
  warm: { name: 'Warm', desc: 'Cream and orange, rounded type.', tokens: {
    colors: { primary: '#e8590c', onPrimary: '#ffffff', background: '#fffaf5', surface: '#fff0e3', text: '#2b1d14', muted: '#7a6455', border: '#f1dcc9' },
    fonts: { heading: ROUNDED, body: ROUNDED }, textStyles: textStyles() } },
  mono: { name: 'Mono', desc: 'Black and white, monospaced headings.', tokens: {
    colors: { primary: '#111111', onPrimary: '#ffffff', background: '#ffffff', surface: '#f3f3f3', text: '#111111', muted: '#666666', border: '#e2e2e2' },
    fonts: { heading: MONO, body: SANS }, textStyles: textStyles({ weight: '700', letterSpacing: -1 }) } },
};
// tokens with the theme's colours, fonts and text styles merged in (others kept); `only missing`: add what isn't there
export function applyTheme(tokens = {}, id = 'clean', onlyMissing = false) {
  const t = THEMES[id]?.tokens ?? THEMES.clean.tokens, out = structuredClone(tokens ?? {});
  for (const k of ['colors', 'fonts', 'textStyles']) out[k] = onlyMissing ? { ...structuredClone(t[k]), ...out[k] } : { ...out[k], ...structuredClone(t[k]) };
  return out;
}
// token names the sections use, to tell whether a project has them
export const SECTION_TOKENS = { colors: Object.keys(THEMES.clean.tokens.colors), textStyles: Object.keys(THEMES.clean.tokens.textStyles) };
export const missingTokens = tokens => [...SECTION_TOKENS.colors.filter(c => !tokens?.colors?.[c]), ...SECTION_TOKENS.textStyles.filter(s => !tokens?.textStyles?.[s])];

// ---------- node helpers ----------
const rect = (o = {}) => ({ anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], pos: [0, 0], size: [100, 100], rotation: 0, scale: [1, 1], zIndex: 0, ...o });
const node = (name, components, size = [100, 100], children = []) => Object.assign(newNode(name, components), { rect: rect({ size }), children });
const phone = (n, path, v) => { ((n.overrides ??= {}).Phone ??= {})[path] = v; return n; };
const fit = { type: 'ContentSizeFitter', props: { vertical: 'preferred' } };
const TAG = { h1: 'h1', h2: 'h2', h3: 'h3', lead: 'p', body: 'p', small: 'p', eyebrow: 'p' };
const text = (name, str, style = 'body', o = {}) => {
  const n = node(name, [{ type: 'Text', props: { text: str, textStyle: style, tag: o.tag ?? TAG[style] ?? 'div', color: o.color ?? (style === 'eyebrow' ? '$primary' : ['lead', 'small'].includes(style) ? '$muted' : '$text'), align: o.align ?? 'left', ...o.props } },
    o.hfit ? { type: 'ContentSizeFitter', props: { vertical: 'preferred', horizontal: 'preferred' } } : fit], [o.width ?? 600, 30]);
  if (style === 'h1') phone(n, 'Text.textStyle', 'h2');
  return n;
};
const le = props => ({ type: 'LayoutElement', props });
// a vertical stack whose children take its width
const stack = (name, kids, o = {}) => node(name, [
  { type: 'VerticalLayoutGroup', props: { spacing: o.gap ?? 16, childAlignment: o.align ?? 'upper-left', padding: o.pad ?? [0, 0, 0, 0], controlWidth: true, expandWidth: true } }, fit,
  ...(o.maxWidth || o.flex || o.minWidth ? [le({ maxWidth: o.maxWidth ?? 0, flexibleWidth: o.flex ?? 0, minWidth: o.minWidth ?? 0 })] : [])], [o.width ?? 600, 100], kids);
// a row that wraps on narrow screens; equal: children share the width and the height
const row = (name, kids, o = {}) => node(name, [
  { type: 'HorizontalLayoutGroup', props: { spacing: o.gap ?? 24, childAlignment: o.align ?? 'upper-left', wrap: o.wrap ?? true, reverse: !!o.reverse, controlWidth: !!o.equal, expandWidth: !!o.equal, controlHeight: !!o.equal, expandHeight: !!o.equal } }, fit,
  ...(o.flex ? [le({ flexibleWidth: o.flex })] : [])], [o.width ?? 600, o.height ?? 60], kids);
const container = (kids, o = {}) => stack('Container', kids, { maxWidth: o.maxWidth ?? 1120, gap: o.gap ?? 40, align: o.align ?? 'upper-left' });
// a full-width section of a flowing page
const section = (name, kids, o = {}) => {
  const n = node(name, [
    { type: 'Element', props: { tag: o.tag ?? 'section', id: o.id ?? '' } },
    { type: 'Image', props: { color: o.bg ?? '$background' } },
    { type: 'VerticalLayoutGroup', props: { padding: o.pad ?? [24, 24, 96, 96], spacing: o.gap ?? 40, childAlignment: 'upper-center', controlWidth: true, expandWidth: true } }, fit,
    ...(o.style ? [{ type: 'Style', props: { css: o.style } }] : [])], [0, 200], kids);
  n.rect = rect({ anchorMin: [0, 0], anchorMax: [1, 0], pivot: [0.5, 0], size: [0, 200] });
  const [l, r, t, b] = o.pad ?? [24, 24, 96, 96];
  return phone(n, 'VerticalLayoutGroup.padding', [Math.min(l, 20), Math.min(r, 20), Math.round(t * 0.6), Math.round(b * 0.6)]);
};
const card = (name, kids, o = {}) => node(name, [
  { type: 'Image', props: { color: o.bg ?? '$surface', radius: o.radius ?? 14 } },
  { type: 'VerticalLayoutGroup', props: { padding: Array(4).fill(o.pad ?? 28), spacing: o.gap ?? 12, childAlignment: o.align ?? 'upper-left', controlWidth: true, expandWidth: true } }, fit,
  le({ flexibleWidth: 1, minWidth: o.minWidth ?? 240 }),
  ...(o.style ? [{ type: 'Style', props: { css: o.style } }] : [])], [300, 200], kids);
const icon = (name, o = {}) => node('Icon', [{ type: 'Icon', props: { icon: name, color: o.color ?? '$primary', strokeWidth: 1.75 } }, le({ preferredWidth: o.size ?? 36, preferredHeight: o.size ?? 36 })], [o.size ?? 36, o.size ?? 36]);
const HOVER = { css: 'transition: filter .15s, transform .15s; cursor: pointer;', hover: 'filter: brightness(1.08); transform: translateY(-1px);' };
const BTN = { primary: ['$primary', '$onPrimary'], secondary: ['$surface', '$text'], light: ['$background', '$text'], inverse: ['$onPrimary', '$primary'] }; // light: on a card
const button = (label, href = '#', variant = 'primary') => {
  const [bg, fg] = BTN[variant];
  return node(label, [
    { type: 'Image', props: { color: bg, radius: 10 } }, { type: 'Link', props: { href } },
    { type: 'HorizontalLayoutGroup', props: { padding: [26, 26, 0, 0], childAlignment: 'middle-center' } },
    { type: 'ContentSizeFitter', props: { horizontal: 'preferred' } }, { type: 'Style', props: HOVER }], [160, 50],
  [node('Label', [{ type: 'Text', props: { text: label, textStyle: 'button', color: fg, valign: 'middle', wrap: false } }, { type: 'ContentSizeFitter', props: { horizontal: 'preferred' } }], [100, 20])]);
};
// a form's submit button; fitted: as wide as its label (else as wide as the form)
const submit = (label, fitted = true) => node(label, [
  { type: 'Image', props: { color: '$primary', radius: 10 } }, { type: 'Button', props: { type: 'submit', transition: 'none' } }, // the Image's colour, the Style's hover
  { type: 'HorizontalLayoutGroup', props: { padding: [26, 26, 0, 0], childAlignment: 'middle-center' } },
  ...(fitted ? [{ type: 'ContentSizeFitter', props: { horizontal: 'preferred' } }] : []), { type: 'Style', props: HOVER }], [160, 50],
[node('Label', [{ type: 'Text', props: { text: label, textStyle: 'button', color: '$onPrimary', valign: 'middle', wrap: false } }, { type: 'ContentSizeFitter', props: { horizontal: 'preferred' } }], [100, 20])]);
const buttons = (list, align = 'middle-left') => row('Buttons', list.map(([l, h, v]) => button(l, h, v)), { gap: 12, align, height: 50 });
// an image (or a placeholder: a tinted box with an image icon)
const picture = (name, o = {}) => {
  const n = node(name, [{ type: 'Image', props: { color: o.size ? '$border' : '$surface', sprite: o.src ?? '', element: 'img', fit: 'cover', radius: o.radius ?? 16, alt: o.alt ?? '' } },
    ...(o.flex ? [le({ flexibleWidth: o.flex, minWidth: o.minWidth ?? 280 })] : []), ...(o.size ? [le({ preferredWidth: o.size, preferredHeight: o.size })] : [])], [o.size ?? 600, o.height ?? o.size ?? 360]);
  if (!o.size && (o.height ?? 360) > 300) phone(n, 'rect.size', [600, Math.round((o.height ?? 360) * 0.6)]); // shorter on phones
  if (!o.src) n.children.push(node('Placeholder', [{ type: 'Icon', props: { icon: o.size && o.size < 100 ? 'user' : 'image', color: '$muted', strokeWidth: 1.5 } }], [o.size ? Math.round(o.size * 0.4) : 48, o.size ? Math.round(o.size * 0.4) : 48]));
  return n;
};
const heading = (eyebrow, title, lead, align = 'center') => stack('Heading', [
  eyebrow && text('Eyebrow', eyebrow.toUpperCase(), 'eyebrow', { align: align === 'center' ? 'center' : 'left' }),
  text('Title', title, 'h2', { align: align === 'center' ? 'center' : 'left' }),
  lead && text('Lead', lead, 'lead', { align: align === 'center' ? 'center' : 'left' })].filter(Boolean), { gap: 12, maxWidth: align === 'center' ? 720 : 0 });
const FIELD_CSS = '& > input, & > textarea { border: 1px solid var(--gpsb-color-border); border-radius: 8px; padding: 10px 12px; box-sizing: border-box; background: transparent; color: var(--gpsb-color-text); font: inherit; font-size: 16px; }\n& > input:focus, & > textarea:focus { outline: 2px solid var(--gpsb-color-primary); outline-offset: -1px; }\n&.gpsb-invalid > input, &.gpsb-invalid > textarea { border-color: #e5534b; }';
const field = (name, props, h = 44) => node(name, [{ type: 'Image', props: { color: '$background', radius: 8 } }, { type: 'InputField', props: { required: true, ...props } }, { type: 'Style', props: { rules: FIELD_CSS } }], [400, h]);

// ---------- sections ----------
// o: { site, nav: [[label, href]], images: [paths], title, …} (templates pass their own words and pictures)
const NAV = [['Home', 'index'], ['About', '#about'], ['Pricing', '#pricing'], ['Contact', '#contact']];
const navItems = nav => nav.map(([l, h]) => `${l} | ${h}`).join('\n');
const img = (o, i) => o.images?.[i % (o.images.length || 1)];

export const SECTIONS = [
  { id: 'header', name: 'Header', category: 'Navigation', desc: 'Logo, menu and a button; the menu folds into ☰ on phones.',
    make: (o = {}) => {
      const s = section('Header', [container([row('Bar', [
        node('Logo', [{ type: 'Link', props: { href: 'index' } }, { type: 'Text', props: { text: o.site ?? 'Brand', textStyle: 'h3', color: '$text', valign: 'middle', wrap: false } }, { type: 'ContentSizeFitter', props: { horizontal: 'preferred' } }], [120, 48]),
        node('Menu', [{ type: 'NavigationMenu', props: { items: navItems(o.nav ?? NAV), color: '$text', hoverColor: '$primary', activeColor: '$primary', menuBackground: '$background', size: 16, gap: 28, weight: '500' } }, le({ flexibleWidth: 1 })], [400, 48]),
        phone(button(o.cta ?? 'Get started', o.ctaHref ?? '#contact'), 'active', false),
      ], { gap: 24, align: 'middle-left', wrap: false, height: 50 })], { gap: 0 })], { tag: 'header', pad: [24, 24, 14, 14], style: 'border-bottom: 1px solid var(--gpsb-color-border); position: sticky; top: 0; z-index: 50;' });
      return s;
    } },
  { id: 'hero', name: 'Hero, centred', category: 'Hero', desc: 'A big headline, a line of text, two buttons and a picture.',
    make: (o = {}) => section('Hero', [
      stack('Intro', [text('Eyebrow', (o.eyebrow ?? 'New: version 2.0').toUpperCase(), 'eyebrow', { align: 'center' }),
        text('Headline', o.title ?? 'Build something people love', 'h1', { align: 'center' }),
        text('Lead', o.lead ?? 'A short sentence that says what you do, for whom, and why it matters. Keep it to two lines.', 'lead', { align: 'center' }),
        buttons([[o.cta ?? 'Get started', o.ctaHref ?? '#contact', 'primary'], [o.cta2 ?? 'Learn more', o.cta2Href ?? '#features', 'secondary']], 'middle-center')], { gap: 20, maxWidth: 820, align: 'upper-center' }),
      container([picture('Picture', { height: 520, src: img(o, 0) })])], { pad: [24, 24, 104, 104], gap: 64 }) },
  { id: 'hero-split', name: 'Hero, split', category: 'Hero', desc: 'Headline and buttons beside a picture.',
    make: (o = {}) => section('Hero', [container([row('Split', [
      stack('Intro', [text('Eyebrow', (o.eyebrow ?? 'Welcome').toUpperCase(), 'eyebrow'), text('Headline', o.title ?? 'Good work, done well', 'h1'),
        text('Lead', o.lead ?? 'Tell visitors what you offer in a sentence or two. Then give them one clear thing to do next.', 'lead'),
        buttons([[o.cta ?? 'Book a call', o.ctaHref ?? '#contact', 'primary'], [o.cta2 ?? 'Our work', o.cta2Href ?? '#work', 'secondary']])], { gap: 20, flex: 1, minWidth: 300 }),
      picture('Picture', { height: 480, flex: 1, src: img(o, 0) })], { gap: 56, align: 'middle-left' })])], { pad: [24, 24, 88, 88] }) },
  { id: 'logos', name: 'Logo strip', category: 'Social proof', desc: 'A line of client or partner names.',
    make: (o = {}) => section('Logos', [container([
      text('Caption', (o.caption ?? 'Trusted by teams at').toUpperCase(), 'eyebrow', { align: 'center', color: '$muted' }),
      row('Names', (o.names ?? ['Northwind', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli']).map(n => node(n, [{ type: 'Text', props: { text: n, textStyle: 'h3', color: '$muted', wrap: false } }, { type: 'ContentSizeFitter', props: { horizontal: 'preferred', vertical: 'preferred' } }], [120, 30])), { gap: 48, align: 'middle-center' })], { gap: 24 })], { pad: [24, 24, 48, 48], gap: 24 }) },
  { id: 'features', name: 'Features', category: 'Content', desc: 'Three cards with an icon, a title and a sentence.',
    make: (o = {}) => section('Features', [container([heading(o.eyebrow ?? 'Features', o.title ?? 'Everything you need', o.lead ?? 'What makes it good, in three short points.'),
      row('Cards', (o.items ?? [['zap', 'Fast', 'Pages load in a blink: plain HTML and CSS, nothing in the way.'], ['shield-check', 'Reliable', 'No servers to patch and nothing to break at 3 a.m.'], ['heart', 'Loved', 'People come back because it simply works, every time.']])
        .map(([ic, t, d]) => card(t, [icon(ic), text('Title', t, 'h3'), text('Text', d, 'body', { color: '$muted' })])), { equal: true, gap: 24 })], { gap: 48, align: 'upper-center' })], { id: 'features' }) },
  { id: 'content-split', name: 'Text and picture', category: 'Content', desc: 'A paragraph and a button beside a picture.',
    make: (o = {}) => section(o.name ?? 'About', [container([row('Split', [
      picture('Picture', { height: 420, flex: 1, src: img(o, 1) }),
      stack('Text', [text('Eyebrow', (o.eyebrow ?? 'About us').toUpperCase(), 'eyebrow'), text('Title', o.title ?? 'A small team with big standards', 'h2'),
        text('Body', o.body ?? 'Say who you are and what you care about. A few honest sentences work better than a list of buzzwords: what you do, how you do it, and what people get out of it.', 'body', { color: '$muted' }),
        buttons([[o.cta ?? 'Read our story', o.ctaHref ?? '#', 'secondary']])], { gap: 18, flex: 1, minWidth: 300 })], { gap: 56, align: 'middle-left', reverse: !!o.reverse })])], { id: o.id ?? 'about', bg: o.bg }) },
  { id: 'stats', name: 'Numbers', category: 'Social proof', desc: 'Four big numbers with a label each.',
    make: (o = {}) => section('Numbers', [container([row('Stats', (o.items ?? [['12k+', 'happy customers'], ['99.9%', 'uptime'], ['4.9/5', 'average rating'], ['24/7', 'support']])
      .map(([n, l]) => stack(l, [text('Number', n, 'h2', { align: 'center', color: '$primary' }), text('Label', l, 'small', { align: 'center' })], { gap: 4, flex: 1, minWidth: 160, align: 'upper-center' })), { gap: 24, align: 'upper-center' })])], { bg: '$surface', pad: [24, 24, 64, 64] }) },
  { id: 'testimonials', name: 'Testimonials', category: 'Social proof', desc: 'Three quotes from happy people.',
    make: (o = {}) => section('Testimonials', [container([heading(o.eyebrow ?? 'Testimonials', o.title ?? 'People say nice things', null),
      row('Quotes', (o.items ?? [['“The easiest decision we made all year. It paid for itself in a month.”', 'Maria Lopez', 'Founder, Northwind'], ['“Clear, quick and friendly. I recommend them to everyone I know.”', 'Sam Okafor', 'Designer'], ['“They listened, then delivered more than we asked for.”', 'Jin Park', 'CTO, Globex']])
        .map(([q, n, r]) => card(n, [text('Quote', q, 'body'), row('Person', [picture('Avatar', { size: 44, radius: 999 }), stack('Who', [text('Name', n, 'small', { color: '$text', props: { weight: '700' } }), text('Role', r, 'small')], { gap: 0, flex: 1 })], { gap: 12, align: 'middle-left', wrap: false })], { gap: 20 })), { equal: true })], { gap: 48, align: 'upper-center' })]) },
  { id: 'pricing', name: 'Pricing', category: 'Sales', desc: 'Three plans; the middle one stands out.',
    make: (o = {}) => section('Pricing', [container([heading(o.eyebrow ?? 'Pricing', o.title ?? 'Simple, honest prices', o.lead ?? 'Start free. Upgrade when you grow. Cancel any time.'),
      row('Plans', (o.items ?? [['Starter', '$0', 'For trying things out.', 'One project\nCommunity support\nBasic analytics'], ['Pro', '$19', 'For growing teams.', 'Unlimited projects\nPriority support\nAdvanced analytics\nCustom domain'], ['Business', '$49', 'For organisations.', 'Everything in Pro\nSingle sign-on\nDedicated manager']])
        .map(([n, p, d, f], i) => card(n, [text('Plan', n, 'h3'), row('Price', [text('Amount', p, 'h2', { hfit: true }), text('Per', '/ month', 'small', { hfit: true })], { gap: 6, align: 'lower-left', wrap: false }),
          text('Description', d, 'small'), text('Features', f.split('\n').map(x => `✓  ${x}`).join('\n'), 'body', { props: { lineHeight: 2 } }),
          buttons([[i === 1 ? 'Start free trial' : 'Choose plan', '#contact', i === 1 ? 'primary' : 'light']])],
        { gap: 16, pad: 32, style: i === 1 ? 'box-shadow: 0 0 0 2px var(--gpsb-color-primary);' : '' })), { equal: true })], { gap: 48, align: 'upper-center' })], { id: 'pricing' }) },
  { id: 'faq', name: 'Questions', category: 'Content', desc: 'Frequently asked questions that open one at a time.',
    make: (o = {}) => section('FAQ', [stack('Column', [heading(o.eyebrow ?? 'FAQ', o.title ?? 'Questions and answers', null),
      node('Accordion', [{ type: 'Accordion', props: { items: o.items ?? '## How does it work?\nYou sign up, pick a plan and you are ready in minutes.\n\n## Can I cancel at any time?\nYes. There are no contracts and no hidden fees.\n\n## Do you offer refunds?\nIf it is not right for you, write to us within 30 days for a full refund.\n\n## How do I get help?\nEmail us any time; we answer within one working day.', questionColor: '$text', answerColor: '$muted', lineColor: '$border', size: 18 } }, fit], [760, 300])], { maxWidth: 760, gap: 40 })], { id: 'faq' }) },
  { id: 'gallery', name: 'Gallery', category: 'Media', desc: 'A grid of pictures that open full screen.',
    make: (o = {}) => section('Gallery', [container([heading(o.eyebrow ?? 'Gallery', o.title ?? 'Recent work', null),
      node('Gallery', [{ type: 'Gallery', props: { images: o.images ?? [], alts: o.alts ?? [], columns: 3, gap: 16, aspect: '4/3', radius: 12 } }, fit], [1120, 600])], { gap: 40, align: 'upper-center' })], { id: o.id ?? 'work' }) },
  { id: 'team', name: 'Team', category: 'Content', desc: 'Four people with a photo, a name and a role.',
    make: (o = {}) => section('Team', [container([heading(o.eyebrow ?? 'Team', o.title ?? 'The people behind it', null),
      row('People', (o.items ?? [['Alex Morgan', 'Founder'], ['Priya Shah', 'Design'], ['Leo Martin', 'Engineering'], ['Ana Costa', 'Customers']])
        .map(([n, r]) => stack(n, [picture('Photo', { size: 140, radius: 999 }), text('Name', n, 'h3', { align: 'center' }), text('Role', r, 'small', { align: 'center' })], { gap: 8, flex: 1, minWidth: 180, align: 'upper-center' })), { gap: 32, align: 'upper-center' })], { gap: 48, align: 'upper-center' })], { id: 'team' }) },
  { id: 'cta', name: 'Call to action', category: 'Sales', desc: 'A coloured band with a headline and a button.',
    make: (o = {}) => section('Call to action', [stack('Column', [text('Title', o.title ?? 'Ready to get started?', 'h2', { align: 'center', color: '$onPrimary' }),
      text('Lead', o.lead ?? 'It takes two minutes. No credit card needed.', 'lead', { align: 'center', color: '$onPrimary' }),
      buttons([[o.cta ?? 'Get started', o.ctaHref ?? '#contact', 'inverse']], 'middle-center')], { maxWidth: 720, gap: 20, align: 'upper-center' })], { bg: '$primary', pad: [24, 24, 88, 88] }) },
  { id: 'contact', name: 'Contact', category: 'Forms', desc: 'Contact details beside a form that sends to you.',
    make: (o = {}) => {
      const msg = text('Message', '', 'small');
      const form = node('Form', [{ type: 'Image', props: { color: '$surface', radius: 16 } }, { type: 'Form', props: { provider: 'formspree', message: msg.id } },
        { type: 'VerticalLayoutGroup', props: { padding: [32, 32, 32, 32], spacing: 14, controlWidth: true, expandWidth: true } }, fit, le({ flexibleWidth: 1, minWidth: 300 })], [460, 400], [
        field('name', { placeholder: 'Your name', autocomplete: 'name' }), field('email', { placeholder: 'Email address', contentType: 'email', autocomplete: 'email' }),
        field('message', { placeholder: 'How can we help?', lineType: 'multi' }, 130),
        submit('Send message', false),
        msg]);
      return section('Contact', [container([row('Split', [
        stack('Details', [text('Eyebrow', 'CONTACT', 'eyebrow'), text('Title', o.title ?? 'Let’s talk', 'h2'),
          text('Lead', o.lead ?? 'Tell us a little about what you need and we’ll get back to you within a day.', 'lead'),
          ...[['mail', o.email ?? 'hello@example.com'], ['phone', o.phone ?? '+1 555 0100'], ['map-pin', o.address ?? '12 Market Street, Springfield']].map(([ic, t]) =>
            row(ic, [icon(ic, { size: 22 }), text('Text', t, 'body', { hfit: true })], { gap: 12, align: 'middle-left', wrap: false }))], { gap: 16, flex: 1, minWidth: 280 }),
        form], { gap: 56, align: 'upper-left' })])], { id: 'contact' });
    } },
  { id: 'newsletter', name: 'Newsletter', category: 'Forms', desc: 'An email field and a button to sign up.',
    make: (o = {}) => {
      const msg = text('Message', '', 'small', { align: 'center' });
      const email = field('email', { placeholder: 'you@example.com', contentType: 'email', autocomplete: 'email' }, 50);
      email.components.push(le({ flexibleWidth: 1, minWidth: 220 }));
      const form = row('Form', [email, submit(o.cta ?? 'Subscribe')], { gap: 10, align: 'middle-center', height: 50 });
      form.components.unshift({ type: 'Form', props: { provider: 'formspree', message: msg.id, successMessage: 'Thanks! Check your inbox to confirm.' } });
      const box = card('Box', [text('Title', o.title ?? 'Get the newsletter', 'h2', { align: 'center' }),
        text('Lead', o.lead ?? 'One short email a month. No spam, unsubscribe any time.', 'lead', { align: 'center' }), form, msg], { gap: 16, pad: 48, align: 'upper-center' });
      box.components = box.components.map(c => (c.type === 'LayoutElement' ? le({ maxWidth: 760 }) : c)); // a readable width, centred
      return section('Newsletter', [box], { pad: [24, 24, 72, 72], id: o.id ?? 'newsletter' });
    } },
  { id: 'footer', name: 'Footer', category: 'Navigation', desc: 'Brand, links and social icons on a dark band.',
    make: (o = {}) => section('Footer', [container([row('Columns', [
      stack('Brand', [text('Logo', o.site ?? 'Brand', 'h3', { color: '$background' }), text('About', o.about ?? 'A sentence about who you are and what you make.', 'small', { color: '$border' })], { gap: 10, flex: 2, minWidth: 240 }),
      stack('Links', [text('Heading', 'PAGES', 'eyebrow', { color: '$border' }), node('Menu', [{ type: 'NavigationMenu', props: { items: navItems(o.nav ?? NAV), orientation: 'vertical', align: 'start', gap: 10, color: '$background', hoverColor: '$primary', activeColor: '$background', size: 15, collapseBelow: 0 } }, le({ preferredHeight: (o.nav ?? NAV).length * 34 })], [200, 136])], { gap: 12, flex: 1, minWidth: 160 }),
      stack('Social', [text('Heading', 'FOLLOW', 'eyebrow', { color: '$border' }), node('Social', [{ type: 'SocialLinks', props: { links: o.social ?? 'https://instagram.com/\nhttps://x.com/\nhttps://linkedin.com/\nmailto:hello@example.com', color: '$background', size: 22, gap: 16 } }, le({ preferredHeight: 26 })], [200, 26])], { gap: 12, flex: 1, minWidth: 160 }),
    ], { gap: 40 }), text('Copyright', o.copyright ?? `© ${new Date().getFullYear()} ${o.site ?? 'Brand'}. All rights reserved.`, 'small', { color: '$muted' })], { gap: 48 })], { tag: 'footer', bg: '$text', pad: [24, 24, 72, 48] }) },
];
export const sectionById = id => SECTIONS.find(s => s.id === id);

// ---------- placeholder pictures (templates) ----------
const PICS = [['#c7d2fe', '#6366f1', '#312e81'], ['#fde68a', '#f59e0b', '#7c2d12'], ['#bbf7d0', '#10b981', '#064e3b'], ['#fbcfe8', '#ec4899', '#831843'], ['#bae6fd', '#0ea5e9', '#0c4a6e'], ['#e9d5ff', '#a855f7', '#4c1d95']];
export const placeholderSVG = i => {
  const [a, b, c] = PICS[i % PICS.length], k = i % 3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <circle cx="${[880, 300, 640][k]}" cy="${[260, 300, 200][k]}" r="${[150, 110, 130][k]}" fill="#fff" opacity=".35"/>
  <path d="M0 ${[620, 580, 640][k]} C 300 ${[480, 700, 520][k]}, 700 ${[760, 460, 720][k]}, 1200 ${[560, 600, 500][k]} V 800 H 0 Z" fill="${c}" opacity=".55"/>
  <path d="M0 ${[700, 680, 720][k]} C 400 ${[620, 760, 640][k]}, 800 ${[800, 640, 780][k]}, 1200 ${[680, 720, 640][k]} V 800 H 0 Z" fill="${c}" opacity=".8"/>
</svg>
`;
};

// ---------- project templates ----------
// a flowing page: Canvas (themed background and font) + a vertical layout; sections stack and the page grows
const flowPage = (title, sections, extra = {}) => {
  const c = node('Canvas', [{ type: 'Canvas', props: { title, background: '$background', font: '$body', ...extra } }, { type: 'CanvasScaler', props: {} },
    { type: 'VerticalLayoutGroup', props: { controlWidth: true, expandWidth: true } }], [1920, 1080], sections);
  c.rect = rect({ anchorMin: [0, 0], anchorMax: [1, 1], size: [0, 0] });
  return c;
};
const imgs = n => Array.from({ length: n }, (_, i) => `img/photo-${i + 1}.svg`);
const posts = () => [
  ['Notes from a slow week', 'notes-from-a-slow-week', '2026-05-02', ['Life'], 'Taking a week off the internet, and what came back.'],
  ['How we plan a project', 'how-we-plan-a-project', '2026-04-18', ['Work', 'Process'], 'Three questions we ask before we write a line.'],
  ['A walk along the river', 'a-walk-along-the-river', '2026-03-30', ['Travel', 'Life'], 'Photos and thoughts from a Sunday morning.'],
  ['Tools we keep coming back to', 'tools-we-keep-coming-back-to', '2026-03-09', ['Work'], 'The short list that survived ten years of trends.'],
  ['First post', 'first-post', '2026-02-14', ['News'], 'Hello! Here is what this blog will be about.'],
].map(([title, slug, date, tags, excerpt], i) => ({ title, slug, date, tags, excerpt, cover: `img/photo-${(i % 6) + 1}.svg`,
  body: `${excerpt}\n\n## A heading\n\nWrite your post in **Markdown**: headings, lists, [links](index) and images.\n\n- One point\n- Another point\n\n> A quote that stands out.\n` }));
const POST_SCHEMA = { path: 'posts', title: 'title', summary: 'excerpt', date: 'date', sort: '-date',
  fields: { title: { type: 'string', required: true }, slug: { type: 'string', help: 'the page address: post/<slug>' }, date: { type: 'date' }, excerpt: { type: 'text' }, cover: { type: 'image' }, tags: { type: 'tags' }, body: { type: 'markdown' } } };

// a list of collection items as cards (Repeat): blog posts, portfolio projects
const itemCards = (source, path, href, o = {}) => node('List', [{ type: 'Repeat', props: { source, path, sortBy: o.sortBy ?? '', pageSize: o.pageSize ?? 0 } },
  { type: 'HorizontalLayoutGroup', props: { spacing: 28, wrap: true, controlWidth: true, expandWidth: true } }, fit], [1120, 400], [
  node('Card', [{ type: 'Link', props: { href } }, { type: 'VerticalLayoutGroup', props: { spacing: 12, controlWidth: true, expandWidth: true } }, fit, le({ flexibleWidth: 1, minWidth: 300, maxWidth: 360 }), { type: 'Style', props: HOVER }], [340, 380], [
    node('Cover', [{ type: 'Image', props: { sprite: '{{item.cover}}', element: 'img', fit: 'cover', radius: 14, color: '$surface' } }], [340, 220]),
    text('Meta', o.meta ?? '{{item.date | date}} · {{item.tags | join: ", "}}', 'small'),
    text('Title', '{{item.title}}', 'h3'), text('Excerpt', o.excerpt ?? '{{item.excerpt}}', 'body', { color: '$muted' })])]);

export const TEMPLATES = {
  landing: { name: 'Landing page', desc: 'One long page: hero, features, pricing, testimonials, FAQ and a sign-up.', theme: 'clean' },
  business: { name: 'Business', desc: 'Home, About and Contact pages for a company or a studio.', theme: 'editorial' },
  portfolio: { name: 'Portfolio', desc: 'Your projects as a collection with a page each, an about section and contact.', theme: 'bold' },
  blog: { name: 'Blog', desc: 'Posts with tag pages, pagination and an RSS feed, edited in the Content window.', theme: 'warm' },
};
// files of a new project: { 'project.json': text, 'pages/index.json': text, 'assets/…': text }
export function templateFiles(id, name = 'My Site', themeId) {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`unknown template "${id}" (${Object.keys(TEMPLATES).join(', ')})`);
  const theme = THEMES[themeId] ? themeId : t.theme, site = name, pages = {}, json = {};
  const images = imgs(6), o = { site, images };
  if (id === 'landing') {
    const nav = [['Features', '#features'], ['Pricing', '#pricing'], ['FAQ', '#faq'], ['Contact', '#contact']];
    pages.index = flowPage(site, [sectionById('header').make({ ...o, nav, cta: 'Sign up', ctaHref: '#signup' }), sectionById('hero').make(o), sectionById('logos').make(o),
      sectionById('features').make(o), sectionById('content-split').make({ ...o, eyebrow: 'How it works', title: 'From idea to done in an afternoon', cta: 'See how', id: 'how' }),
      sectionById('stats').make(o), sectionById('testimonials').make(o), sectionById('pricing').make(o), sectionById('faq').make(o),
      sectionById('newsletter').make({ ...o, title: 'Stay in the loop', id: 'signup' }), sectionById('cta').make({ ...o, ctaHref: '#signup' }), sectionById('footer').make({ ...o, nav })]);
  } else if (id === 'business') {
    const nav = [['Home', 'index'], ['About', 'about'], ['Contact', 'contact']], b = { ...o, nav, cta: 'Get in touch', ctaHref: 'contact' };
    pages.index = flowPage(site, [sectionById('header').make(b), sectionById('hero-split').make({ ...b, cta2: 'About us', cta2Href: 'about' }), sectionById('features').make({ ...b, eyebrow: 'Services', title: 'What we do', items: [['pen-tool', 'Design', 'Identities, websites and print that look like you.'], ['code', 'Development', 'Fast, accessible sites that are easy to keep up to date.'], ['trending-up', 'Growth', 'Search, content and campaigns that bring people in.']] }),
      sectionById('content-split').make({ ...b, ctaHref: 'about' }), sectionById('testimonials').make(b), sectionById('cta').make({ ...b, title: 'Have a project in mind?', lead: 'Tell us about it. The first call is free.', cta: 'Contact us', ctaHref: 'contact' }), sectionById('footer').make(b)]);
    pages.about = flowPage(`About · ${site}`, [sectionById('header').make(b), sectionById('hero').make({ ...b, eyebrow: 'About', title: 'We make things that last', cta: 'Meet the team', ctaHref: '#team', cta2: 'Contact', cta2Href: 'contact', images: [images[2]] }),
      sectionById('content-split').make({ ...b, eyebrow: 'Our story', title: 'Started in a garage, still curious', images: [images[3], images[3]], reverse: true, cta: 'Work with us', ctaHref: 'contact' }), sectionById('stats').make(b), sectionById('team').make(b), sectionById('footer').make(b)]);
    pages.contact = flowPage(`Contact · ${site}`, [sectionById('header').make(b), sectionById('contact').make(b), sectionById('faq').make(b), sectionById('footer').make(b)]);
  } else if (id === 'portfolio') {
    const nav = [['Work', '#work'], ['About', '#about'], ['Contact', '#contact']], p = { ...o, nav, cta: 'Hire me', ctaHref: '#contact' };
    json['data/projects.json'] = { projects: ['Lumen Coffee', 'Field Guide', 'Northwind Air', 'Paper & Ink', 'Tidal', 'Orbit Studio'].map((title, i) => ({ title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), year: 2026 - Math.floor(i / 2), tags: [['Branding', 'Web'], ['Editorial'], ['Web', 'App'], ['Print'], ['App'], ['Branding']][i], summary: 'A short line about the brief and what came out of it.', cover: images[i], body: 'Tell the story of the project: the brief, the idea, the result.\n\n## The brief\n\nWhat the client needed.\n\n## The outcome\n\nWhat changed for them.' })) };
    json['data/projects.schema.json'] = { path: 'projects', title: 'title', summary: 'summary', fields: { title: { type: 'string', required: true }, slug: { type: 'string' }, year: { type: 'number' }, summary: { type: 'text' }, cover: { type: 'image' }, tags: { type: 'tags' }, body: { type: 'markdown' } } };
    const work = section('Work', [container([heading('Selected work', 'Projects', null, 'left'), itemCards('data/projects.json', 'projects', 'project/{{item.slug}}', { meta: '{{item.year}} · {{item.tags | join: ", "}}', excerpt: '{{item.summary}}' })], { gap: 40 })], { id: 'work' });
    pages.index = flowPage(site, [sectionById('header').make(p), sectionById('hero-split').make({ ...p, eyebrow: 'Designer & developer', title: `Hi, I’m ${site}`, lead: 'I design and build brands and websites for people who care about the details.', cta: 'See my work', ctaHref: '#work', cta2: 'Contact', cta2Href: '#contact' }),
      work, sectionById('content-split').make({ ...p, eyebrow: 'About', title: 'Ten years of making things', cta: 'Download CV', reverse: true }), sectionById('testimonials').make(p), sectionById('contact').make({ ...p, title: 'Let’s work together' }), sectionById('footer').make(p)]);
    pages.project = flowPage('{{item.title}} · ' + site, [sectionById('header').make({ ...p, nav: [['Work', 'index#work'], ['About', 'index#about'], ['Contact', 'index#contact']], ctaHref: 'index#contact' }),
      section('Project', [stack('Column', [text('Meta', '{{item.year}} · {{item.tags | join: ", "}}', 'eyebrow'), text('Title', '{{item.title}}', 'h1'), text('Summary', '{{item.summary}}', 'lead'),
        node('Cover', [{ type: 'Image', props: { sprite: '{{item.cover}}', element: 'img', fit: 'cover', radius: 16, color: '$surface' } }], [880, 500]),
        node('Body', [{ type: 'Markdown', props: { text: '{{item.body}}' } }, fit], [880, 300]), buttons([['← All projects', 'index#work', 'secondary']])], { maxWidth: 880, gap: 24 })]),
      sectionById('footer').make(p)], { collection: 'data/projects.json', collectionPath: 'projects' });
  } else if (id === 'blog') {
    const nav = [['Blog', 'index'], ['Tags', 'tags/life'], ['About', 'about']], b = { ...o, nav, cta: 'Subscribe', ctaHref: 'index#newsletter' };
    json['data/posts.json'] = { posts: posts() };
    json['data/posts.schema.json'] = POST_SCHEMA;
    const tagRow = (path, label) => node('Tags', [{ type: 'Repeat', props: { source: path ? 'data/posts.json' : '', path: path ?? 'item.tags', groupBy: path ? 'tags' : '' } }, { type: 'HorizontalLayoutGroup', props: { spacing: 8, wrap: true } }, fit], [600, 34], [
      node('Tag', [{ type: 'Image', props: { color: '$surface', radius: 999 } }, { type: 'Link', props: { href: path ? 'tags/{{item.slug}}' : 'tags/{{item | slug}}' } }, { type: 'HorizontalLayoutGroup', props: { padding: [14, 14, 0, 0], childAlignment: 'middle-center' } }, { type: 'ContentSizeFitter', props: { horizontal: 'preferred' } }, { type: 'Style', props: HOVER }], [80, 32], [
        node('Label', [{ type: 'Text', props: { text: label, textStyle: 'small', color: '$text', valign: 'middle', wrap: false } }, { type: 'ContentSizeFitter', props: { horizontal: 'preferred' } }], [60, 20])])]);
    const list = (title, lead, source, path) => section('Posts', [container([heading(null, title, lead, 'left'), itemCards(source, path, 'post/{{item.slug}}', { sortBy: source ? '-date' : '', pageSize: 6 }), node('Pages', [{ type: 'Pagination', props: { color: '$text', currentColor: '$primary', align: 'start' } }], [600, 40])], { gap: 40 })], { pad: [24, 24, 72, 96] });
    pages.index = flowPage(site, [sectionById('header').make(b), list('Latest posts', 'Notes on work, travel and the things in between.', 'data/posts.json', 'posts'),
      section('Topics', [container([text('Heading', 'TOPICS', 'eyebrow'), tagRow('posts', '{{item.name}} ({{item.count}})')], { gap: 16 })], { pad: [24, 24, 0, 72] }), sectionById('newsletter').make(b), sectionById('footer').make(b)]);
    pages.post = flowPage('{{item.title}} · ' + site, [sectionById('header').make(b),
      section('Article', [stack('Column', [text('Meta', '{{item.date | date}}', 'eyebrow'), text('Title', '{{item.title}}', 'h1'), text('Excerpt', '{{item.excerpt}}', 'lead'),
        node('Cover', [{ type: 'Image', props: { sprite: '{{item.cover}}', element: 'img', fit: 'cover', radius: 16, color: '$surface' } }], [760, 420]),
        node('Body', [{ type: 'Markdown', props: { text: '{{item.body}}' } }, fit], [760, 300]), tagRow(null, '#{{item}}')], { maxWidth: 760, gap: 24 })], { tag: 'article' }),
      sectionById('newsletter').make(b), sectionById('footer').make(b)], { collection: 'data/posts.json', collectionPath: 'posts', sortBy: '-date', feed: true });
    pages.tags = flowPage('{{item.name}} · ' + site, [sectionById('header').make(b), list('{{item.name}}', '{{item.count}} posts', '', 'item.items'), sectionById('footer').make(b)],
      { collection: 'data/posts.json', collectionPath: 'posts', sortBy: '-date', groupBy: 'tags' });
    pages.about = flowPage(`About · ${site}`, [sectionById('header').make(b), sectionById('content-split').make({ ...b, eyebrow: 'About', title: 'Hello, I write here', body: 'A few words about you and what this blog is about. Edit this text on the canvas.', cta: 'Read the blog', ctaHref: 'index', images: [images[4]] }), sectionById('footer').make(b)]);
  }
  const files = {
    'project.json': JSON.stringify({ name, tokens: applyTheme({}, theme) }, null, 2) + '\n',
    ...Object.fromEntries(Object.entries(pages).map(([n, t]) => [`pages/${n}.json`, JSON.stringify(t, null, 2) + '\n'])),
    ...Object.fromEntries(Object.entries(json).map(([f, v]) => [`assets/${f}`, JSON.stringify(v, null, 2) + '\n'])),
    ...Object.fromEntries(images.map((f, i) => [`assets/${f}`, placeholderSVG(i)])),
  };
  return files;
}
