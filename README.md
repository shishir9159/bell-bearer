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
- **Import/Export**: Backup and restore bookmarks, import from YouTube timestamp links
- **Topics overlay**: A frosted sheet over YouTube — topic rail, thumbnail grid, time range and sort
- **Skins**: Default, Riso Paint, Medieval and Art Deco, each with its own day and night
- **Activity**: Opt-in, on-device record of where your screen time goes
- **Reward System**: Track watch credits to spend them on popcorn for later

Import, export and "clear all" live in the dashboard. The popup header is
Dashboard alone, so the row never has to shrink or scroll.

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

Down the rail, **All** covers the channels you have filed. The **All subscribed**
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

Speed steps through one fixed ladder — 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
2.25, 2.5, 3, 3.5, 4, 5 — and the popup's buttons step the same ladder, so the
two controls always agree. When a site resets the rate (a new video, an ad
break) the speed you picked is re-applied; when *you* change it through the
site's own speed menu, that becomes the new setting instead. Turn the re-apply
off with **Keep my playback speed** in Settings.

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

The display faces are **not bundled** — all are SIL OFL, so download the woff2
files from fonts.google.com into `fonts/` under the names listed at the top of
`skin-fonts.css`. Without them every skin still works and simply falls back to
a system stack. The injected UI additionally needs `fonts/*.woff2` in
`web_accessible_resources` before a page-side skin font can load; the fallback
is what ships today.

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
is never sent anywhere, is pruned past 60 days, and the only per-URL thing kept
is the title of each day's single longest page.

A 30-second alarm in the service worker takes the readings, and it exists only
while tracking is on — nothing is woken while the setting is off. Each reading
credits elapsed wall time to whatever was focused at the *previous* one, so a
suspended MV3 worker cannot inflate a total, and a gap longer than 90 seconds is
dropped rather than counted as time at the screen. That "previous" marker lives
in `chrome.storage.session`, because the worker itself does not survive the gap
between two alarms.

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
  feed.js          channel RSS, cached ten minutes; Refresh asks for fresh
                   resolves /@handle to a UC id by the page's canonical link
  time.js dom.js   formatting and escaping

src/content/    injected into every page
  main.js          bootstrap — decides what runs where
  player.js        speed, skipping, seeking, the temporary boost
  shortcuts.js     the keybinding table
  checkpoints.js   recording and saving checkpoints
  transcripts.js   transcript fetching and caching
  site.js          which site, and which <video> on it
  youtube-ui.js    the pouch button, the drawer entry, the topics sheet, the pouch panel
  dom-watch.js     one throttled MutationObserver for all of the above
  overlay.js notify.js theme.js page-info.js markdown.js

src/background/ the service worker, pulled in by background.js
  proto.js         the sowon wire format
  sowon.js         focus reporting
  tab-placement.js "open new tabs next to the current tab"
  context-menus.js "Copy as Markdown"
  commands.js      keyboard commands and messages
  activity-heartbeat.js  the alarm that feeds the activity store

src/page/       shared by popup.html and dashboard.html
  ui.js            modals, toasts, clipboard, files, theme
  transfer.js      import/export
  tab-actions.js   driving a video in another tab
  settings-form.js binds the settings form to storage
  skin-picker.js   the Appearance section
  stats.js         the Activity view
  popup-width.js   applies the popup size setting, from popup.html's <head>

skins.css       the token layer for every skin — linked before popup/dashboard css
skin-fonts.css  @font-face for the skin families (files not bundled; see Skins)
textures/       parchment, newsprint and grain tiles used by the skins
design/         the source design files this restyle was built from

tests/          zero-dependency browser test suite — see tests/README.md
```

#### Import/Export Data Format
The JSON export file contains:
```json
{
  "version": "1.0",
  "exportDate": "2025-01-08T06:30:00.000Z",
  "totalVideos": 5,
  "totalBookmarks": 25,
  "videos": [
    {
      "id": "video_id",
      "title": "Video Title",
      "url": "https://www.youtube.com/watch?v=video_id",
      "bookmarks": [
        {
          "time": 120,
          "timestamp": 1234567890,
          "note": "Checkpoint description"
        }
      ]
    }
  ]
}
```

## Permissions

- `storage`: To save and retrieve bookmarks
- `alarms`: The activity heartbeat — an MV3 worker is suspended a few seconds after it goes idle, taking any setInterval with it
- `activeTab`: To interact with YouTube pages
- `scripting`: To inject content scripts
- `contextMenus`: For the "Copy as Markdown" right-click items
- `tabs` / `tabGroups`: For tab placement and the sowon focus report
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

### Import/Export Features

- **Smart Merging**: When importing, the extension intelligently merges bookmarks without creating duplicates
- **Format Validation**: Imported files are validated to ensure they contain valid bookmark data
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Multiple URL Formats**: Supports both youtube.com and youtu.be URLs with various timestamp formats

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
