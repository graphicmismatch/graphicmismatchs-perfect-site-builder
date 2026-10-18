# Layout

gpsb positions things the way Unity's uGUI does. If you know Unity, the one difference to remember is that **the Y axis
points down**, as it does on the web: `y = 0` is the top edge and a larger `pos.y` moves an object down.

## RectTransform

Every object has a RectTransform. It describes a rectangle relative to the object's parent.

| Field | Meaning |
|---|---|
| **Anchor Min / Max** | Points inside the parent, from 0 to 1 on each axis. `(0, 0)` is the parent's top-left, `(1, 1)` its bottom-right. |
| **Pivot** | The point inside the object that its position refers to, and that it rotates and scales around. `(0.5, 0.5)` is the centre. |
| **Pos X / Pos Y** | Where the pivot sits, measured from the anchor. |
| **Width / Height** | The object's size (Unity's sizeDelta). |
| **Rotation, Scale** | Applied around the pivot. They don't affect layout. |
| **Z Index** | Drawing order among siblings. 0 keeps Hierarchy order; higher draws on top, negative goes behind. |

### Anchors

Anchors decide what happens when the parent changes size.

- **Both anchors at one point** (for example both at `(1, 0)`, the top-right): the object keeps its size and stays the
  same distance from that point. Use it for a logo in a corner or a button centred on the page.
- **Anchors apart on an axis** (for example Anchor Min X = 0 and Anchor Max X = 1): the object **stretches** with the
  parent on that axis. The Inspector then shows Left and Right (or Top and Bottom) instead of Pos and Width: the
  distances from the parent's edges.

The anchor preset square at the top of the RectTransform covers the common cases: the nine points, the three stretch
rows and columns, and full stretch. Hold Shift to set the pivot to match and Alt to move the object to that spot too.

In the Scene, the four triangles around the selected object are its anchors. Drag them to change the anchors.

### Example: a header bar

A header that spans the page and is 80 px tall:
- Anchor preset **top stretch** (Anchor Min `(0, 0)`, Anchor Max `(1, 0)`), Pivot `(0.5, 0)`.
- Left 0, Right 0, Pos Y 0, Height 80.

Inside it, a logo pinned to the left (anchor **middle left**, Pos X 24) and a menu pinned to the right (anchor
**middle right**, Pivot `(1, 0.5)`, Pos X -24).

## Layout groups

Positioning by hand works for posters and hero sections. For lists, rows of cards and text that should flow, add a
layout group to the parent. Its children are then placed automatically and their Pos fields are ignored.

| Component | Lays out children | Built with |
|---|---|---|
| **Horizontal Layout Group** | in a row | flexbox |
| **Vertical Layout Group** | in a column | flexbox |
| **Grid Layout Group** | in a grid of fixed-size cells | CSS grid |

Common settings:
- **Padding** (left, right, top, bottom) and **Spacing**.
- **Child Alignment**: which corner or edge the children gather at.
- **Control Width / Height**: the group sets the children's size instead of the children doing it.
- **Expand Width / Height**: children share out the leftover space.
- **Reverse** reverses the order. **Wrap** lets a row or column continue on a new line.
- Grid: **Cell Size**, **Constraint** (flexible, fixed number of columns, or fixed number of rows) and **Count**.

Fine-tune individual children with a **Layout Element**: min, preferred, flexible and max sizes, or **Ignore Layout**
to position that child by hand. A Max Width in a vertical layout also centres the child, which is how a content column
is made.

**Content Size Fitter** makes an object as big as its content (set Horizontal or Vertical to `preferred`). Text that
should wrap and grow downwards needs a fixed width and Vertical = preferred.

**Aspect Ratio Fitter** keeps one side in proportion to the other.

The **⤢** button next to Width and Height is a one-off version of this: it sizes the object to fit its children right
now.

## Flowing pages

A page laid out entirely by hand has a fixed height (Canvas ▸ Height, 0 = one screen). For articles and long pages,
use **File ▸ New Flowing Page…**. Its Canvas has a vertical layout group, so its **Sections** stack from the top and
the page grows with its content. Add more with WebObject ▸ Section, Content Column, Text Block and Markdown.

You can mix both styles: a flowing page can contain a hand-placed hero section, and any object can hold a layout
group.

## Scroll views, masks and clipping

- **WebObject ▸ Scroll View** builds Unity's structure: `Scroll View > Viewport > Content` with a scrollbar beside
  the viewport. The Viewport's **Scroll Rect** does the scrolling with the browser's native scrolling, so touch,
  wheel and keyboard all work. Options include snapping to children, smooth scrolling and hiding the native
  scrollbars.
- **Mask** clips children to the object's rectangle, or to the shape of its Image when it has one.
- **Rect Mask 2D** clips to the rectangle with optional padding.

## Canvas Scaler

Set on the Canvas.
- **constant**: one unit is one CSS pixel. The usual choice for websites.
- **scale-with-screen**: you design at a reference resolution (say 1920 × 1080) and the whole page scales to fit the
  window. **Match** chooses whether width (0) or height (1) decides the scale. Good for slide-like or game-like pages.

## Responsive breakpoints

Breakpoints let one page look right on desktops, tablets and phones. The defaults are **Tablet** (up to 1024 px wide)
and **Phone** (up to 600 px wide). Edit them with Edit ▸ Breakpoint ▸ Edit Breakpoints… or in the Scene toolbar.

1. Pick a breakpoint in the Scene toolbar (or press Alt+2, Alt+3, …; Alt+1 goes back to the base layout). The Scene
   resizes to that width.
2. Change anything: move or resize objects, change anchors, font sizes, spacing or text, or untick Active to hide an
   object on that size.
3. Each change is stored as an **override** for that breakpoint only. Overridden fields show a blue bar in the
   Inspector. Right-click a field to revert it.

Overrides cascade from wide to narrow: at 500 px both Tablet and Phone apply, and Phone wins where both set the same
field. They're written as CSS `@media` rules, and also apply while scripts and animations run.

## Tips

- **Smart guides** and **Snap** (Scene toolbar) help line things up. **WebObject ▸ Align** aligns or distributes the
  selection; with one object selected it aligns within its parent.
- Check your page at several sizes with the resolution dropdown. Anchors that look right at one width can overlap at
  another.
- Generated Code shows the CSS each object produces, which helps when a layout surprises you.
