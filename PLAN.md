# Plan: make gpsb useful for professional work

Four areas, in this order. Each area lands as its own commits, with tests (`npm test`) and a check in a real browser.
The ground rules in `CONTRACT.md` still apply: no dependencies, small edits to shared files, and every new
format and API documented there.

Status legend: ☐ to do · ◐ in progress · ☑ done

**Constraint for everything below: the output stays extensible.** You should be able to add dynamic components
later (data fetched at runtime, embeds, third-party widgets, things that need their own scripts) without changing how
pages are built. Section 0 adds that foundation first. Every later item has to keep the output contract it defines
(for example, minifying never removes `data-gpsb` hooks or module structure, and clean URLs keep module paths
working).

---

## 0. Extensible output (foundation)

| | Item | Design |
|---|---|---|
| ☑ | **One component registry** | Built-ins and extensions use the same definition format (`category, props, tag, style, attrs, inner, rules, childStyle, patch, state, init`) and the same registry (`registerComponent(name, def)` in `lib/components.js`). The editor's Add Component menu, the inspector, the animation window, the build and the runtime all read the registry, so anything registered behaves like a built-in. |
| ☑ | **Extension components** | `extensions/<Name>.js` in a project: an ES module whose default export is a definition, or a factory `({ esc, cssUrl, control, near, findComp }) => definition` (no imports needed, so the same file runs in Node and the browser). Loaded by the build (Node), the dev server and editor (browser, hot-reloaded), and the published runtime (the page data lists the extensions a page uses; the runtime imports them from `extensions/` before applying anything). Copied to `dist/extensions/`. |
| ☑ | **Runtime hooks for dynamic components** | `init({ el, GPSB, ci })` (fetch data, start widgets, subscribe to events), `patch` (re-render on prop changes / animation), `state` (user-edited values), `head(p, ctx)` → extra `<head>` HTML (scripts, stylesheets, preconnects; deduplicated per page). `inner` renders the build-time HTML (placeholder or server-rendered content). |
| ☑ | **Custom code injection** | `project.json` `inject: { head, bodyEnd }` for every page, plus `PageMeta.head` per page (analytics, consent banners, verification tags). |
| ☑ | **Build hooks** | Optional `build.js` in the project (Node only, never shipped): `transformPage({ name, html, css })` → `{ html, css }`, and `afterBuild({ out, project, pages })` (RSS, search index, uploads). |
| ☑ | **Output contract** | Documented in `CONTRACT.md` and kept stable: every element has `data-gpsb="<id>"` and a stable class, page data in `#gpsb-data`, the `window.GPSB` API and the `gpsb:ready` event, unbundled ES modules (`gpsb/`, `components/`, `behaviours/`, `extensions/`), and asset URLs via `ctx.asset`. Minifying, clean URLs and versioned asset URLs all have to keep these. |

---

## 1. Production-ready output

Goal: a build you can deploy as-is to Netlify, GitHub Pages, S3 or any static host, with good SEO, accessibility and
performance by default.

| | Item | Design |
|---|---|---|
| ☑ | **Project settings** | `project.json` gains `siteUrl` (public base URL), `cleanUrls` (bool) and `minify` (bool). Edited in a new **File ▸ Project Settings…** dialog, which also holds the existing name and breakpoints. |
| ☑ | **sitemap.xml + robots.txt** | Written when `siteUrl` is set. The sitemap lists every page, with collection items expanded (see 3). Pages with `PageMeta.noindex` are left out and get `<meta name="robots" content="noindex">`. `robots.txt` points at the sitemap. |
| ☑ | **404 page** | A page named `404` builds to `/404.html`, which hosts serve for unknown URLs. It's served from any path, so it uses root-relative URLs (the `siteUrl` path, default `/`). It's left out of the sitemap. |
| ☑ | **Clean URLs** | With `cleanUrls`, `about` builds to `about/index.html` and links become `about/`. Every generated URL goes through one per-page prefix (`ctx.prefix`: `''`, `'../'`, …), used by `ctx.asset`, `ctx.href` and the runtime/CSS/script links, so nested output works everywhere. The runtime gets the prefix in its page data. |
| ☑ | **Real `<img>` for images** | `Image` gains `element: background \| img` (the default stays `background` so existing pages don't change; the Image preset uses `img`) and `loading: lazy \| eager`. `img` renders `<img alt loading decoding="async">` filling the rect, with object-fit from `fit`. That's better for SEO, accessibility and lazy loading. The node gets `isolation: isolate` and the img `z-index: -1`, so children, Button tint layers and Mask keep working. Sprite animation patches `src`. Button hover/pressed sprites show over it. |
| ☑ | **Minified output** | With `minify`, the build strips indentation from HTML and comments/whitespace from CSS (string-safe, conservative). JS ships as-is: there's no safe minifier without dependencies. |
| ☑ | **GPU position animation** | While an Animator plays, an animated `rect.pos` is drawn as `translate()` relative to the position at play start (`rect._layoutPos`), instead of moving `left/top` every frame. No relayout, no repaint, and smoother on slow devices. Node data still holds the real `rect.pos`, so scripts read correct values. |

Not planned: responsive `srcset` and image recompression need an image codec, which breaks the no-dependency rule.
The docs will say so.

## 2. Reusable design system

| | Item | Design |
|---|---|---|
| ☐ | **Design tokens** | `project.json` `tokens: { colors: {name: '#hex'}, fonts: {name: 'css family or font asset'}, textStyles: {name: {font, size, weight, lineHeight, letterSpacing}} }`. A colour prop can hold `$name`, and a font prop `$name`. The build emits `:root { --gpsb-color-name; --gpsb-font-name }` and references them with `var()`, so changing a token restyles the whole site, at runtime too. `Text.textStyle` applies a named text style. The inspector's colour and font fields get a token picker. Tokens are edited in Project Settings. |
| ☐ | **Prefabs** | `prefabs/<Name>.prefab.json` holds a node subtree. In a page, an instance is stored as `{ id, name, active, rect, prefab: 'Name', prefabOverrides: { '<prefab node id>\|<property path>': value } }`. `lib/prefab.js` `expandPrefabs(tree, prefabs)` materialises instances, with child ids `<instance id>-<prefab node id>` so they're stable and unique. `collapsePrefabs` turns them back into refs when saving. The build, the dev server and the editor all expand. In the editor: **Create Prefab** from a selection, **Open Prefab** (edit it in isolation, inside a temporary canvas; saving updates every instance), and per instance **Apply overrides / Revert / Unpack**. Edits inside an instance become overrides, as breakpoint overrides do today, and show the same marker. Structural edits inside an instance (add/remove children) require Unpack or Open Prefab, as in Unity's model. Nested prefabs are allowed; cycles are refused. |

## 3. Content-friendly layout

| | Item | Design |
|---|---|---|
| ☐ | **Flowing sections** | Pages can flow: a layout group on the Canvas stacks top-level sections, and the page grows with its content. Presets: **Section** (full width, auto height, vertical layout with padding), **Text Block** (wraps, auto height) and **Content Column** (centred, readable max width). `LayoutElement` gains `maxWidth`/`maxHeight`. **File ▸ New Page ▸ Flowing page** starts from that structure. |
| ☐ | **Markdown** | A `Markdown` component renders Markdown (a `text` prop or a `.md` asset) to semantic HTML at build time: headings, paragraphs, emphasis, links, images, lists, blockquote, code and tables. It uses a small parser in `lib/markdown.js` and no dependencies. Content styling stays the author's, through `Style`. |
| ☐ | **Collection pages** | A page can be a template: `Canvas.collection = { source, path, slug }` (a JSON asset, a dot path to an array, and the field used as each item's URL). The build emits one page per item (`post/<slug>.html`, or `post/<slug>/` with clean URLs), with `{{item.*}}` bound everywhere, and the sitemap includes them. Link hrefs like `post/{{item.slug}}` resolve. The editor previews the first item, and a dropdown picks another. |

## 4. Editor productivity

| | Item | Design |
|---|---|---|
| ☐ | **Autosave + crash recovery** | A preference: autosave off / after N seconds idle. Independently, unsaved state is mirrored to IndexedDB every few seconds, per project. On load, if it's newer than what's on disk, a banner offers **Restore** or **Discard**. |
| ☐ | **Align & distribute** | For multi-selection (toolbar + WebObject menu): align left/centre/right/top/middle/bottom and distribute horizontally/vertically, computed in each node's parent space. Nodes driven by a layout group are skipped. |
| ☐ | **Smart guides & snapping** | Dragging in the Scene snaps edges and centres to siblings and the parent (threshold in screen px) and draws guides. Alt disables it. On by default, with a toggle in the Scene toolbar. |
| ☐ | **Keyboard nudging** | Arrow keys move the selection by 1 px, Shift+arrow by 10 px (snap increment while snapping). Recorded as one undo step per burst. |
| ☐ | **Copy/paste across pages and projects** | Copying also writes the nodes (with their referenced clips' names) to the system clipboard as JSON. Pasting accepts it in any page or project tab. |
| ☐ | **Find & replace** | Searches text and string props on every page (or only this one), lists the matches, jumps to a node, and replaces with one undo step. |
| ☐ | **Undo history panel** | Undo steps keep their labels. A History panel lists them, and clicking one jumps there. |

---

## Order of work

0. Extensible output foundation (every later item builds on it).
1. Production output (project settings dialog first, since 2 and 3 use it).
2. Design tokens, then prefabs.
3. Flowing presets, then Markdown, then collections (these build on clean URLs and the sitemap).
4. Editor productivity items, smallest first.

Each finished item gets ☑ here and an entry in `CONTRACT.md` (formats/APIs) and `README.md` (user-facing).
