/**
 * The Roster panel in the toolbar popup, on x.com and reddit.com: read your
 * list off the site into a text file, and follow or join what a file names.
 *
 * In the popup, and not in the dashboard where it began, because of where the
 * work is done. Both jobs run on the site's own pages, in a tab, and the
 * dashboard could only write a job to storage and open a tab in the hope that
 * it would pick the job up. When it could not — a tab still running the
 * content script from before an update, as it turned out — the job sat there
 * "running", with no tab working on it and nothing to say why. The popup opens
 * over the tab that will do the work and asks that tab directly, so a tab that
 * cannot is silence heard at once, and no job is written for nobody.
 *
 * So nothing here starts a job. Each button that needs the page asks it — to
 * read, to pick a list, to carry on — and the popup closes, because what
 * happens next is on the page's own bar (src/content/roster-bar.js). What
 * needs no page is done here: the file is written, a job is stopped.
 *
 * Built the way src/page/leet-popup.js is: a factory taking the element to
 * draw into, rendering wholesale, and dispatching clicks by delegation.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Roster, Dom, Ui } = BB;

    const esc = Dom.escapeHtml;

    function ageText(ms, now = Date.now()) {
        if (!ms) return 'never';
        const mins = Math.round((now - ms) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} min ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    }

    /** What each site's two buttons do, in the one line there is room for. */
    const HOW = {
        twitter: 'Read opens your following list in this tab: scroll it to the end and press Done on the bar there. ' +
            'Following is your own press on each profile\'s button — Bell Bearer never scrolls, follows or clicks for you.',
        reddit: 'Read pages through old Reddit\'s list of your subreddits in this tab. ' +
            'Joining is your own press on each subreddit\'s button — Bell Bearer never joins or clicks for you.',
    };

    /** Said when the tab does not answer: there is no content script in it to ask. */
    const NO_ANSWER = 'Reload this tab first — Bell Bearer is not running in it yet. ' +
        'If you have just updated Bell Bearer, reload it on the extensions page as well.';

    /**
     * @param {object} options
     * @param {HTMLElement} options.body where the panel draws
     * @param {string} options.site 'twitter' | 'reddit', the site in the active tab
     * @param {(kind: string) => Promise<object|null>} options.ask  asks the tab for
     *   `kind` — read, pick, resume, skip; null when nothing in it answers
     * @param {() => void} [options.close] closes the popup, once the page has it
     */
    function createView({ body, site, ask, close = () => root.close() }) {
        const rules = Roster.siteOf(site);
        let roster = null;
        let job = null;

        function jobHtml() {
            if (!job) return '';
            const theirs = Roster.siteOf(job.site) || rules;
            const here = job.site === site;
            const total = job.action === 'apply' ? job.names.length : 0;
            const what = job.status === 'done'
                ? (job.action === 'read' ? `Read your ${theirs.many}` : `${theirs.verbed} from the list`)
                : job.action === 'read' ? `Reading your ${theirs.many}` : `${theirs.verb}ing — ${job.at} of ${total}`;
            const count = job.action === 'apply'
                ? `${job.done} ${theirs.verbed.toLowerCase()}, ${job.skipped} already there` + (job.passed ? `, ${job.passed} skipped` : '')
                : `${(job.found || []).length} so far`;

            const idle = Roster.isIdle(job);
            const spent = job.status === 'waiting' && Roster.atCap(job);
            const note = job.note || (spent ? `That is today's ${theirs.pace.cap}. Carry on tomorrow.`
                : job.status !== 'running' ? ''
                    : idle ? 'No tab is working on this.'
                        : job.action === 'apply' ? `Waiting on its tab for you to press ${theirs.verb}.` : 'Running in its tab.');

            // Carry on and Skip are asked of a tab of the job's own site,
            // which this one may not be.
            const name = Roster.currentName(job);
            const resumable = job.status === 'paused' || (job.status === 'waiting' && !spent) || idle;
            const canResume = here && resumable;
            const canSkip = here && job.status === 'paused' && !!name;
            const canSave = job.action === 'read' && (job.found || []).length > 0;
            return `
                <div class="roster-pop-job${job.status === 'paused' ? ' is-stopped' : ''}">
                    <div class="roster-pop-what">${here ? '' : `${esc(theirs.name)}: `}${esc(what)}<span>${esc(count)}</span></div>
                    ${note ? `<p class="roster-pop-note">${esc(note)}</p>` : ''}
                    ${!here && resumable ? `<p class="roster-pop-note">Open ${esc(theirs.host)} to carry it on.</p>` : ''}
                    <div class="roster-pop-acts">
                        ${canResume ? '<button class="btn-reader" data-act="resume">Carry on here</button>' : ''}
                        ${canSkip ? `<button class="btn-party-join" data-act="skip">Skip ${esc(theirs.prefix + name)}</button>` : ''}
                        ${canSave ? '<button class="btn-party-join" data-act="save">Save what was read</button>' : ''}
                        <button class="btn-party-join" data-act="stop">${Roster.isRunning(job) ? 'Stop' : 'Clear'}</button>
                    </div>
                </div>`;
        }

        function paint() {
            if (!body || !rules) return;
            const names = (roster && roster.names) || [];
            const busy = Roster.isOpen(job);
            body.innerHTML = `
                <div class="roster-pop-head">
                    <span class="roster-pop-title">Your ${esc(rules.many)}</span>
                    <span class="roster-pop-when">${names.length
                        ? `${names.length}, read ${esc(ageText(roster.readAt))}`
                        : 'nothing read yet'}</span>
                </div>
                <div class="roster-pop-acts">
                    <button class="btn-reader" data-act="read"${busy ? ' disabled' : ''}>Read my list</button>
                    <button class="btn-party-join" data-act="download"${names.length ? '' : ' disabled'}>Download .txt</button>
                    <button class="btn-party-join" data-act="pick"${busy ? ' disabled' : ''}>${esc(rules.verb)} from a list…</button>
                </div>
                <p class="roster-pop-how">${esc(HOW[site])}</p>
                ${jobHtml()}`;
        }

        /** Ask the tab, and close over it when it has taken the work. */
        async function hand(kind) {
            const answer = await ask(kind);
            if (answer && answer.ok) return close();
            return Ui.toast(NO_ANSWER, 'error');
        }

        async function act(kind) {
            switch (kind) {
                case 'read':
                case 'pick':
                case 'resume':
                case 'skip':
                    return hand(kind);

                case 'download': {
                    const names = (roster && roster.names) || [];
                    if (names.length) Ui.saveText(Roster.toText(site, names, roster.readAt), Roster.fileName(site));
                    return null;
                }

                case 'save': {
                    const found = (job && job.action === 'read' && job.found) || [];
                    if (!found.length) return null;
                    await Roster.saveRoster(job.site, found);
                    await Roster.clearJob();
                    return reload();
                }

                case 'stop':
                    await Roster.clearJob();
                    return reload();

                default:
                    return null;
            }
        }

        if (body) {
            body.addEventListener('click', (event) => {
                const button = event.target.closest('[data-act]');
                if (button && !button.disabled) act(button.dataset.act);
            });
        }

        async function reload() {
            const [rosters, current] = await Promise.all([Roster.loadRosters(), Roster.loadJob()]);
            roster = rosters[site] || null;
            job = current;
            paint();
        }

        return { render: reload };
    }

    BB.RosterPopup = { createView, ageText, NO_ANSWER };
})(typeof globalThis !== 'undefined' ? globalThis : this);
