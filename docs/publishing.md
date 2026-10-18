# Publishing

## Building

Click **Build Site** (Ctrl+B) in the editor, or run:

```sh
gpsb build my-site                 # -> my-site/dist
gpsb build my-site --out ../public # somewhere else
```

The command line builds what's saved on disk. The editor's Build Site button saves first, then builds.

Each page becomes `<page>.html` and `<page>.css`. Assets, components, behaviours, extensions and the small gpsb
runtime (`gpsb/`) are copied alongside. The output is plain HTML and CSS with unbundled ES modules: no server code and
no build step on the host.

The build refuses to write into a folder that holds the project or its sources, or into a non-empty folder that isn't
a previous build, so it can't overwrite your work by accident. A page or clip that can't be read fails the build, and
a broken custom component is skipped with a warning.

**Keep in output** (Project Settings ▸ Publishing, `keep` in `project.json`) lists files and folders in the output
folder that builds never delete. As in `.gitignore`, a folder ends with `/` and a file doesn't, and paths may be nested:

```json
"keep": [".git/", "CNAME", ".well-known/", "docs/notes.txt"]
```

Add `.git/` to make the output folder a repository of its own that you push to your host, such as a GitHub Pages repo.
An entry only matches its own kind: `.git` (no slash) would not keep the `.git` folder.

## Project settings

**File ▸ Project Settings…** has four sections.

### General

The project name.

### Publishing

- **Site URL**, e.g. `https://example.com/` or `https://example.com/docs/`. With it set, the build writes
  `sitemap.xml`, points `robots.txt` at it, and makes sites served from a sub-path work.
- **Clean URLs**: pages are written as `about/index.html`, so their address is `/about/` instead of `/about.html`.
- **Minify**: compact HTML and CSS. Your text, code and scripts are left as they are.
- **Keep in output**: files and folders in the output folder that builds leave alone, e.g. `.git/`, `CNAME` (see Building).

### Design Tokens

See [Design tokens](prefabs-and-tokens.md#design-tokens).

### Custom Code

HTML added to every page: at the end of `<head>` (fonts, analytics, meta tags) and at the end of `<body>` (chat
widgets, consent banners). For one page only, use the Canvas's **Page Meta** component ▸ Head.

## Per-page settings

- **Canvas:** title (the browser tab and search result title) and description.
- **Page Meta** (add it to the Canvas): language, favicon, social image (for link previews), canonical URL, `noindex`
  (keeps the page out of search engines and the sitemap) and custom head code.

## Special files

- **404 page:** a page named `404` becomes the page hosts show for missing addresses. Its links work from any path.
- **`public/`:** everything in this folder is copied to the site root unchanged, after everything else. Use it for
  `CNAME`, `_redirects`, `_headers`, `.well-known/`, `favicon.ico` or your own `robots.txt`. While you edit, the dev
  server serves it at the root too, so `public/vendor/x.js` is at `vendor/x.js` in previews and Play mode as well.
- **`packages/`:** [npm packages](packages.md). The build copies the ones the site uses to `dist/packages/` (without
  typings), and first downloads any the lock lists that are missing, e.g. in a fresh clone.

## Hosting

Upload the build folder to any static host:

| Host | How |
|---|---|
| GitHub Pages | Push `dist/` to a `gh-pages` branch, or build in a GitHub Action and deploy the folder. For a project site at `user.github.io/repo/`, set Site URL to that address. Add `public/CNAME` for a custom domain. |
| Netlify, Cloudflare Pages | Drag the built folder into their dashboard, or have their build install gpsb and run `gpsb build .`, with `dist` as the output folder. |
| Any web server | Copy `dist/` to the web root. |

Asset URLs contain a content hash (`?v=…`), so you can tell your host to cache `assets/` forever. Changing a file
changes its URL.

## Build hooks

For things the editor doesn't do, add a `build.js` file to the project root. It runs in Node during the build and is
never copied to the site. Both hooks are optional.

```js
// build.js
export function transformPage({ name, html, css, project, item }) {
  // return the parts you changed; `item` is set for collection pages
  return { html: html.replace('</body>', '<!-- built ' + new Date().toISOString() + ' -->\n</body>') };
}

export async function afterBuild({ out, root, project, pages, files }) {
  // e.g. write an RSS feed, a search index, or upload the site
  const fs = await import('node:fs/promises');
  await fs.writeFile(`${out}/pages.txt`, pages.join('\n'));
}
```

An error in a hook fails the build, so a broken hook never publishes a half-finished site.

## Extending the output

The generated pages are designed to be built on. Every element has `data-gpsb="<id>"` and a class from its object
name, the page data is in `<script id="gpsb-data">`, and `window.GPSB` is available once `gpsb:ready` fires. See
[Runtime API](runtime-api.md) and the developer guides.
