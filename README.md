For the low-time warning sound: Chess.com plays that sound through its own audio pipeline, which an extension can only hook into unreliably (the hook breaks whenever they change their bundler). How should I make it adjustable?

Vomnibar

known limitations at the moment: chess board flip is not detected

let's migrate to <button onClick={} onMouseDown>   </button>
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
- **X pouch**: People and posts filed into two independent sets of topics, from x.com and managed on the dashboard
- **Skim**: A launcher over any page — find within it, reach a tab, your history or a browser action, and label every link for the keyboard
- **Skins**: Default, Riso Paint, Medieval and Art Deco, each with its own day and night
- **Activity**: Opt-in, on-device record of where your screen time goes
- **Daily time limit**: A budget, or a window of hours, on any site you name — counted while you are actually looking at it, snoozable ten minutes at a time
- **Rosters**: Who you follow on Twitter and the subreddits you have joined, out to a text file and back in again, slowly
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

**Pouch** sits in X's left navigation under Home, wearing the extension's own
artwork exactly as the row in YouTube's drawer does, with the outline pouch mark
stacked underneath it so a picture that cannot be loaded uncovers a glyph in
`currentColor` rather than leaving a hole.

It takes its type and its icon size off X's own rows, which is how X's dark
themes and its display-size setting reach it without anything from us — and off
*two* of them, not one. X draws the row you are on heavier than the rest, and
the row this used to measure was Home, which is the row you are on nearly
always: so the Pouch row wore the selected weight permanently and read as a tab
that would not let go. It now rests in the body weight like every other row in
the column, and goes bold, a little larger and into the accent while the panel
is open. Where the word starts is measured too, so the label lines up with the
words above and below it rather than sitting a couple of pixels left of them.

It opens a panel over that column and nothing else: the timeline stays readable
behind it, because the point of the panel is remembering who somebody is
*while* you are reading, not a place to go and sit. Click anywhere outside it
to dismiss it. Two levels, People or Posts at the top, a topic's contents one
click in.

On a post, the pouch button stands where X's bookmark was — the same gesture,
filed somewhere you can organise — and where it *would* be on the rows X leaves
a bookmark off, which is immediately after Like rather than out past Share. Its
place used to depend on whether that row happened to have a bookmark in it, so
it moved between a post opened on its own page and the same post in the
timeline. Adding a cell to that row also lifts the fixed width cap X puts on it,
but only where the post is wider than the cap: otherwise the marks stay bunched
into the left half with empty page beside them.

On a profile the button sits beside Follow, wearing
the same ring as the More button next to it, at whatever size and in whatever
grey X is currently drawing those. Neither is labelled: both sit in rows of bare
glyphs, and a word there would read as something X had added. Both open a small
picker of that side's topics, with the current one dotted; filing a post can
make a topic on the spot, because filing a post is the moment you find out you
need one.

Both buttons are **off until you ask for them**, under **Settings › X**, and so
is taking X's own bookmark out of the row:

| Setting | What it adds |
| --- | --- |
| Remove Twitter's bookmark button from posts | Hides X's bookmark. Hidden, not deleted — nothing already bookmarked on X is touched, and turning it back off puts the button back |
| Add to pouch from a profile | The ring beside Follow, for filing people |
| Add to pouch from a post | The button in the action row, for filing posts |

They are separate switches because either half is a reasonable thing to want
without the other, and because all three are the extension reaching into a page
somebody else designed — which is not a default to assume for anyone. The pouch
itself is always there: the row in X's navigation, the panel it opens, and the
People and Posts tabs on the dashboard.

Everything else is the dashboard, under **Twitter › People** and
**Twitter › Posts**: making a topic, renaming it, dragging it into a different
place in the order, deleting it and everything in it, writing the
three-to-five-word note under someone's name, and taking a saved post back out.
Those are decisions you make looking at the whole pouch, not while reading a
post.

A saved post opens from either side. In the panel the whole card is the target;
in the dashboard the handle and the body are one link. That was not true for a
while, and a pouch of posts you cannot get back to is a pouch with no point:
posts filed before the URL was recorded have theirs rebuilt from the status id,
so the old ones open too.

The dashboard calls the site **Twitter** throughout, not **X**. The site renamed
itself; nobody who uses it did, and a single letter sitting in a row of proper
nouns reads as a rendering fault rather than as a name. The internal id stays
`twitter`, which is what it always was.

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

**Any** site can be held to a daily limit. The list is under
**Settings › General › Hold me to a daily limit on**, beside the remembered
cookie sites and working the same way: name a host, say how long it gets, and it
is in. Nothing is in it to begin with, and a host with no row in it is not
counted, not stored and costs nothing at all.

This used to be two settings per site, spelled out in the schema and wired to a
toggle inside that site's own panel — which is why only the two sites that had a
panel could have a limit at all. x.com and reddit.com are now two rows in the
list like any other, and their **Time** tab shows where today stands rather than
setting the limit. Anyone who already had one keeps it: the list seeds itself
once from those old settings the first time it is read.

A row carries one of two kinds of limit:

| What you type | What it means |
| --- | --- |
| `30` minutes | a budget for the day: thirty minutes of that site, whenever you like |
| `7am` to `9am` | an allowance too: the site is yours between those hours and covered the rest of the day |

A pair of times is an *allowance*, not a curfew — the same shape of promise the
budget makes. It could just as reasonably have meant the two hours the site is
blocked, and the difference matters rather a lot at 9:01, so the panel says
which it is in as many words. Times are read the way they are said: `7am`,
`7:30 pm` and `19:00` are all fine. A window whose end is before its start runs
over midnight (`22:00` to `02:00`) rather than being empty.

Time is counted by the page itself, because the page is the only thing that
knows whether it is the one being looked at: the tab has to be on screen
*and* the window has to have the machine's focus. A tab left open behind
another window is not time spent. Seconds are banked every fifteen, and a
single credit is capped, so a laptop closed for three hours cannot charge the
night to the morning.

Past the limit the site is covered by a sheet saying what was spent. It is a
sheet rather than a redirect — being bounced somewhere else tells you
nothing, and closing the tab is meant to be the deliberate part.

The sheet has a way through it: **Snooze ten minutes**, as many times as you
ask. Nothing refuses a fourth one — it just says it is the fourth, on the sheet
and in the Time tab. A limit with no door is a limit you switch off for good the
first time it is wrong about your afternoon, and a snooze you have to admit to
is a better check than one you cannot have. The clock keeps running through it,
so the ten minutes come out of the same day's allowance rather than on top of
it, and a snooze is discarded at midnight with everything else.

The tally is one day deep. It is not aged out or archived at midnight, it is
discarded whole the first time the next day reads it, so the store never
amounts to a record of what was browsed when: a number per limited host and the
date they belong to. The site's card shows today against the limit, live, while
the counting happens in another tab.

## Rosters: your list out to a file, and back

**Twitter › Roster** and **Reddit › Roster** read your own list off the site —
the accounts you follow, the subreddits you have joined — into a plain text
file, one name per line, and read a file back in to follow or join what it
names.

No API, no token, no endpoint. Reading walks the pages you can already see;
applying opens each name's page and clicks the site's own Follow or Join button.
That is the whole of the safety argument, and it is why the two directions are
not offered as one button:

| | Reading | Applying |
| --- | --- | --- |
| What it touches | nothing — it changes no state anywhere | your account, at the site's sufferance |
| Twitter | scrolls `/<you>/following` | 40 a day, 25–55 seconds apart |
| Reddit | pages through `old.reddit.com/subreddits/mine` | 120 a day, 9–20 seconds apart |

Twitter's numbers are deliberately the slower pair. Reddit rate-limits an
account and tells you so; Twitter suspends one and does not, the edge of what it
tolerates is neither documented nor stable, and the way to stay clear of it is
to stay a long way clear rather than to find it. The gap between two actions is
jittered inside its range, because a click at exactly the same interval for an
hour is a signature and a person does not have one.

Before an apply job starts, the panel says how many names it is, how many are
new since your last read, roughly how long today's sitting will take and how
many days the whole thing is. A four-hundred account list is eleven days of
Twitter's cap, which is not something to discover on day three.

A job stops at the first thing it does not understand — a missing Follow button,
a click that silently did nothing, anything the site puts in the way — and says
so, rather than trying again or moving on. A click that does nothing is exactly
what being rate-limited looks like from inside the page, and pressing on from
there is how an account gets suspended. Anything already followed or joined is
skipped and costs nothing against the day, so re-running a list you half applied
yesterday is cheap.

Applying a list *is* a sequence of navigations, so the job lives in storage
rather than in any page: every page of the site picks it up, does one thing,
writes down that it did and moves on. That is what makes it survive a page load,
a closed browser, and the day's cap running out in the middle. One page holds it
at a time — two tabs would otherwise follow the same account twice — and the
dashboard can stop it, or carry on where it left off.

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
  limit-sites.js   which sites are held to a daily limit, and what each limit is
  time-limits.js   the day's tally per limited host, and the snooze
  roster.js        a site's own roster: the file format, the pace, and the job
  x-pouch.js       the X pouch: two independent topic lists and their items
  pouch-button.js  the pouch button both YouTube and X inject
  time.js dom.js   formatting and escaping

src/content/    injected into every page
  main.js          bootstrap — decides what runs where
  player.js        speed, skipping, seeking, the temporary boost
  shortcuts.js     the keybinding table
  skim.js          the launcher: page search, the jump, the result list
  link-hints.js    a label on every link and button in view
  time-limit.js    counts the day on any limited site, and covers it
  roster.js        reads a roster off the site's pages, and works through one
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
  limit-sites-panel.js the General list: which sites have a limit, and what it is
  roster-view.js   a site's Roster panel: the file out, the file in, the job
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

The daily limit is two keys — what the limits are, and what today has gone on —
both keyed by host, so neither knows anything about which sites have a workspace:

```javascript
{
  bbLimitSites: {
    "x.com":      { minutes: 30, savedAt: 0 },
    "reddit.com": { from: "07:00", to: "09:00", savedAt: 0 }
  },
  bbTimeLimits: {
    day: "2026-09-24",
    seconds: { "x.com": 1740 },
    snoozed: { "x.com": { until: 0, count: 2 } }
  }
}
```

A row has `minutes` or it has `from` and `to`, never both. `bbTimeLimits` is one
day deep: anything whose `day` is not today is discarded whole rather than aged
out, which is also what clears a snooze at midnight. An expired snooze keeps its
row inside the day, with `until` left in the past, so the count stays honest —
dropping it the moment it lapsed would say "first" again every ten minutes.

A roster is the list last read off a site, and at most one job in flight:

```javascript
{
  bbRosters: {
    twitter: { names: ["isorokin", "…"], readAt: 0 },
    reddit:  { names: ["rust", "cpp"],   readAt: 0 }
  },
  bbRosterJob: {
    site: "twitter", action: "apply", names: ["…"], found: [],
    at: 12, done: 11, skipped: 1, failed: 0,
    day: "2026-09-24", today: 12, status: "running", note: "",
    nextAt: 0, leaseBy: "k3f9a1", leaseUntil: 0
  }
}
```

`at` is the only thing that moves through the list; `done`, `skipped` and
`failed` are counts rather than lists, because writing two thousand names back
on every step is a storage write per action for something nobody reads. `today`
is against the site's cap and is reset by the `day` turning over, since a job of
four hundred names runs over days by design. `leaseBy` is the page currently
holding the job — two tabs would otherwise follow the same account twice — and it
is handed back before each navigation, with `leaseUntil` covering the case where
the tab is simply closed.

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
