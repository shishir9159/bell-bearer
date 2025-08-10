/**
 * leetcode.com, from inside the page's own JavaScript world.
 *
 * Two things live here, and both for the reason src/content/chess-page.js
 * exists: what we need is in the page's own JavaScript, which a content
 * script's isolated world cannot see. The manifest loads this file with
 * `"world": "MAIN"` on leetcode.com only; it has no access to chrome.* and
 * talks to src/content/leet-ui.js entirely over DOM events.
 *
 *   verdicts  Whether a submission passed, read off LeetCode's own network
 *             traffic rather than off the page. The result banner is a div
 *             whose classes change every few weeks and which is gone again a
 *             moment later; the request that produced it is stable, named,
 *             and cannot be missed by looking a second too late.
 *
 *   editor    Monaco lives on `window.monaco`, so inserting a template at the
 *             cursor and reading the current selection both have to happen
 *             here.
 *
 * Why the submission ids are tracked rather than the URL simply matched:
 * **Run is not Submit**. Both end up polling the same
 * /submissions/detail/<id>/check/ endpoint with the same response shape, so a
 * rule written against that URL alone would record every press of "Run" as an
 * attempt — and Run is where you find out your code does not compile, which
 * is precisely what should not count against you. The two are only
 * distinguishable at the moment the job is created: /submit/ mints an id we
 * keep, /interpret_solution/ mints one we throw away.
 */
(function () {
    'use strict';

    if (window.__bbLeetPage) return;
    window.__bbLeetPage = true;

    const REQUEST = 'bb:leet';
    const VERDICT = 'bb:leet:verdict';
    const CODE = 'bb:leet:code';

    /**
     * Submission ids minted by /submit/, and so worth reporting on.
     *
     * Capped, and oldest-first eviction, because a page left open all day
     * submitting every few minutes would otherwise grow this without bound.
     * Fifty is far more than the number of submissions that can be in flight
     * at once — in practice it is one.
     */
    const submissions = new Set();
    const SUBMISSION_CAP = 50;

    function remember(id) {
        const key = String(id);
        if (!key || key === 'undefined') return;
        submissions.add(key);
        while (submissions.size > SUBMISSION_CAP) {
            submissions.delete(submissions.values().next().value);
        }
    }

    /**
     * The slug out of a LeetCode URL or path, whatever shape it arrived in —
     * with or without the trailing slash, and with /description/,
     * /submissions/ or a query string after it.
     */
    function slugOf(url) {
        const match = /\/problems\/([A-Za-z0-9-]+)(?:[/?#]|$)/.exec(String(url || ''));
        return match ? match[1] : null;
    }

    function send(name, detail) {
        try {
            document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
        } catch (_) { /* the page is going away */ }
    }

    /**
     * Read one of LeetCode's JSON responses without consuming it.
     *
     * `clone()` is the whole point: the page's own code is waiting on this
     * body, and reading the original would leave LeetCode's editor hanging on
     * a stream somebody else had already drained. A clone that fails to parse
     * is not an error worth reporting — plenty of these responses are not
     * JSON at all.
     */
    async function peek(response) {
        try {
            return await response.clone().json();
        } catch (_) {
            return null;
        }
    }

    async function onSubmitted(response) {
        const body = await peek(response);
        if (body && body.submission_id !== undefined) remember(body.submission_id);
    }

    /**
     * A poll of a submission's status. LeetCode polls this every few hundred
     * milliseconds while the job is queued; only the final one says SUCCESS,
     * and only that one is worth a verdict.
     */
    async function onChecked(url, response) {
        const id = (/\/submissions\/detail\/([^/]+)\/check/.exec(url) || [])[1];
        if (!id || !submissions.has(String(id))) return;

        const body = await peek(response);
        if (!body || body.state !== 'SUCCESS') return;

        // One verdict per submission. The page keeps polling for a beat after
        // the answer lands, and without this every one of those is an attempt.
        submissions.delete(String(id));

        send(VERDICT, {
            // The address bar, falling back to the polled URL. The former is
            // right even when LeetCode has pushed /submissions/ onto the path,
            // because the slug stays in front of it.
            slug: slugOf(location.pathname) || slugOf(url),
            status: String(body.status_msg || ''),
            runtime: String(body.status_runtime || ''),
            memory: String(body.status_memory || ''),
            passed: Number(body.total_correct) || 0,
            total: Number(body.total_testcases) || 0,
            lang: String(body.pretty_lang || body.lang || ''),
        });
    }

    /**
     * Watch LeetCode's own fetches.
     *
     * The wrapper never changes what the page gets back and never rejects on
     * our account: everything we do is off a clone, inside a try, after the
     * real promise has settled. A page whose submissions stopped working
     * because the extension was watching them would be a far worse bug than
     * a missed verdict.
     */
    const realFetch = window.fetch;
    window.fetch = function (...args) {
        const promise = realFetch.apply(this, args);
        try {
            const input = args[0];
            const url = String((input && input.url) || input || '');
            if (/\/problems\/[^/]+\/submit\/?($|\?)/.test(url)) {
                promise.then((response) => onSubmitted(response)).catch(() => {});
            } else if (/\/submissions\/detail\/[^/]+\/check/.test(url)) {
                promise.then((response) => onChecked(url, response)).catch(() => {});
            }
            // /interpret_solution/ is deliberately not here: that is Run, and
            // the id it mints is the one we want nothing to do with.
        } catch (_) { /* never let watching break submitting */ }
        return promise;
    };

    // ------------------------------------------------------------- monaco

    /**
     * The editor Monaco is showing.
     *
     * Which call hands it back has changed more than once, so several are
     * tried and the first that yields an editor wins — the same shape as
     * sansFrom() in chess-page.js, and for the same reason.
     */
    function editor() {
        const ways = [
            () => window.monaco.editor.getEditors()[0],
            () => window.monaco.editor.getModels().length && window.monaco.editor.getEditors()[0],
            () => window.monaco.editor.getDiffEditors()[0].getModifiedEditor(),
        ];
        for (const way of ways) {
            let found;
            try { found = way(); } catch (_) { continue; }
            if (found && found.getModel) return found;
        }
        return null;
    }

    /** The language id Monaco has the model in — 'python', 'cpp', and so on. */
    function languageOf(instance) {
        try {
            return String(instance.getModel().getLanguageId() || '');
        } catch (_) {
            return '';
        }
    }

    /**
     * Put `text` in at the cursor, replacing the selection if there is one.
     *
     * executeEdits rather than setValue, so the insert is one undoable step
     * and the rest of the buffer is untouched — setValue would throw away the
     * user's whole solution to add four lines to it.
     */
    function insert(text) {
        const instance = editor();
        if (!instance) return false;
        try {
            const selection = instance.getSelection();
            instance.executeEdits('bell-bearer', [{ range: selection, text: String(text), forceMoveMarkers: true }]);
            instance.focus();
            return true;
        } catch (_) {
            return false;
        }
    }

    /** What is selected, what the whole buffer is, and which language. */
    function readCode() {
        const instance = editor();
        if (!instance) return { lang: '', selection: '', value: '' };
        try {
            const model = instance.getModel();
            const selection = instance.getSelection();
            return {
                lang: languageOf(instance),
                selection: selection && !selection.isEmpty() ? model.getValueInRange(selection) : '',
                value: model.getValue(),
            };
        } catch (_) {
            return { lang: '', selection: '', value: '' };
        }
    }

    document.addEventListener(REQUEST, (event) => {
        let message;
        try { message = JSON.parse(event.detail); } catch (_) { return; }
        if (!message) return;

        if (message.type === 'insert') insert(message.text);
        else if (message.type === 'read') send(CODE, readCode());
    });
})();
