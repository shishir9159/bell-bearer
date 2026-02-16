/**
 * Your own roster on a site — the accounts you follow on Twitter, the
 * subreddits you have joined — read off the site's own pages into a text file,
 * and read back in to follow or join what the file lists.
 *
 * Two jobs, and they are not symmetrical:
 *
 *   read   write down the names on a list the site is already showing you —
 *          Twitter's as you scroll it, old Reddit's a page at a time. Nothing
 *          is sent anywhere and nothing is changed.
 *
 *   apply  open each name's page in turn, ring the site's own Follow or Join
 *          button, and wait for the user to press it. This one acts on your
 *          account, by your hand, which is why almost everything below is
 *          about going slowly: PACE per site, a hard cap per day, a jittered
 *          gap between two follows, and a job that stops at the first thing
 *          it does not understand rather than pressing on.
 *
 * Nothing here touches an API, a token or an endpoint, and nothing presses a
 * button or scrolls a page for you. Both jobs once did, and X's automation
 * rules name scripting its website as a reason to suspend an account; a click
 * made by a script is also not a click the site sees a person make. What is
 * left — reading the page, and opening the next one — is what a person does
 * with a list beside them. PACE is not tuned for throughput either: X does
 * not document where following gets an account locked, and the way to stay
 * clear of that edge is to stay a long way clear of it rather than to find it.
 *
 * The job lives in storage rather than in the page, because applying a list
 * *is* a sequence of navigations — each name is another page load, which ends
 * the script that started it. Storage is what makes the job resumable: the
 * job's page picks it up, does one thing, writes down that it did, and moves
 * on.
 *
 * Everything above the "storage" line is pure and covered by
 * tests/node-check.js.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Store = ns.Store || req('./store.js');
    const Time = ns.Time || req('./time.js');

    const ROSTERS_KEY = Settings.DATA.rosters;
    const JOB_KEY = Settings.DATA.rosterJob;

    /**
     * The two sites with a roster worth keeping, and how fast each may be
     * worked through.
     *
     * `pace.cap` is a day's worth of actions and `minMs`/`maxMs` the gap
     * between two. Twitter's are deliberately slower and its cap far lower:
     * Reddit rate-limits an account and says so, Twitter suspends one and does
     * not, and the two deserve different amounts of caution. Forty follows a
     * day at forty seconds apart is a slow afternoon of clicking, which is the
     * point — it is a pace a person plausibly worked at.
     */
    const SITES = Object.freeze({
        twitter: Object.freeze({
            id: 'twitter',
            name: 'Twitter',
            host: 'x.com',
            one: 'account',
            many: 'accounts',
            /** How a name is written when shown, and what it is stored as. */
            prefix: '@',
            /** X's own alphabet for a handle: 15 characters of word and digit. */
            pattern: /^[A-Za-z0-9_]{1,15}$/,
            verb: 'Follow',
            verbing: 'following',
            verbed: 'Followed',
            pace: Object.freeze({ minMs: 25000, maxMs: 55000, cap: 40 }),
        }),
        reddit: Object.freeze({
            id: 'reddit',
            name: 'Reddit',
            host: 'reddit.com',
            one: 'subreddit',
            many: 'subreddits',
            prefix: 'r/',
            /** Reddit's own: 3–21 of word, digit and underscore. */
            pattern: /^[A-Za-z0-9_]{2,21}$/,
            verb: 'Join',
            verbing: 'joining',
            verbed: 'Joined',
            pace: Object.freeze({ minMs: 9000, maxMs: 20000, cap: 120 }),
        }),
    });

    const siteOf = (id) => SITES[id] || null;
    const ids = () => Object.keys(SITES);

    /** A list longer than this is a file that is not a roster. */
    const MAX_NAMES = 5000;

    /**
     * One line of a file to one bare name, or '' when it is not one.
     *
     * Generous on the way in, because the file is one a person may well have
     * written or edited by hand: a URL, an @handle, `r/name`, `/r/name/`,
     * `u/name`, a trailing comma, a comment after a `#`. Strict about what
     * comes out — the result is interpolated into a URL the content script
     * navigates to, so it has to match the site's own alphabet exactly.
     */
    function parseName(line, site) {
        const rules = siteOf(site);
        if (!rules) return '';

        let text = String(line || '').split('#')[0].trim();
        if (!text) return '';

        // A pasted URL: keep the last meaningful segment.
        text = text
            .replace(/^[a-z+]+:\/\//i, '')
            .replace(/^(?:[a-z0-9.-]*\.)?(?:x|twitter|reddit)\.com\//i, '')
            .replace(/[?#].*$/, '');

        text = text.replace(/^\/+/, '').replace(/\/+$/, '');
        // r/name, u/name, @name — the prefixes a person writes without thinking.
        text = text.replace(/^(?:r|u|user)\//i, '').replace(/^@/, '');
        // Whatever is left of a deeper path is not a name.
        if (text.includes('/')) text = text.split('/')[0];
        text = text.replace(/[,;]+$/, '').trim();

        return rules.pattern.test(text) ? text : '';
    }

    /**
     * A whole file to a list of names: in the order they were written, without
     * duplicates, and without anything that did not parse.
     *
     * Case is folded for the duplicate check but not for the name itself.
     * `@Handle` and `@handle` are one account, and which spelling is kept does
     * not matter to the site — but it is the one the file used, because a list
     * that comes back out with everybody's name lower-cased looks damaged.
     */
    function parseList(text, site) {
        const seen = new Set();
        const names = [];
        for (const line of String(text || '').split(/\r?\n/)) {
            const name = parseName(line, site);
            if (!name) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            names.push(name);
            if (names.length >= MAX_NAMES) break;
        }
        return names;
    }

    /**
     * The file that is written out.
     *
     * A plain list with a comment header, not JSON or CSV. The point of the
     * file is that you can open it, delete half the lines and feed it back in,
     * and the header says how — a `#` comment is the one convention every
     * reader of a text list already knows.
     */
    function toText(site, names, now = Date.now()) {
        const rules = siteOf(site);
        if (!rules) return '';
        const list = Array.isArray(names) ? names : [];
        return [
            `# Bell Bearer — ${rules.many} on ${rules.host}`,
            `# ${list.length} ${list.length === 1 ? rules.one : rules.many}, read ${new Date(now).toISOString()}`,
            '#',
            `# One name per line, written as ${rules.prefix}name or bare. Lines starting with`,
            `# # are ignored, so you can comment out what you do not want back.`,
            '',
            ...list.map((name) => `${rules.prefix}${name}`),
            '',
        ].join('\n');
    }

    /** A filename that sorts by date and says what it holds. */
    function fileName(site, now = Date.now()) {
        const rules = siteOf(site);
        const day = Time.dayKey(now);
        return `bell-bearer-${rules ? rules.host.replace(/\./g, '-') : 'roster'}-${day}.txt`;
    }

    // --------------------------------------------------------------- jobs

    /** 'YYYY-MM-DD' local, so a day's cap runs to local midnight. */
    const dayKey = (ms = Date.now()) => Time.dayKey(ms);

    /**
     * A job as it starts. `at` is how far down `names` it has got, and is the
     * only thing that moves — `done` and `failed` are counts, not lists,
     * because a list of two thousand names written back on every step is a
     * storage write per action for something nobody reads.
     */
    function newJob({ site, action, names = [], now = Date.now() }) {
        return {
            site,
            action,                  // 'read' | 'apply'
            names: action === 'apply' ? names.slice() : [],
            // What a read job has collected so far. Kept on the job rather
            // than in a variable because reading Reddit is a walk through
            // paginated pages, and every page is a fresh script.
            found: [],
            at: 0,
            // Followed or joined by the user, found already there, and passed
            // over with the bar's Skip. Nothing is tallied as a failure: the
            // job never acts, so nothing it does can fail, and something it
            // does not understand stops it — see the head of
            // src/content/roster.js.
            done: 0,
            skipped: 0,
            passed: 0,
            day: dayKey(now),
            today: 0,                // actions taken today, against pace.cap
            status: 'running',       // running | waiting | done | stopped | paused
            note: '',
            startedAt: now,
            // When the dashboard last opened a tab for it. Only for a short
            // while after that may a page that is not the job's own take
            // the job up — see isKicked.
            kickedAt: now,
            actedAt: 0,              // when the last action was taken
            nextAt: 0,               // the earliest the next one may be
            // Which page of the site is working on this, and until when. Two
            // tabs of the same site both pick a job up, and without a lease
            // both would follow the same account and step the cursor twice.
            leaseBy: '',
            leaseUntil: 0,
        };
    }

    const isRunning = (job) => !!job && (job.status === 'running' || job.status === 'waiting');

    /** How long a page may hold a job before another may take it over. */
    const LEASE_MS = 150000;

    /** May `pageId` act on this job right now? */
    function canClaim(job, pageId, now = Date.now()) {
        if (!isRunning(job)) return false;
        if (!job.leaseBy || job.leaseBy === pageId) return true;
        return job.leaseUntil <= now;
    }

    const claim = (job, pageId, now = Date.now()) =>
        ({ ...job, leaseBy: pageId, leaseUntil: now + LEASE_MS });

    /** Hand the job back before navigating, so the next page can take it up. */
    const release = (job) => ({ ...job, leaseBy: '', leaseUntil: 0 });

    /** Is some page working on this job now? */
    const isHeld = (job, now = Date.now()) => !!job && !!job.leaseBy && job.leaseUntil > now;

    /**
     * How long after the dashboard opens a tab for a job any page of the site
     * may take it up, rather than only the job's own page.
     *
     * A job used to be taken up by every page of the site, for as long as it
     * ran. A read of Twitter starts on x.com/home, because which account is
     * signed in is only known there; but the same rule then took over any
     * x.com tab opened later that day and sent it somewhere else. Two minutes
     * covers a slow first load and nothing after it.
     */
    const KICK_MS = 120000;
    const isKicked = (job, now = Date.now()) => !!job && now - (job.kickedAt || 0) < KICK_MS;

    /**
     * `job` with its daily count reset if the day turned over under it.
     *
     * An apply job of four hundred names runs over days by design, so the cap
     * has to be a cap per day rather than per job — and the job outlives the
     * day it was started on.
     */
    function forDay(job, now = Date.now()) {
        if (!job) return null;
        const today = dayKey(now);
        return job.day === today ? job : { ...job, day: today, today: 0 };
    }

    /** Has this job used up what the site allows for today? */
    function atCap(job, now = Date.now()) {
        const rules = siteOf(job && job.site);
        if (!rules) return true;
        return forDay(job, now).today >= rules.pace.cap;
    }

    /** The name the job is on, or '' when it has reached the end. */
    function currentName(job) {
        if (!job || job.action !== 'apply') return '';
        return job.names[job.at] || '';
    }

    /**
     * How long to wait before the next action: somewhere in the site's range,
     * chosen afresh each time.
     *
     * Jittered rather than fixed, and this is the one place in the file where
     * that matters for a reason other than politeness: a click exactly every
     * forty seconds for an hour is a signature, and a person does not have one.
     */
    function nextDelay(site, random = Math.random) {
        const rules = siteOf(site);
        if (!rules) return 60000;
        const { minMs, maxMs } = rules.pace;
        return Math.round(minMs + (maxMs - minMs) * random());
    }

    /**
     * What an apply job is going to cost, for the sentence shown before it
     * starts. Nobody should start a nine-day job without being told it is one.
     */
    function plan(site, names, now = Date.now()) {
        const rules = siteOf(site);
        const total = (names || []).length;
        if (!rules || !total) return { total: 0, cap: 0, days: 0, perDayMs: 0 };

        const { minMs, maxMs, cap } = rules.pace;
        const perDay = Math.min(total, cap);
        return {
            total,
            cap,
            days: Math.ceil(total / cap),
            // The first day's sitting, so "about an hour" can be said out loud.
            perDayMs: Math.round(perDay * ((minMs + maxMs) / 2)),
            startedAt: now,
        };
    }

    /** done / total as a percentage, for the bar. */
    function progress(job) {
        if (!job || job.action !== 'apply' || !job.names.length) return 0;
        return Math.min(100, Math.round((job.at / job.names.length) * 100));
    }

    // ----------------------------------------------------------- storage

    const rosters = Store.create({
        keys: [ROSTERS_KEY],
        name: 'rosters',
        read: (stored) => {
            const all = stored[ROSTERS_KEY];
            return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
        },
        blank: () => ({}),
    });

    const loadRosters = () => rosters.load();

    const saveRoster = (site, names, now = Date.now()) => rosters.update((all) => ({
        ...all,
        [site]: { names: (names || []).slice(0, MAX_NAMES), readAt: now },
    }));

    /**
     * The job, held as `{ job }`. The store takes a step that returns null
     * for one that changed nothing, and null is how a job is cleared.
     *
     * A read that fails now fails the step and writes nothing. It used to come
     * back as no job, a step handed no job hands back none, and that was
     * written down — clearing an apply job with days still to run.
     */
    const jobs = Store.create({
        keys: [JOB_KEY],
        name: 'the roster job',
        read: (stored) => {
            const job = stored[JOB_KEY];
            return { job: job && typeof job === 'object' ? job : null };
        },
        write: ({ job }) => ({ [JOB_KEY]: job || null }),
        blank: () => ({ job: null }),
    });

    const loadJob = async () => (await jobs.load()).job;
    const saveJob = (job) => jobs.save({ job });
    const clearJob = () => jobs.save({ job: null });

    /**
     * Read, change, write — one job at a time. Resolves to the job as written,
     * or null when there is none or the step failed.
     *
     * Two tabs of the same site can both pick a job up, and both would then
     * follow the same account and step the cursor twice. The change is applied
     * to what is in storage now rather than to a copy read earlier, and the
     * content script also checks that the name it is looking at is still the
     * one the job is on before it clicks anything. A page the job is not for
     * hands it back unchanged, and that is no longer written back over
     * whatever the page it is for has done since.
     */
    async function updateJob(change) {
        return (await jobs.update((box) => ({ job: change(box.job) }))).job;
    }

    /**
     * x.com's own pages, not accounts — several of them sit at a one-segment
     * path that looks exactly like a handle.
     */
    const X_PAGES = new Set(['home', 'explore', 'notifications', 'messages', 'i',
        'search', 'settings', 'compose', 'bookmarks', 'jobs', 'lists', 'topics']);

    /**
     * The handle a link on x.com points at, without its @, or '' for one of
     * X's own pages. The roster reader and the X pouch each kept a copy, and
     * with it a copy of the list above to drift.
     */
    function handleFromHref(href) {
        const path = String(href || '').replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com/i, '');
        const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(path);
        if (!match) return '';
        return X_PAGES.has(match[1].toLowerCase()) ? '' : match[1];
    }

    const Roster = {
        SITES, ROSTERS_KEY, JOB_KEY, MAX_NAMES,
        siteOf, ids, parseName, parseList, toText, fileName, handleFromHref,
        dayKey, newJob, isRunning, forDay, atCap, currentName, nextDelay, plan, progress,
        LEASE_MS, canClaim, claim, release, isHeld, KICK_MS, isKicked,
        loadRosters, saveRoster, loadJob, saveJob, clearJob, updateJob,
    };

    root.BB = root.BB || {};
    root.BB.Roster = Roster;
    if (typeof module !== 'undefined' && module.exports) module.exports = Roster;
})(typeof globalThis !== 'undefined' ? globalThis : this);
