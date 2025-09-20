/**
 * Cookie consent banners.
 *
 *  - On a banner Bell Bearer can find, add "Always accept" and "Always reject"
 *    beside the site's own buttons — each one only when its setting is on and
 *    the banner has the matching button to press. Clicking one presses the
 *    site's button and remembers the answer for the site
 *    (src/shared/cookie-sites.js).
 *  - On a site already remembered, press the matching button as soon as the
 *    banner shows up, so it is never seen again.
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
    const ACTIONS_CLASS = 'bb-cookie-actions';

    /** Known consent managers: the banner, and its accept-all / reject-all buttons inside it. */
    const KNOWN = [
        { name: 'klaro', banner: '.klaro .cookie-notice, .klaro .cookie-modal', accept: '.cm-btn-accept-all, .cn-buttons .cm-btn-success, .cm-btn-success', reject: '.cn-decline, .cm-btn-decline' },
        { name: 'onetrust', banner: '#onetrust-banner-sdk', accept: '#onetrust-accept-btn-handler', reject: '#onetrust-reject-all-handler' },
        { name: 'cookiebot', banner: '#CybotCookiebotDialog', accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept', reject: '#CybotCookiebotDialogBodyButtonDecline' },
        { name: 'didomi', banner: '#didomi-notice, #didomi-popup', accept: '#didomi-notice-agree-button', reject: '#didomi-notice-disagree-button' },
        { name: 'quantcast', banner: '.qc-cmp2-summary-buttons, .qc-cmp2-container', accept: '.qc-cmp2-summary-buttons button[mode="primary"]' },
        { name: 'trustarc', banner: '#truste-consent-track', accept: '#truste-consent-button', reject: '#truste-consent-required' },
        { name: 'osano', banner: '.osano-cm-dialog', accept: '.osano-cm-accept-all, .osano-cm-accept', reject: '.osano-cm-denyAll, .osano-cm-deny' },
        { name: 'cookieyes', banner: '.cky-consent-container', accept: '.cky-btn-accept', reject: '.cky-btn-reject' },
        { name: 'complianz', banner: '.cmplz-cookiebanner', accept: '.cmplz-accept', reject: '.cmplz-deny' },
        { name: 'iubenda', banner: '#iubenda-cs-banner', accept: '.iubenda-cs-accept-btn', reject: '.iubenda-cs-reject-btn' },
        { name: 'cookieconsent', banner: '.cc-window', accept: '.cc-allow, .cc-dismiss', reject: '.cc-deny' },
        { name: 'google-fc', banner: '.fc-consent-root', accept: '.fc-cta-consent' },
        { name: 'termly', banner: '#termly-code-snippet-support [role="dialog"]', accept: '[data-tid="banner-accept"]', reject: '[data-tid="banner-decline"]' },
    ];

    const ACCEPT_TEXT = /^(accept|accept all|accept all cookies|accept cookies|allow|allow all|allow all cookies|allow cookies|i accept|i agree|agree|agree and close|accept and close|accept & close|yes, i agree|got it|ok|okay)$/i;
    const REJECT_TEXT = /^(reject|reject all|reject all cookies|reject cookies|decline|decline all|deny|deny all|refuse|refuse all|necessary only|only necessary|necessary cookies only|only necessary cookies|use necessary cookies only|essential only|only essential|essential cookies only|continue without accepting)$/i;
    const BANNER_TEXT = /cookie|consent|gdpr|tracking technologies/i;
    const CANDIDATES = '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i], [role="dialog"], [role="alertdialog"]';
    const BUTTONS = 'button, a[role="button"], input[type="button"], input[type="submit"]';

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

    const visibleIn = (banner, selector) =>
        (selector ? Array.from(banner.querySelectorAll(selector)).find(isVisible) : null) || null;

    /** The banner on screen with its accept and reject buttons (either may be null), or null. */
    function findBanner(doc = document) {
        for (const cmp of KNOWN) {
            for (const banner of doc.querySelectorAll(cmp.banner)) {
                if (!isVisible(banner)) continue;
                const accept = visibleIn(banner, cmp.accept);
                const reject = visibleIn(banner, cmp.reject);
                if (accept || reject) return { banner, accept, reject, source: cmp.name };
            }
        }

        // The heuristic: a small, visible container that talks about cookies
        // and holds a button that says "accept" or "reject". The size cap keeps
        // a page that merely *mentions* cookies in its body from qualifying.
        for (const banner of doc.querySelectorAll(CANDIDATES)) {
            if (!isVisible(banner)) continue;
            const text = banner.textContent || '';
            if (text.length > 4000 || !BANNER_TEXT.test(text)) continue;
            const buttons = Array.from(banner.querySelectorAll(BUTTONS)).filter(isVisible);
            const accept = buttons.find((button) => ACCEPT_TEXT.test(buttonText(button))) || null;
            const reject = buttons.find((button) => REJECT_TEXT.test(buttonText(button))) || null;
            if (accept || reject) return { banner, accept, reject, source: 'heuristic' };
        }
        return null;
    }

    /** The later of two elements in document order. */
    function lastOf(a, b) {
        if (!a || !b) return a || b;
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a;
    }

    function createCookieBanner({ CookieSites, notify, showAccept, showReject, hostname = location.hostname }) {
        let observer = null;
        let stopTimer = 0;
        let scheduled = false;
        let handled = false;

        const host = CookieSites.normalizeHost(hostname);

        function stop() {
            if (observer) observer.disconnect();
            observer = null;
            clearTimeout(stopTimer);
        }

        function chip(label, decision, target) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `bb-cookie-remember is-${decision}`;
            button.textContent = label;
            button.title = `Bell Bearer: ${decision === 'accept' ? 'accept' : 'reject'} cookies on ${host} from now on. Undo in Bell Bearer Settings → General.`;
            button.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await CookieSites.remember(hostname, decision);
                if (target.isConnected) target.click();
                notify(`Cookies will be ${decision === 'accept' ? 'accepted' : 'rejected'} on ${host} from now on`, 'success');
            });
            return button;
        }

        function addButtons(found) {
            found.banner.querySelectorAll(`.${ACTIONS_CLASS}`).forEach((old) => old.remove());

            const wrap = document.createElement('span');
            wrap.className = ACTIONS_CLASS;
            if (found.accept && showAccept()) wrap.appendChild(chip('Always accept', 'accept', found.accept));
            if (found.reject && showReject()) wrap.appendChild(chip('Always reject', 'decline', found.reject));
            if (!wrap.childElementCount) return;

            lastOf(found.accept, found.reject).insertAdjacentElement('afterend', wrap);
        }

        async function scan() {
            scheduled = false;
            if (handled) return;

            const found = findBanner();
            if (!found) return;

            const remembered = CookieSites.match(await CookieSites.load(), hostname);
            const answer = remembered && (remembered.decision === 'accept' ? found.accept : found.reject);
            if (answer) {
                handled = true;
                stop();
                answer.click();
                return;
            }
            if (!found.banner.querySelector(`.${ACTIONS_CLASS}`)) addButtons(found);
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

    const CookieBanner = { createCookieBanner, findBanner, KNOWN, ACCEPT_TEXT, REJECT_TEXT, ACTIONS_CLASS };

    root.BB = root.BB || {};
    root.BB.CookieBanner = CookieBanner;
    if (typeof module !== 'undefined' && module.exports) module.exports = CookieBanner;
})(typeof globalThis !== 'undefined' ? globalThis : this);
