# Prop types

Behaviours, custom components and extension components all describe their settings with the same **props schema**:
an object mapping each prop name to its type, default value and options. The Inspector draws a field for each one, and
every prop can be animated and overridden per breakpoint.

```js
{
  speed:   { type: 'number', default: 90, min: 0, max: 720, help: 'degrees per second' },
  label:   { type: 'string', default: 'Hello' },
  mode:    { type: 'enum', options: ['fade', 'slide'], default: 'fade' },
  target:  { type: 'node', default: '' },
  onDone:  { type: 'event', default: [] },
}
```

Every entry needs `type` and `default`. Optional on all types:
- `help`: tooltip text in the Inspector.
- `labels`: field labels for a `vec2` or `vec4` (e.g. `['Left', 'Right', 'Top', 'Bottom']`).

The Inspector labels each field from its prop name (`maxWidth` shows as "Max Width").

## Types

| type | Value | Inspector field | Options |
|---|---|---|---|
| `number` | number | number field with a draggable label | `min`, `max`, `step`; with both `min` and `max` it's a slider |
| `int` | whole number | same, rounded | `min`, `max`, `step` |
| `string` | string | one-line text | `asset: 'font'` also accepts a font file; `tokens: 'textStyles'` shows a text-style picker |
| `text` | string, HTML allowed | multi-line text | |
| `code` | string | monospace editor | `lang`: `html`, `css` or `js` |
| `bool` | `true` / `false` | checkbox | |
| `color` | `#rrggbb` or `#rrggbbaa`, or a colour token `$name` | colour swatch with alpha | |
| `enum` | one of `options` | dropdown | `options: [...]` (required) |
| `vec2`, `vec4` | array of 2 or 4 numbers | X Y (Z W) fields | `labels` |
| `asset:image`, `asset:video`, `asset:audio`, `asset:json`, `asset:font`, `asset:text`, `asset:any` | path inside `assets/` | asset field: drop target and picker | |
| `asset:anim` | animation clip name | clip picker | |
| `href` | page name, URL or `#anchor` | text with a page list | |
| `node` | node id (`''` = none) | object field: drop a Hierarchy object | |
| `event` | `[{ target, call, arg }]` | event list (like a UnityEvent) | `on`: the DOM event that fires it (default `click`) |
| `list` | array | reorderable list | `of`: the item type, e.g. `{ type: 'list', of: 'asset:image', default: [] }` |

## Values in your code

How a prop's value reaches your code depends on where it's used:

| | Behaviour (`this.props`) | Custom component (`this.props`) | Extension (`p` in hooks) |
|---|---|---|---|
| asset props | the asset path; turn it into a URL with `this.GPSB.assets.url(p)` | already a URL | the path; use `ctx.asset(p)` |
| `node` | node id; look it up with `this.GPSB.node(id)` | node id | node id |
| `href` | as typed; use `this.GPSB.ctx.href(h)` | as typed | as typed; use `ctx.href(h)` |
| `{{bindings}}` in strings | resolved | resolved | resolved |

## Event props

An `event` prop gives your component its own event list, which page authors fill in like a Button's On Click.

- On an **extension** or **custom component**, the runtime listens for the DOM event named by `on` on the element
  and runs the entries. A custom component can fire it with `this.emit('<on>', detail)`.
- In a **behaviour**, event props aren't wired automatically. Run the entries yourself:

  ```js
  for (const e of this.props.onDone) this.GPSB.invoke(e.target, e.call, e.arg, this.node.id);
  ```

For form-like extensions, entries with an empty argument receive the current value (see the `state` hook in
[Making extension components](extensions.md#form-controls-the-state-hook)).
