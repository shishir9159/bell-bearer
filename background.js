/**
 * Service-worker entry point.
 *
 * The worker is a classic script, so the parts are pulled in with
 * importScripts() and share one global scope. Firefox lists the same files
 * directly under `background.scripts` in manifest.firefox.json, and the test
 * page loads them as <script> tags — so each part must stand alone as a classic
 * script, and anything the tests assert on is put on globalThis explicitly.
 *
 * Keep this list in step with manifest.firefox.json and tests/index.html.
 */
importScripts(
    'src/shared/time.js',
    'src/shared/settings.js',
    'src/shared/store.js',
    'src/shared/hosts.js',
    'src/shared/ids.js',
    'src/shared/chat-sites.js',
    'src/shared/prompt-queue.js',
    'src/shared/activity.js',
    'src/shared/chess-sites.js',
    'src/shared/chess.js',
    'src/shared/lichess.js',
    'src/shared/chess-limits.js',
    'src/shared/trials.js',
    'src/shared/skim.js',
    'src/background/router.js',
    'src/background/proto.js',
    'src/background/sowon.js',
    'src/background/context-menus.js',
    'src/background/commands.js',
    'src/background/activity-heartbeat.js',
    'src/background/chess-limits.js',
    'src/background/trials.js',
    'src/background/skim.js',
    'src/background/prompt-queue.js',
    'src/background/ci-watch.js',
    'src/background/downloads.js',
    'src/background/party-loader.js',
    'src/background/party.js',
);
