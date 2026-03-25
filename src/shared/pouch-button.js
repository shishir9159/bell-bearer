/**
 * The pouch button, in one place.
 *
 * It started as three lines inside youtube-ui.js — build a <button>, set the
 * icon, toggle a class when the channel is filed. Then X wanted the same
 * button on a post and on a profile header, and the glyph, the filed state and
 * the wording would have been copied into a second file and drifted from the
 * first the next time either was touched. So it lives here now, and a site
 * supplies only what is genuinely its own: where the button goes and what it
 * sits next to.
 *
 * The glyph is the same on every site on purpose — it is the one mark that
 * says the button belongs to Bell Bearer rather than to the page around it.
 * The wording is not: YouTube has room for a tooltip that says "pouch", and on
 * X the button sits in a row of unlabelled icons beside Reply and Repost, so
 * it is drawn as one of those and never writes the word.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const Icons = (root.BB && root.BB.Icons) || req('./icons.js');

    /**
     * The mark. Sized by CSS, which outranks the attribute, because the same
     * glyph is a 24px icon in YouTube's subscribe row and a 17px one in X's
     * action row, and a hard-coded width there would have to be undone twice.
     */
    const ICON = Icons.svg('list-plus', { cls: 'bb-pouch-glyph' });

    /**
     * The filed state. YouTube turns its own Subscribe button into a flat grey
     * "Subscribed" pill once you are subscribed and our button sits right next
     * to it, so a filed thing gets the same treatment — a tick, on the same
     * grey — rather than going on offering a "+" for something already done.
     * X's bookmark button does the same thing with a filled glyph, so the tick
     * reads correctly there too.
     *
     * Only the "+" turns into the tick; the list's bars stay put. A bare
     * `check` in its place swapped the whole mark for a different one, and
     * Phosphor has no list with a tick at its foot (`list-checks` puts one
     * before every bar). So this is list-plus with its last subpath, the plus,
     * traded for a tick drawn the way Phosphor draws `check` — a 16-unit
     * stroke, 8-unit round ends — in the plus's own 64-unit box, so the mark
     * keeps its size when it flips.
     */
    const PLUS = /m88,0H216V168[^Z]*Z/;
    const CHECK = 'M237.66,180.66l-34,34a8,8,0,0,1-11.32,0l-14-14a8,8,0,0,1,11.32-11.32L198,197.69l28.34-28.35a8,8,0,0,1,11.32,11.32Z';
    const TICK = ICON.replace(PLUS, CHECK);

    /** Marks a button as ours, whatever page it was injected into. */
    const CLASS = 'bb-pouch-button';

    /**
     * Build one.
     *
     * `id` is optional — YouTube has exactly one of these per page and finds
     * it by id, while X has one per post and finds them by class.
     *
     * The click handler is wrapped rather than passed straight through: both
     * sites put the button inside something of their own that is itself
     * clickable (YouTube's subscribe row, X's whole post, which navigates),
     * so the event has to stop here or filing a post also opens it.
     */
    function create({ id, className, label, filed = false, onClick } = {}) {
        const button = document.createElement('button');
        if (id) button.id = id;
        button.type = 'button';
        button.className = [CLASS, className].filter(Boolean).join(' ');
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (onClick) onClick(event);
        });
        mark(button, { filed, label });
        return button;
    }

    /**
     * Set the glyph and the labelling for a filed / not-filed state.
     *
     * Separate from create() because both sites call it again later: YouTube
     * keeps one button element across an SPA move to a different channel, and
     * X's buttons outlive a re-file from the picker. Without a second call the
     * tick stays behind on something that was never filed.
     */
    function mark(button, { filed, label }) {
        if (!button) return;
        button.classList.toggle('bb-in-pouch', !!filed);
        button.innerHTML = filed ? TICK : ICON;
        if (label) {
            button.title = label;
            button.setAttribute('aria-label', label);
        }
        button.setAttribute('aria-pressed', String(!!filed));
    }

    const PouchButton = { ICON, TICK, CLASS, create, mark };

    root.BB = root.BB || {};
    root.BB.PouchButton = PouchButton;
    if (typeof module !== 'undefined' && module.exports) module.exports = PouchButton;
})(typeof globalThis !== 'undefined' ? globalThis : this);
