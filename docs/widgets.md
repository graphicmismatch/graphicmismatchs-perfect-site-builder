# Widgets

Ready-made pieces most sites need: icons, menus, slideshows, tabs, FAQs, pop-ups, galleries, videos and maps. Each one
is a built-in component, so it works like any other: set it up in the Inspector, animate its properties, react to its
events, and change it from code.

The easiest way to add one is **WebObject ▸ UI ▸ Widgets ▸ …**, which creates an object that's already set up (a
carousel comes with three slides, tabs with three panels). You can also add the component to an existing object with
**Add Component** (UI, Navigation, Interactive and Media).

Everything renders real HTML when you build, so search engines see your menu links, FAQ answers and tab contents, and
the page works before its JavaScript runs.

| Widget | Component | What it's for |
|---|---|---|
| Icon | `Icon` | One of ~190 built-in line icons. |
| Divider | `Divider` | A horizontal or vertical line. |
| Marquee | `Marquee` | Text scrolling sideways (announcement bar). |
| Countdown | `Countdown` | Days, hours, minutes, seconds to a date. |
| Navigation Menu | `NavigationMenu` | The site's links, folding into a ☰ menu on small screens. |
| Social Links | `SocialLinks` | Icons linking to your social profiles. |
| Carousel | `Carousel` | A slideshow of its child objects. |
| Tabs | `Tabs` | Tabbed panels, one per child object. |
| Accordion | `Accordion` | Questions that open to show their answer (FAQ). |
| Modal | `Modal` | A pop-up window (dialog). |
| Gallery | `Gallery` | A grid of images that open full screen. |
| Video Embed | `VideoEmbed` | A YouTube or Vimeo video. |
| Map | `Map` | An OpenStreetMap or Google map. |
| Contact Form | `Form` + fields | A form with name, email and message fields, ready to send. See [Forms](forms.md). |

## Icon

Pick an icon with the target button next to **Icon** (the picker can search), or type its name. It takes its colour
from **Color** and fills the object's rect. Give it a **Label** if it means something on its own (an icon-only link);
leave it empty if it's decoration next to text.

The icons are [Lucide](https://lucide.dev) icons (ISC licence). The build writes each one into the page as an inline
SVG, so pages don't download an icon font. Changing the icon from an animation or a script loads the set when it's
first needed.

## Navigation Menu

**Items** is one link per line, `Label | where`. Where can be a page name (`about`, `blog/first-post`), a URL, or an
`#anchor`. The link to the page being shown gets `aria-current="page"` and the **Active Color**.

Below **Collapse Below** pixels of screen width, the links fold into a ☰ button that opens them as a drop-down. Set it
to 0 to keep them showing. Escape, a click elsewhere or a click on a link closes the menu.

Calls: **NavigationMenu.open**, **.close**, **.toggle**.

## Social Links

**Links** is one address per line. The icon comes from the address: Instagram, Facebook, X / Twitter, LinkedIn,
YouTube, TikTok, GitHub, Pinterest, Threads, Mastodon, Bluesky, Discord, WhatsApp, Telegram, Spotify, SoundCloud,
Twitch, Behance, Dribbble, Medium, Reddit, Vimeo; `mailto:` shows an envelope and `tel:` a phone. Anything else gets a
globe. **Brand Colors** uses each network's own colour; **Shape** puts each icon on a circle or square.

## Carousel

Every child object is a slide; each fills the carousel. Put whatever you like in a slide: an Image, a Text, a whole
layout.

- **Autoplay** moves on every **Interval** seconds; it pauses while the pointer is over it (**Pause On Hover**), while
  it has keyboard focus, and for visitors who asked for reduced motion.
- **Transition** slide or fade, over **Duration** seconds. **Loop** goes from the last slide back to the first.
- **Arrows** and **Dots** show the controls; the arrow keys work when it has focus, and you can swipe on touch screens.
- **Start Slide** is the slide shown first (counting from 0). Change it in the editor to see and edit another slide.

Event: **On Change** (`gpsb:change`, detail `{ index, count }`). An entry with an empty argument receives the slide
number. Calls: **Carousel.next**, **.prev**, **.goTo** (argument: slide number from 1), **.play**, **.pause**.

## Tabs

Every child object is a panel; each tab is labelled with its panel's **name** in the Hierarchy, so rename a panel to
rename its tab. The panels sit under the tab bar (**Bar Height**). **Start Tab** is the one shown first, and the one you
see while editing.

The tabs follow the ARIA tabs pattern: arrow keys, Home and End move between them.

Event: **On Change** (`gpsb:change`, detail `{ index, name }`). Call: **Tabs.select** (argument: tab number from 1).

## Accordion

**Items** is the questions and answers, written like this:

```markdown
## What do you charge?
Prices start at **€40**. See the [price list](prices).

## Do you deliver?
Yes, everywhere in the EU.
```

A line starting with `##` is a question; the lines below it, in [Markdown](content-and-data.md), are its answer. Only one
answer is open at a time unless you turn on **Allow Multiple**. The Accordion preset has a **Content Size Fitter**, so
its height follows the open answer.

Calls: **Accordion.openAll**, **.closeAll**.

## Modal

A pop-up window. Its RectTransform sets its size; on the page it's centred in the window, over a darkened
**Backdrop**. While you edit it's shown so you can work on it (turn off **Show In Editor** to hide it).

**Open On** decides when it opens:

| Open On | Opens |
|---|---|
| manual | When something calls **Modal.open**: a button's On Click, an animation event, `webObject.call('Modal.open')`. |
| load | As soon as the page loads. |
| delay | After **Delay** seconds. |
| exit | When the mouse leaves the top of the page (exit intent). |

With **Once** on, the automatic ones open only once per visitor (remembered in the browser). The × button, Escape and a
click on the backdrop (**Close On Backdrop**) close it.

Events: **On Open** (`gpsb:open`), **On Close** (`gpsb:close`). Calls: **Modal.open**, **.close**, **.toggle**.

## Gallery

Add images to **Images**, and a description for each to **Alts** in the same order (screen readers read it, and the
lightbox shows it as a caption). **Columns**, **Gap**, **Aspect** and **Fit** shape the grid.

With **Lightbox** on, a click shows the image full screen: arrows or swipes go through the others, Escape closes it.

The **Image** component has a **Lightbox** setting too, for a single image.

## Video Embed

Paste a YouTube or Vimeo link into **URL**. The page shows the poster and a play button; the player loads only when
the visitor clicks. That keeps the page fast and sends nothing to YouTube or Vimeo until then. **Privacy** uses
YouTube's no-cookie player and Vimeo's do-not-track setting. YouTube videos use their own thumbnail unless you set a
**Poster**.

Call: **VideoEmbed.play**.

## Map

**OpenStreetMap** needs no account: set **Lat**, **Lng** and **Zoom**. **Google** can take a **Query** instead (an
address or a place name). The map loads lazily, when it's about to scroll into view.

## Countdown

**Until** is the moment to count down to, written as `2030-01-01T09:00` (in the visitor's time zone) or with a zone,
`2030-01-01T09:00:00+01:00`. Choose which units show and their **Labels** (comma-separated). When the time is up it shows
**Done Text** if you set one, and fires **On Complete** (`gpsb:done`).

## Divider and Marquee

**Divider** draws a line through the middle of its rect, horizontally or vertically, with a **Thickness**, **Line Style**
and **Inset** at both ends.

**Marquee** scrolls its **Text** at **Speed** pixels per second, repeating seamlessly. It stops for visitors who asked
for reduced motion.

## From code

Widget events bubble, so you can listen to them anywhere above the object. In a behaviour (engine API):

```js
start() {
  const carousel = this.getComponent('Carousel');
  carousel.onChange.addListener(({ index, count }) => console.log(`slide ${index + 1} of ${count}`));
  this.webObject.on('gpsb:close', () => console.log('the modal was closed'));
}
openSignup() { this.findObject('Signup Modal').call('Modal.open'); }
```

Any call in this page also works as `GPSB.invoke(id, 'Carousel.next')`, and in every event list.
