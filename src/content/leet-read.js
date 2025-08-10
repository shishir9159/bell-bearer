/**
 * Reading leetcode.com's DOM: every selector in one table, and the readers
 * that turn a problem page into a record.
 *
 * Same rules as src/content/twitter-page.js and the two chess sites, for the
 * same reason — LeetCode ships a Tailwind build whose class names are
 * generated, renames them on its own schedule, and runs more than one layout
 * at a time. So: several spellings per thing, newest first, and **never**
 * collapse a list to "the current one". What is comparatively stable is
 * LeetCode's own hooks (`data-cy`, `data-e2e-locator`) and its semantic
 * hrefs (`/problems/`, `/tag/`), which is why most of what follows is one of
 * those rather than a class.
 *
 * Two things here are validated rather than trusted, the way the chess move
 * lists are checked against algebraic notation before a word of one is
 * spoken: a difficulty that is not one of LeetCode's own three is dropped,
 * and a timer reading that does not parse as a clock is passed over. A
 * selector that starts matching the wrong element then reports nothing,
 * which is recoverable; reporting nonsense is not.
 *
 * Nothing here writes to the page or to storage. It answers questions about
 * what is on screen, so leet-ui.js can stay about buttons and panels.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Leet = ns.Leet || req('../shared/leetcode.js');

    const SELECTORS = Object.freeze({
        /** The problem's title, on the description pane. */
        title: [
            'a[href^="/problems/"].text-title-large',
            '.text-title-large a[href^="/problems/"]',
            'div[data-cy="question-title"]',
            '[data-track-load="description_content"] a[href^="/problems/"]',
        ],

        /**
         * The Easy / Medium / Hard pill. LeetCode colours it by class rather
         * than naming it, so the class is the hook — but the word inside is
         * what is actually read, and it is checked against the three.
         */
        difficulty: [
            'div[class*="text-difficulty-"]',
            'span[class*="text-difficulty-"]',
            '[data-degree]',
            'div[diff]',
        ],

        /** Topic tags, which are plain links to the tag pages. */
        tags: [
            'a[href^="/tag/"]',
            'a[href^="/problemset/"][class*="tag"]',
        ],

        /**
         * LeetCode's own stopwatch. We read this rather than drawing a
         * count-up of our own, so the number on the page and the number
         * recorded against the attempt are the same number.
         *
         * It is not a <button>: it is a plain div carrying `role="button"`,
         * and the only thing naming it is an aria-label that *changes with
         * its state* — "Start" before it runs, "Pause" while it does. So the
         * state labels are all listed, and which of them may be clicked is
         * decided in startableTimer() rather than here. The earlier spellings
         * are kept below them: LeetCode has shipped a real button with a
         * `data-e2e-locator` before and may again.
         */
        timer: [
            '[role="button"][aria-label="Start"]',
            '[role="button"][aria-label="Resume"]',
            '[role="button"][aria-label="Pause"]',
            '[role="button"][aria-label*="timer" i]',
            'button[data-e2e-locator="console-timer"]',
            'button[aria-label*="timer" i]',
            'button[title*="timer" i]',
            'div[class*="timer"] button',
        ],

        /**
         * The last resort, when every spelling above has stopped matching:
         * anything clickable at all. Meaningless on its own — which is why
         * nothing here is believed until its text has been read as a clock.
         * See timerControl.
         */
        clickable: ['[role="button"]', 'button'],

        /** The top navigation bar, where the Pouch row goes. */
        nav: [
            'nav#leetcode-navbar',
            '#leetcode-navbar',
            'nav[class*="navbar"]',
            'header nav',
            'nav',
        ],

        /** The Premium / Register cluster at the right of that bar. */
        navEnd: [
            '#leetcode-navbar a[href*="/subscribe"]',
            'nav a[href*="/subscribe"]',
            'nav [class*="navbar-right"]',
        ],

        /** Similar-questions and hint blocks, which mock mode takes away. */
        similar: [
            '[data-track-load="similar_question"]',
            'div[class*="similar-question"]',
        ],

        hints: [
            '[data-track-load="hints"]',
            'div[class*="hint"] > button',
        ],

        /** The Solutions and Editorial tabs, likewise. */
        solutionsTab: [
            'div[id*="solutions_tab"]',
            'div[id*="editorial_tab"]',
            'a[href$="/solutions/"]',
            'a[href$="/editorial/"]',
        ],

        /** The editor itself, which the template hotkey aims at. */
        editor: [
            '.monaco-editor',
            'div[data-mode-id]',
            'div[class*="editor"] textarea',
        ],
    });

    /** The first element matching any spelling, in order. */
    function find(names, scope = document) {
        for (const selector of SELECTORS[names] || []) {
            let found = null;
            try { found = scope.querySelector(selector); } catch (_) { continue; }
            if (found) return found;
        }
        return null;
    }

    /** Every element matching any spelling — the first spelling that hits wins. */
    function findAll(names, scope = document) {
        for (const selector of SELECTORS[names] || []) {
            let found = null;
            try { found = scope.querySelectorAll(selector); } catch (_) { continue; }
            if (found && found.length) return Array.from(found);
        }
        return [];
    }

    /**
     * The problem slug from a path, or null anywhere else on the site.
     *
     * Deliberately tolerant of what comes after it: LeetCode appends
     * /description/, /solutions/, /submissions/ and a query string of its own,
     * and all of those are the same problem.
     */
    function slugOf(pathname = location.pathname) {
        const match = /^\/problems\/([A-Za-z0-9-]+)(?:[/?#]|$)/.exec(String(pathname || ''));
        return match ? match[1] : null;
    }

    /** Are we on a problem page at all? */
    const onProblem = (pathname = location.pathname) => !!slugOf(pathname);

    const clean = (text) => String(text == null ? '' : text).replace(/\s+/g, ' ').trim();

    /**
     * The title, with the number LeetCode prefixes it with taken off.
     *
     * "1. Two Sum" is how the page writes it and "Two Sum" is the problem's
     * name; the number is already in the slug and repeating it down a rail of
     * twenty rows is twenty numbers nobody reads.
     */
    function readTitle() {
        const node = find('title');
        return clean(node && node.textContent).replace(/^\d+\.\s*/, '');
    }

    /**
     * Easy, Medium or Hard, or '' when the page has not said yet.
     *
     * The class name is only how the element is found; the word inside it is
     * what is believed, and it is matched against LeetCode's own three rather
     * than passed through. A build that renames the pill onto something else
     * reports nothing here instead of filing every problem under whatever
     * text happened to be in the first div that matched.
     */
    function readDifficulty() {
        for (const node of findAll('difficulty')) {
            const word = clean(node.textContent);
            if (Leet.DIFFICULTIES.includes(word)) return word;
        }
        return '';
    }

    /** The topic tags, deduped and capped — a problem has three or four. */
    function readTags() {
        const seen = new Set();
        for (const node of findAll('tags')) {
            const tag = clean(node.textContent);
            // A tag link with no word in it is LeetCode's "+ 3 more" affordance.
            if (tag && !/^\+/.test(tag)) seen.add(tag);
        }
        return Array.from(seen).slice(0, 12);
    }

    /**
     * What the page is showing, in the shape Leet.see wants. Null off a
     * problem page, which is most of leetcode.com.
     */
    function readProblem() {
        const slug = slugOf();
        if (!slug) return null;
        return {
            slug,
            title: readTitle(),
            difficulty: readDifficulty(),
            tags: readTags(),
            url: `https://leetcode.com/problems/${slug}/`,
        };
    }

    /**
     * Seconds from a clock reading. Lifted from src/content/chess.js, which
     * reads the same two shapes off a chess clock: mm:ss, and h:mm:ss once a
     * problem has been sat with for an hour.
     */
    function parseClock(text) {
        const match = /(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?/.exec(String(text || ''));
        if (!match) return null;
        const [, a, b, c, fraction] = match;
        const whole = c != null ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
        return whole + (fraction ? Number(`0.${fraction}`) : 0);
    }

    /**
     * A clock and nothing else: "12:30", "1:02:05". Anchored on purpose — a
     * paragraph that merely contains a time is not the stopwatch, and this is
     * the test that lets the generic fallback below be safe at all. Same
     * discipline as validating a chess move list against algebraic notation
     * before believing a selector's matches.
     */
    const CLOCK_ONLY = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/;

    const readsAsClock = (node) => !!node && CLOCK_ONLY.test(node.textContent || '');

    /**
     * LeetCode's stopwatch, whatever state it is in — the element that
     * carries the digits.
     *
     * Every spelling is tried and each match is checked against the clock
     * pattern before it is believed. That check is what stops this picking up
     * some other control the day LeetCode renames things: a selector whose
     * matches do not read as a clock is passed over, and the last resort
     * ("anything clickable") is only usable *because* of it.
     */
    function timerControl() {
        for (const node of findAll('timer')) {
            if (readsAsClock(node)) return node;
        }
        for (const node of findAll('clickable')) {
            if (readsAsClock(node)) return node;
        }
        return null;
    }

    /**
     * The control, but only when pressing it would *start* the clock.
     *
     * This is the difference between helping and interfering. The same
     * element is the start button and the pause button, distinguished only by
     * its label — so a version of this that returned the control whenever it
     * found one would pause the stopwatch of anyone who already had it
     * running, every time they opened a problem. Anything we cannot read as
     * startable is left alone; the worst case is that the clock does not
     * start itself, which the elapsed-time fallback already covers.
     */
    function timerButton() {
        const control = timerControl();
        if (!control) return null;
        const label = (control.getAttribute('aria-label') || '').trim().toLowerCase();
        if (label === 'pause' || label === 'stop') return null;
        // A zeroed clock has not been started, whatever it calls itself.
        if (label === 'start' || label === 'resume') return control;
        return parseClock(control.textContent) === 0 ? control : null;
    }

    /**
     * What the stopwatch currently reads, in seconds, or null.
     *
     * Null rather than zero when nothing can be read: a zero is a timer that
     * has just been reset, and the two must stay distinguishable or the
     * fallback clock never takes over.
     */
    function timerSeconds() {
        const control = timerControl();
        return control ? parseClock(control.textContent) : null;
    }

    /** Where the Pouch row goes, and what it sits at the end of. */
    const navSlot = () => find('nav');

    /** The title cluster, where the note pill goes beside the name. */
    function titleSlot() {
        const node = find('title');
        return node ? (node.parentElement || node) : null;
    }

    /**
     * Everything mock-interview mode takes off the page: what the problem is
     * rated, what it is about, what it is like, the hints, and the way
     * through to somebody else's answer.
     *
     * Returned as elements rather than hidden here — leet-ui.js owns what is
     * done with them, and content.css owns how, so that leaving mock mode can
     * put every one of them back.
     */
    function hideTargets() {
        const found = [
            ...findAll('difficulty'),
            ...findAll('tags'),
            ...findAll('similar'),
            ...findAll('hints'),
            ...findAll('solutionsTab'),
        ];
        return found.filter(Boolean);
    }

    const LeetRead = {
        SELECTORS, find, findAll,
        slugOf, onProblem, readProblem, readTitle, readDifficulty, readTags,
        parseClock, readsAsClock, timerControl, timerButton, timerSeconds,
        navSlot, titleSlot, hideTargets,
    };

    root.BB = root.BB || {};
    root.BB.LeetRead = LeetRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = LeetRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
