# Animation

Animation works as in Unity: **clips** hold keyframes, and an **Animator** component plays them.

## Quick start

1. Select the object to animate, for example a hero section.
2. Open the **Animation** tab (bottom panel) and click **Create New Clip**. Name it. gpsb saves it to
   `animations/<Name>.anim.json` and adds an Animator with that clip to the object.
3. Press the red **record** button. Move the playhead to 0 s and set the starting values (for example Pos Y 40 and
   Canvas Group ▸ Alpha 0). Move the playhead to 0.6 s and set the end values. Each change writes a key.
4. Press record again to stop recording, then press play in the Animation window to preview the clip in the Scene.
5. Press Play in the toolbar to see it run on the page.

## What can be animated

Any property path, which covers almost everything in the Inspector:
- position, size, anchors, pivot, rotation, scale, Z index and active state,
- every component field: colours (including alpha), text, font size, layout spacing, radius, …,
- custom component props and behaviour props,
- sprites: keys on Image ▸ Sprite swap the picture, which makes frame-by-frame sprite animation.

Numbers, vectors and colours are interpolated. Text, booleans, choices and assets change in steps.

A clip's tracks are relative to the object with the Animator, so one clip can animate the object and any of its
children (`Logo`, `Header/Menu`).

## The Animation window

- **Clip dropdown:** switch between the Animator's clips, or create a new one.
- **Add Property:** add a track for any field of the object or its children, without recording.
- **Dopesheet:** keys are diamonds. Click or box-select them, drag to move them in time, Delete to remove them, and
  copy/paste them at the playhead. Double-click on a track to add a key.
- **Curves:** the same keys drawn as curves. Drag the bezier handles to shape the motion.
- **Key inspector:** the selected key's value and easing: linear, constant (step), ease-in, ease-out, ease-in-out, or a
  custom cubic bezier.
- **Timeline:** click or drag the ruler to scrub. Set the clip's length, samples per second and whether it loops.
- **Keyboard** (while the Animation window has focus): Space plays and pauses the preview, `,` and `.` step a frame
  (with Alt: jump to the previous or next key), K adds keys at the playhead, Ctrl+A / C / V select, copy and paste
  keys.

### Record mode

While record is on, every change you make in the Scene or Inspector writes a key at the playhead instead of changing
the object. Keyed fields are tinted red in the Inspector, and animated fields blue. Remember to turn record off before
you go back to editing the layout.

## The Animator

| Field | Meaning |
|---|---|
| **Clips** | The clips this Animator can play. The first is the default. |
| **Play On** | `start` (when the page loads), `hover`, `click`, `visible` (when it scrolls into view) or `manual` (only from an event or a script). |
| **Speed** | Playback speed multiplier. |

A looping clip repeats; a clip that doesn't loop holds its last frame.

Play, stop and pause clips from events (Animator.play with a clip name) or from scripts
(`this.animator.play('Clip')`, `GPSB.animator(id).play('Clip')`).

## Animation events

Click **Add event at the playhead** (or double-click the events row) to add an **animation event**. An event runs
one call at that time, using the same calls as [event lists](events.md): show or hide an object, navigate, play
media, or call a behaviour method. For example, a clip can call `behaviour:Typewriter.play` when an intro finishes.

## Tips

- Animations write the base values, so a responsive breakpoint override of the same field wins on that screen size.
- Position animations run on the GPU and don't relayout the page every frame.
- Use Canvas Group ▸ Alpha to fade an object together with all its children.
- Sprite animation: import the frames, record, and drop a different frame onto Image ▸ Sprite at each step.
