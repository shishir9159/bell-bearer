/**
 * Reading a site's page through a table of selectors with several spellings
 * each.
 *
 * Every site Bell Bearer reads renames its classes and test ids without
 * notice, so each keeps a table — name → spellings, newest first — and the
 * first spelling that matches anything wins. Six files carried their own copy
 * of the three lookups over that table; some skipped a spelling the browser
 * would not parse and some threw on it, and only the chat adapters could ask
 * for the first one actually drawn.
 *
 * Do not collapse a table to one "current" spelling: see CLAUDE.md.
 */
(function (root) {
    'use strict';

    /** Drawn at all: in the layout, whatever its opacity. */
    const shown = (element) => !!element && (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0);

    /** The matches of one spelling, or null for one this browser will not parse. */
    function all(scope, selector) {
        try { return scope.querySelectorAll(selector); } catch (_) { return null; }
    }

    function table(SELECTORS) {
        /** The first element matching any spelling, in order; with `visible`, the first one drawn. */
        function find(names, scope = document, { visible = false } = {}) {
            for (const selector of SELECTORS[names] || []) {
                if (!visible) {
                    let hit = null;
                    try { hit = scope.querySelector(selector); } catch (_) { continue; }
                    if (hit) return hit;
                    continue;
                }
                for (const element of all(scope, selector) || []) if (shown(element)) return element;
            }
            return null;
        }

        /** Every element matching any spelling — the first spelling that hits wins. */
        function findAll(names, scope = document) {
            for (const selector of SELECTORS[names] || []) {
                const found = all(scope, selector);
                if (found && found.length) return Array.from(found);
            }
            return [];
        }

        /** Does `element` match, or sit inside something matching, `names`? */
        function closest(names, element) {
            for (const selector of SELECTORS[names] || []) {
                let hit = null;
                try { hit = element.closest && element.closest(selector); } catch (_) { continue; }
                if (hit) return hit;
            }
            return null;
        }

        return { find, findAll, closest };
    }

    const Selectors = { table, shown };

    root.BB = root.BB || {};
    root.BB.Selectors = Selectors;
    if (typeof module !== 'undefined' && module.exports) module.exports = Selectors;
})(typeof globalThis !== 'undefined' ? globalThis : this);
