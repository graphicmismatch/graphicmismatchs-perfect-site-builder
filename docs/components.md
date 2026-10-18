# Making custom components

A **custom component** is one HTML file in `components/` that becomes a native
[Web Component](https://developer.mozilla.org/docs/Web/API/Web_components): a custom element with its own markup and
CSS in a Shadow DOM, and optional JavaScript. Its props appear in the Inspector, and page authors can place it like
any other object.

Use one for a self-contained widget with its own look: a card, a counter, a tab strip, a pricing table. The Shadow DOM
keeps its CSS from leaking into the page and the page's CSS from leaking in.

> Custom components are rendered in the browser. Search engines that don't run JavaScript won't see what's inside the
> shadow root. Text you put in the object's **children** (slotted content) is in the page HTML. If the content itself
> must be in the static HTML, write an [extension component](extensions.md) instead.

## Create one

- **From the Inspector:** Add Component ▸ New Component, then type a name. gpsb creates `components/<Name>.html` from
  a template and attaches it to the selected object.
- **From the Project panel:** + ▾ ▸ Component. Place it with WebObject ▸ *Name*, Add Component ▸ Custom Components ▸ *Name*, or
  by dragging it onto the Inspector.
- **By hand:** create `components/<Name>.html` in the project folder.

The file name is the component's name and must start with a letter. The element's tag is `gpsb-<name>` in kebab case
(`PriceCard.html` → `<gpsb-price-card>`).

## The file

A component file has up to four parts, all optional except the template:

```html
<!-- components/Badge.html -->
<template>
  <button class="badge"><span class="dot" style="background: {{color}}"></span>{{label}}</button>
</template>

<style>
  :host { display: inline-block; }
  .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 0; border-radius: 999px;
           background: var(--bg, #eef); color: #223; font: 600 14px system-ui, sans-serif; cursor: pointer; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  :host([on="true"]) .badge { --bg: #dfd; }
</style>

<script type="application/json" props>
{
  "label": { "type": "string", "default": "New" },
  "color": { "type": "color", "default": "#33cc66" },
  "on": { "type": "bool", "default": false },
  "onToggled": { "type": "event", "default": [], "on": "toggled" }
}
</script>

<script>
  import { Component } from '../gpsb/component.js';
  export default class extends Component {
    rendered() {
      this.$('.badge').onclick = () => {
        const on = !this.props.on;
        this.setAttribute('on', on);
        this.emit('toggled', on);
      };
    }
  }
</script>
```

### `<template>`

The component's markup, rendered into its shadow root.
- `{{prop}}` inserts a prop value, HTML-escaped, in text and in attribute values.
- `{{{prop}}}` inserts it without escaping, for props that hold HTML (`text` props).
- `<slot></slot>` is where the object's **children** from the Hierarchy go.

### `<style>`

CSS scoped to the component. It can't see the page's styles, and the page can't see it.
- `:host` is the component element itself. It defaults to `display: block`.
- The element is sized and positioned by its RectTransform. To fill it, give your top element
  `width: 100%; height: 100%; box-sizing: border-box`.
- `{{prop}}` doesn't work inside `<style>`. Put prop-driven values in the template (a `style` attribute or a CSS
  variable, e.g. `<div style="--accent: {{color}}">`), or style on an attribute with `:host([on="true"])`.
- CSS custom properties do pass through the shadow boundary, so design tokens work:
  `color: var(--gpsb-color-brand)`.

### `<script type="application/json" props>`

The [props schema](prop-types.md), as JSON. Each prop becomes an Inspector field and an attribute on the element.

### `<script>`

Optional behaviour. Export a class that extends `Component`:

```js
import { Component } from '../gpsb/component.js';
export default class extends Component {
  rendered() { /* the shadow root was (re)built: attach listeners here */ }
}
```

Leave it out for a purely visual component.

## The Component class

| | |
|---|---|
| `this.props` | Prop values, typed from the schema (numbers are numbers, `vec2` is an array, …). Asset props are already URLs. |
| `this.root` | The shadow root. |
| `this.$(selector)`, `this.$$(selector)` | `querySelector` / `querySelectorAll` (as an array) inside the shadow root. |
| `this.emit(name, detail)` | Dispatches a `CustomEvent` that bubbles out of the shadow root. |
| `this.refresh()` | Re-renders now. |

Hooks to override:

| | |
|---|---|
| `rendered()` | After every render. The shadow root's content is new, so attach event listeners here. |
| `connected()`, `disconnected()` | When the element is added to or removed from the page. Start and stop timers and observers here. |
| `propChanged(name, value)` | Before a re-render caused by a prop change, with the new value. |
| `render()` | Returns the HTML for the shadow root. The default fills in the template. Override it for markup the template can't express: |

```js
render() {
  return `<ul>${this.props.items.map(i => `<li>${i}</li>`).join('')}</ul>`;
}
```

### Re-rendering and state

The element re-renders whenever one of its props (attributes) changes: from the Inspector while you edit, from an
animation, a breakpoint or a script. Re-rendering replaces the shadow root's content, so:
- attach listeners in `rendered()`, not once in the constructor;
- keep state in fields on `this` and restore it in `rendered()`.

The demo's `components/Counter.html` shows the pattern:

```js
export default class Counter extends Component {
  count = null;
  rendered() {
    this.count ??= this.props.start;
    this.$('.inc').onclick = () => this.add(this.props.step);
    this.$('.dec').onclick = () => this.add(-this.props.step);
    this.show();
  }
  propChanged(name, v) { if (name === 'start') this.count = v; }
  add(n) { this.count += n; this.show(); this.emit('change', this.count); }
  show() { this.$('.value').textContent = this.count; }
}
```

## Events

Give the component an `event` prop and set `on` to the name of the event your code emits:

```json
"onToggled": { "type": "event", "default": [], "on": "toggled" }
```

The Inspector shows an **On Toggled ()** list, which page authors fill in like a Button's On Click. When the component
calls `this.emit('toggled', …)`, every entry runs. Without `on`, an event prop fires on `click`.

## In the editor

Unlike behaviours, custom components run **in the editor too**, so they look the same while you design the page as
on the published site. Keep side effects that should only happen for visitors (analytics, sounds, autoplay) behind
a check. The page data says whether the page is being edited:

```js
const EDITING = JSON.parse(document.getElementById('gpsb-data')?.textContent || '{}').editor === true;

export default class extends Component {
  connected() { if (!EDITING) this.startTimer(); }
  // ...
}
```

In the editor's Play mode, `EDITING` is `false`, as on the published site.

Editing the file reloads the component in the editor.

## How it's built

The build compiles `components/Badge.html` into `components/Badge.js` (which defines the element) and
`components/Badge.script.js` (your script, unchanged). A page that uses the component loads it with a
`<script type="module">` tag. The object is written as:

```html
<gpsb-badge class="badge" data-gpsb="k3j9x" label="Beta" color="#33cc66" on="false" on-toggled="[…]">
  …children…
</gpsb-badge>
```

Props become kebab-case attributes, asset props become URLs, and non-string values are JSON-encoded.

## More examples

The demo project's `components/` folder has:
- `Card.html`: image, title and slotted content.
- `Counter.html`: internal state, buttons, and a `change` event.
- `Stat.html`: a number that counts up the first time it scrolls into view (`IntersectionObserver` in `connected()`).
