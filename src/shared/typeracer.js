/**
 * The TypeRacer log: what each race scored, what the keystrokes inside it
 * said, and one bucket per day.
 *
 * Three stores rather than one, because they age differently. A race is a row
 * in a table and the last two hundred is all the history a table wants. The
 * n-gram tables are a rolling aggregate with no age at all — they are capped
 * by how many distinct grams they hold, not by when they were typed. A day
 * bucket is three numbers for a square on a heat map, and four hundred of
 * those is a year of map plus the slack to scroll it.
 *
 * **Raw keystrokes are never stored.** A race is about three hundred of them,
 * a hundred races is thirty thousand rows, and chrome.storage.local is not a
 * database. The stream is folded into the tables below at the end of each
 * race and then thrown away — which is also why every count here is a *sum*
 * rather than a mean: means do not merge, so everything is derived at read
 * time from `n` and `ms`.
 *
 * What the site scored is read off its result panel as a cross-check only.
 * Everything the dashboard is actually for — which pairs of letters you stall
 * on, which characters you reach for wrongly — is derived from the keystrokes
 * themselves, so it survives every CSS rename on typeracer.com.
 *
 * Everything above the "storage" line is pure and covered by
 * tests/node-check.js; nothing there reads a clock it was not given.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Time = ns.Time || req('./time.js');
    const Store = ns.Store || req('./store.js');

    const { typerRaces: RACES_KEY, typerGrams: GRAMS_KEY, typerDays: DAYS_KEY } = Settings.DATA;

    /** Races kept, newest first. Enough for a chart and a table of recents. */
    const RACE_CAP = 200;

    /** A year of heat map, plus enough slack to scroll to its left edge. */
    const KEEP_DAYS = 400;

    /** How many distinct grams each table holds before the rarest are evicted. */
    const GRAM_CAP = 1500;
    const GRAM_CAP_TRI = 4000;

    /**
     * A gram seen this many times is never evicted, however full the table
     * gets. Meeting forty new pairs in one quote must not cost you the pair
     * you have two hundred readings of.
     */
    const KEEP_N = 8;

    /**
     * Interval bounds. Above the first you looked away; below the second it is
     * key repeat or a paste. Both are **dropped rather than clamped**, because
     * a clamped outlier is still an invented reading sitting in the mean.
     * Dropping one never moves its neighbours: every interval is the
     * difference of two absolute timestamps, not a step in a chain.
     */
    const OUTLIER_MS = 1500;
    const FLOOR_MS = 10;

    /** Under this many readings a gram's mean is noise. The setting's default. */
    const MIN_SAMPLES = 8;

    const DAY_MS = 864e5;

    /**
     * 'YYYY-MM-DD' in **local** time, the one every daily store shares — see
     * Time.dayKey. An evening race east of Greenwich would otherwise land on
     * tomorrow's square.
     */
    const dayKey = (ms = Date.now()) => Time.dayKey(ms);

    const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const asArray = (value) => (Array.isArray(value) ? value : []);
    const text = (value) => String(value == null ? '' : value).trim();
    const count = (value) => Math.max(0, Math.round(Number(value)) || 0);
    const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

    const blankGrams = () => ({ bi: {}, tri: {}, chars: {}, totalN: 0, totalMs: 0, updatedAt: 0 });
    const blank = () => ({ races: [], grams: blankGrams(), days: {} });

    // ------------------------------------------------------------ folding

    /** The curly quotes and long dashes a quote is typeset with, straightened. */
    const LOOKALIKES = { '‘': "'", '’': "'", '–': '-', '—': '-' };

    /**
     * The normalisation that keeps the tables finite.
     *
     * Case is folded because an upper-case pair and its lower-case twin are
     * the same motion for the fingers that matter — the shift is already
     * measured as an interval of its own. Digits all become `#`, and
     * everything outside the letter / space / apostrophe / comma / period /
     * hyphen set becomes `?`, so a quote full of accents cannot fill the
     * table with grams you will never meet twice.
     */
    function foldChar(ch) {
        const one = String(ch == null ? '' : ch).slice(0, 1);
        if (!one) return '';
        const lower = (LOOKALIKES[one] || one).toLowerCase();
        if (lower >= '0' && lower <= '9') return '#';
        return /^[a-z ',.-]$/.test(lower) ? lower : '?';
    }

    const foldGram = (chars) => chars.map(foldChar).join('');

    // -------------------------------------------------------- the keystrokes

    const bump = (table, key) => (table[key] || (table[key] = { n: 0, ms: 0, err: 0 }));

    const charEntry = (table, key) =>
        (table[key] || (table[key] = { due: 0, wrong: 0, subs: {}, n: 0, ms: 0 }));

    /**
     * Fold one race's committed keystrokes into the tables.
     *
     * The stream is `{ ch, expected, at, ok }` per committed character and
     * `{ del: true, at }` per backspace, in the order they happened. A
     * deletion is an event of its own rather than a flag on the character it
     * removed because the stream is *replayed* here: which position a
     * keystroke lands on is whatever the buffer's length was at the time, and
     * that is only knowable by running the whole thing through.
     *
     * Three rules, each because the naive version is wrong:
     *
     *   - An interval is credited **only when both of its characters were
     *     committed correctly on the first attempt**. An interval spanning a
     *     backspace is not a measure of how fast you type "th"; it is a
     *     measure of how long you spent fixing something.
     *   - Readings outside [FLOOR_MS, OUTLIER_MS] are dropped, not clamped.
     *   - A trigram's interval is the **second** of its two intervals, so a
     *     trigram and the bigram inside it are not the same number under two
     *     names. Both of its intervals still have to be readable, or what is
     *     being measured is not a roll — it is a pause with a pair after it.
     *
     * The replay is also where `correctionMs` comes from: the buffer holding a
     * wrong character opens an error window, and the window closes the moment
     * it holds none. That is the whole measurement, and it is why the cost of
     * correcting can be reported without asking TypeRacer anything — the site
     * does not publish it, and no scoreboard it draws contains it.
     */
    function gramsFrom(events) {
        const bi = {};
        const tri = {};
        const chars = {};
        let totalN = 0;
        let totalMs = 0;
        let errors = 0;
        let correctionMs = 0;

        // How many wrong characters the box is holding, when it started
        // holding one, and the last moment anything happened.
        let dirtyChars = 0;
        let brokeAt = 0;
        let lastAt = 0;

        // One slot per position in the quote, filled by replaying the buffer.
        // `dirty` is set by a retype or a deletion, and is what excludes an
        // interval from every table it would otherwise have entered.
        const slots = [];
        let depth = 0;
        // What each position asked for, and whether the first key that
        // landed there was right. Kept apart from `slots`, which a retype
        // overwrites: a slip is decided by the first attempt, not the last.
        const firstTry = [];
        const wanted = [];

        for (const raw of asArray(events)) {
            const at = Number(raw && raw.at);
            if (!Number.isFinite(at)) continue;
            lastAt = at;
            const wasClean = dirtyChars === 0;

            if (raw.del) {
                if (depth === 0) continue;
                depth--;
                if (slots[depth]) {
                    if (!slots[depth].ok) dirtyChars--;
                    slots[depth].dirty = true;
                }
                if (!wasClean && dirtyChars === 0) correctionMs += at - brokeAt;
                continue;
            }

            const ch = String(raw.ch == null ? '' : raw.ch).slice(0, 1);
            if (!ch) continue;
            const ok = raw.ok === true;
            if (!ok) {
                errors++;
                dirtyChars++;
                if (wasClean) brokeAt = at;
            }

            const entry = charEntry(chars, foldChar(raw.expected) || '?');
            // Every attempt counts as a due: a character you had to type
            // twice was in front of you twice, and that is what keeps
            // wrong / due inside [0, 1] and meaning something.
            entry.due++;
            if (!ok) {
                entry.wrong++;
                const hit = foldChar(ch) || '?';
                entry.subs[hit] = (entry.subs[hit] || 0) + 1;
            }

            if (firstTry[depth] === undefined) {
                firstTry[depth] = ok;
                wanted[depth] = String(raw.expected == null ? '' : raw.expected).slice(0, 1) || '?';
            }

            const before = slots[depth];
            slots[depth] = { ch, at, ok, dirty: !!before };
            depth++;
        }

        // The slips: a position got wrong on its first attempt straight after
        // one got right, filed against the pair — and the roll — the fingers
        // were in the middle of. Only after a clean one, because the second
        // mistake of a run is the first one's fault, not the pair's. Keyed
        // by what was due, not what was hit: `err` on "th" means "going for
        // th, you missed", which is the thing worth drilling.
        const clearTry = (index) => firstTry[index] === true;
        for (let i = 1; i < firstTry.length; i++) {
            if (firstTry[i] !== false || !clearTry(i - 1)) continue;
            bump(bi, foldGram([wanted[i - 1], wanted[i]])).err++;
            if (i >= 2 && clearTry(i - 2)) bump(tri, foldGram([wanted[i - 2], wanted[i - 1], wanted[i]])).err++;
        }

        const clean = (index) => {
            const slot = slots[index];
            return !!slot && slot.ok && !slot.dirty;
        };
        const gap = (from, to) => slots[to].at - slots[from].at;
        const readable = (ms) => ms >= FLOOR_MS && ms <= OUTLIER_MS;

        for (let i = 1; i < slots.length; i++) {
            if (!clean(i - 1) || !clean(i)) continue;
            const second = gap(i - 1, i);
            if (!readable(second)) continue;

            const pair = bump(bi, foldGram([slots[i - 1].ch, slots[i].ch]));
            pair.n++;
            pair.ms += second;
            totalN++;
            totalMs += second;

            // The same reading, filed against the character it landed on.
            // This is the per-character baseline the weak-spot tables rank
            // against; the whole-race one alone is not enough, and the
            // comment where it is read says why.
            const landing = charEntry(chars, foldChar(slots[i].ch) || '?');
            landing.n++;
            landing.ms += second;

            if (i < 2 || !clean(i - 2) || !readable(gap(i - 2, i - 1))) continue;
            const roll = bump(tri, foldGram([slots[i - 2].ch, slots[i - 1].ch, slots[i].ch]));
            roll.n++;
            roll.ms += second;
        }

        // A race that ended still holding a wrong character never closed its
        // window. Billing it to the last keystroke is the honest reading: the
        // time was spent, and leaving it out would make a race abandoned in
        // an error state look like the cleanest one in the log.
        if (dirtyChars > 0 && lastAt > brokeAt) correctionMs += lastAt - brokeAt;

        return { bi, tri, chars, totalN, totalMs, errors, correctionMs, committed: slots.length };
    }

    // ----------------------------------------------------- merge and evict

    function mergeTable(into, from) {
        for (const [gram, entry] of Object.entries(asObject(from))) {
            const row = bump(into, gram);
            row.n += count(entry && entry.n);
            row.ms += Math.max(0, num(entry && entry.ms));
            row.err += count(entry && entry.err);
        }
        return into;
    }

    function mergeChars(into, from) {
        for (const [ch, entry] of Object.entries(asObject(from))) {
            const row = charEntry(into, ch);
            row.due += count(entry && entry.due);
            row.wrong += count(entry && entry.wrong);
            row.n += count(entry && entry.n);
            row.ms += Math.max(0, num(entry && entry.ms));
            for (const [sub, times] of Object.entries(asObject(entry && entry.subs))) {
                row.subs[sub] = (row.subs[sub] || 0) + count(times);
            }
        }
        return into;
    }

    /** Add `delta` to `state`'s tables. Commutative, because it is all sums. */
    function mergeGrams(state, delta, now = 0) {
        const before = asObject(state);
        return {
            bi: mergeTable(mergeTable({}, before.bi), delta && delta.bi),
            tri: mergeTable(mergeTable({}, before.tri), delta && delta.tri),
            chars: mergeChars(mergeChars({}, before.chars), delta && delta.chars),
            totalN: count(before.totalN) + count(delta && delta.totalN),
            totalMs: Math.max(0, num(before.totalMs)) + Math.max(0, num(delta && delta.totalMs)),
            updatedAt: count(now) || count(before.updatedAt),
        };
    }

    /**
     * Evict the rarest grams once a table is over its cap.
     *
     * Lowest `n` first, and **never** an entry at KEEP_N or above — a gram you
     * have real data for is not thrown away because you met forty new ones
     * today. A table made entirely of well-known grams therefore stays over
     * the cap, which is the right way round: the cap is there to keep one-offs
     * out, not to throw away the answer.
     */
    function evict(table, cap) {
        const entries = Object.entries(asObject(table));
        if (entries.length <= cap) return Object.fromEntries(entries);
        // Readings and slips both count as knowing a gram. A pair you slip on
        // every time never gets a clean reading, so by `n` alone it was the
        // first thing thrown out — exactly the pair the slips table is for.
        const weight = (entry) => count(entry.n) + count(entry.err);
        const gone = new Set(entries
            .filter(([, entry]) => weight(entry) < KEEP_N)
            .sort((a, b) => weight(a[1]) - weight(b[1]) || (a[0] < b[0] ? -1 : 1))
            .slice(0, entries.length - cap)
            .map(([gram]) => gram));
        return Object.fromEntries(entries.filter(([gram]) => !gone.has(gram)));
    }

    function pruneGrams(state) {
        // Merging with nothing is how a stored table is cleaned: every field
        // goes through the same count()/num() it would on the way in.
        const grams = mergeGrams(state, null, count(asObject(state).updatedAt));
        grams.bi = evict(grams.bi, GRAM_CAP);
        grams.tri = evict(grams.tri, GRAM_CAP_TRI);
        // Characters are bounded by foldChar to about thirty keys, so there is
        // nothing there to evict — only the merge's cleaning to keep.
        return grams;
    }

    // ------------------------------------------------------------ the races

    const round1 = (value) => Math.round(num(value) * 10) / 10;

    function cleanRace(record) {
        const race = asObject(record);
        return {
            at: count(race.at),
            wpm: Math.max(0, round1(race.wpm)),
            accuracy: Math.min(100, Math.max(0, round1(race.accuracy))),
            seconds: Math.max(0, round1(race.seconds)),
            chars: count(race.chars),
            errors: count(race.errors),
            correctionMs: count(race.correctionMs),
            cleanWpm: Math.max(0, round1(race.cleanWpm)),
            quoteId: text(race.quoteId).slice(0, 40),
            place: count(race.place),
            of: count(race.of),
        };
    }

    /** Day buckets older than KEEP_DAYS are gone, not archived. */
    const prune = (days, now = Date.now()) => Time.keepDays(days, KEEP_DAYS, (bucket) => ({
        races: count(bucket.races),
        seconds: count(bucket.seconds),
        best: Math.max(0, Math.round(num(bucket.best))),
    }), now);

    /**
     * One finished race, in the shape the store keeps.
     *
     * The page's own WPM and accuracy are believed when they parse, because
     * they are the numbers the user just saw on screen and a dashboard
     * disagreeing with TypeRacer by a point would only ever look broken. When
     * they do not parse — a renamed results table, a practice run with no
     * panel at all — the same two are computed from the stream instead.
     */
    function raceFrom(race, derived, now) {
        const given = asObject(race);
        const at = count(given.at) || count(now);
        const seconds = Math.max(0, num(given.seconds));
        const chars = count(given.chars) || derived.committed;
        const typedWpm = seconds > 0 ? (chars / 5) / (seconds / 60) : 0;
        const accurate = derived.committed
            ? ((derived.committed - derived.errors) / derived.committed) * 100
            : 0;

        const wpm = num(given.wpm) > 0 ? num(given.wpm) : typedWpm;

        return cleanRace({
            ...given,
            at,
            seconds,
            chars,
            wpm,
            accuracy: num(given.accuracy) > 0 ? num(given.accuracy) : accurate,
            errors: derived.errors,
            correctionMs: derived.correctionMs,
            cleanWpm: cleanWpmOf(wpm, seconds, derived.correctionMs),
        });
    }

    /**
     * The same keystrokes with the error windows taken out of the clock.
     *
     * Not a projection of how fast you *could* type — it is this race with the
     * time spent in and getting out of a mistake removed, which is why the
     * panel says so under the figure. Anything that would divide by nothing
     * left reports the race's own speed rather than an infinity.
     */
    function cleanWpmOf(wpm, seconds, correctionMs) {
        const clear = num(seconds) - Math.max(0, num(correctionMs)) / 1000;
        return clear > 0 ? num(wpm) * (num(seconds) / clear) : num(wpm);
    }

    /**
     * What correcting cost over a range: the seconds, the two speeds, and the
     * gap between them.
     *
     * A plain mean of each race's own figure rather than a weighted one. Both
     * are means over the same set, so `delta` is the honest difference, and
     * weighting by length would quietly make a long slow race the answer.
     */
    function correctionCost(races, { since = 0, until = Infinity } = {}) {
        const rows = asArray(races).map(cleanRace)
            .filter((race) => race.at >= since && race.at <= until);
        if (!rows.length) return { races: 0, seconds: 0, wpm: 0, cleanWpm: 0, delta: 0, percent: 0 };

        const sum = (pick) => rows.reduce((total, race) => total + pick(race), 0);
        const seconds = sum((race) => race.correctionMs) / 1000;
        const raced = sum((race) => race.seconds);
        const wpm = sum((race) => race.wpm) / rows.length;
        const cleanWpm = sum((race) => race.cleanWpm || race.wpm) / rows.length;

        return {
            races: rows.length,
            seconds: round1(seconds),
            wpm: round1(wpm),
            cleanWpm: round1(cleanWpm),
            delta: round1(cleanWpm - wpm),
            percent: raced > 0 ? round1((seconds / raced) * 100) : 0,
        };
    }

    /** Push the race, fold the grams, credit the day. */
    function recordRace(state, race, events, now = Date.now()) {
        const derived = gramsFrom(events);
        const entry = raceFrom(race, derived, now);

        const races = [entry, ...asArray(asObject(state).races).map(cleanRace)].slice(0, RACE_CAP);
        const grams = pruneGrams(mergeGrams(asObject(state).grams, derived, entry.at));

        // The race's own day, not today's: one finished either side of
        // midnight belongs to the square it happened on.
        const days = prune(asObject(state).days, entry.at);
        const key = dayKey(entry.at);
        const bucket = days[key] || { races: 0, seconds: 0, best: 0 };
        days[key] = {
            races: bucket.races + 1,
            seconds: bucket.seconds + Math.round(entry.seconds),
            best: Math.max(bucket.best, Math.round(entry.wpm)),
        };

        return { races, grams, days };
    }

    // ---------------------------------------------------- the practice map

    /** What a day bucket can be coloured by, and what each means on the map. */
    const METRICS = Object.freeze([
        Object.freeze({ id: 'races', label: 'Races', noun: 'race' }),
        Object.freeze({ id: 'wpm', label: 'Best WPM', noun: 'wpm' }),
        Object.freeze({ id: 'seconds', label: 'Time', noun: 'second' }),
    ]);

    /** Which field of a bucket each metric colours by. */
    const METRIC_FIELD = Object.freeze({ races: 'races', wpm: 'best', seconds: 'seconds' });

    /**
     * The day buckets shaped for BB.HeatMap.render.
     *
     * `value` is whichever of the three the map is colouring by, and the rest
     * ride along so a square's tooltip can name all of them whichever one is
     * picked. Pruned on the way out as well as in, so a store written before a
     * long break cannot draw a square outside the map's own window.
     */
    function heatDays(state, metric = 'races', now = Date.now()) {
        const field = METRIC_FIELD[metric] || METRIC_FIELD.races;
        const out = {};
        for (const [key, bucket] of Object.entries(prune(asObject(state).days, now))) {
            out[key] = { ...bucket, value: bucket[field] };
        }
        return out;
    }

    /** Days raced in a row, ending today or yesterday. */
    const streak = (state, now = Date.now()) =>
        Time.runOfDays(prune(asObject(state).days, now), (bucket) => bucket.races, now);

    // ----------------------------------------------------- the weak spots

    /**
     * Under this many sightings a character's error *rate* means nothing —
     * one fumble out of one is not a hundred percent of anything.
     */
    const MISTYPE_MIN_DUE = 10;

    /** A word is five characters, so an interval of `ms` implies this speed. */
    const wpmFor = (meanMs) => (meanMs > 0 ? Math.round(12000 / meanMs) : 0);

    /**
     * What this gram is being judged against.
     *
     * The obvious baseline is the whole-race one, `totalMs / totalN`, and on
     * its own it is not enough: with one baseline for every gram, the ratio is
     * just the mean under another name, and the table comes back as every gram
     * containing a capital or a punctuation mark — which is true and useless,
     * because reaching for a comma is slower than reaching for `e` for
     * everybody and always will be.
     *
     * So a gram is judged against **the character its interval lands on**, as
     * you type it: "is this pair slow for a pair ending in a comma?" A gram
     * whose landing character has too few readings of its own falls back to
     * the whole-race baseline, which is the only honest answer there.
     */
    function baselineFor(grams, gram) {
        const overall = count(grams.totalN) ? num(grams.totalMs) / count(grams.totalN) : 0;
        const entry = asObject(grams.chars)[gram.slice(-1)];
        return entry && count(entry.n) >= KEEP_N ? num(entry.ms) / count(entry.n) : overall;
    }

    /**
     * The grams you are slowest at, worst first.
     *
     * Ranked by `ratio` — how slow this is *for you*, against the baseline
     * above — and never by `meanMs`. `minSamples` is the typerMinSamples
     * setting; under it a mean is one bad morning rather than a habit.
     */
    function slowest(state, kind = 'bi', { minSamples = MIN_SAMPLES, limit = 12 } = {}) {
        const grams = asObject(asObject(state).grams);
        const table = asObject(kind === 'tri' ? grams.tri : grams.bi);
        const floor = Math.max(1, count(minSamples));
        const overall = count(grams.totalN) ? num(grams.totalMs) / count(grams.totalN) : 0;

        const rows = [];
        for (const [gram, entry] of Object.entries(table)) {
            const n = count(entry && entry.n);
            if (n < floor) continue;
            const meanMs = num(entry.ms) / n;
            const baseline = baselineFor(grams, gram);
            rows.push({
                gram,
                n,
                err: count(entry.err),
                meanMs: round1(meanMs),
                baseline: round1(baseline),
                overall: round1(overall),
                ratio: baseline > 0 ? Math.round((meanMs / baseline) * 100) / 100 : 0,
                wpm: wpmFor(meanMs),
            });
        }
        // Ties broken by sample count and then alphabetically, so the table
        // does not reshuffle itself between two repaints of the same data.
        rows.sort((a, b) => b.ratio - a.ratio || b.n - a.n || (a.gram < b.gram ? -1 : 1));
        return rows.slice(0, Math.max(1, count(limit)));
    }

    /**
     * The pairs (or rolls) you slip on, most slips first.
     *
     * `rate` is slips over every time the gram was attempted from a clean
     * start — its slips plus its clean readings. A few readings are lost to
     * the interval bounds, so it errs slightly high, never low. `minSlips`
     * keeps a single fumble from naming a gram at all.
     */
    function slips(state, kind = 'bi', { limit = 12, minSlips = 2 } = {}) {
        const grams = asObject(asObject(state).grams);
        const table = asObject(kind === 'tri' ? grams.tri : grams.bi);
        const rows = [];
        for (const [gram, entry] of Object.entries(table)) {
            const err = count(entry && entry.err);
            if (err < Math.max(1, count(minSlips))) continue;
            const n = count(entry.n);
            rows.push({ gram, err, n, rate: Math.round((err / (err + n)) * 1000) / 1000 });
        }
        rows.sort((a, b) => b.err - a.err || b.rate - a.rate || (a.gram < b.gram ? -1 : 1));
        return rows.slice(0, Math.max(1, count(limit)));
    }

    /**
     * The characters you get wrong, and what you hit instead.
     *
     * Two orderings, because they are genuinely different questions. `wrong`
     * is "most often", which `e` wins simply by being everywhere. `rate` is
     * "most likely", which is the honest one — and it needs MISTYPE_MIN_DUE
     * under it, or a character you met once and fumbled tops the table at a
     * hundred percent for ever.
     */
    function mistyped(state, { limit = 12, by = 'wrong', minDue = MISTYPE_MIN_DUE } = {}) {
        const chars = asObject(asObject(asObject(state).grams).chars);
        const rows = [];

        for (const [ch, entry] of Object.entries(chars)) {
            const due = count(entry && entry.due);
            const wrong = count(entry && entry.wrong);
            if (!wrong) continue;
            if (by === 'rate' && due < count(minDue)) continue;

            const subs = Object.entries(asObject(entry.subs))
                .map(([hit, times]) => ({ ch: hit, n: count(times) }))
                .sort((a, b) => b.n - a.n || (a.ch < b.ch ? -1 : 1));

            rows.push({
                ch,
                due,
                wrong,
                rate: due ? Math.round((wrong / due) * 1000) / 1000 : 0,
                topSub: subs.length ? subs[0].ch : '',
                subs: subs.slice(0, 3),
            });
        }

        rows.sort(by === 'rate'
            ? (a, b) => b.rate - a.rate || b.wrong - a.wrong || (a.ch < b.ch ? -1 : 1)
            : (a, b) => b.wrong - a.wrong || b.rate - a.rate || (a.ch < b.ch ? -1 : 1));
        return rows.slice(0, Math.max(1, count(limit)));
    }

    /**
     * A practice string built from the pairs you are worst at.
     *
     * Each gram is padded into a chunk that can be typed as a word — "th"
     * becomes "athath" — because drilling a bare pair over and over trains the
     * pair in isolation, and a pair is never typed in isolation. Only pairs of
     * letters are used: a chunk built around a comma or a space is not a word
     * and reads as line noise.
     *
     * Rotated rather than shuffled. A drill you can compare with yesterday's
     * is worth more than a different one every time, and `Math.random()` in a
     * pure function is not something a test can pin down.
     */
    const DRILL_PADS = 'aeiou';

    function drillChunk(gram, index) {
        const open = DRILL_PADS[index % DRILL_PADS.length];
        const close = DRILL_PADS[(index + 2) % DRILL_PADS.length];
        return `${open}${gram}${close}${gram}`;
    }

    function drill(state, { grams = 6, length = 180, minSamples = MIN_SAMPLES } = {}) {
        const wanted = Math.max(1, count(grams));
        const worst = slowest(state, 'bi', { minSamples, limit: wanted * 4 })
            .filter((row) => /^[a-z]+$/.test(row.gram))
            .slice(0, wanted);
        if (!worst.length) return '';

        const chunks = worst.map((row, index) => drillChunk(row.gram, index));
        const out = [];
        let size = 0;
        for (let i = 0; size < count(length); i++) {
            // The offset walks the order on by one every time round, so the
            // same six chunks do not come back in the same six-chunk loop.
            const chunk = chunks[(i + Math.floor(i / chunks.length)) % chunks.length];
            out.push(chunk);
            size += chunk.length + 1;
        }
        return out.join(' ');
    }

    /**
     * The headline figures over a range, in the shape chess.js#summarize
     * established: the races themselves plus the numbers drawn above them.
     *
     * `meanLast10` is there because a mean over everything moves too slowly to
     * answer "am I getting faster" — a hundred races ago still counts for a
     * hundredth of it — and `best` alone is one good afternoon you had in
     * March. The two together are the honest pair.
     */
    function summarize(races, { since = 0, until = Infinity } = {}) {
        const rows = asArray(races).map(cleanRace)
            .filter((race) => race.at >= since && race.at <= until)
            .sort((a, b) => b.at - a.at);
        if (!rows.length) {
            return { races: rows, count: 0, best: 0, mean: 0, meanLast10: 0, accuracy: 0, seconds: 0 };
        }
        const mean = (list, pick) => list.reduce((total, race) => total + pick(race), 0) / list.length;
        return {
            races: rows,
            count: rows.length,
            best: Math.max(...rows.map((race) => race.wpm)),
            mean: round1(mean(rows, (race) => race.wpm)),
            meanLast10: round1(mean(rows.slice(0, 10), (race) => race.wpm)),
            accuracy: round1(mean(rows, (race) => race.accuracy)),
            seconds: Math.round(rows.reduce((total, race) => total + race.seconds, 0)),
        };
    }

    // ------------------------------------------------------------ storage

    /**
     * `update(mutate, now)` prunes the days back from `now`. One step at a
     * time matters here too: a race left open in another window still ends,
     * and two can finish together.
     */
    const { load, update } = Store.create({
        keys: [RACES_KEY, GRAMS_KEY, DAYS_KEY],
        read: (stored) => ({
            races: asArray(stored[RACES_KEY]).map(cleanRace),
            grams: pruneGrams(stored[GRAMS_KEY]),
            days: asObject(stored[DAYS_KEY]),
        }),
        clean: (next, now = Date.now()) => ({
            races: asArray(next.races).map(cleanRace).slice(0, RACE_CAP),
            grams: pruneGrams(next.grams),
            days: prune(next.days, now),
        }),
        write: (state) => ({ [RACES_KEY]: state.races, [GRAMS_KEY]: state.grams, [DAYS_KEY]: state.days }),
        blank,
        name: 'the TypeRacer log',
    });

    /** What the content script calls when a race ends. */
    const record = (race, events, now = Date.now()) =>
        update((state) => recordRace(state, race, events, now), count(race && race.at) || now);

    const Typer = {
        RACE_CAP, KEEP_DAYS, GRAM_CAP, GRAM_CAP_TRI, KEEP_N, OUTLIER_MS, FLOOR_MS,
        MIN_SAMPLES, MISTYPE_MIN_DUE, DAY_MS, METRICS,
        slowest, slips, mistyped, baselineFor, wpmFor, heatDays, streak, drill, drillChunk,
        dayKey, blank, blankGrams, foldChar, foldGram, prune, cleanRace,
        gramsFrom, mergeGrams, pruneGrams, recordRace, cleanWpmOf, correctionCost, summarize,
        load, update, record,
        KEYS: [RACES_KEY, GRAMS_KEY, DAYS_KEY],
    };

    root.BB = root.BB || {};
    root.BB.Typer = Typer;
    if (typeof module !== 'undefined' && module.exports) module.exports = Typer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
