# Bug report

Found by reading `lib/`, `cli.js` and the editor (`editor/state.js`, `editor/files.js`, the panels), then reproducing
each one. Every bug below was confirmed with a script, a throwaway project in `.tmp/`, or the real editor in headless
Chromium. The "Repro" lines show what was run. Ordered by severity.

**Status: all 18 are fixed.** Each fix was checked by re-running the original repro. Lib-level regressions are covered in
`test/core.test.js`, and `npm test` (core, anim, e2e) passes. The "How it was fixed" section at the end explains each fix.

| # | Severity | Area | Summary | Status |
|---|---|---|---|---|
| 1 | Critical | dev server | `DELETE /api/file` with an empty `path` deletes the whole project | Fixed |
| 2 | Critical | build | `build --out <project dir>` deletes the project's source files and still reports success | Fixed |
| 3 | High | editor save | Edits made while a save is in progress are lost and no longer marked unsaved | Fixed |
| 4 | High | runtime | `applyNode` never removes attributes (`disabled`, `inert`, `target`, …) | Fixed |
| 5 | High | dev server | One invalid JSON asset stops the whole project from loading in the editor | Fixed |
| 6 | Medium | runtime | `setActive` `toggle` never works on nodes inside a `Repeat` | Fixed |
| 7 | Medium | build | One broken component file fails the whole build, even if no page uses it | Fixed |
| 8 | Medium | layout | `reverse` on Horizontal/Vertical Layout Group also flips the child alignment | Fixed |
| 9 | Medium | components | A tinted Button draws a solid box behind transparent sprites | Fixed |
| 10 | Medium | editor rename | Renaming a behaviour or component leaves overrides (and component animation tracks) pointing at the old name | Fixed |
| 11 | Medium | editor | Removing or reordering components moves indexed overrides and tracks onto a different component | Fixed |
| 12 | Low | build | A font used only in a breakpoint override gets no `@font-face` | Fixed |
| 13 | Low | build | Overrides inside an empty `Repeat` produce a `.undefined { … }` CSS rule | Fixed |
| 14 | Low | editor | Duplicate/paste keep event targets pointing at the original nodes | Fixed |
| 15 | Low | dev server | No HTTP Range support (video seeking, Safari playback) | Fixed |
| 16 | Low | build | `Style.className` is not escaped in the HTML output | Fixed |
| 17 | Low | editor undo | Undo can switch the page without firing the `page` event | Fixed |
| 18 | Low | tests | `test/browser.js` sometimes crashes during cleanup with `ENOTEMPTY` | Fixed |

---

## 1. Empty `path` on `DELETE /api/file` deletes the project — Critical

`cli.js:133` `safe()` accepts the project root itself (`p !== root && …`), and the DELETE handler (`cli.js:249`) runs
`fsp.rm(f, { recursive: true, force: true })` on whatever `safe()` returns. So `path=` (or a missing `path`, or `.`)
deletes the whole project folder. A single editor bug that sends an empty path, such as a `deletePath('')`, would wipe
the user's project without asking.

Repro: on a copy of a project, `curl -X DELETE -H 'x-gpsb: 1' -H 'x-gpsb-project: …' 'http://127.0.0.1:PORT/api/file?path='`
returned `{"ok":true}`, and the project folder was gone.

Fix: reject the root in `safe()` for writes (`p === root` → 403), or require a non-empty path in `/api/file` and
`/api/rename`. PUT and rename have the same root case. Today they only fail by accident (EISDIR, or renaming a folder into itself).

## 2. `build --out` inside or equal to the project wipes it — Critical

`build()` (`cli.js:75`) runs `fsp.rm(out, { recursive: true, force: true })` with no check on `out`. It loads the
project into memory *before* deleting, so `gpsb build mysite --out mysite` writes pages from memory and prints
`built 1 page(s)`, but `project.json`, `pages/`, `assets/` and `animations/` are deleted, and assets are missing from the output.
`--out ..`, `--out ~` and similar delete even more.

Repro: `node cli.js build .tmp/bo --out .tmp/bo` → output OK, `project.json` and `pages/` gone.

Fix: refuse an `out` that equals the project root, contains it, or contains a project source folder. Even better, only
delete inside `out` when it looks like a previous build (for example, it has a `gpsb/runtime.js`).

## 3. Edits during a save are silently lost — High

`save()` (`editor/state.js:233`) turns each dirty file into a string, `await`s the PUT, then runs
`S.dirty.delete(f)` (line 242). Any edit to that page while the request is in flight is never written, but its dirty
flag is cleared anyway. The editor shows no unsaved changes, and the edit is lost on reload or project switch.

Repro (in the editor): `setProp(name='First'); const p = save(); setProp(name='Second'); await p`. Result:
in memory `Second`, on disk `First`, `dirty` doesn't include the page.

Fix: remember a per-file edit counter (or the serialized body) when the save starts, and only clear the dirty flag if
nothing changed since then. A second save started during the first has the same problem.

## 4. Runtime `applyNode` never removes attributes — High

`lib/runtime.js:66` only calls `setAttribute` for attributes that are present. Attributes that disappear when a prop
changes are never removed:
- `Button.interactable` false → true: the button stays `disabled`.
- `CanvasGroup.interactable` false → true: the subtree stays `inert`, so it can't be clicked or focused.
- `Link.newTab` true → false (`target`, `rel`), `Image.alt` cleared (`role`, `aria-label`), custom-component attributes.

This hits animations, breakpoint overrides (the runtime re-applies on breakpoint change) and behaviour code alike. It
only goes one way: changing a prop to add an attribute works, changing it back doesn't.

Repro (built page): with `interactable: false` at build time, set it to `true` and call `GPSB.applyNode`. The element
still has `disabled` / `inert`.

Fix: track the attribute names the renderer manages (for example, the ones `nodeAttrs` produced last time, kept per
element) and remove the ones that are no longer there. Extra classes from `Style.className` are also never updated at
runtime.

## 5. One bad JSON asset stops the project loading — High

`readJSON` (`cli.js:49`) only falls back when the read fails. `JSON.parse` errors are thrown, and `loadProject` reads
*every* `assets/**/*.json` file. So one asset JSON with a syntax error (or comments) makes `/api/project` return 500,
and the editor can't open the project. The user can't fix the file from the editor either. A malformed page or clip file
has the same effect.

Repro: `echo '{oops' > assets/data/bad.json` → `GET /api/project` → `500 Expected property name…`.

Fix: catch parse errors per file and report them (like `components` already does with `error`). For assets, store
`null` and log a warning.

## 6. `setActive` `toggle` doesn't work inside a `Repeat` — Medium

`lib/behaviours.js:20` decides the toggle from `GPSB.node(id).active`, the canonical node. Inside a `Repeat`,
`GPSB.setActive` writes to each clone's own data (`nodeFor(el)`), so the canonical `active` never changes. Every toggle
computes "turn off" again, and the item can never be turned back on.

Repro (built page with a 2-item Repeat): `GPSB.invoke('item','setActive','toggle')` twice → both clones still
`display: none`.

Fix: toggle per element (`GPSB.nodeFor(el).active`) inside `setActive`, for example by accepting `'toggle'` there.

## 7. A broken component file fails the whole build — Medium

`loadProject` catches component parse errors (`cli.js`, `components[name] = { … error }`), but `build()` then calls
`compileComponent` on every component (`cli.js:80`) without a catch. A component with invalid props JSON, even one no
page uses, aborts the build with a stack trace.

Repro: add `components/Broken.html` with `<script type="application/json" props>{ bad }</script>` →
`gpsb build` throws `SyntaxError`.

Fix: skip components that have an `error` (log it), or only compile the components the pages use.

## 8. Layout Group `reverse` also flips the alignment — Medium

`linearGroup` (`lib/components.js:49`) switches to `row-reverse` / `column-reverse` but keeps the same
`justify-content`. In a reversed flex container `flex-start` is the *opposite* edge, so an `upper-left` group packs its
children on the right (or the bottom). Unity's "Reverse Arrangement" only reverses the order and keeps the alignment.

Repro: `HorizontalLayoutGroup { reverse: true, childAlignment: 'upper-left' }` → `row-reverse` + `justify-content: flex-start`
(children end up on the right).

Fix: when `reverse` is on, swap `flex-start` and `flex-end` on the main axis.

## 9. Tinted Button draws a box behind transparent sprites — Medium

`Image` with a sprite sets `background-color: transparent`, but `Button` with `transition: 'tint'`
(`lib/components.js:184`) always sets `background-color: normal` (white by default) and changes it on `:hover`/`:active`.
Because Button comes after Image, a button made from a PNG/SVG with transparent areas shows a white rectangle behind
the sprite, which changes colour on hover. In Unity the tint multiplies the sprite instead.

Repro: `nodeStyle` of `[Image{sprite}, Button{}]` → `background-color: #ffffff`.

Fix: when the node's Image has a sprite, apply the tint some other way (for example a `filter`, or mask the
background colour with the sprite), or at least don't fill the background.

## 10. Renaming a behaviour or component misses overrides and some tracks — Medium

`retarget` in `editor/files.js` only rewrites string *values*:
- Breakpoint override *keys* such as `"behaviour:Spin.speed"` / `"component:Card.title"` keep the old name, so those
  overrides silently stop applying.
- For components (`files.js:128`) only exact matches are renamed, so animation tracks and event calls such as
  `component:Card.title` keep the old name (the behaviour branch handles the `a + '.'` prefix; the component branch doesn't).
- Indexed paths (`behaviour:Spin[1].speed`) are missed by both branches.

Repro (editor): node with `behaviour:Spin`, an override `behaviour:Spin.speed` and a track on it → rename
`Spin.js` → `Spinner.js`. The type and track are updated, but the override key is still `behaviour:Spin.speed`.

Fix: also rename `node.overrides[bp]` keys, use the same prefix (and `[n]`) matching for components as for behaviours.

## 11. Removing or reordering components moves indexed overrides and tracks — Medium

Paths like `behaviour:Spin[1].speed` and `Image[1].color` count instances of the same type on the node.
`removeComponent` / `moveComponent` (`editor/state.js:199-200`) change those indexes without rewriting overrides or
animation tracks. After removing the first `Spin`, an override for `Spin[1]` targets nothing. After reordering two
`Spin`s, overrides and tracks apply to the other one.

Fix: when components of a repeated type are removed or moved, rewrite the `<Type>[n]` paths in that node's overrides and
in the clips that target it (and drop the paths of the removed component).

## 12. Fonts used only in overrides get no `@font-face` — Low

`renderPage` (`lib/render.js:166`) collects font assets from base `c.props` only. A font set only in a breakpoint
override (for example Phone `Text.font = fonts/Lato-Black.ttf`) is used as `font-family: "gpsb-fonts-lato-black-ttf"`, but
that family is never declared, so the browser falls back.

Repro: confirmed with `renderPage`: the CSS uses the family, but there is no `@font-face`.

Fix: also scan `node.overrides` values with `isFontAsset`.

## 13. `.undefined` CSS rule for overrides inside an empty `Repeat` — Low

Children of a `Repeat` with no items are never rendered, so they never get a class. The breakpoint diff
(`lib/render.js:157`) still visits them and outputs `.undefined { … }` for any overrides they have. It's harmless today,
but it would style any element whose class happens to be `undefined`.

Fix: skip nodes without a class in `classes`.

## 14. Duplicate/paste keep event targets pointing at the originals — Low

`duplicate` (`editor/state.js:165`) and hierarchy `paste` give new ids to the whole subtree but don't remap `event`
targets / `node` props that point *inside* that subtree. A duplicated "button + panel" pair still toggles the original
panel. (Unity remaps references inside a duplicated subtree.)

Fix: build an old→new id map while re-assigning ids and rewrite `target` / `node`-type prop values that are in the map.

## 15. Dev server has no Range support — Low

`sendFile` (`cli.js:145`) always answers `200` with the full body and no `Accept-Ranges`. Seeking in `<video>`/`<audio>`
in the editor preview doesn't work properly, and Safari won't play MP4 from a server without range support. This only
affects the dev server; the built site is served by the user's own host.

Repro: `curl -H 'Range: bytes=0-10'` → `200`, no `accept-ranges` header.

Fix: handle `Range: bytes=a-b` → `206` with `Content-Range`, using `createReadStream(file, { start, end })`.

## 16. `Style.className` isn't escaped — Low

Extra classes are put into `class="…"` as-is (`lib/render.js:139`). A value with `"` breaks the markup and can add
attributes: `a" data-x="1` → `<div class="s a" data-x="1" …>`. Only the page author can set it (and the `HTML` component
allows raw HTML anyway), so this is about correctness, not security.

Fix: `esc()` the joined class string.

## 17. Undo can switch pages without the `page` event — Low

The undo snapshot stores the page, and `restore` (`editor/state.js:54`) sets `S.page = s.page` and fires
`structure`/`selection`, but not `page`. Undo after switching pages jumps back to the earlier page, but `page`
listeners (the hierarchy resets its collapsed state, search and anchor; the scene clears hover) don't run.

Fix: `emit('page')` when `s.page` differs from the current page (or keep a separate undo history per page).

## 18. `test/browser.js` crashes in cleanup — Low

`cleanup` (`test/browser.js:20`) runs `SIGKILL` on Chrome and immediately calls `rmSync` on the profile. Chrome may still be
writing, so `rmSync` sometimes throws `ENOTEMPTY` and the script crashes with a stack trace (seen twice while checking
this list), even when the page had no errors.

Fix: wait for the process `exit` event before removing the profile, or wrap `rmSync` in try/catch (or use `maxRetries`).

---

## How it was fixed

1. `safe(rel, write)` (`cli.js`) refuses to write, delete or rename the project folder itself (403). PUT, DELETE and
   both ends of `/api/rename` use it.
2. `build()` resolves both paths and refuses an output folder that contains the project, sits inside a source folder,
   or isn't empty and doesn't contain `gpsb/runtime.js` from a previous build. This check runs before anything is deleted.
3. `save()` writes the text it serialized, and clears the dirty flag only if the file still serializes to that same
   text afterwards. The message now says how many files failed. `api.del`/`api.rename` now reject on HTTP errors.
4. The runtime remembers which attributes (`role`, `aria-label`, `disabled`, `inert`, `target`, `rel`, plus whatever it
   last set) and `Style` classes it owns on each element. `applyNode` removes the ones the new props no longer produce.
   Classes added by user code are kept.
5. `loadProject` collects parse errors in `errors[{file, error}]` instead of throwing. Broken pages and clips are left
   out, a broken JSON asset becomes `null`, and a broken `project.json` falls back to defaults. The editor logs them,
   and `newPage` won't reuse the name of a page that failed to load. The build fails on broken pages, clips or
   `project.json`, and only warns for assets and components.
6. `GPSB.setActive(id, 'toggle')` toggles each element's own node data. `invoke('setActive', 'toggle')` uses it.
7. The build skips components that failed to parse, and reports them in `warnings` (printed by the CLI, logged by the editor).
8. `alignFlex` flips the main axis when `reverse` is on.
9. `Image` exposes its sprite as `--gpsb-sprite` / `--gpsb-sprite-size`. A tinted `Button` over a sprite no longer fills
   its background. Instead it draws a `::before` layer masked to the sprite and blended with `multiply`, and
   `:hover`/`:active` change `--gpsb-tint`. Sprite swaps keep working because the mask reads the variable.
   `rules()` now also receives the node (`rules(p, sel, ctx, node)`).
10. `retarget` can also rename override keys. Component and behaviour renames use one matcher that handles
    `Type`, `Type.prop` and `Type[n].prop` in values, tracks, event calls and override keys.
11. `removeComponent`/`moveComponent` go through `changeComponents`. It maps each component's old `<Type>[n]` path to
    its new one and rewrites the node's override keys and the tracks that target the node in this page's Animators.
    Overrides of a removed component are dropped. Its tracks are dropped only if another component would otherwise
    take over their path. The change is a single undo step, and changed clips are marked dirty.
12. `@font-face` collection also scans override values.
13. The breakpoint diff skips nodes that were never rendered.
14. New `S.cloneTree(node)` gives the copy new ids and points references inside the copied subtree (event targets,
    node props, overrides) at the copies. Used by duplicate and paste. Duplicate also skips selected nodes whose
    ancestor is selected too, so a child isn't copied twice.
15. `sendFile` supports single byte ranges (`206`, `416`, `Accept-Ranges`) and no longer crashes the server if a read
    fails partway through.
16. The `class` and `data-gpsb` attribute values are escaped.
17. `restore` fires `page` when undo/redo switches pages.
18. Removing the Chrome profile retries (`maxRetries`) and can't crash `test/browser.js` any more (the same retry is
    used in `test/e2e.js`).
