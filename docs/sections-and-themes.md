# Sections, themes and templates

You don't have to build every page from single objects. gpsb comes with ready-made **sections** (a header, a hero, a
pricing table, a footer…), **themes** that restyle all of them at once, and **templates**: whole starter sites made of
sections.

## Sections

**WebObject ▸ UI ▸ Section…** opens the section library. Each section is shown in your project's own colours and
fonts. Click one to add it to the page, after the section you have selected (or at the end).

| Category | Sections |
|---|---|
| Navigation | Header (logo, menu that folds into ☰ on phones, button), Footer (brand, links, social icons) |
| Hero | Hero, centred (headline, text, two buttons, a picture); Hero, split (text beside a picture) |
| Social proof | Logo strip, Numbers, Testimonials |
| Content | Features (three cards with icons), Text and picture, Questions (FAQ), Team |
| Sales | Pricing (three plans), Call to action |
| Media | Gallery |
| Forms | Contact (details beside a working form), Newsletter |

A section is ordinary objects: select any part of it and change it in the Inspector, on the canvas, or in the
Hierarchy. Replace the sample text and pictures (drag an image onto a picture's Image ▸ Sprite), and point the buttons'
Link ▸ Href at your pages. Make a section you'll reuse into a [prefab](prefabs-and-tokens.md).

Sections are made for **flowing pages** (File ▸ New Flowing Page, and every template page): they stack from top to
bottom and the page grows with them. Each one stretches across the window, keeps its content in a readable 1120px
column, and wraps its rows of cards on narrow screens. On phones (the Phone breakpoint) the padding shrinks, big
headlines get smaller and tall pictures get shorter.

The forms in the Contact and Newsletter sections are set to Formspree: add your form id, or choose another service (see [Forms](forms.md)).

## Themes

Sections take all their colours, fonts and text sizes from the project's [design tokens](prefabs-and-tokens.md):

| Tokens | Names |
|---|---|
| Colours | `primary` (buttons, links, accents), `onPrimary` (text on primary), `background`, `surface` (cards, bands), `text`, `muted` (secondary text), `border` |
| Fonts | `heading`, `body` |
| Text styles | `h1`, `h2`, `h3`, `lead`, `body`, `small`, `eyebrow` (small capitals above a heading), `button` |

**Project Settings ▸ Design Tokens ▸ Theme** sets them all in one click:

| Theme | Look |
|---|---|
| Clean | White, blue accent, system fonts. |
| Editorial | Warm paper, terracotta accent, serif headings. |
| Bold | Dark, lime accent, heavy type. |
| Warm | Cream and orange, rounded type. |
| Mono | Black and white, monospaced headings. |

Applying a theme replaces only the tokens it defines; tokens you added yourself stay. After that, change any single
token to make the theme your own: every section that uses it follows. The first time you add a section to a project
without these tokens, gpsb adds the Clean theme's.

## Templates

**New project** in the Hub (or `gpsb new <dir> --template <name> [--theme <name>]`) can start from a complete site:

| Template | Pages | Theme |
|---|---|---|
| Landing page | One long page: header, hero, logos, features, how it works, numbers, testimonials, pricing, FAQ, newsletter, call to action, footer. | Clean |
| Business | Home, About and Contact. | Editorial |
| Portfolio | Home with a grid of projects, one page per project (a [collection](content-and-data.md#collection-pages)), about and contact. | Bold |
| Blog | Paged list of posts, a page per post, tag pages, an RSS feed, about. Posts are edited in Window ▸ Content. | Warm |

Pick another theme when you create it, or later in Project Settings. The sample pictures are SVGs in `assets/img/`:
replace them with your own.
