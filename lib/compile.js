// components/Name.html -> metadata + ES modules (used by the dev server and the build).
// File format:
//   <template> ... {{prop}} ... <slot></slot> </template>
//   <style> scoped (Shadow DOM) CSS </style>
//   <script type="application/json" props> { "title": { "type": "string", "default": "Hi" } } </script>
//   <script> import { Component } from '../gpsb/component.js'; export default class extends Component { ... } </script>
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
  };
}

// -> { 'Name.js': definer module, 'Name.script.js'?: author script verbatim }
export function compileComponent(name, src) {
  const c = parseComponent(name, src);
  const file = encodeURIComponent(name);
  const out = {};
  const lines = [`import { define } from '../gpsb/component.js';`];
  if (c.script) { lines.push(`import Cls from './${file}.script.js';`); out[`${name}.script.js`] = c.script + '\n'; }
  lines.push(`define(${JSON.stringify(c.tag)}, ${JSON.stringify({ template: c.template, style: c.style, props: c.props }, null, 2)}, ${c.script ? 'Cls' : 'undefined'});`);
  out[`${name}.js`] = lines.join('\n') + '\n';
  return out;
}
