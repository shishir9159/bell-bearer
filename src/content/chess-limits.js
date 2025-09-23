/**
 * The daily limit, as it appears on the page: once you have played your
 * allowance of a time control, the buttons that would start another one go
 * grey and stop working.
 *
 * What counts as "played" is not decided here — src/background/chess-limits.js
 * reads it from the site's own API so that games on a phone count too, and
 * src/shared/chess-limits.js holds the tally. This file only paints it.
 *
 * Finding the buttons is the awkward half. Both sites rename their classes
 * often and neither marks a button with the time control it starts, so the
 * rule is text first: a control is a candidate if it sits in one of the few
 * places a game is started from, and it is matched to a bucket by what it
 * says — "New 10 min game", "3+2", "Rapid". A button that says nothing about
 * a control ("Rematch", a bare "New game") is matched to the game on the
 * board, and failing that is blocked only when every limited control is spent,
 * which is the one case where whatever it starts would be blocked anyway.
 *
 * Blocked controls keep their pointer events rather than being disabled
 * outright: a click that is swallowed can say why it was swallowed, and a
 * button that has quietly stopped responding cannot.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ChessSites = ns.ChessSites || req('../shared/chess-sites.js');
    const ChessLimits = ns.ChessLimits || req('../shared/chess-limits.js');

    const BLOCKED = 'bb-limit-blocked';
    /** How long the page is watched after a change before candidates are re-read. */
    const SETTLE_MS = 300;

    /**
     * Where a game can be started from, per site. Kept deliberately loose:
     * a selector that matches too much is cheap, because a candidate is only
     * blocked once its text has placed it in a limited control.
     */
    const STARTERS = {
        chess: [
            '.game-over-modal-content button',
            '.game-over-buttons-component button',
            '[data-cy="side-rematch-button"]',
            '.play-quick-links-component a',
            '.new-game-buttons-component button',
            '.new-game-index-component button',
            'a[href*="/play/online"]',
            'a[href*="/play/computer"]',
            'button, a[href]',
        ],
        lichess: [
            '.rematch button',
            '.follow-up a',
            '.lobby__start .button',
            '.lobby__app__content .button',
            '.game__meta .button',
            'a[href*="/?hook"]',
            'button, a[href]',
        ],
    };

    /** Text that means "start another game" whatever else is on the button. */
    const STARTS_A_GAME = /\b(rematch|new game|play again|start game|create a game|new \d+|play \d+|quick pairing|challenge)\b/i;

    /**
     * Text that names a control and nothing else — the pool tiles on both
     * lobbies ("3 | 2", "10 min", "Bullet"). They start a game by themselves,
     * so they count even though they say nothing about starting one.
     */
    function namesAControl(site, text) {
        return ChessSites.classFromLabel(site, text) != null && text.length <= 40;
    }

    /** A candidate's own words, without the whole page hanging off it. */
    function labelOf(element) {
        const own = (element.textContent || '').replace(/\s+/g, ' ').trim();
        if (own) return own.slice(0, 80);
        return (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().slice(0, 80);
    }

    /**
     * Every control on the page that would start a game, with the bucket each
     * one starts — null where its text does not say.
     */
    function findStarters(doc, site) {
        const seen = new Set();
        const out = [];
        for (const selector of STARTERS[site] || []) {
            for (const element of doc.querySelectorAll(selector)) {
                if (seen.has(element)) continue;
                seen.add(element);
                const label = labelOf(element);
                if (!label) continue;
                if (!STARTS_A_GAME.test(label) && !namesAControl(site, label)) continue;
                out.push({ element, label, timeClass: ChessSites.classFromLabel(site, label) });
            }
        }
        return out;
    }

    function block(element, reason) {
        if (element.classList.contains(BLOCKED)) {
            element.dataset.bbLimitReason = reason;
            return;
        }
        element.classList.add(BLOCKED);
        element.dataset.bbLimitReason = reason;
        element.setAttribute('aria-disabled', 'true');
    }

    function unblock(element) {
        if (!element.classList.contains(BLOCKED)) return;
        element.classList.remove(BLOCKED);
        element.removeAttribute('aria-disabled');
        delete element.dataset.bbLimitReason;
    }

    function createChessLimits({ site, notify, getSettings, getStatus, getCurrentClass }) {
        let settle = null;
        let observer = null;
        let blocked = new Set();

        function reason(name, status) {
            const row = status.classes[name];
            const games = row.allowed === 1 ? '1 game' : `${row.allowed} games`;
            return `${ChessSites.get(site).name} ${name} is done for today — ${games}. ` +
                'Open Bell Bearer to allow one more.';
        }

        /**
         * The bucket a candidate would start. Its own text first; then the
         * game on the board, which is what a bare "Rematch" repeats.
         */
        function resolve(candidate) {
            if (candidate.timeClass) return candidate.timeClass;
            return getCurrentClass ? getCurrentClass() : null;
        }

        function apply() {
            const status = getStatus();
            const next = new Set();

            // Nothing is blocked: skip the sweep entirely rather than walk
            // every button on the page to conclude the same thing.
            if (status && status.anyBlocked) {
                // Every limited control spent: even a button that names no
                // control can only start something that is already blocked.
                const allSpent = ChessSites.CLASSES
                    .filter((name) => status.classes[name].limit != null)
                    .every((name) => status.classes[name].blocked);

                for (const candidate of findStarters(document, site)) {
                    const name = resolve(candidate);
                    const hit = name ? status.classes[name] && status.classes[name].blocked : allSpent;
                    if (!hit) continue;
                    block(candidate.element, reason(name || status.blocked[0], status));
                    next.add(candidate.element);
                }
            }

            for (const element of blocked) {
                if (!next.has(element)) unblock(element);
            }
            blocked = next;
        }

        /**
         * A running clock rewrites its own text twice a second, and on a
         * board with two of them that is a mutation record every few hundred
         * milliseconds for the whole game — none of which can have added a
         * button. Only records that moved an element are worth a sweep.
         */
        function movedAnElement(records) {
            return records.some((record) => (
                Array.prototype.some.call(record.addedNodes, (node) => node.nodeType === 1) ||
                Array.prototype.some.call(record.removedNodes, (node) => node.nodeType === 1)
            ));
        }

        /** Coalesce the storm of mutations a modal opening makes into one pass. */
        function schedule(records) {
            if (records && !movedAnElement(records)) return;
            if (settle) clearTimeout(settle);
            settle = setTimeout(() => { settle = null; apply(); }, SETTLE_MS);
        }

        /**
         * Swallow the click before the site sees it. Capture phase on the
         * document, so it does not matter what the site binds where.
         */
        function onClick(event) {
            const hit = event.target.closest && event.target.closest(`.${BLOCKED}`);
            if (!hit) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            notify(hit.dataset.bbLimitReason || 'Daily limit reached', 'warning');
        }

        function onKey(event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            onClick(event);
        }

        // The click guard is bound once for the life of the page, not with the
        // observer: turning the limits off and on again would otherwise stack
        // a second copy on every round trip, and each one would notify.
        let guarding = false;

        function install() {
            if (!guarding) {
                guarding = true;
                document.addEventListener('click', onClick, true);
                document.addEventListener('keydown', onKey, true);
            }
            observer = new MutationObserver(schedule);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            apply();
        }

        function stop() {
            if (observer) observer.disconnect();
            observer = null;
            if (settle) clearTimeout(settle);
            settle = null;
            blocked.forEach(unblock);
            blocked = new Set();
        }

        /** Settings or the tally changed: repaint now rather than on the next mutation. */
        function sync() {
            const on = ChessSites.anyLimitOn(getSettings(), site);
            if (on && !observer) install();
            else if (!on && observer) stop();
            else if (on) apply();
        }

        return { install: sync, sync, stop, apply, findStarters: () => findStarters(document, site) };
    }

    const ChessLimitsContent = {
        createChessLimits, findStarters, labelOf, namesAControl,
        STARTS_A_GAME, STARTERS, BLOCKED,
    };

    root.BB = root.BB || {};
    root.BB.ChessLimitsContent = ChessLimitsContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChessLimitsContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
