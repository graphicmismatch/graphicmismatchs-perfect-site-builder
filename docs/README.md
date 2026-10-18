# gpsb documentation

graphicmismatch's perfect site builder (gpsb) is a visual static site generator modelled on Unity's uGUI. You build pages
in a Unity-style editor and it writes plain HTML, CSS and JS.

## User guides

Start here if you want to build a site.

1. [Getting started](getting-started.md): install, create a project, build your first page, publish it.
2. [The editor](editor.md): the panels, tools, menus and shortcuts.
3. [Layout](layout.md): RectTransforms, anchors and pivots, layout groups, scroll views, Canvas Scaler, responsive
   breakpoints.
4. [Content and data](content-and-data.md): text, images, media, Markdown, JSON bindings and filters, Repeat (sorting,
   grouping, pages), collection and tag pages, RSS, the Content window (a CMS for your collections), drafts and scheduling.
   [Forms](forms.md): contact forms that send to a form service or your endpoint, validation, spam protection, events.
   [Widgets](widgets.md): icons, navigation menu, social links, carousel, tabs, accordion, modal, gallery, video, map,
   countdown.
5. [Interactivity and events](events.md): Button On Click and the other event lists, and what each call does.
6. [Animation](animation.md): clips, the Animation window, record mode, curves, sprite swaps, animation events.
7. [Prefabs and design tokens](prefabs-and-tokens.md): reusable objects and project-wide colours, fonts and text styles.
   [Sections, themes and templates](sections-and-themes.md): ready-made page sections, one-click themes, starter sites.
8. [Publishing](publishing.md): building, project settings, hosting, custom code, build hooks.

## Developer guides

Start here if you want to add your own code. There are three ways to extend gpsb, and they suit different jobs:

| | Behaviour | Custom component | Extension component |
|---|---|---|---|
| File | `behaviours/<Name>.js` or `.ts` | `components/<Name>.html` | `extensions/<Name>.js` or `.ts` |
| Is | A script attached to an object, like a Unity MonoBehaviour | A Web Component (custom element, Shadow DOM) | A component definition, the same format the built-ins use |
| Runs | In the browser only (published page and Play mode) | In the browser | At build time **and** in the browser |
| Output | Changes the object it's on, at runtime | Its own markup and scoped CSS inside a shadow root | Real HTML and CSS written into the page |
| Good for | Motion, game-like logic, reacting to clicks, driving other objects | Self-contained widgets with their own look | Anything that should be in the static HTML: embeds, data, third-party widgets, new layout or form controls |
| Guide | [Making behaviours](behaviours.md) | [Making custom components](components.md) | [Making extension components](extensions.md) |

All three get Inspector fields from a props schema, and all of them can be targets or sources of events.

- [Engine API](engine-api.md): the Unity-style scripting API (`Behaviour`, typed props, `getComponent`, `Vector2`,
  coroutines, [tweening](engine-api.md#tweening) with eases, loops and sequences, class-form extensions).
- [TypeScript](typescript.md): write scripts in TypeScript, with types for your project's components.
- [Packages and JavaScript libraries](packages.md): install npm packages with the Package Manager and import them by
  name; other ways to use a library.
- [Prop types](prop-types.md): the schema format all three share.
- [Runtime API](runtime-api.md): `window.GPSB`, which every script on a published page can use.
- [CONTRACT.md](../CONTRACT.md): the full internal spec (file formats, architecture). Read it before changing gpsb itself.
