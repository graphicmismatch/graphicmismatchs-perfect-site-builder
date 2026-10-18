# Engine API

`gpsb/engine.js` is a Unity-style scripting API for [behaviours](behaviours.md) and
[extension components](extensions.md). If you've written a MonoBehaviour, it should feel familiar:

```js
// behaviours/Spin.js
import { Behaviour, prop, Time } from '../gpsb/engine.js';

export default class Spin extends Behaviour {
  static props = { speed: prop.number(90, { help: 'degrees per second' }) };

  update() {
    this.rectTransform.rotation += this.speed * Time.deltaTime;
  }
  reverse() { this.speed = -this.speed; }      // behaviour:Spin.reverse in event lists
}
```

It's a thin layer over the [plain script format](behaviours.md#anatomy). Compared with a plain behaviour, you get:

- **Typed fields for props.** `this.speed` instead of `this.props.speed`. Vectors are `Vector2`s and colours are
  `Color`s, and an object field can give you the component you asked for.
- **Changes apply themselves.** Set `this.rectTransform.rotation` or a component field and the object updates at the
  end of the frame. You don't have to call `this.apply()`.
- **Unity's toolbox:** `Time`, `Mathf`, `Vector2`, `Color`, `Random`, `getComponent`, coroutines, and
  [tweens](tweening.md).
- **Types**, if you write [TypeScript](typescript.md).

Plain behaviours and extensions keep working unchanged, and you can mix both styles in one project.

## Behaviours

```js
import { Behaviour, prop, Time, Vector2, wait } from '../gpsb/engine.js';

export default class Patrol extends Behaviour {
  static props = {
    distance: prop.number(200),
    speed: prop.number(100, { min: 0, max: 500 }),
    label: prop.node({ component: 'Text' }),   // drop an object that has a Text
    onArrived: prop.event(),
  };

  start() {
    this.home = this.rectTransform.anchoredPosition;
    this.startCoroutine(this.loop);
  }

  *loop() {
    for (;;) {
      yield this.webObject.moveBy(new Vector2(this.distance, 0), this.distance / this.speed);
      if (this.label) this.label.text = 'Arrived';
      this.onArrived.invoke();
      yield wait(1);
      yield this.webObject.moveTo(this.home, this.distance / this.speed);
    }
  }
}
```

### Props

`static props` is the same [props schema](prop-types.md) plain behaviours export, and the `prop` helpers just build
its entries: `prop.number(90, { min: 0 })` is `{ type: 'number', default: 90, min: 0 }`.

| Helper | Field value |
|---|---|
| `prop.number(d, opts)`, `prop.int(d, opts)` | number |
| `prop.string(d)`, `prop.text(d, { rich })`, `prop.code(d, lang)`, `prop.href(d)` | string |
| `prop.bool(d)` | boolean |
| `prop.color(d)` | `Color` |
| `prop.vec2(d)`, `prop.vec4(d)` | `Vector2`, `Vector4` |
| `prop.enum(['a', 'b'], d)` | one of the options |
| `prop.asset(kind, d)` (`image`, `video`, `audio`, `json`, `font`, `text`, `anim`, `any`) | asset path: use `Assets.url(path)` |
| `prop.node()` | `WebObject` (or `null`) |
| `prop.node({ component: 'Text' })` | that component of the picked object (or `null`) |
| `prop.event()` | `WebEvent` |
| `prop.list(of, d)` | array |

Each prop becomes a field on the instance that reads and writes `this.props`. The Inspector, breakpoint overrides
and the Animator all use that same data, so animating `behaviour:Patrol.speed` changes `this.speed`.

- Assigning a `Vector2`, `Color` or `WebObject` stores it in the saved form (an array, a hex string, a node id).
- Vectors and colours are **immutable**: `this.offset = this.offset.add([10, 0])`, not `this.offset.x += 10`.
- **Don't declare a class field with a prop's name** (`speed = 1`). It would hide the prop. gpsb puts the prop back
  and warns in the Console. In TypeScript, write `declare speed: number`.
- Prop names can't be `el`, `node`, `props`, `GPSB`, `find`, `apply`, `setActive`, `animator`, `webObject`,
  `rectTransform`, `ci`, `ctx` or `type`.

### Lifecycle

The hooks are the [usual ones](behaviours.md#lifecycle): `start()`, `update(dt)`, `onClick(e)`, plus `lateUpdate(dt)`,
which runs after every `update`, coroutine and tween of the frame. Each frame runs in this order:

1. `update` of every behaviour
2. coroutines
3. tweens
4. `lateUpdate`
5. changed objects are re-applied, once each

### Members

| | |
|---|---|
| `this.webObject` | This object as a `WebObject` (below). |
| `this.rectTransform` | Its `RectTransform`. |
| `this.getComponent('Text')` | A component of this object, with typed fields (below). `getComponent('Text', 1)` is the second one. `getComponent(OtherBehaviour)` or `getComponent('behaviour:Other')` gives that behaviour's instance. |
| `this.getComponents('Image')` | All of them. |
| `this.findObject(path)` | A descendant (`'Panel/Icon'`), else any object by path or unique name. |
| `this.tween(path, to, seconds)` | [Tween](tweening.md) a property of this object. |
| `this.startCoroutine(gen)` | Run a coroutine (below). `stopCoroutine(c)`, `stopAllCoroutines()`. |
| `this.el`, `this.node`, `this.props`, `this.GPSB`, `this.apply()`, `this.find()`, `this.animator`, `this.setActive()` | As in [plain behaviours](behaviours.md#what-a-behaviour-can-use). |

## Objects

### WebObject

A node on the page, like Unity's GameObject. Inside a Repeat, a WebObject is pinned to one copy.

| | |
|---|---|
| `WebObject.find('Hero/Title')` | By path from the page root, or by a unique name. |
| `WebObject.of(nodeOrId)` | From node data or a node id. |
| `.id`, `.name`, `.active` | Setting `active` shows or hides it. Also `setActive(true \| false \| 'toggle')`. |
| `.rectTransform` | Its `RectTransform`. |
| `.getComponent(type, i)`, `.getComponents(type)` | Components with typed fields. |
| `.addComponent(type, props)` | Adds a built-in or extension component with its defaults. |
| `.parent`, `.children`, `.find(path)` | Navigation. |
| `.element`, `.elements` | Its HTML element(s). |
| `.apply()` | Re-apply now (otherwise it happens at the end of the frame). |
| `.changed()` | Mark it for re-applying after you changed `node` data yourself. |
| `.moveTo`, `.moveBy`, `.rotateTo`, `.scaleTo`, `.sizeTo`, `.fadeTo`, `.colorTo`, `.shake`, `.punchScale`, `.killTweens` | [Tween shortcuts](tweening.md#shortcuts). |

### RectTransform

| | |
|---|---|
| `anchoredPosition`, `sizeDelta`, `anchorMin`, `anchorMax`, `pivot`, `localScale` | `Vector2`. Assign a new one to change it. |
| `rotation`, `zIndex` | numbers (degrees, clockwise) |
| `getBoundingClientRect()` | The element's box on screen. |

### Components

`getComponent('Text')` returns the component with its props as fields. Converted values work the same way as for
behaviour props:

```js
const text = this.getComponent('Text');
text.text = 'Hello';
text.color = Color.red;
const img = WebObject.find('Logo').getComponent('Image');
img.color = img.color.withAlpha(0.5);
```

`.type`, `.props` (the raw values) and `.tween(prop, to, seconds)` are there too.

### Events

An `event` prop is a `WebEvent`:

```js
this.onArrived.invoke('east');              // runs the entries set up in the Inspector; empty arguments get 'east'
this.onArrived.addListener(arg => {});      // and listeners added in code
```

## Coroutines

A coroutine is a generator method. Each `yield` pauses it:

| `yield …` | Resumes |
|---|---|
| nothing / `null` | next frame |
| `wait(seconds)` | after that many seconds (scaled by `Time.timeScale`) |
| `waitRealtime(seconds)` | after that many real seconds |
| `waitUntil(() => cond)`, `waitWhile(() => cond)` | when the condition becomes true / false |
| a tween or sequence | when it completes or is killed |
| a promise | when it settles (`yield fetch(url)`) |
| another generator | when that coroutine finishes |

```js
start() { this.startCoroutine(this.blink, 3); }
*blink(times) {
  for (let i = 0; i < times; i++) {
    this.webObject.active = false; yield wait(0.2);
    this.webObject.active = true;  yield wait(0.2);
  }
}
```

`startCoroutine` runs the generator up to its first `yield` straight away and returns a `Coroutine`. Its `.stop()`
stops it, and `await coroutine` waits for it (`true` when it finished, `false` when stopped). Generator methods appear
in event lists like any method, but calling one from an event does nothing; start them from code.

## Value types and helpers

| | |
|---|---|
| `Time` | `deltaTime`, `unscaledDeltaTime`, `time`, `unscaledTime`, `frameCount`, `timeScale` (0 pauses behaviours, coroutines and tweens; Animators keep their own time). |
| `Vector2` | `new Vector2(x, y)`, `Vector2.from([x, y])`, `add`, `sub`, `mul` (scalar or per axis), `div`, `neg`, `dot`, `magnitude`, `normalized`, `withX`, `withY`, `equals`, `toArray`; static `lerp`, `lerpUnclamped`, `distance`, `moveTowards`, `angle`, `zero`, `one`, `up`, `down`, `left`, `right`. **The y axis points down**, as on the web, so `Vector2.up` is `(0, -1)`. |
| `Vector4` | `x y z w`, `add`, `sub`, `mul`, `lerp`. |
| `Color` | Channels `r g b a` from 0 to 1. `Color.parse('#ff3366')`, `Color.rgba(1, 0, 0, 0.5)`, `Color.rgb255(…)`, `Color.token('brand')`, `withAlpha`, `toHex`, `lerp`, and `white`, `black`, `clear`, `red`, … It converts to `'#rrggbb(aa)'` wherever a string is expected. A value that isn't a hex colour (a `$token`) is kept as-is; `valid` is `false` for it. |
| `Mathf` | `clamp`, `clamp01`, `lerp`, `lerpUnclamped`, `inverseLerp`, `repeat`, `pingPong`, `deltaAngle`, `lerpAngle`, `moveTowards`, `moveTowardsAngle`, `smoothStep`, `smoothDamp(current, target, state, smoothTime)` (keep `state` between calls), `approximately`, `Deg2Rad`, `Rad2Deg`. |
| `Random` | `value`, `range(min, max)`, `int(min, max)` (max exclusive), `pick(list)`, `insideUnitCircle`, `onUnitCircle`. |
| `Assets` | `url(path)` (the published URL of an asset prop), `json(path)`, `text(path)`. |

## Extensions as classes

An extension can be written as a class and exported with `defineExtension`. Props are fields on `this` in every hook:

```js
// extensions/Badge.js
import { Extension, defineExtension, prop, html } from '../gpsb/engine.js';

class Badge extends Extension {
  static props = { label: prop.string('New'), color: prop.color('#3366ff'), clicks: prop.int(0) };

  style() { return { color: this.color, 'font-weight': 700 }; }
  inner() { return html`<span class="badge-text">${this.label}</span>`; }
  patch(el) { el.querySelector(':scope > .badge-text').textContent = `${this.label} ${this.clicks || ''}`; }
  init(el) { el.addEventListener('click', () => this.clicks++); }   // a prop field change re-applies the element
}

export default defineExtension(Badge);
```

| Method | Hook | Notes |
|---|---|---|
| `tag()` | `tag` | |
| `style(ctx, node)` | `style` | Return CSS declarations. `Color` and `Vector2` values become strings. |
| `attrs(ctx)` | `attrs` | |
| `inner(ctx)` | `inner` | Return a string or `html`…``. |
| `rules(selector, ctx, node)` | `rules` | |
| `childStyle(child)` | `childStyle` | |
| `head(ctx)` | `head` | A string, `html`…`` or an array of them. |
| `patch(el, ctx)` | `patch` | |
| `init(el)` | `init` | `this.el`, `this.node`, `this.ci`, `this.GPSB` and `this.webObject` are set. Setting a prop field writes the element's node data and re-applies it. |

Static `props`, `category`, `state` and `last` map to the definition fields of the same name. Only the methods the
class has become hooks.

- **`html`…``** escapes every `${value}`. `raw(s)` and nested `html` pass through, and arrays are joined. Use it in
  `inner` and `head` instead of calling `esc` yourself.
- **Node props** are node ids in the build-time hooks, and `WebObject`s in `init`.
- `tag`, `style`, `attrs`, `inner`, `rules`, `childStyle` and `head` **run in Node** during the build. Keep `window`,
  `document` and other browser APIs inside `patch` and `init`. Importing `../gpsb/engine.js` is fine: it's safe to
  load in Node, and the build resolves it to gpsb's own copy.

## Using it from other scripts

Any module on the page can import `gpsb/engine.js` (from the site root: `./gpsb/engine.js`) once the runtime has
started, for example in a script in Project Settings ▸ Custom Code:

```html
<script type="module">
  import { WebObject, Color } from './gpsb/engine.js';
  addEventListener('gpsb:ready', () => WebObject.find('Title').colorTo(Color.red, 0.5));
</script>
```
