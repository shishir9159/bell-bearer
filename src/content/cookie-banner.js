/**
 * Cookie consent banners.
 *
 * Two jobs, both behind the `cookieBannerHelper` setting:
 *  - on a banner Bell Bearer can find, add an "Always accept here" button next
 *    to the site's own accept button. Clicking it accepts, and remembers the
 *    site (src/shared/cookie-sites.js);
 *  - on a site already remembered, press the site's accept button as soon as
 *    the banner shows up, so it is never seen again.
 *
 * Banners are found by the consent managers' own markup first — those are
 * stable and unambiguous — and by a guarded text heuristic after that. The
 * page is only watched for a while after load: a banner that has not appeared
 * by then is not coming, and a MutationObserver left on every page of every
 * site forever is not free.
 */
(function (root) {
    'use strict';

    const WATCH_MS = 20000;
    const BUTTON_CLASS = 'bb-cookie-remember';

    /** Known consent managers: the banner, and its accept-all button inside it. */
    const KNOWN = [
        { name: 'klaro', banner: '.klaro .cookie-notice, .klaro .cookie-modal', accept: '.cm-btn-accept-all, .cn-buttons .cm-btn-success, .cm-btn-success' },
        { name: 'onetrust', banner: '#onetrust-banner-sdk', accept: '#onetrust-accept-btn-handler' },
        { name: 'cookiebot', banner: '#CybotCookiebotDialog', accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept' },
        { name: 'didomi', banner: '#didomi-notice, #didomi-popup', accept: '#didomi-notice-agree-button' },
        { name: 'quantcast', banner: '.qc-cmp2-summary-buttons, .qc-cmp2-container', accept: '.qc-cmp2-summary-buttons button[mode="primary"]' },
        { name: 'trustarc', banner: '#truste-consent-track', accept: '#truste-consent-button' },
        { name: 'osano', banner: '.osano-cm-dialog', accept: '.osano-cm-accept-all, .osano-cm-accept' },
        { name: 'cookieyes', banner: '.cky-consent-container', accept: '.cky-btn-accept' },
        { name: 'complianz', banner: '.cmplz-cookiebanner', accept: '.cmplz-accept' },
        { name: 'iubenda', banner: '#iubenda-cs-banner', accept: '.iubenda-cs-accept-btn' },
        { name: 'cookieconsent', banner: '.cc-window', accept: '.cc-allow, .cc-dismiss' },
        { name: 'google-fc', banner: '.fc-consent-root', accept: '.fc-cta-consent' },
        { name: 'termly', banner: '#termly-code-snippet-support [role="dialog"]', accept: '[data-tid="banner-accept"]' },
    ];

    const ACCEPT_TEXT = /^(accept|accept all|accept all cookies|accept cookies|allow|allow all|allow all cookies|allow cookies|i accept|i agree|agree|agree and close|accept and close|accept & close|yes, i agree|got it|ok|okay)$/i;
    const BANNER_TEXT = /cookie|consent|gdpr|tracking technologies/i;
    const CANDIDATES = '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i], [role="dialog"], [role="alertdialog"]';

    function isVisible(element) {
        if (!element || !element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
    }

    function buttonText(element) {
        return (element.textContent || element.value || '').replace(/\s+/g, ' ').trim();
    }

    /** The banner on screen and its accept button, or null. */
    function findBanner(doc = document) {
        for (const cmp of KNOWN) {
            for (const banner of doc.querySelectorAll(cmp.banner)) {
                if (!isVisible(banner)) continue;
                const accept = Array.from(banner.querySelectorAll(cmp.accept)).find(isVisible);
                if (accept) return { banner, accept, source: cmp.name };
            }
        }

        // The heuristic: a small, visible container that talks about cookies
        // and holds a button that says "accept". The size cap keeps a page
        // that merely *mentions* cookies in its body from qualifying.
        for (const banner of doc.querySelectorAll(CANDIDATES)) {
            if (!isVisible(banner)) continue;
            const text = banner.textContent || '';
            if (text.length > 4000 || !BANNER_TEXT.test(text)) continue;
            const accept = Array.from(banner.querySelectorAll('button, a[role="button"], input[type="button"], input[type="submit"]'))
                .find((button) => isVisible(button) && ACCEPT_TEXT.test(buttonText(button)));
            if (accept) return { banner, accept, source: 'heuristic' };
        }
        return null;
    }

    function createCookieBanner({ CookieSites, notify, isEnabled, hostname = location.hostname }) {
        let observer = null;
        let stopTimer = 0;
        let scheduled = false;
        let handled = false;

        function stop() {
            if (observer) observer.disconnect();
            observer = null;
            clearTimeout(stopTimer);
        }

        function addRememberButton(found) {
            if (found.banner.querySelector(`.${BUTTON_CLASS}`)) return;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = BUTTON_CLASS;
            button.textContent = 'Always accept here';
            button.title = 'Bell Bearer: accept cookies on this site and stop asking. Undo in Bell Bearer Settings → General.';
            button.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const accept = found.accept;
                await CookieSites.remember(hostname);
                if (accept.isConnected) accept.click();
                button.remove();
                notify(`Cookies will be accepted on ${CookieSites.normalizeHost(hostname)} from now on`, 'success');
            });

            found.accept.insertAdjacentElement('afterend', button);
        }

        async function scan() {
            scheduled = false;
            if (handled || !isEnabled()) return;

            const found = findBanner();
            if (!found) return;

            const remembered = CookieSites.match(await CookieSites.load(), hostname);
            if (remembered && remembered.decision === 'accept') {
                handled = true;
                stop();
                found.accept.click();
                return;
            }
            addRememberButton(found);
        }

        function schedule() {
            if (scheduled) return;
            scheduled = true;
            setTimeout(scan, 250);
        }

        function install() {
            if (!document.documentElement) return;
            schedule();
            observer = new MutationObserver(schedule);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            stopTimer = setTimeout(stop, WATCH_MS);
        }

        return { install, stop, scan };
    }

    const CookieBanner = { createCookieBanner, findBanner, KNOWN, ACCEPT_TEXT, BUTTON_CLASS };

    root.BB = root.BB || {};
    root.BB.CookieBanner = CookieBanner;
    if (typeof module !== 'undefined' && module.exports) module.exports = CookieBanner;
})(typeof globalThis !== 'undefined' ? globalThis : this);
