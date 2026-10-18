# Runtime API (`window.GPSB`)

Every built page loads a small runtime, `gpsb/runtime.js`. It positions the page, applies breakpoints, starts
Animators and behaviours, and exposes `window.GPSB`. Behaviours get it as `this.GPSB`, extension `init` hooks get it as
an argument, and any other script on the page can use `window.GPSB` once `gpsb:ready` has fired:

```js
addEventListener('gpsb:ready', () => {
  const title = GPSB.find('Hero/Title');
  title.components.find(c => c.type === 'Text').props.text = 'Hello from a script';
  GPSB.applyNode(title);
});
```

Put such a script in Project Settings ▸ Custom Code (end of body), Page Meta ▸ Head, or an HTML component.

For a Unity-style API on top of this one (wrappers that apply their own changes, `Vector2`, coroutines, tweens), see
the [engine API](engine-api.md), which includes [tweening](engine-api.md#tweening).

## How runtime changes work

The page keeps its node tree (the same data the editor saves, with defaults filled in) in memory. To change something
on the page:

1. **Change the node data** in place: `node.rect.pos`, `node.active`, `node.components[i].props.<field>`.
2. **Call `GPSB.applyNode(node)`** to update the element(s) from it.

`applyNode` recomputes the element's style, attributes and content (including breakpoint overrides) and only touches
what changed, so it's cheap enough to call every frame. It never changes the data itself.

Inside a Repeat, every copy shares one node id. `GPSB.nodeFor(el)` gives the data of one particular copy, so you can
change copies independently: `GPSB.applyNode(GPSB.nodeFor(el), undefined, el)`.

## Reference

### Finding things

| | |
|---|---|
| `GPSB.node(id)` | Node data by id. |
| `GPSB.parent(id)` | The parent's node data. |
| `GPSB.find(path, from?)` | Node by path of names (`'Header/Logo'`), from the root or from `from`. A bare name also matches anywhere in the tree. |
| `GPSB.el(id)` | The first element of a node. |
| `GPSB.els(id)` | All elements of a node (Repeat copies share an id). |
| `GPSB.nodeFor(el)` | The node data for one element (a per-copy clone inside a Repeat, with `{{item}}` filled in). |
| `GPSB.canvas` | The root element (class `gpsb-canvas`). |

Every element also has `data-gpsb="<node id>"` and a CSS class made from its object name, so
`document.querySelector('.hero-title')` works too.

### Changing things

| | |
|---|---|
| `GPSB.applyNode(node, parent?, els?)` | Re-applies node data to its elements (default: all of them). |
| `GPSB.setActive(id, on)` | Shows or hides a node. `on` is `true`, `false` or `'toggle'`. |
| `GPSB.preload(url)` | Loads and decodes an image ahead of time, so swapping to it never flashes. |

### Events, behaviours, animation

| | |
|---|---|
| `GPSB.invoke(target, call, arg?, sourceId?)` | Runs one event call, exactly as an event list entry would: `GPSB.invoke('menu', 'setActive', 'toggle')`, `GPSB.invoke('hero', 'Animator.play', 'Intro')`, `GPSB.invoke('logo', 'behaviour:Spin.reverse')`. `target` is a node id or path. |
| `GPSB.behaviour(id, Name)` | The instance of behaviour `Name` on node `id`, to call its methods directly. |
| `GPSB.animator(id, el?)` | The Animator controller of a node: `play(clip?)`, `stop()`, `pause()`, `resume()`, `seek(t)`, and `playing`, `time`, `clip`, `speed`. |

### Data and assets

| | |
|---|---|
| `GPSB.assets.url(path)` | The published URL of an asset (`'img/logo.svg'` → `'assets/img/logo.svg?v=…'`). Always use this rather than building asset URLs yourself. |
| `GPSB.assets.json(path)` | Fetches and parses a JSON asset. |
| `GPSB.assets.text(path)` | Fetches a text asset. |
| `GPSB.ctx.href(h)` | The URL for a page name, link or `#anchor`, as Links use. |
| `GPSB.data` | The page data (`tree`, `clips`, `pages`, …). |

### Page state

| | |
|---|---|
| `GPSB.breakpoints()` | Names of the breakpoints active at the current window width. |
| `GPSB.effective(node)` | The node with the active breakpoint overrides applied. |
| `GPSB.scale` | The Canvas Scaler's current scale (1 in constant mode). |
| `GPSB.editor` | `true` inside the editor's edit-mode preview, where scripts don't run. |

## Node data

```json
{ "id": "a1b2c3", "name": "Hero Title", "active": true,
  "rect": { "anchorMin": [0.5, 0], "anchorMax": [0.5, 0], "pivot": [0.5, 0],
            "pos": [0, 120], "size": [600, 80], "rotation": 0, "scale": [1, 1], "zIndex": 0 },
  "components": [ { "type": "Text", "props": { "text": "Hi", "size": 48 } } ],
  "children": [] }
```

Component types are built-in names (`Text`), `component:<Name>` for custom components, `behaviour:<Name>` for
behaviours, and the file name for extensions. The full format is in [CONTRACT.md](../CONTRACT.md#node).

## Property paths

Animation tracks, breakpoint overrides and `setProp` in `lib/node.js` address fields with property paths:
`rect.pos.x`, `rect.size`, `active`, `Text.text`, `Image.color`, `component:Card.title`, `behaviour:Spin.speed`,
`Countdown.until`. `<Type>[n].<field>` picks the n-th component of a type (0-based), for nodes with several.
