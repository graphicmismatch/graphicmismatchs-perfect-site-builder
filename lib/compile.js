// components/Name.html -> metadata + ES modules (used by the dev server and the build).
// File format:
//   <template> ... {{prop}} ... <slot></slot> </template>
//   <style> scoped (Shadow DOM) CSS </style>
//   <script type="application/json" props> { "title": { "type": "string", "default": "Hi" } } </script>
//   <script> import { Component } from '../gpsb/component.js'; export default class extends Component { ... } </script>
//   (<script lang="ts"> for TypeScript)
// Also TypeScript -> JavaScript for behaviours, extensions and their helpers (compileTS). Node only, not shipped.
import * as nodeModule from 'node:module';
import { slug } from './render.js';

const grab = (src, re) => src.match(re)?.[1]?.trim() ?? '';

export function parseComponent(name, src) {
  let props = {};
  const json = grab(src, /<script[^>]*application\/json[^>]*>([\s\S]*?)<\/script>/i);
  if (json) props = JSON.parse(json);
  return {
    name, tag: 'gpsb-' + slug(name), props,
    template: grab(src, /<template[^>]*>([\s\S]*)<\/template>/i),
    style: grab(src, /<style[^>]*>([\s\S]*?)<\/style>/i),
    script: grab(src, /<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/i),
    ts: /<script(?![^>]*application\/json)[^>]*\blang=["']?ts\b/i.test(src),
  };
}

// -> { 'Name.js': definer module, 'Name.script.js'?: author script verbatim }
export function compileComponent(name, src) {
  const c = parseComponent(name, src);
  const file = encodeURIComponent(name);
  const out = {};
  const lines = [`import { define } from '../gpsb/component.js';`];
  if (c.script) { lines.push(`import Cls from './${file}.script.js';`); out[`${name}.script.js`] = (c.ts ? compileTS(c.script, `${name}.html`).code : c.script) + '\n'; }
  lines.push(`define(${JSON.stringify(c.tag)}, ${JSON.stringify({ template: c.template, style: c.style, props: c.props }, null, 2)}, ${c.script ? 'Cls' : 'undefined'});`);
  out[`${name}.js`] = lines.join('\n') + '\n';
  return out;
}

// ---------- TypeScript ----------
// Types are erased by Node's built-in TypeScript support (no type checking: that's the editor/IDE's job with the
// generated typings). Transform mode also handles enums, namespaces and parameter properties. Relative imports of
// .ts files are rewritten to .js, the published name. -> { code, map } (map: source map object, original embedded)
export const isTS = f => /\.ts$/.test(f) && !/\.d\.ts$/.test(f);
const MAP = '//# sourceMappingURL=data:application/json;base64,';
const TS_IMPORT = /(\b(?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"\n]*?)\.ts\2/g;
export function compileTS(src, file = 'script.ts') {
  if (!nodeModule.stripTypeScriptTypes) throw new Error(`TypeScript needs Node 22.15 or later (this is ${process.version})`);
  const name = file.split('/').pop();
  const out = quiet(() => nodeModule.stripTypeScriptTypes(src, { mode: 'transform', sourceMap: true, sourceUrl: name }));
  const i = out.lastIndexOf(MAP);
  const map = i >= 0 ? JSON.parse(Buffer.from(out.slice(i + MAP.length).trim(), 'base64').toString()) : null;
  if (map) map.sourcesContent = [src];
  const code = (i >= 0 ? out.slice(0, i) : out).trimEnd().replace(TS_IMPORT, (m, a, q, p) => `${a}${q}${p}.js${q}`) + '\n';
  return { code, map };
}
// JS with the source map inline (dev server, Node imports) or pointing at a .map file next to it (build)
export const withMap = ({ code, map }, file) => !map ? code
  : code + (file ? `//# sourceMappingURL=${file}\n` : MAP + Buffer.from(JSON.stringify(map)).toString('base64') + '\n');

// Node prints an ExperimentalWarning for these APIs on 22.x; gpsb uses them deliberately
export function quiet(fn) {
  const w = process.emitWarning;
  process.emitWarning = (m, ...a) => (/stripTypeScriptTypes|registerHooks|type stripping/i.test(String(m?.message ?? m)) ? undefined : w.call(process, m, ...a));
  try { return fn(); } finally { process.emitWarning = w; }
}
