# Making extension components

An **extension component** is a JavaScript file in `extensions/` that adds a new component type, written in the same
format as gpsb's built-in components (Image, Text, Button, …). Once it's loaded you can't tell it apart from a
built-in: it's in Add Component, it gets Inspector fields, it can be animated and overridden per breakpoint, and it
renders in the editor, the build and the published site.

The difference from [behaviours](behaviours.md) and [custom components](components.md) is that an extension's HTML and
CSS are **written into the page at build time**. Use one when the result should be in the static HTML (for search
engines, no-JS visitors and fast first paint), or when you need a new kind of building block:
- embeds and third-party widgets (maps, video players, comment threads, payment buttons),
- content loaded at runtime from an API or a JSON file,
- new form controls that work with event lists,
- new layout or visual components with their own CSS.

## Create one

- **From the Project panel:** + ▾ ▸ Extension Component. gpsb writes `extensions/<Name>.js` from a commented template.
- **By hand:** create `extensions/<Name>.js` in the project folder.

Then add it to an object with Add Component ▸ Extensions ▸ *Name*. The editor reloads the extension whenever the file
changes.

The name must be a valid JavaScript identifier (letters, digits and `_`, not starting with a digit) and must not be the
name of a built-in component. Like built-ins, an object can have one of each extension.

## A first extension

```js
// extensions/Countdown.js: shows the time left until a date, and ticks every second on the published page.
const left = until => {
  const s = Math.max(0, Math.floor((Date.parse(until) - Date.now()) / 1000));
  return `${Math.floor(s / 86400)}d ${Math.floor(s / 3600) % 24}h ${Math.floor(s / 60) % 60}m ${s % 60}s`;
};

export default ({ esc }) => ({
  category: 'Extensions',
  props: {
    until: { type: 'string', default: '2030-01-01T00:00:00Z', help: 'ISO date to count down to' },
    color: { type: 'color', default: '#202020' },
    size: { type: 'number', default: 32 },
  },
  style: p => ({ color: p.color, 'font-size': `${p.size}px`, 'font-variant-numeric': 'tabular-nums' }),
  inner: p => `<span class="countdown">${esc(left(p.until))}</span>`,
  patch: (el, p) => { const s = el.querySelector(':scope > .countdown'); if (s) s.textContent = left(p.until); },
  init({ el, GPSB }) {
    const node = GPSB.nodeFor(el);
    setInterval(() => GPSB.applyNode(node, undefined, el), 1000);
  },
});
```

What each part does:
- **`props`**: the [props schema](prop-types.md). Each becomes an Inspector field.
- **`style`**: CSS declarations for the object's element. They go into the page's stylesheet.
- **`inner`**: HTML written inside the element at build time. The editor shows it too.
- **`patch`**: brings an existing element up to date when props change, without a page rebuild. The runtime calls it
  after animation frames, breakpoint changes and `applyNode`.
- **`init`**: runs once per element on the published page (and in Play mode). Here it re-applies the node every second
  so `patch` shows the new time.

## The module

The default export is either a **definition object** or a **factory** that receives a small toolkit and returns one:

```js
export default { props: { … }, inner: p => … };          // a plain object
export default ({ esc, cssUrl }) => ({ props: { … } });  // or a factory
```

The factory form means the module needs no imports. The toolkit (`kit`) has:

| | |
|---|---|
| `esc(s)` | HTML-escapes a string for text or attribute values. **Escape every prop value you put into HTML.** |
| `cssUrl(u)` | Wraps a URL for CSS: `url("…")` with quotes escaped. |
| `fontFamily(v, ctx)` | Turns a font prop (CSS family, font asset or `$token`) into a `font-family` value. |
| `control(el)` | The native `<input>`, `<select>`, `<textarea>` or `<iframe>` directly inside `el`, if any. |
| `near(el, id)` | The element of node `id` nearest to `el` (inside a Repeat, the one in the same copy). |
| `findComp(node, type)` | The first component of `type` on a node. |

### The file runs in two places

The same file is imported **in Node** by the build and **in the browser** by the editor and published pages. So:
- Don't touch `window`, `document` or other browser APIs at the top level of the module, or in `style`, `attrs`,
  `inner`, `rules`, `head` or `tag`. Those run in Node during the build.
- Put browser work in `init`, `patch` and `state`, which only run in the browser.
- Don't import Node modules either: the file is published to the site as it is.

If the module fails to load, the build fails with the error rather than silently publishing pages with missing
content.

## Hooks

Every hook is optional. `p` is the component's props with defaults filled in, `{{bindings}}` resolved and design
tokens applied. `ctx` has `asset(path)` (an asset's published URL), `font(path)` and `href(link)` (a page name, URL or
`#anchor` as a URL).

| Hook | Runs | Returns / does |
|---|---|---|
| `category` | | Add Component group. Default `Extensions`. |
| `props` | | The props schema. |
| `tag(p)` | build, editor | The element's tag name (`'section'`, `'a'`). The first component that returns one wins; default `div`. |
| `style(p, ctx, node)` | build, editor, runtime | CSS declarations for the element, as `{ 'css-property': value }`. |
| `attrs(p, ctx)` | build, editor, runtime | Attributes for the element, as `{ name: value }`. Attributes you stop returning are removed. |
| `inner(p, ctx)` | build, editor | HTML placed inside the element, before the object's children. |
| `rules(p, sel, ctx, node)` | build, editor | Extra CSS text. `sel` is the element's selector: use it for `:hover`, `::before`, child selectors, keyframes. |
| `childStyle(p, child)` | build, editor | CSS declarations for each direct child (layout groups use this). Children of such a component are laid out by it rather than positioned by their RectTransform. |
| `head(p, ctx)` | build, editor | HTML (a string or an array of strings) for the page's `<head>`, e.g. a library's `<script>` and stylesheet. Identical entries are only added once per page. |
| `patch(el, p, ctx)` | editor, runtime | Update the element after a prop change. `inner` isn't re-run at runtime, so anything `inner` shows that can change needs `patch`. |
| `init({ el, GPSB, ci })` | published page, Play mode | Set up one element: fetch data, start a widget, add listeners. `ci` is the component's index on the node. |
| `state` | published page, Play mode | Makes the component a form control. See below. |

`style` and `attrs` are re-run at runtime by `applyNode`, so they must give the same result in Node and the browser.

### `inner` vs `patch` vs `init`

- `inner` is the static HTML. It's what search engines and visitors without JavaScript get, and what the editor shows.
- `patch` keeps that HTML in sync with props that animate or change at runtime. Update the elements `inner` created
  (find them with `el.querySelector(':scope > …')`) rather than replacing everything.
- `init` is for things that only make sense in a live page: timers, network requests, third-party libraries,
  listeners. It doesn't run while you edit.

### Changing props at runtime

In `init`, read and change the element's own props through its node data, then re-apply it:

```js
init({ el, GPSB, ci }) {
  const node = GPSB.nodeFor(el), p = node.components[ci].props;
  fetch(p.src).then(r => r.json()).then(d => {
    p.text = String(d.text ?? '');
    GPSB.applyNode(node, undefined, el);   // runs style, attrs and patch for this element
  });
}
```

Use `GPSB.nodeFor(el)` rather than `GPSB.node(id)`: inside a Repeat, each copy has its own data. See
[Runtime API](runtime-api.md).

## Example: a third-party widget

This map loads the [Leaflet](https://leafletjs.com) library from a CDN with `head`, shows a placeholder in the static
HTML and the editor, and creates the real map in `init`.

```js
// extensions/LeafletMap.js
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';

export default ({ esc }) => ({
  props: {
    lat: { type: 'number', default: 51.505 },
    lng: { type: 'number', default: -0.09 },
    zoom: { type: 'int', default: 13, min: 1, max: 19 },
    marker: { type: 'string', default: '', help: 'popup text for a marker at the centre (empty = no marker)' },
  },
  // added once to <head> on every page that has a map
  head: () => [
    `<link rel="stylesheet" href="${LEAFLET}.css">`,
    `<script src="${LEAFLET}.js"></script>`,
  ],
  // what the editor and visitors without JavaScript see
  inner: p => `<div class="map-placeholder">Map of ${esc(p.lat)}, ${esc(p.lng)}</div>`,
  init({ el, GPSB, ci }) {
    const p = GPSB.nodeFor(el).components[ci].props;
    el.replaceChildren();
    const map = L.map(el).setView([p.lat, p.lng], p.zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    if (p.marker) L.marker([p.lat, p.lng]).addTo(map).bindPopup(p.marker);
  },
});
```

The same approach works for most embed codes: put the vendor's `<script>` in `head`, and the element they ask you to
place in `inner` (with prop values escaped).

## Form controls: the `state` hook

A component with `state` takes part in forms and event lists like Slider or Dropdown: the value the visitor picks is
saved into the node data, and event entries with an empty argument receive it.

```js
// extensions/Rating.js: a row of stars the visitor can click.
export default ({ esc }) => ({
  props: {
    value: { type: 'int', default: 0, min: 0, max: 5 },
    max: { type: 'int', default: 5, min: 1, max: 10 },
    color: { type: 'color', default: '#f5a623' },
    onValueChanged: { type: 'event', default: [], on: 'gpsb:value' },
  },
  style: p => ({ color: p.color, 'font-size': '28px', cursor: 'pointer', 'user-select': 'none' }),
  attrs: p => ({ role: 'slider', 'aria-valuemin': 0, 'aria-valuemax': p.max, 'aria-valuenow': p.value }),
  inner: p => Array.from({ length: p.max }, (_, i) => `<span data-star="${i + 1}">${i < p.value ? '★' : '☆'}</span>`).join(''),
  patch(el, p) {
    el.querySelectorAll(':scope > [data-star]').forEach((s, i) => (s.textContent = i < p.value ? '★' : '☆'));
  },
  state: {
    prop: 'value',                           // where the value is saved in the node data
    events: ['gpsb:value'],                  // DOM events that mean "the value changed" (default: input, change)
    read: el => Number(el.dataset.value ?? 0),
  },
  init({ el, GPSB }) {
    el.addEventListener('click', e => {
      const star = e.target.closest('[data-star]');
      if (!star) return;
      el.dataset.value = star.dataset.star;
      el.dispatchEvent(new Event('gpsb:value'));
      GPSB.applyNode(GPSB.nodeFor(el), undefined, el);
    });
  },
});
```

`state` fields:

| | |
|---|---|
| `read(el, GPSB)` | Returns the current value from the element. |
| `prop` | The prop the value is written to when one of `events` fires. |
| `events` | DOM events on the element (or its native control) that signal a change. Default `['input', 'change']`. |
| `changed(el, GPSB)` | Optional: called after the value is saved. |

Components that wrap a native `<input>` or `<select>` can listen for `input` / `change` directly. Components without
a native control dispatch their own event on the element; `gpsb:value` is the convention.

## Event props

An `event` prop gives the component an event list in the Inspector (like Button ▸ On Click). Set `on` to the DOM event
that fires it; the default is `click`. The runtime listens on the element and runs every entry when the event fires.
With `on` set, only events dispatched on the element itself (or its native control) count, not ones bubbling up from
nested components.

## Tips

- **Escape prop values** with `esc` in `inner` and `head`, which are raw HTML. Values returned from `attrs` are
  escaped for you.
- **Asset props** hold paths: use `ctx.asset(p.image)` in `style`, `attrs`, `inner` and `patch`, and
  `GPSB.assets.url(path)` in `init`. Never build asset URLs by hand; they carry a version hash.
- **Links:** use `ctx.href(p.link)` for `href` props so page names, clean URLs and sub-path sites work.
- **Styling children:** `rules(p, sel)` can target elements you created in `inner`:
  `` rules: (p, sel) => `${sel} > .countdown { letter-spacing: 1px; }` ``.
- **Debugging:** errors in `init` are logged as `[Name] init: …` in the Console, and the rest of the page keeps
  working. Generated Code shows the HTML and CSS your hooks produce.

## How it's built

- **Build:** the extension is imported in Node (with a content-hash version), registered, used to render every page,
  and copied to `dist/extensions/<Name>.js`. Subfolders of `extensions/` are copied too, for helper modules.
- **Published page:** the page data lists the extensions the page uses. The runtime imports them before it applies or
  initialises anything, then calls `init`.
- **Editor:** extensions are imported from the project and re-imported when their file changes.

The built-in components in [`lib/components.js`](../lib/components.js) use exactly this format and are the best
reference for more complex cases: `ScrollRect` and `Scrollbar` (`init`, `near`), `Slider` and `Dropdown` (`state`),
`HorizontalLayoutGroup` (`childStyle`), `Button` (`rules`).
