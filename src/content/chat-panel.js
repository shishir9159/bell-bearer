/**
 * The chat panel: a column down the right of a chat site, over the margin
 * the thread leaves empty.
 *
 * Docked when there is room and an overlay when there is not. ChatGPT and
 * Claude both centre the thread in a column of their own, so on a wide
 * window the right-hand margin is dead space and the panel can sit in it
 * with the conversation fully readable beside it. On a narrower one the
 * margin is not there, and a docked panel would sit on the answers — so it
 * becomes an overlay with a scrim and goes away on an outside click, which
 * is src/content/twitter-panel.js's rule, and its `data-bb-keep-panel`
 * marker for our own controls elsewhere on the page. The room is measured
 * off the thread itself rather than guessed from the window's width: the
 * sidebar may be open or shut, and the two sites' columns differ.
 *
 * Not chrome.sidePanel. That is Chrome-only, sits outside the page it has to
 * scroll and click, and costs a permission.
 *
 * This file is the frame: the header, the tab strip and the body, and where
 * the whole thing sits. What goes in a tab is src/content/chat-ui.js's, which
 * owns the conversation and hands each tab its markup; the builders for that
 * markup are here, below, so a tab's shape is in one place.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');

    const PANEL_ID = 'bb-chat-panel';
    const SCRIM_ID = 'bb-chat-scrim';
    const KEEP = 'data-bb-keep-panel';

    const WIDTH = 340;
    /** Between the thread's right edge and the panel, when docked. */
    const GUTTER = 20;

    const esc = (text) => Dom.escapeHtml(text);

    const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></svg>';

    /**
     * Would a docked panel clear the thread? `threadRight` is the right edge
     * of the widest thing in the conversation column, in viewport pixels, or
     * null when there is nothing to measure — a new chat, a page still
     * loading — and then only a window wide enough for any layout docks.
     */
    function fitsBeside(viewportWidth, threadRight) {
        if (!Number.isFinite(threadRight)) return viewportWidth >= 1500;
        return viewportWidth - threadRight >= WIDTH + GUTTER + 12;
    }

    /**
     * @param {object} deps
     * @param {string} deps.site             'chatgpt' — styles hang off it
     * @param {() => Array<{id, label}>} deps.tabs   the tabs there are now
     * @param {(tab: string) => string} deps.bodyHtml   the open tab's markup
     * @param {(event, tab: string) => void} deps.onBodyClick
     * @param {() => number|null} deps.threadRight
     * @param {() => number} deps.top        below the site's own header
     * @param {() => Promise<object>} deps.appearance
     * @param {(element, look) => void} deps.dress
     * @param {(state: {open, tab}) => void} deps.onState   remembered by the caller
     */
    function createChatPanel({ site, tabs, bodyHtml, onBodyClick, threadRight, top, appearance, dress, onState }) {
        let host = null;
        let scrim = null;
        let tab = null;
        let title = '';
        let sub = '';
        let docked = true;

        const isOpen = () => !!host;

        const currentTab = () => {
            const list = tabs();
            return (list.find((t) => t.id === tab) || list[0] || { id: null }).id;
        };

        function shellHtml() {
            return `
                <div class="bb-chat-head">
                    <div class="bb-chat-heading">
                        <h2 class="bb-chat-title"></h2>
                        <p class="bb-chat-sub"></p>
                    </div>
                    <div class="bb-chat-actions"></div>
                    <button type="button" class="bb-chat-close" data-bb-chat-close="1" title="Close" aria-label="Close">${CLOSE_ICON}</button>
                </div>
                <div class="bb-chat-tabs" role="tablist"></div>
                <div class="bb-chat-body"></div>`;
        }

        function open({ tab: wanted } = {}) {
            if (wanted) tab = wanted;
            if (isOpen()) { render(); return; }

            host = document.createElement('div');
            host.id = PANEL_ID;
            host.className = 'bb-chat-panel';
            host.dataset.bbChatSite = site;
            host.setAttribute(KEEP, '1');
            host.setAttribute('role', 'complementary');
            host.setAttribute('aria-label', 'Bell Bearer chat panel');
            host.innerHTML = shellHtml();
            Dom.holdFocus(host);
            document.body.appendChild(host);

            host.querySelector('.bb-chat-tabs').addEventListener('click', (event) => {
                const button = event.target.closest('[data-bb-chat-tab]');
                if (!button) return;
                tab = button.dataset.bbChatTab;
                render();
                report();
            });
            host.querySelector('[data-bb-chat-close]').addEventListener('click', () => close());
            host.querySelector('.bb-chat-body').addEventListener('click', (event) => onBodyClick(event, currentTab()));

            appearance().then((look) => {
                if (host) dress(host, look);
                if (scrim) dress(scrim, look);
            });

            document.addEventListener('click', onDocumentClick, true);
            document.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('resize', place);
            place();
            render();
            report();
        }

        function close() {
            if (!isOpen()) return;
            document.removeEventListener('click', onDocumentClick, true);
            document.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('resize', place);
            host.remove();
            host = null;
            if (scrim) { scrim.remove(); scrim = null; }
            report();
        }

        const toggle = (options) => (isOpen() ? close() : open(options));

        function report() {
            if (onState) onState({ open: isOpen(), tab: currentTab() });
        }

        /**
         * Docked or overlaid, and how far down. Called on open and on every
         * resize, and by the caller when the thread's own width may have
         * changed — the sidebar opening, a navigation.
         */
        function place() {
            if (!host) return;
            docked = fitsBeside(window.innerWidth, threadRight());
            host.classList.toggle('is-docked', docked);
            host.classList.toggle('is-overlay', !docked);
            host.style.top = `${Math.max(8, Math.round(top()))}px`;

            if (!docked && !scrim) {
                scrim = document.createElement('div');
                scrim.id = SCRIM_ID;
                scrim.className = 'bb-chat-scrim';
                document.body.insertBefore(scrim, host);
                appearance().then((look) => { if (scrim) dress(scrim, look); });
            } else if (docked && scrim) {
                scrim.remove();
                scrim = null;
            }
        }

        // ------------------------------------------------------ dismissal

        /** Overlaid, a click anywhere that is not ours closes it. Docked, nothing does. */
        function onDocumentClick(event) {
            if (docked) return;
            if (event.target.closest && event.target.closest(`[${KEEP}]`)) return;
            close();
        }

        /**
         * Escape closes it when it is in the way, or when the keyboard is in
         * it. Docked and ignored, the Escape belongs to the page — ChatGPT
         * uses it to close its own menus.
         */
        function onKeyDown(event) {
            if (event.key !== 'Escape' || !host) return;
            const inside = host.contains(event.target);
            if (inside && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
            if (docked && !inside) return;
            event.stopPropagation();
            close();
        }

        // ---------------------------------------------------------- drawing

        function setHeading(nextTitle, nextSub) {
            title = nextTitle || '';
            sub = nextSub || '';
            if (!host) return;
            host.querySelector('.bb-chat-title').textContent = title || 'No conversation open';
            host.querySelector('.bb-chat-sub').textContent = sub;
        }

        function render() {
            if (!host) return;
            setHeading(title, sub);
            const list = tabs();
            const on = currentTab();
            const strip = host.querySelector('.bb-chat-tabs');
            strip.hidden = list.length < 2;
            strip.innerHTML = list.map((t) => `
                <button type="button" class="bb-chat-tab${t.id === on ? ' is-on' : ''}" role="tab"
                        aria-selected="${t.id === on}" data-bb-chat-tab="${Dom.escapeAttr(t.id)}">${esc(t.label)}</button>`).join('');
            host.querySelector('.bb-chat-body').innerHTML = bodyHtml(on);
        }

        /** Put markup in the header's action row — Export, Library. */
        function setActions(html) {
            if (host) host.querySelector('.bb-chat-actions').innerHTML = html;
        }

        return {
            open, close, toggle, isOpen, render, place, setHeading, setActions,
            get element() { return host; },
            get tab() { return currentTab(); },
            get docked() { return docked; },
        };
    }

    /** An empty tab's message, the same shape everywhere. */
    const emptyHtml = (text) => `<div class="bb-chat-empty"><p>${esc(text)}</p></div>`;

    // ------------------------------------------------------------ outline

    /**
     * The outline: every prompt, and under each answer its headings. A row is
     * a button that reaches its turn — and its heading, when it is one.
     */
    function outlineHtml(entries) {
        if (!entries.length) return emptyHtml('Nothing on this path yet.');
        return `<ol class="bb-chat-outline">${entries.map((entry, index) => `
            <li><button type="button" class="bb-chat-entry is-l${entry.level}" data-bb-chat-entry="${index}"
                        data-bb-chat-reach="${Dom.escapeAttr(entry.id)}" data-bb-chat-heading="${Dom.escapeAttr(entry.heading || '')}"
                        title="${Dom.escapeAttr(entry.text)}">
                <span class="bb-chat-entry-text">${esc(entry.text)}</span>
            </button></li>`).join('')}</ol>`;
    }

    /**
     * Which outline row is the one being read: the last entry at or above
     * `at` — the turn at the reading line and the heading within it. An
     * answer read before any of its headings is still under its prompt.
     */
    function currentEntry(entries, path, at) {
        if (!at) return -1;
        const here = path.indexOf(at.id);
        let chosen = -1;
        let reached = false;
        entries.forEach((entry, index) => {
            const where = path.indexOf(entry.id);
            if (where < here) chosen = index;
            else if (where === here && !reached) {
                if (entry.level === 0) chosen = index;
                else if (at.heading) {
                    chosen = index;
                    reached = entry.heading === at.heading;
                }
            }
        });
        return chosen;
    }

    const ChatPanel = {
        createChatPanel, fitsBeside, emptyHtml, outlineHtml, currentEntry, PANEL_ID, SCRIM_ID, KEEP, WIDTH,
    };

    root.BB = root.BB || {};
    root.BB.ChatPanel = ChatPanel;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatPanel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
