For the low-time warning sound: Chess.com plays that sound through its own audio pipeline, which an extension can only hook into unreliably (the hook breaks whenever they change their bundler). How should I make it adjustable?



known limitations at the moment: chess board flip is not detected

let's migrate to <button onClick={} onMouseDown>   </button>
https://developer.chrome.com/docs/extensions/reference/api/tabs
https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/tutorial.tabs-manager
# Bell Bearer

It's hard to keep up with newly published videos from all of your youtube's subscribed channels. A better way to organize is to tag channels of similar focus. So, you can occasionaly visit a dedicated dashboard to consume different area of your interests at your own pace. YouTube lacks all the good features a poweruser can benefit from, I have a roadmap to streamline YouTube experience for the power users.


## Features

- **Checkpoint Creation**: Hold Ctrl+B to create checkpoints while watching YouTube videos
- **Visual Feedback**: Snappy notifications for bookmark duration
- **Bookmark Management**: Clean interface to view and manage all bookmarks
- **Quick Navigation**: Jump to the bookmarked timestamp with a single click
- **Playback Control**: One speed ladder, stepped by the keyboard or by the popup, held against sites that reset it
- **Persistent Storage**: Persist Bookmarks across browser sessions
- **Import/Export**: One file with every setting and all saved data, from the dashboard header
- **Topics overlay**: A frosted sheet over YouTube — topic rail, thumbnail grid, time range and sort
- **Skim**: A launcher over any page — find within it, reach a tab, your history or a browser action, and label every link for the keyboard
- **Skins**: Default, Riso Paint, Medieval and Art Deco, each with its own day and night
- **Activity**: Opt-in, on-device record of where your screen time goes
- **Daily time limit**: A budget for x.com and reddit.com, counted while you are actually looking at them
- **Chess.com and Lichess**: Games, time management and time at the board; a clock warning and moves read aloud while you play
- **Reward System**: Track watch credits to spend them on popcorn for later

Export and Import sit in the dashboard header, beside the theme button, and
"clear all" above the saved videos. The popup header is Dashboard alone, so the
row never has to shrink or scroll.

**Settings › Appearance › Popup size** picks how much room the popup asks for:
*Wide* puts the video list and its checkpoints side by side, *Compact* shows one
column and drills in when you pick a video.

The pouch sheet opens from **Pouch**, third in YouTube's left drawer under Home
and Shorts, or from the pouch button beside Subscribe. The drawer row wears the
extension's icon and takes its metrics and type from YouTube's own rules, so it
lines up with Home and Shorts to the pixel. Only the full drawer gets the row —
the collapsed icon rail is a different renderer and is left alone.

The sheet opens on what it already has and fills in behind you: feeds are pulled
down in the background while you browse YouTube, cached to disk so a restart
starts warm, and fetched a few at a time so a pouch with hundreds of channels
draws its first row immediately instead of waiting for its slowest feed.

Down the rail, **All** covers the channels you have filed. The **Subscriptions**
switch under it widens that to every channel the account follows, read once from
your own subscriptions page and cached. Videos you have already watched drop out
of **All** — opening one from the sheet counts, and so does a minute of playback
on YouTube itself. Inside a topic nothing is hidden: a topic is a shelf you go
back to, and a hole in it reads as something having gone missing.

### Playlists

YouTube will tell you when a channel uploads. It will not tell you when
something is added to a playlist, which for a course, a label's releases or a
friend's mix is the only event that matters. **Follow** in a playlist header —
on the playlist page, or on the queue panel while watching from one — puts that
playlist's new entries in a strip at the foot of the pouch sheet. What the
playlist already holds when you follow it is not reported as new.

## Keyboard shortcuts

Shortcuts work on any site with a video, not just YouTube, and are ignored
while you are typing in a field.

| Keys | Action |
| --- | --- |
| Hold `Ctrl + B` | Create a checkpoint over the passage you held it for |
| `Ctrl + Shift + S` | Mark a segment start; press again to mark its end |
| `Alt + 1…9` | Skip forward that many seconds |
| `Shift + 1…9` | Skip back that many seconds |
| `Ctrl + Shift + 1…9` | Temporary 3x boost for that many seconds |
| `>` | Next speed step |
| `<` | Previous speed step |
| `+` | Back to 1x |
| `Ctrl + Shift + L` | Copy the page as a Markdown link (rebindable at `chrome://extensions/shortcuts`) |
| `Shift + F` | Skim: find within this page |
| `Shift + H` | Skim: search your browsing history |
| `Shift + A` | Skim: search the actions it can run |
| `Shift + L` | Label every link and button in view |
| `Shift + P` | Open the pouch — the sheet on YouTube, the panel on x.com |

Speed steps through one fixed ladder — 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
2.25, 2.5, 3, 3.5, 4, 5 — and the popup's buttons step the same ladder, so the
two controls always agree. When a site resets the rate (a new video, an ad
break) the speed you picked is re-applied; when *you* change it through the
site's own speed menu, that becomes the new setting instead. Turn the re-apply
off with **Keep my playback speed** in Settings.

`Shift + P` is off until **Settings › General › Pouch shortcut** turns it on,
for the same reason Skim and the link hints are: a bare-Shift letter is a large
claim to make on somebody's keyboard without telling them first. It does nothing
anywhere but YouTube and x.com, so on every other site the key stays a plain
capital P.

## Skim

Off until **Settings › General** turns it on, because it claims three
bare-Shift letters on every site.

One window, 600px wide and centred, over whatever page you are on. The key you
open it with decides which source it opens on — `Shift + F` the page itself,
`Shift + H` your history, `Shift + A` the actions it can run — and every other
source is still listed underneath, because a word typed to find a tab often
turns out to be on the page. Tab moves to the next source. The list shows four
rows at a time and scrolls for the rest. A window narrower than 600px is the
only thing that changes its width, and then it keeps a gutter either side.

Arrowing through page matches scrolls each one to rest just below the window,
close enough to read in the same glance as the query that found it. Browser
find parks a match wherever the scroll happens to land; this reserves the strip
the window covers and places the match under it. A match inside a collapsed
`<details>` opens it first, one inside a scrolling panel scrolls that panel
first, and a match in a sticky header cannot be scrolled to at all — so there
the window steps aside to the opposite edge instead. At the very top or bottom
of a page, where there is no scroll left to spend, the window moves rather than
the page.

Nothing in the page is rewritten to highlight a match. Matches are painted with
the CSS Custom Highlight API, which draws over ranges without touching the DOM,
so no listener the page installed is ever replaced. Where the browser does not
have it, the search and the scrolling still work and only the paint is missing.

**Link hints** are the other half, switched on separately. `Shift + L` labels
every link, button, field and card in view; type a label and it fires. A link
opens in a tab immediately beside this one, so the page you were reading stays
put; anything else is clicked or focused where it stands. A label that cannot
match what has been typed so far disappears, and the character already typed
stays on the ones that survived. Scrolling ends hint mode, and so does Escape —
the labels are placed from where things were, and a label pointing at the wrong
thing is worse than no label.

Both wear the skin that is on and follow the host page's own light or dark.

## Skins

**Settings › Appearance** picks one of four, and it applies to the popup, the
dashboard and the UI injected into YouTube. Day and night are separate from the
skin — the moon button switches within whichever skin you picked.

| Skin | |
| --- | --- |
| Default | The house red, sampled from the icon |
| Riso Paint | Three spot inks on newsprint |
| Medieval | Parchment, iron-gall ink, rubricated red |
| Art Deco | Ivory and gilt, everything letter-spaced |

On the page itself the skin sets the palette and the type, but light/dark keeps
following YouTube's own setting, so a sheet over a dark YouTube is never a
white slab.

The display faces ship with the extension, in `fonts/`: the same Cardo, Grenze,
UnifrakturMaguntia, Josefin Sans, Poiret One and Space Grotesk subsets the
design export was served, unpacked out of it so a skin looks here as it does
there. All are SIL OFL. Only the latin and latin-ext cuts are kept, and
anything outside them falls back to the stack named in `skins.css`. The same
faces reach the injected UI, which is why `skin-fonts.css` is a content-script
stylesheet and `fonts/*.woff2` is in `web_accessible_resources`.

## The X pouch

x.com gets a pouch of its own, and it is two pouches rather than one: **people**
and **posts** keep entirely separate topic lists. A "CUDA" under People and a
"CUDA" under Posts are different topics with different contents, and renaming or
deleting one leaves the other alone. Someone whose posts you want to keep and
someone you want to remember are two different reasons to file, and one list
serving both ends up serving neither.

An item belongs to exactly one topic. Filing something already filed moves it,
silently — a person is keyed by their handle and a post by its status id, so the
same account met on a post and again on their profile is one person, and the
same post met in the timeline and again in a thread is one post.

**Pouch** sits in X's left navigation under Home, wearing the extension's icon
the way the row in YouTube's drawer does. It opens a panel over that column and
nothing else: the timeline stays readable behind it, because the point of the
panel is remembering who somebody is *while* you are reading, not a place to go
and sit. Click anywhere outside it to dismiss it. Two levels, People or Posts at
the top, a topic's contents one click in.

On a post, the pouch button stands where X's bookmark was — the same gesture,
filed somewhere you can organise. On a profile it sits beside Follow. Neither is
labelled: both sit in rows of bare glyphs, and a word there would read as
something X had added. Both open a small picker of that side's topics, with the
current one dotted; filing a post can make a topic on the spot, because filing a
post is the moment you find out you need one.

Everything else is the dashboard, under **X › People** and **X › Posts**: making
a topic, renaming it, dragging it into a different place in the order, deleting
it and everything in it, writing the three-to-five-word note under someone's
name, and taking a saved post back out. Those are decisions you make looking at
the whole pouch, not while reading a post.

### Avatars, and why nothing is ever fetched

A person's picture is stored as the `pbs.twimg.com` URL that was on the page at
the moment you filed them — about eighty bytes — and never as image data. The
panel and the dashboard put that URL in an `<img src>` and let the browser fetch
and cache it, which costs nothing and is not rate-limited.

What is deliberately *not* done is asking X for it. X's own endpoints are
rate-limited per fifteen minutes against your signed-in session, so a panel that
refetched fifty profiles every time it opened would spend your own budget and
eventually 429 your real browsing. Nothing here ever makes a request to X.

The consequence is that a stored URL goes stale the day somebody changes their
picture, since nothing goes back to check. So every row carries the person's
initials underneath the image, and a picture that fails to load simply uncovers
them.

### Hiding promoted posts

**Settings › X › Hide promoted posts and Premium upsells** is off until asked
for. Promoted posts are found by the tracking wrapper X puts around a paid
placement rather than by the word "Promoted", so it needs no word list and works
whatever language the site is in; the upsells are X's own Premium nags, which are
not third-party ads but are not posts either.

Nothing is deleted. Hidden entries keep their box in the page, because X's
timeline is virtualised and measures its own rows — a node removed out from under
that bookkeeping makes the scroll position jump. Turning the setting off puts
everything back on the page that is already open, without a reload.

## Daily time limit

x.com and reddit.com get a card on the dashboard and a panel in settings, and
each can be given a budget for the day. Off by default, and while a site's
limit is off nothing about it is counted or stored.

Time is counted by the page itself, because the page is the only thing that
knows whether it is the one being looked at: the tab has to be on screen
*and* the window has to have the machine's focus. A tab left open behind
another window is not time spent. Seconds are banked every fifteen, and a
single credit is capped, so a laptop closed for three hours cannot charge the
night to the morning.

Past the limit the site is covered by a sheet saying what was spent. It is a
sheet rather than a redirect — being bounced somewhere else tells you
nothing, and closing the tab is meant to be the deliberate part.

The tally is one day deep. It is not aged out or archived at midnight, it is
discarded whole the first time the next day reads it, so the store never
amounts to a record of what was browsed when: two numbers and the date they
belong to. The site's card shows today against the limit, live, while the
counting happens in another tab.

## Activity

Off by default, and nothing is recorded while it is off. The Activity tab is
there either way: with tracking off it explains what it would record and offers
a button to start, which is the same switch as **Settings › General › Track my
activity**. (The tab used to be hidden until that checkbox was found, which made
a whole view invisible to anyone who never went looking.)

Turned on, it shows, for today / 7 days / 30 days: time on screen with its
trend, how many sites and which leads, the longest single page, the busiest
hour, focused time per site, the longest page of each day, and a 24-bar strip of
when the time went.

It buckets by hostname across every http(s) site — nothing about it is
YouTube-specific. Everything stays in `chrome.storage.local` on this machine,
is never sent anywhere and is pruned past 60 days. The only per-URL thing kept
is the title of each day’s single longest page, and that is kept for 7 days,
not 60 — which is also the window the “longest page each day” panel shows,
rolling back from today whatever range the rest of the view is on.

A 30-second alarm in the service worker takes the readings, and it exists only
while tracking is on — nothing is woken while the setting is off. Each reading
credits elapsed wall time to whatever was focused at the *previous* one, so a
suspended MV3 worker cannot inflate a total, and a gap longer than 90 seconds is
dropped rather than counted as time at the screen. That "previous" marker lives
in `chrome.storage.session`, because the worker itself does not survive the gap
between two alarms.

## Chess.com and Lichess

The two sites are mirrors of each other: each has a card on the dashboard, a
Games view, a popup panel on its own pages and a settings panel of its own,
all drawn from one registry, `src/shared/chess-sites.js`. Set the username in
**Settings › Chess.com** or **Settings › Lichess**; games are read from each
site's public API.

The Games view shows today / 7 days / 30 days, win/loss by time control, and
beside it **time management** — of your last 20 bullet, blitz and rapid games,
how many you won on the opponent's clock and lost on your own. Under that is a
year of time at the board as a heat map in the skin's own accent. A year of
Lichess games streams at about twenty a second, so the first read takes a
while; the last 30 days come first, and later reads fetch only what is new.

While you play, per time control:

- **Opponent clock warning** — a toast when the opponent's clock is more than
  N seconds ahead of yours.
- **Speak moves** — every move, yours and your opponent's, read aloud through
  `chrome.tts` ("Knight takes E 5, check"), for learning to follow the board
  by ear. Firefox has no `chrome.tts`, so there the page's own speech is used.

The time control is inferred from the starting clock, since the increment is
not on the page.

## Offline Installation

### Method 1: Load as Unpacked Extension (Recommended for Development)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory
5. The extension should now appear in your extensions list

For Firefox, rename `manifest.firefox.json` to `manifest.json` first (it needs
`background.scripts` rather than a service worker, and has no `tabGroups`).

## Project layout

No build step, by design: every file is a classic script that attaches its
exports to a shared `BB` namespace, and the load order is the order in
`manifest.json` (or in the `<script>` tags of `popup.html` / `dashboard.html`).

```
src/shared/     pure logic, used by every surface
  speed.js         the playback-rate ladder — one source of truth
  skin.js          which skin is on; paints data-skin
  activity.js      the activity store: bucketing, pruning, summaries
  bookmarks.js     load/save/merge/import checkpoints
  subscriptions.js topics, channels, new videos
  settings.js      every setting's key and default
  youtube.js       URL parsing
  chess-sites.js   chess.com and Lichess: names, settings keys, time controls
  chess.js         chess.com games and every summary both sites share
  lichess.js       Lichess games, streamed and resumable
  feed.js          channel RSS, cached ten minutes; Refresh asks for fresh
                   resolves /@handle to a UC id by the page's canonical link
  skim.js          where a match comes to rest, and the action table
  time-limits.js   the day's tally for x.com and reddit.com, and the limit
  x-pouch.js       the X pouch: two independent topic lists and their items
  pouch-button.js  the pouch button both YouTube and X inject
  time.js dom.js   formatting and escaping

src/content/    injected into every page
  main.js          bootstrap — decides what runs where
  player.js        speed, skipping, seeking, the temporary boost
  shortcuts.js     the keybinding table
  skim.js          the launcher: page search, the jump, the result list
  link-hints.js    a label on every link and button in view
  time-limit.js    counts the day on x.com and reddit.com, and covers them
  checkpoints.js   recording and saving checkpoints
  transcripts.js   transcript fetching and caching
  site.js          which site, and which <video> on it
  chess.js         in a chess game: clock warning, spoken moves, clear arrows
  youtube-ui.js    the pouch button, the drawer entry, the topics sheet, the pouch panel
  twitter-page.js  every x.com selector, and reading a post or a profile off one
  twitter-ui.js    the X nav row, the post and profile buttons, the topic picker
  twitter-panel.js the pouch panel over X's navigation column
  twitter-ads.js   hides promoted posts and Premium upsells, when asked to
  dom-watch.js     one throttled MutationObserver for all of the above
  overlay.js notify.js theme.js page-info.js markdown.js

src/background/ the service worker, pulled in by background.js
  proto.js         the sowon wire format
  sowon.js         focus reporting
  context-menus.js "Copy as Markdown"
  commands.js      keyboard commands and messages, chess moves spoken
  activity-heartbeat.js  the alarm that feeds the activity store
  skim.js          tabs, history, and the actions Skim can run

src/page/       shared by popup.html and dashboard.html
  ui.js            modals, toasts, clipboard, files, theme
  backup-buttons.js the header's Export / Import
  tab-actions.js   driving a video in another tab
  settings-form.js binds the settings form to storage
  skin-picker.js   the Appearance section
  stats.js         the Activity view
  chess-stats.js   a chess site's Games view, dashboard and popup
  chess-settings.js a chess site's settings panel
  heat-map.js      the calendar heat map
  time-limit-view.js today against a site's daily limit
  x-pouch-view.js  the dashboard's People and Posts panels — where X topics are managed
  popup-width.js   applies the popup size setting, from popup.html's <head>

skins.css       the token layer for every skin — linked before popup/dashboard css
skin-fonts.css  @font-face for the skin families
fonts/          the woff2 subsets those faces load
textures/       parchment, newsprint and grain tiles used by the skins

tests/          zero-dependency browser test suite — see tests/README.md
```

#### Import/Export Data Format
The export is every key in `chrome.storage.local` except the network caches:
```json
{
  "type": "bell-bearer-backup",
  "version": 1,
  "exportedAt": "2026-09-15T06:30:00.000Z",
  "data": { "skin": "deco", "shortcuts": {}, "youtubeBookmarks": [] }
}
```
Importing writes those keys back, replacing what is there.

## Permissions

- `storage`: To save and retrieve bookmarks
- `alarms`: The activity heartbeat — an MV3 worker is suspended a few seconds after it goes idle, taking any setInterval with it
- `activeTab`: To interact with YouTube pages
- `scripting`: To inject content scripts
- `contextMenus`: For the "Copy as Markdown" right-click items
- `tabs` / `tabGroups`: For the sowon focus report
- `tts`: To read chess moves aloud (Chrome only; Firefox has no such API)
- `history` / `sessions`: Skim’s history search and its “reopen the last tab I closed” action, both read only when you ask for them
- `host_permissions`: To access YouTube.com

## Persistance Storage

Chrome's storage API is used with the following data structure format:
```javascript
{
  youtubeBookmarks: [
    {
      id: "video_id",
      title: "Video Title",
      url: "https://youtube.com/watch?v=video_id",
      bookmarks: [
        {
          time: 120, // in seconds
          timestamp: 1234567890,
          note: "Checkpoint description"
        }
      ]
    }
  ]
}
```

The X pouch is four keys rather than two, because people and posts keep
independent topic lists and array order is the display order:

```javascript
{
  bbXPeopleTopics: [{ id: "xpt_…", name: "CUDA", createdAt: 0 }],
  bbXPostTopics:   [{ id: "xst_…", name: "CUDA", createdAt: 0 }],
  bbXPeople: [
    { id, topic: "xpt_…", handle: "@isorokin", name: "Ilya Sorokin",
      avatar: "https://pbs.twimg.com/profile_images/…_bigger.jpg",
      note: "warp-level tricks", addedAt: 0 }
  ],
  bbXPosts: [
    { id: "<status id>", topic: "xst_…", handle: "@isorokin", name: "Ilya Sorokin",
      text: "…", url: "https://x.com/isorokin/status/…", postedAt: 0, savedAt: 0 }
  ]
}
```

A person's `id` is ours and their `handle` is the key they are recognised by; a
post's `id` *is* its status id, which is the only thing about a post that never
changes. `postedAt` is stored rather than the "6h" X was showing at the time,
because a stored "6h" is wrong by tomorrow.

## Tests

```bash
node tests/serve.js
```

Then open <http://localhost:5601/tests/>. Opening `tests/index.html` directly
works too, if your browser allows `file://` sub-resource loads. **Run it in a
tab you can see** — a browser throttles timers hard in a background tab and the
suite is built on them, so hidden it takes minutes instead of seconds.

For the parts that are pure logic there is also a fast gate that needs no
browser at all:

```bash
node tests/node-check.js
```

See [tests/README.md](tests/README.md).

inspired by:
https://github.com/NabokD/pockettube
https://github.com/jdepoix/youtube-transcript-api.git
