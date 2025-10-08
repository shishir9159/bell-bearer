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

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Loads the mock, the extension sources, and the specs; renders results |
| `harness.js` | ~80-line test framework (`suite` / `test` / `assert*`) |
| `mock-chrome.js` | Mock of the `chrome.*` APIs the extension uses, plus a mocked `fetch` |
| `serve.js` | Static file server, for when `file://` will not do |
| `background.test.js` | Tab positioning, sowon reporting, protobuf/gRPC-Web encoding |
| `transcript.test.js` | `TranscriptError` classification, `TimeIndex` lookups |
| `speed.test.js` | The playback-rate ladder: stepping, clamping, formatting |
| `player.test.js` | Speed shortcuts, holding the rate against the page, boost, skipping |
| `shortcuts.test.js` | Which binding claims which keystroke, and the typing guard |
| `bookmarks.test.js` | De-duplication, merging, import parsing, URL parsing, escaping |

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

`background.js` is covered thoroughly because it holds the other logic that has
broken in the past. Every historical Ctrl+T failure mode has a dedicated test:

- activation winning the race against `onCreated`
- MV3 service-worker sleep wiping in-memory state
- a brittle new-tab **URL** check skipping custom new-tab pages
- Chrome transiently refusing `tabs.move` and the error being swallowed

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
