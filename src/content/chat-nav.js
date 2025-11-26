/**
 * Moving a chat page to a turn: the outline's jump, the previous and next
 * prompt, and landing on a pin.
 *
 * The one assumption everything here makes is that the thread is
 * virtualised. claude.ai mounts only the turns near the viewport, and
 * chatgpt.com has started to — a turn forty prompts up is often not in the
 * document at all, so "find its element and scroll to it" fails exactly when
 * it matters. reach() instead scrolls the thread's own scroller to where the
 * turn should be, waits for the page to mount what is there, looks again, and
 * corrects from where the mounted turns actually are. It gives up after a few
 * rounds rather than scrolling for ever.
 *
 * The arithmetic is pure and node-tested (estimateTop, pickNeighbour); the
 * rest needs a page.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ChatTree = ns.ChatTree || req('../shared/chat-tree.js');
    const ScrollTo = ns.ScrollTo || req('./scroll-to.js');

    const PULSE_ID = 'bb-chat-pulse';
    /** Rounds of scroll-and-look before reach() says it could not. */
    const ROUNDS = 6;
    /** How long a round waits for the page to mount what it scrolled to. */
    const SETTLE_MS = 180;
    /** Room left above a turn once landed, below whatever the site pins over the thread. */
    const MARGIN = 12;

    /**
     * Where the turn at `index` of `total` should be, in the scroller's own
     * coordinates.
     *
     * With turns mounted, from the nearest one: its top, plus the average
     * height of what is mounted for every turn between. Turns vary wildly in
     * height — a one-line prompt, a two-thousand-word answer — so this is an
     * estimate, which is why reach() looks again once it has moved. With
     * nothing mounted, the turn's share of the whole scroll height.
     */
    function estimateTop({ index, total, scrollHeight, mounted = [] }) {
        if (!mounted.length) return total > 0 ? Math.round((index / total) * scrollHeight) : 0;
        const sorted = mounted.slice().sort((a, b) => a.index - b.index);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const span = last.index - first.index + 1;
        const average = Math.max(40, (last.top + last.height - first.top) / span);
        const nearest = sorted.reduce((best, turn) =>
            (Math.abs(turn.index - index) < Math.abs(best.index - index) ? turn : best));
        return Math.max(0, Math.round(nearest.top + (index - nearest.index) * average));
    }

    /**
     * The prompt to go to next (`direction` 1) or back to (-1), or null.
     *
     * `mounted` is the turns on the page with their tops relative to the
     * reading line. A mounted prompt past the line is the answer when there
     * is one; otherwise the path is asked for the prompt beyond the furthest
     * turn mounted in that direction, which is what makes this work on a
     * thread that only mounts a screenful.
     */
    function pickNeighbour({ prompts, path, mounted, direction, slack = 8 }) {
        const promptSet = new Set(prompts);
        const seen = mounted.filter((turn) => path.includes(turn.id));
        const onPage = seen.filter((turn) => promptSet.has(turn.id))
            .filter((turn) => (direction > 0 ? turn.top > slack : turn.top < -slack))
            .sort((a, b) => (direction > 0 ? a.top - b.top : b.top - a.top));
        if (onPage.length) return onPage[0].id;

        if (!seen.length) return direction > 0 ? prompts[0] || null : null;
        const indexes = seen.map((turn) => path.indexOf(turn.id));
        const edge = direction > 0 ? Math.max(...indexes) : Math.min(...indexes);
        const beyond = direction > 0 ? path.slice(edge + 1) : path.slice(0, edge).reverse();
        return beyond.find((id) => promptSet.has(id)) || null;
    }

    const settle = (ms = SETTLE_MS) => new Promise((done) => setTimeout(done, ms));

    /** The element on the page that draws `nodeId`, if it is mounted. */
    function mountedTurn(adapter, conv, nodeId) {
        return adapter.turnElements().find((element) => adapter.turnIds(element, conv).includes(nodeId)) || null;
    }

    /** Every mounted turn on the path, with its top relative to `line`. */
    function mountedTurns(adapter, conv, line = 0) {
        const out = [];
        for (const element of adapter.turnElements()) {
            const rect = element.getBoundingClientRect();
            for (const id of adapter.turnIds(element, conv)) out.push({ id, element, top: rect.top - line, height: rect.height });
        }
        return out;
    }

    /** Where a landed turn's top comes to rest, in viewport pixels. */
    function readingLine(adapter) {
        const scroller = adapter.scroller();
        const top = scroller ? scroller.getBoundingClientRect().top : 0;
        return Math.max(top, adapter.headerBottom()) + MARGIN;
    }

    function pulse() {
        let element = document.getElementById(PULSE_ID);
        if (!element) {
            element = document.createElement('div');
            element.id = PULSE_ID;
            element.className = 'bb-chat-pulse';
            element.hidden = true;
            document.documentElement.appendChild(element);
            // Dressed so it rings in the skin's accent. Looked up when first
            // drawn rather than at load: theme.js may not be there in a spec.
            const Theme = ns.Theme || root.BB.Theme;
            if (Theme) Theme.appearance().then((look) => Theme.dress(element, look));
        }
        return element;
    }

    /** A heading inside a turn, by its text, whitespace and markup aside. */
    function headingIn(element, text) {
        const want = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!want) return null;
        return Array.from(element.querySelectorAll('h1, h2, h3'))
            .find((h) => h.textContent.replace(/\s+/g, ' ').trim().toLowerCase() === want) || null;
    }

    function land(adapter, element, heading) {
        const target = headingIn(element, heading) || element;
        const scroller = adapter.scroller() || ScrollTo.innerScroller(target);
        if (scroller) {
            const offset = readingLine(adapter) - scroller.getBoundingClientRect().top;
            ScrollTo.bring(scroller, target.getBoundingClientRect(), offset);
        } else {
            target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
        ScrollTo.markArrival(pulse(), () => target.getBoundingClientRect());
    }

    /**
     * Bring `nodeId` into view and mark it. Resolves true once it is there,
     * false when it is not on the path shown or could not be found in time.
     */
    async function reach(adapter, conv, nodeId, { heading = '', rounds = ROUNDS, wait = settle } = {}) {
        const path = ChatTree.activePath(conv);
        const index = path.indexOf(nodeId);
        if (index < 0) return false;

        for (let round = 0; round <= rounds; round++) {
            const element = mountedTurn(adapter, conv, nodeId);
            if (element) {
                land(adapter, element, heading);
                return true;
            }
            const scroller = adapter.scroller();
            if (!scroller || round === rounds) break;
            const box = scroller.getBoundingClientRect();
            const mounted = mountedTurns(adapter, conv, box.top)
                .map((turn) => ({ index: path.indexOf(turn.id), top: turn.top + scroller.scrollTop, height: turn.height }))
                .filter((turn) => turn.index >= 0);
            scroller.scrollTo({ top: estimateTop({ index, total: path.length, scrollHeight: scroller.scrollHeight, mounted }) });
            await wait();
        }
        return false;
    }

    /** The prompt after (1) or before (-1) the one being read, reached. */
    function step(adapter, conv, direction) {
        const path = ChatTree.activePath(conv);
        const prompts = path.filter((id) => conv.nodes[id].role === 'user');
        const mounted = mountedTurns(adapter, conv, readingLine(adapter));
        const target = pickNeighbour({ prompts, path, mounted, direction });
        return target ? reach(adapter, conv, target) : Promise.resolve(false);
    }

    /**
     * The turn being read, and the heading within it: the last of each whose
     * top is above the reading line. What the outline marks as current.
     */
    function current(adapter, conv) {
        const line = readingLine(adapter) + 40;
        const above = mountedTurns(adapter, conv, line).filter((turn) => turn.top <= 0);
        const turn = above.length ? above.reduce((a, b) => (b.top > a.top ? b : a)) : null;
        if (!turn) return null;
        const headings = Array.from(turn.element.querySelectorAll('h1, h2, h3'))
            .filter((h) => h.getBoundingClientRect().top - line <= 0);
        const heading = headings.length ? headings[headings.length - 1].textContent.replace(/\s+/g, ' ').trim() : '';
        return { id: turn.id, heading };
    }

    // ---------------------------------------------------------- switching

    /** The conversation as the page shows it down to `id`, whatever the server last said. */
    const showing = (conv, id) => ({ ...conv, current: id });

    /** The mounted turn drawing any of `ids` — a fork's children, of which the page shows one. */
    function mountedAny(adapter, conv, ids) {
        return adapter.turnElements().find((element) =>
            adapter.turnIds(element, conv).some((id) => ids.includes(id))) || null;
    }

    async function until(check, { ms = 3000, every = 50 } = {}) {
        const started = Date.now();
        for (;;) {
            const value = check();
            if (value) return value;
            if (Date.now() - started > ms) return null;
            await settle(every);
        }
    }

    /**
     * Make the page show `target`, by clicking its own `< k/n >` arrows.
     *
     * The walk goes down the target's path, top to bottom. At each fork on
     * it: bring the fork into view, read the page's count off the child it
     * shows, click prev or next the difference, and wait until the count has
     * moved before the next click — the page re-renders the turn under the
     * pointer and a click on the old element does nothing. Then the next
     * fork down. Nothing between two forks can differ, so reaching each fork
     * by its place on the target's own path is right however the page has
     * been switched above it.
     *
     * A count that disagrees with the tree means the tree is stale: the
     * result says so and the caller refetches and asks again. Anything else
     * unexpected stops the walk where it is and says why. It never guesses.
     *
     * Resolves { ok: true } or { ok: false, stale?, reason }.
     */
    async function switchTo(adapter, conv, target, { wait = settle } = {}) {
        const path = ChatTree.pathTo(conv, target);
        if (!path.length) return { ok: false, reason: 'That turn is not in this conversation.' };
        // Turns are told apart against the target's own path, not the one
        // the tree last said was shown: halfway through a switch the page is
        // on neither. A site that ties a row to the tree by its place on the
        // path (claude.ai) would otherwise be looking at the wrong path.
        const view = showing(conv, target);

        for (const id of path) {
            const turn = ChatTree.node(conv, id);
            const parent = ChatTree.node(conv, turn.parent);
            if (!parent || parent.children.length < 2) continue;

            // The fork: bring its parent into view, and the child the page
            // shows under it comes with it.
            if (parent.role === 'root') {
                const scroller = adapter.scroller();
                if (scroller) scroller.scrollTo({ top: 0 });
                await wait();
            } else if (!(await reach(adapter, showing(conv, parent.id), parent.id, { wait }))) {
                return { ok: false, reason: 'Could not bring that branch point into view.' };
            }

            const find = () => {
                const element = mountedAny(adapter, view, parent.children);
                if (element && adapter.revealSiblingNav) adapter.revealSiblingNav(element);
                return element && adapter.siblingNav(element);
            };
            let nav = await until(find, { ms: 1500 });
            if (!nav) return { ok: false, reason: 'The page is not showing its arrows at that branch point.' };
            if (nav.count !== parent.children.length) return { ok: false, stale: true, reason: 'The page has branches the panel has not seen yet.' };

            const want = ChatTree.siblingIndex(conv, id).index;
            while (nav.index !== want) {
                const from = nav.index;
                (want < from ? nav.prev : nav.next).click();
                nav = await until(() => {
                    const now = find();
                    return now && now.index !== from ? now : null;
                });
                if (!nav) return { ok: false, reason: 'The page did not move when its arrow was clicked.' };
            }
        }

        await reach(adapter, showing(conv, target), target, { wait });
        return { ok: true };
    }

    /**
     * The turn the page is showing that the tree says is not on its path, if
     * there is one — which is what it looks like when someone has used the
     * site's own arrows. The deepest such turn, so the whole switched branch
     * is followed rather than its first step.
     */
    function strayTurn(adapter, conv) {
        const onPath = new Set(ChatTree.activePath(conv));
        let stray = null;
        for (const element of adapter.turnElements()) {
            for (const id of adapter.turnIds(element, conv)) if (!onPath.has(id)) stray = id;
        }
        return stray;
    }

    const ChatNav = {
        estimateTop, pickNeighbour, reach, step, current, mountedTurn, readingLine, headingIn, switchTo, strayTurn, PULSE_ID,
    };

    root.BB = root.BB || {};
    root.BB.ChatNav = ChatNav;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatNav;
})(typeof globalThis !== 'undefined' ? globalThis : this);
