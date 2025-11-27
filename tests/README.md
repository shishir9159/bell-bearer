# bell-bearer test suite

Zero dependencies: no npm, no build step. The extension's real source files are
loaded unmodified against a mock `chrome.*` API and driven with real event
sequences — real `KeyboardEvent`s, a real `<video>` element.

## Running

**Easiest — open in Chrome:**

```
tests/index.html
```

Double-click it, or drag it into a Chrome tab. Green banner = all passing.

**If your browser blocks `file://` sub-resource loads**, serve the folder over
HTTP. A dependency-free server ships with the suite:

```bash
node tests/serve.js
```

Then open <http://localhost:5601/tests/>. Any other static server works too.

**Keep the tab visible while it runs.** Browsers throttle timers hard in a
background tab — a 100ms `setTimeout` can take a full second, and longer the
longer the page stays hidden — and the mock defers every `chrome.*` callback
through one. Visible, the suite is done in seconds; hidden, the same tests
legitimately take minutes. The per-test timeout moves with `document.hidden`
for exactly that reason, so a hidden run is slow rather than falsely red.

**While changing the x.com code**, open `tests/x-only.html` instead. It runs
`x-pouch.test.js` against only the modules that file touches, which takes a
second even in a hidden tab — the full suite spends minutes in the
background-worker and player sections, whose timers a hidden tab throttles to
about one a second. It is a fast gate, not a substitute: run `index.html`
before committing. `tests/chat-only.html` is the same for the chat code, and
takes `?suite=` to run only the suites whose name has that in it — the queue's
specs alone take a minute in a hidden tab, because every one of its storage
writes waits on a throttled timer.

**Without a browser**, for the parts that are pure logic:

```bash
node tests/node-check.js
```

The speed ladder, escaping and URL safety, checkpoint merging, timestamps, the
activity store, the color palette, remembered cookie sites, export/import, the
shortcut registry (defaults, turning off, rebinding, conflicts), the chess.com
and Lichess game reading (clock inference, win/loss and flagging summaries,
archive caching, a Lichess read resuming at both edges after an interruption)
and the in-game parts (time controls per site, warning and speech settings,
moves spoken as words), in about a second. It is a fast gate while you are changing
that code, not a replacement — it cannot press a key or play a video.

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Loads the mock, the extension sources, and the specs; renders results |
| `harness.js` | ~80-line test framework (`suite` / `test` / `assert*`) |
| `mock-chrome.js` | Mock of the `chrome.*` APIs the extension uses, plus a mocked `fetch` |
| `serve.js` | Static file server, for when `file://` will not do |
| `background.test.js` | Sowon reporting, protobuf/gRPC-Web encoding, context menus |
| `transcript.test.js` | `TranscriptError` classification, `TimeIndex` lookups |
| `speed.test.js` | The playback-rate ladder: stepping, clamping, formatting |
| `player.test.js` | Speed shortcuts, holding the rate against the page, boost, skipping |
| `shortcuts.test.js` | Which binding claims which keystroke, and the typing guard |
| `bookmarks.test.js` | De-duplication, merging, import parsing, URL parsing, escaping |
| `activity.test.js` | The activity store, and the relative-time labels on video cards |
| `youtube-ui.test.js` | Where the "Pouch" row lands in YouTube's left drawer |
| `pouch.test.js` | The filed/followed state of the injected pouch and playlist buttons |
| `x-pouch.test.js` | x.com: where the pouch button lands, what a post reads as, what the ad sweep hides |
| `x-only.html` | The X specs alone — the same file, minus everything slow (see below) |
| `chat-stage.js` | A chatgpt.com-shaped page for the chat specs: virtualised, with working branch arrows and a composer that streams |
| `chat.test.js` | The chat panel: outline, reaching unmounted turns, branch switching, compare, export, pins, skins |
| `chat-queue.test.js` | Typing into a chat composer, the prompt picker, the queue, holding on a limit |
| `chat-claude.test.js` | The same core on a claude.ai-shaped page: rows tied by place and words, hover-drawn arrows, the stream bridge, exact limits |
| `chat-only.html` | The chat specs alone; `?suite=queue` narrows it to one suite |
| `node-check.js` | The Node gate — pure logic only, no DOM, no timers |

## How it works

Extension code registers its listeners at load time, so `mock-chrome.js` is
loaded **before** the sources and installs `window.chrome`. Tests then call
`MockChrome.reset({...})` to clear per-test state and
`MockChrome.fire.created(tab)` / `.activated(id, win)` to drive real listener
code. `MockChrome.settle()` awaits the queued async storage/tab callbacks.

Because the mock reorders `state.tabs` on `tabs.move`, assertions can check the
*resulting tab order*, not just that a move was requested. The mock offers both
the callback and the promise form of every API, the way Chrome and Firefox do —
the shared modules use promises throughout.

`soon()`, which defers every mocked callback, has to stay a **macrotask**.
Switching it to `queueMicrotask` makes a hidden-tab run dramatically faster,
and is tempting for that reason — but it hoists every mocked callback ahead of
any `setTimeout` the code under test is waiting on. That silently reorders the
back-off in `sowon`, and turns a real regression test green no matter what
that file does.

`MockChrome.settle()`'s default moves with `document.hidden` for the same
reason — a wait that comfortably drains the callback queue in a visible tab
drains almost none of it in a hidden one. An **explicit** argument is never
scaled, because a test that passes one is usually timing something on purpose,
like staying inside the sowon throttle window.

That is also the limit of what adapting can buy. A hidden tab clamps *every*
timer to roughly one a second, so the ordering between a 20ms wait and a 150ms
throttle simply cannot be reproduced — both land at ~1s. If the sowon back-off
test fails while everything else passes, check the tab was visible before
reading it as a regression.

The activity tests drive `Activity.tick`'s clock through its optional `now`
argument instead of sleeping. The store's whole job is arithmetic on two
timestamps; sleeping through the elapsed time would make those tests both slow
and dependent on timer resolution.

They also pin the thing that made the feature look dead: the marker each tick
measures from has to be kept in `chrome.storage.session`, because in MV3 the
worker holding it is gone well before the next alarm. `node-check.js` reproduces
that restart exactly — it drops the module from `require.cache` and evaluates it
again, leaving only storage to carry the marker across.

The feed checks are about identity rather than parsing. A YouTube channel page
mentions a dozen channels and only three of those mentions are its own, so the
fixtures put a stranger's id where the old resolver looked — first `"channelId"`
in the document — and the page's real id only where the canonical link and the
channel metadata put it. A resolver that reads the recommendation rail passes
nothing here.

`background.js` itself is only an `importScripts()` shim for the service worker,
so `index.html` lists the parts from `src/background/` directly, exactly as
`manifest.firefox.json` does. **Keep those two lists and the shim in step.**

## Coverage notes

Speed has a dedicated regression suite because it is what actually broke.
`player.test.js` pins each of the three causes:

- one keypress ran both our handler and the page's, so `>` moved two rungs —
  `preventDefault()` does not stop another listener, only
  `stopImmediatePropagation()` does;
- the site reset `playbackRate` when it loaded a new source (a new video, an ad)
  and nothing put it back;
- a change made through the site's own speed menu was ignored, so the next step
  jumped from a rate the user could not see.

`speed.test.js` covers the ladder itself, including the case that made stepping
feel random: an off-ladder rate used to step to *nearest + 1*, so 2.4 became 3
and skipped 2.5 entirely.

"Open new tabs next to the current tab" was removed rather than fixed again:
moving tabs from `tabs.onCreated` cannot tell a Ctrl+T apart from a window
being restored, so it reshuffled restored windows and dragged tabs into and out
of tab groups.

Copy-as-Markdown is covered too, including the regression test *"nothing is
triggered by copying, only by the menu"*. An earlier version intercepted
<kbd>Ctrl</kbd>+<kbd>C</kbd> and converted the page whenever the selection
*looked* empty — but `window.getSelection()` returns empty for selections inside
shadow DOM and form fields, so ordinary copies were being replaced by a Markdown
link. Conversion is now only ever an explicit right-click action.

The rendering surfaces (`src/content/youtube-ui.js`, `src/page/*`) are not
covered: they need a live page DOM. Their logic-carrying parts — escaping, URL
safety, merging — were moved into `src/shared/` and are covered there.

## Cross-language contract

`encodeFocusUpdateFrame` produces the protobuf `FocusUpdate` message that the
sowon timer decodes. The exact byte sequence is asserted **from both sides**:

- here, in *"encodeFocusUpdateFrame matches the wire format sowon decodes"*
- and in Zig, in `sowon-zig/src/server.zig`'s `decodeFocusUpdate` test

If you change the message, both tests must be updated together — which is the
point.

## Adding a test

```js
suite('my area', () => {
    test('does the thing', async () => {
        MockChrome.reset({ tabs: [...], localStore: { someSetting: true } });
        MockChrome.fire.activated(1, 100);
        await MockChrome.settle();
        assertEqual(MockChrome.indexOf(4), 2);
    });
});
```

Then add your `<script src="my.test.js">` to `index.html` after the sources.
