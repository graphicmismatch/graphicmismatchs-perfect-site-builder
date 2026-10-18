# Multiple languages

A site can have several languages. The first one is the **default**: its pages are at the site root, as before. Each
other language gets the same pages under its code: `fr/index.html`, `fr/about.html`, `fr/post/first-post.html`.

## Set up

1. **Project Settings ▸ Languages ▸ Add a language…** The first time, the default (English) is added along with the
   one you pick. Rename them, or change a code (its translations follow), as needed. **↑ Default** makes another
   language the default: its translations become the base texts.
2. Add a **Language Switcher** to your header (Add Component ▸ Navigation ▸ Language Switcher): links (or a drop-down)
   to the page being viewed in each language, showing the language's name or code.

## Translate pages

Pick a language in the **language selector** at the right of the Scene toolbar. While a language other than the
default is selected:

- the Scene shows that language's version of the page, and a banner reminds you which one you're editing;
- any change you make (text, typed on the canvas or in the Inspector; a picture; an Alt text; a link; even a size or
  position for a longer word) is recorded for **that language only**, like a breakpoint override. The Inspector marks
  changed fields and its **Overrides ▾** menu reverts them;
- anything you don't change stays as in the default language.

Switch back to the default language to edit the base page.

## Translate data

Collections and other JSON data are translated as whole files: next to `assets/data/posts.json`, a
`posts.fr.json` is used by the French pages instead. In the Content window, **⋯ ▸ Translate into Français…** makes the
copy for you and opens it; it shares the original's schema. A file without a translation is used as it is.

## Shared words: `{{t:…}}`

For words used in many places (menu labels, button texts, "Read more"), put them in `assets/locales/<code>.json`:

```json
// assets/locales/en.json
{ "nav": { "home": "Home", "contact": "Contact" }, "readMore": "Read more" }
// assets/locales/fr.json
{ "nav": { "home": "Accueil", "contact": "Contact" }, "readMore": "Lire la suite" }
```

and write `{{t:readMore}}` or `{{t:nav.home}}` in any text field. A key missing from a language uses the default
language's text.

## What the build writes

- `<html lang="fr">` on the French pages; dates formatted with `{{… | date}}` use the page's language.
- `<link rel="alternate" hreflang="…">` to the page in every language (and `x-default`), when the project's Site URL
  is set, so search engines show visitors the right one. Every language's pages are in the sitemap.
- Links between pages stay in the language being viewed; pictures and other assets are shared.
- The 404 page and RSS feeds are written for the default language only.

Visitors aren't redirected by their browser's language: the Language Switcher lets them choose. To redirect, add a
rule at your host (for example Netlify's `Language` redirect conditions) in `public/_redirects`.
