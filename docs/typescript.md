# TypeScript

Behaviours, extension components, their helper modules and custom-component scripts can be written in TypeScript.
gpsb compiles them itself with Node's built-in TypeScript support, so there's nothing to install.

```ts
// behaviours/Spin.ts
import { Behaviour, prop, Time } from '../gpsb/engine.js';

export default class Spin extends Behaviour {
  static props = { speed: prop.number(90, { help: 'degrees per second' }) };
  declare speed: number;

  update() { this.rectTransform.rotation += this.speed * Time.deltaTime; }
  reverse() { this.speed = -this.speed; }
}
```

You need **Node 22.15 or later**. Projects without TypeScript files work on any Node 22.

## Creating TypeScript files

- **Inspector:** Add Component ▸ New Script, then pick TypeScript under Language. Once a project has TypeScript
  files, that's the default.
- **Project panel:** + ▾ ▸ Behaviour Script (TypeScript) or Extension Component (TypeScript).
- **By hand:** `behaviours/<Name>.ts`, `extensions/<Name>.ts`, or `<script lang="ts">` in `components/<Name>.html`.

The templates use the [engine API](engine-api.md), which is typed throughout. Plain behaviours and extensions work in
TypeScript too.

A name can be used by only one file: `Spin.js` and `Spin.ts` side by side is an error.

## Types in your editor

When the editor opens a project that has TypeScript files (or a `tsconfig.json`), gpsb writes:

- `.gpsb/types/gpsb/`: `engine.d.ts` (the whole engine API, tweens and the runtime included), plus `project.d.ts`,
  generated from this project's components. `getComponent('Text')` knows `text`, `color` and `size`, and your own
  extensions and custom components are in there too. It's updated whenever the editor reloads the project, so a new
  extension prop shows up in your IDE. The folder has its own `.gitignore`.
- `tsconfig.json`, if there isn't one. Its `rootDirs` setting makes `import … from '../gpsb/engine.js'` resolve to
  those types, the same path that works on the published site.

Run `gpsb types <project>` to write them without opening the editor.

Open the project folder in VS Code (or any editor with TypeScript support) to get completion and error checking.
**gpsb itself doesn't type-check**: it removes the types and runs the code, so a type error never stops a build. To
check a whole project, run `npx tsc -p <project>`.

## Typing props

`static props` defines the Inspector fields. For TypeScript to know their types, either declare each one:

```ts
static props = { speed: prop.number(90), tint: prop.color('#ff3366') };
declare speed: number;
declare tint: Color;
```

or derive them all from the schema with `PropsOf`. TypeScript doesn't let an interface merge into an
`export default class`, so export the class on its own line:

```ts
import { Behaviour, prop, type PropsOf } from '../gpsb/engine.js';

class Patrol extends Behaviour {
  static props = { distance: prop.number(200), label: prop.node({ component: 'Text' }), onArrived: prop.event() };
}
interface Patrol extends PropsOf<typeof Patrol.props> {}
export default Patrol;
```

`prop.node({ component: 'Text' })` is typed as that component (or `null`), `prop.enum(['a', 'b'])` as `'a' | 'b'`.

Use `declare`, not a plain field (`speed: number;`). A plain field becomes a real property that hides the prop. If you
forget, gpsb fixes it at runtime and warns in the Console.

## What's supported

gpsb uses Node's TypeScript transform, which removes types and converts the few TypeScript features that need code:

- type annotations, interfaces, `type` aliases, generics, `as`, `satisfies`, `!`, `declare` fields, `import type` and
  inline `type` imports
- `enum` and `namespace`
- parameter properties (`constructor(private x: number)`)

Not supported: decorators (they're left in the code, and browsers can't run them yet), `import x = require()` and
`export =` (they become CommonJS `require` / `module.exports`, which don't exist in ES modules), and JSX.

Imports work the way they do on the published site:

- `'../gpsb/engine.js'` (the whole API, tweens included) and the other runtime modules (`'../gpsb/anim.js'`)
- your own `.ts` modules, written as `'./util.ts'` or `'./util.js'`; `.ts` imports are rewritten to `.js`
- helper modules in subfolders, `extensions/lib/format.ts` for example. Every top-level `.js`/`.ts` file in
  `extensions/` is an extension, so keep helpers in a subfolder. Every file in `behaviours/` is listed as a behaviour,
  so helpers shared by behaviours are best kept in `extensions/lib/` too.

## How it's built

| | |
|---|---|
| Dev server and editor | `behaviours/Spin.ts` is served compiled, at `behaviours/Spin.js`, with an inline source map. A syntax error comes back as a script that throws it, so the Console names the file and line. |
| Build | Each `.ts` file becomes `.js` plus a `.js.map` source map. `.ts` and `.d.ts` files aren't published. |
| Extensions at build time | Imported in Node and compiled as they load, including their own imports. `../gpsb/*.js` resolves to gpsb's own copy. |

Source maps contain the original TypeScript, so browser devtools show your `.ts` lines in errors and the debugger.
