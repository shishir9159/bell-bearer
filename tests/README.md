# bell-bearer test suite

Zero dependencies: no Node, no npm, no build step. The extension's real source
files are loaded unmodified against a mock `chrome.*` API and driven with real
event sequences.

## Running

**Easiest — open in Chrome:**

```
tests/index.html
```

Double-click it, or drag it into a Chrome tab. Green banner = all passing.

**If your browser blocks `file://` sub-resource loads**, serve the extension
folder over HTTP and open `/tests/index.html`. Any static server works, e.g.:

```powershell
# from the bell-bearer folder
python -m http.server 5601      # then http://localhost:5601/tests/index.html
```

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Loads the mock, the extension sources, and the specs; renders results |
| `harness.js` | ~80-line test framework (`suite` / `test` / `assert*`) |
| `mock-chrome.js` | Mock of the `chrome.*` APIs the extension uses, plus a mocked `fetch` |
| `background.test.js` | Tab positioning, sowon reporting, protobuf/gRPC-Web encoding |
| `transcript.test.js` | `TranscriptError` classification, `TimeIndex` lookups |

## How it works

Extension code registers its listeners at load time, so `mock-chrome.js` is
loaded **before** `../background.js` and installs `window.chrome`. Tests then
call `MockChrome.reset({...})` to clear per-test state and
`MockChrome.fire.created(tab)` / `.activated(id, win)` to drive real listener
code. `MockChrome.settle()` awaits the queued async storage/tab callbacks.

Because the mock reorders `state.tabs` on `tabs.move`, assertions can check the
*resulting tab order*, not just that a move was requested.

## Coverage notes

`background.js` is covered thoroughly because it holds the logic that has
actually broken in the past. Every historical Ctrl+T failure mode has a
dedicated regression test:

- activation winning the race against `onCreated`
- MV3 service-worker sleep wiping in-memory state
- a brittle new-tab **URL** check skipping custom new-tab pages
- Chrome transiently refusing `tabs.move` and the error being swallowed

Copy-as-Markdown is covered too, including the regression test
*"nothing is triggered by copying, only by the menu"*. An earlier version
intercepted <kbd>Ctrl</kbd>+<kbd>C</kbd> and converted the page whenever the
selection *looked* empty — but `window.getSelection()` returns empty for
selections inside shadow DOM and form fields, so ordinary copies were being
replaced by a Markdown link. Conversion is now only ever an explicit
right-click action.

`content.js` is **not** covered: it instantiates itself on load and expects a
live YouTube DOM, so it would need refactoring to be testable in isolation.
Its `buildLinkMarkdown` label fallbacks are currently verified manually.

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
