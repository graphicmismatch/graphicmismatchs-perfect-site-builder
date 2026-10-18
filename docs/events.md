# Interactivity and events

Many components have **event lists**, like Unity's UnityEvents: Button ▸ On Click (), Toggle, Slider, Input Field and
Dropdown ▸ On Value Changed, Input Field ▸ On End Edit, Form ▸ On Submit, Scroll Rect ▸ On Value Changed. Custom and
extension components can have their own. When the event happens, every entry in the list runs, in order.

You can make a lot of interactive pages this way without writing code.

## Adding an entry

1. Select the object (for example a Button) and find its event list in the Inspector.
2. Click **+** to add an entry.
3. **Target:** drop an object from the Hierarchy, or use the picker. Leave it empty to target the object that owns the
   event.
4. **Call:** pick what to do. The menu lists only what the target can do.
5. **Argument:** fill it in if the call takes one.

Events only run on the published page and in Play mode, not while you edit.

## Calls

| Call | Argument | What it does |
|---|---|---|
| Node.SetActive | `true`, `false` or `toggle` | Shows, hides or toggles the target. |
| Node.ScrollTo | | Scrolls the page until the target is in view. |
| Node.Navigate | page name, URL or `#anchor` | Goes to another page or site. |
| Animator.play | clip name (empty = the default clip) | Plays an animation on the target's Animator. |
| Animator.stop, Animator.pause | | Stops or pauses it. |
| Media.play, Media.pause, Media.toggle | | Controls the target's Video or Audio. |
| *Script*.*method* | any text | Calls a method of a behaviour script on the target (`behaviour:Spin.reverse`). |

Behaviour methods are listed under the script's name. Methods named `start`, `update` or starting with `_` are left
out. See [Making behaviours](behaviours.md).

### Passing the value of a form control

On a form control's events (Slider, Toggle, Input Field, Dropdown and similar extension components), an entry with an
**empty argument receives the control's current value**: the slider position, `true`/`false` for a toggle, the text
typed, or the selected option's index. That's how a slider can drive a behaviour method directly.

## Examples

- **A menu that opens and closes:** a Button with On Click → target `Menu Panel`, Node.SetActive, `toggle`. Untick
  Active on the panel so it starts closed.
- **Smooth scroll to a section:** a Button with On Click → target `Pricing`, Node.ScrollTo.
- **Play an intro when a button is pressed:** an Animator on the hero with Play On = manual, and a Button with On
  Click → target `Hero`, Animator.play, `HeroIntro`.
- **Play/pause a video:** On Click → target `Video`, Media.toggle.

## Other ways to react

- An **Animator** can play by itself on start, on hover, on click, or when the object scrolls into view (Play On).
  See [Animation](animation.md).
- Animation clips have **events** that run the same calls at a set time in the clip.
- A Button's **transition** shows hover and press states without any events.
- Behaviour scripts can handle clicks in `onClick(e)` and do anything else in code.
