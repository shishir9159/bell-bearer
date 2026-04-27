# Bell Bearer

[![CI](https://github.com/shishir9159/bell-bearer/actions/workflows/ci.yml/badge.svg?branch=master&event=push)](https://github.com/shishir9159/bell-bearer/actions/workflows/ci.yml)

A browser extension for organizing what you watch and read, with bookmarks, topics, reading tools, and keyboard shortcuts.

<p>
  <a href=""><img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chrome/chrome.svg" width="36" height="36" alt="Chrome" title="Chrome — not published yet"></a>
  <a href=""><img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg" width="36" height="36" alt="Firefox" title="Firefox — not published yet"></a>
  <a href=""><img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/edge/edge.svg" width="36" height="36" alt="Edge" title="Edge — not published yet"></a>
  <a href=""><img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari/safari.svg" width="36" height="36" alt="Safari" title="Safari — not published yet"></a>
</p>

<!-- Store listings are not published yet. Browser links are placeholders. -->

Bell Bearer is not in any store yet: the browser icons above are placeholders, not links to a listing.

## Install

- **Chrome, Edge, Brave and other Chromium browsers.** Open `chrome://extensions`, turn on Developer mode, choose *Load unpacked* and pick this folder. `node tools/pack.js` builds the same thing as `dist/bell-bearer-<version>.zip`.
- **Firefox 128 or newer.** Run `node tools/pack.js --firefox`, then load the zip from `about:debugging` → *This Firefox* → *Load Temporary Add-on*. It stays until Firefox restarts; a lasting install needs the add-on signed by Mozilla. Firefox has no speech engine for extensions, so spoken chess moves use the page's own voice.
- **Safari** is not supported.

After pulling changes, reload the extension at `chrome://extensions` and reload any tab it was open in: an open page keeps the scripts it loaded with.

## Defaults and shortcuts

Most of what puts something into a site's own page — buttons in X, GitHub and the chat sites, hidden ads or counts, downloads — is off until you switch it on in the dashboard's Settings, and so are activity tracking and the bare-letter shortcuts (Skim, link hints, the pouch). A few are on from the start, because they only add to what you are already doing there: the *Always accept* and *Always reject* buttons on cookie banners, LeetCode's timer and grade prompt, and the offer to hold a chat's queue when the site says a limit was reached. Every shortcut is listed, and can be changed or turned off, in Settings → Shortcuts.

## Your data

Everything is kept in the browser's extension storage on this machine. There is no Bell Bearer server, and nothing is sent anywhere except by a feature you use, to the site it is about:

- YouTube transcripts and your channels' feeds from YouTube; a video's streams from YouTube or Vimeo when you save one.
- Game archives from chess.com and Lichess, and LeetCode's public calendar when a username is set.
- Article previews from Wikipedia, which can be turned off.
- A chat's conversation from ChatGPT or Claude, for the chat panel and exports, and Netflix's subtitle files when several are shown at once.
- A CI run's status from the forge it is on, and a folder's files from GitHub when you zip one.
- Your focus, to a sowon timer on `127.0.0.1` only, when that is switched on.
- In a watch party: the party server you name; for a peer-to-peer party, the STUN servers in Settings (Google's and Cloudflare's to begin with), the WebTorrent trackers for a tracker party, and your TURN server if you set one.

What is kept, and for how long: activity totals for 60 days, and the single longest page of each day for 7; a daily limit's tally for today only; sent or failed queued prompts for a day; the last 200 TypeRacer races, and a little over a year of LeetCode and TypeRacer practice days. Highlights in the text reader are not stored at all.

**Export and import** (the dashboard's header) carry every setting and all saved data in one JSON file, without caches. Import either replaces your setup with the file's or merges the file into it, and saves your setup as it was to a file first, which imports it back. An export holds your settings in full — **including a TURN server's username and password** if you set one — so keep the file as you would the password.

## Permissions

| Permission | Why |
| --- | --- |
| All sites | Its scripts run on every page for the reader, Skim, daily limits and cookie banners, and fetch what the features above name |
| `storage`, `unlimitedStorage` | Everything above, kept locally; Chrome caps an extension at 10 MB without the second |
| `tabs`, `activeTab`, `scripting` | Reading which tab is in front, and putting the reader and a watch party into the one you ask for |
| `alarms` | Activity readings, scheduled prompts, chess limits and a party's last half minute, with the worker asleep |
| `notifications` | A watched CI run finishing |
| `downloads` | Saving videos, zipped folders and exports |
| `history`, `sessions` | Skim's history search, and reopening the last closed tab |
| `tabGroups` | Trials, which are tab groups |
| `contextMenus`, `clipboardWrite` | Copying a page or link as Markdown |
| `offscreen` | A watch party lives in an offscreen document, so it outlasts the worker (Chrome) |
| `tts` | Reading chess moves aloud (Chrome) |

## Development

No build step or dependencies. CI runs `node tests/node-check.js`, the browser suite in headless Chrome (`node tests/run-browser.js`), the extension installed in one (`node tests/installed.js`) and both packages; see [tests/README.md](tests/README.md).

### Roadmap
- [ ] Add a walkthrough inside the extension that introduces its features and shows how to use them.
- [ ] Tab-local sound clamping.
- [ ] Tab-local media sound boost.
- [ ] Improve the Vomnibar search bar: movement threshold and smooth transition option.
- [ ] Detect chess board flips and keep voice working in focus mode.
- [ ] Add arxiv.org support.
- [ ] Explore [Nano integration](https://developer.chrome.com/docs/ai/summarizer-api).
- [ ] Improve title and header readability in the Art Deco skin.