# Bell Bearer fix plan

Audit date: 2026-10-23. Runtime baseline: `d6355dc` (`1.0`).

This is an implementation backlog from source review, the existing suites, and focused local probes. It covers the problems found in this audit; it is not a guarantee that every live-site or browser-specific defect has been discovered. No runtime fixes are included in this document.

## Validation baseline

| Check | Result |
| --- | --- |
| `node tests/node-check.js` | **1,072 / 1,072 passed** |
| Visible `http://localhost:5601/tests/` | **470 / 472 passed** at a **344 × 550 CSS-pixel viewport** |
| Browser failure: reader layout sizing | `dock left the player 0×0` |
| Browser failure: reader dragging | `the card did not follow the grip: expected 120, got 17` |
| `node tools/pack.js` | Passed; 244 runtime files |
| `node tools/pack.js --firefox` | Passed; 244 runtime files |

The browser suite uses mocked extension APIs; it does not establish that an installed extension works against current production sites. The drag assertion assumes enough horizontal room for a 120-pixel movement, so its failure also exposes a viewport-dependent test assumption. A separate call to `ReaderLayout.geometry('dock', 360, 800)` returned a zero-sized video, confirming the layout defect independently.

**Evidence labels:** **Reproduced** means a suite or focused local probe demonstrated it. **Code-reviewed** means the execution path was inspected, but its full user scenario was not exercised. **Unverified** checks appear separately below. One additional mock-probe command was rejected by automatic approval review without a specific reason; its intended checks are not reported as reproduced.

**Priorities:** P1 = data integrity, unintended actions, or a core feature failing; P2 = reliability, compatibility, accessibility, or misleading behavior; P3 = release documentation and usability. Check a task off only after its acceptance checks pass.

## P1 — data integrity and core behavior

### F01 — Serialize shared writes across extension contexts

- [ ] **Reproduced.** In [store.js](src/shared/store.js), `create()` gives each store instance its own promise chain. Different tabs, the popup, and dashboard can read the same old value and overwrite each other. Two independent instances appending `A` and `B` concurrently retained only `B`.
- **Fix:** Route mutations of each shared collection through one worker-owned operation queue, or use an actually transactional store. Send operation descriptions rather than whole stale collections. Include direct read/modify/write users such as `LimitSites.remember()` and `forget()`.
- **Acceptance:** Concurrent bookmark additions, note edits, topic changes, prompt changes, and time credits from separate contexts all survive. Test conflicting edits and worker restarts; tests using one shared module instance alone are insufficient.

### F02 — Make prompt ownership and send eligibility atomic

- [ ] **Code-reviewed.** [chat-runner.js](src/content/chat-runner.js), `once()`, checks `canClaim()` before `write()`, then unconditionally claims and marks the item `sending`. Two runners can pass the old check; even serializing the later writes alone does not fix this. The result of the write is not checked before inserting/submitting text.
- **Fix:** Claim through a worker operation that rechecks item status, pause/hold state, lease ownership, and conversation inside the same transaction. Return an explicit ownership token only after persistence succeeds; require it before sending and renewing. Recheck the route and composer after asynchronous waits.
- **Acceptance:** Two tabs on one chat produce exactly one submission. Failed persistence, expired ownership, a route change, or a pause before submission produces none. A new-chat chain remains owned while it binds to its conversation ID.

### F03 — Validate backup versions and stored value shapes

- [ ] **Reproduced.** [backup.js](src/shared/backup.js), `validate()`, checks only the type marker and that `data` is an object. Version `999` and `sitesOff: 'bad'` were accepted; `entries()` retained the malformed setting. `importAll()` does not validate independently.
- **Fix:** Reject unsupported versions and validate every recognized setting/data value before any write. Use per-store validation/migrations for nested records, finite numeric bounds, enum values, and activity-day keys. Keep unknown-key handling explicit and report rejected content.
- **Acceptance:** Wrong versions, null list entries, malformed queue records, invalid dates, and wrong setting types leave storage untouched and produce an understandable error. Valid older backups migrate successfully.

### F04 — Restore queued prompts as inactive data

- [ ] **Code-reviewed.** `Settings.DATA.promptQueue` is included by [backup.js](src/shared/backup.js). The whole value includes waiting prompts, `sending` states, and leases belonging to another page. [chat-runner.js](src/content/chat-runner.js) reacts to storage changes and can execute eligible restored prompts; the import dialog does not describe this.
- **Fix:** Export durable prompt content separately from execution state. Drop leases, normalize interrupted items to a reviewable held state, and pause imported queues until the user explicitly resumes them. Pause execution during the import itself.
- **Acceptance:** Importing a backup with waiting, scheduled, or sending prompts never submits a prompt or starts a queue automatically, including when a matching chat is already open.

### F05 — Stop reporting failed saves as successful

- [ ] **Code-reviewed.** [store.js](src/shared/store.js) catches write failures and resolves a fallback; `save()` also swallows failure. [checkpoints.js](src/content/checkpoints.js), `save()`, consequently returns a record and its callers announce success even when nothing was written. [leet-templates.js](src/shared/leet-templates.js), `create()`, similarly returns an ID after an unsuccessful update. Settings controls ignore `Settings.set()` returning `false`.
- **Fix:** Distinguish a safe read fallback from a failed mutation. Return an explicit mutation result, propagate it through callers, and show success only after acknowledgement. Preserve unsaved input and offer retry while continuing to handle invalidated contexts quietly.
- **Acceptance:** Inject storage read errors, quota/write errors, and context invalidation. Existing records survive, success messages do not appear, and retry saves exactly once.

### F06 — Bank time before clearing the focus marker

- [ ] **Reproduced.** In [time-limit.js](src/content/time-limit.js), blur and visibility changes call `sync()`, which resets `since` to zero without banking the elapsed interval. A probe with ten focused seconds followed by blur credited **zero**. Repeated visits shorter than the 15-second timer can evade the tally entirely.
- **Fix:** Bank the outgoing focused interval before clearing its marker; serialize transitions with timer ticks and setting changes. Do not count time spent out of focus. Split a credit crossing local midnight into the correct days.
- **Acceptance:** Ten seconds focused then blur contributes ten seconds, once. Repeated short visits accumulate. Hide/show, pagehide, disabling a limit, sleep/resume, and midnight do not lose or double-count time.

### F07 — Reconcile overdue scheduled prompts on startup

- [ ] **Reproduced in scheduling logic; startup path code-reviewed.** [prompt-queue.js](src/shared/prompt-queue.js), `nextWake()`, considers only future times. A queue with one due item returned `due.length === 1` and `nextWake === null`. The worker's startup callback calls only `sync()`, so an overdue item with no chat tab is not picked up if its old alarm is absent.
- **Fix:** Reconcile due work on startup, independently of alarm persistence. Hold stale items before opening tabs; honor paused queues, site enablement, queue-open-tab preferences, and in-progress work. Avoid repeated tab creation when an eligible tab has not finished loading.
- **Acceptance:** Close the browser before a scheduled time, clear the old alarm, and reopen afterward: eligible work is handled once; stale/paused work stays held; disabled sites open no tabs. Test an expired usage hold too.

### F08 — Keep activity tracking stopped while the browser is unfocused

- [ ] **Code-reviewed.** [activity-heartbeat.js](src/background/activity-heartbeat.js) clears the marker on `WINDOW_ID_NONE`, but the next alarm queries `{ active: true, lastFocusedWindow: true }` and calls `Activity.tick()` again. The last-focused window is still returned when another application owns focus; later alarms can therefore accrue time again.
- **Fix:** Check actual window focus on every alarm, including after worker restart, and keep the marker cleared while unfocused. Define idle/locked-screen behavior separately from browser focus.
- **Acceptance:** With activity enabled, switch to another app for several alarm periods: totals stop growing. Restart the worker during that interval and repeat. Refocusing starts a fresh interval without charging the gap.

## P2 — reliability, compatibility, and accessibility

### F09 — Correct the longest-page activity statistic

- [ ] **Reproduced.** [activity.js](src/shared/activity.js), `tick()`, accumulates duration only when the current title equals the existing winner's title. After page A accrued 60 seconds, page B accrued 90 seconds in 30-second samples, yet A remained the winner at 60 seconds. Different pages with the same title can also be conflated.
- **Fix:** Track the current visit independently of the best completed visit, using a suitable page identity and persisted timing marker. Preserve the intended retention limits; do not introduce a permanent URL history.
- **Acceptance:** B replaces A in the example above. Same-title pages, leaving and returning, tab switches, and worker restarts produce the defined single-visit statistic.

### F10 — Split activity intervals at hour and day boundaries

- [ ] **Code-reviewed.** [activity.js](src/shared/activity.js), `tick()`, assigns the entire gap to `dayKey(previous.at)` and the previous hour. A 30-second sample spanning midnight or an hour boundary is attributed wholly to the earlier bucket.
- **Fix:** Divide accepted intervals at local calendar boundaries and persist each affected bucket. Coordinate this with F08/F09 and serialize tick/blur/clear operations.
- **Acceptance:** 23:59:50–00:00:20 contributes 10 seconds to the earlier day and 20 to the next; totals equal the sum of hour and host buckets. Cover DST transitions and clearing activity during a pending tick.

### F11 — Make all video-reader layouts work in narrow windows

- [ ] **Reproduced.** [reader-layout.js](src/content/reader-layout.js), `geometry()`, reserves at least 330 pixels for Dock's transcript plus 48 pixels of padding, leaving no video width at 360 pixels. Float/Glass also impose large fixed minimum columns; Focus can extend the transcript beyond the left edge.
- **Fix:** Add a narrow layout policy, such as stacked content with a usable player and collapsible transcript controls. Clamp all boxes to available dimensions and preserve the media aspect ratio. Make drag assertions respect the actual movement available.
- **Acceptance:** Run every layout and drag control at 320, 360, 640, 1024, and 1440 pixels, short heights, and browser zoom. No zero-sized player, unreachable controls, or off-screen reading column; the two failing browser checks become meaningful at each size.

### F12 — Make backup replacement semantics and failures explicit

- [ ] **Reproduced for retained keys; UI failure handling code-reviewed.** [backup-buttons.js](src/page/backup-buttons.js) says settings/data are replaced, but `Backup.importAll()` only calls `storage.local.set()`. Importing a file without `sitesOff` retained the destination's existing value. Absent data can remain or become orphaned. Import/export storage failures have no UI catch.
- **Fix:** Offer clearly defined merge or replace behavior. For replace, reset/remove managed keys absent from the validated snapshot, coordinate active writers, and retain a recoverable pre-import snapshot. Specify cache handling. Catch export/import failures and show completion only after success.
- **Acceptance:** Import into a populated profile and compare every managed key with the chosen mode. Test omitted settings, empty collections, activity indexes, stale caches, and storage failure. Failed restore can recover the original data.

### F13 — Match the advertised browser baseline to the required APIs

- [ ] **Code-reviewed and checked against Mozilla compatibility data.** [manifest.firefox.json](manifest.firefox.json) advertises Firefox 115, while [site-scripts.js](src/background/site-scripts.js) registers MAIN-world bridges. MAIN support arrived in Firefox 128; refused registrations are logged but the dependent feature can remain exposed.
- **Fix:** Raise the supported Firefox minimum to a tested version or implement and test a fallback. Set/document a tested Chromium baseline and communicate unavailable capabilities instead of leaving controls apparently usable. Chrome's party host already guards `runtime.getContexts`; preserve that guard.
- **Acceptance:** Install the packed extension at each declared minimum and current supported browser. Exercise chess, LeetCode, Claude, Netflix, X thread capture, party startup, and Firefox speech fallback.
- **Sources:** [Mozilla's Firefox 128 announcement](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/), [MDN scripting compatibility data](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/scripting.json), [Chrome offscreen compatibility guidance](https://developer.chrome.com/docs/extensions/reference/api/offscreen#before-chrome-116-check-if-an-offscreen-document-is-open).

### F14 — Retry response-body failures and bound stalled downloads

- [ ] **Reproduced for body failures.** [fetch-pool.js](src/shared/fetch-pool.js), `fetchBody()`, catches failure from `fetchImpl()` but reads `response.blob()`/`arrayBuffer()` outside that catch. A rejected body stream made **one attempt instead of three**. No per-attempt timeout bounds an indefinitely stalled body.
- **Fix:** Include body consumption in retry handling, preserve immediate cancellation, and apply a per-attempt timeout. Respect server retry guidance for 429 responses. Abort remaining work when a batch fails; add cancellation and byte limits to folder downloads, whose current cap counts files only.
- **Acceptance:** Recover from a body stream failing after headers, a short body, and transient 5xx/429 responses. Cancellation is prompt; a stalled body terminates; a small number of very large files cannot exhaust memory unchecked.

### F15 — Discard CI results belonging to an earlier watch

- [ ] **Code-reviewed.** [ci-watch.js](src/content/ci-watch.js), `poll()`, awaits the adapter fetch then calls `check(read)` against the current `page` and `watching`. It does not retain and verify the identity of the watch that started the fetch. A delayed response for run A can be applied after navigation and watching run B. `start()` also awaits a worker response before assigning `watching` without a final route check.
- **Fix:** Capture a watch generation/key for every asynchronous operation and discard stale completions. Cancel obsolete requests where possible and prevent overlapping polls. Handle adapter rejection without leaving an unhandled promise.
- **Acceptance:** Delay A's response, navigate to B and start watching it, then finish A: B stays watched and receives no A notification. Repeat with Stop, a route change during Start, and a rejected fetch.

### F16 — Clean up party resources after startup exceptions

- [ ] **Code-reviewed.** [background/party.js](src/background/party.js), `createParty().start()`, cleans up an `{ ok: false }` response, but has no cleanup around a rejected `host.ask()` after `host.open()`. Router error conversion reports failure while the offscreen resource can remain open. Concurrent starts/leaves are not coordinated as a whole operation.
- **Fix:** Make startup a guarded lifecycle operation with cleanup for every failed stage. Serialize or invalidate conflicting starts/leaves and avoid closing a newer successful party while cleaning up an old attempt. Ensure partial session initialization can be torn down safely.
- **Acceptance:** Inject failures after opening, during session startup, and during tab binding. No idle orphan document, stale binding, timer, or connection remains. Rapid Start/Leave/Start finishes in the last requested state.

### F17 — Validate inbound party protocol messages

- [ ] **Code-reviewed.** [party-ws.js](src/offscreen/party-ws.js), `receive()`, bounds outgoing frames but parses inbound data without a size/schema check. It treats a string `t` as sufficient. [party-session.js](src/offscreen/party-session.js), `fromAuthority()`, dereferences `msg.room.id` and other nested fields without validating a welcome first.
- **Fix:** Enforce inbound byte limits and versioned message schemas before mutating transport/session state. Check arrays, finite numbers, allowed media/state values, and member counts. End malformed sessions with a useful error and reliable cleanup. Apply equivalent validation at other transport boundaries.
- **Acceptance:** Missing `room`, non-array members, oversized frames, invalid sequence/rate values, and malformed JSON do not throw uncaught errors or leave a join pending indefinitely. Valid conformance vectors still pass.

### F18 — Enforce both numeric bounds and settings-form teardown

- [ ] **Reproduced for bounds; teardown code-reviewed.** [settings-form.js](src/page/settings-form.js), `readControl()`, clamps only `min`, ignoring `max`. A value of 1000 with max 100 was returned unchanged. `bindAll()` can also attach listeners after its teardown has already run because the initial `Settings.get()` is asynchronous.
- **Fix:** Validate finite values, both bounds, and intended step behavior; reflect the normalized value in the control. Mark disposed bindings and ignore late initial reads, so they cannot overwrite a newer update or reattach listeners. Handle failed writes as in F05.
- **Acceptance:** Reader font size, seek seconds, retention, and queue gap cannot exceed their declared bounds by typing. Unmount before the first read resolves and verify no handlers are attached afterward.

### F19 — Make shared dialogs keyboard and screen-reader accessible

- [ ] **Code-reviewed.** [ui.js](src/page/ui.js), `openModal()`, sets `role="dialog"` and `aria-modal`, but does not provide a dialog name, trap focus, make background content inert, or restore focus. `confirmDialog()` does not move focus into the dialog.
- **Fix:** Give each dialog an accessible title, move focus to an appropriate control, contain Tab/Shift+Tab, restore the invoking element on close, and prevent background activation. Ensure Escape does not also trigger the page behind the dialog.
- **Acceptance:** Complete import confirmation, cancel, and template editing using only the keyboard and a screen reader. Focus never disappears behind the overlay and returns correctly after every dismissal path.

### F20 — Contain and harden the development server

- [ ] **Reproduced for the path-prefix predicate; remaining paths code-reviewed.** [serve.js](tests/serve.js) uses `file.startsWith(ROOT)`, which also accepts a sibling such as `bell-bearer-sibling`. `decodeURIComponent()` is unguarded, and `.listen(PORT)` does not restrict the server to loopback. The server exposes the repository tree, including dotfiles, to reachable clients.
- **Fix:** Bind explicitly to loopback, catch malformed URLs with a 400 response, use separator-aware containment (and account for symlinks), and deny repository metadata/private files. This is a development-tool fix; the server is excluded from shipped packages.
- **Acceptance:** Legitimate suite resources load; encoded traversal, same-prefix sibling paths, dotfiles, and malformed escapes cannot escape the allowed tree or terminate the server. Remote interfaces do not accept connections.

### F21 — Do not treat a rejected Sowon report as delivered

- [ ] **Code-reviewed.** [sowon.js](src/background/sowon.js), `send()`, resets failures and updates `lastSent` after any resolved `fetch()`. HTTP 4xx/5xx responses resolve, so they are counted as success and an identical report is then suppressed.
- **Fix:** Verify HTTP success and the service's gRPC-Web response status before marking delivery. Apply bounded retries/backoff and a timeout; keep the integration disabled by default.
- **Acceptance:** HTTP 500, a gRPC failure, a stalled request, and a connection error do not mark the report delivered. A later successful report clears backoff and resumes duplicate suppression.

### F22 — Cancel an obsolete time-limit sheet while appearance loads

- [ ] **Code-reviewed.** [time-limit.js](src/content/time-limit.js), `showSheet()`, assigns the shared `sheet`, awaits `appearance()`, then dereferences `sheet`. A snooze or settings update can call `hideSheet()` during the await and set it to null, causing a rejected render or stale display.
- **Fix:** Capture the created element locally and use a generation/identity check after the await. Append only if the block is still current; handle appearance failure without blocking the page permanently.
- **Acceptance:** Delay appearance loading, then snooze/remove the limit before it resolves. No exception or orphan overlay appears. Repeated block/unblock transitions leave at most one current sheet.

### F23 — Expand automated verification beyond the current green checks

- [ ] **Code-reviewed.** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs only Node checks on pushes to `master`; it has no pull-request trigger or browser job. [entries.test.js](tests/entries.test.js) omits GitHub, GitLab, Codeberg, and Vimeo from `MARKS`, and silently returns under `file://`. Mocked APIs do not exercise real MV3 suspension or installed MAIN-world registration.
- **Fix:** Add PR validation, HTTP-served browser tests with explicit viewport coverage, full site-entry coverage, and package smoke checks. Report skipped tests as skipped. Keep runtime dependency-free; any test-only tooling must stay out of packages. Add real installed-extension lifecycle tests or a recorded manual release gate.
- **Acceptance:** A failing browser/entry check blocks a PR; every registered site boots enabled and disabled. Release checks cover worker suspension/restart, registration failure, tab discard, extension reload, and Chrome/Firefox package installation.

## P3 — release documentation

### F24 — Document the actual feature and permission surface

- [ ] **Code-reviewed.** [README.md](README.md) describes bookmarks/reading broadly but does not explain the implemented chat queues, CI watching, downloads, time limits, or parties. Both manifests have the uninformative description `bell bearer`. Store links are explicitly placeholders; they must not be presented as published downloads.
- **Fix:** Add installation steps, supported browsers/versions, feature defaults, keyboard help, data retention/backup behavior, and permission explanations. Describe optional network integrations, tracker/STUN/TURN use, and the fact that `partyTurn` credentials currently enter full backups. Review whether sensitive capabilities can be optional without breaking the generic tools.
- **Acceptance:** A new user can install, identify which features are active, understand where their data goes, disable integrations, and recover a backup. Store metadata and browser support claims agree with the tested packages.

## Live verification still required

These are investigation tasks, not asserted production failures. Record the browser version, URL type, setting, reproduction steps, and outcome; create a new numbered fix only when a problem is demonstrated.

| Area | Required scenarios |
| --- | --- |
| YouTube / Vimeo | Current DOM and signed media URLs, captions/languages, Shorts, playlists, private/restricted media, ad transitions, reader fullscreen, canceled Save As, and interrupted downloads. |
| X / Reddit | Current and legacy layouts, localized labels, SPA navigation, virtualized lists, thread capture, pouch controls, cookie controls, and manual roster operations. |
| Chess.com / Lichess | Board flips, focus mode, multiple boards, changing class names, move validation, game/day boundaries, clock warnings, spoken moves, and Firefox speech. |
| LeetCode / TypeRacer | Current editors/results, language changes, duplicate submission events, mock timer expiry, IME/input handling, race aborts, and tracking disabled. |
| ChatGPT / Claude | Current API/DOM shapes, sign-in expiry, branch changes, streamed responses, usage-limit resets, navigation while a prompt is queued, and multiple open copies of a conversation. |
| GitHub / GitLab / Codeberg | Own-PR detection, newly added/retried checks, manual jobs, sign-in expiry, slow polling, navigating away permanently, and ability to stop/release a held watch. |
| Netflix / Wikipedia / generic articles | Current player/manifest bridges, DRM playback unaffected, missing subtitles, locale changes, article extraction, footnotes/math, highlight lifecycle, and SPA navigation. |
| Parties | Two real browsers and networks, unavailable TURN, tracker failure, host departure, stale invites, reconnect, suspended/discarded tabs, sleep/resume, and mismatched media. |
| Extension surfaces | Popup at both widths, dashboard lazy views, all skins, zoom/high contrast/reduced motion, keyboard access, restricted browser pages, host permissions, and orphaned content scripts after reload. |

The README's requested features (audio clamp/boost, clone-command changes, walkthrough, search transitions, arXiv, Nano, spoiler hiding, and naming changes) remain feature work. Its board-flip/voice and Art Deco readability reports need targeted reproduction; neither is claimed fixed by this audit.

## Implementation order and completion gate

1. Establish the missing regression tests, then fix F01/F02/F05 together at the design level but in separate small commits. Every caller must understand mutation failure before queued actions depend on it.
2. Implement safe imports (F03/F04/F12), then scheduling and time accounting (F06–F10).
3. Fix reader responsiveness, networking, async lifecycle, compatibility, and accessibility (F11, F13–F22).
4. Complete CI/site-entry coverage (F23), live verification, and release documentation (F24).

For each implementation: add a targeted regression, run `node tests/node-check.js`, and run the relevant visible browser suite. Keep classic-script load order and the `BB` export convention; update every applicable loader and load-order check when adding modules. Party files remain out of manifest content scripts. Use Phosphor icons and run `node tools/icons.js` only if icon usage changes.

Before release, run the complete visible browser suite at wide and narrow sizes, package both browsers, and test those packages installed. A fix is complete only when its acceptance checks pass, persistence survives reload/restart, and failures are surfaced honestly. Keep each feature/fix in its own commit under the repository's size limit; preserve unrelated working-tree changes.
