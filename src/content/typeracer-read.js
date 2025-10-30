/**
 * Reading typeracer.com's DOM: every selector in one table, and the readers
 * that turn a race page into something the rest of the code can use.
 *
 * **There is no MAIN-world half of this, and there should not be one.**
 * chess.com and LeetCode each need one because the board object and
 * `window.fetch` only exist in the page's own world. A typing test needs
 * neither: keystrokes are DOM events, which a capture-phase listener in the
 * isolated world sees in full, and the quote is plain text. So there is one
 * fewer `content_scripts` entry and one fewer bridge — please do not add one
 * back out of symmetry with the other two sites.
 *
 * TypeRacer is a GWT application. Its class names are generated and they move,
 * so this follows the same discipline as src/content/leet-read.js and the two
 * chess sites: several spellings per thing, newest first, and **never**
 * collapse a list to "the current one".
 *
 * Every reading is validated rather than trusted, which is the rule that makes
 * the loose spellings safe. A quote shorter than MIN_QUOTE is not a quote, an
 * input that is read-only is not the box you type in, and a WPM outside
 * [1, 400] did not come from a race. A field that does not parse is **null**,
 * never `0` — zero is a value, and a zero accuracy would go into the mean and
 * stay there.
 *
 * Nothing here writes to the page or to storage.
 */
(function (root) {
    'use strict';

    /**
     * Short of this many characters it is not a quote — it is a chat bubble, a
     * placeholder, or the word "Loading". Same idea as validating a chess move
     * list against algebraic notation before a word of it is spoken.
     */
    const MIN_QUOTE = 20;

    /** A race that reports a speed outside this did not happen. */
    const WPM_RANGE = Object.freeze([1, 400]);

    const SELECTORS = Object.freeze({
        /** The box you actually type into. */
        input: [
            'input.txtInput',
            'table.inputPanel input[type="text"]',
            '.inputPanel input',
            'input.gwt-TextBox',
            '.txtInput textarea',
        ],

        /** The panel holding the quote, typed part and untyped part together. */
        quote: [
            '.inputPanelText',
            'table.inputPanel .inputPanelText',
            '.raceQuote',
            '.quoteContainer',
        ],

        /**
         * How the site marks the part of the quote you have already typed.
         *
         * This is the only hook the custom caret has: where you are is the end
         * of what is marked. There is no fallback for it, and caretAnchor()
         * says why that is deliberate.
         */
        typed: [
            '.inputPanelText span.txtHighlight',
            '.inputPanelText .highlight',
            '.inputPanelText span[style*="background"]',
            '.raceQuote .typed',
        ],

        /** The scoreboard at the end. Read as a cross-check, never as the truth. */
        results: [
            'table.raceResults',
            '.raceResults',
            '.resultsTable',
            '.raceCompleteMsg',
        ],

        /**
         * Whatever names the quote. TypeRacer puts a link to the text's own
         * page beside a finished race; the id in it is the only stable name a
         * quote has, since the same words are re-used across races.
         */
        quoteLink: [
            'a[href*="quoteId="]',
            'a[href*="/text?id="]',
            'a[href*="textId="]',
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

    const clean = (text) => String(text == null ? '' : text).replace(/\s+/g, ' ').trim();

    /** On screen and taking up room. A hidden input is last race's, not this one. */
    function onScreen(element) {
        if (!element || !element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    /**
     * The quote as one string, or null when what was matched does not read as
     * one. Whitespace is collapsed because the panel wraps the text across
     * several nodes and the joins come back as newlines.
     */
    function quoteText(scope = document) {
        for (const node of findAll('quote', scope)) {
            const text = clean(node.textContent);
            if (text.length >= MIN_QUOTE) return text;
        }
        return null;
    }

    /**
     * The element to listen on, or null.
     *
     * Read-only is the check that matters: between races TypeRacer leaves the
     * box in the page and disables it, and a listener on a box nobody can type
     * in would report a race that never started.
     */
    function inputBox(scope = document) {
        for (const node of findAll('input', scope)) {
            const tag = (node.tagName || '').toLowerCase();
            if (tag !== 'input' && tag !== 'textarea') continue;
            if (node.readOnly || node.disabled) continue;
            if (!onScreen(node)) continue;
            return node;
        }
        return null;
    }

    /**
     * Whether `element` is the race box, answered without a layout read.
     *
     * The keystroke handler asks this, so it may not do what inputBox() does
     * — measuring the box is a forced layout. It only has to tell the race
     * box from TypeRacer's chat and the site's search field, and matching a
     * spelling of it is enough for that.
     */
    function isInput(element) {
        if (!element || element.nodeType !== 1) return false;
        const tag = element.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
        if (element.readOnly || element.disabled) return false;
        for (const selector of SELECTORS.input) {
            try { if (element.matches(selector)) return true; } catch (_) { /* a spelling this engine rejects */ }
        }
        return false;
    }

    /** A number, but only inside the bounds that make it a real reading. */
    function inRange(value, low, high) {
        const number = Number(value);
        return Number.isFinite(number) && number >= low && number <= high ? number : null;
    }

    /**
     * What the results panel says: `{ wpm, accuracy, place, of }`, each field
     * null unless it parses.
     *
     * Null rather than zero throughout. A renamed results table reports
     * nothing here, and nothing is a cross-check that did not happen — a zero
     * is a race typed at no speed at all, which would enter every mean the
     * dashboard draws and never leave.
     */
    function readResult(scope = document) {
        const panel = find('results', scope);
        if (!panel) return { wpm: null, accuracy: null, place: null, of: null };
        const text = clean(panel.textContent);

        const speed = /(\d+(?:\.\d+)?)\s*(?:wpm|words per minute)/i.exec(text);
        const accurate = /accuracy[^\d%]{0,12}(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%\s*accuracy/i.exec(text);
        const finish = /(\d+)(?:st|nd|rd|th)?\s*(?:place\s*)?(?:out\s*)?of\s*(\d+)/i.exec(text);

        return {
            wpm: speed ? inRange(speed[1], WPM_RANGE[0], WPM_RANGE[1]) : null,
            accuracy: accurate ? inRange(accurate[1] || accurate[2], 0, 100) : null,
            // A place of zero is not a place, so the lower bound is one; and a
            // field that parsed but does not fit is dropped whole rather than
            // reported half, or a race could be "3rd of 0".
            place: finish ? inRange(finish[1], 1, 999) : null,
            of: finish ? inRange(finish[2], 1, 999) : null,
        };
    }

    /** The quote's own id, when the page offers one, else ''. */
    function quoteId(scope = document) {
        for (const link of findAll('quoteLink', scope)) {
            const match = /(?:quoteId|textId|id)=(\d+)/.exec(link.getAttribute('href') || '');
            if (match) return match[1];
        }
        return '';
    }

    /**
     * The element holding the next character to type, found from the site's
     * own marking of what has already been typed.
     *
     * Returns null whenever the markup cannot be read, and the custom caret
     * then simply does not draw. There is deliberately no guess here — no
     * "assume the first span", no measuring characters ourselves. A caret
     * drawn in the wrong place over the word you are reading is worse than no
     * caret at all, and it is worse in a way the user cannot switch off
     * without finding the setting.
     */
    function caretAnchor(scope = document) {
        const panel = find('quote', scope);
        if (!panel) return null;

        const marked = new Set(findAll('typed', scope));
        if (!marked.size) {
            // Nothing is marked yet, which at the start of a race is correct:
            // the caret belongs on the first piece of the quote.
            const first = panel.firstElementChild;
            return first && onScreen(first) ? first : null;
        }

        for (const child of panel.children) {
            if (marked.has(child)) continue;
            return onScreen(child) ? child : null;
        }
        // Everything is marked: the quote is finished and there is nothing
        // left to point at.
        return null;
    }

    /**
     * The pit, a race, and the site's front door — which is the pit with no
     * path at all. Everything else on typeracer.com (the profile, the text
     * library, the forums) has no race on it and gets no listeners.
     */
    function isRacePage(pathname = location.pathname) {
        const path = String(pathname || '/');
        return path === '/' || /^\/(pit|race|play)(\/|$)/.test(path);
    }

    const TyperRead = {
        SELECTORS, MIN_QUOTE, WPM_RANGE, find, findAll,
        quoteText, inputBox, isInput, readResult, quoteId, caretAnchor, isRacePage, onScreen,
    };

    root.BB = root.BB || {};
    root.BB.TyperRead = TyperRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = TyperRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
