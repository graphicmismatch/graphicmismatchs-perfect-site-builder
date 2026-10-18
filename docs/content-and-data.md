# Content and data

## Text

The **Text** component holds the words: font, size, colour, weight, alignment (including vertical), line height,
letter spacing and wrapping. Set **Tag** to `h1`–`h6`, `p`, `span` or `label` so search engines and screen readers
understand the page. Text can contain inline HTML such as `<b>`, `<em>`, `<a href>` or `<br>`.

The Text field is a rich text editor: select words and use the toolbar (or Ctrl+B, Ctrl+I, Ctrl+U) for bold, italic,
underline and strikethrough, add or remove a link, pick a colour, or clear the formatting. Labels, buttons and text
blocks all use it. **</>** shows the HTML underneath, to edit it directly. A link can name a page (`about`) as well as a
URL or `#anchor`; page names become the page's address when the site is built. Pasted text comes in unformatted.
Text with scripts or event handlers opens as HTML, since the formatted view never runs them.

- **Fonts:** type any CSS font family (`Georgia, serif`), or drop a font file from `assets/` onto the Font field. Font
  files get an `@font-face` rule automatically. A list mixes both, for fallbacks:
  `fonts/Game.ttf, fonts/Mono.ttf, monospace` uses Mono for characters Game lacks. The Canvas's Font is the default
  for the whole page.
- **Text styles:** pick a project text style (Text ▸ Text Style) to set font, size, weight, line height and letter
  spacing in one go. See [Design tokens](prefabs-and-tokens.md#design-tokens).
- **Long text:** use WebObject ▸ Text Block, which wraps and grows downwards, or Markdown.

## Images

- **Image** draws a picture (its Sprite), or a plain colour when it has no sprite. Fit is fill, contain, cover or
  none, and Radius rounds the corners. A plain-colour Image is how you make panels, cards and dividers.
  - **Element: img** writes a real `<img>` tag: searchable, lazy-loaded, with **Alt** text. Use it for content images.
    Set Loading to `eager` for images that are visible straight away, such as a logo or hero picture.
  - **Element: background** uses a CSS background. Use it for decoration.
- **Raw Image** shows part of a texture (UV Rect), for sprite sheets.

Drag images into the Project panel to import them, then drag them onto the Scene to create an Image.

## Media and embeds

- **Video:** autoplay, loop, muted, controls, poster image and fit. Browsers only autoplay muted video.
- **Audio:** autoplay, loop, controls.
- **IFrame:** embed another page of your site or any URL (maps, players). Give it a Title for screen readers.
- Buttons and other events can play, pause or toggle media: see [Events](events.md).

## Links and buttons

- **Link** turns an object into an `<a>`. Its Href takes a page name (`about`), a URL, or `#anchor`. To make an
  anchor target, give an object an **Element** component with an Id.
- **Button** has colour or sprite transitions for hover and press, and an **On Click ()** event list.

## Forms

**Toggle**, **Toggle Group**, **Slider**, **Input Field** and **Dropdown** use the browser's own controls, so they work
with the keyboard, screen readers and autofill. What the visitor types or picks is passed to their events (On Value
Changed, On End Edit).

To send a form somewhere, add a **Form** component to a parent object:
- **Action** is the URL the fields are sent to (a form service such as Formspree, or your own endpoint), with Method
  `get` or `post`. Leave Action empty to handle the form only with On Submit.
- Give each control a **Name**: it's the field name that is sent.
- Set a Button's Type to `submit`.

## Raw HTML and CSS

- **HTML** inserts any markup you write.
- **Style** adds CSS to one object: declarations, hover declarations, full rules (where `&` means this object) and
  extra class names. Its declarations override every other component's, and they stay in place when an animation, a
  script or a breakpoint restyles the object. Breakpoint overrides of any Style field work.
- **Element** sets the HTML tag (`section`, `nav`, `header`, `ul`, …), id, tooltip, role and ARIA attributes.

## Markdown

The **Markdown** component renders a `.md` file from `assets/`, or text typed into the Inspector. It supports headings
(with link anchors), bold, italic and strikethrough, nested lists, tables, code blocks, quotes, horizontal rules,
links and images. Links to page names go to
those pages, and relative images load from `assets/`. Raw HTML is escaped unless you tick **HTML**.

WebObject ▸ Markdown creates one that grows with its content.

## JSON data and bindings

Put JSON files in `assets/` (for example `assets/data/site.json`) and refer to them from any text field with a
**binding**:

```
{{data/site.json:hero.title}}
{{data/site.json:team[0].name}}
```

The part before `:` is the file path inside `assets/`, and the part after is a dot path into the JSON. Bindings are
filled in at build time, so the built site contains the real text. Unresolved bindings are left as they are.

### Repeat

A **Repeat** makes one copy of its children for each item in a JSON array:

1. WebObject ▸ Repeat. It comes with a vertical layout and an `Item` child.
2. Set Repeat ▸ Source to a JSON file and Path to the array inside it (for example `team`). Limit caps the count.
3. Design the child once. Inside it, `{{item.name}}`, `{{item.photo}}` and `{{index}}` refer to the current item.
   For an array of plain strings, use `{{item}}`.

Repeats can be nested: an inner Repeat with no Source reads `Path` from the current item (for example `item.tags`).

### Loading data at runtime

Scripts can load JSON or text after the page has loaded, for example data that changes more often than you rebuild:

```js
const site = await GPSB.assets.json('data/site.json');
```

See [Runtime API](runtime-api.md).

## Collection pages

A collection page is a template that the build turns into many pages, one per item in a JSON array. It's how you
make a blog, a portfolio or product pages.

1. Create a page, for example `post`.
2. On its Canvas, set **Collection** to a JSON file, **Collection Path** to the array inside it, and **Slug Field**
   to the item field used in the URL (default `slug`).
3. Use `{{item.title}}`, `{{item.body}}` and so on in any field, including Markdown and images.
4. Pick which item to preview with the dropdown in the Scene toolbar.

The build writes `post/<slug>.html` for each item (or `post/<slug>/` with clean URLs) and adds them to the sitemap.
Link to one with `post/<slug>`, and build an index page with a Repeat over the same JSON.
