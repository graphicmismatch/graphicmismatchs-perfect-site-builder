# Tweening

`gpsb/tween.js` animates values from code: move a panel in, fade a label, count a number up, chain steps into a
sequence. It works like DOTween or GSAP. Use it when the motion depends on what the visitor does or on data. For
motion you'd rather design on a timeline, use [Animation](animation.md) clips.

Tweens run in behaviours, extension `init` hooks and any script on the page. The [engine API](engine-api.md) exports
everything below too.

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

## Making a tween

```js
import { tween, sequence, Tween } from '../gpsb/tween.js';

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

## Settings

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

## Controlling a tween

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

## Sequences

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

## Shortcuts

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

## Good to know

- **Smooth movement.** While a tween moves `rect.pos`, the element is laid out once and moved with a CSS transform, as
  Animator clips do, so the page isn't re-laid out every frame.
- **Animators** write their clips' values every frame, on their own clock. Don't animate the same property with a
  clip and a tween at once: whichever writes last in a frame wins, and that can change from frame to frame.
- **Time:** tweens follow `Time.timeScale` (unless `.unscaled()`). A tab in the background pauses them, as browsers
  pause animation frames.
- **In the editor** tweens run only in Play mode, like behaviours.
- **Errors** in callbacks are logged as `[tween] onComplete: …` and don't stop the tween.
