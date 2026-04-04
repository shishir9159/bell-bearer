/**
 * Finding a consent banner, and what it costs to look. findBanner runs on a
 * timer for the first twenty seconds of every page, and its candidates include
 * every [role="dialog"]; both halves of isVisible() force a layout. The
 * counters fail if that expensive check creeps back ahead of the cheap one.
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

    /** The style and layout reads `run` forces, and what it returned. */
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

    /** `n` dialogs that are not consent banners. */
    function noisyPage(n) {
        const rows = Array.from({ length: n }, (_, i) =>
            `<div role="dialog" aria-label="menu ${i}"><span>Share</span><button>Save</button></div>`);
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
            const found = CookieBanner().findBanner(stage(BANNER));
            assert(found, 'the OneTrust banner was not found');
            assertEqual(found.source, 'onetrust');
            assertEqual(found.accept.id, 'onetrust-accept-btn-handler');
            assertEqual(found.reject.id, 'onetrust-reject-all-handler');
            teardown();
        });

        test('an unbranded banner is found by what it says', () => {
            // Reachable by its "cookie" class, with none of the managers' hooks.
            const found = CookieBanner().findBanner(stage(`
                <div class="cookie-notice-bar">
                    <p>This site uses cookies.</p>
                    <a role="button">Accept all cookies</a>
                    <a role="button">Reject all</a>
                </div>`));
            assert(found && found.accept && found.reject, 'the heuristic missed it');
            teardown();
        });

        test('a page that merely mentions cookies is not a banner', () => {
            const host = stage(`
                <div role="dialog">
                    <p>${'Our cookie policy explained at length. '.repeat(200)}</p>
                    <button>Accept</button>
                </div>`);
            assertEqual(CookieBanner().findBanner(host), null);
            teardown();
        });
    });

    suite('cookie banners — what a scan costs', () => {
        test('a page full of dialogs costs almost nothing to rule out', () => {
            // isVisible() ahead of the text test once cost ~42 forced layouts here, four times a second.
            const host = noisyPage(20);
            const counts = countLayoutReads(() => CookieBanner().findBanner(host));
            assertEqual(counts.result, null, 'it found a banner that is not there');
            assert(counts.rect <= 4, `${counts.rect} bounding-rect reads`);
            assert(counts.style <= 4, `${counts.style} computed-style reads`);
            teardown();
        });

        test('the cost does not grow with the number of dialogs on the page', () => {
            const small = countLayoutReads(() => CookieBanner().findBanner(noisyPage(5)));
            const large = countLayoutReads(() => CookieBanner().findBanner(noisyPage(60)));
            assert(large.rect <= small.rect + 2, `reads grew with page size: ${small.rect} → ${large.rect}`);
            teardown();
        });

        test('a real banner is still found, and still cheaply', () => {
            // The known-manager pass runs first, so the dialogs are never examined.
            const host = stage(noisyPage(20).innerHTML + BANNER);
            const counts = countLayoutReads(() => CookieBanner().findBanner(host));
            assertEqual(counts.result && counts.result.source, 'onetrust');
            assert(counts.rect <= 6, `${counts.rect} rect reads to find a known banner`);
            teardown();
        });
    });
})();
