# graphicmismatch's perfect site builder — internal contract

A Unity-uGUI-style visual editor that generates a static website. This file is the shared spec for
everyone working on the code. Read it fully before changing anything.

**Ground rules**
- **Zero dependencies.** Node ≥ 22 stdlib only. Browser code uses native ES modules, no bundler, no CDN.
- Match the surrounding style: 2-space indent, single quotes, semicolons, terse comments, small functions.
- **Y axis is top-down everywhere.** anchor/pivot y=0 is the top edge, +pos.y moves down. (Unity is Y-up; we deliberately differ.)
- `lib/` is isomorphic (Node + browser) and is copied 1:1 to `dist/gpsb/` and served at `/project/gpsb/` and `/lib/`.
  Node-only tool code lives next to `cli.js` (`pm.js`, the package manager).
  Relative imports between lib files only. No Node APIs in lib (except `compile.js`, which is not shipped).
  `lib/*.d.ts` (typings for project scripts) aren't shipped either; `gpsb types` copies them into projects.
- Shared files (`lib/rect.js node.js components.js render.js runtime.js compile.js`, `cli.js`, `editor/state.js`):
  small **surgical Edit-tool changes only** (no full rewrites), and list every such change in your final report.
- Verify in a real browser: `node test/browser.js <url> [--eval "expr"] [--shot f.png] [--wait ms]`
  prints console output + exceptions, exits 1 on errors. `node test/core.test.js` must keep passing.
  Run a dev server with `node cli.js serve <project> --port <unique port>`; build with `node cli.js build <project>`.
  Put throwaway projects/screenshots in `.tmp/` (git-ignored). Do not run git commands.

## Project on disk

```
project.json                 { "name": "...", "breakpoints": [{ "name": "Tablet", "maxWidth": 1024 }, ...],
                               "inject": { "head": "<html>", "bodyEnd": "<html>" },
                               "siteUrl": "https://example.com/", "cleanUrls": false, "minify": false, "keep": [".git/"],
                               "tokens": { "colors": { "brand": "#ff3366" }, "fonts": { "heading": "fonts/H.ttf" },
                                           "textStyles": { "h1": { "font": "$heading", "size": 48, "weight": "800",
                                                                   "lineHeight": 1.1, "letterSpacing": 0 } } } }
pages/<name>.json            one node tree per page (= a Unity scene) -> dist/<name>.html + <name>.css; <name> may hold
                             folders (pages/a/b.json -> a/b.html, prefix '../')
assets/**                    images, video, audio, json, fonts, text (copied to dist/assets/)
components/<Name>.html       custom components (template/style/props/script) -> dist/components/<Name>.js
behaviours/<Name>.js|.ts     MonoBehaviour-style scripts -> dist/behaviours/<Name>.js (.ts compiled, + .js.map)
extensions/<Name>.js|.ts     extension components (same format as built-ins) -> dist/extensions/ (subfolders: helpers)
tsconfig.json, .gpsb/        TypeScript: tsconfig.json extends .gpsb/tsconfig.json; generated typings in .gpsb/types/
packages/manifest.json       npm packages (pm.js): dependencies (+ registry, scopedRegistries); packages-lock.json;
packages/<name>/             installed packages -> dist/packages/<name>/ (runtime packages only, no *.d.ts)
animations/<Name>.anim.json  animation clips (inlined into pages that use them)
prefabs/<Name>.prefab.json   prefab node trees (expanded into pages at build time; not shipped)
build.js                     optional build hooks (Node only, not shipped)
public/**                    copied to the site root as-is, after everything else (CNAME, _redirects, .well-known/…);
                             the dev server serves it at /project/ too (a project file of the same path wins)
```

Build output (`cli.js build`): `<page>.html` + `<page>.css` (or `<page>/index.html` + `<page>/<page>.css` with
`cleanUrls`; `index` always at the root). Every site-relative URL a page uses goes through `ctx.prefix` (`''`, `'../'`,
or for the `404` page the site URL's path, default `/`, because hosts serve it for any missing path); the prefix and
`cleanUrls` are passed to the runtime in the page data. `robots.txt` always; `sitemap.xml` when `siteUrl` is set
(every page except `404` and `PageMeta.noindex` pages). `minify` drops the renderer's indentation and compacts the
generated CSS; text content, raw HTML/Style code and JS modules are never rewritten. `pageUrl(name, clean)` in
`lib/render.js` gives a page's URL relative to the site root.

## Node

```json
{ "id": "a1b2c3", "name": "Hero Title", "active": true,
  "rect": { "anchorMin": [0.5,0.5], "anchorMax": [0.5,0.5], "pivot": [0.5,0.5],
            "pos": [0,0], "size": [100,100], "rotation": 0, "scale": [1,1], "zIndex": 0 },
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
- `rect._layoutPos` (runtime only, set by the animator while `rect.pos` animates): laid out there, moved to `rect.pos` with
  `translate()` (no relayout per frame); removed on `stop()`. Never saved.
- Sibling order = DOM order = draw order (later on top). `rect.zIndex` (int, default 0, optional in old files) overrides it:
  non-zero → CSS `z-index` (higher on top; negative goes behind siblings at 0). Animatable (stepped) and overridable per breakpoint.
- `overrides` (optional): `{ "<breakpoint>": { "<property path>": value } }` — responsive overrides, see below.
- Component `type`: built-in name (`Image`), `component:<Name>` (components/Name.html), `behaviour:<Name>` (behaviours/Name.js).
  Multiple components per node; one of each built-in type, any number of behaviours.

## Content pages

- Flowing layout: a layout group on the Canvas stacks top-level sections (children are `position: relative`) and the
  page grows with its content. Presets `Section`, `Content Column`, `Text Block`, `Markdown`; File ▸ New Flowing
  Page (`newPage(name, 'flow')`). `LayoutElement.maxWidth` in a vertical layout: `width: 100%` + auto side margins.
- `Markdown` (`lib/markdown.js` `markdown(src, { href, asset, html })`): `text` or a `.md`/`.txt` asset (`src`;
  `ctx.text` holds text assets ≤ 512 KB from `loadProject`); links go through `ctx.href`, relative images through
  `ctx.asset`, headings get slug ids, raw HTML is escaped unless `html`.
- Collection pages: `Canvas.collection` (JSON asset), `collectionPath`, `slugField`. `collectionItems(root, ctx)` →
  `[{ slug, item, index }]` (slugified, made unique). The build writes `<page>/<slug>.html` (or
  `<page>/<slug>/index.html` with clean URLs) for each item instead of the template, rendered with scope
  `{ item, index }` (`renderDocument(root, ctx, { scope })`), and lists them in the sitemap. `ctx.collections` (template
  names) makes `href('post/<slug>')` resolve; the runtime gets it in the page data. A `Repeat` without `source` reads
  `path` from the current scope (`item.tags`). The dev server renders `/project/<page>/<slug>.html`; the editor previews
  `S.S.collectionItem` (Scene toolbar dropdown; `pageItems()`, `setCollectionItem(i)`).
- Collections (`lib/content.js`, isomorphic): `findCollections(json)` → `[{ file, path, items, schema }]` (a schema's
  `path`; else a file that is an array of objects, or each top-level key holding one). Schema = sibling
  `<file>.schema.json` `{ path, fields: { name: { type, label, help, options, required } }, title, summary, date, sort,
  draft, publishAt }`; `fieldsOf` = schema fields then inferred ones (`inferType`). `statusOf(item)` draft
  (`draft === true`) | scheduled (`publishAt` in the future) | published. The build replaces `P.json` with
  `publishedJSON(P.json)` (those items removed from every array, any depth) before rendering; the dev server and editor
  keep them. `groupItems(items, field)` → `[{ name, slug, count, items }]` (slug = `slugify`, alphabetical);
  `sortItems(items, 'a,-b')` (empty last); `rssFeed`, `feedFields`.
- `Canvas.sortBy` / `groupBy` (one page per group, scope item = the group; output `<page>/<group slug>.html`) / `feed`
  (`<page>/feed.xml`, newest 50, needs `siteUrl`; `ctx.feeds` → `<link rel="alternate">` on every page) / `feedTitle`.
  `Repeat.sortBy` / `groupBy` / `pageSize`: `repeatItems(p, ctx, scope)` (render.js; also the runtime's nested Repeats)
  = source → sort → group → limit → page slice (`scope.pagination.page`). `pageCount(root, ctx, scope)`: the first
  Repeat with a pageSize (not inside another Repeat). cli.js `outputsOf(P, ctx, clean, site)` lists every output (pages,
  items/groups, then `<url-dir>/<n>.html` or `<url-dir>/<n>/` pages, `page/<n>` for the home page) with
  `scope.pagination = { page, pages, urls, prev, next }` (URLs relative to that output, '' = none); the build writes them
  and the dev server renders the one requested (and `<page>/feed.xml`). `Pagination` component renders from
  `scope.pagination` (`inner(p, ctx, node, scope)`; a sample in the editor).
- Binding filters: `{{path | f | g: arg}}` (`FILTERS` in render.js: slug, lower, upper, length, join, first, last,
  default, date); an unknown filter or unresolved value leaves the binding as written. `date` uses `ctx.lang`
  (renderDocument: PageMeta.language; passed to the runtime as `data.lang`) in UTC.
- Editor Content window (`panels/content.js`, Window ▸ Content): `S.editContent(file, label, fn, { merge })` mutates
  `S.P.json[file]` as one undo step (touched JSON files join undo snapshots), marks `assets/<file>` dirty (saved by
  `save()`), emits `content` (`'undo'` from undo/redo). `reloadMeta` keeps unsaved JSON edits.

## Languages (`lib/i18n.js`)

- `project.json languages: [{ code, name }]`, first = default (site root); each other language's outputs are the same
  under `<code>/` (cli.js `outputsOf`: `extra` = `languageOptions(project, json, code)` + `langDir` + `alternates`;
  no 404 per language; feeds default only). `languageOptions` → `{ lang, langKey: 'lang:<code>' | null, json (with
  `<name>.<code>.json` replacing `<name>.json`; translation files dropped), strings (`assets/locales/<default>.json`
  deep-merged with `<code>.json`), languages }`.
- Node overrides under `lang:<code>` (same storage as breakpoint overrides; prefab instance overrides `@lang:<code>`).
  `renderPage` applies `ctx.langKey` first (`effectiveTree`), then breakpoints as usual; `renderDocument` reads the
  root's title/PageMeta with it, writes `<html lang=ctx.lang>` and `hreflang` links from `ctx.alternates` (`abs`, needs
  siteUrl). Page links: `makeCtx` prefixes them with `prefix + langDir` (assets with `prefix`). Page data carries
  `langKey`, `langDir`, `lang`; the runtime's `effective` applies `langKey` before active breakpoints.
- Bindings `{{t:key.path}}` read `ctx.strings`. `LanguageSwitcher` (widgets.js) renders `ctx.alternates` (`current`
  marked; the editor: `ctx.languages` with `#` links). Content: `schemaOf` of `<name>.<code>.json` falls back to the
  original's schema.
- Editor: the language being edited is `S.breakpoint = 'lang:<code>'` (`setBreakpoint` accepts it; `editNames()` →
  `[key]`, so `view`/`setProp`/overrides UI work unchanged); `previewHTML` renders with that language's options.
  `S.languages()`, `editLanguage()`, `setLanguages(list with from)` (renames move overrides),
  `makeDefaultLanguage(code)` (swaps base values with that language's overrides in every page and prefab; not
  undoable). Scene toolbar `.sc-lang`; Project Settings ▸ Languages; Content ⋯ ▸ Translate into ….

## Sections, themes, templates (`lib/sections.js`; editor + project creation, not copied into builds)

- `THEMES` { id: { name, desc, tokens: { colors, fonts, textStyles } } }: colours primary, onPrimary, background, surface,
  text, muted, border; fonts heading, body; text styles h1, h2, h3, lead, body, small, eyebrow, button.
  `applyTheme(tokens, id, onlyMissing)` merges (returns a copy); `missingTokens(tokens)`.
- `SECTIONS` [{ id, name, category, desc, make(o) → node }]: full-width subtrees for flowing pages (Element section +
  Image `$background` + VerticalLayoutGroup + ContentSizeFitter; content in a 1120px `Container`), built only from
  built-in components and those tokens; rows wrap (`HorizontalLayoutGroup.wrap`, children `LayoutElement` flexible +
  min width); `Phone` breakpoint overrides shrink padding, h1 → h2 and tall pictures. `o`: site, nav, images, texts.
- Editor: WebObject ▸ UI ▸ Section… (`editor/sectionpicker.js`: previews rendered with `renderPage` in the project's
  tokens) → `S.insertSection(id)`: after the selected top-level section (else at the end), adding missing tokens from
  Clean. Project Settings ▸ Design Tokens ▸ Theme applies `applyTheme`.
- `TEMPLATES` { landing, business, portfolio, blog: { name, desc, theme } } and `templateFiles(id, name, theme)` →
  { path: text } (project.json with the theme's tokens, flowing pages, collections + schemas, placeholder SVGs in
  assets/img). `cli.js create(root, template, theme)`; `gpsb new <dir> --template T --theme T`; the Hub's New project.

## Prefabs (`lib/prefab.js`)

`prefabs/<Name>.prefab.json` is a node subtree. A page (or another prefab) stores an instance as a reference:
`{ id, name, active, rect, prefab: 'Name', prefabOverrides?: { '<key>|<path>': value }, overrides? }`; name, active, rect
and the root's breakpoint `overrides` belong to the instance. `expandPrefabs(tree, prefabs)` materialises instances in
place (build, dev server, editor): components and children come from the prefab, descendants get the deterministic id
`<instance id>-<prefab node id>` (nested: `<outer>-<inner>-<x>`), references between the prefab's own nodes are
remapped, then overrides are applied. Override key = id suffix ('' = the instance root) + `|` + path, or
`<suffix>|@<breakpoint>|<path>` for a breakpoint override. Marks (never saved or shipped): `_inst` (outermost instance id
on every descendant), `_pf` (prefab name on instance roots), `_missing` (`missing` | `cycle`). `collapsePrefabs` gives
the stored form; `bakeInstance` (Apply), `unpackInstance`, `stripMarks` (page data), `overrideKey`, `OWN`.
Editor (`state.js`): `instanceRoot(id)`, `isPrefabOverridden`, `structureLocked(id, own?)` (children/components of an
instance can't change: open the prefab or unpack), `createPrefab`, `instantiate`, `openPrefab` / `closePrefab`
(`S.S.prefabEdit = { name, tree }`; `root()` is then a stage canvas holding the prefab, edits go to
`prefabs/<Name>.prefab.json`, closing refreshes every instance), `applyInstance`, `revertInstance`,
`revertPrefabOverride`, `unpack`, `renamePrefab`, `deletePrefab`, `prefabUses`, `refreshInstances`. `setProp` inside an
instance records an override. `cloneTree` keeps the id shape of prefab content. Pages are expanded on load and
collapsed on save.

## Design tokens

`project.json` `tokens` (names `[\w-]+`). A `color` prop holding `"$name"` renders as `var(--gpsb-color-name)`; a font
prop (`string` with `asset: 'font'`, e.g. `Text.font`, `Canvas.font`) holding `"$name"` renders as
`var(--gpsb-font-name)` (`fontFamily()`); the page CSS starts with `:root { --gpsb-color-*; --gpsb-font-* }`
(font-asset tokens get `@font-face`). `Text.textStyle` names a text style whose non-empty fields (`font`, `size`,
`weight`, `italic`, `lineHeight`, `letterSpacing`) replace the Text's own. Values are resolved in `propsOf`, so
overrides and animation keys can hold tokens too (colour tokens animate as steps). The runtime gets
`tokens.textStyles` in the page data. A prop schema `tokens: 'textStyles'` makes the Inspector show a picker.
Editor: Project Settings ▸ Design Tokens; `files.js` `renameToken(kind, from, to)`, `tokenUses(kind, name)`.

## Prop types (component schemas)

`{ type, default, ...opts }`, optional `help` (tooltip), `labels` (vec field labels), `hidden` (kept in the data, not
shown in the Inspector: editor bookkeeping such as `Image.crop`).

| type | value | inspector |
|---|---|---|
| `number` | number (opts `min`,`max`,`step`; min+max → slider) | drag-label number field |
| `int` | integer | same, rounded |
| `string` | string (opt `asset: 'font'` → a CSS font-family list whose entries may be font assets, each gets `@font-face`; opt `icon` → a built-in icon name) | text input (+ font / icon picker) |
| `text` | multiline string (HTML allowed; opt `rich` → formatted editor + Source view, e.g. `Text.text`) | textarea / rich editor |
| `code` | string (`lang`: html/css/js) | monospace textarea |
| `bool` | boolean | checkbox |
| `color` | `#rrggbb` or `#rrggbbaa` | color swatch + alpha |
| `enum` | one of `options` | select |
| `vec2` / `vec4` | number[2] / number[4] | X Y (Z W) fields |
| `asset:image|video|audio|json|font|anim|any` | path relative to `assets/` (anim: clip name) | object field, drop target, picker |
| `href` | page name, URL, or `#anchor` | text + page dropdown |
| `node` | node id | object field, drop a hierarchy node |
| `event` | `[{ target: nodeId, call: string, arg: string }]` (opt `on`: DOM event, default `click`; on a form control an empty `arg` passes its value) | Unity UnityEvent list |
| `list` | array of `of` type | reorderable list |

Strings may contain JSON bindings resolved at build time: `{{data/site.json:hero.title}}` (asset path `:` dot path,
`[n]` allowed). Inside a `Repeat`, `{{item.x}}`, `{{item}}`, `{{index}}`. Unresolved bindings are left as-is.

## Property paths (Inspector edits AND animation tracks)

`lib/node.js` `getProp(node, path)` / `setProp(node, path, value)`:
`name`, `active`, `rect.pos`, `rect.pos.x`, `rect.size.y`, `rect.anchorMin.x`, `rect.anchorMax.y`, `rect.pivot.x`,
`rect.rotation`, `rect.scale.x`, `rect.zIndex`, `<Type>.<prop>` (first component of that type; `<Type>[n].<prop>` = n-th, 0-based,
`componentPath(node, i)` builds it, e.g. `Image.color`, `Image.sprite`,
`Text.text`, `CanvasGroup.alpha`), `component:Card.title`, `behaviour:Spin.speed`. Vector index: `.x .y .z .w` or `.0 .1`.

## Responsive breakpoints

`project.json` `breakpoints` (default `DEFAULT_BREAKPOINTS`: Tablet ≤1024, Phone ≤600 px viewport width). Any property
path can be overridden per breakpoint on a node (`node.overrides`). Overrides cascade widest → narrowest: at 500 px both
Tablet and Phone apply, Phone last. `lib/node.js`: `sortBreakpoints`, `activeBreakpoints(bps, width)`,
`withOverrides(node, names)`, `effectiveTree(root, names)`, `setOverride` (merges `rect.pos.x` into an existing
`rect.pos`), `clearOverride`, `isOverridden`.
- Build: `@media (max-width: Npx)` blocks containing only the declarations that differ from the next-wider level.
- Runtime: `applyNode` always renders `GPSB.effective(node)`; on a breakpoint change, overridden nodes and every element the
  runtime styled inline are re-applied (so text/attribute overrides work too). Animation writes base values; an override of
  the same property wins.
- Editor: `S.S.breakpoint` = breakpoint being edited (null = base). While set, `S.setProp` stores overrides (record mode
  still takes precedence). Read displayed values from `S.view(id)`; `S.isOverridden(id, path)`, `S.revertOverride(id, path?)`,
  `S.breakpoints()`, `S.setBreakpoint(name|null)`, `S.setBreakpoints(list)` (entries may carry `from` to rename), event `breakpoint`.

## Built-in components (`lib/components.js`)

Canvas, CanvasScaler, PageMeta, Image, RawImage, Text, Button, Toggle, ToggleGroup, Slider, Scrollbar, InputField, Dropdown,
Link, Video, Audio, IFrame, Form, Element, HTML, Style, HorizontalLayoutGroup, VerticalLayoutGroup, GridLayoutGroup,
LayoutElement, ContentSizeFitter, AspectRatioFitter, ScrollRect, Mask, RectMask2D, CanvasGroup, Shadow, Outline, Animator, Repeat,
Captcha, Pagination; widgets (`lib/widgets.js`, a factory merged into `builtins`): Icon, Divider, Marquee, Countdown, NavigationMenu,
SocialLinks, Carousel, Tabs, Accordion, Modal, Gallery, VideoEmbed, Map.
- Scroll views follow Unity: `Scroll View > Viewport (ScrollRect, native scrolling; its first child is the content) >
  Content`, with Scrollbars outside the viewport (`ScrollRect.horizontalScrollbar/verticalScrollbar` = node ids). A
  Scrollbar positions its `handle` node inside the handle's parent via `--gpsb-bar-start/size`; the runtime keeps
  scroll position and scrollbars in sync both ways. Scrollbar value 1 = top for `bottomToTop` (Unity's default).
- `Toggle.group` = a node with `ToggleGroup`: the toggles render as radios sharing a name (`allowSwitchOff` handled at runtime).
- `Mask` clips to the rect, or to the node's Image sprite shape when it has one; `RectMask2D` = `clip-path: inset(padding)`.
- `Form` makes the node a `<form>`; Button `type` submit/reset, control `name`s. `provider` url (action/method) |
  formspree | basin | getform (formId) | netlify (form name; `data-netlify`, `form-name` input) | mailto; `send` fetch (stay
  on the page) | page (classic, url only). `submitForm` (runtime): validate (constraint validation + each field's
  `errorMessage`; invalid fields get `aria-invalid` and class `gpsb-invalid`) → `gpsb:invalid` {fields} | honeypot
  (`.gpsb-hp`, named per service) filled → fake success | `gpsb:submit` (cancelable; detail {data, form, provider,
  handle(fn)}) → send (or `handle`'s fn) → `gpsb:success` {data, response, status} | `gpsb:error` {data, error, status,
  response}. Events bubble; event props `onSubmit/onSuccess/onError/onInvalid` listen to them. `data-state` on the form
  (sending/success/error/invalid), `message` node (Text) shows the state's message. After a reset the controls' values
  are written back into their node data. `Captcha` (Turnstile / hCaptcha widget + head script) inside a form must be
  solved before sending.
- Component calls: `def.methods = { name(el, arg, GPSB, ci) }` → `GPSB.invoke(id, '<Type>.<name>', arg)` and event
  lists (editor `callGroups`); engine `WebObject.call(name, arg)`. Form: `submit`, `reset`.
- Widgets render their full markup at build time; `init` adds interaction, `patch` re-renders what a prop change affects.
  `inner(p, ctx, node)` gets the node (Carousel dots / Tabs labels count and name the children). Icons: `lib/icons.js`
  (`ICONS` Lucide inner SVG markup by name, `BRANDS` Simple Icons paths + hosts; generated, licences in
  `lib/icons.LICENSE.txt`) is imported by widgets.js in Node, set by the editor (`setIcons`), and loaded by pages only
  when a patch needs an icon. Carousel/Tabs: every child is a slide/panel (`childStyle`); the start one is shown by CSS
  (`:nth-child(n of [data-gpsb])`) until init sets `data-slide` / `data-tab`, `data-current` on the element. Modal is a
  `<dialog>` (`open` attribute only in editor mode), `showModal()` at runtime. Events: `gpsb:change` {index} (Carousel,
  Tabs), `gpsb:open` / `gpsb:close` (Modal), `gpsb:done` (Countdown). Calls: Carousel next/prev/goTo/play/pause, Tabs
  select, Accordion openAll/closeAll, Modal open/close/toggle, NavigationMenu open/close/toggle, VideoEmbed play.
  `openLightbox(items, i)` (one shared `<dialog class="gpsb-lightbox">`): Gallery and `Image.lightbox`.
- `PageMeta` (root only): `<html lang>`, favicon, canonical URL, og:title/description/image/url, `noindex`, `head` code.
- `Image.element: img` renders `<img class="gpsb-img" alt loading decoding=async>` filling the rect at `z-index: -1` inside an
  `isolation: isolate` element (children, Button tint, Mask and state sprites keep working); `background` (default) is a
  CSS background. The Image preset uses `img`.
- Toggle / Slider / InputField / Dropdown render the native control (`<input>`, `<select>`, `<textarea>`) inside the
  node element, filling its rect, with browser default styling. User edits are written back into the element's node
  data (`def.state`), so `GPSB.nodeFor(el)` reads the current value and re-applies keep it. Interactive runtime set-up
  lives in `def.init({ el, GPSB, ci })` (run by `behaviours.js#boot`, not in the editor).
- `Image.focus` [x, y] 0–1 → `object-position` / `background-position`. `Image.cropSource` + `crop` [x, y, w, h]
  (hidden): written by the editor's Crop & Focus window (`editor/crop.js`), which cuts `cropSource` with a canvas into
  a new asset `<name>.crop-<tag>.<png|jpg|webp>` (Sprite) and keeps the source for re-cropping; focus is relative to
  what Sprite shows.
- Canvas text editing (`editor/textedit.js`): Scene double-click on an element whose node has a Text → its
  `.gpsb-text` span becomes contentEditable (raw prop HTML, so page links stay unresolved), toolbar via
  `execCommand` (styleWithCSS off); end → `S.setProp(id, '<Text path>.text', html)`; `{{bindings}}` are refused.
  The front preview iframe takes pointer events while editing (`.editing`); a Scene pointerdown or a preview rebuild
  ends the edit.
- `Element` sets the HTML tag (section, nav, …), id, title, role and ARIA attributes. `Shadow` and `Outline` filters stack.
Definition shape is documented at the top of that file. `componentDef(type, customs, behaviourMeta)` resolves any type;
`withDefaults(def, props)` fills defaults.

## Rendering (`lib/render.js`)

- `makeCtx({ pages, customs, behaviours, json, clips, editor, base, assetVersions })` → ctx with `asset(p)`, `font(p)`, `href(h)`.
  `assetVersions` `{path: v}` appends `?v=` to asset URLs (build: content hash; dev server/editor: size+mtime) and is
  passed to the runtime in the page data so it builds identical URLs. Versioned URLs are served `immutable`.
- `renderPage(root, ctx)` → `{ body, css, data }`; `renderDocument(root, ctx, { name, cssHref })` → `{ html, css }`.
- Every element: `class="<slug-of-name>"` (unique per page) and `data-gpsb="<node id>"`. Root also has `gpsb-canvas`.
- Page data for the runtime: `<script type="application/json" id="gpsb-data">{ tree, clips, pages, behaviours, customs, editor }</script>`
  (tree has defaults filled and global bindings resolved; `clips` = clips used by Animators, or all clips in editor mode).
- `nodeStyle(node, parent, ctx)`, `nodeAttrs(node, ctx)`, `nodeTag`, `propsOf(component, ctx)`, `decl(styleObj)`.
- `drivenBy(node, parent, ctx, path)` → `[{ type, parent }]` / `[{ textStyle }]` / null: what fixes a number/bool property so
  editing it changes nothing (the Inspector greys such fields out with "(affected by X)").

## Page runtime (`lib/runtime.js`, `window.GPSB`)

Boots the Canvas Scaler, then (unless `data.editor`) `animator.js#boot(GPSB)` and `await behaviours.js#boot(GPSB)`, then
dispatches `gpsb:ready` on window. API:

```
GPSB.data, GPSB.ctx, GPSB.editor, GPSB.scale, GPSB.canvas
GPSB.node(id) GPSB.parent(id) GPSB.el(id) GPSB.els(id)       // els: all elements (Repeat clones share an id)
GPSB.find('Header/Logo' | 'Logo', fromNode?) -> node
GPSB.applyNode(node, parent?, els?)  // PURE: re-apply node data's style/attrs/patch to els (default: all elements
                                    // with that id). Never writes the tree. Runtime code mutates GPSB.node(id) in
                                    // place then calls it; editor preview passes clones. Attributes and Style classes
                                    // a prop change no longer produces (disabled, inert, target...) are removed.
                                    // Inline styles are updated per changed property (not rewritten each frame).
GPSB.setActive(id, bool | 'toggle')  // toggle is per element (Repeat clones toggle independently)
GPSB.preload(url)            // load + decode an image and keep it referenced (sprite swaps never show a blank frame)
GPSB.nodeFor(el)              // node data for one element: canonical node, or a per-clone copy inside a Repeat ({{item}} resolved)
GPSB.effective(node)          // node with the active breakpoint overrides     GPSB.breakpoints() -> active names
GPSB.assets.url(p) .json(p) .text(p)
// added by animator.js:
GPSB.animator(id, el?) -> controller { play(clip?), stop(), pause(), resume(), seek(t), playing, time, clip, speed, el }
                       // one controller per Animator element (Repeat clones animate independently); without el, a
                       // proxy driving all of them
// added by behaviours.js:
GPSB.invoke(targetId, call, arg, sourceId?)   // runs one event entry (see Events)
GPSB.behaviour(id, Name) -> instance
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
  import { Component } from '../gpsb/component.js';
  export default class extends Component {
    rendered() { this.$('h2').onclick = () => this.emit('picked', this.props.title); }
  }
</script>
```

- Compiled by `lib/compile.js` into `components/<Name>.js` (calls `define(tag, {template, style, props}, Cls)`)
  and `components/<Name>.script.js` (the author script verbatim). Tag = `gpsb-<slug(Name)>`.
- Rendered as `<gpsb-card class=… data-gpsb=… title="…" image="assets/…">children…</gpsb-card>`: props become
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
`this.props` (defaults merged), `this.GPSB`, `this.find(path)` (node),
`this.apply()` is `GPSB.applyNode(this.node, parent, this.el)` (own element only). `this.animator` (controller of the nearest Animator on self/ancestors or null), `this.setActive(bool)`.
One instance per element. `update(dt)` / `lateUpdate(dt)` run on the shared frame loop (`lib/frame.js`, orders 0 / 30),
dt = `Time.deltaTime` in seconds. After injection the runtime calls `inst._gpsbReady?.()` (engine `Behaviour`: re-binds
prop accessors a class field may have hidden). Methods are listed for event pickers from the class's own prototype
(data properties only, not getters); `start`, `update`, `lateUpdate` and `_`-prefixed names are hidden.
Modules are loaded from `behaviours/<Name>.js` relative to the page (`new URL('../behaviours/…', import.meta.url)` from gpsb/).

## Scripting API (`lib/engine.js`, on `lib/frame.js`)

Browser-side layer over the plain script contract; importable in Node too (no browser APIs at import time). Docs:
`docs/engine-api.md`. Typings: `lib/engine.d.ts` (the whole public API) must be kept in step with the code.
Project scripts import only `gpsb/engine.js`; `frame.js` is internal plumbing the runtime loads on every page.
- `frame.js`: `Time` (`deltaTime` scaled by `timeScale`, clamped to `maximumDeltaTime` 0.1), `onFrame(fn, order)` (one
  rAF loop, started while anything is subscribed; orders: behaviours `update` 0, coroutines 10, tweens 20, `lateUpdate`
  30), `markDirty(node, el?)` → one `GPSB.applyNode` per marked node in a microtask (el set: that element only),
  `manualFrames()` + `step(dt)` for tests. Animators keep their own loop and clock.
- `engine.js`: `Behaviour` (static `props` → own accessors onto `this.props`; values converted: vec2/vec4 ↔
  `Vector2`/`Vector4`, color ↔ `Color`, node id ↔ `WebObject` or the component named by the schema's `component`,
  event ↔ `WebEvent`; reserved names throw), `WebObject` (one per node+element, cached), `RectTransform`,
  `ComponentRef` (typed component props), coroutines (generators on frame order 10), value types (immutable, `toJSON`
  → stored form), `Mathf`, `Random`, `Assets`, `prop.*` schema builders, `defineExtension(Class)` (class → definition;
  hooks only for methods the class has; `init` gets live accessors that `markDirty`), `html`/`raw` (escaping template).
  Wrapper setters change node data and `markDirty`; nothing else writes to the page.
- tweening (in `engine.js`): `Tween` / `Sequence` (shared `Timeline`: delay, loops restart|yoyo|incremental, speed, unscaled,
  callbacks, thenable → true completed / false killed), targets: node / WebObject / id or path (property paths via
  `getProp`/`setProp` + `markDirty`; `rect.pos` sets `rect._layoutPos` while it plays, like the animator), plain objects
  (dotted fields), `Tween.value(from, to, s, setter)`. Values lerp via `Ctor.lerpUnclamped` (engine types) or
  `lerpValue`. Auto-play on the next microtask; tweens added to a sequence are driven by it.

## TypeScript

`lib/compile.js` `compileTS(src, file)` → `{ code, map }`: Node's `module.stripTypeScriptTypes` in transform mode (enums,
namespaces, parameter properties; no type checking), relative `*.ts` imports rewritten to `.js`, map with the source
embedded (`sourcesContent`). Needs Node ≥ 22.15 (`stripTypeScriptTypes`, `registerHooks`); only when TS is used.
- `loadProject`: `behaviours/*.ts` and top-level `extensions/<Name>.ts` count like `.js` (entries `{ path, module, lang }`,
  `module` = the published `.js` URL; the same name as `.js` and `.ts` is an error).
- Node (`cli.js`, `module.registerHooks`): `.ts` files compile on load; a missing `./x.js` resolves to `./x.ts`; a
  missing `…/gpsb/<file>.js` resolves to the tool's `lib/<file>.js` (extensions importing `../gpsb/engine.js` at build).
- Dev server: `/project/(behaviours|extensions)/<path>.js` with no `.js` file but a `.ts` → compiled, inline map; a
  syntax error is served as `throw new SyntaxError("<file>: …")`. Build: `.ts` → `.js` + `.js.map`, `.d.ts` skipped.
- `<script lang="ts">` in `components/<Name>.html`: compiled into `<Name>.script.js`.
- Typings: `writeTypes(root, P)` writes `.gpsb/types/gpsb/engine.d.ts` (copy of `lib/`),
  `project.d.ts` (augments `ComponentTypes` in `./engine.js` with every built-in, extension and custom component's props),
  `.gpsb/.gitignore`, and `tsconfig.json` if missing (typings it no longer writes are removed) (`rootDirs: ['.', '.gpsb/types']` maps `../gpsb/engine.js`). Run by
  `/api/project` when the project has `.ts` scripts or a `tsconfig.json`, and by `gpsb types [dir]`.

## npm packages (`pm.js`, Node only, not shipped)

UPM-style: `packages/manifest.json` `{ dependencies: { name: range }, registry?, scopedRegistries?: [{ url, scopes }],
types?: false }`; `packages/packages-lock.json` `{ lockfileVersion: 1, packages: { name: { version, resolved, integrity,
direct, dependencies, main, format: 'esm'|'cjs'|'none', imports: { specifier: path in the package }, types, named?,
typesOnly? } } }`; files in `packages/<name>/` (scoped: `packages/@scope/name/`). Docs: `docs/packages.md`.
- One version per package (flat): highest satisfying every request (npm semver: `^ ~ x * - || < <= > >= =`, dist-tags;
  prereleases only when named), locked versions preferred, direct dependencies win conflicts (warning).
  `dependencies` + non-optional `peerDependencies`; optional dependencies and install scripts are ignored.
- Download: abbreviated packuments, tarball checked against `dist.integrity` (sha512) / `shasum`, extracted after every
  entry path is checked (nothing may escape `packages/<name>/`), via a `.gpsb-tmp` folder.
- `analyze`: browser entry from `exports` (conditions browser, import, module, default) → `module` → `browser` (string) →
  `main`; format from extension, condition, `type`, else syntax. Import map entries: `name`, exact `exports` subpaths,
  `./x/*` patterns as `name/x/` prefixes, and `name/` (any file). ESM packages: extensionless relative imports (and deep
  imports into packages without `exports`) are rewritten to the real file. CJS: `bundleCJS` writes
  `packages/<name>/gpsb.esm.js` (the package's own files reachable by literal `require`, JSON, `browser` field swaps;
  other packages become imports, Node built-ins and missing packages throw when required; `process.env.NODE_ENV` =
  'production' in the browser; default export `module.exports`, named exports found statically).
- `@types/<name>` (version ~major.minor of the library) and the packages it depends on are installed `typesOnly` for
  packages without types (unless `types: false`).
- API: `add(root, specs)`, `remove(root, names)`, `update(root, names?)`, `install(root)` (restore from the lock without
  resolving when the manifest matches it), `problems(root)` (offline check), `list`, `outdated`, `search`, `info`,
  `packageImports(lock)` (→ `{ specifier: '<name>/<path>' }`), `packageUrl(rel)`. Operations are serialised per project.
- Render: `ctx.importMap` (`P.importMap` from `loadProject`) → `<script type="importmap">` after `<base>` and before any
  module script; addresses are `ctx.package(path)` (`<prefix>packages/<path>`), made `./`-relative. Runtime / engine:
  `GPSB.ctx.package`, `Assets.packageUrl`.
- Node (`cli.js` hooks): a bare specifier from a file inside a registered project resolves through its import map
  (`packageRoots`, set by `loadExtensions`); `.js` files inside `packages/` load as ES modules.
- Build: `pm.install` first (restore), then `copyPackages`. Dev server: `pm.install` when a project is opened;
  `/editor/` gets an import map (`/project/packages/…`) for the editor's own imports of project scripts; `packages/` is
  watched and a lock change triggers `S.packagesChanged()` (reloadMeta + `packages` event).
- CLI: `gpsb add | remove | update | install | packages | search` (`--dir`, default the current folder).

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
- Runtime animation (like Unity) overwrites values: write samples into the target element's `GPSB.nodeFor(el)` in place
  with `setProp`, then `GPSB.applyNode(node, undefined, el)`. `Animator.*` and `Repeat.*` props are not animatable.
- `lib/animator.js#boot(GPSB)`: one controller per Animator node; `playOn` start/hover/click/visible/manual; speed;
  loop or hold last frame; fires clip events through `GPSB.invoke(animatorNodeId-relative target, call, arg)`;
  exposes `GPSB.animator(id)`.
- Editor (`panels/animation.js`): Unity Animation window — clip dropdown + Create New Clip (saves to `animations/`,
  adds to the Animator's `clips`), Add Property, dopesheet (keys as diamonds, drag/box-select/delete/copy/paste),
  Curves view, timeline ruler with playhead scrub, preview play/pause/loop, **record mode** (red) via
  `S.hooks.setProp` (changes made in Inspector/Scene write keys at `S.anim.time` instead of base values),
  `S.hooks.animState` (inspector tints keyed fields red / animated fields blue), key inspector (value + ease), events row.
  Preview drives the Scene iframe through `S.previewWin.GPSB.applyNode(clone, parentClone)`; re-apply after every
  `props`/`preview-ready` event (subscribers run in mount order; animation mounts after scene).

## Project Hub, preferences, user config

`gpsb` / `gpsb hub` starts the server with no project open; `gpsb serve <dir>` also opens <dir>. `/` is always the
**Project Hub** (`editor/hub.html`); the editor is at `/editor/` (302 to `/` while no project is open; the editor itself
returns to `/` if `/api/project` answers 409). User config lives in `$GPSB_CONFIG_DIR` or
`~/.config/gpsb/`: `projects.json` (registry `[{path, added, lastOpened}]`) and `prefs.json` (copied once from the
pre-rename `~/.config/perfect-site-builder/` if that exists and the new folder does not).

```
GET  /api/hub/projects        -> { projects: [{path, name, exists, open, pages, assets, modified, added, lastOpened}], open, home }
GET  /api/hub/ls?path=<abs>   -> { path, parent, project, dirs: [{name, project}], sep }   (folder browser, default home)
POST /api/hub/open   {path}   open a project in the editor (registers it, lastOpened = now)
POST /api/hub/add    {path}   register an existing project folder (must contain project.json)
POST /api/hub/remove {path}   forget it (files stay on disk)
POST /api/hub/create {dir, name, template: 'empty'|'showcase'|<lib/sections.js TEMPLATES id>, theme?} -> { path }  (showcase = copy of example/)
GET|PUT /api/prefs            the whole prefs object
```
Project writes (`PUT/DELETE /api/file`, `/api/rename`, `/api/build`) must send `x-gpsb-project: encodeURIComponent(S.S.P.root)`
(S.api does); a tab whose project is no longer the open one gets 409.

**Preferences** — `editor/prefs.js`: `load()`, `get(key, default)`, `set(key, value|undefined)` (debounced save),
`all()`, `onChange(fn)`, `apply(doc)`, `DEFAULTS`. Keys: `theme` ('dark'|'light'), `accent` (hex),
`fontSize`, `layout` (current dock layout), `layouts` ({name: layout} saved layouts), `shortcuts` ({action: key combo}
overrides); panels namespace their own keys (`scene.grid`, …). Theme tokens are defined in `editor/style.css` under
`:root[data-theme=dark|light]`; panel CSS must use the tokens, never hard-coded chrome colors.

## Extending the output

The output is meant to grow: dynamic components (runtime data, embeds, third-party widgets) plug in without changing
the build. Anything below is a stable contract; changes to the build (minify, clean URLs, asset versions, ...) must
keep it working.

**Extension components** (`extensions/<Name>.js` or `.ts`, `Name` a JS identifier, not a built-in name). The default
export is a component definition (format at the top of `lib/components.js`), a factory `kit => definition` where `kit` =
`{ esc, cssUrl, control, near, findComp, fontFamily }`, so the module needs no imports, or `defineExtension(Class)` from
`../gpsb/engine.js` (resolved to the tool's `lib/` when imported in Node). The file must load in Node and
the browser: browser-only work goes in `init` / `patch` / `state`. Registered with `registerComponent(name, def)`
(`lib/components.js`; `isExtension`, `extensionNames`, `unregisterComponent`) and from then on indistinguishable from
a built-in (Add Component, Inspector, animation, overrides, build, runtime). Default category: `Extensions`.
- Build (`cli.js build`): imported with a content-hash version, registered before rendering, copied to `dist/extensions/`.
  A load error fails the build (the pages would silently lose content).
- Dev server / on-the-fly pages and editor: imported from `/project/extensions/` with a size+mtime version;
  re-imported when the file changes (SSE `extensions/…` → `reloadMeta`).
- Published runtime: page data `extensions: { Name: version }` lists the extensions the page uses; `runtime.js`
  imports `../extensions/<Name>.js?v=…` relative to itself and registers them before applying or initialising anything.
- Hooks for dynamic behaviour: `init({ el, GPSB, ci })` (published page / Play mode only, once per element),
  `patch(el, p, ctx)` (after any prop change), `state` (user-edited values, see form controls), `head(p, ctx)` (HTML
  added to `<head>`, deduplicated per page; e.g. a widget's script or stylesheet), `inner` (build-time HTML, also what
  the editor shows).

**Custom code**: `project.json` `inject.head` (every page's `<head>`) and `inject.bodyEnd` (end of every `<body>`, not
in the editor's edit-mode preview), `PageMeta.head` (one page's `<head>`).

**Build hooks** (`build.js`, optional, Node, never copied): `transformPage({ name, html, css, project })` → partial
`{ html, css }`; `afterBuild({ out, root, project, pages })` (RSS, search index, upload). Errors fail the build.

**Output contract** (what code added later can rely on):
- every node element has `data-gpsb="<node id>"` and a class from its name (unique per page); the root has `gpsb-canvas`
- page data in `<script type="application/json" id="gpsb-data">`; `window.GPSB` (see Page runtime) and `gpsb:ready`
- unbundled ES modules: `gpsb/*.js` (runtime and lib), `components/<Name>.js`, `behaviours/<Name>.js`, `extensions/<Name>.js`
- asset URLs always come from `ctx.asset` (`GPSB.ctx.asset` / `GPSB.assets.url` at runtime), never hand-built

## Dev server (`cli.js serve`)

Binds 127.0.0.1 only. Every project path is resolved and rejected (403) if outside the project root.

```
GET  /                         editor/hub.html (Project Hub)   GET /editor/  editor/index.html   GET /editor/* /lib/*  tool files
GET  /project/gpsb/*            lib/*                      GET /project/components/<Name>.js|.script.js  compiled on the fly
GET  /project/(behaviours|extensions)/<path>.js   <path>.ts compiled on the fly when there's no .js file
GET  /project/<page>.html      that page rendered on the fly (Links / IFrames inside the editor preview)
GET  /project/*                project files (Range requests supported)
GET  /api/project  -> { root, project, pages, components, behaviours, clips, json, assets[{path,type,size}], importMap, errors[{file,error}] }
                   (unparseable pages/clips are left out, a bad JSON asset is null, project.json falls back to defaults;
                   a project with TypeScript also gets its typings rewritten, see TypeScript)
GET|PUT|DELETE /api/file?path= read / write (raw body, streamed) / delete a project file (never the project folder itself)
POST /api/rename?from=&to=     POST /api/build -> { out, pages, warnings[] }
GET  /api/events               SSE { file } on external changes (editor hot-reloads components/behaviours/assets/packages)
GET  /api/packages[/outdated|/search?q=|/info?name=]   POST /api/packages/add {specs} | remove {names} | update {names}
                               -> { installed, removed, warnings, list } (Package Manager window, editor/packages.js)
```
`build()` refuses an output folder that contains the project, sits inside a source folder, or is non-empty without
being a previous build (`gpsb/runtime.js`, or `psb/runtime.js` from before the rename), ignoring and keeping the paths in `project.json` `keep` (gitignore-style: `name/` a folder, `name` a file, nested paths allowed; `[".git/"]` for a deploy repo); it fails on broken pages/clips/project.json and skips broken components (warning).
Requests with a Host other than `127.0.0.1:PORT`/`localhost:PORT` get 403; non-GET requests need header `x-gpsb: 1`
(`S.api` sends it).

## Editor (`editor/`)

Dockable layout (`editor/layout.js`; default = Unity's): toolbar (top), Hierarchy (left), Scene/Web (center), Inspector (right, full height),
bottom tabs Project | Console | Animation | Content | Generated Code. Each `editor/panels/<name>.js` exports `mount(el)` and owns
`panels/<name>.css` (already linked). Theme tokens are CSS variables in `editor/style.css` (`--panel`, `--accent`, …).
`main.js` mounts panels in order: toolbar, hierarchy, scene, inspector, project, console, animation, code, content; handles the
bottom tabs (`emit('show-tab', name)` switches) and splitters.

`editor/state.js` (import as `* as S from '../state.js'`; the store object is `S.S`):

```
S.S: { P, page, selection[], tool, resolution, playing, behaviourMeta, anim{clip,time,recording,playing,animatorId}, dirty, previewWin, hooks }
on(ev, fn) -> unsubscribe     emit(ev, ...args)     log(msg, level='info'|'warn'|'error', extra)
events: load structure props(ids) selection tool page anim assets log(entry) play resolution saved preview-ready show-tab frame
        rename (F2 -> hierarchy) asset-select(projectPath) asset-ping(assetPath) (inspector <-> project) breakpoint
        layout (dock layout changed; panels may have been re-parented)
root() node(id) parentOf(id) parentSize(id) selected() active() def(type) propsOf(component) assetUrl(path)
view(id) breakpoints() editNames() setBreakpoint(name) setBreakpoints(list) isOverridden(id, path) revertOverride(id, path?)
edit(label, fn, { kind, ids, merge, files })   undo() redo()
setProp(id, path, value, opts)     // ALWAYS use this for property edits (record mode hooks in);
                                   // opts.label groups many setProps into one undo step (drags, presets)
select(ids, additive) setTool(t) PRESETS PRESET_GROUPS (submenus of WebObject ▸ UI: Widgets) create(preset, parentId) addNode(node, parentId, index)
deleteNodes(ids) duplicate(ids) cloneTree(node) reparent(id, newParentId, index) addComponent(id, type) removeComponent(id, i) moveComponent(id, i, to)
// cloneTree: fresh ids, internal references remapped; remove/moveComponent keep <Type>[n] override/track paths on the same component
setPage(name) newPage(name) previewHTML(editor) generatedCode() setPlaying(bool)
api.get/put/del/rename/build   save() build() upload(file, dir) load() reloadMeta()
```

- `fitToChildren(ids, axes)` (Inspector ⤢ on Width/Height or Right/Bottom, and Canvas Height): one-shot size that encloses
  the children as rendered in the preview; anchors respected, stretched children skipped, the near edge stays put.
- Productivity: `history()` / `jump(n)` (undo steps keep readable labels), arrow-key nudging (`nudge.*` shortcuts,
  Scene/page focus only), system-clipboard copy/paste in `hierarchy.js` (`{"gpsb-nodes":1, nodes, prefabs}`),
  `find.js` (Find & Replace through `setProp`, one undo step per page), Scene `align(kind)` (event `align`: left,
  center, right, top, middle, bottom, distributeX, distributeY; one object aligns within its parent), smart guides
  (`cfg.guides`, Alt skips), `recovery.js` (autosave pref `autosave` seconds; unsaved files mirrored to IndexedDB
  `gpsb-recovery` per project root and offered back on load).
- `structure` = the Scene rebuilds the iframe (`srcdoc = previewHTML()`); `props(ids)` = patch those nodes via
  `previewWin.GPSB.applyNode(...)` immediately, plus a debounced (~300 ms) full rebuild to catch tag/inner/layout changes.
- Drag & drop between panels: `dataTransfer` types `application/x-gpsb-asset` (asset path, or clip name),
  `application/x-gpsb-node` (node id) and `application/x-gpsb-component` (`component:X` / `behaviour:X`, drop on Inspector). OS file drops anywhere in Project/Scene/Hierarchy import via `S.upload`.
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
| shell | `editor/index.html style.css main.js prefs.js` (+ new layout/preferences modules), `panels/{toolbar,hierarchy,console,code}.*` |
| hub | `editor/hub.{html,js,css}` |
| inspector | `panels/{inspector,project}.*` (+ new `editor/*.js` helpers you create) |
| scene | `panels/scene.*` |
| animation | `lib/anim.js`, `lib/animator.js`, `panels/animation.*` |
| runtime | `lib/component.js`, `lib/behaviours.js`, `example/**`, `test/e2e.js` |
