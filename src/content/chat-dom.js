/**
 * What every chat site's page is read the same way for, over that site's own
 * selector table: the branch arrows and their `k/n`, the composer and its
 * buttons, the header, and the usage-limit notice.
 *
 * chatgpt-read.js and claude-read.js carried these line for line. What is
 * left in each is truly the site's own: how a row is tied to the tree, the
 * API, the stream bridge, and where the column's edge is.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Selectors = ns.Selectors || req('../shared/selectors.js');
    const ChatSites = ns.ChatSites || req('../shared/chat-sites.js');

    /** `2/3` → { index: 2, count: 3 }, and anything else is not a count. */
    function readCount(text) {
        const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(text || ''));
        if (!match) return null;
        const index = Number(match[1]);
        const count = Number(match[2]);
        return index >= 1 && count >= 2 && index <= count ? { index, count } : null;
    }

    /**
     * @param {object} SELECTORS  the site's table: composer, send, stop, header,
     *   siblingPrev, siblingNext, siblingCount and limitNotice among it
     * @param {string} site       the ChatSites id, for reading a notice
     * @param {number} noticeMin  how short a notice's text can be and still be one
     */
    function create(SELECTORS, { site, noticeMin }) {
        const { find, findAll } = Selectors.table(SELECTORS);

        /** The turn's `< k/n >`, or null when it has no siblings to switch between. */
        function siblingNav(element) {
            const prev = find('siblingPrev', element);
            const next = find('siblingNext', element);
            if (!prev || !next) return null;
            // The count sits between the two buttons. Searched from their
            // shared parent rather than the whole turn, so a "1/2" inside the
            // answer's own text can never be read as the control.
            let scope = prev.parentElement;
            while (scope && !scope.contains(next)) scope = scope.parentElement;
            for (const candidate of scope ? findAll('siblingCount', scope) : []) {
                if (candidate.children.length) continue;
                const count = readCount(candidate.textContent);
                if (count) return { ...count, prev, next };
            }
            return null;
        }

        const composer = () => find('composer', document, { visible: true });
        const sendButton = () => find('send', document, { visible: true });
        const stopButton = () => find('stop', document, { visible: true });

        /** Where the chat's own header ends, so the panel starts below it. */
        function headerBottom() {
            const header = find('header');
            return header ? Math.max(0, header.getBoundingClientRect().bottom) : 56;
        }

        /**
         * The limit notice's text, or null. The selectors only say where to
         * look; what is believed is text ChatSites.readLimit reads as a
         * limit. Anything holding the composer is passed over, so a prompt
         * being typed about rate limits is never mistaken for one.
         */
        function limitNotice() {
            const box = composer();
            for (const selector of SELECTORS.limitNotice || []) {
                let found = [];
                try { found = document.querySelectorAll(selector); } catch (_) { continue; }
                for (const element of found) {
                    if (box && element.contains(box)) continue;
                    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                    if (text.length > noticeMin && text.length < 400 && ChatSites.readLimit(site, text)) return text;
                }
            }
            return null;
        }

        return { find, findAll, siblingNav, composer, sendButton, stopButton, headerBottom, limitNotice };
    }

    const ChatDom = { create, readCount, shown: Selectors.shown };

    root.BB = root.BB || {};
    root.BB.ChatDom = ChatDom;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatDom;
})(typeof globalThis !== 'undefined' ? globalThis : this);
