/**
 * The popup's override: the one way past a daily limit once it has bitten.
 *
 * It is deliberately not a switch. A switch would be turned off in the moment
 * the limit is inconvenient and left off, which is the moment the limit exists
 * for — so the button grants exactly one more game of each limited control and
 * then goes back to being a button. Hitting the limit again means pressing it
 * again, which is the friction doing its job.
 *
 * It is drawn only when some site is actually blocked, so the popup carries no
 * chess furniture for anyone who has not set a limit.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Settings, ChessSites, ChessLimits, Icons } = BB;

    /** An open padlock — the same weight as the header's other controls. */
    const ICON = Icons.svg('lock-simple-open', { size: 13 });

    /** "bullet and blitz", "bullet, blitz and rapid" — for the tooltip. */
    function listNames(names) {
        if (names.length <= 1) return names[0] || '';
        return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    }

    function describe(blockedSites) {
        return blockedSites.map(({ site, status }) => {
            const spent = status.blocked.map((name) => {
                const row = status.classes[name];
                return `${name} ${row.count}/${row.allowed}`;
            });
            return `${ChessSites.get(site).name}: ${listNames(spent)}`;
        }).join(' · ');
    }

    /**
     * Wire the button up and keep it in step with the tally.
     *
     * @param {HTMLElement} button the header's hidden override button
     * @returns {{ refresh: () => Promise<void> }}
     */
    function mount(button) {
        if (!button) return { refresh: async () => {} };
        let blockedSites = [];

        async function refresh() {
            const [settings, state] = await Promise.all([Settings.get(), ChessLimits.load()]);

            blockedSites = ChessSites.list()
                .map((site) => ({ site: site.id, status: ChessLimits.statusFor(state, settings, site.id) }))
                .filter((entry) => entry.status.anyBlocked);

            button.hidden = blockedSites.length === 0;
            if (button.hidden) return;

            const total = blockedSites.reduce((sum, entry) => sum + entry.status.blocked.length, 0);
            button.innerHTML = `${ICON}<span>+1</span>`;
            button.title = `Daily limit reached — ${describe(blockedSites)}. ` +
                `Click to allow one more game of each limited control.`;
            button.setAttribute('aria-label',
                `Daily limit reached in ${total} time control${total === 1 ? '' : 's'}. Allow one more game of each.`);
        }

        button.addEventListener('click', async () => {
            if (!blockedSites.length) return;
            const settings = await Settings.get();
            const granted = blockedSites.map((entry) => entry.site);

            await ChessLimits.update((state) => granted.reduce(
                (next, siteId) => ChessLimits.withOneMore(next, siteId, settings),
                state,
            ));

            // Say what happened before it disappears: the button vanishing on
            // its own reads as a misclick.
            button.classList.add('is-granted');
            button.innerHTML = `${ICON}<span>Done</span>`;
            button.title = `One more game allowed on ${listNames(granted.map((id) => ChessSites.get(id).name))}.`;
            setTimeout(() => {
                button.classList.remove('is-granted');
                refresh();
            }, 1400);
        });

        // Another tab's game, or the worker's next read, can lift or land the
        // block while the popup is open.
        Settings.watch([ChessLimits.KEY], () => {
            if (!button.classList.contains('is-granted')) refresh();
        });

        return { refresh };
    }

    BB.ChessLimitButton = { mount, describe, listNames, ICON };
})(typeof globalThis !== 'undefined' ? globalThis : this);
