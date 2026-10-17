// Page tree -> HTML + CSS. Isomorphic: the build, the editor preview and the runtime all use it.
import { rectStyle } from './rect.js';
import { componentDef, withDefaults, esc, isFontAsset } from './components.js';
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
//         assetVersions: {path: version} -> asset URLs get ?v=version (cache busting; served as immutable) }
export function makeCtx(opts = {}) {
  const pages = opts.pages ?? [];
  return {
    customs: {}, behaviours: {}, json: {}, clips: {}, ...opts, pages,
    asset: p => { const v = opts.assetVersions?.[p]; return 'assets/' + String(p).split('/').map(encodeURIComponent).join('/') + (v ? `?v=${v}` : ''); },
    font: p => 'gpsb-' + slug(p),
    href: h => (pages.includes(h) ? `${h}.html` : pages.includes(h.split('#')[0]) ? h.replace('#', '.html#') : h),
  };
}

const def = (c, ctx) => componentDef(c.type, ctx.customs, ctx.behaviours);
export const propsOf = (c, ctx, scope) => resolveDeep(withDefaults(def(c, ctx), c.props), ctx, scope);

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
const block = (sel, s) => `${sel} {\n${decl(s).map(l => '  ' + l).join('\n')}\n}`;
const attrStr = a => Object.entries(a).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');

// ---------- page ----------
export function renderPage(root, ctx) {
  const classes = new Map(), used = new Set(), rules = [], firstStyle = new Map();
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
      rules.push(block(sel, style));
      for (const c of node.components ?? []) {
        const r = def(c, ctx)?.rules?.(propsOf(c, ctx, scope), sel, ctx, node);
        if (r) rules.push(r);
      }
    } else if (firstStyle.get(node.id) !== css) attrs.style = css; // repeated clone with bound styles

    const tag = nodeTag(node, ctx, scope);
    const pad = '  '.repeat(depth);
    let inner = '';
    for (const c of node.components ?? []) {
      const d = def(c, ctx);
      if (d?.inner) inner += d.inner(propsOf(c, ctx, scope), ctx);
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
    if (!inner && !kids) return `${open}</${tag}>\n`;
    return `${open}${inner}${kids ? '\n' + kids + pad : ''}</${tag}>\n`;
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
      if (Object.keys(diff).length && classes.has(a.id)) out.push(block('.' + classes.get(a.id), diff)); // unrendered: empty Repeat
      a.children?.forEach((c, j) => visit(c, a, z.children[j], z));
    };
    visit(cur, null, prev, null);
    if (out.length) media.push(`@media (max-width: ${b.maxWidth}px) {\n${out.join('\n\n').replace(/^/gm, '  ')}\n}`);
    prev = cur;
  });

  // @font-face for every font asset referenced anywhere
  const fonts = new Set();
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
  const data = { tree, clips, pages: ctx.pages, behaviours, customs: customMeta, breakpoints: bps, repeats, editor: !!ctx.editor,
    ...(ctx.assetVersions ? { assetVersions: ctx.assetVersions } : {}) }; // the runtime builds the same asset URLs

  return { body, css: [...faces, ...rules, ...media].join('\n\n') + '\n', data, customs, behaviours };
}

// Full HTML document. cssHref: external stylesheet (build) or null to inline (editor).
export function renderDocument(root, ctx, { name = 'index', cssHref = `${name}.css` } = {}) {
  const r = renderPage(root, ctx);
  const canvas = getComponent(root, 'Canvas')?.props ?? {};
  const pm = getComponent(root, 'PageMeta'), meta = pm ? propsOf(pm, ctx) : {};
  const title = canvas.title || name;
  const abs = u => { try { return meta.url ? new URL(u, meta.url).href : u; } catch { return u; } };
  const json = JSON.stringify(r.data).replace(/</g, '\\u003c');
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
    '<link rel="stylesheet" href="gpsb/base.css">',
    cssHref ? `<link rel="stylesheet" href="${cssHref}">` : `<style>\n${r.css}</style>`,
  ].filter(Boolean).map(l => '  ' + l).join('\n');
  const scripts = [
    `<script type="application/json" id="gpsb-data">${json}</script>`,
    '<script type="module" src="gpsb/runtime.js"></script>',
    ...r.customs.map(c => `<script type="module" src="components/${encodeURIComponent(c)}.js"></script>`),
  ].map(l => '  ' + l).join('\n');
  return { html: `<!doctype html>\n<html lang="${esc(meta.language || 'en')}">\n<head>\n${head}\n</head>\n<body>\n${r.body}${scripts}\n</body>\n</html>\n`, css: r.css };
}
