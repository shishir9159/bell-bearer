# Tests

No npm, no build. The real sources run unmodified against a mock `chrome.*`,
driven by real events.

| Run | What |
| --- | --- |
| `node tests/node-check.js [word]` | Pure logic, in seconds. Run it on every change; `word` keeps only sections whose name has it |
| `tests/index.html` | The browser suite. Run it before committing |
| `node tests/serve.js` | Serves the repo at <http://localhost:5601/tests/> when `file://` loads are blocked. `entries.test.js` needs it, and over `file://` its specs say SKIP |

**Keep the tab visible.** A hidden tab throttles timers, and the mock defers
every callback through one, so a hidden run takes minutes.

Any page takes `?suite=<word>`. `x-only`, `chat-only`, `forge-only`,
`text-reader-only` and `party-only` load just the modules their specs touch.

## Support files

| File | |
| --- | --- |
| `harness.js` | `suite` / `test` / `assert*`, `skip(why)` for a spec that cannot run where it is, and the page that runs them |
| `mock-chrome.js` | The `chrome.*` APIs in use, plus `fetch` |
| `load-order.js` | Checks every script list; `node tests/load-order.js` prints what is out of order |
| `chat-stage.js` | A chatgpt.com-shaped page for the chat specs |
| `party-vectors.json` | Cases every party server must pass |
| `party-dev-server.js` | A local party server: `--lag 200 --jitter 150 --loss 5` |
| `party-conformance.js` | Replays the vectors: `node tests/party-conformance.js ws://localhost:7070` |
| `live-transcript.html` | transcript.js against YouTube itself, so it is in neither suite. Open it as `chrome-extension://<id>/tests/live-transcript.html`, `?v=<id>` for another video |

## The mock

It loads **before** the sources, which register their listeners as they load.

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

- `tabs.move` really reorders the mock's tabs.
- `soon()` must stay a `setTimeout`: a microtask runs every callback ahead of
  the code's own timers and turns sowon's back-off test green regardless.
- `settle()` waits longer in a hidden tab; an explicit `settle(ms)` never scales.
- `encodeFocusUpdateFrame`'s bytes are asserted here and in sowon's Zig
  `decodeFocusUpdate` test. Change one, change both.
