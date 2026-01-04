/**
 * Ids for the records the stores mint: a prefix naming the kind, the time in
 * base 36, and a counter.
 *
 * Ids were `Date.now().toString()`, so two records made in the same
 * millisecond — a highlight made and then extended, a topic and its first
 * channel — collided and the second overwrote the first. The counter makes
 * that impossible within one page, and keeps ids sortable by creation.
 *
 * Six stores kept a copy of this. Five wrote the counter unpadded, so the
 * point where the time ended and the counter began was a guess; it is two
 * digits wide now, as the checkpoint ids always were.
 */
(function (root) {
    'use strict';

    let counter = 0;

    function next(prefix) {
        counter = (counter + 1) % 1296; // 36 × 36: two base-36 digits
        return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}`;
    }

    const Ids = { next };

    root.BB = root.BB || {};
    root.BB.Ids = Ids;
    if (typeof module !== 'undefined' && module.exports) module.exports = Ids;
})(typeof globalThis !== 'undefined' ? globalThis : this);
