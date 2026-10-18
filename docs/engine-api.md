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
  [tweens](#tweening).
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
| `this.tween(path, to, seconds)` | [Tween](#tweening) a property of this object. |
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
| `.moveTo`, `.moveBy`, `.rotateTo`, `.scaleTo`, `.sizeTo`, `.fadeTo`, `.colorTo`, `.shake`, `.punchScale`, `.killTweens` | [Tween shortcuts](#shortcuts). |

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

## Tweening

Tweens animate values from code: move a panel in, fade a label, count a number up, chain steps into a sequence. They
work like DOTween or GSAP. Use them when the motion depends on what the visitor does or on data. For motion you'd
rather design on a timeline, use [Animation](animation.md) clips.

Tweens run on the same frame loop as behaviours and coroutines, so they follow `Time.timeScale`. You can use them in
behaviours, in extension `init` hooks and in any script on the page.

```js
import { Behaviour } from '../gpsb/engine.js';

export default class Drawer extends Behaviour {
  open() {
    this.tween('rect.pos', [0, 0], 0.4).ease('outBack');                  // slide in
    this.findObject('Shade').fadeTo(0.6, 0.3);                           // and darken the page
  }
  close() { this.webObject.moveTo([-320, 0], 0.25).ease('inQuad'); }
}
```

### Making a tween

```js
import { tween, sequence, Tween } from '../gpsb/engine.js';

tween(target, 'rect.rotation', 360, 1);                    // one property: target, path, end value, seconds
tween(target, { 'rect.pos': [0, 40], 'CanvasGroup.alpha': 0 }, 0.5);   // several at once
Tween.value(0, 100, 2, v => (label.text = Math.round(v) + '%'));       // any value, through a setter
Tween.delay(1.5, () => console.log('later'));              // a timer
```

**What `target` can be:**

| Target | Paths |
|---|---|
| A node (`this.node`, `GPSB.find('Hero')`), a `WebObject`, or a node id or path (`'Hero/Title'`) | [Property paths](animation.md), the same ones the Inspector and Animation window use: `rect.pos`, `rect.pos.x`, `rect.size`, `rect.rotation`, `rect.scale`, `active`, `Image.color`, `Text.size`, `CanvasGroup.alpha`, `behaviour:Spin.speed`, `component:Card.title`, `MyExtension.value`. Changes are applied to the page once per frame. |
| Any other object | Field names, dotted for nested ones: `tween(state, 'camera.zoom', 2, 1)`. |

**Values:** numbers, arrays of numbers (vectors), `#rrggbb(aa)` colours, and the engine's `Vector2`, `Vector4` and
`Color` are interpolated. Anything else (strings, booleans, assets) switches at the end.

A tween starts at the property's value **when it starts playing** (after its delay) and plays on its own; you don't
have to start it.

### Settings

Every setting returns the tween, so they chain:

```js
tween(card, 'rect.scale', [1.1, 1.1], 0.3)
  .ease('outBack')
  .delay(0.2)
  .loops(-1, 'yoyo')
  .onComplete(() => console.log('done'));
```

| | |
|---|---|
| `.ease(e)` | A name (below), a CSS name (`'ease-in-out'`), a cubic-bezier `[x1, y1, x2, y2]`, or a function `u => eased u`. Default `outQuad`. |
| `.delay(seconds)` | Wait before starting. |
| `.loops(n, type)` | Play `n` times (`-1` = forever). `type`: `'restart'` (default), `'yoyo'` (back and forth) or `'incremental'` (each loop continues from the last end: `tween(x, 'rect.rotation', 90, 0.5).relative().loops(-1, 'incremental')` keeps turning). |
| `.from(value)` | Start from this value instead of the current one. It's set as soon as the tween is created, even during a delay, so an object can appear from an offset without flashing in its final place first. With several properties, pass `{ path: value }`. |
| `.relative()` | The end value is an offset from the start: `tween(n, 'rect.pos', [100, 0], 1).relative()` moves 100 px right. |
| `.speed(k)` | Play faster (2) or slower (0.5). |
| `.unscaled()` | Ignore `Time.timeScale`, e.g. for a pause menu that animates while the game is paused. |
| `.onStart(fn)`, `.onUpdate(fn)`, `.onStepComplete(fn)` (after each loop), `.onComplete(fn)`, `.onKill(fn)` | Callbacks. |

**Eases:** `linear`, and `in…`, `out…` and `inOut…` for `Sine`, `Quad`, `Cubic`, `Quart`, `Quint`, `Expo`, `Circ`,
`Back` (overshoots), `Elastic` and `Bounce`, as in `outBack` or `inOutSine`. They're all on `Ease` if you want to call
one yourself: `Ease.outBounce(0.5)`.

### Controlling a tween

| | |
|---|---|
| `.pause()`, `.play()`, `.togglePause()` | |
| `.restart()` | From the beginning. |
| `.goto(seconds)` | Jump to a time (delay included). |
| `.complete()` | Jump to the end and fire `onComplete`. |
| `.kill(complete = false)` | Stop for good. With `true`, jump to the end first. |
| `.isPlaying`, `.isComplete`, `.isActive`, `.progress` (0 to 1), `.elapsed`, `.duration`, `.totalDuration` | State. |
| `await tween` | Waits until it ends: `true` if it completed, `false` if it was killed. |

```js
async play() {
  await this.webObject.moveTo([0, 0], 0.4);
  await this.webObject.punchScale(0.2, 0.3);
  this.onShown.invoke();
}
```

Across the page:

| | |
|---|---|
| `Tween.of(target)` | Every active tween animating that node, object or id. |
| `Tween.killOf(target, complete?)`, `Tween.isTweening(target)` | |
| `Tween.killAll(complete?)`, `Tween.pauseAll()`, `Tween.playing` | |

Starting a second tween on a property that's already tweening doesn't stop the first; the one that runs later in the
frame wins. To replace one, kill the old one first: `Tween.killOf(this.webObject)`.

### Sequences

A sequence puts tweens on one timeline. Tweens you add to it no longer play on their own; the sequence plays them.

```js
sequence()
  .append(title.moveBy([0, -20], 0.3))         // after everything so far
  .join(title.fadeTo(1, 0.3))                  // at the same time as the last append
  .appendInterval(0.2)                         // a pause
  .append(button.scaleTo(1, 0.25).ease('outBack'))
  .insert(0, logo.rotateTo(360, 1))            // at an absolute time
  .appendCallback(() => console.log('intro done'))
  .loops(2, 'yoyo');
```

A sequence has the same settings, controls and callbacks as a tween, and you can nest one inside another. A tween
inside a sequence can't loop forever (it plays once, with a warning).

### Shortcuts

`WebObject` (`this.webObject`, `WebObject.find(...)`) has shortcuts for the common cases. Each returns the tween:

| | |
|---|---|
| `moveTo(pos, s)`, `moveBy(offset, s)` | `rect.pos` |
| `rotateTo(degrees, s)` | `rect.rotation` |
| `scaleTo(scale, s)` | `rect.scale` (a number scales both axes) |
| `sizeTo(size, s)` | `rect.size` |
| `fadeTo(alpha, s)` | `CanvasGroup.alpha` (adds a CanvasGroup if the object has none) |
| `colorTo(color, s)` | `Image.color`, or `Text.color` if there's no Image |
| `shake(strength = 10, s = 0.5, vibrato = 10)` | Shakes the position and settles back. |
| `punchScale(amount = 0.2, s = 0.4, vibrato = 6)` | Bounces the scale and settles back. |
| `killTweens(complete?)` | Kills this object's tweens. |

A component from `getComponent` has `.tween(prop, to, s)` too: `this.getComponent('Text').tween('size', 48, 0.3)`.

### Good to know

- **Smooth movement.** While a tween moves `rect.pos`, the element is laid out once and moved with a CSS transform, as
  Animator clips do, so the page isn't re-laid out every frame.
- **Animators** write their clips' values every frame, on their own clock. Don't animate the same property with a
  clip and a tween at once: whichever writes last in a frame wins, and that can change from frame to frame.
- **Time:** tweens follow `Time.timeScale` (unless `.unscaled()`). A tab in the background pauses them, as browsers
  pause animation frames.
- **In the editor** tweens run only in Play mode, like behaviours.
- **Errors** in callbacks are logged as `[tween] onComplete: …` and don't stop the tween.

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
