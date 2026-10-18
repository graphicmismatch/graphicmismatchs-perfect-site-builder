# Plan: strongly typed scripting languages with a Unity-style API

Feasibility analysis and plan for writing gpsb behaviours, extension components and custom components in a **strongly
typed C-family or Java-family language** (C#, Java, Kotlin, TypeScript, Haxe, Dart, Scala, C/C++, …), against one typed
engine API that feels like `UnityEngine`: `MonoBehaviour`-style classes, serialized fields that become Inspector fields,
`Update()`, `GetComponent<T>()`, `Time.deltaTime`, `Vector2`, `[Range]`, `[Tooltip]`.

Status legend: ☐ to do · ◐ in progress · ☑ done

**Status (October 2026):** the engine API, the tweening library and TypeScript support are implemented (phases 1 and
2, details in section 5). Docs: `docs/engine-api.md`, `docs/tweening.md`, `docs/typescript.md`.

---

## Summary

**Feasible.** gpsb already has a single place where any language can plug in. Behaviours, extensions and
custom-component scripts all end up as plain ES modules with a fixed shape:

- The editor learns a behaviour's fields and methods by importing the module (`props` plus the class's methods,
  `editor/state.js` `loadBehaviours`).
- The runtime imports `behaviours/<Name>.js` (`lib/behaviours.js` `boot`).
- The build and the editor register `extensions/<Name>.js` (`cli.js` `loadExtensions`, `editor/state.js`).

A language only has to produce **an ES module of that shape**. The inspector, animation window, event pickers,
runtime, renderer and output contract (`CONTRACT.md`) don't need to know which language a script was written in. The
dev server already does this for `components/*.html` (compiled on request by `lib/compile.js`).

What decides how well a language fits is its **compile-to-JS story**, not its syntax.

| Language | Route | Fit | Verdict |
|---|---|---|---|
| **TypeScript** | Node's built-in type stripping (tested on Node 22.22 here) | Excellent: zero dependencies, same modules, no runtime | **Built in. Do first**, with the engine API. |
| **C#** | Own Roslyn → JS transpiler (or adapt Transpose, decided by the spike) | Very good: closest to Unity; properties, attributes, operator overloading suit the API | **First external language.** |
| **Kotlin** (Java family) | Official Kotlin/JS compiler, ES-module output + generated shim | Good: delegated properties are a natural fit for gpsb props; official toolchain | **Second external language** (Java family). |
| **Java** | TeaVM (ES2015 modules) + shim; or own javac-based transpiler | Fair: works, but no properties or operator overloading, so the API is wordier | **Third**, reusing the Kotlin plugin's JVM bindings. |
| **Haxe** | Haxe JS output (+ `genes` for split ES modules) + shim | Good: fast single-binary compiler, macros generate the schema | Optional, low cost once the shim route exists. |
| Scala | Scala.js + shim | Fair: mature, but a larger runtime and a niche audience | Possible later through the same hook. |
| Dart | dart2js | Poor: bundled output; exposing classes to JS goes through per-object wrappers | Not recommended. |
| C, C++, Rust, Swift, Go, AssemblyScript | WebAssembly | Poor for scripting: every node read/write crosses JS↔WASM; strings and objects must be copied across | Not for behaviours. Fine for heavy computation called from a behaviour (already possible). |
| C# on .NET WebAssembly (Blazor-style) | .NET runtime in WASM | Poor: multi-MB runtime per site, async start-up, interop every frame | Rejected. |

gpsb core stays **zero-dependency**: TypeScript uses Node's stdlib. Every other language is an **opt-in external tool**
on the author's machine, which gpsb talks to over stdio. Visitors to a published site only ever download JS.

---

## 1. What exists today (the contract any language must hit)

| Kind | File | Runs in | Module shape | Notes for other languages |
|---|---|---|---|---|
| Behaviour | `behaviours/<Name>.js` | browser only (published page, Play mode). The editor imports it but never runs it | `export const props` (or static `props`), `export default class` with `start`, `update(dt)`, `onClick`, and public methods | Fields `el`, `node`, `props`, `apply`, `find`, `setActive`, `animator`, `GPSB` are **injected after construction**. `this.props` is the object the animator writes to. |
| Extension | `extensions/<Name>.js` | **Node (build) and browser** | default export: a definition object or `kit => definition` with `props`, `tag`, `style`, `attrs`, `inner`, `rules`, `childStyle`, `head`, `patch`, `state`, `init` | `style`/`attrs`/`inner`/`rules`/`head` are **synchronous, pure, and run in Node**: no browser APIs, no async runtime. |
| Custom component | `components/<Name>.html` | browser (editor too) | `<template>`, `<style>`, props JSON, optional `<script>` exporting `class extends Component` | Already compiled by `lib/compile.js`. The script is copied as-is. |

Constraints from `CONTRACT.md` that shape the plan:
- **Zero dependencies** in gpsb (Node stdlib only, no bundler). Compilers for other languages are external tools.
- `lib/` is isomorphic and shipped as-is. The engine API is a new `lib/engine.js` that follows the same rules.
- Small, surgical edits to shared files (`cli.js`, `lib/behaviours.js`, `editor/state.js`).

What this means for a language:
1. **Sync, in Node.** Extension hooks are called synchronously during the build, so compiled code must be plain JS
   (WASM is possible but awkward).
2. **Direct object access.** Behaviours read and write node data every frame, which is cheap in JS and expensive across
   a WASM boundary.
3. **Schema at compile time.** The editor needs the props schema and the list of public methods without running the
   script. Most compile-to-JS languages drop annotations, so the schema must be extracted **at compile time** (Roslyn,
   a Java annotation processor, Kotlin KSP, Haxe macros) and emitted as data.
4. **Fields that animate.** The animator writes `behaviour:Spin.speed` into `this.props`. A typed field must read and
   write through to it (section 2.1).
5. **Small runtime.** The language's runtime library is downloaded by every visitor. The language's own standard
   library counts too.

---

## 2. The engine API: one definition, every language

A Unity-style API defined **once**, in a machine-readable description (`api/engine.json`: classes, members, types,
which members are build-safe). From it, gpsb generates the typings and bindings for each language. They all call the
same JS implementation, `lib/engine.js` (published as `gpsb/engine.js`).

| Generated | For |
|---|---|
| `gpsb.d.ts` | TypeScript |
| `Gpsb.Engine` reference assembly (C# stubs with `[JsName]`) | C# |
| `external` declarations (`gpsb-engine.kt`) | Kotlin |
| `@JSBody` / JSO interfaces (`gpsb-engine.jar`) | Java (TeaVM) |
| `extern` classes | Haxe |

The engine API is a **thin layer over the current contract**: plain JS behaviours keep working unchanged, and
class-based scripts compile down to the same thing.

### 2.1 Behaviours

The same behaviour in four languages. All four produce `props = { speed: { type: 'number', default: 90, min: -720,
max: 720, help } }` and a class with `update`, `spinFaster` and `reverse`, which the current runtime already understands.

```csharp
// behaviours/Spin.cs
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

```kotlin
// behaviours/Spin.kt
import gpsb.*

class Spin : Behaviour() {
    var speed by prop.number(90.0, min = -720.0, max = 720.0, help = "degrees per second")

    override fun update() { rectTransform.rotation = (rectTransform.rotation + speed * Time.deltaTime) % 360 }
    fun spinFaster() { speed *= 2 }
    fun reverse() { speed = -speed }
}
```

```java
// behaviours/Spin.java
import gpsb.*;

public class Spin extends Behaviour {
    @Range(min = -720, max = 720) @Tooltip("degrees per second")
    public double speed = 90;

    @Override public void update() { rectTransform().setRotation((rectTransform().getRotation() + speed * Time.deltaTime()) % 360); }
    public void spinFaster() { speed *= 2; }
    public void reverse() { speed = -speed; }
}
```

```ts
// behaviours/Spin.ts
import { Behaviour, prop, Time } from '../gpsb/engine.js';

export default class Spin extends Behaviour {
  static props = { speed: prop.number(90, { min: -720, max: 720, help: 'degrees per second' }) };
  declare speed: number;                         // typed accessor onto this.props.speed (erased at build)

  update() { this.rectTransform.rotation = (this.rectTransform.rotation + this.speed * Time.deltaTime) % 360; }
  spinFaster() { this.speed *= 2; }              // behaviour:Spin.spinFaster in event lists
  reverse() { this.speed = -this.speed; }
}
```

The Java version shows the cost of a language without properties: getters and setters everywhere. That is why Kotlin
is ranked above Java for the Java family.

| Unity | gpsb engine API | Maps to today |
|---|---|---|
| `MonoBehaviour` | `Behaviour` (base class) | the injected fields |
| `transform` / `RectTransform` | `rectTransform`: `anchoredPosition`, `sizeDelta`, `anchorMin/Max`, `pivot`, `rotation`, `localScale`, `zIndex` | `node.rect.pos/size/...` |
| `gameObject.SetActive`, `activeSelf` | `webObject.setActive(on)`, `.active`, `.name` | `setActive`, `node.active` |
| `GetComponent<Text>()` | `getComponent(Text)` → typed wrapper (`.text`, `.color`, …) | `node.components.find(c => c.type === 'Text').props` |
| Serialized field / `[SerializeField]` | public field (C#, Java), `by prop.*` (Kotlin), `static props` + `declare` (TS) | `props` schema + `this.props` |
| `[Range]`, `[Tooltip]`, `[TextArea]`, `[Header]` | attributes / annotations / `prop.*` options | schema options |
| `Time.deltaTime`, `Time.time` | `Time.deltaTime`, `Time.time` | the `dt` argument |
| `Mathf`, `Vector2`, `Vector4`, `Color` | same names, **immutable** value types | arrays and `#rrggbbaa` strings |
| `UnityEvent` field | `WebEvent` prop with `.invoke()` | `event` prop + `GPSB.invoke` loop |
| `GameObject.Find` | `WebObject.find(path)` | `GPSB.find` |
| Typed object field (`public Text label;`) | node prop whose type names a component: resolves to that component's wrapper | `node` prop (id) + `GPSB.node` |
| Coroutines (`StartCoroutine`, `yield return new WaitForSeconds(1)`) | `startCoroutine` + `wait(seconds)`, `nextFrame`: generators (JS, TS, C#), suspend functions (Kotlin), a callback form (Java) | new, about 40 lines on top of the update loop |
| `GetComponent<Animator>()` | `animator`: `play`, `stop`, `seek`… | `animator` |

**Applying changes automatically.** Today scripts must call `this.apply()`. Unity applies changes as you make them.
Setters on the wrappers mark the node as changed, and the runtime calls `applyNode` once for each changed node after the
`update` pass and after each event call. Calling `apply()` yourself keeps working, so existing scripts don't change.

**Fields that animate.** A typed field must read and write `this.props`, or animating `behaviour:Spin.speed` would stop
affecting the script. Each route handles this differently:

| Route | How |
|---|---|
| TS / JS | The `Behaviour` constructor defines accessors **on the instance** from `static props`. They read `this.props` lazily (it's injected after construction). Not on the prototype: the editor finds methods by reading every property there (`loadBehaviours`), which would run a getter with no `props`. |
| C# (own transpiler) | Serialized fields are emitted as the same accessors. |
| Kotlin | `by prop.number(…)` is a delegated property whose delegate reads and writes `props`. |
| Haxe | A build macro rewrites `@:prop` fields into properties with getters and setters. |
| Java (TeaVM) and any language whose fields can't be intercepted | **Sync in the shim**: copy `props` into the fields before each hook and event call, and changed fields back afterwards. That's a few assignments per frame, and it works for any language. |

**Immutable value types.** C# structs and JVM value classes are copied or compared by value; JS objects are shared.
Making `Vector2`/`Color` immutable (like Unity, where `transform.position.x = 1` doesn't compile anyway, CS1612) avoids
that class of bugs in every language: `rectTransform.anchoredPosition = new Vector2(10, 0)`.

**Method names.** Event lists store `behaviour:Spin.spinFaster`. All languages emit camelCase method names (C#
`SpinFaster` → `spinFaster`), so a call means the same thing whatever language the behaviour is written in.

### 2.2 Extensions as classes

Same hooks, written as methods. `defineExtension(Class)` in `lib/engine.js` turns the class into today's definition
object. Each hook call gets a lightweight object with the props set as fields.

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
- **Build-safe checking.** `api/engine.json` marks which members are safe at build time. The typed languages can check
  that `Style`/`Attrs`/`Inner`/`Rules`/`Head` never reach the DOM, which runs in Node there. C# does this with a Roslyn
  analyzer, Kotlin and Java by putting browser APIs in a separate module the build-time hooks can't import. JS only
  finds out when the build fails.
- Extensions also need a **small runtime** most of all: they run in Node during every build and on every page that uses
  them. The Java family's standard library cost matters more here than for behaviours.

### 2.3 Custom components

`<script lang="ts">` in `components/<Name>.html` is cheap (the same type stripping) and is included. Other languages
for custom components are **deferred**: they're mostly template and CSS, and their script is small and DOM-heavy.

### 2.4 Per-project typings (like Unity generating a .csproj)

`gpsb types <project>` (also run by the dev server when components change) generates per-project bindings from the
component registry, the project's extensions and custom components, and their props schemas. Then
`getComponent(Text).text` and the project's own extensions are typed in every language:
- `.gpsb/types/gpsb.d.ts` (TS)
- `.gpsb/csharp/Gpsb.Project.g.cs` + `Scripts.csproj` (C#: IntelliSense in VS Code / Rider / Visual Studio)
- `.gpsb/kotlin/` and `.gpsb/java/` sources + a Gradle/Maven project file (IntelliJ)

Prop type mapping (one table drives every generator):

| gpsb type | TypeScript | C# | Kotlin | Java |
|---|---|---|---|---|
| `number` / `int` | `number` | `float` / `int` | `Double` / `Int` | `double` / `int` |
| `string`, `text`, `code`, `href` | `string` | `string` (+ `[TextArea]`, `[Code("css")]`, `Href`) | `String` | `String` |
| `bool` | `boolean` | `bool` | `Boolean` | `boolean` |
| `color` | `Color` | `Color` | `Color` | `Color` |
| `enum` | string union | `enum` | `enum class` | `enum` |
| `vec2` / `vec4` | `Vector2` / `Vector4` | same | same | same (records) |
| `asset:*` | `Asset<'image'>` | `ImageAsset`, `JsonAsset`, …, `AnimationClip` | same | same |
| `node` | `WebObject` or a component wrapper | `WebObject` or `Text`, `Image`, … | same | same |
| `event` | `WebEvent` | `WebEvent` | `WebEvent` | `WebEvent` |
| `list` | `T[]` | `List<T>` / `T[]` | `List<T>` | `List<T>` |

---

## 3. The language plugin hook

### 3.1 Two ways a language can integrate

| | **Transpile** (custom emitter) | **Adapt** (existing compiler + shim) |
|---|---|---|
| How | Use the language's own front-end (Roslyn for C#, the javac Tree API for Java) for parsing and types. Write a small emitter that outputs gpsb-shaped modules directly. | The language's standard JS compiler (Kotlin/JS, TeaVM, Haxe, Scala.js, Transpose) builds the code. The plugin also extracts metadata at compile time. gpsb writes a **shim** `behaviours/Spin.js` that imports the output and re-exports it in gpsb's shape. |
| Output | Exactly today's modules. No runtime beyond a small helper module. | The language's module plus its runtime/standard library. Visitors download more. |
| Language coverage | A documented subset; anything else is a compile error. | Almost the whole language (whatever its JS compiler supports). |
| Cost to build | High: the emitter is a compiler back-end. | Medium: bindings, a metadata extractor, the shim template. |
| Cost to maintain | Ours. | Mostly the language project's; we track its releases. |
| Best for | The flagship language, where the closest Unity feel matters | Every other language |

A shim looks like this (generated, never edited):

```js
// behaviours/Spin.js, generated from behaviours/Spin.kt
import { adapt } from '../gpsb/engine.js';
import { Spin } from '../.lang/kotlin/Spin.mjs';
export const props = { speed: { type: 'number', default: 90, min: -720, max: 720, help: 'degrees per second' } };
export default adapt(Spin, { props, methods: ['spinFaster', 'reverse'], sync: false });
```

`adapt` turns the compiled class into the plain class the runtime expects: it maps hook names, exposes only the
listed methods to event pickers, and turns on field sync (2.1) when the language needs it.

### 3.2 Protocol

- gpsb starts the plugin once (`child_process.spawn`, stdlib) and talks newline-delimited JSON over stdio:
  `{ id, op: 'compile', files: { path: source } }` →
  `{ id, outputs: { 'behaviours/Spin.js': js, …maps, …language modules }, meta: { 'Spin': { kind, props, methods } },
  diagnostics: [{ file, line, col, severity, message }] }`.
- The plugin stays running between requests, so start-up costs (about 1 s for .NET; more for the JVM and Gradle) are
  paid once. A warm recompile of one file should be under about 300 ms for a transpiler; compilers with a daemon
  (Kotlin, Gradle) are measured in their spike.
- `project.json`: `"languages": { "cs": { "command": "gpsb-csharp" }, "kt": { "command": "gpsb-kotlin" } }`. If the
  command isn't installed, the editor Console says how to install it; scripts in other languages keep working.
- **Whole-project compilation**: scripts can reference each other (shared helper classes, a `GameManager`), so a plugin
  compiles all files of its language together and emits one module per behaviour/extension plus shared modules.
- Compile errors appear in the Console with `file:line` (click to open). A behaviour that fails to compile is skipped
  in Play mode with a red marker in the Inspector, as a broken `.js` behaviour is today.
- Source maps everywhere, so browser devtools and runtime errors show lines in the original source.
- TypeScript uses the same hook internally (built in, no process), so there is one code path in `cli.js` and the editor.

### 3.3 Changes in gpsb (shared files, small edits)

| Area | Change |
|---|---|
| Discovery (`cli.js` `loadProject`) | Accept `behaviours/*.{js,ts,<plugin ext>}` and the same for `extensions/`. Error when two files have the same name (`Spin.js` and `Spin.cs`). |
| Dev server | Serve `/project/behaviours/Spin.js` from the compiled output (cached by mtime), as `components/*.html` already are. |
| Build | Write compiled `.js` (+ maps and language modules) to `dist/`. Stop copying sources (today the whole `behaviours/` and `extensions/` folders are copied). Extensions are imported in Node from the compiled output. |
| Editor | Import the compiled URL, not the source path. Read `methods` from the module when given. New Script / Project ▸ + get a language choice. Highlighting for each language in the code panel. |
| Versioning | Compiled modules carry `apiVersion`; the runtime warns on a mismatch with `gpsb/engine.js`. |

---

## 4. Language notes

### 4.1 TypeScript (built in)

**Verified here** (Node v22.22.0): `require('node:module').stripTypeScriptTypes(src, { mode: 'transform',
sourceMap: true })` turns a typed behaviour into the expected ES module with a source map, and `import()` of a `.ts`
file works in Node directly. It's stdlib, so the zero-dependency rule holds. It strips types without checking them;
type checking is done in the author's IDE with the generated `gpsb.d.ts`.

As built: transform mode, so `enum`, `namespace` and parameter properties work too; decorators don't. It needs Node
≥ 22.15 (`stripTypeScriptTypes` plus `module.registerHooks` for importing `.ts` extensions at build time). `engines`
stays `>=22`: the error appears only when a project has `.ts` files. Node's "experimental" warning is suppressed.
Relative `./x.ts` imports are rewritten to `./x.js`. See `docs/typescript.md`.

### 4.2 C# (first external language, transpile route)

The closest match to Unity, and the language with the most to gain from a typed API: properties, attributes, operator
overloading on `Vector2`, `IEnumerator` coroutines and LINQ.

| | A. .NET WebAssembly | B. Own Roslyn → JS emitter (recommended) | C. Adapt Transpose |
|---|---|---|---|
| Visitor download | .NET runtime + trimmed assemblies, roughly 1–3 MB compressed | Emitted JS + helper module (target < 10 KB) | Its `tps.js` runtime + an app bundle |
| Output shape | WASM, async boot | Exactly gpsb's modules | One bundle that registers types on a global runtime, not ES modules; would need a shim per class and a shared runtime per page |
| Per-frame cost | JS↔WASM interop for every node access | None | Small (runtime type system) |
| C# coverage | Almost all of .NET | A documented subset (table below) | Wide (successor of H5/Bridge.NET) |
| Maturity | Mature | Ours to build | Rewrite announced Aug 2026, Apache-2.0, Roslyn-based |

Option C is new and could cut the build cost of B substantially if its output can be split per behaviour. The spike
tests it before B is started. A is rejected.

Supported subset for B (anything else is a compile error, never silently wrong JS; Roslyn's semantic model makes that
possible):

| C# | JS output | Notes |
|---|---|---|
| classes, inheritance, `virtual`/`override`, interfaces, `static` | ES classes | interfaces are compile-time only |
| properties, expression bodies | accessors | |
| public / `[SerializeField]` fields on a `Behaviour` | prop schema + accessors onto `this.props` | the initializer must be a constant: it becomes the default |
| private methods | `_`-prefixed (hidden from event pickers, as today) | |
| `Start`, `Update`, `OnClick`; `PascalCase` methods | `start`, `update(dt)`, `onClick`; camelCase | |
| overloads | made unique from Roslyn's resolved symbol (`add$1`) | engine API overloads mapped with `[JsName]` |
| `int` arithmetic | `/` → `Math.trunc`, `unchecked` wrap with `\| 0` | `float`/`double` both → `number` |
| `long`, `decimal`, `unsafe`, pointers | **error** in MVP | `long` → `BigInt` later if needed |
| user `struct`s | **readonly structs only** in MVP | avoids copy-on-assign emulation |
| generics | erased; `GetComponent<T>()` → `getComponent(T)` | |
| lambdas, `Action`/`Func`, C# `event` | closures, handler arrays | |
| string interpolation, `ToString("F2")` | template literals + format helper | |
| `List<T>`, `Dictionary<K,V>`, `HashSet<T>`, common LINQ | `Array`, `Map`, `Set` + small helper | other LINQ → error |
| `async`/`await`, `IEnumerator` + `yield return` | `async`/`Promise`, generators → coroutines | |
| `try/catch/finally`, pattern matching, `?.`, `??` | same / `instanceof` / `if` chains | |
| reflection, threads, `dynamic`, `System.IO`, `System.Net` | **error** with a clear message | use `Gpsb.Http.Fetch`, `JsonAsset` |

Needs the .NET SDK on the author's machine only.

### 4.3 Kotlin (second external language, adapt route)

- **Toolchain:** the official Kotlin/JS IR compiler supports ES modules (`useEsModules()`), one output file per Kotlin
  file (`kotlin.js.ir.output.granularity=per-file`), `@JsExport` and generated `.d.ts`. One file per behaviour
  matches gpsb's one module per script.
- **API fit:** properties and delegated properties (`var speed by prop.number(90.0)`) make serialized fields read and
  write `props` with no field sync. `operator fun plus` for `Vector2`. `suspend` functions for coroutines.
- **Metadata:** a KSP processor (or a compiler plugin) emits the props schema and public methods from `prop.*`
  delegates and annotations.
- **Costs:** a Gradle + JVM toolchain (heavy install, slow cold start; the Gradle daemon keeps rebuilds fast) and the
  Kotlin standard library in the published output (dead-code elimination keeps only what's used). Measure in its spike.
- **Risks:** per-file output with ES modules has had compiler bugs reported in community channels; pin a known-good
  Kotlin version and test it in CI.

### 4.4 Java (third, reuses the JVM work)

- **TeaVM** (adapt): generates ES2015 modules since 0.10 and exports `@JSExport` static methods. I couldn't confirm
  whether it exports classes with constructors directly; if not, the shim calls an exported static factory
  (`Spin.create()`) and the instance's methods. TeaVM compiles the whole program (it bundles its own Java class
  library), so all Java behaviours of a project should be one TeaVM build with one shared runtime, and the shims import
  from it.
- **J2CL**: production-ready inside Google, but its open-source workflow is not finalized, it expects Closure Compiler
  and it doesn't support Windows. Not recommended.
- **Own transpiler** (javac Tree API with type attribution, like the C# route): only if TeaVM's output proves
  unsuitable. It would reuse much of the C# emitter's design.
- **Field sync** (2.1) handles serialized fields, since Java fields can't be intercepted. Annotation processing during
  `javac` extracts the schema.
- The Java API needs getters and setters (`rectTransform().setRotation(…)`), so it is wordier than in the other
  languages. Records make `Vector2`/`Color` immutable for free.

### 4.5 Haxe (optional)

C-family syntax, a fast single-binary compiler with a game-development background (Flash/OpenFL, Heaps). Build macros
can generate the schema and rewrite `@:prop` fields into props accessors at compile time, which is the cleanest
metadata story of all the adapt-route languages. Split ES modules and `.d.ts` come from the `genes` library (third
party, some versions labelled experimental). Cheap once the shim route exists; small community.

### 4.6 Not recommended

- **Dart**: dart2js produces a bundle with its own runtime; exposing a class to JS goes through
  `createJSInteropWrapper` (an object and a closure per method), which doesn't match gpsb's class-per-module model.
- **WASM languages** (C, C++, Rust, Swift, Go via TinyGo, AssemblyScript): every node read or write and every string
  crosses the JS↔WASM boundary. Behaviours do this every frame. Their place is computation-heavy helpers (physics,
  image processing) loaded as an asset and called from a JS/TS behaviour, which works today. Document that.
- **Scala.js** works the same way as Kotlin through the adapt route, with a larger runtime and smaller audience. Leave
  it to a community plugin.

---

## 5. Plan

### 5.1 Phase 1: engine API in JS (about 2–3 weeks)
| | Item | Design |
|---|---|---|
| ☐ | `api/engine.json` | The machine-readable API description. For now the typings are hand-written (`lib/engine.d.ts`, `tween.d.ts`, `frame.d.ts`); the description is needed when a second language's bindings have to be generated. |
| ☑ | `lib/engine.js` | `Behaviour`, `prop.*`, `Time`, `Mathf`, `Random`, `Assets`, `Vector2/4`, `Color`, `WebObject`, `RectTransform`, typed component wrappers (`ComponentRef`, from the registry's schemas), `WebEvent`, coroutines. `adapt()` waits for the first adapt-route language. |
| ☑ | Shared frame loop | `lib/frame.js`: `Time` (with `timeScale`), one ordered loop for behaviours (`update`, new `lateUpdate`), coroutines and tweens. |
| ☑ | Automatic apply | Wrapper setters call `markDirty`; every marked node is applied once at the end of the task (a microtask), so no extra hooks in `lib/behaviours.js` were needed. `apply()` keeps working. |
| ☑ | `defineExtension(Class)` | Class-form extensions → today's definition object; `html` template tag that escapes by default. |
| ☑ | Tweening library | `lib/tween.js` (not in the original plan): tweens on property paths, objects and setters; eases, loops, sequences, shortcuts on `WebObject`. |
| ◐ | Editor reflection | Method scan skips getters. Reading `static methods` (for languages whose private methods can't be told apart) is still to do. |
| ☑ | Docs + tests | `docs/engine-api.md`, `docs/tweening.md`; `test/scripting.test.js`; a fixture project (`test/fixtures/scripting/`) checked in headless Chromium by `test/e2e.js`. The demo project still uses plain behaviours. |

### 5.2 Phase 2: TypeScript and the plugin hook (about 2–3 weeks)
| | Item | Design |
|---|---|---|
| ◐ | Plugin hook in `cli.js` + editor | 3.3 is done for TypeScript (discovery, dev server, build, Node import hooks, editor). It's wired in directly; the generic stdio protocol (3.2) comes with the first external language. |
| ☑ | Typings | `gpsb types`, regenerated by the dev server; `project.d.ts` types every component's props. |
| ◐ | Editor | Language picker, TypeScript templates, Project panel entries, compile errors in the Console. Syntax highlighting in the code editor is still to do (it has none for any language yet). |
| ☑ | `<script lang="ts">` in custom components | `lib/compile.js` compiles it before writing `Name.script.js`. |
| ◐ | Conformance suite | The TypeScript fixture checks end state after it runs (positions, colours, text, events) in Chromium. Still to do: the same behaviours in plain JS, compared frame by frame. |

### 5.3 Phase 3: C# (spike 1 week, then about 6–10 weeks)
| | Item | Design |
|---|---|---|
| ☐ | Spike | (1) Try Transpose: can its output be split or shimmed per behaviour, and how big is its runtime? (2) Prototype the Roslyn emitter on `Spin.cs` and `Typewriter.cs`. (3) Measure warm recompile time. Pick B or C; write the decision here. |
| ☐ | `Gpsb.Engine` reference assembly | Generated from `api/engine.json`, with `MonoBehaviour`/`GameObject` aliases to ease porting. |
| ☐ | Emitter (or Transpose adapter) | 4.2; source maps; helper module `gpsb/cs.js`. |
| ☐ | Analyzer | Errors for unsupported features and for DOM use in build-time extension hooks. |
| ☐ | Project generation | `Scripts.csproj` + `Gpsb.Project.g.cs`. |
| ☐ | Tests | Golden tests (C# in → JS out) + the conformance suite. |

### 5.4 Phase 4: Kotlin (spike 1 week, then about 4–6 weeks)
| | Item | Design |
|---|---|---|
| ☐ | Spike | Kotlin/JS per-file ES modules for two behaviours; published size for `Spin.kt`; warm rebuild time through the Gradle daemon. |
| ☐ | Bindings | `external` declarations generated from `api/engine.json`; `prop.*` delegates. |
| ☐ | Metadata | KSP processor → props schema and methods. |
| ☐ | Plugin | `gpsb-kotlin`: runs the compile, writes shims, maps diagnostics. Gradle project generation for IntelliJ. |
| ☐ | Tests | Conformance suite. |

### 5.5 Phase 5: Java via TeaVM (about 3–4 weeks, after Kotlin)
| | Item | Design |
|---|---|---|
| ☐ | Spike | Class export vs static factory; runtime size of a one-behaviour project. |
| ☐ | Bindings + annotation processor | JSO interfaces from `api/engine.json`; `@Range`/`@Tooltip` → schema. |
| ☐ | Plugin | One TeaVM build per project; shims with field sync. |

### 5.6 Later
- Haxe plugin (4.5).
- `long` via `BigInt`, mutable user structs, more LINQ for C#.
- Typed languages for custom components (`WebComponent` base class).
- Runtime `Instantiate(prefab)` / `Destroy(webObject)`: the Unity API users will look for next; needs runtime prefab
  expansion (`lib/prefab.js` is already isomorphic).
- Community plugins (Scala.js, …) through the documented protocol.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Code that looks like Unity C# doesn't compile | Frustrated users | Errors (never silently wrong output) linking to the supported-subset doc; port the demos early. |
| Several languages to maintain | Ongoing cost | One API description generates every binding; one conformance suite; plugins live in their own repos with their own releases; add a language only after the previous one passes. |
| Runtime size for adapt-route languages | Slower pages | Measure in each spike; publish the numbers in the docs; dead-code elimination; one shared runtime per page. |
| Heavy toolchains (.NET SDK, JVM + Gradle) | Setup step | Opt-in only, clear install messages; JS/TS need nothing. |
| Upstream compiler changes (Kotlin/JS, TeaVM, Transpose) | Plugin breaks on upgrade | Pin versions; conformance suite in each plugin's CI. |
| Two ways to write behaviours (plain vs engine API) | Confusing docs | Docs lead with the engine API; plain modules documented as the low-level contract. |
| Node's TS stripper is experimental on 22.x | Warning printed; API could change | Behind the plugin hook; easy to swap. |
| Automatic apply changes timing | Scripts expecting an immediate DOM update | Only for wrapper writes; `apply()` still applies immediately; documented. |
| API version mismatch between gpsb and a plugin | Broken scripts after an upgrade | `apiVersion` in compiled modules; runtime warning. |

---

## 7. Open decisions

1. **Which languages, in which order?** Recommended: TypeScript (built in) → C# → Kotlin → Java. Is Java itself a
   requirement (rather than Kotlin for the Java family)? If so, swap phases 4 and 5.
2. **Are heavy toolchains acceptable for authors?** (.NET SDK for C#, JVM + Gradle for Kotlin/Java.) gpsb core stays
   zero-dependency either way. Recommended: yes, opt-in.
3. **Where do plugins live?** Recommended: separate repos/packages, because they need NuGet/Maven dependencies and this
   repo has a zero-dependency rule. The API description and conformance suite stay here.
4. **Method naming in event lists:** camelCase in every language (recommended), or each language's own convention?
5. **Engine API naming:** Unity names (`MonoBehaviour`, `GameObject`, `transform`) or gpsb names (`Behaviour`,
   `WebObject`, `rectTransform`, matching gpsb's menus)? Recommended: gpsb names, with Unity aliases in the C# assembly.

---

## Sources (toolchain facts checked October 2026)

- TeaVM ES2015 modules and `@JSExport`: [Creating JavaScript modules](https://teavm.org/docs/runtime/js-modules.html),
  [Release 0.10.0](https://teavm.org/docs/release-notes/0.10.0.html)
- Kotlin/JS ES modules, per-file output, `@JsExport`: [JS project setup](https://kotlinlang.org/docs/js-project-setup.html),
  [JS to Kotlin interop](https://kotlinlang.org/docs/js-to-kotlin-interop.html)
- Haxe `genes` (split ES6 modules + d.ts): [lib.haxe.org/p/genes](https://lib.haxe.org/p/genes)
- Dart `@JSExport` / `createJSInteropWrapper`: [JSExport class](https://api.dart.dev/dart-js_interop/JSExport-class.html),
  [dart-lang/sdk#56906](https://github.com/dart-lang/sdk/issues/56906)
- J2CL status: [google/j2cl](https://github.com/google/j2cl)
- Transpose (successor to H5): [curiosity-ai/transpose](https://github.com/curiosity-ai/transpose),
  [docs](https://docs.curiosity.ai/transpose/), [launch post](https://blog.curiosity.ai/blog/2026-08-transpose-launch),
  [migrating from h5](https://docs.curiosity.ai/transpose/migrating-from-h5)
- Node type stripping: tested locally with Node v22.22.0 (`module.stripTypeScriptTypes`).
