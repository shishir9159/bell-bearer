/**
 * Watching a CI run from its own page: a Watch button, and the reading that
 * tells the worker when the run is over. The forge is the adapter's business
 * (src/content/github-read.js and the two beside it); nothing here names one.
 *
 * By the time a watch matters the tab is in the background — that is the
 * point of one, and the difficulty. DomWatch coalesces onto animation frames
 * and a hidden tab runs none, so the reading keeps paths of its own:
 *   - its own MutationObserver, which a hidden tab still delivers to, read
 *     once a burst has settled;
 *   - a read whenever the tab comes back into view;
 *   - a slow timer, for the pages that stop updating themselves while out
 *     of sight — GitHub's pull request checks and GitLab's pipelines both
 *     do — whose adapter knows a request the page itself makes instead.
 *     Chrome lets a hidden tab's timer fire about once a minute, so that is
 *     its pace; asking for more would buy nothing.
 */
(function (root) {
    'use strict';

    const { ForgeSites, CiWatch, Icons } = root.BB;

    const BUTTON_ID = 'bb-ci-watch';
    const POLL_MS = 60 * 1000;
    /** A page redraws in bursts; the run is read once the burst is over. */
    const SETTLE_MS = 500;
    /** What a burst is made of: the icons' labels and classes change, not only the nodes. */
    const WATCHED_ATTRIBUTES = ['aria-label', 'class', 'data-testid', 'data-tooltip-content'];
    /**
     * How long a watch started on its own waits for checks to appear. One
     * on a pull request opened a moment ago starts before its checks do;
     * one on a repo that runs none would otherwise say Watching for ever.
     */
    const OWN_GRACE_MS = 10 * 60 * 1000;

    function createCiWatch({ adapter, watcher, notify, getSettings, ask, win = root, doc = root.document }) {
        const site = adapter.site;
        const forge = ForgeSites.get(site);

        /** What this tab shows, when it is a run or a pull request. */
        let page = null;
        /** The watch, while there is one: { key, noun, label, repo, known }. */
        let watching = null;
        let observer = null;
        let timer = 0;
        let settle = 0;
        /** Whether this watch has read any checks at all yet. */
        let seen = false;
        /** The page the worker has answered for: nothing starts on its own before it says this tab had no watch. */
        let resumed = null;
        /** Pull requests already watched on their own this visit, so a stop is not undone by the next redraw. */
        const offered = new Set();

        const enabled = () => getSettings()[ForgeSites.siteKey(site, 'ciWatch')] === true;
        const ownOn = () => enabled() && getSettings()[ForgeSites.siteKey(site, 'ciWatchOwn')] === true;

        function summary(from = doc) {
            try { return CiWatch.summarize(adapter.ci.read(from, page)); } catch (_) { return null; }
        }

        // ---------------------------------------------------------- reading

        function check(read = summary()) {
            if (!watching || !page || page.key !== watching.key) return;
            const ended = CiWatch.outcome(read, watching.known);
            if (ended) finish(read, ended);
        }

        function soon() {
            if (settle) return;
            settle = setTimeout(() => {
                settle = 0;
                check();
            }, SETTLE_MS);
        }

        /** The adapter's request when it has one; the page as it stands when that says nothing. */
        async function poll() {
            if (!watching) return;
            const fetched = adapter.ci.fetch ? CiWatch.summarize(await adapter.ci.fetch(page)) : null;
            const read = fetched || summary();
            if (read) seen = true;
            if (watching && watching.auto && !seen && Date.now() - watching.since > OWN_GRACE_MS) {
                stop();
                return;
            }
            check(read);
        }

        function onVisible() {
            if (doc.visibilityState === 'visible') check();
        }

        function observe() {
            if (observer || !doc.body) return;
            observer = new MutationObserver(soon);
            observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
            doc.addEventListener('visibilitychange', onVisible);
            timer = setInterval(poll, POLL_MS);
            poll();
        }

        function unobserve() {
            if (observer) observer.disconnect();
            observer = null;
            clearInterval(timer);
            clearTimeout(settle);
            timer = 0;
            settle = 0;
            doc.removeEventListener('visibilitychange', onVisible);
        }

        // --------------------------------------------------------- the watch

        /** `auto` is a watch nobody clicked for, which says nothing when there is nothing to watch. */
        async function start({ auto = false } = {}) {
            const key = page.key;
            // A merge box not drawn yet says nothing; asked, it may say the
            // checks passed long ago, which a watch would announce at once.
            const now = summary() || (auto && adapter.ci.fetch ? CiWatch.summarize(await adapter.ci.fetch(page)) : null);
            if (auto && (watching || !page || page.key !== key)) return;
            const already = now && CiWatch.finished(now.state) ? now.state : null;
            if (already) {
                if (!auto) notify(`${forge.nouns[page.kind]} already ${already === 'manual' ? 'stopped at a manual job' : already}`, 'info');
                return;
            }
            const watch = {
                key: page.key,
                noun: forge.nouns[page.kind],
                label: adapter.ci.label(doc, page),
                repo: page.repo,
                // Failures already on screen are what the user was looking
                // at; a watch is for the rest of the run.
                known: now ? now.failed : [],
            };
            if (auto) watch.auto = true;
            const answer = await ask({ action: 'ciWatchStart', watch });
            if (!answer || !answer.ok) {
                if (!auto) notify('Could not start watching — reload the page and try again', 'error');
                return;
            }
            watching = { ...watch, since: Date.now() };
            seen = !!now;
            observe();
            render();
            notify(auto ? 'Watching your pull request — a notification comes when its checks finish' : 'Watching — a notification comes when it finishes',
                auto ? 'info' : 'success');
        }

        async function stop() {
            const key = watching && watching.key;
            watching = null;
            unobserve();
            render();
            if (key) await ask({ action: 'ciWatchStop', key });
        }

        function finish(read, ended) {
            const watch = watching;
            watching = null;
            unobserve();
            render();
            const words = CiWatch.message(watch, read, ended);
            ask({ action: 'ciWatchDone', key: watch.key, ...words });
            // The desktop notification is for a tab out of sight; one on
            // screen says it here too, where the eyes already are.
            if (doc.visibilityState === 'visible') notify(words.title, ended === 'passed' ? 'success' : 'error', 6000);
        }

        /** A tab that was watching this run before it reloaded goes on watching it. */
        async function resume() {
            if (!page) return;
            const key = page.key;
            const watch = await ask({ action: 'ciWatchGet', key });
            if (!page || page.key !== key) return;
            resumed = key;
            if (watch && !watching) {
                // Picked up, it was this visit's: once it gives up waiting
                // for checks, the next redraw must not start it over.
                offered.add(key);
                watching = { known: [], ...watch };
                seen = false;
                observe();
                render();
            }
            watchOwn();
        }

        /**
         * The user's own open pull request is watched without the click,
         * once a visit, while its checks are still to finish — or still to
         * start, for one opened a moment ago.
         */
        function watchOwn() {
            if (watching || !page || page.kind !== 'pull' || resumed !== page.key || offered.has(page.key)) return;
            if (!ownOn() || !adapter.ci.mine || !doc.getElementById(BUTTON_ID)) return;
            const own = adapter.ci.mine(doc, page);
            // The header is not drawn yet; the next redraw asks again.
            if (own === null) return;
            offered.add(page.key);
            if (own) start({ auto: true });
        }

        // ---------------------------------------------------------- the button

        /**
         * A bell, then the word: inside the forge's own parts where its
         * adapter names them, which lay an icon out as the buttons beside it
         * have theirs, and plainly where it names none.
         */
        function render() {
            const button = doc.getElementById(BUTTON_ID);
            if (!button) return;
            const on = !!watching;
            const icon = on ? Icons.svg('bell-ringing-fill', { cls: 'bb-ci-watch-icon' }) : Icons.svg('bell-ringing', { cls: 'bb-ci-watch-icon' });
            const word = on ? 'Watching' : 'Watch';
            const parts = adapter.ci.parts;
            button.innerHTML = parts
                ? `<span class="${parts.content}"><span class="${parts.visual}">${icon}</span><span class="${parts.label}">${word}</span></span>`
                : `${icon}<span>${word}</span>`;
            button.classList.toggle('bb-ci-watching', on);
            button.setAttribute('aria-pressed', String(on));
            button.title = on
                ? 'Stop watching'
                : `Get a desktop notification when ${page && page.kind === 'pull' ? 'these checks finish' : 'this run finishes'}`;
        }

        /** Put in, kept in and taken out on the page's own redraws; never done, since the page redraws for good. */
        function place() {
            const placed = doc.getElementById(BUTTON_ID);
            if (!enabled() || !page) {
                if (placed) placed.remove();
                return false;
            }
            const slot = adapter.ci.slot(doc, page);
            if (!slot) return false;
            if (placed) {
                if (placed.parentElement !== slot) slot.prepend(placed);
                watchOwn();
                return false;
            }
            const button = doc.createElement('button');
            button.type = 'button';
            button.id = BUTTON_ID;
            button.className = `${adapter.ci.buttonClass || ''} bb-ci-watch`.trim();
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (watching) stop(); else start();
            });
            slot.prepend(button);
            render();
            watchOwn();
            return false;
        }

        // ------------------------------------------------------------ the page

        function onNavigate() {
            page = ForgeSites.pageOfUrl(win.location.href);
            // Off to another page, the watch waits in the worker for this tab
            // to come back to its run; this page just stops reading.
            if (watching && (!page || page.key !== watching.key)) {
                watching = null;
                unobserve();
            }
            const stale = doc.getElementById(BUTTON_ID);
            if (stale) stale.remove();
            resumed = null;
            watcher.add('ci-watch-button', place);
            resume();
        }

        function install() {
            onNavigate();
        }

        /** The switch was turned, on this page or another: show or take away the button now. */
        function refreshSurfaces() {
            watcher.add('ci-watch-button', place);
        }

        return { install, onNavigate, refreshSurfaces, check, poll, isWatching: () => !!watching };
    }

    const CiWatchContent = { BUTTON_ID, POLL_MS, SETTLE_MS, OWN_GRACE_MS, createCiWatch };

    root.BB.CiWatchContent = CiWatchContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = CiWatchContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
