/**
 * A video track and an audio track, each in a fragmented MP4 of its own, as
 * one fragmented MP4 holding both. That is what a downloaded video has to be
 * made from: above 360p neither YouTube nor Vimeo serves a file with picture
 * and sound together, only DASH streams of one each.
 *
 * Remuxed, never re-encoded — every sample is copied byte for byte, and only
 * the boxes that describe them are rewritten:
 *   - the audio's track becomes track 2 everywhere it is named (tkhd, trex,
 *     each fragment's tfhd), since both inputs call their track 1;
 *   - one moov holds both traks, its duration the longer of the two in the
 *     video's timescale;
 *   - the fragments are interleaved by their start times, so a player reads
 *     picture and sound for the same moment from the same stretch of file,
 *     and numbered again in the order they now come.
 * A fragment's sample offsets count from its own moof (both sites set
 * default-base-is-moof), and each moof stays directly in front of its mdat,
 * so those offsets hold as they are. A base offset written as an absolute
 * position is moved by however far its fragment moved.
 *
 * The inputs' sidx indexes are dropped: each indexes one stream's own bytes,
 * and none of them is where it was.
 *
 * Pure, and it never holds a stream in memory: a source is `{ size, read(at,
 * length) }`, only the boxes that describe samples are read, and the result
 * names each mdat by its place in its source for the caller to splice in —
 * a Blob slice in the page, so an hour of video is never copied.
 */
(function (root) {
    'use strict';

    const ascii = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    function getU64(dv, at) {
        return dv.getUint32(at) * 2 ** 32 + dv.getUint32(at + 4);
    }

    function setU64(dv, at, value) {
        dv.setUint32(at, Math.floor(value / 2 ** 32));
        dv.setUint32(at + 4, value % 2 ** 32);
    }

    /** A field that is 32 bits in a version 0 box and 64 in a version 1. */
    const getSized = (dv, at, wide) => (wide ? getU64(dv, at) : dv.getUint32(at));
    const setSized = (dv, at, wide, value) => (wide ? setU64(dv, at, value) : dv.setUint32(at, Math.min(value, 0xFFFFFFFF)));

    /** A box header at `at`: its type, whole size and header length. `end` is where its parent ends. */
    function header(bytes, at, end) {
        const dv = view(bytes);
        let size = dv.getUint32(at);
        let head = 8;
        if (size === 1) {
            size = getU64(dv, at + 8);
            head = 16;
        } else if (size === 0) {
            size = end - at;
        }
        return { type: ascii(bytes, at + 4), at, size, head };
    }

    /** The boxes directly inside bytes[start, end). */
    function boxesIn(bytes, start = 0, end = bytes.length) {
        const out = [];
        for (let at = start; at + 8 <= end;) {
            const box = header(bytes, at, end);
            if (box.size < box.head || at + box.size > end) throw new Error(`A ${box.type} box runs past what holds it`);
            out.push(box);
            at += box.size;
        }
        return out;
    }

    const childOf = (bytes, parent, type) => boxesIn(bytes, parent.at + parent.head, parent.at + parent.size).find((box) => box.type === type) || null;

    /** The box down a path of types: dig(moov, trak, ['mdia', 'mdhd']). */
    const dig = (bytes, parent, types) => types.reduce((at, type) => at && childOf(bytes, at, type), parent);

    /** The top-level boxes of a source, reading their headers and nothing else. */
    async function topLevel(source) {
        const out = [];
        const short = () => new Error('The stream stops in the middle of a box — the download was cut short');
        let at = 0;
        while (at + 8 <= source.size) {
            const box = header(await source.read(at, Math.min(16, source.size - at)), 0, source.size - at);
            // An error page where the stream should be — "<html>…" read as
            // a box — would otherwise say the download was cut short.
            if (!/^[a-z0-9 ]{4}$/i.test(box.type)) throw new Error('This is not an MP4 stream');
            if (box.size < box.head || at + box.size > source.size) throw short();
            out.push({ ...box, at });
            at += box.size;
        }
        // Fewer bytes left than a header: the last box was cut off.
        if (at !== source.size) throw short();
        return out;
    }

    /** A box of `type` around `parts`. */
    function box(type, ...parts) {
        const size = 8 + parts.reduce((sum, part) => sum + part.length, 0);
        const out = new Uint8Array(size);
        view(out).setUint32(0, size);
        for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
        let at = 8;
        for (const part of parts) {
            out.set(part, at);
            at += part.length;
        }
        return out;
    }

    const chars = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

    /** isom, as every player reads it; iso6 for the fragment boxes this carries. */
    const FTYP = box('ftyp', chars('isom'), new Uint8Array([0, 0, 2, 0]), chars('isomiso6mp41'));

    /**
     * Whether a movie header says its samples are encrypted. A DRM stream
     * is refused here as well as upstream: its samples copied out would be
     * a file nothing can play, and decrypting them is not this file's to do.
     */
    function encrypted(moov) {
        return /encv|enca|pssh|sinf/.test(new TextDecoder('latin1').decode(moov));
    }

    /** What merging needs to know of one input's moov. */
    function trackOf(moov) {
        const top = boxesIn(moov)[0];
        if (!top || top.type !== 'moov') throw new Error('Not a movie header');
        const traks = boxesIn(moov, top.head, top.size).filter((one) => one.type === 'trak');
        if (traks.length !== 1) throw new Error(`A stream should hold one track, and this one holds ${traks.length}`);
        const mvhd = childOf(moov, top, 'mvhd');
        const mvex = childOf(moov, top, 'mvex');
        const mdhd = dig(moov, traks[0], ['mdia', 'mdhd']);
        if (!mvhd || !mdhd) throw new Error('A track with no timescale');
        if (!mvex || !childOf(moov, mvex, 'trex')) throw new Error('Not a fragmented stream');
        const dv = view(moov);
        const wide = (at) => moov[at + 8] === 1;
        return {
            moov, top, mvhd, mvex, trak: traks[0],
            movieScale: dv.getUint32(mvhd.at + (wide(mvhd.at) ? 28 : 20)),
            movieDuration: getSized(dv, mvhd.at + (wide(mvhd.at) ? 32 : 24), wide(mvhd.at)),
            mediaScale: dv.getUint32(mdhd.at + (wide(mdhd.at) ? 28 : 20)),
        };
    }

    /** When a fragment starts, in its track's own units: its first traf's tfdt. */
    function decodeTime(moof) {
        const top = boxesIn(moof)[0];
        const tfdt = dig(moof, top, ['traf', 'tfdt']);
        // Without one there is nothing to interleave by; such a fragment
        // goes first, which still plays, only less evenly.
        return tfdt ? getSized(view(moof), tfdt.at + 12, moof[tfdt.at + 8] === 1) : 0;
    }

    /** One input's trak as track `id`, its durations in the merged movie's timescale. */
    function trakFor(track, id, scale) {
        const trak = track.moov.slice(track.trak.at, track.trak.at + track.trak.size);
        const dv = view(trak);
        const top = boxesIn(trak)[0];
        const rescale = (value) => Math.round(value * scale / track.movieScale);
        const tkhd = childOf(trak, top, 'tkhd');
        if (!tkhd) throw new Error('A track with no header');
        const wide = trak[tkhd.at + 8] === 1;
        dv.setUint32(tkhd.at + (wide ? 28 : 20), id);
        setSized(dv, tkhd.at + (wide ? 36 : 28), wide, rescale(track.length));
        const elst = dig(trak, top, ['edts', 'elst']);
        if (elst) {
            const longEntries = trak[elst.at + 8] === 1;
            const count = dv.getUint32(elst.at + 12);
            for (let i = 0, at = elst.at + 16; i < count; i++, at += longEntries ? 20 : 12) {
                setSized(dv, at, longEntries, rescale(getSized(dv, at, longEntries)));
            }
        }
        return trak;
    }

    /** A fragment's moof, renumbered, naming track `track`, with any absolute base moved by `shift`. */
    function moofFor(source, { sequence, track, shift }) {
        const moof = source.slice();
        const dv = view(moof);
        const top = boxesIn(moof)[0];
        for (const inner of boxesIn(moof, top.head, top.size)) {
            if (inner.type === 'mfhd') dv.setUint32(inner.at + 12, sequence);
            if (inner.type !== 'traf') continue;
            const tfhd = childOf(moof, inner, 'tfhd');
            if (!tfhd) throw new Error('A fragment that names no track');
            dv.setUint32(tfhd.at + 12, track);
            if (dv.getUint32(tfhd.at + 8) & 0x000001) setU64(dv, tfhd.at + 16, getU64(dv, tfhd.at + 16) + shift);
        }
        return moof;
    }

    /**
     * `sources` is [video, audio] — or one, which is passed through the same
     * way — each with `seconds`, its length, where its headers might not say
     * it. Resolves to `{ parts, size, seconds }`: `parts` in file order, each
     * either bytes to write or `{ source, at, size }`, an mdat to copy from
     * that source.
     */
    async function merge(sources) {
        const tracks = [];
        for (const [index, source] of sources.entries()) {
            const top = await topLevel(source);
            const moovBox = top.find((one) => one.type === 'moov');
            if (!moovBox) throw new Error('No movie header — this is not an MP4 stream');
            const moov = await source.read(moovBox.at, moovBox.size);
            if (encrypted(moov)) throw new Error('This stream is encrypted (DRM), so it cannot be saved');
            const track = { ...trackOf(moov), fragments: [] };
            // Vimeo packages its streams the way a live one is, length 0 in
            // every header; its playlist says how long each is, and the
            // caller passes that on. Without it a player has no length to
            // seek against.
            track.length = track.movieDuration || Math.round((source.seconds || 0) * track.movieScale);
            for (let i = 0; i + 1 < top.length; i++) {
                if (top[i].type !== 'moof' || top[i + 1].type !== 'mdat') continue;
                const moof = await source.read(top[i].at, top[i].size);
                track.fragments.push({ source: index, track: index + 1, at: top[i].at, moof, mdat: top[i + 1], time: decodeTime(moof) / track.mediaScale });
            }
            if (!track.fragments.length) throw new Error('A stream with no samples in it');
            tracks.push(track);
        }

        const first = tracks[0];
        const scale = first.movieScale;
        const duration = Math.max(...tracks.map((track) => Math.round(track.length * scale / track.movieScale)));

        const mvhd = first.moov.slice(first.mvhd.at, first.mvhd.at + first.mvhd.size);
        const wide = mvhd[8] === 1;
        setSized(view(mvhd), wide ? 32 : 24, wide, duration);
        view(mvhd).setUint32(mvhd.length - 4, tracks.length + 1);

        const trexes = tracks.map((track, index) => {
            const at = childOf(track.moov, track.mvex, 'trex');
            const trex = track.moov.slice(at.at, at.at + at.size);
            view(trex).setUint32(12, index + 1);
            return trex;
        });
        const mehdAt = childOf(first.moov, first.mvex, 'mehd');
        const mehd = mehdAt ? first.moov.slice(mehdAt.at, mehdAt.at + mehdAt.size) : null;
        if (mehd) setSized(view(mehd), 12, mehd[8] === 1, duration);

        const moov = box('moov', mvhd, box('mvex', ...(mehd ? [mehd] : []), ...trexes),
            ...tracks.map((track, index) => trakFor(track, index + 1, scale)));

        const parts = [FTYP, moov];
        let offset = FTYP.length + moov.length;
        const fragments = tracks.flatMap((track) => track.fragments).sort((a, b) => a.time - b.time || a.track - b.track);
        fragments.forEach((fragment, index) => {
            const moof = moofFor(fragment.moof, { sequence: index + 1, track: fragment.track, shift: offset - fragment.at });
            parts.push(moof, { source: fragment.source, at: fragment.mdat.at, size: fragment.mdat.size });
            offset += moof.length + fragment.mdat.size;
        });
        return { parts, size: offset, seconds: duration / scale };
    }

    /** A source over bytes already in memory: for the specs, and for anything small. */
    const bytesSource = (bytes) => ({ size: bytes.length, read: async (at, length) => bytes.subarray(at, at + length) });

    const Mp4Mux = { merge, boxesIn, topLevel, encrypted, bytesSource, box };

    root.BB = root.BB || {};
    root.BB.Mp4Mux = Mp4Mux;
    if (typeof module !== 'undefined' && module.exports) module.exports = Mp4Mux;
})(typeof globalThis !== 'undefined' ? globalThis : this);
