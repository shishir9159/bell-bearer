/**
 * The bar a roster job shows on the site's own page: what it is doing, how far
 * it has got, and the buttons that are the user's part of it.
 *
 * The user has a part because the job does not act on the account itself. It
 * reads what the user scrolls past and opens the next page, and the Follow or
 * Join is the user's own click on the site's own button — see the head of
 * src/content/roster.js. So the bar is how the job asks: it says whose page
 * this is, rings the button to press, and offers Skip, Done and Stop.
 *
 * Names reach it already checked against the site's alphabet, and every line
 * is set as text all the same.
 */
(function (root) {
    'use strict';

    const ID = 'bb-roster-bar';
    /** The ring on the site's button. An attribute, so content.css can draw it. */
    const MARK = 'data-bb-roster-target';

    /**
     * @param {object} deps
     * @param {() => Promise<object>} deps.appearance  Theme.appearance
     * @param {(element: Element, look: object) => void} deps.dress  Theme.dress
     */
    function createBar({ appearance, dress }) {
        let element = null;
        let onAction = () => {};
        let marked = null;
        /** The bar being built: two shows in one tick would otherwise draw two. */
        let building = null;
        let wanted = false;

        function ensure() {
            if (element && element.isConnected) return Promise.resolve(element);
            if (!building) building = build().finally(() => { building = null; });
            return building;
        }

        /**
         * Built in a local and only then made the bar: a hide() that lands
         * while the skin is being read clears `element`, and building on it
         * threw.
         */
        async function build() {
            const made = document.createElement('div');
            made.id = ID;
            made.className = 'bb-roster-bar';
            made.setAttribute('role', 'status');
            made.setAttribute('aria-live', 'polite');
            made.innerHTML = `
                <div class="bb-roster-bar-text">
                    <strong class="bb-roster-bar-head"></strong>
                    <span class="bb-roster-bar-line"></span>
                </div>
                <div class="bb-roster-bar-acts"></div>`;
            // On the bar, which outlives every redraw of its buttons.
            made.addEventListener('click', (event) => {
                const button = event.target.closest('[data-bb-roster-act]');
                if (button) onAction(button.dataset.bbRosterAct);
            });
            try { dress(made, await appearance()); } catch (_) { /* the extension reloaded: unstyled beats absent */ }
            // One left by this script's copy from before an extension reload,
            // whose buttons would answer to nobody.
            const stale = document.getElementById(ID);
            if (stale) stale.remove();
            document.documentElement.append(made);
            element = made;
            return made;
        }

        /**
         * Say `head` and `line`, with `acts` — `[{ id, label, danger }]` — as
         * the buttons. The same buttons are not drawn again, so one under the
         * pointer is not replaced between a press and its release.
         */
        async function show({ head, line = '', acts = [], onAct }) {
            wanted = true;
            const bar = await ensure();
            // Hidden while it was being built.
            if (!wanted) return void hide();
            if (onAct) onAction = onAct;
            // Only what changed is written: the bar is a live region, and a
            // read redraws it twice a second.
            const say = (selector, text) => {
                const node = bar.querySelector(selector);
                if (node.textContent !== text) node.textContent = text;
            };
            say('.bb-roster-bar-head', head);
            say('.bb-roster-bar-line', line);
            const box = bar.querySelector('.bb-roster-bar-acts');
            const key = acts.map((act) => `${act.id}:${act.label}`).join('|');
            if (box.dataset.key === key) return;
            box.dataset.key = key;
            box.textContent = '';
            for (const act of acts) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = act.danger ? 'bb-roster-bar-btn bb-roster-bar-quiet' : 'bb-roster-bar-btn';
                button.dataset.bbRosterAct = act.id;
                button.textContent = act.label;
                box.append(button);
            }
        }

        /** Ring `target`, the site's own button the user is being asked to press. */
        function mark(target) {
            if (marked === target && target && target.hasAttribute(MARK)) return;
            unmark();
            marked = target || null;
            if (marked) marked.setAttribute(MARK, '');
        }

        function unmark() {
            if (marked) marked.removeAttribute(MARK);
            marked = null;
        }

        function hide() {
            wanted = false;
            unmark();
            if (element) element.remove();
            element = null;
        }

        return { show, hide, mark, unmark, isShown: () => !!(element && element.isConnected) };
    }

    const RosterBar = { createBar, ID, MARK };

    root.BB = root.BB || {};
    root.BB.RosterBar = RosterBar;
    if (typeof module !== 'undefined' && module.exports) module.exports = RosterBar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
