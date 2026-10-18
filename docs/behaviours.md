# Making behaviours

A **behaviour** is a script you attach to an object, like a MonoBehaviour in Unity. It has props that show up in the
Inspector, lifecycle hooks (`start`, `update`, `onClick`) and methods that buttons, other events and animation events
can call.

Behaviours run in the browser: on the published page and in the editor's Play mode. They work by changing the
object's node data and re-applying it, so they don't need to know how the page's HTML is put together.

Use a behaviour for motion, reacting to input, and driving other objects. If you want to add new HTML to the page, see
[custom components](components.md) or [extension components](extensions.md) instead.

> **Two styles.** This page describes the plain format: a class with injected fields and `this.apply()`. The
> [engine API](engine-api.md) builds on it in Unity's style: `extends Behaviour`, typed prop fields, `getComponent`,
> coroutines, [tweens](engine-api.md#tweening), and changes that apply themselves. Both styles can be mixed, and both work in
> [TypeScript](typescript.md) (`behaviours/<Name>.ts`).

## Create one

- **From the Inspector:** select an object ▸ Add Component ▸ New Script. Type a name. gpsb creates
  `behaviours/<Name>.js` from a template and attaches it.
- **From the Project panel:** + ▾ ▸ Behaviour Script, then attach it with Add Component ▸ Scripts ▸ *Name* or drag it
  onto the Inspector.
- **By hand:** create `behaviours/<Name>.js` in the project folder. The editor picks it up.

The file name is the behaviour's name. Double-click it in the Project panel to edit it in the built-in editor, or use
your own editor: gpsb reloads it when the file changes.

## Anatomy

```js
// behaviours/Bob.js: moves the node up and down on a sine wave.
export const props = {
  height: { type: 'number', default: 12, help: 'pixels above and below the start position' },
  speed: { type: 'number', default: 1, help: 'cycles per second' },
};

export default class Bob {
  start() {
    this.baseY = this.node.rect.pos[1];
    this.t = 0;
    this.running = true;
  }
  update(dt) {
    if (!this.running) return;
    this.t += dt;
    this.node.rect.pos[1] = this.baseY + Math.sin(this.t * this.props.speed * Math.PI * 2) * this.props.height;
    this.apply();
  }
  // callable from events as behaviour:Bob.toggle
  toggle() { this.running = !this.running; }
}
```

- **`export const props`** is the [props schema](prop-types.md). Each prop becomes an Inspector field, and its value is
  in `this.props` with defaults filled in.
- **`export default class`** is the behaviour. gpsb creates one instance per element.

## Lifecycle

| Hook | When |
|---|---|
| `constructor()` | When the instance is created. The injected fields below are **not** set yet, so do set-up in `start`. |
| `start()` | Once, after every behaviour on the page has been created. It may be `async`. |
| `update(dt)` | Every animation frame. `dt` is the time since the last frame in seconds (at most 0.1), scaled by `Time.timeScale` from the [engine API](engine-api.md#value-types-and-helpers). |
| `lateUpdate(dt)` | Every frame, after every behaviour's `update` and after coroutines and tweens. |
| `onClick(e)` | When the element is clicked. |
| any other method | Whenever an event calls it (see below). |

All hooks are optional. If `update` or `lateUpdate` throws, that instance's per-frame hooks are turned off and the
error is logged to the Console; other behaviours keep running.

## What a behaviour can use

These are set on the instance before `start()`:

| | |
|---|---|
| `this.el` | The object's HTML element. |
| `this.node` | The object's node data: `name`, `active`, `rect` (`pos`, `size`, `anchorMin`, `anchorMax`, `pivot`, `rotation`, `scale`), `components`, `children`. |
| `this.props` | This behaviour's prop values. It's the same object the animator writes to, so animating `behaviour:Bob.height` changes `this.props.height`. |
| `this.apply()` | Re-applies `this.node` to `this.el`. Call it after you change the node. |
| `this.find(path)` | Finds a node inside this object by path (`'Label'`, `'Panel/Icon'`) or by name. For the whole page, use `this.GPSB.find(path)`. |
| `this.setActive(on)` | Shows or hides this object. |
| `this.animator` | The controller of the nearest Animator on this object or its parents (or `null`): `play(clip?)`, `stop()`, `pause()`, `resume()`, `seek(t)`. |
| `this.GPSB` | The whole [runtime API](runtime-api.md). |

## Changing the page

The pattern is always: **change node data, then apply it**.

```js
this.node.rect.rotation += 90 * dt;     // RectTransform fields
this.node.rect.size = [200, 50];
this.apply();

const text = this.node.components.find(c => c.type === 'Text');
text.props.text = 'Done!';               // any component field
text.props.color = '#ff3366';
this.apply();
```

To change **another** object, get its node and apply that:

```js
const title = this.GPSB.find('Hero/Title');   // a path from the page root, or just a unique name
title.components.find(c => c.type === 'Text').props.text = 'Hello';
this.GPSB.applyNode(title);
```

`apply` updates styles, attributes and inner content (text, images) the same way the build would, with breakpoint
overrides applied, and only changes what's different. It's fine to call it every frame.

You can also use `this.el` directly for things gpsb doesn't model (focus, measuring, adding a class). Changes you make
to the element itself can be overwritten the next time the node is applied.

## Calling behaviour methods from events

Every method on the class other than `start`, `update` and the constructor can be picked in an event list:

1. Select the Button (or other object with an event).
2. In On Click (), add an entry, set its target to the object with the behaviour, and pick *Name* (Script) ▸
   *method*.
3. Type an argument if you need one. It always arrives as a **string** (`''` when empty), so convert it yourself.

Methods whose names start with `_` are hidden from the list, which is handy for helpers. Arrow functions in class
fields (`toggle = () => {}`) aren't listed either; write them as normal methods.

The same `behaviour:<Name>.<method>` calls work in animation events and in code:

```js
this.GPSB.invoke('logo', 'behaviour:Bob.toggle');            // by node id
this.GPSB.invoke('Header/Logo', 'behaviour:Bob.toggle');     // or by path
this.GPSB.behaviour(nodeId, 'Bob')?.toggle();                // or call the instance directly
```

On a form control's event (a Slider's On Value Changed, say), an entry with an empty argument receives the control's
value, so `setSpeed(arg)` can follow a slider.

## Example: a click counter

```js
// behaviours/ClickCounter.js: counts clicks on this object and writes the total into a Text object.
export const props = {
  label: { type: 'node', default: '', help: 'Text object that shows the count' },
  format: { type: 'string', default: 'Clicked {n} times' },
};

export default class ClickCounter {
  start() { this.count = 0; this._show(); }
  onClick() { this.count++; this._show(); }
  reset() { this.count = 0; this._show(); }                  // behaviour:ClickCounter.reset
  add(arg) { this.count += Number(arg) || 1; this._show(); } // behaviour:ClickCounter.add with arg "5"
  _show() {                                                   // starts with _: hidden from event pickers
    const target = this.GPSB.node(this.props.label);
    const text = target?.components.find(c => c.type === 'Text');
    if (!text) return;
    text.props.text = this.props.format.replace('{n}', this.count);
    this.GPSB.applyNode(target);
  }
}
```

Attach it to a Button, then drop the Text object onto its Label field. A second button can call
`ClickCounter.reset` with the first button as its target.

## Example: firing your own event

Behaviours can have `event` props too, but the runtime doesn't wire them up for you: run the entries yourself.

```js
export const props = {
  seconds: { type: 'number', default: 3 },
  onElapsed: { type: 'event', default: [] },
};

export default class Timer {
  start() { setTimeout(() => this._fire(), this.props.seconds * 1000); }
  _fire() {
    for (const e of this.props.onElapsed) this.GPSB.invoke(e.target, e.call, e.arg, this.node.id);
  }
}
```

Passing `this.node.id` as the last argument makes an entry with an empty target mean "this object", as it does
everywhere else.

## More examples

The demo project (`example/behaviours/`) has three behaviours worth reading:
- `Spin.js`: rotates its object, with `spinFaster` and `reverse` methods called from buttons.
- `MouseParallax.js`: follows the mouse with smoothing, and a `toggle(arg)` method.
- `Typewriter.js`: types into a Text object (its own, or one picked with a `node` prop); `play()` can be called from an
  animation event.

## Good to know

- **Behaviours don't run while you edit**, only in Play mode and on the published page. The editor does import the
  file to read its props and methods, so keep top-level code to declarations.
- **One instance per element.** Inside a Repeat, every copy gets its own instance, and `this.node` is that copy's own
  data with `{{item.*}}` filled in.
- **Prop values are as stored.** Asset props are paths inside `assets/`: turn them into URLs with
  `this.GPSB.assets.url(path)`. `node` props are node ids: look them up with `this.GPSB.node(id)`.
- **Data:** `await this.GPSB.assets.json('data/site.json')` inside an `async start()`.
- **Imports:** behaviours are ES modules. They're published to `behaviours/`, next to the gpsb runtime in `gpsb/`, so
  `import { Behaviour, tween } from '../gpsb/engine.js'` or `import { lerpValue } from '../gpsb/anim.js'` works. npm
  packages installed with the [Package Manager](packages.md) are imported by name (`import dayjs from 'dayjs'`). Other
  files you import must be reachable from the published site, e.g. in `assets/` or `public/`.
- **Several behaviours** can be attached to the same object, including more than one of the same script.
- **Debugging:** `console.log` and errors appear in the editor's Console during Play mode. Errors name the behaviour
  and hook (`[behaviour Bob] start: …`).
- **Renaming** a behaviour file in the Project panel updates every page that uses it.
