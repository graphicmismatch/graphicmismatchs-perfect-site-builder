# Plan: C# (and other languages) with a Unity-style scripting API

Feasibility analysis and plan for writing gpsb behaviours, extension components and custom components in C# (or another
language) against a typed engine API that feels like `UnityEngine`: `MonoBehaviour`-style classes, serialized fields
that become Inspector fields, `Update()`, `GetComponent<T>()`, `Time.deltaTime`, `Vector2`, `[Range]`, `[Tooltip]`.

Status legend: ☐ to do · ◐ in progress · ☑ done

---

## Summary

| Option | Feasible? | Cost | Fit with gpsb | Verdict |
|---|---|---|---|---|
| **Engine API** (Unity-style classes over today's contract), in JS | Yes | Low | Fits exactly: it's sugar over the existing module shapes | **Do first.** Every other language targets it. |
| **TypeScript** via Node's built-in type stripping | Yes, tested on Node 22.22 here | Low | Zero dependencies kept; outputs the same ES modules | **Do second.** Typed API, IntelliSense, no new toolchain. |
| **C# → JS source transpiler** (Roslyn, supported subset) | Yes, with limits on what C# works | Medium–high | Outputs the same ES modules; no runtime cost for visitors; needs the .NET SDK, **only on the author's machine** | **Do third**, as an opt-in plugin, after a one-week spike. |
| C# on .NET WebAssembly (Blazor-style runtime) | Works technically | Medium | Poor: a multi-MB runtime per site, async start-up, JS↔WASM interop every frame, sync build hooks are awkward in Node | **Rejected** as the main path. |
| Other compile-to-JS languages (F# via Fable, Haxe, Kotlin/JS…) | Yes | Per language | Through the same language-plugin hook as C# | Possible later; nothing to build in core. |
| WASM modules (Rust, C, AssemblyScript) for heavy computation | Yes, already possible | None | Called from a JS/TS behaviour | Document only. |

The main finding is that gpsb already has **one place a new language plugs in**. Behaviours, extensions and
custom-component scripts all end up as plain ES modules with a fixed shape:

- The editor learns a behaviour's fields and methods by importing the module (`props` plus the class's methods,
  `editor/state.js` `loadBehaviours`).
- The runtime imports `behaviours/<Name>.js` (`lib/behaviours.js` `boot`).
- The build and the editor register `extensions/<Name>.js` (`cli.js` `loadExtensions`, `editor/state.js`).

So a language only has to **compile source → an ES module of that shape**. The inspector, animation window, event
pickers, runtime, renderer and output contract (`CONTRACT.md`) don't need to know which language a script was written
in. The dev server already does this for `components/*.html` (compiled on request by `lib/compile.js`).

---

## 1. What exists today (the contract any language must hit)

| Kind | File | Runs in | Module shape | Notes for other languages |
|---|---|---|---|---|
| Behaviour | `behaviours/<Name>.js` | browser only (published page, Play mode). The editor imports it but never runs it | `export const props` (or static `props`), `export default class` with `start`, `update(dt)`, `onClick`, and public methods | Fields `el`, `node`, `props`, `apply`, `find`, `setActive`, `animator`, `GPSB` are **injected after construction**. `this.props` is the object the animator writes to. |
| Extension | `extensions/<Name>.js` | **Node (build) and browser** | default export: a definition object or `kit => definition` with `props`, `tag`, `style`, `attrs`, `inner`, `rules`, `childStyle`, `head`, `patch`, `state`, `init` | `style`/`attrs`/`inner`/`rules`/`head` are **synchronous, pure, and run in Node**: no browser APIs, no async runtime. |
| Custom component | `components/<Name>.html` | browser (editor too) | `<template>`, `<style>`, props JSON, optional `<script>` exporting `class extends Component` | Already compiled by `lib/compile.js`. The script is copied as-is. |

Constraints from `CONTRACT.md` that shape the plan:
- **Zero dependencies** in gpsb itself (Node stdlib only, no bundler). → TypeScript must use Node's built-in stripper,
  and the C# compiler must be an **external, opt-in tool** that gpsb talks to over stdio, not a dependency.
- `lib/` is isomorphic and shipped as-is. → The engine API is a new `lib/engine.js` that follows the same rules.
- Small, surgical edits to shared files (`cli.js`, `lib/behaviours.js`, `editor/state.js`).

---

## 2. The engine API (language-neutral, Unity-style)

A new `lib/engine.js`, published as `gpsb/engine.js`. It is a **thin layer over the current contract**: plain
behaviours keep working unchanged, and class-based scripts compile down to the same thing. TypeScript typings
(`gpsb.d.ts`) and a C# reference assembly (`Gpsb.Engine.dll`) describe the **same** API, so a script reads almost the
same in all three languages.

### 2.1 Behaviours

```ts
// behaviours/Spin.ts (TypeScript)
import { Behaviour, prop, Time } from '../gpsb/engine.js';

export default class Spin extends Behaviour {
  static props = { speed: prop.number(90, { min: -720, max: 720, help: 'degrees per second' }) };
  declare speed: number;                         // typed accessor onto this.props.speed (erased at build)

  update() { this.rectTransform.rotation = (this.rectTransform.rotation + this.speed * Time.deltaTime) % 360; }
  spinFaster() { this.speed *= 2; }              // behaviour:Spin.spinFaster in event lists
  reverse() { this.speed = -this.speed; }
}
```

```csharp
// behaviours/Spin.cs (C#)
using Gpsb;

public class Spin : Behaviour
{
    [Range(-720, 720), Tooltip("degrees per second")]
    public float speed = 90;

    void Update() => rectTransform.rotation = (rectTransform.rotation + speed * Time.deltaTime) % 360;
    public void SpinFaster() => speed *= 2;
    public void Reverse() => speed = -speed;
}
```

Both compile to a module the current runtime already understands: `props = { speed: { type: 'number', default: 90,
min: -720, max: 720, help } }`, a class with `update`, `spinFaster`, `reverse`.

| Unity | gpsb engine API | Maps to today |
|---|---|---|
| `MonoBehaviour` | `Behaviour` (base class) | the injected fields |
| `transform` / `RectTransform` | `this.rectTransform`: `anchoredPosition`, `sizeDelta`, `anchorMin/Max`, `pivot`, `rotation`, `localScale`, `zIndex` | `node.rect.pos/size/...` |
| `gameObject.SetActive`, `activeSelf` | `this.webObject.setActive(on)`, `.active`, `.name` | `setActive`, `node.active` |
| `GetComponent<Text>()` | `this.getComponent(Text)` → typed wrapper (`.text`, `.color`, …) | `node.components.find(c => c.type === 'Text').props` |
| Serialized field / `[SerializeField]` | `static props` + `declare` (TS), public field (C#) | `props` schema + `this.props` |
| `[Range]`, `[Tooltip]`, `[TextArea]`, `[Header]` | `prop.number(d, { min, max, help })`, C# attributes | schema options |
| `Time.deltaTime`, `Time.time` | `Time.deltaTime`, `Time.time` | the `dt` argument |
| `Mathf`, `Vector2`, `Vector4`, `Color` | same names, **immutable** value types | arrays and `#rrggbbaa` strings |
| `UnityEvent` field | `WebEvent` prop with `.invoke()` | `event` prop + `GPSB.invoke` loop |
| `GameObject.Find` | `WebObject.find(path)` | `GPSB.find` |
| Typed object field (`public Text label;`) | node prop whose type names a component: resolves to that component's wrapper | `node` prop (id) + `GPSB.node` |
| Coroutines (`StartCoroutine`, `yield return new WaitForSeconds(1)`) | generator methods + `this.startCoroutine(gen)`, `wait(seconds)`, `nextFrame` | new, about 40 lines on top of the update loop |
| `GetComponent<Animator>()` | `this.animator`: `play`, `stop`, `seek`… | `animator` |

**Applying changes automatically.** Today scripts must call `this.apply()`. Unity applies changes as you make them.
Setters on the wrappers mark the node as changed, and the runtime calls `applyNode` once for each changed node after the
`update` pass and after each event call. Calling `apply()` yourself keeps working, so existing scripts don't change.
This is the only change to the runtime's behaviour, and only scripts that use the wrappers get it.

**Fields that animate.** A behaviour prop must stay one object with what the animator writes to, or animating
`behaviour:Spin.speed` would stop affecting the script. So typed fields are **accessors onto `this.props`**, not real
fields. The `Behaviour` constructor defines them on the instance from `static props`. They read `this.props` lazily,
because the runtime injects it after construction. They must not go on the prototype: the editor finds methods by
reading every property on the prototype (`loadBehaviours`), which would run a getter with no `props`. The C#
transpiler emits the same accessors.

**Immutable value types.** C# structs are copied on assignment; JS objects are shared. Making `Vector2`/`Color`
immutable (like Unity, where `transform.position.x = 1` doesn't compile anyway, CS1612) avoids that whole class of
bugs: `rectTransform.anchoredPosition = new Vector2(10, 0)`.

### 2.2 Extensions as classes

Same hooks, written as methods. `defineExtension(Class)` in `lib/engine.js` turns the class into today's definition
object. Each hook call gets a lightweight object with the props set as fields, so `this.color` reads a prop:

```csharp
// extensions/Countdown.cs
using Gpsb; using Gpsb.Html;

[Category("Extensions")]
public class Countdown : ExtensionComponent
{
    public string until = "2030-01-01T00:00:00Z";
    public Color color = Color.Hex("#202020");
    public float size = 32;

    public override void Style(Css css) { css["color"] = color; css["font-size"] = $"{size}px"; }
    public override Html Inner(Ctx ctx) => H.Span(new { @class = "countdown" }, Left(until));   // escaped by default
    [BrowserOnly] public override void Patch(Element el, Ctx ctx) => el.Find(":scope > .countdown").TextContent = Left(until);
    [BrowserOnly] public override void Init(Element el) => Gpsb.SetInterval(() => Apply(el), 1000);

    static string Left(string until) { /* … */ }
}
```

- An **HTML builder that escapes by default** (`H.Span(...)`) replaces calling `esc()` by hand, so the typed API fixes
  the most common extension security bug (forgotten escaping).
- **`[BrowserOnly]` is checked by the compiler.** A Roslyn analyzer reports an error when `Style`/`Attrs`/`Inner`/
  `Rules`/`Head` reach the DOM API, because those run in Node at build time. JS can only find this out at build time.
  Being able to check this is a real argument for typed languages here.

### 2.3 Custom components

`<script lang="ts">` in `components/<Name>.html` is cheap (the same type stripping) and is included. C# for custom
components is **deferred**: they're mostly template and CSS, and their script is small and DOM-heavy, so C# adds little.

### 2.4 Per-project typings (like Unity generating a .csproj)

`gpsb types <project>` (also run by the dev server when components change) generates, from the component registry,
the project's extensions and custom components and their props schemas:
- `.gpsb/types/gpsb.d.ts`: typed `getComponent(Text)`, prop types, `GPSB` runtime API.
- `.gpsb/csharp/Gpsb.Project.g.cs` + `Scripts.csproj` referencing `Gpsb.Engine.dll`: full IntelliSense and type
  checking in VS Code / Rider / Visual Studio, as Unity does for its projects.

Prop type mapping (one table drives both generators):

| gpsb type | TypeScript | C# |
|---|---|---|
| `number` / `int` | `number` | `float` / `int` |
| `string`, `text`, `code`, `href` | `string` | `string` (+ `[TextArea]`, `[Code("css")]`, `Href`) |
| `bool` | `boolean` | `bool` |
| `color` | `Color` | `Color` |
| `enum` | string union | C# `enum` (members → `options`) |
| `vec2` / `vec4` | `Vector2` / `Vector4` | `Vector2` / `Vector4` |
| `asset:*` | `Asset<'image'>` (`.url`, `.json()`) | `ImageAsset`, `JsonAsset`, … / `AnimationClip` |
| `node` | `WebObject` or a component wrapper | `WebObject` or `Text`, `Image`, … (typed field) |
| `event` | `WebEvent` | `WebEvent` |
| `list` | `T[]` | `List<T>` / `T[]` |

---

## 3. TypeScript: feasibility

**Verified here** (Node v22.22.0): `require('node:module').stripTypeScriptTypes(src, { mode: 'transform',
sourceMap: true })` turns a typed behaviour into the expected ES module with a source map, and `import()` of a `.ts`
file works in Node directly. It's stdlib, so the zero-dependency rule holds.

| Area | Change |
|---|---|
| Discovery (`cli.js` `loadProject`) | Accept `behaviours/*.ts` and `extensions/*.ts`. Error when both `Spin.js` and `Spin.ts` exist. |
| Dev server | Serve `/project/behaviours/Spin.js` by stripping `Spin.ts` on request (cached by mtime), as `components/*.html` already are. Rewrite relative `./x.ts` imports to `./x.js`. |
| Build | Write the stripped `.js` (+ `.js.map`) to `dist/behaviours/` / `dist/extensions/`. Stop copying `.ts` sources (today the whole folder is copied). Extensions are imported in Node from the stripped output. |
| Editor | Import the compiled URL rather than the source path. New Script / Project ▸ + get a language choice. Code panel: TS highlighting. |
| Typings | `gpsb.d.ts` (2.4). Type *checking* is optional and done in the author's IDE. gpsb only strips. |

Limits: Node's stripper only accepts **erasable** syntax: no `enum`, `namespace`, parameter properties or decorators
(which the engine API doesn't need: `static props` + `declare` cover it). Type stripping needs Node ≥ 22.13 (≥ 22.18
to import `.ts` with no flag) and prints an "experimental" warning on 22.x. Raise `engines` to `>=22.13`, or detect an
older Node and show a clear message only when a `.ts` file is present.

---

## 4. C#: feasibility

### 4.1 Approaches compared

| | A. .NET WebAssembly runtime | B. Roslyn source-to-source transpiler (recommended) |
|---|---|---|
| Visitor download | .NET runtime + trimmed assemblies: roughly 1–3 MB compressed, on every site | Only the emitted JS + a small helper module (target < 10 KB) |
| Start-up | Async runtime boot before `start()`; delays `gpsb:ready` | Same as JS |
| Per-frame cost | Every node read/write crosses the JS↔WASM boundary (marshalling node data) | None: direct property access |
| Extension hooks at build | Must boot the WASM runtime in Node and call it synchronously | Plain imported JS |
| Editor reflection (props, methods) | Needs a separate metadata channel | The module is the metadata, as today |
| C# coverage | Almost all of .NET | A documented subset (4.3) |
| Debugging | .NET WASM debugger setup | Source maps: browser devtools show `.cs` lines |
| Output contract | Breaks "unbundled ES modules" | Kept |
| Precedent | Blazor | UdonSharp (a C# subset compiled via Roslyn for VRChat), Bridge.NET / H5 (C# → JS), Fable (F# → JS) |

B costs more to build but suits a static site generator whose output is lightweight HTML/JS. A is the right tool for
porting large existing .NET libraries, which isn't the job here. Existing C# → JS compilers (H5) were considered:
they bring their own runtime and class model and don't output native ES modules in the shape gpsb's editor and runtime
read. The spike (5.1) should confirm that a small custom emitter on Roslyn's semantic model is less work than adapting
one.

### 4.2 How the C# tool plugs in (keeping gpsb zero-dependency)

- The compiler is a separate **.NET tool** (`gpsb-csharp`, its own project/repo, depends on Roslyn). gpsb never depends
  on it. Projects without `.cs` files never touch it.
- **Language plugin protocol** (generic, so other languages can use it): gpsb starts the tool once
  (`child_process.spawn`, stdlib) and talks newline-delimited JSON over stdio:
  `{ id, op: 'compile', files: { path: source } }` →
  `{ id, outputs: { 'behaviours/Spin.js': js, …map }, meta: { props, methods }, diagnostics: [{ file, line, col, severity, message }] }`.
  The tool stays running between requests, so the .NET start-up (about 1 s) and Roslyn warm-up happen once; after that,
  recompiling one file on save should be under about 300 ms (to be measured in the spike).
- Configured in `project.json`: `"languages": { "cs": { "command": "gpsb-csharp" } }`. If the command isn't installed,
  the editor Console says so and how to install it (`dotnet tool install -g gpsb-csharp`); other scripts keep working.
- **Whole-project compilation**: C# files can reference each other (shared helper classes, a `GameManager`), so the tool
  compiles all `.cs` files as one Roslyn compilation and emits one module per behaviour/extension plus shared modules.
- Compile errors appear in the Console with `file:line` (click to open). A behaviour that fails to compile is skipped
  in Play mode with a red marker in the Inspector, as a broken `.js` behaviour is today.

### 4.3 C# → JS semantics (the supported subset)

| C# | JS output | Notes |
|---|---|---|
| classes, inheritance, `virtual`/`override`, interfaces, `static` | ES classes | interfaces are compile-time only |
| properties, `get`/`set`, expression bodies | accessors | |
| public / `[SerializeField]` fields on a `Behaviour` | prop schema + accessors onto `this.props` | the field initializer must be a constant: it becomes the default |
| private methods | `_`-prefixed (hidden from event pickers, as today) | |
| method names | camelCase (`SpinFaster` → `spinFaster`) | so `behaviour:Spin.spinFaster` is the same from JS, TS and C# |
| `Start`, `Update`, `OnClick` | `start`, `update(dt)`, `onClick` | `Time.deltaTime` is fed from `dt` |
| overloads | names made unique by Roslyn's resolved symbol (`add$1`) | engine API overloads mapped with `[JsName]` |
| `int` arithmetic | `/` → `Math.trunc`, `unchecked` wrap with `\| 0` | `float`/`double` both → `number` |
| `long`, `decimal`, `unsafe`, pointers | **error** in MVP | `long` → `BigInt` later if needed |
| user `struct`s | **readonly structs only** in MVP | avoids copy-on-assign emulation |
| generics | erased; `GetComponent<T>()` → `getComponent(T)` | |
| lambdas, `Action`/`Func`, C# `event` | closures, handler arrays | |
| `string` interpolation, `ToString("F2")` | template literals + format helper | |
| `List<T>`, `Dictionary<K,V>`, `HashSet<T>` | `Array`, `Map`, `Set` wrappers in the helper module | |
| LINQ (`Where`, `Select`, `First`, `Any`, `OrderBy`, `Sum`…) | array methods / small helper | others → error |
| `async`/`await`, `Task` | `async` / `Promise` | `async void Start()` allowed |
| `IEnumerator` + `yield return` | generator functions → coroutines | |
| `try/catch/finally`, `throw` | same; `catch (T)` → `instanceof` | |
| pattern matching, `switch` expressions, `?.`, `??` | `if` chains / same | |
| reflection, threads, `dynamic`, `System.IO`, `System.Net` | **error** with a clear message | use `Gpsb.Http.Fetch`, `JsonAsset` |
| calling JS/DOM | `Gpsb.Dom` typed bindings + `[JsImport("module", "name")]` escape hatch | |

The rule: **anything not translated exactly is a compile error, never silently wrong JS**. Roslyn's semantic model
(types, resolved overloads, constants) is what makes this possible. A text-based transpiler couldn't do it.

---

## 5. Plan

### 5.1 Spike (1 week, before committing to C#)
| | Item | Exit criteria |
|---|---|---|
| ☐ | Roslyn emitter prototype | `Spin.cs` and `Typewriter.cs` (ports of the demo behaviours) compile to modules the **unchanged** runtime runs in Play mode and on a built page. |
| ☐ | Warm compile latency | Measured warm recompile of one file in a 20-file project; target < 300 ms. |
| ☐ | Existing transpiler check | Half a day trying H5; written note on why reuse it or not. |
| ☐ | Go / no-go | Short write-up appended to this file. |

### 5.2 Phase 1: engine API in JS (about 2–3 weeks)
| | Item | Design |
|---|---|---|
| ☐ | `lib/engine.js` | `Behaviour`, `prop.*` schema builders, `Time`, `Mathf`, `Vector2/4`, `Color`, `WebObject`, typed component wrappers generated from the registry, `WebEvent`, coroutines. |
| ☐ | Automatic apply | Wrapper setters mark nodes as changed; one flush after `update` and after each `invoke` (small edit to `lib/behaviours.js`). `apply()` keeps working. |
| ☐ | `defineExtension(Class)` | Class-form extensions → today's definition object; `Html` builder that escapes by default. |
| ☐ | Editor reflection | Also read methods from `static methods` when present (C# private/public visibility); otherwise unchanged. |
| ☐ | Docs + tests | `docs/engine-api.md`; tests in `test/core.test.js`; the demo's `Spin.js` rewritten on the API next to the old one; both checked in a browser with `test/browser.js`. |

### 5.3 Phase 2: TypeScript (about 1–2 weeks)
| | Item | Design |
|---|---|---|
| ☐ | Strip on serve + build | Section 3 table. Source maps in dev and in `dist/`. |
| ☐ | Typings | `gpsb types`, `.gpsb/types/gpsb.d.ts` regenerated by the dev server. |
| ☐ | Editor | Language picker in New Script / Project ▸ +, TS templates, TS highlighting. |
| ☐ | `<script lang="ts">` in custom components | `lib/compile.js` strips it before writing `Name.script.js`. |

### 5.4 Phase 3: language plugin hook (about 1 week)
| | Item | Design |
|---|---|---|
| ☐ | Protocol + process manager in `cli.js` | 4.2. Restart on crash, time out stuck compiles, feed diagnostics to the editor's Console via `/api/events`. |
| ☐ | `project.json` `languages` | Documented in `CONTRACT.md`. TS uses the same hook internally (built in, no process). |

### 5.5 Phase 4: C# plugin MVP (about 6–10 weeks)
| | Item | Design |
|---|---|---|
| ☐ | `Gpsb.Engine` reference assembly | C# surface of the engine API with `[JsName]` mappings; versioned with `lib/engine.js` (modules carry `apiVersion`, the runtime warns on a mismatch). |
| ☐ | Emitter | Subset in 4.3, source maps, helper module `gpsb/cs.js`. |
| ☐ | Analyzer | Errors for unsupported features and for DOM use in build-time extension hooks. |
| ☐ | Project generation | `Scripts.csproj` + `Gpsb.Project.g.cs` for IDE IntelliSense. |
| ☐ | Editor | C# templates, highlighting, diagnostics in the Console. |
| ☐ | Tests | Golden tests (C# in → JS out); **conformance tests**: each demo behaviour in JS and in C# produces the same node data after N frames in headless Chromium. |

### 5.6 Later
- `long` via `BigInt`, mutable user structs (copy on assign), more LINQ.
- C# custom components (`WebComponent` base class).
- Runtime `Instantiate(prefab)` / `Destroy(webObject)`: the Unity API users will look for next; needs runtime prefab
  expansion (`lib/prefab.js` is already isomorphic).
- Other languages through the same plugin hook (F# via Fable is the most mature candidate).

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| C# looks like Unity C# but some code won't compile | Frustrated users | Errors (never silently wrong output) with links to the supported-subset doc; port the demos early to find gaps. |
| Maintaining the transpiler | Ongoing cost, grows with the subset | Keep the subset small; the conformance suite catches regressions; it lives in its own repo with its own release cycle. |
| .NET SDK on authors' machines | Setup step for C# users | Opt-in only; clear install message; JS/TS need nothing. |
| Two ways to write behaviours (plain vs engine API) | Confusing docs | Docs lead with the engine API; plain modules documented as the low-level contract. |
| Node's TS stripper is experimental on 22.x | Warning printed; API could change | Isolated behind the language-plugin seam; easy to swap. |
| Automatic apply changes timing | Edge cases where scripts expect an immediate DOM update | Only for wrapper writes; `apply()` still applies immediately; documented. |
| Engine API / C# assembly version skew | Broken scripts after upgrade | `apiVersion` in emitted modules; runtime warning. |

---

## 7. Open decisions

1. **Is requiring the .NET SDK acceptable for C# authors?** (Core gpsb stays zero-dependency either way.)
   Recommended: yes, opt-in.
2. **Where does the C# tool live?** Recommended: a separate repo/package, because it needs Roslyn (NuGet) and the
   zero-dependency rule applies to this repo.
3. **Method naming in event lists:** camelCase everywhere (recommended), or keep C# PascalCase in the event picker?
4. **Engine API naming:** keep Unity names (`MonoBehaviour`, `GameObject`, `transform`) for familiarity, or web-flavoured
   ones (`Behaviour`, `WebObject`, `rectTransform`, as gpsb's menus use)? Recommended: gpsb names, with
   `MonoBehaviour`/`GameObject` as aliases in the C# assembly to make porting easier.
