# graphicmismatch's perfect site builder — internal contract

A Unity-uGUI-style visual editor that generates a static website. This file is the shared spec for
everyone working on the code. Read it fully before changing anything.

**Ground rules**
- **Zero dependencies.** Node ≥ 22 stdlib only. Browser code uses native ES modules, no bundler, no CDN.
- Match the surrounding style: 2-space indent, single quotes, semicolons, terse comments, small functions.
- **Y axis is top-down everywhere.** anchor/pivot y=0 is the top edge, +pos.y moves down. (Unity is Y-up; we deliberately differ.)
- `lib/` is isomorphic (Node + browser) and is copied 1:1 to `dist/psb/` and served at `/project/psb/` and `/lib/`.
  Relative imports between lib files only. No Node APIs in lib (except `compile.js`, which is not shipped).
- Shared files (`lib/rect.js node.js components.js render.js runtime.js compile.js`, `cli.js`, `editor/state.js`):
  small **surgical Edit-tool changes only** (no full rewrites), and list every such change in your final report.
- Verify in a real browser: `node test/browser.js <url> [--eval "expr"] [--shot f.png] [--wait ms]`
  prints console output + exceptions, exits 1 on errors. `node test/core.test.js` must keep passing.
  Run a dev server with `node cli.js serve <project> --port <unique port>`; build with `node cli.js build <project>`.
  Put throwaway projects/screenshots in `.tmp/` (git-ignored). Do not run git commands.

## Project on disk

```
project.json                 { "name": "..." }
pages/<name>.json            one node tree per page (= a Unity scene) -> dist/<name>.html + <name>.css
assets/**                    images, video, audio, json, fonts, text (copied to dist/assets/)
components/<Name>.html       custom components (template/style/props/script) -> dist/components/<Name>.js
behaviours/<Name>.js         MonoBehaviour-style scripts -> dist/behaviours/<Name>.js
animations/<Name>.anim.json  animation clips (inlined into pages that use them)
```

## Node

```json
{ "id": "a1b2c3", "name": "Hero Title", "active": true,
  "rect": { "anchorMin": [0.5,0.5], "anchorMax": [0.5,0.5], "pivot": [0.5,0.5],
            "pos": [0,0], "size": [100,100], "rotation": 0, "scale": [1,1] },
  "components": [ { "type": "Text", "props": { "text": "Hi" } } ],
  "children": [] }
```

- The page root is the Canvas node (components `Canvas`, `CanvasScaler`); its rect is ignored.
- `rect` is Unity's RectTransform: `pos` = anchoredPosition, `size` = sizeDelta. Per axis with parent size P:
  `start = anchorMin*P + pos - pivot*size`, `extent = (anchorMax-anchorMin)*P + size`.
  Stretched axis (anchorMin≠anchorMax): Unity's Left/Right = `offsetMin = pos - pivot*size`, `offsetMax = pos + (1-pivot)*size`
  (Right shown in the inspector is `-offsetMax.x`, Bottom is `-offsetMax.y`).
  Helpers: `lib/rect.js` → `rectStyle`, `rectPixels(rt, W, H)`, `reanchor(rt, W, H, {anchorMin, anchorMax, pivot})`.
- Children of a node with a layout group (anything whose def has `childStyle`) are `position: relative` and ignore pos
  (unless they have `LayoutElement.ignoreLayout`).
- Sibling order = DOM order = draw order (later on top).
- Component `type`: built-in name (`Image`), `component:<Name>` (components/Name.html), `behaviour:<Name>` (behaviours/Name.js).
  Multiple components per node; one of each built-in type, any number of behaviours.

## Prop types (component schemas)

`{ type, default, ...opts }`, optional `help` (tooltip), `labels` (vec field labels).

| type | value | inspector |
|---|---|---|
| `number` | number (opts `min`,`max`,`step`; min+max → slider) | drag-label number field |
| `int` | integer | same, rounded |
| `string` | string (opt `asset: 'font'` → also accepts a font asset) | text input |
| `text` | multiline string (HTML allowed) | textarea |
| `code` | string (`lang`: html/css/js) | monospace textarea |
| `bool` | boolean | checkbox |
| `color` | `#rrggbb` or `#rrggbbaa` | color swatch + alpha |
| `enum` | one of `options` | select |
| `vec2` / `vec4` | number[2] / number[4] | X Y (Z W) fields |
| `asset:image|video|audio|json|font|anim|any` | path relative to `assets/` (anim: clip name) | object field, drop target, picker |
| `href` | page name, URL, or `#anchor` | text + page dropdown |
| `node` | node id | object field, drop a hierarchy node |
| `event` | `[{ target: nodeId, call: string, arg: string }]` | Unity UnityEvent list |
| `list` | array of `of` type | reorderable list |

Strings may contain JSON bindings resolved at build time: `{{data/site.json:hero.title}}` (asset path `:` dot path,
`[n]` allowed). Inside a `Repeat`, `{{item.x}}`, `{{item}}`, `{{index}}`. Unresolved bindings are left as-is.

## Property paths (Inspector edits AND animation tracks)

`lib/node.js` `getProp(node, path)` / `setProp(node, path, value)`:
`name`, `active`, `rect.pos`, `rect.pos.x`, `rect.size.y`, `rect.anchorMin.x`, `rect.anchorMax.y`, `rect.pivot.x`,
`rect.rotation`, `rect.scale.x`, `<Type>.<prop>` (first component of that type, e.g. `Image.color`, `Image.sprite`,
`Text.text`, `CanvasGroup.alpha`), `component:Card.title`, `behaviour:Spin.speed`. Vector index: `.x .y .z .w` or `.0 .1`.

## Built-in components (`lib/components.js`)

Canvas, CanvasScaler, Image, Text, Button, Link, Video, Audio, HTML, Style, HorizontalLayoutGroup, VerticalLayoutGroup,
GridLayoutGroup, LayoutElement, ContentSizeFitter, ScrollRect, Mask, CanvasGroup, Shadow, Animator, Repeat.
Definition shape is documented at the top of that file. `componentDef(type, customs, behaviourMeta)` resolves any type;
`withDefaults(def, props)` fills defaults.

## Rendering (`lib/render.js`)

- `makeCtx({ pages, customs, behaviours, json, clips, editor, base })` → ctx with `asset(p)`, `font(p)`, `href(h)`.
- `renderPage(root, ctx)` → `{ body, css, data }`; `renderDocument(root, ctx, { name, cssHref })` → `{ html, css }`.
- Every element: `class="<slug-of-name>"` (unique per page) and `data-psb="<node id>"`. Root also has `psb-canvas`.
- Page data for the runtime: `<script type="application/json" id="psb-data">{ tree, clips, pages, behaviours, customs, editor }</script>`
  (tree has defaults filled and global bindings resolved; `clips` = clips used by Animators, or all clips in editor mode).
- `nodeStyle(node, parent, ctx)`, `nodeAttrs(node, ctx)`, `nodeTag`, `propsOf(component, ctx)`, `decl(styleObj)`.

## Page runtime (`lib/runtime.js`, `window.PSB`)

Boots the Canvas Scaler, then (unless `data.editor`) `animator.js#boot(PSB)` and `await behaviours.js#boot(PSB)`, then
dispatches `psb:ready` on window. API:

```
PSB.data, PSB.ctx, PSB.editor, PSB.scale, PSB.canvas
PSB.node(id) PSB.parent(id) PSB.el(id) PSB.els(id)       // els: all elements (Repeat clones share an id)
PSB.find('Header/Logo' | 'Logo', fromNode?) -> node
PSB.applyNode(node, parent?, els?)  // PURE: re-apply node data's style/attrs/patch to els (default: all elements
                                    // with that id). Never writes the tree. Runtime code mutates PSB.node(id) in
                                    // place then calls it; editor preview passes clones.
PSB.setActive(id, bool)
PSB.assets.url(p) .json(p) .text(p)
// added by animator.js:
PSB.animator(id) -> controller { play(clip?), stop(), pause(), resume(), seek(t), playing, time, clip, speed }
// added by behaviours.js:
PSB.invoke(targetId, call, arg, sourceId?)   // runs one event entry (see Events)
PSB.behaviour(id, Name) -> instance
```

## Custom components (`components/<Name>.html`) — owner: runtime/components agent

```html
<template>
  <div class="card"><img src="{{image}}"><h2>{{title}}</h2><slot></slot></div>
</template>
<style> .card { padding: 16px; } </style>
<script type="application/json" props>
  { "title": { "type": "string", "default": "Hello" }, "image": { "type": "asset:image", "default": "" } }
</script>
<script>
  import { Component } from '../psb/component.js';
  export default class extends Component {
    rendered() { this.$('h2').onclick = () => this.emit('picked', this.props.title); }
  }
</script>
```

- Compiled by `lib/compile.js` into `components/<Name>.js` (calls `define(tag, {template, style, props}, Cls)`)
  and `components/<Name>.script.js` (the author script verbatim). Tag = `psb-<slug(Name)>`.
- Rendered as `<psb-card class=… data-psb=… title="…" image="assets/…">children…</psb-card>`: props become
  kebab-case attributes (asset props are already resolved to URLs; non-strings JSON-encoded). Node children are light DOM → `<slot>`.
- `lib/component.js` exports `Component` (extends HTMLElement) and `define`. Component: open Shadow DOM, style injected,
  `:host { display: block }` default, `{{prop}}` interpolation in text and attribute values (HTML-escaped), re-render on
  attribute change, `this.props` typed from the schema, `this.root` (shadowRoot), `this.$(sel)`, `this.$$(sel)`,
  hooks `rendered()`, `connected()`, `disconnected()`, `propChanged(name, value)`, overridable `render()` returning an HTML
  string, `emit(name, detail)` (bubbling composed CustomEvent), `refresh()` (re-render now).

## Behaviours (`behaviours/<Name>.js`) — owner: runtime/components agent

```js
export const props = { speed: { type: 'number', default: 90 } };   // shown in the Inspector
export default class Spin {
  start() {}                // after all behaviours on the page are created
  update(dt) { this.node.rect.rotation += this.props.speed * dt; this.apply(); }
  onClick(e) {}
  spinFaster(arg) { this.props.speed *= 2; }   // any method is callable from events: behaviour:Spin.spinFaster
}
```

Injected before `start()`: `this.el`, `this.node` (runtime node data; a per-element clone for Repeat clones),
`this.props` (defaults merged), `this.PSB`, `this.find(path)` (node),
`this.apply()` is `PSB.applyNode(this.node, parent, this.el)` (own element only). `this.animator` (controller of the nearest Animator on self/ancestors or null), `this.setActive(bool)`.
One instance per element. `update` driven by one shared rAF loop, dt in seconds.
Modules are loaded from `behaviours/<Name>.js` relative to the page (`new URL('../behaviours/…', import.meta.url)` from psb/).

## Events (`event` prop type, e.g. `Button.onClick`; animation events use the same `call` syntax)

Entry `{ target: nodeId, call, arg }` (`target` empty = the node owning the event). `call` values:
`setActive` (arg `true|false|toggle`), `navigate` (arg page/URL, uses ctx.href), `Animator.play` (arg clip name or empty),
`Animator.stop`, `Animator.pause`, `Media.play`, `Media.pause`, `Media.toggle` (Video/Audio on target),
`behaviour:<Name>.<method>` (arg passed as string), `scrollTo` (target into view).
`target` may also be a node path (resolved relative to the source node, then from the root).
The editor lists callable entries per target from its components (+ behaviour `methods` from `S.behaviourMeta`).

## Animation — owner: animation agent

Clip `animations/<Name>.anim.json`:

```json
{ "name": "HeroIntro", "length": 2, "loop": true, "fps": 60,
  "tracks": [
    { "path": "",      "prop": "rect.pos.y",   "keys": [ { "t": 0, "v": -50, "ease": "ease-out" }, { "t": 0.6, "v": 0 } ] },
    { "path": "Logo",  "prop": "Image.sprite", "keys": [ { "t": 0, "v": "img/a.png" }, { "t": 0.5, "v": "img/b.png" } ] },
    { "path": "Title", "prop": "Image.color",  "keys": [ { "t": 0, "v": "#ffffff00" }, { "t": 1, "v": "#ffffffff" } ] }
  ],
  "events": [ { "t": 2, "call": "behaviour:Hero.onIntroDone", "arg": "" } ] }
```

- `path` is relative to the node carrying the Animator (Unity style, child names joined by `/`, `''` = self).
- `prop` is a property path (see above). Numbers/ints/vec components interpolate; colors interpolate in RGBA;
  strings, bools, enums, assets (sprite swap) step.
- `ease` on a key shapes the segment to the next key: `linear` (default) | `step` | `ease-in` | `ease-out` |
  `ease-in-out` | `[x1, y1, x2, y2]` (cubic-bezier, the Curves view edits these handles).
- `lib/anim.js` (isomorphic): `sampleClip(clip, t) -> [{ path, prop, value }]`, `evalTrack(track, t)`, `ease(e, u)`,
  `lerpValue(a, b, u)`, `applyClip(animatorNode, clip, t) -> Map<id, clonedNode>` (clones of affected nodes with sampled
  values set — **editor preview only**).
- Runtime animation (like Unity) overwrites values: write samples into `PSB.node(id)` in place with `setProp`, then
  `PSB.applyNode(node)`.
- `lib/animator.js#boot(PSB)`: one controller per Animator node; `playOn` start/hover/click/visible/manual; speed;
  loop or hold last frame; fires clip events through `PSB.invoke(animatorNodeId-relative target, call, arg)`;
  exposes `PSB.animator(id)`.
- Editor (`panels/animation.js`): Unity Animation window — clip dropdown + Create New Clip (saves to `animations/`,
  adds to the Animator's `clips`), Add Property, dopesheet (keys as diamonds, drag/box-select/delete/copy/paste),
  Curves view, timeline ruler with playhead scrub, preview play/pause/loop, **record mode** (red) via
  `S.hooks.setProp` (changes made in Inspector/Scene write keys at `S.anim.time` instead of base values),
  `S.hooks.animState` (inspector tints keyed fields red / animated fields blue), key inspector (value + ease), events row.
  Preview drives the Scene iframe through `S.previewWin.PSB.applyNode(clone, parentClone)`; re-apply after every
  `props`/`preview-ready` event (subscribers run in mount order; animation mounts after scene).

## Dev server (`cli.js serve`)

Binds 127.0.0.1 only. Every project path is resolved and rejected (403) if outside the project root.

```
GET  /                         editor/index.html          GET /editor/* /lib/*   tool files
GET  /project/psb/*            lib/*                      GET /project/components/<Name>.js|.script.js  compiled on the fly
GET  /project/*                project files              GET /api/project  -> { project, pages, components, behaviours, clips, json, assets[{path,type,size}] }
GET|PUT|DELETE /api/file?path= read / write (raw body, streamed) / delete a project file
POST /api/rename?from=&to=     POST /api/build -> { out, pages }
GET  /api/events               SSE { file } on external changes (editor hot-reloads components/behaviours/assets)
```
Requests with a Host other than `127.0.0.1:PORT`/`localhost:PORT` get 403; non-GET requests need header `x-psb: 1`
(`S.api` sends it).

## Editor (`editor/`)

Unity default layout: toolbar (top), Hierarchy (left), Scene/Game (center), Inspector (right, full height),
bottom tabs Project | Console | Animation | Generated Code. Each `editor/panels/<name>.js` exports `mount(el)` and owns
`panels/<name>.css` (already linked). Theme tokens are CSS variables in `editor/style.css` (`--panel`, `--accent`, …).
`main.js` mounts panels in order: toolbar, hierarchy, scene, inspector, project, console, animation, code; handles the
bottom tabs (`emit('show-tab', name)` switches) and splitters.

`editor/state.js` (import as `* as S from '../state.js'`; the store object is `S.S`):

```
S.S: { P, page, selection[], tool, resolution, playing, behaviourMeta, anim{clip,time,recording,playing,animatorId}, dirty, previewWin, hooks }
on(ev, fn) -> unsubscribe     emit(ev, ...args)     log(msg, level='info'|'warn'|'error', extra)
events: load structure props(ids) selection tool page anim assets log(entry) play resolution saved preview-ready show-tab frame
        rename (F2 -> hierarchy) asset-select(projectPath) asset-ping(assetPath) (inspector <-> project)
root() node(id) parentOf(id) parentSize(id) selected() active() def(type) propsOf(component) assetUrl(path)
edit(label, fn, { kind, ids, merge, files })   undo() redo()
setProp(id, path, value, opts)     // ALWAYS use this for property edits (record mode hooks in);
                                   // opts.label groups many setProps into one undo step (drags, presets)
select(ids, additive) setTool(t) PRESETS create(preset, parentId) addNode(node, parentId, index)
deleteNodes(ids) duplicate(ids) reparent(id, newParentId, index) addComponent(id, type) removeComponent(id, i) moveComponent(id, i, to)
setPage(name) newPage(name) previewHTML(editor) generatedCode() setPlaying(bool)
api.get/put/del/rename/build   save() build() upload(file, dir) load() reloadMeta()
```

- `structure` = the Scene rebuilds the iframe (`srcdoc = previewHTML()`); `props(ids)` = patch those nodes via
  `previewWin.PSB.applyNode(...)` immediately, plus a debounced (~300 ms) full rebuild to catch tag/inner/layout changes.
- Drag & drop between panels: `dataTransfer` types `application/x-psb-asset` (asset path, or clip name),
  `application/x-psb-node` (node id) and `application/x-psb-component` (`component:X` / `behaviour:X`, drop on Inspector). OS file drops anywhere in Project/Scene/Hierarchy import via `S.upload`.
- `parentSize(id)` → `[w, h]` untransformed CSS px of the node's parent (preview element, else `S.resolution`).
  Use it for `reanchor` (Inspector anchor presets) and Scene gizmos.
- **Keyboard: `main.js` (shell) owns ALL global shortcuts.** Others must not bind global keys. F emits `frame`
  (Scene listens). Panels may handle their own keys only while focus is inside them (local listener + stopPropagation),
  e.g. Animation window Delete on keys, Project F2 rename.
  Unity keys: Q W E R T tools, Ctrl+S save, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo/redo, Ctrl+D duplicate,
  Delete, F frame selection, Ctrl+P play, F2 rename. Ignore shortcuts while typing in inputs.

## Ownership

| area | files |
|---|---|
| lead | `lib/{rect,node,components,render,runtime,compile}.js`, `cli.js`, `editor/state.js`, this file |
| shell | `editor/index.html style.css main.js`, `panels/{toolbar,hierarchy,console,code}.*` |
| inspector | `panels/{inspector,project}.*` (+ new `editor/*.js` helpers you create) |
| scene | `panels/scene.*` |
| animation | `lib/anim.js`, `lib/animator.js`, `panels/animation.*` |
| runtime | `lib/component.js`, `lib/behaviours.js`, `example/**`, `test/e2e.js` |
