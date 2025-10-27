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
     * 'YYYY-MM-DD' in **local** time — the three lines from time-limits.js,
     * pointedly not activity.js's UTC `toISOString().slice(0, 10)`. An evening
     * race east of Greenwich would otherwise land on tomorrow's square.
     */
    function dayKey(ms = Date.now()) {
        const date = new Date(ms);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

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

            const before = slots[depth];
            slots[depth] = { ch, at, ok, dirty: !!before };
            depth++;
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
        const gone = new Set(entries
            .filter(([, entry]) => count(entry.n) < KEEP_N)
            .sort((a, b) => count(a[1].n) - count(b[1].n) || (a[0] < b[0] ? -1 : 1))
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
    function prune(days, now = Date.now()) {
        const oldest = dayKey(now - (KEEP_DAYS - 1) * DAY_MS);
        const out = {};
        for (const [key, bucket] of Object.entries(asObject(days))) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < oldest) continue;
            out[key] = {
                races: count(bucket && bucket.races),
                seconds: count(bucket && bucket.seconds),
                best: Math.max(0, Math.round(num(bucket && bucket.best))),
            };
        }
        return out;
    }

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

    let writeChain = Promise.resolve();

    async function load() {
        try {
            const stored = await chrome.storage.local.get([RACES_KEY, GRAMS_KEY, DAYS_KEY]);
            return {
                races: asArray(stored[RACES_KEY]).map(cleanRace),
                grams: pruneGrams(stored[GRAMS_KEY]),
                days: asObject(stored[DAYS_KEY]),
            };
        } catch (_) {
            // The extension reloading invalidates every content script's
            // context; an empty log draws, a rejection takes the panel down.
            return blank();
        }
    }

    /**
     * Read-modify-write as one atomic step — the serialised shape
     * shared/leetcode.js uses, copied whole. Two tabs finishing a race at once
     * is not hypothetical (a race left open in another window still ends), and
     * without the chain the second write is built on a read taken before the
     * first one landed.
     */
    async function update(mutate, now = Date.now()) {
        const run = async () => {
            const state = await load();
            const next = (await mutate(state)) || state;
            const clean = {
                races: asArray(next.races).map(cleanRace).slice(0, RACE_CAP),
                grams: pruneGrams(next.grams),
                days: prune(next.days, now),
            };
            await chrome.storage.local.set({
                [RACES_KEY]: clean.races, [GRAMS_KEY]: clean.grams, [DAYS_KEY]: clean.days,
            });
            return clean;
        };
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not update the TypeRacer log', error);
            return blank();
        });
        return writeChain;
    }

    /** What the content script calls when a race ends. */
    const record = (race, events, now = Date.now()) =>
        update((state) => recordRace(state, race, events, now), count(race && race.at) || now);

    const Typer = {
        RACE_CAP, KEEP_DAYS, GRAM_CAP, GRAM_CAP_TRI, KEEP_N, OUTLIER_MS, FLOOR_MS, MIN_SAMPLES, DAY_MS,
        dayKey, blank, blankGrams, foldChar, foldGram, prune, cleanRace,
        gramsFrom, mergeGrams, pruneGrams, recordRace, cleanWpmOf, correctionCost, summarize,
        load, update, record,
        KEYS: [RACES_KEY, GRAMS_KEY, DAYS_KEY],
    };

    root.BB = root.BB || {};
    root.BB.Typer = Typer;
    if (typeof module !== 'undefined' && module.exports) module.exports = Typer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
