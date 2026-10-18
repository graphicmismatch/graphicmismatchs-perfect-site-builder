# Prefabs and design tokens

## Prefabs

A prefab is a reusable object, such as a header, a footer, a card or a call-to-action block. Change the prefab and every
copy of it on every page updates.

### Making one

Right-click an object in the Hierarchy (or use WebObject) and choose **Create Prefab…**. The object and its children
are saved to `prefabs/<Name>.prefab.json`, and the object on the page becomes an **instance** of it, shown in blue.

### Using one

Drag the prefab from the Project panel's Prefabs folder onto the Scene or Hierarchy, or use WebObject ▸ Add Prefab.

### Overrides

Each instance can differ from its prefab: a different heading, colour or image. Change a field inside an instance
and it becomes an **override** for that instance only. Overridden fields are bold in the Inspector. Right-click one ▸
**Revert to Prefab** to undo it.

Each instance's position, size, name and active state always belong to the instance.

### The prefab bar

When an instance is selected, the Inspector shows a prefab bar:
- **Open** edits the prefab itself (the Hierarchy's ◀ goes back to the page). Every instance updates and keeps its
  overrides.
- **Apply** writes this instance's overrides into the prefab, so every instance gets them. This can't be undone.
- **Revert** drops this instance's overrides.
- **Unpack** turns the instance back into ordinary objects that are no longer linked to the prefab.

Adding or removing children or components inside an instance isn't allowed, as in Unity: open the prefab, or unpack
the instance.

Prefabs can contain other prefabs. They're expanded into the pages when you build, so the built site has no trace of
them.

## Design tokens

Design tokens are named values shared by the whole project. Use them instead of typing the same colour or font
everywhere, and you can restyle the site by changing one value.

Open **File ▸ Project Settings ▸ Design Tokens**. There are three kinds:

| Kind | Holds | Use it with |
|---|---|---|
| **Colours** | a colour, e.g. `brand` = `#ff3366` | ◆ next to any colour field |
| **Fonts** | a CSS font family or a font file from `assets/` | ◆ next to any font field |
| **Text styles** | font, size, weight, italic, line height, letter spacing | Text ▸ Text Style |

A field that uses a token shows its name (`$brand`) instead of a value. Tokens are written as CSS variables
(`--gpsb-color-brand`, `--gpsb-font-heading`), so changing one updates every page. Renaming a token updates everything
that uses it.

Tokens also work in breakpoint overrides and animation keys. A text style only sets the fields it has values for, so
you can make a style that just sets the font and size.

Tokens are stored in `project.json`:

```json
"tokens": {
  "colors": { "brand": "#ff3366", "ink": "#1b1e33" },
  "fonts": { "heading": "fonts/Lato-Black.ttf", "body": "system-ui, sans-serif" },
  "textStyles": { "h1": { "font": "$heading", "size": 48, "weight": "800", "lineHeight": 1.1 } }
}
```
