/**
 * Finding a consent banner — and, just as much, what it costs to look.
 *
 * The cost is the point of half of these. findBanner runs on a timer for the
 * first twenty seconds of every page on every site, and its candidate
 * selector matches [role="dialog"] among other things — which on a YouTube
 * watch page is dozens of elements that have nothing to do with cookies. Both
 * halves of isVisible() (a bounding rect and a computed style) force the
 * browser to flush layout, so the order the tests are applied in decides
 * whether a scan that finds nothing costs two layout flushes or two hundred.
 *
 * That is not something a correctness test would ever catch, so the counters
 * below are the guard: they fail if the expensive half creeps back in front
 * of the cheap one.
 */
(function () {
    'use strict';

    const CookieBanner = () => window.BB.CookieBanner;
    const HOST_ID = 'bb-cookie-test';

    function teardown() {
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
    }

    function stage(html) {
        teardown();
        const host = document.createElement('div');
        host.id = HOST_ID;
        host.innerHTML = html;
        document.body.appendChild(host);
        return host;
    }

    /**
     * Count the calls that force style and layout while `run` executes.
     *
     * Both are restored in a finally: leaving a counting getComputedStyle on
     * the window would follow every later spec in the run.
     */
    function countLayoutReads(run) {
        const realStyle = window.getComputedStyle;
        const realRect = Element.prototype.getBoundingClientRect;
        const counts = { style: 0, rect: 0 };

        window.getComputedStyle = function (...args) {
            counts.style++;
            return realStyle.apply(window, args);
        };
        Element.prototype.getBoundingClientRect = function (...args) {
            counts.rect++;
            return realRect.apply(this, args);
        };

        try {
            counts.result = run();
        } finally {
            window.getComputedStyle = realStyle;
            Element.prototype.getBoundingClientRect = realRect;
        }
        return counts;
    }

    /** A page with a lot of dialog-shaped furniture and no consent banner. */
    function noisyPage(n) {
        const rows = [];
        for (let i = 0; i < n; i++) {
            rows.push(`<div role="dialog" aria-label="menu ${i}"><span>Share</span><button>Save</button></div>`);
        }
        // And a couple that merely mention the word without being a banner.
        rows.push('<div role="dialog"><p>Settings</p><button>Done</button></div>');
        return stage(rows.join(''));
    }

    const BANNER = `
        <div id="onetrust-banner-sdk">
            <p>We use cookies to improve your experience.</p>
            <button id="onetrust-accept-btn-handler">Accept All</button>
            <button id="onetrust-reject-all-handler">Reject All</button>
        </div>`;

    suite('cookie banners — finding one', () => {
        test('a known consent manager is found by its own markup', () => {
            const host = stage(BANNER);
            const found = CookieBanner().findBanner(host);
            assert(found, 'the OneTrust banner was not found');
            assertEqual(found.source, 'onetrust');
            assertEqual(found.accept.id, 'onetrust-accept-btn-handler');
            assertEqual(found.reject.id, 'onetrust-reject-all-handler');
            teardown();
        });

        test('an unbranded banner is found by what it says', () => {
            // A container the candidate selector can reach — it says "cookie"
            // in its own class — wearing none of the known managers' hooks.
            const host = stage(`
                <div class="cookie-notice-bar">
                    <p>This site uses cookies.</p>
                    <a role="button">Accept all cookies</a>
                    <a role="button">Reject all</a>
                </div>`);
            const found = CookieBanner().findBanner(host);
            assert(found, 'the heuristic missed it');
            assert(found.accept, 'no accept button');
            assert(found.reject, 'no reject button');
            teardown();
        });

        test('a page that merely mentions cookies is not a banner', () => {
            const host = stage(`
                <div role="dialog">
                    <p>${'Our cookie policy explained at length. '.repeat(200)}</p>
                    <button>Accept</button>
                </div>`);
            assertEqual(CookieBanner().findBanner(host), null,
                'a long article about cookies was taken for a consent banner');
            teardown();
        });

        test('nothing on a page with no banner', () => {
            const host = noisyPage(20);
            assertEqual(CookieBanner().findBanner(host), null);
            teardown();
        });
    });

    suite('cookie banners — what a scan costs', () => {
        test('a page full of dialogs costs almost nothing to rule out', () => {
            // The regression this exists for: isVisible() ahead of the text
            // test meant one rect and one computed style per candidate, so
            // this page cost ~42 forced layouts per scan, four times a second.
            const host = noisyPage(20);
            const counts = countLayoutReads(() => CookieBanner().findBanner(host));

            assertEqual(counts.result, null, 'it found a banner that is not there');
            assert(counts.rect <= 4, `${counts.rect} bounding-rect reads for a page with no banner`);
            assert(counts.style <= 4, `${counts.style} computed-style reads for a page with no banner`);
            teardown();
        });

        test('the cost does not grow with the number of dialogs on the page', () => {
            // A watch page has far more furniture than a search page, and the
            // scan must not get more expensive as the page fills up.
            const small = countLayoutReads(() => CookieBanner().findBanner(noisyPage(5)));
            const large = countLayoutReads(() => CookieBanner().findBanner(noisyPage(60)));
            assert(large.rect <= small.rect + 2,
                `reads grew with page size: ${small.rect} → ${large.rect}`);
            teardown();
        });

        test('a real banner is still found, and still cheaply', () => {
            const host = stage(noisyPage(20).innerHTML + BANNER);
            const counts = countLayoutReads(() => CookieBanner().findBanner(host));
            assert(counts.result, 'the banner was missed');
            assertEqual(counts.result.source, 'onetrust');
            // The known-manager pass runs first and wins, so the dialogs are
            // never examined at all.
            assert(counts.rect <= 6, `${counts.rect} rect reads to find a known banner`);
            teardown();
        });
    });
})();
