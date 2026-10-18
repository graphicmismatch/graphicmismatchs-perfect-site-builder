# The editor

The editor runs in your browser at `http://127.0.0.1:4000/editor/` once a project is open. Its default layout copies
Unity's: the toolbar at the top, the Hierarchy on the left, the Scene in the middle, the Inspector on the right, and the
Project, Console, Animation and Generated Code tabs along the bottom.

## Objects and components

A page is a tree of **WebObjects** (Unity's GameObjects). Each one has:
- a name, and an active checkbox (inactive objects aren't shown),
- a **RectTransform** that positions it (see [Layout](layout.md)),
- any number of **components** that give it a look and a job: Image, Text, Button, a layout group, an Animator, a
  behaviour script and so on.

The root of every page is the `Canvas` object. It holds page-wide settings: title, description, background colour,
page height and default font.

Each object becomes one HTML element. Its children become child elements, and sibling order is drawing order: lower in
the Hierarchy draws on top.

## Panels

### Toolbar

- **Menus:**
  - **File:** new page, new flowing page, delete page, save, build, Project Settings, Project Hub, recent projects.
  - **Edit:** undo, redo, undo history, select all, find & replace, rename, duplicate, delete, frame selected,
    breakpoints, play/pause/step, Preferences.
  - **WebObject:** create objects from presets (Panel, Image, Text, Button, Link, form controls, media, layouts, Scroll
    View, Section, Markdown, Repeat, …) and your custom components; Align / Distribute; prefabs.
  - **Component:** add a component to the selected object.
  - **Window:** the [Package Manager](packages.md) (npm packages), reopen closed panels, switch or save layouts.
- **Tools:** View (Q), Move (W), Rotate (E), Scale (R), Rect (T).
- **Play** runs the page with its scripts and animations. **Page switcher.** **Build Site.**

### Hierarchy

The page tree. Click to select, Ctrl/Shift-click to select several, drag to reparent or reorder, F2 to rename.
Right-click to create objects, copy, paste (also as a child), rename, duplicate, delete, select children or set an
object inactive, or make a prefab. Prefab instances are shown in blue.

### Scene / Web

The real page, rendered live as it will be built.
- Drag objects to move them, or use the handles of the current tool. The Rect tool (T) resizes from edges and corners.
- The **anchor gizmo** (four small triangles) shows where the selected object is anchored. Drag it to re-anchor.
- **Snapping:** turn on Snap in the Scene toolbar, or hold Ctrl while dragging, to snap to the grid increment.
- **Smart guides** snap moved objects to their neighbours' edges and centres. Hold Alt to ignore them.
- The **resolution** dropdown previews the page at desktop, tablet and phone sizes, or a custom size.
- The **breakpoint** buttons choose which breakpoint your edits apply to (see [Layout](layout.md#responsive-breakpoints)).
- Scroll to zoom. Pan by dragging with the View tool (Q), the middle mouse button, or Space held down. F frames the
  selection.

**Play** switches to the Web view: scripts run, animations play, buttons work, links between pages work. Nothing you
do in Play mode is saved.

### Inspector

Shows the selected object's RectTransform and components.
- Drag a field's label left and right to scrub a number.
- **Anchor presets:** click the square at the top of the RectTransform. Shift also sets the pivot, Alt also moves the
  object.
- **⤢** next to Width / Height sizes the object to fit its children. On the Canvas's Height it makes the page as long
  as its content.
- Drop an asset from the Project panel onto an image, video, font or JSON field. Drop a Hierarchy object onto an
  object field.
- **Add Component** at the bottom lists every component by category, with a search box. It can also create a new
  behaviour or custom component and attach it in one step.
- Each component's menu can reset it, remove it, or move it up or down.
- Right-click a field to revert a breakpoint or prefab override. Overridden fields are marked (a blue bar for
  breakpoints, bold for prefab overrides). In record mode, keyed fields are tinted red.
- A field that another component fixes is greyed out and can't be edited, with the reason under it: Height with a
  Content Size Fitter shows *(affected by Content Size Fitter)*, Width and Pos inside a layout group show *(affected by
  parent's Vertical Layout Group)*, Text Size with a `font-size` in Style shows *(affected by Style)*. Change or remove
  what drives it to edit the field again.

When several objects are selected, the Inspector shows the first one, and RectTransform edits apply to all of them.

### Project

Your project's files: Assets, Prefabs, Components, Behaviours, Extensions and Animations.
- Drag files in from your desktop to import them. Drag assets out onto the Scene, Hierarchy or Inspector.
- **+ ▾** creates a folder, JSON file, component, behaviour script, extension component or animation clip from a
  template.
- Double-click a script, component or JSON file to edit it in the built-in code editor. You can also edit files in
  your own editor; gpsb reloads them when they change.
- Renaming a file updates every page, clip and prefab that refers to it.

### Animation

The dopesheet and curves editor for animation clips. See [Animation](animation.md).

### Console and Generated Code

The Console shows log messages from the editor and from the page (including your scripts' `console.log` and errors).
Generated Code shows the exact HTML and CSS the build will write for the current page.

## Arranging the editor

- Drag a panel tab to reorder it, move it to another area, or split an area.
- Right-click a tab to maximize it (Shift+Space), close it or move it. Window reopens closed panels.
- The layout dropdown in the toolbar offers Default, 2 by 3, 4 Split, Tall and Wide, and can save your own.
- **Preferences** (Ctrl+,): dark or light theme, accent colour, UI font size, autosave, and a shortcut editor.

Preferences and the project list are stored in `~/.config/gpsb/` (or `$GPSB_CONFIG_DIR`), so they apply to every
project.

## Saving and recovery

Ctrl+S saves every changed file. Unsaved changes are also kept in the browser while you work. If the editor closes
before you save, it offers to restore them next time you open the project. Preferences ▸ Saving turns on autosave.

## Shortcuts

Every shortcut can be changed in Preferences.

| Keys | Action |
|---|---|
| Q W E R T | View, Move, Rotate, Scale, Rect tool |
| Ctrl+S | Save |
| Ctrl+B | Build site |
| Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y | Undo / redo |
| Ctrl+D | Duplicate |
| Delete or Backspace | Delete |
| Ctrl+A | Select all |
| Ctrl+C / Ctrl+V | Copy / paste (through the system clipboard, so it works across pages and projects) |
| Arrow keys / Shift+arrow keys | Nudge by 1 px / 10 px |
| F | Frame selection |
| F2 | Rename |
| Ctrl+Shift+F | Find & replace |
| Ctrl+P / Ctrl+Shift+P / Ctrl+Alt+P | Play or stop / pause / step one frame |
| Alt+1, Alt+2, … | Edit the base layout, the first breakpoint, … |
| Shift+Space | Maximize the panel under the mouse |
| Ctrl+, | Preferences |
