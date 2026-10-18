# Packages and JavaScript libraries

gpsb has a package manager modelled on Unity's. It installs JavaScript libraries from [npm](https://www.npmjs.com) into
your project, and your behaviours and extensions import them by name:

```ts
// behaviours/Party.ts
import { Behaviour } from '../gpsb/engine.js';
import confetti from 'canvas-confetti';
import dayjs from 'dayjs';

export default class Party extends Behaviour {
  onClick() {
    confetti({ particleCount: 120, spread: 70 });
    console.log(dayjs().format('dddd'));
  }
}
```

There's no bundler and no `node_modules`. gpsb downloads each package once and stores it in `packages/`. It converts
CommonJS packages into ES modules, and it gives every page an [import map](https://developer.mozilla.org/docs/Web/HTML/Element/script/type/importmap)
so the browser knows where `'dayjs'` lives. Packages never run install scripts.

## The Package Manager window

**Window ▸ Package Manager…** opens it.

- **In Project** lists your packages, with a ↑ badge when a newer version is out. It also lists the packages they
  depend on, and type packages (`@types/…`, used only for TypeScript).
- **npm Registry** searches npm. Select a package to see its description, license, homepage and versions.
- **Install**, **Update to …**, **Remove**, or pick a version from the list to switch to it. Type `name` or
  `name@version` next to **Add** to install by name.
- The details show how to import the package, and whether it's an ES module, a converted CommonJS package, or only
  files (CSS, fonts).

Previews and Play mode use a new package straight away. The editor itself reads your scripts to show their props and
methods; for scripts that import a *new* package, it needs a reload. The window offers **Save and Reload Editor**.

## From the command line

Run these in the project folder, or pass `--dir <project>`:

```sh
gpsb add canvas-confetti          # newest version, saved as "^1.9.4"
gpsb add three@0.170.0 dayjs@^1   # an exact version or a range
gpsb add gsap@next                # a dist-tag
gpsb remove dayjs
gpsb update                       # newest versions the manifest's ranges allow (gpsb update three: just one)
gpsb install                      # download what the lock lists but packages/ lacks (after cloning)
gpsb packages                     # list, with newer versions
gpsb search tween
```

## Files

| | |
|---|---|
| `packages/manifest.json` | What you asked for: `{ "dependencies": { "canvas-confetti": "^1.9.4" } }`. You can edit it by hand, then run `gpsb install`. |
| `packages/packages-lock.json` | What was installed: exact versions, download URLs, integrity hashes, and each package's entry points. Commit it. |
| `packages/<name>/` | The installed files. Commit them to build without network access, or leave them out: the build, the editor and `gpsb install` restore missing packages from the lock. |

Like Unity, a project has **one version of each package**. If two packages want different versions of a dependency,
gpsb picks the highest version that satisfies both. When no single version does, a package in your manifest wins over
a dependency's request, and gpsb warns you. Versions use npm's ranges (`^1.2.0`, `~1.2`, `1.x`, `>=2 <3`, `1.2 - 2.0`,
`||`), and prereleases are only picked when you ask for one.

A downloaded package is checked against its integrity hash, and files that would land outside `packages/<name>/` are
refused.

### Other registries

```json
{
  "registry": "https://registry.example.com/",
  "scopedRegistries": [{ "name": "Company", "url": "https://npm.company.com/", "scopes": ["@company"] }],
  "dependencies": { "@company/widgets": "^2.0.0" }
}
```

`registry` replaces npm for every package; a scoped registry serves the packages in its scopes, as in Unity.
Registries that need a login aren't supported yet.

## How imports work

Each page's `<head>` gets an import map that sends every package name to its file inside `packages/`:

| You write | It loads |
|---|---|
| `import x from 'name'` | the package's browser entry: its `exports` (`browser`, `import`, `module` or `default` condition), else `module`, `browser` or `main` |
| `import y from 'name/sub'` | a subpath listed in the package's `exports` |
| `import z from 'name/dist/file.js'` | any file in the package, by path |

The same names work in **extensions at build time**: gpsb resolves them in Node the same way. The package has to load
in Node then, so it can't touch `window` or `document` when imported. Browser-only libraries go in `init`, or a
behaviour.

**CommonJS packages** (`require` and `module.exports`, like lodash, dayjs and React 18) are bundled into one ES module
per package, `packages/<name>/gpsb.esm.js`:
- The default export is `module.exports`: `import _ from 'lodash'`.
- Named exports gpsb can see in the code are added too: `import { useState } from 'react'`.
- `require('./file')`, JSON files and the package's `browser` field are followed. `require('other-package')` becomes an
  import of that package, so each package is loaded once.
- `process.env.NODE_ENV` is `'production'` in the browser.
- `require()` of a Node module (`fs`, `path`) throws if that code actually runs; gpsb warns when a package does this.

**ES module packages** written for bundlers sometimes import files without an extension (`import './util'`). gpsb adds
the extension when it installs the package and tells you.

**CSS and other files:** link them from an extension's `head` with `ctx.package(path)`, which gives the right URL on
every page:

```ts
head(ctx) { return html`<link rel="stylesheet" href="${ctx.package('leaflet/dist/leaflet.css')}">`; }
```

In scripts, `Assets.packageUrl('leaflet/dist/marker.png')` from the [engine API](engine-api.md) (or
`GPSB.ctx.package(…)`) does the same.

## TypeScript

Packages are typed automatically:
- **Packages with types:** their own declarations are used.
- **Packages without:** gpsb installs the matching `@types/…` package when there is one. It picks the version that
  matches the library's version, and installs the packages those types import.
- **Neither:** imports of the package are typed `any`, so they don't cause errors.

All of this goes into `.gpsb/tsconfig.json`, which the project's `tsconfig.json` extends. See
[TypeScript](typescript.md).

## Publishing

The build copies the packages the site uses to `dist/packages/`, without typings (`@types/…`, `*.d.ts`). The manifest
and lock stay in the project. Import maps work in every current browser (Chrome and Edge 89+, Safari 16.4+, Firefox
108+).

## What doesn't work

- **Packages that need Node** (file system, network servers, native addons) can't run in a browser. gpsb never runs
  install scripts, and warns when a package has them.
- **CommonJS that builds `require()` paths at runtime** (`require('./locale/' + name)`): only `require` calls with a
  plain string are bundled.
- **CommonJS code that relies on sloppy mode**: the bundle is an ES module, which is strict, so a library that uses
  `this` as the global object in a plain function call can fail.
- **Two versions of one package** in the same project.

## Other ways to use a library

The package manager is the easiest way, but these work too:

| | How | Good for |
|---|---|---|
| A CDN | `import confetti from 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/+esm'` in a behaviour, or `await import(…)` inside an extension's `init`. Don't import a URL at the top of an extension: the build runs in Node, which can't load URLs. | Trying something out; no files in your project. |
| A file you copy in | Put the library's ES module build in `assets/vendor/` (or `public/vendor/`, served at `vendor/`) and import it with a relative path: `import { x } from '../assets/vendor/x.js'`. | Libraries not on npm, or a single file you've changed. |
| A `<script>` tag | An extension's `head` hook, Project Settings ▸ Custom Code, or Page Meta ▸ Head; then use the global it creates (`window.L`). Use `ctx.asset(…)` in `head` for files in `assets/`, so the URL works on nested pages too. | Old libraries that only come as a global script. |

In TypeScript, declare what a CDN import or copied file contains: put a `.d.ts` next to a copied file, or add
`declare module 'https://…' { … }` in a `.d.ts` file in `behaviours/`.
