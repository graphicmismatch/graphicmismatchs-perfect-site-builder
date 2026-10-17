# graphicmismatch's perfect site builder (gpsb)

A visual static site generator that works like Unity's uGUI. You lay out pages in a Unity-style editor using
RectTransforms, anchors, pivots and layout groups, add components and keyframe animations, and it generates plain
HTML/CSS/JS.

Zero dependencies. You need Node ≥ 22.

```sh
node cli.js                        # Project Hub at http://127.0.0.1:4000 — create / open / add projects
node cli.js serve example          # same, with the demo project opened (editor at /editor/)
node cli.js build example          # -> example/dist (static, host anywhere)
node cli.js new my-site            # start a new project
```

After `npm link` (or a global install) the same commands are available as `gpsb`, e.g. `gpsb serve example`.

## Project Hub

The first screen lists your projects with their path, page and asset counts, and when you last opened each one.
- **New project:** start from the Empty or Showcase template, in a folder you pick with the built-in browser.
- **Add:** register a project folder that already exists.
- **Remove:** take a project off the list; its files stay on disk.

The list and your preferences are saved in `~/.config/gpsb/`, so they carry over between projects.
In the editor, use File ▸ Open Project Hub / Open Recent to switch projects.

## Configurable UI

- **Dock layout:** drag any panel tab to reorder it, move it to another area, or split an area.
  - Right-click a tab to Maximize it (Shift+Space), Close it, or Move it elsewhere.
  - The Window menu reopens panels you closed.
- **Layouts:** the toolbar dropdown offers Default, 2 by 3, 4 Split, Tall and Wide. You can also save and delete your own.
- **Preferences** (Ctrl+,):
  - Dark or light theme, accent colour and UI font size.
  - A shortcut editor: click a binding and press new keys. Conflicts are flagged.

## The editor

The layout follows Unity's default editor:

| Panel | What it does |
|---|---|
| Toolbar | File / Edit / WebObject / Component / Window menus, the Q W E R T tools, Play, page switcher, Build. |
| Hierarchy | The page tree. Drag nodes to reparent them. Sibling order is draw order. |
| Scene / Web | The real page rendered live. Rect / move / rotate / scale tools, an anchor gizmo, snapping, and resolution presets. Play runs scripts and animations in the Web view. |
| Inspector | RectTransform with anchor presets, plus every component's fields. Drag a label to scrub a number. Add Component. |
| Project | Drag images, video, audio, JSON or fonts in from your desktop. Drag them out onto the Scene, Hierarchy or Inspector. |
| Animation | Dopesheet and curves, record mode, sprite swap, events. |
| Console / Generated Code | Logs from the editor and the page, and the exact HTML/CSS the build will write. |

Shortcuts work as in Unity:
- Q W E R T switch tools (every shortcut can be rebound in Preferences).
- F frames the selection.
- Ctrl+D duplicates.
- Ctrl+Z / Ctrl+Shift+Z undo and redo.
- Ctrl+S saves.
- Ctrl+P plays.

## Concepts

- **Pages** are scenes. `pages/index.json` builds to `index.html` and `index.css`.
- **RectTransform** behaves like Unity: anchorMin/anchorMax, pivot, anchored position, size delta, rotation and scale.
  - The **Y axis points down**, as it does on the web.
  - Nodes inside a Horizontal, Vertical or Grid Layout Group are laid out with flexbox or CSS grid.
- **Canvas Scaler**:
  - `constant` uses 1 unit = 1 CSS px.
  - `scale-with-screen` uses a reference resolution and Unity's width/height match.
  - Set `Canvas.height` to make a long scrolling page.
- **Built-in components:**
  - UI: Image, Raw Image, Text, Button, Toggle, Toggle Group, Slider, Scrollbar, Input Field, Dropdown
    (the form controls are the browser's native ones; what the user types or picks is kept in the node's data and
    passed to their events)
  - Media: Video, Audio
  - Web: Link, IFrame, Form, Element (HTML tag, id, title, role, ARIA), Page Meta (language, favicon, link previews), HTML, Style (raw CSS)
  - Layout: Horizontal / Vertical / Grid Layout Group, Layout Element, Content Size Fitter, Aspect Ratio Fitter,
    Scroll Rect (scrollbars, snapping, smooth scrolling, hidden native bars), Mask (rect or sprite shape), Rect Mask 2D
  - The **Scroll View** preset is built like Unity's: Viewport > Content plus a Scrollbar that tracks and drives it.
  - Effects: Canvas Group, Shadow, Outline
  - Animation and data: Animator, Repeat
- **Breakpoints** cover responsive layout. Defaults are Tablet ≤1024 px and Phone ≤600 px; edit them in the Scene toolbar.
  - Pick a breakpoint and every change you make in the Scene or Inspector is stored as an override, much like a Unity prefab override.
  - Any property can be overridden: anchors, size, font size, layout spacing, text, or active (to hide a node).
  - Overridden fields get a blue bar. Right-click one to revert it to the base value.
  - Overrides build to `@media` rules and also apply at runtime, for example to elements that are animating.
- **Assets** live in `assets/` and are referenced by path.
  - JSON can be bound into any text field, for example `{{data/site.json:hero.title}}`.
  - A **Repeat** creates one copy of its children per item in a JSON array, with `{{item.name}}` and `{{index}}` available.
  - Scripts can load data with `await GPSB.assets.json('data/site.json')`.

## Custom components (HTML + CSS + JS)

`components/Card.html` turns into a native custom element. Its CSS is scoped with Shadow DOM. Its props appear in the Inspector.

```html
<template>
  <article><img src="{{image}}"><h2>{{title}}</h2><slot></slot></article>
</template>
<style> article { padding: 16px; border-radius: 12px; background: #fff; } </style>
<script type="application/json" props>
  { "title": { "type": "string", "default": "Hello" }, "image": { "type": "asset:image", "default": "" } }
</script>
<script>
  import { Component } from '../gpsb/component.js';
  export default class extends Component {
    rendered() { this.$('h2').onclick = () => this.emit('picked', this.props.title); }
  }
</script>
```

## Behaviours (MonoBehaviour-style scripts)

```js
// behaviours/Spin.js
export const props = { speed: { type: 'number', default: 90 } };
export default class Spin {
  update(dt) { this.node.rect.rotation += this.props.speed * dt; this.apply(); }
  faster() { this.props.speed *= 2; }   // callable from a Button's On Click ()
}
```

The hooks are `start()`, `update(dt)` and `onClick(e)`. Inside a behaviour you can use:
- `this.el` and `this.node`
- `this.props`
- `this.find('Path/To/Node')`
- `this.animator.play('Clip')`
- `this.setActive(false)`

## Animation

Clips (`animations/*.anim.json`) can animate **any property**:
- position, size, anchors, pivot, rotation, scale and active state
- every component field: colors, alpha, text, font size, layout spacing, custom component props, behaviour props
- sprites, by swapping `Image.sprite` with constant keys

Each key's easing can be linear, constant, ease-in/out, or a custom cubic-bezier that you edit in the Curves view. Clip events call behaviour methods or any other event action. An Animator can play its clip when the page starts, on hover, on click, when it scrolls into view, or only when called from a script.

Record mode works as in Unity. Press the red button, then move things in the Scene or change Inspector fields, and keys are written at the playhead.

## Design tokens

Project Settings ▸ Design Tokens holds named **colours**, **fonts** and **text styles**. Pick a colour or font token
with ◆ in any colour or font field, and a text style with Text ▸ Text Style. Tokens compile to CSS variables, so
changing one restyles every page. Renaming one updates everything that uses it.

## Publishing

File ▸ Project Settings sets how the site is built:
- **Site URL**, so `sitemap.xml` and `robots.txt` are written and sites under a sub-path (`https://example.com/docs/`) work.
- **Clean URLs**: `about/` instead of `about.html`.
- **Minify**: compact HTML and CSS.
- **Custom code**: for every page's `<head>` or the end of `<body>`.

A page named `404` becomes the host's not-found page. Files in `public/` are copied to the site root as they are
(`CNAME`, `_redirects`, `.well-known/`). Asset URLs carry a content hash, so hosts can cache them forever.
Images can be real `<img>` tags (Image ▸ Element) with alt text and lazy loading. Position animations run on the GPU.

## Extending

- **Extension components** (`extensions/<Name>.js`) are added like built-in components: they show up in Add Component,
  get Inspector fields from their props, can be animated, and work in the build, the editor and the published site.
  They're for anything dynamic: data loaded at runtime, embeds, third-party widgets. Project ▸ Create ▸ Extension
  Component starts one from a commented template.
- **Custom code:** `project.json` `inject.head` / `inject.bodyEnd` go on every page (analytics, consent, fonts), and
  Page Meta's `head` goes on one page.
- **Build hooks:** an optional `build.js` can rewrite each page (`transformPage`) or post-process the whole site
  (`afterBuild`, e.g. RSS or a search index).
- The generated markup keeps stable hooks (`data-gpsb` ids, `window.GPSB`, unbundled ES modules) for code you add
  later. See "Extending the output" in [CONTRACT.md](CONTRACT.md).

## Project layout

```
project.json            build.js (optional build hooks)
pages/*.json            animations/*.anim.json
assets/**               components/*.html       behaviours/*.js       extensions/*.js
```

See [CONTRACT.md](CONTRACT.md) for the full file formats, the property-path syntax and the internal architecture.

## Tests

```sh
node test/core.test.js     # RectTransform maths, property paths, bindings, Repeat
node test/anim.test.js     # easing, sampling, events
node test/e2e.js           # builds the example, checks it in headless Chrome, loads the editor
```

## License

MIT © graphicmismatch
