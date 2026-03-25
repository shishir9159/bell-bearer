# bell-bearer test suite

No npm, no build step. The real source files run unmodified against a mock
`chrome.*` and are driven with real events: real `KeyboardEvent`s, a real
`<video>`.

## Running

| Command / page | What it runs |
| --- | --- |
| `node tests/node-check.js` | The pure-logic gate, about a second. Run it on every change |
| `node tests/node-check.js party` | Only the sections whose `# name` has that word in it |
| `tests/index.html` | The browser suite. Green banner = all passing |
| `node tests/serve.js` | Serves the repo at <http://localhost:5601/tests/>, for when `file://` loads are blocked |

**Keep the tab visible.** A hidden tab throttles timers to about one a second
and the mock defers every callback through one, so a hidden run takes minutes
instead of seconds. `entries.test.js` reads the manifest, so it needs `serve.js`.

While working on one area, open its page instead. Each is a fast gate, not a
substitute: run `index.html` before committing.

| Page | Specs |
| --- | --- |
| `x-only.html` | x.com |
| `chat-only.html` | the chat panel; `?suite=queue` narrows it to suites with that word |
| `party-only.html` | the watch party, with the modules the party loader injects |
| `forge-only.html` | forge |
| `text-reader-only.html` | the text reader |

## Files that are not specs

| File | Purpose |
| --- | --- |
| `harness.js` | The ~80-line framework: `suite` / `test` / `assert*` |
| `mock-chrome.js` | The `chrome.*` APIs the extension uses, plus a mocked `fetch` |
| `load-order.js` | Checks every list that loads the classic scripts; `node tests/load-order.js` prints what is out of order |
| `chat-stage.js` | A chatgpt.com-shaped page for the chat specs |
| `party-vectors.json` | Cases every party server must pass |
| `party-dev-server.js` | A local party server: `node tests/party-dev-server.js --lag 200 --jitter 150 --loss 5` |
| `party-conformance.js` | Replays the vectors against a live server: `node tests/party-conformance.js ws://localhost:7070` |
| `live-transcript.html` / `.js` | Asks YouTube itself for captions, so it needs the network and is in neither suite. Open it as `chrome-extension://<id>/tests/live-transcript.html` |

## The mock

`mock-chrome.js` loads **before** the sources, because they register their
listeners at load time. A test resets state with `MockChrome.reset({...})`,
drives listeners with `MockChrome.fire.created(tab)` / `.activated(id, win)`,
and waits with `MockChrome.settle()`. `tabs.move` really reorders the mock's
tabs, so a test can assert the resulting order.

- `soon()` has to stay a `setTimeout`. A microtask is faster in a hidden tab
  but runs every callback ahead of the code's own timers, which reorders
  sowon's back-off and turns its regression test green whatever the code does.
- `settle()` with no argument waits longer in a hidden tab. An explicit
  argument is never scaled: a test that passes one is timing something.
- `index.html` lists `src/background/` itself, as `manifest.firefox.json` does.
  Keep both in step with `background.js`.
- `encodeFocusUpdateFrame`'s bytes are asserted here and in sowon's Zig
  `decodeFocusUpdate` test. Change the message, change both.

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

Then add `<script src="my.test.js">` to `index.html`, after the sources.
