# Bell Bearer fixes

Audited 2026-10-23 against d6355dc (v1.0). Findings below are a backlog, not completed fixes. **Reproduced** means demonstrated locally; other findings are **code-reviewed**.

## Baseline

- Node: **1,072/1,072 passed**.
- Browser: **470/472 passed** at 344 × 550. Dock rendered a 0×0 player; dragging expected 120 pixels but had only 17 available. The drag test also needs viewport-aware expectations.
- Both browser packages built. Installed-extension and live-site behavior remain unverified.

## P1 — data integrity and core behavior

- [ ] **F01 — Concurrent writes are lost (reproduced).** [Store](src/shared/store.js) serializes only within one context. Centralize mutations, including direct storage writers. **Check:** simultaneous changes from separate tabs survive together after reload.

- [ ] **F02 — Prompts can submit twice.** [Chat runner](src/content/chat-runner.js) checks ownership before an unconditional claim and ignores write failure. Claim atomically; verify persistence, route, and pause state before sending. **Check:** two tabs submit once; failed claims submit nothing.

- [ ] **F03 — Invalid backups pass validation (reproduced).** [Backup](src/shared/backup.js) accepted version 999 and a string instead of the sitesOff list. Validate versions and all value shapes before writing. **Check:** malformed imports leave storage untouched; supported older formats migrate.

- [ ] **F04 — Imported prompts can run automatically.** [Backup](src/shared/backup.js) preserves queue execution states and leases. Drop leases and hold restored prompts until explicitly resumed. **Check:** importing with a matching chat open submits nothing.

- [ ] **F05 — Failed saves appear successful.** [Store](src/shared/store.js) swallows write errors; checkpoint/template callers still announce success. Return explicit mutation results and retain unsaved input. **Check:** storage errors produce no false success; retry saves once.

- [ ] **F06 — Short visits escape time limits (reproduced).** [Time limits](src/content/time-limit.js) clear the focus marker before banking elapsed time; ten seconds before blur credited zero. Bank first and serialize transitions. **Check:** short visits accumulate without duplicate credits; midnight splits correctly.

- [ ] **F07 — Overdue prompts are missed after restart (logic reproduced).** [Queue scheduling](src/shared/prompt-queue.js) considers future wake times only; startup does not reconcile overdue work. Process due items while respecting stale/paused/disabled states. **Check:** eligible work runs once even without its old alarm.

- [ ] **F08 — Activity resumes while the browser is unfocused.** [Heartbeat](src/background/activity-heartbeat.js) samples the last-focused window after clearing focus. Verify actual focus on every alarm. **Check:** another app receives no browsing time, including across worker restart.

## P2 — reliability and usability

- [ ] **F09 — Longest-page statistics are wrong (reproduced).** [Activity](src/shared/activity.js) accumulates only the existing winner: A at 60 seconds beat B at 90. Track the current visit separately. **Check:** B wins; distinct pages with identical titles remain separate.

- [ ] **F10 — Activity crosses hour/day boundaries incorrectly.** [Activity](src/shared/activity.js) assigns the whole interval to its starting bucket. Split at local boundaries and serialize tick/blur/clear. **Check:** 23:59:50–00:00:20 contributes 10 seconds before midnight and 20 after.

- [ ] **F11 — Narrow reader layouts collapse (reproduced).** [Reader geometry](src/content/reader-layout.js) reserves more width than available. Add stacked/collapsible layouts and clamp bounds. **Check:** all layouts and dragging work at 320–1440 pixels, short heights, and zoom.

- [ ] **F12 — Import merges despite promising replacement (reproduced).** [Import UI](src/page/backup-buttons.js) promises replacement while absent keys survive. Define merge/replace behavior, coordinate writers, retain recovery data, and catch failures. **Check:** populated-profile restores match the chosen mode and recover safely from errors.

- [ ] **F13 — Firefox minimum is too low.** [Manifest](manifest.firefox.json) declares 115, but MAIN-world bridges require 128 ([Mozilla](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/), [compatibility data](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/scripting.json)). Raise the minimum or provide a tested fallback. **Check:** packed installs work at declared browser minimums.

- [ ] **F14 — Download body failures bypass retries (reproduced).** [Fetch pool](src/shared/fetch-pool.js) made one attempt instead of three after a body-read error. Cover body reads, timeouts, cancellation, and folder byte limits. **Check:** interrupted/stalled transfers recover or stop without unbounded memory use.

- [ ] **F15 — Old CI responses affect newer watches.** [CI watcher](src/content/ci-watch.js) does not verify watch identity after awaiting requests. Discard stale completions and prevent overlapping polls. **Check:** delayed run-A results cannot finish run B; Stop and fetch failure remain safe.

- [ ] **F16 — Party startup errors leak resources.** [Party worker](src/background/party.js) cleans up failed responses but not rejected startup calls. Guard every stage and coordinate Start/Leave operations. **Check:** failures leave no document, binding, timer, or connection; old cleanup preserves newer parties.

- [ ] **F17 — Inbound party messages lack validation.** [Transport](src/offscreen/party-ws.js) lacks inbound size/schema checks; [session](src/offscreen/party-session.js) assumes nested fields exist. Validate before changing state. **Check:** malformed/oversized messages fail without uncaught errors or indefinitely pending joins.

- [ ] **F18 — Settings ignore maximums and late teardown.** [Settings form](src/page/settings-form.js) clamps only minimums (reproduced); delayed reads can attach listeners after disposal. Enforce bounds and ignore stale reads. **Check:** typed values respect limits; disposed forms stay detached.

- [ ] **F19 — Dialog focus is unmanaged.** [UI helpers](src/page/ui.js) lack accessible names, focus containment/restoration, and background isolation. Add these behaviors. **Check:** keyboard and screen-reader users can complete or cancel dialogs without activating background content.

- [ ] **F20 — Development server containment is weak.** [Server](tests/serve.js) accepts same-prefix sibling paths (predicate reproduced), leaves decoding errors uncaught, and binds beyond loopback. Restrict paths/interfaces and deny private metadata. **Check:** traversal and malformed URLs expose nothing and cannot crash it. Not shipped.

- [ ] **F21 — Sowon failures count as delivery.** [Sowon](src/background/sowon.js) treats HTTP error responses as success and suppresses repeats. Check HTTP/service status; add bounded retries/timeouts. **Check:** failed reports retry; successful duplicates remain suppressed.

- [ ] **F22 — Limit-sheet rendering races dismissal.** [Time limits](src/content/time-limit.js) dereference a sheet after awaiting appearance, although dismissal can clear it. Verify element identity/state before appending. **Check:** snooze/removal during loading causes no exception or stale overlay.

- [ ] **F23 — CI misses browser and entry failures.** [CI](.github/workflows/ci.yml) runs Node only on master pushes; [entry tests](tests/entries.test.js) omit GitHub/GitLab/Codeberg/Vimeo and silently skip under file URLs. Add PR/browser/package checks and full entry coverage. **Check:** failures block PRs; installed tests cover suspension, reload, and registration failures.

## P3 — documentation

- [ ] **F24 — Feature and permission guidance is incomplete.** Expand [README](README.md) and manifest descriptions with installation, browser support, defaults, shortcuts, retention, recovery, and network behavior. Explain permissions and TURN credentials in backups. **Check:** guidance matches tested packages; placeholder links do not imply publication.

## Remaining verification

Test current production layouts/APIs across every supported site: media/captions/downloads; X/Reddit navigation and rosters; chess flips/focus/voice; LeetCode/TypeRacer input; chat streaming/branches/queues; forge checks; Netflix playback; Wikipedia/article extraction. Test parties across browsers/networks and all surfaces with keyboard, zoom, skins, reload, and worker suspension.

README feature requests remain separate. Board-flip/voice and Art Deco readability reports still need reproduction. One supplemental probe was blocked by automatic approval review without a stated reason; those findings remain code-reviewed.

## Delivery

Fix F01/F02/F05 first, then imports/time accounting, then remaining reliability/accessibility issues. Add targeted regressions; run Node and visible browser suites. Preserve classic scripts, manual load order, party injection rules, and dependency-free runtime. Before release, test both packed extensions installed at narrow/wide sizes and supported browser minimums. Commit fixes separately within the repository's size limit.
