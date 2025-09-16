# Bell Bearer — restyle + skins

Everything in this folder is drop-in. Copy the files over the ones in the
extension root, keeping the folder structure.

    popup.html          replaces  popup.html
    popup.css           replaces  popup.css
    popup.js            replaces  popup.js
    dashboard.html      replaces  dashboard.html
    dashboard.css       replaces  dashboard.css
    content.css         replaces  content.css
    skins.css           new       the token layer — link it before popup/dashboard css
    skin-fonts.css      new       @font-face for the skin families
    textures/           new       parchment + newsprint + grain tiles
    src/shared/skin.js  new       reads/writes the skin setting, paints data-skin
    src/page/skin-picker.js  new  wires the Appearance section

    preview/            NOT part of the extension — static pages that link the
                        real CSS so the design can be reviewed in a browser

## What changed

**Popup.** Asks for 760px and adapts down to 340, instead of a fixed 800.
A browser action popup has no resizable viewport — Chrome and Firefox both
size it to the document and cap it at 800x600 — so `popup.css` declares
`html { width: 760px }` as the preferred width and both browsers honour it.
Change that one number to change the popup's size. The responsive rules stay
live underneath: at browser zoom of 150% or more, on a small display, or if
you set a narrower width there, it becomes the one-column drill-in on its own. Under 560px it
is one column and tapping a video slides its checkpoints in over the list; a
back arrow (and Escape) unwinds it. At 560px and up both panes are on screen
and the arrow disappears. The four header actions sit in a row that scrolls
sideways rather than wrapping, so Clear All is never cut off at 340px.

**Accent.** Sampled from icon128.png — the field red behind the bearer,
`#b81808`, replacing the rose `#e11d48`. Night keeps the Discord blurple.

**Dashboard.** Same markup and class names, restyled off the token layer.
Emoji buttons are text labels now. The header brand gradient is gone; the bar
takes `--header-bg` so a skin can own it. New Appearance section at the top of
Settings.

**Injected UI.** Skinned too, via `data-bb-skin` alongside the existing
`data-bb-theme` — the skin gives palette and type, `data-bb-theme` still
follows the host page's own light/dark so the overlay never fights the site it
sits on. Skin fonts need `fonts/*.woff2` in `web_accessible_resources`
(snippet in content.css); without it they fall back and nothing breaks.

The topics overlay is a near-full-screen frosted sheet inset
40px: topics rail on the left, thumbnail grid on the right, time range and sort
in the top right. The pouch panel now leads with the channel, offers existing
topics as single-select chips, and keeps a new-topic field at the bottom.

## Skins

`<body data-skin="default|riso|medieval|deco">`, and `body.dark-theme` on top
for night — so the existing `Ui.installTheme` is untouched and every skin
carries both states. Skins apply to the popup and the dashboard; injected UI
follows the site's own day/night instead.

Adding a skin means one block in skins.css and one entry in `SKINS` in
src/shared/skin.js. Nothing else reads a colour.

## Fonts

Not bundled here — all five are SIL OFL, so download the woff2 from
fonts.google.com and drop them in `fonts/` under these names:

    SpaceGrotesk-Regular.woff2      SpaceGrotesk-Bold.woff2
    DMMono-Regular.woff2
    Cardo-Regular.woff2             Cardo-Bold.woff2
    Grenze-Regular.woff2            Grenze-SemiBold.woff2
    UnifrakturMaguntia-Regular.woff2
    PoiretOne-Regular.woff2
    JosefinSans-Regular.woff2       JosefinSans-SemiBold.woff2

Anything missing falls back to a system stack — the skin still works, it just
loses its voice. Default bundles nothing.

## Activity view (new, opt-in)

Off by default. Settings › General › **Track my activity** turns it on; the
Activity tab stays `hidden` until then, and nothing is recorded while it is off.

    src/shared/activity.js   the store: bucketing, pruning, summaries, formatting
    src/page/stats.js        the view: figures, per-site bars, per-day pages, hours

It shows, for Today / Last 7 days / Last 30 days:

* Time on screen, with the change against the preceding window
* Number of sites, and which one leads
* Longest single page, and its host
* Busiest hour of the day
* Focused time per site, as bars, top eight
* The longest single page of each day, as a table
* A 24-bar strip of when the time went

None of it is YouTube-specific — it buckets by hostname across every http(s)
site. All of it is chrome.storage.local on this machine, never sent anywhere,
pruned past 60 days, and the only per-URL thing kept is the title of each
day's single longest page.

**Wiring in background.js** — the store is passive; it needs a heartbeat:

    importScripts('src/shared/settings.js', 'src/shared/activity.js');

    chrome.alarms.create('bb-activity', { periodInMinutes: 0.25 });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name !== 'bb-activity') return;
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        BB.Activity.tick(tab);
    });
    chrome.windows.onFocusChanged.addListener((id) => {
        if (id === chrome.windows.WINDOW_ID_NONE) BB.Activity.blur();
    });

`tick` credits elapsed wall time to whatever was focused at the previous tick,
so a suspended service worker does not inflate the totals, and a gap over 90
seconds is dropped rather than counted as time at the screen.

## Still to wire (content.js)

I did not have content.js, so the overlay and pouch CSS is written against a
markup contract instead. Both structures are spelled out in the comment at the
foot of content.css. In short:

* Topics overlay: `.bb-modal-overlay.bb-sheet-overlay` › `.bb-sheet` ›
  `.bb-sheet-head` (brand, `.bb-seg` range, `.bb-select` sort, `.bb-close`) +
  `.bb-sheet-body` (`.bb-topics` rail, `.bb-videos` › `.bb-video-grid`).
  Active topic is `aria-current="true"`; active range is `aria-pressed="true"`.
* Pouch: existing `.bb-panel.bb-panel-sm`, plus `.bb-pouch-channel` above the
  body and `.bb-new-topic` below the chips. Chips stay `.bb-topic-chip` with
  `aria-pressed` — single-select, one topic per channel.

The old flat `.bb-chips` bar at the top of the overlay is gone; that class is
now the chip row inside the pouch panel.
