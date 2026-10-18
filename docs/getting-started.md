# Getting started

## Install

gpsb has no dependencies. You only need [Node.js](https://nodejs.org) 22 or newer.

```sh
git clone https://github.com/graphicmismatch/graphicmismatch-s-perfect-site-builder.git gpsb
cd gpsb
npm link            # optional: makes the `gpsb` command available everywhere
```

Without `npm link`, run `node cli.js` from the gpsb folder wherever these docs say `gpsb`.

## Commands

| Command | What it does |
|---|---|
| `gpsb` or `gpsb hub` | Opens the Project Hub at <http://127.0.0.1:4000>. |
| `gpsb serve <dir>` | Same, with `<dir>` registered and opened in the editor. |
| `gpsb new <dir>` | Creates an empty project in `<dir>`. |
| `gpsb build <dir>` | Writes the static site to `<dir>/dist`. Add `--out <folder>` to write somewhere else. |

`serve` and `hub` accept `--port <n>`. The server only listens on `127.0.0.1`, so it can't be reached from other machines.

To look around first, open the demo project: `gpsb serve example`.

## Create a project

1. Run `gpsb` and open <http://127.0.0.1:4000> in your browser.
2. Click **New project**. Pick a template:
   - **Empty**: one blank page.
   - **Showcase**: a copy of the demo project, with components, behaviours and animations to learn from.
3. Choose a folder with the built-in folder browser and give the project a name.

The project opens in the editor. Later you can reopen it from the Hub, or from File ▸ Open Recent.

## Build your first page

1. **Add a background.** In the Hierarchy, select `Canvas`. In the Inspector, set Canvas ▸ Background to a colour.
2. **Add a heading.** Choose WebObject ▸ Text. A Text object appears in the middle of the page.
   - In the Inspector, type your heading into Text ▸ Text, set Size to 48 and Tag to `h1`.
   - In the RectTransform, click the anchor preset square and pick **top centre**. Hold Alt while clicking to move
     the object there too. Now it stays centred at the top however wide the window is.
3. **Add a button.** Choose WebObject ▸ Button. Change its label (the Text child) to "About".
4. **Make the button go somewhere.** Create a second page with File ▸ New Page… and name it `about`. Go back to
   `index` with the page switcher in the toolbar. Select the button and, under Button ▸ On Click (), click **+**.
   Leave the target empty (the button itself), pick **Node.Navigate** and type `about` as the argument.
5. **Try it.** Press Play (Ctrl+P). The Web view runs the page the way visitors will see it. Click the button.
   Press Play again to stop.
6. **Save** with Ctrl+S. Pages are stored as JSON in `pages/`.

## Build and publish

Click **Build Site** in the toolbar (or run `gpsb build <dir>`). The site is written to `dist/`:

```
dist/
  index.html  index.css
  about.html  about.css
  assets/     gpsb/     components/     behaviours/   ...
```

`dist/` is a plain static site: upload it to any host (GitHub Pages, Netlify, Cloudflare Pages, S3, your own server).
See [Publishing](publishing.md) for site URLs, clean URLs, 404 pages and more.

## What's in a project

```
project.json              name, breakpoints, design tokens, publishing settings
pages/**/*.json           one file per page (pages/blog/post.json -> blog/post.html)
assets/**                 images, video, audio, fonts, JSON and text files
animations/*.anim.json    animation clips
prefabs/*.prefab.json     reusable objects
components/*.html         custom components
behaviours/*.js           behaviour scripts
extensions/*.js           extension components
public/**                 copied to the site root unchanged (CNAME, _redirects, .well-known/)
build.js                  optional build hooks
```

Everything is plain text, so a project works well in git. The editor watches the folder and picks up changes you make
in your own text editor.

## Next steps

- Learn the panels and shortcuts in [The editor](editor.md).
- Learn how positioning works in [Layout](layout.md). It's the part that differs most from other site builders.
