// Page tree -> HTML + CSS. Isomorphic: the build, the editor preview and the runtime all use it.
import { rectStyle } from './rect.js';
import { componentDef, withDefaults, esc, isFontAsset, isExtension, fontFamily, TOKEN } from './components.js';
import { walk, getComponent, effectiveTree, sortBreakpoints } from './node.js';

export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'node';
const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

// ---------- JSON binding: {{data/site.json:hero.title}}  {{item.name}}  {{index}} ----------
const BIND = /\{\{\s*([^{}]+?)\s*\}\}/g;
export const getPath = (o, path) =>
  path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((v, k) => v?.[k], o);

export function bind(str, ctx, scope) {
  return str.replace(BIND, (m, expr) => {
    const i = expr.indexOf(':');
    const v = i > 0 ? getPath(ctx.json[expr.slice(0, i).trim()], expr.slice(i + 1).trim()) : scope ? getPath(scope, expr) : undefined;
    return v === undefined ? m : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}
const resolveDeep = (v, ctx, scope) =>
  typeof v === 'string' ? bind(v, ctx, scope)
    : Array.isArray(v) ? v.map(x => resolveDeep(x, ctx, scope))
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveDeep(x, ctx, scope)]))
        : v;

// ---------- context ----------
// opts: { pages: [names], customs: {Card:{props,tag}}, behaviours: {Spin:{props}}, json: {path: data},
//         clips: {name: clip}, breakpoints: [{name, maxWidth}], editor: bool, base: '/project/',
//         assetVersions: {path: version} -> asset URLs get ?v=version (cache busting; served as immutable),
//         extensionVersions: {Name: version} (same, for extensions/<Name>.js),
//         inject: { head, bodyEnd } HTML added to every page (bodyEnd not in the editor's edit-mode preview),
//         prefix: '' | '../' | '/sub/' -> prepended to every site-relative URL (page nested in a folder, 404 page),
//         cleanUrls: bool -> page links are about/ instead of about.html, minify: bool -> compact HTML/CSS,
//         tokens: { colors, fonts, textStyles } design tokens (project.json) }
// URL of a page relative to the site root
export const pageUrl = (name, clean) => (!clean ? `${name}.html` : name === 'index' ? '' : `${name}/`);
export function makeCtx(opts = {}) {
  const pages = opts.pages ?? [], prefix = opts.prefix ?? '';
  const page = h => (prefix + pageUrl(h, opts.cleanUrls)) || './';
  return {
    customs: {}, behaviours: {}, json: {}, clips: {}, ...opts, pages, prefix,
    asset: p => { const v = opts.assetVersions?.[p]; return prefix + 'assets/' + String(p).split('/').map(encodeURIComponent).join('/') + (v ? `?v=${v}` : ''); },
    font: p => 'gpsb-' + slug(p),
    // page name, page#anchor, or anything else (URL, #anchor) unchanged
    href: h => { const [n, a] = String(h).split('#'); return pages.includes(h) ? page(h) : a != null && pages.includes(n) ? `${page(n)}#${a}` : h; },
  };
}

const def = (c, ctx) => componentDef(c.type, ctx.customs, ctx.behaviours);
export const propsOf = (c, ctx, scope) => tokenize(def(c, ctx), resolveDeep(withDefaults(def(c, ctx), c.props), ctx, scope));
// colour props holding a design token ($name) -> the token's CSS variable (font tokens: see fontFamily)
function tokenize(d, p) {
  for (const [k, s] of Object.entries(d?.props ?? {})) if (s.type === 'color' && TOKEN.test(p[k] ?? '')) p[k] = `var(--gpsb-color-${p[k].slice(1)})`;
  return p;
}
// :root variables for the project's design tokens
function tokenCss(tokens, ctx) {
  const v = [...Object.entries(tokens?.colors ?? {}).map(([n, c]) => [`--gpsb-color-${n}`, c]),
    ...Object.entries(tokens?.fonts ?? {}).map(([n, f]) => [`--gpsb-font-${n}`, fontFamily(f, ctx)])].filter(([n, x]) => /^--gpsb-[\w-]+$/.test(n) && x);
  return v.length ? block(':root', Object.fromEntries(v), ctx.minify) : '';
}

const layoutOf = (parent, ctx) => {
  for (const c of parent?.components ?? []) { const d = def(c, ctx); if (d?.childStyle) return [d, c]; }
  return null;
};

// CSS declarations for a node (rect + parent layout + components)
export function nodeStyle(node, parent, ctx, scope) {
  const s = {};
  if (parent) {
    const lay = layoutOf(parent, ctx);
    const ignore = getComponent(node, 'LayoutElement')?.props?.ignoreLayout;
    const inLayout = !!lay && !ignore;
    Object.assign(s, rectStyle(node.rect, inLayout));
    if (inLayout) Object.assign(s, lay[0].childStyle(propsOf(lay[1], ctx, scope), node));
  }
  for (const c of node.components ?? []) {
    const d = def(c, ctx);
    if (!d?.style) continue;
    const cs = d.style(propsOf(c, ctx, scope), ctx, node);
    if (cs.filter && s.filter) cs.filter = `${s.filter} ${cs.filter}`; // Shadow + Outline stack
    Object.assign(s, cs);
  }
  if (node.active === false) s.display = 'none';
  return s;
}

export function nodeAttrs(node, ctx, scope) {
  const a = {}, cls = [];
  for (const c of node.components ?? []) {
    const d = def(c, ctx);
    if (!d) continue;
    const p = propsOf(c, ctx, scope);
    if (d.attrs) for (const [k, v] of Object.entries(d.attrs(p, ctx))) k === 'class' ? cls.push(v) : (a[k] = v);
    if (d.custom) for (const [k, v] of Object.entries(p)) {
      const t = d.props[k]?.type ?? '';
      a[kebab(k)] = t.startsWith('asset:') ? (v ? ctx.asset(v) : '') : typeof v === 'string' ? v : JSON.stringify(v);
    }
  }
  return [a, cls];
}

export function nodeTag(node, ctx, scope) {
  for (const c of node.components ?? []) {
    const d = def(c, ctx);
    const t = d?.tag?.(propsOf(c, ctx, scope));
    if (t) return t;
  }
  return 'div';
}

export const decl = s => Object.entries(s).map(([k, v]) => `${k}: ${v};`);
const block = (sel, s, min) => (min ? `${sel}{${Object.entries(s).map(([k, v]) => `${k}:${v}`).join(';')}}` : `${sel} {\n${decl(s).map(l => '  ' + l).join('\n')}\n}`);
const attrStr = a => Object.entries(a).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');

// ---------- page ----------
export function renderPage(root, ctx) {
  const classes = new Map(), used = new Set(), rules = [], firstStyle = new Map(), heads = new Set();
  const className = n => {
    if (!classes.has(n.id)) {
      let base = slug(n.name), c = base, i = 2;
      while (used.has(c)) c = `${base}-${i++}`;
      used.add(c); classes.set(n.id, c);
    }
    return classes.get(n.id);
  };

  function renderNode(node, parent, scope, depth) {
    const cls = className(node), sel = '.' + cls;
    const style = nodeStyle(node, parent, ctx, scope);
    const [attrs, extraCls] = nodeAttrs(node, ctx, scope);
    const css = decl(style).join(' ');
    if (!firstStyle.has(node.id)) {
      firstStyle.set(node.id, css);
      rules.push(block(sel, style, ctx.minify));
      for (const c of node.components ?? []) {
        const r = def(c, ctx)?.rules?.(propsOf(c, ctx, scope), sel, ctx, node);
        if (r) rules.push(r);
      }
    } else if (firstStyle.get(node.id) !== css) attrs.style = css; // repeated clone with bound styles

    const tag = nodeTag(node, ctx, scope);
    const pad = ctx.minify ? '' : '  '.repeat(depth), nl = ctx.minify ? '' : '\n';
    let inner = '';
    for (const c of node.components ?? []) {
      const d = def(c, ctx);
      if (d?.inner) inner += d.inner(propsOf(c, ctx, scope), ctx);
      if (d?.head) for (const x of [d.head(propsOf(c, ctx, scope), ctx)].flat()) if (x) heads.add(x);
    }
    let kids = '';
    const rep = getComponent(node, 'Repeat');
    if (rep) {
      const p = propsOf(rep, ctx, scope);
      let items = getPath(ctx.json[p.source], p.path) ?? [];
      if (!Array.isArray(items)) items = Object.values(items);
      if (p.limit > 0) items = items.slice(0, p.limit);
      items.forEach((item, index) => {
        for (const c of node.children ?? []) kids += renderNode(c, node, { ...scope, item, index, parent: scope }, depth + 1);
      });
    } else for (const c of node.children ?? []) kids += renderNode(c, node, scope, depth + 1);

    const allCls = [parent ? '' : 'gpsb-canvas', cls, ...extraCls].filter(Boolean).join(' ');
    const open = `${pad}<${tag} class="${esc(allCls)}" data-gpsb="${esc(node.id)}"${attrStr(attrs)}>`;
    if (!inner && !kids) return `${open}</${tag}>${nl}`;
    return `${open}${inner}${kids ? nl + kids + pad : ''}</${tag}>${nl}`;
  }

  const body = renderNode(root, null, null, 1);

  // breakpoint overrides -> @media blocks holding only what changed vs the next-wider level
  const bps = sortBreakpoints(ctx.breakpoints), media = [];
  let prev = root;
  bps.forEach((b, i) => {
    const cur = effectiveTree(root, bps.slice(0, i + 1).map(x => x.name)), out = [];
    const visit = (a, ap, z, zp) => {
      if (a === z && ap === zp) return; // shared subtree, same parent: nothing changed below
      const sa = nodeStyle(a, ap, ctx), sz = nodeStyle(z, zp, ctx), diff = {};
      for (const k in sa) if (sa[k] !== sz[k]) diff[k] = sa[k];
      for (const k in sz) if (!(k in sa)) diff[k] = 'unset';
      if (Object.keys(diff).length && classes.has(a.id)) out.push(block('.' + classes.get(a.id), diff, ctx.minify)); // unrendered: empty Repeat
      a.children?.forEach((c, j) => visit(c, a, z.children[j], z));
    };
    visit(cur, null, prev, null);
    if (out.length) media.push(ctx.minify ? `@media (max-width:${b.maxWidth}px){${out.join('')}}` : `@media (max-width: ${b.maxWidth}px) {\n${out.join('\n\n').replace(/^/gm, '  ')}\n}`);
    prev = cur;
  });

  // @font-face for every font asset referenced anywhere
  const fonts = new Set(Object.values(ctx.tokens?.fonts ?? {}).filter(isFontAsset));
  for (const [n] of walk(root)) {
    for (const c of n.components ?? []) for (const v of Object.values(c.props ?? {})) if (isFontAsset(v)) fonts.add(v);
    for (const o of Object.values(n.overrides ?? {})) for (const v of Object.values(o)) if (isFontAsset(v)) fonts.add(v);
  }
  const faces = [...fonts].map(f => `@font-face {\n  font-family: "${ctx.font(f)}";\n  src: url("${ctx.asset(f)}");\n  font-display: swap;\n}`);

  // runtime data: tree with defaults filled + global bindings resolved
  const tree = structuredClone(root);
  const repeats = {};
  for (const [n] of walk(tree)) {
    for (const c of n.components ?? []) c.props = propsOf(c, ctx, null);
    if (n.overrides) n.overrides = resolveDeep(n.overrides, ctx, null);
    const rep = getComponent(n, 'Repeat')?.props;
    if (rep) { let v = getPath(ctx.json[rep.source], rep.path) ?? []; if (!Array.isArray(v)) v = Object.values(v); repeats[n.id] = rep.limit > 0 ? v.slice(0, rep.limit) : v; }
  }
  const clipNames = new Set();
  for (const [n] of walk(tree)) for (const c of n.components ?? []) if (c.type === 'Animator') c.props.clips.forEach(x => clipNames.add(x));
  const clips = ctx.editor ? ctx.clips : Object.fromEntries([...clipNames].filter(k => ctx.clips[k]).map(k => [k, ctx.clips[k]]));
  const behaviours = [...new Set([...walk(root)].flatMap(([n]) => (n.components ?? []).filter(c => c.type.startsWith('behaviour:')).map(c => c.type.slice(10))))];
  const customs = [...new Set([...walk(root)].flatMap(([n]) => (n.components ?? []).filter(c => c.type.startsWith('component:')).map(c => c.type.slice(10))))];
  const customMeta = Object.fromEntries(customs.filter(c => ctx.customs[c]).map(c => [c, { tag: ctx.customs[c].tag, props: ctx.customs[c].props }]));
  // extension components the runtime has to import before it touches the page ({ Name: version })
  const exts = Object.fromEntries([...new Set([...walk(root)].flatMap(([n]) => (n.components ?? []).map(c => c.type).filter(isExtension)))]
    .map(n => [n, ctx.extensionVersions?.[n] ?? '']));
  const data = { tree, clips, pages: ctx.pages, behaviours, customs: customMeta, breakpoints: bps, repeats, editor: !!ctx.editor,
    ...(Object.keys(exts).length ? { extensions: exts } : {}),
    ...(ctx.prefix ? { prefix: ctx.prefix } : {}), ...(ctx.cleanUrls ? { cleanUrls: true } : {}), // runtime URLs match the page's
    ...(ctx.tokens?.textStyles ? { tokens: { textStyles: ctx.tokens.textStyles } } : {}), // Text re-styled at runtime
    ...(ctx.assetVersions ? { assetVersions: ctx.assetVersions } : {}) }; // the runtime builds the same asset URLs

  const parts = [tokenCss(ctx.tokens, ctx), ...faces, ...rules, ...media].filter(Boolean);
  const css = ctx.minify ? parts.map(p => p.trim()).join('\n') + '\n' : parts.join('\n\n') + '\n'; // raw Style rules are kept as written
  return { body, css, data, customs, behaviours, heads: [...heads] };
}

// Full HTML document. cssHref: external stylesheet (build) or null to inline (editor).
export function renderDocument(root, ctx, { name = 'index', cssHref = `${name}.css` } = {}) {
  const r = renderPage(root, ctx);
  const canvas = getComponent(root, 'Canvas')?.props ?? {};
  const pm = getComponent(root, 'PageMeta'), meta = pm ? propsOf(pm, ctx) : {};
  const title = canvas.title || name;
  const abs = u => { try { return meta.url ? new URL(u, meta.url).href : u; } catch { return u; } };
  const json = JSON.stringify(r.data).replace(/</g, '\\u003c');
  const nl = ctx.minify ? '' : '\n', ind = ctx.minify ? '' : '  ';
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(bind(title, ctx))}</title>`,
    canvas.description && `<meta name="description" content="${esc(bind(canvas.description, ctx))}">`,
    ctx.base && `<base href="${esc(ctx.base)}">`,
    meta.url && `<link rel="canonical" href="${esc(meta.url)}">`,
    meta.favicon && `<link rel="icon" href="${esc(ctx.asset(meta.favicon))}">`,
    pm && `<meta property="og:title" content="${esc(bind(title, ctx))}">`,
    pm && canvas.description && `<meta property="og:description" content="${esc(bind(canvas.description, ctx))}">`,
    meta.socialImage && `<meta property="og:image" content="${esc(abs(ctx.asset(meta.socialImage)))}">`,
    meta.url && `<meta property="og:url" content="${esc(meta.url)}">`,
    meta.noindex && '<meta name="robots" content="noindex">',
    `<link rel="stylesheet" href="${ctx.prefix}gpsb/base.css">`,
    cssHref ? `<link rel="stylesheet" href="${cssHref}">` : `<style>\n${r.css}</style>`,
    ...r.heads,              // extension components' head()
    ctx.inject?.head,        // project-wide custom code
    meta.head,               // this page's custom code
  ].filter(Boolean).map(l => ind + l).join(nl);
  const scripts = [
    `<script type="application/json" id="gpsb-data">${json}</script>`,
    `<script type="module" src="${ctx.prefix}gpsb/runtime.js"></script>`,
    ...r.customs.map(c => `<script type="module" src="${ctx.prefix}components/${encodeURIComponent(c)}.js"></script>`),
    !ctx.editor && ctx.inject?.bodyEnd,
  ].filter(Boolean).map(l => ind + l).join(nl);
  return { html: `<!doctype html>${nl}<html lang="${esc(meta.language || 'en')}">${nl}<head>${nl}${head}${nl}</head>${nl}<body>${nl}${r.body}${scripts}${nl}</body>${nl}</html>\n`, css: r.css };
}
