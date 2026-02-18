/**
 * The dashboard's Roster panel, one per site: read your list off the site into
 * a text file, and feed a text file back in to follow or join what it names.
 *
 * The two directions are not the same weight of thing and the panel does not
 * pretend they are. Reading is free — it looks at pages you can already see and
 * changes nothing — so it is one button. Applying acts on your account at the
 * site's sufferance, so it is a file, then a sentence saying exactly how long
 * it will take and how many days that is, and only then a button. Nobody should
 * discover they have started a nine-day job.
 *
 * Neither direction happens here. Both are jobs written to storage and carried
 * out by src/content/roster.js on the site's own pages; this panel opens the
 * tab, watches the job and can stop it. That split is not incidental: a job
 * that advances by navigating cannot live in the page that started it.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Roster, Settings, Dom, Ui } = BB;

    const esc = (text) => Dom.escapeHtml(text);

    function ageText(ms) {
        if (!ms) return 'never';
        const mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} min ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    }

    /** What reading does on each site, said before it is started. */
    const READ_HOW = {
        twitter: 'Opens your following list on x.com. Scroll it to the end and press Done on the bar there — ' +
            'Bell Bearer reads what you scroll past and scrolls nothing itself.',
        reddit: 'Opens old Reddit\'s list of your subreddits in a new tab and pages through it, a few seconds a page.',
    };

    function mountPanel(host, site) {
        const rules = Roster.siteOf(site);
        if (!rules) return { reload: () => {} };

        /** The file the user picked, parsed — held here, never in storage. */
        let staged = null;
        let roster = null;
        let job = null;

        host.innerHTML = `
            <div class="subscriptions-header">
                <h2>Roster</h2>
            </div>
            <p class="roster-lead">Your ${esc(rules.many)} on ${esc(rules.host)}, as a plain text file —
               read off ${esc(rules.name)}'s own pages, one name per line. Nothing is sent anywhere and no
               API or token is involved. Bell Bearer never presses ${esc(rules.verb)} for you, and
               never scrolls or clicks ${esc(rules.name)} itself: it opens each page in turn and rings
               the button, and the press is yours.</p>

            <div class="roster-cards">
                <div class="roster-card" data-roster-read>
                    <h3 class="bb-title">Read my list</h3>
                    <p class="roster-note"></p>
                    <div class="roster-acts">
                        <button class="btn-primary" data-act="read">Read from ${esc(rules.host)}</button>
                        <button class="btn-secondary" data-act="download" disabled>Download .txt</button>
                    </div>
                    <p class="roster-small">${esc(READ_HOW[site])}</p>
                </div>

                <div class="roster-card" data-roster-apply>
                    <h3 class="bb-title">${esc(rules.verb)} from a list</h3>
                    <p class="roster-note">Pick a .txt with one name per line.</p>
                    <div class="roster-acts">
                        <label class="btn-secondary roster-file">
                            Choose a file&hellip;
                            <input type="file" accept=".txt,text/plain" hidden>
                        </label>
                        <button class="btn-primary" data-act="apply" disabled>${esc(rules.verb)} them</button>
                    </div>
                    <p class="roster-small roster-plan"></p>
                </div>
            </div>

            <div class="roster-job" hidden>
                <div class="roster-job-head">
                    <span class="roster-job-what"></span>
                    <span class="roster-job-count"></span>
                </div>
                <div class="limit-bar"><span style="width:0%"></span></div>
                <p class="roster-job-note"></p>
                <div class="roster-acts">
                    <button class="btn-secondary" data-act="save" hidden>Save what was read</button>
                    <button class="btn-secondary" data-act="resume" hidden>Carry on</button>
                    <button class="btn-secondary" data-act="skip" hidden></button>
                    <button class="btn-secondary btn-danger" data-act="stop">Stop</button>
                </div>
                <p class="roster-small roster-job-foot"></p>
            </div>`;

        const readNote = host.querySelector('[data-roster-read] .roster-note');
        const download = host.querySelector('[data-act="download"]');
        const file = host.querySelector('.roster-file input');
        const applyBtn = host.querySelector('[data-act="apply"]');
        const planNote = host.querySelector('.roster-plan');
        const panel = host.querySelector('.roster-job');

        /** Where one name's page is. Mirrors pageFor in src/content/roster.js. */
        const pageFor = (name) => (site === 'twitter' ? `https://x.com/${name}` : `https://old.reddit.com/r/${name}/`);

        const open = async (url) => {
            try { await chrome.tabs.create({ url, active: true }); } catch (_) { Ui.toast(`Open ${url} yourself and it carries on there`, 'info'); }
        };

        // ------------------------------------------------------- drawing

        /**
         * Drawn again every few seconds while a job runs, as well as on every
         * write to it: a closed tab writes nothing, and the panel would never
         * learn that nobody is working on the job.
         */
        let tick = 0;

        function render() {
            clearTimeout(tick);
            const names = (roster && roster.names) || [];
            readNote.textContent = names.length
                ? `${names.length} ${names.length === 1 ? rules.one : rules.many}, read ${ageText(roster.readAt)}.`
                : `Nothing read yet.`;
            download.disabled = !names.length;

            const ours = job && job.site === site ? job : null;
            panel.hidden = !ours;
            if (!ours) return;

            const total = ours.action === 'apply' ? ours.names.length : 0;
            panel.querySelector('.roster-job-what').textContent = ours.action === 'read'
                ? `Reading your ${rules.many}`
                : `${rules.verb}ing — ${ours.at} of ${total}`;
            panel.querySelector('.roster-job-count').textContent = ours.action === 'apply'
                ? `${ours.done} ${rules.verbed.toLowerCase()}, ${ours.skipped} already there` +
                  (ours.passed ? `, ${ours.passed} skipped` : '')
                : `${(ours.found || []).length} so far`;
            panel.querySelector('.limit-bar span').style.width = `${Roster.progress(ours)}%`;
            const idle = Roster.isIdle(ours);
            const spent = ours.status === 'waiting' && Roster.atCap(ours);
            panel.querySelector('.roster-job-note').textContent = ours.note ||
                (ours.status !== 'running' ? ''
                    : idle ? `No ${rules.host} tab is working on this.`
                        : ours.action === 'apply' ? `On the ${rules.host} tab, waiting for you to press ${rules.verb}.`
                            : `Running on the ${rules.host} tab.`);
            panel.querySelector('.limit-bar').classList.toggle('is-spent', ours.status === 'paused');

            // Carry on is for a job that stopped on something, one whose cap
            // was yesterday's, and one no tab is working on. A job moves only
            // on its own page now, which makes the third the common one: its
            // tab was closed, and nothing else will open the page again.
            // Not for one whose cap is today's — that would only walk it into
            // the same halt.
            panel.querySelector('[data-act="resume"]').hidden =
                !(ours.status === 'paused' || (ours.status === 'waiting' && !spent) || idle);
            // A name the site will not show — the tab was sent somewhere
            // else — stops the job, and passing over it is the user's call.
            const name = Roster.currentName(ours);
            const skip = panel.querySelector('[data-act="skip"]');
            skip.hidden = !(ours.status === 'paused' && name);
            skip.textContent = `Skip ${rules.prefix}${name}`;
            // A read keeps what it has found on the job, so a tab closed
            // before Done has not thrown it away.
            panel.querySelector('[data-act="save"]').hidden = ours.action !== 'read' || !(ours.found || []).length;
            panel.querySelector('[data-act="stop"]').textContent =
                Roster.isRunning(ours) ? 'Stop' : 'Clear';
            panel.querySelector('.roster-job-foot').textContent = spent
                ? `That is today's ${rules.pace.cap}. Carry on from here tomorrow.`
                : '';
            if (ours.status === 'running') tick = setTimeout(render, 10000);
        }

        // ------------------------------------------------------- actions

        /**
         * Start a job and open the tab that will run it.
         *
         * The tab is opened active on purpose. Both jobs need you on it — to
         * scroll the list, to press the button — and a browser throttles
         * timers in a tab nobody is looking at.
         */
        async function start(action, names) {
            if (Roster.isRunning(job)) {
                Ui.toast('A job is already running — stop it first', 'warning');
                return;
            }
            const next = Roster.newJob({ site, action, names });
            await Roster.saveJob(next);
            job = next;
            render();
            await open(action === 'read' ? BB.RosterStart[site] : pageFor(names[0]));
        }

        host.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-act]');
            if (!button) return;

            switch (button.dataset.act) {
                case 'read':
                    await start('read', []);
                    break;

                case 'download': {
                    const names = (roster && roster.names) || [];
                    Ui.saveText(Roster.toText(site, names, roster.readAt), Roster.fileName(site));
                    break;
                }

                case 'apply':
                    if (!staged || !staged.length) return;
                    await start('apply', staged);
                    break;

                case 'save': {
                    const names = (job && job.action === 'read' && job.found) || [];
                    if (!names.length) return;
                    await Roster.saveRoster(site, names);
                    await Roster.clearJob();
                    job = null;
                    render();
                    Ui.toast(`Saved ${names.length} ${names.length === 1 ? rules.one : rules.many}`, 'success');
                    break;
                }

                case 'stop':
                    await Roster.clearJob();
                    job = null;
                    render();
                    Ui.toast('Stopped. What was done stays done.', 'info');
                    break;

                case 'resume':
                case 'skip': {
                    // kickedAt: the tab opened below may not be the job's own
                    // page yet, and only just after this may one take it up.
                    const passing = button.dataset.act === 'skip';
                    const next = await Roster.updateJob((current) => (current && current.site === site
                        ? {
                            ...Roster.release(current), status: 'running', note: '', kickedAt: Date.now(),
                            ...(passing ? { at: current.at + 1, passed: (current.passed || 0) + 1 } : {}),
                        }
                        : current));
                    if (!next || next.site !== site) break;
                    if (next.action === 'read') await open(BB.RosterStart[site]);
                    else if (Roster.currentName(next)) await open(pageFor(Roster.currentName(next)));
                    // Skipped past the last name: nothing is left to open.
                    else await Roster.updateJob((current) => (current ? { ...current, status: 'done', note: 'Skipped the last one' } : current));
                    break;
                }

                default:
                    break;
            }
        });

        /**
         * A file becomes a plan, not a job. The count, the pace and the number
         * of days are said out loud before the button that starts it is
         * enabled — a four-hundred name list is eleven days of Twitter's cap,
         * and that is not something to find out on day three.
         */
        file.addEventListener('change', async () => {
            const picked = file.files && file.files[0];
            if (!picked) return;
            const text = await picked.text();
            staged = Roster.parseList(text, site);

            if (!staged.length) {
                planNote.textContent = 'Nothing in that file parsed as a name.';
                applyBtn.disabled = true;
                return;
            }

            planNote.textContent = Roster.planText(site, staged, (roster && roster.names) || []);
            applyBtn.disabled = false;
        });

        async function reload() {
            const [rosters, current] = await Promise.all([Roster.loadRosters(), Roster.loadJob()]);
            roster = rosters[site] || null;
            job = current;
            render();
        }

        return { reload };
    }

    /** Where a read job starts. Mirrors START in src/content/roster.js. */
    BB.RosterStart = Object.freeze({
        twitter: 'https://x.com/home',
        reddit: 'https://old.reddit.com/subreddits/mine/subscriber/?limit=100',
    });

    /** Draw every `[data-roster]` panel under `scope` and keep it current. */
    function mountAll(scope = document) {
        const hosts = Array.from(scope.querySelectorAll('[data-roster]'));
        if (!hosts.length) return;

        const panels = hosts.map((host) => {
            const panel = mountPanel(host, host.dataset.roster);
            panel.reload();
            return panel;
        });

        // The job is advanced by a content script in another tab, so the only
        // way this panel knows anything is by following the store.
        Settings.watch([Roster.JOB_KEY, Roster.ROSTERS_KEY], () => panels.forEach((p) => p.reload()));
    }

    BB.RosterView = { mountAll, mountPanel, ageText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
