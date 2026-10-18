// Markdown -> HTML (isomorphic, no dependencies). CommonMark-ish subset: ATX headings (with ids for #anchor links),
// paragraphs, hard breaks, emphasis/strong/strikethrough, inline code, fenced code, links, images, autolinks,
// ordered/unordered (nested) lists, blockquotes, horizontal rules and GitHub tables.
// opts: { href(h) -> url (page names, #anchors, URLs), asset(p) -> url (relative image paths), html: allow raw HTML }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
const slugify = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

const LIST = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const HEAD = /^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/;
const HTML_BLOCK = /^ {0,3}<(\/?(address|article|aside|blockquote|details|dialog|div|dl|figure|figcaption|footer|form|h[1-6]|header|hr|iframe|main|nav|ol|p|picture|pre|section|summary|table|ul|video|audio|script|style)\b|!--)/i;
const TABLE_SEP = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

export function markdown(src, opts = {}) {
  const o = { href: h => h, asset: p => p, html: false, ...opts };
  return blocks(String(src ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), o).join('\n');
}

function blocks(lines, o) {
  const out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = FENCE.exec(l))) { // fenced code
      const body = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(m[1]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code${m[2] ? ` class="language-${esc(m[2])}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
    } else if ((m = HEAD.exec(l))) {
      const h = inline(m[2] ?? '', o);
      out.push(`<h${m[1].length} id="${slugify(h)}">${h}</h${m[1].length}>`); i++;
    } else if (HR.test(l)) { out.push('<hr>'); i++; }
    else if (/^ {0,3}>/.test(l)) { // blockquote
      const body = [];
      for (; i < lines.length && lines[i].trim() && /^ {0,3}>/.test(lines[i]); i++) body.push(lines[i].replace(/^ {0,3}> ?/, ''));
      out.push(`<blockquote>\n${blocks(body, o).join('\n')}\n</blockquote>`);
    } else if (LIST.test(l) && !HR.test(l)) { const r = list(lines, i, o); out.push(r.html); i = r.next; }
    else if (l.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '') && lines[i + 1].includes('-')) { const r = table(lines, i, o); out.push(r.html); i = r.next; }
    else if (o.html && HTML_BLOCK.test(l)) { // raw HTML block (block-level tag), up to a blank line
      const body = [];
      for (; i < lines.length && lines[i].trim(); i++) body.push(lines[i]);
      out.push(body.join('\n'));
    } else { // paragraph: until a blank line or another block starts
      const body = [];
      for (; i < lines.length && lines[i].trim() && !(body.length && startsBlock(lines, i)); i++) body.push(lines[i]);
      out.push(`<p>${inline(body.join('\n'), o)}</p>`);
    }
  }
  return out;
}
const startsBlock = (lines, i) => FENCE.test(lines[i]) || HEAD.test(lines[i]) || HR.test(lines[i]) || /^ {0,3}>/.test(lines[i]) || LIST.test(lines[i]);

function list(lines, start, o) {
  const first = LIST.exec(lines[start]), indent = first[1].length, ordered = /\d/.test(first[2]);
  const items = [];
  let i = start, loose = false;
  while (i < lines.length) {
    const m = LIST.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const pad = indent + m[2].length + Math.max(1, Math.min(4, m[3].length)), body = [m[4]];
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) { // a blank line inside an item continues it only if more indented content follows
        const next = lines.slice(i + 1).find(x => x.trim());
        if (next == null || (next.search(/\S/) < pad && !(LIST.test(next) && LIST.exec(next)[1].length === indent))) break;
        if (LIST.test(next) && LIST.exec(next)[1].length === indent) { loose = true; break; }
        body.push(''); loose = true; continue;
      }
      const lm = LIST.exec(l);
      if (lm && lm[1].length <= indent) break;
      if (l.search(/\S/) < pad && !lm && !body.at(-1)?.trim()) break;
      body.push(l.slice(Math.min(pad, l.search(/\S/))));
    }
    items.push(body);
    while (i < lines.length && !lines[i].trim()) { const next = lines.slice(i).find(x => x.trim()); if (next && LIST.test(next) && LIST.exec(next)[1].length === indent) i++; else break; }
  }
  const tag = ordered ? 'ol' : 'ul', startNo = ordered && parseInt(first[2], 10) !== 1 ? ` start="${parseInt(first[2], 10)}"` : '';
  const li = items.map(b => {
    const inner = blocks(b, o);
    return `<li>${!loose && inner[0]?.startsWith('<p>') ? inner[0].slice(3, -4) + (inner.length > 1 ? '\n' + inner.slice(1).join('\n') : '') : inner.join('\n')}</li>`;
  });
  return { html: `<${tag}${startNo}>\n${li.join('\n')}\n</${tag}>`, next: i };
}

function table(lines, start, o) {
  const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  const head = cells(lines[start]), align = cells(lines[start + 1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
  const td = (tag, c, j) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ''}>${inline(c, o)}</${tag}>`;
  let i = start + 2;
  const rows = [];
  for (; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
  return {
    html: `<table>\n<thead><tr>${head.map((c, j) => td('th', c, j)).join('')}</tr></thead>\n<tbody>\n${rows.map(r => `<tr>${head.map((_, j) => td('td', r[j] ?? '', j)).join('')}</tr>`).join('\n')}\n</tbody>\n</table>`,
    next: i,
  };
}

const url = (u, o, img) => { u = u.trim().replace(/^<|>$/g, ''); if (/^(javascript|vbscript):/i.test(u)) return '#'; return img && !/^([a-z]+:|\/|#|\.\.?\/)/i.test(u) ? o.asset(u) : o.href(u); };

function inline(s, o) {
  const keep = []; // code spans and raw HTML are kept aside so later rules don't touch them
  const stash = html => `\u0000${keep.push(html) - 1}\u0000`;
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, t, c) => stash(`<code>${esc(c.replace(/^ (.*) $/, '$1'))}</code>`));
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_, c) => stash(esc(c)));
  s = s.replace(/<((?:https?|mailto):[^\s>]+)>/g, (_, u) => stash(`<a href="${esc(url(u, o))}">${esc(u)}</a>`));
  if (o.html) s = s.replace(/<\/?[a-zA-Z][^>]*>/g, t => stash(t));
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;(.*?)&quot;)?\s*\)/g, (_, alt, u, t) => stash(`<img src="${esc(url(unesc(u), o, true))}" alt="${alt}"${t ? ` title="${t}"` : ''}>`));
  s = s.replace(/\[([^\]]+)\]\(\s*([^\s)]+)(?:\s+&quot;(.*?)&quot;)?\s*\)/g, (_, txt, u, t) => `<a href="${esc(url(unesc(u), o))}"${t ? ` title="${t}"` : ''}>${txt}</a>`);
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(^|[^\w*])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^\w_])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/(?: {2,}|\\)\n/g, '<br>\n');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[n]);
}
const unesc = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
