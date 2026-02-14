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

    /** 9_000_000 ms → "2h 30m", for the sentence before a job starts. */
    function spanText(ms) {
        const minutes = Math.round(ms / 60000);
        if (minutes < 60) return `${Math.max(1, minutes)} minutes`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest ? `${hours}h ${rest}m` : `${hours} hours`;
    }

    function ageText(ms) {
        if (!ms) return 'never';
        const mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} min ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    }

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
               API or token is involved: the pages are read the way you read them, and a name is
               ${esc(rules.verbing.replace(/ing$/, 'ed'))} by clicking ${esc(rules.name)}'s own
               ${esc(rules.verb)} button.</p>

            <div class="roster-cards">
                <div class="roster-card" data-roster-read>
                    <h3 class="bb-title">Read my list</h3>
                    <p class="roster-note"></p>
                    <div class="roster-acts">
                        <button class="btn-primary" data-act="read">Read from ${esc(rules.host)}</button>
                        <button class="btn-secondary" data-act="download" disabled>Download .txt</button>
                    </div>
                    <p class="roster-small">Opens ${esc(rules.host)} in a new tab and walks the list.
                       Keep that tab in front — a background tab is throttled and the walk stalls.</p>
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
                    <button class="btn-secondary" data-act="resume" hidden>Carry on</button>
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

        // ------------------------------------------------------- drawing

        function render() {
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
                ? `${ours.done} ${rules.verbing}, ${ours.skipped} already there`
                : `${(ours.found || []).length} so far`;
            panel.querySelector('.limit-bar span').style.width = `${Roster.progress(ours)}%`;
            panel.querySelector('.roster-job-note').textContent = ours.note ||
                (ours.status === 'running' ? `Running on the ${rules.host} tab.` : '');
            panel.querySelector('.limit-bar').classList.toggle('is-spent', ours.status === 'paused');

            // "Carry on" is for a job that stopped at something it did not
            // understand. Not for one waiting on tomorrow's allowance — that
            // one resumes by itself the next time the site is open, and a
            // button here would only walk it into the same halt.
            panel.querySelector('[data-act="resume"]').hidden = ours.status !== 'paused';
            panel.querySelector('[data-act="stop"]').textContent =
                Roster.isRunning(ours) ? 'Stop' : 'Clear';
            panel.querySelector('.roster-job-foot').textContent = ours.status === 'waiting'
                ? `Carries on by itself the next time ${rules.host} is open.`
                : '';
        }

        // ------------------------------------------------------- actions

        /**
         * Start a job and open the tab that will run it.
         *
         * The tab is opened active on purpose. Reading scrolls a list, applying
         * clicks a button, and a browser throttles timers and defers layout in
         * a tab nobody is looking at — so a job started quietly in the
         * background is a job that appears to hang.
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

            const url = action === 'read'
                ? BB.RosterStart[site]
                : (site === 'twitter' ? `https://x.com/${names[0]}` : `https://old.reddit.com/r/${names[0]}/`);
            try {
                await chrome.tabs.create({ url, active: true });
            } catch (_) {
                Ui.toast(`Open ${rules.host} yourself and it will carry on there`, 'info');
            }
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

                case 'stop':
                    await Roster.clearJob();
                    job = null;
                    render();
                    Ui.toast('Stopped. What was done stays done.', 'info');
                    break;

                case 'resume':
                    // kickedAt: the tab opened below may not be the job's own
                    // page yet, and only just after this may one take it up.
                    await Roster.updateJob((current) => (current
                        ? { ...current, status: 'running', note: '', leaseBy: '', leaseUntil: 0, kickedAt: Date.now() }
                        : current));
                    if (job) {
                        const name = Roster.currentName(job);
                        const url = job.action === 'read'
                            ? BB.RosterStart[site]
                            : (site === 'twitter' ? `https://x.com/${name}` : `https://old.reddit.com/r/${name}/`);
                        try { await chrome.tabs.create({ url, active: true }); } catch (_) { /* opened by hand */ }
                    }
                    break;

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

            const plan = Roster.plan(site, staged);
            const already = new Set(((roster && roster.names) || []).map((n) => n.toLowerCase()));
            const fresh = staged.filter((name) => !already.has(name.toLowerCase())).length;

            planNote.textContent = `${plan.total} ${plan.total === 1 ? rules.one : rules.many}` +
                (already.size ? `, ${fresh} not in your last read` : '') +
                `. ${rules.name} gets ${plan.cap} a day at ${Math.round(rules.pace.minMs / 1000)}–` +
                `${Math.round(rules.pace.maxMs / 1000)} seconds apart, so about ${spanText(plan.perDayMs)} ` +
                `today and ${plan.days} ${plan.days === 1 ? 'day' : 'days'} in all. ` +
                `Anything already there is skipped and costs nothing.`;
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

    BB.RosterView = { mountAll, mountPanel, spanText, ageText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
