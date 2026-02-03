/**
 * A zip file, stored rather than compressed: the container the bulk chat
 * export hands over, so forty chats are one download instead of forty, and
 * the one a forge's folder is saved as (src/content/folder-download.js).
 *
 * Stored (method 0) because the whole of the win is the one file. Compressing
 * text would make it smaller, and would need a deflate implementation this
 * repo has no build step to bring in; nobody is short of room for a chat
 * history. The names carry the UTF-8 flag, so a title in Bengali or with an
 * em dash in it arrives as it was written. The time stamps are DOS ones, in
 * local time, because that is all the format has.
 *
 * No zip64. A text export does not come near 4 GB, and if one somehow did,
 * build() throws rather than write an archive whose sizes have wrapped round.
 */
(function (root) {
    'use strict';

    const LIMIT = 0xFFFFFFFF;

    /** CRC-32, the table built once, on first use. */
    let table = null;
    function crc32(bytes) {
        if (!table) {
            table = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
                table[n] = c >>> 0;
            }
        }
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    const encode = (value) => (typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value || []));

    /** A DOS date and time; the format cannot say anything before 1980. */
    function dosTime(ms) {
        const at = new Date(ms || Date.now());
        const year = Math.max(1980, at.getFullYear());
        return {
            time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
            date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
        };
    }

    /** One file as the archive keeps it: its name as UTF-8, its data with that data's size and CRC, and a DOS time. */
    function entry(file) {
        const data = encode(file.data);
        return { name: encode(String(file.name)), data, size: data.length, crc: crc32(data), ...dosTime(file.at) };
    }

    /** `size` bytes, written by `write` through little-endian writers. */
    function record(size, write) {
        const out = new Uint8Array(size);
        const view = new DataView(out.buffer);
        let at = 0;
        write({
            u16: (value) => { view.setUint16(at, value, true); at += 2; },
            u32: (value) => { view.setUint32(at, value, true); at += 4; },
            bytes: (value) => { out.set(value, at); at += value.length; },
        });
        return out;
    }

    /**
     * The archive as its parts, in file order: each header as bytes, and
     * each entry's data as the entry holds it. That may be a Blob — the
     * headers need only its size and CRC — so an archive joined as a Blob
     * is never one more copy of every file in memory.
     */
    function parts(entries) {
        if (entries.length > 0xFFFF) throw new Error('Too many files for a zip without zip64');
        const localSize = entries.reduce((sum, e) => sum + 30 + e.name.length + e.size, 0);
        const centralSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
        if (localSize + centralSize + 22 > LIMIT) throw new Error('Too large for a zip without zip64');

        // Version 2.0, and general-purpose bit 11: the name is UTF-8.
        const head = (w, e) => {
            w.u16(20); w.u16(0x0800); w.u16(0); w.u16(e.time); w.u16(e.date); w.u32(e.crc); w.u32(e.size); w.u32(e.size); w.u16(e.name.length); w.u16(0);
        };

        const out = [];
        const offsets = [];
        let offset = 0;
        for (const e of entries) {
            offsets.push(offset);
            out.push(record(30 + e.name.length, (w) => { w.u32(0x04034B50); head(w, e); w.bytes(e.name); }), e.data);
            offset += 30 + e.name.length + e.size;
        }
        out.push(record(centralSize + 22, (w) => {
            entries.forEach((e, index) => {
                w.u32(0x02014B50);
                w.u16(20);
                head(w, e);
                w.u16(0); w.u16(0); w.u16(0); w.u32(0);
                w.u32(offsets[index]);
                w.bytes(e.name);
            });
            w.u32(0x06054B50);
            w.u16(0); w.u16(0);
            w.u16(entries.length); w.u16(entries.length);
            w.u32(centralSize);
            w.u32(offset);
            w.u16(0);
        }));
        return out;
    }

    /** `files` is [{ name, data (string or bytes), at }]. Returns the archive's bytes. */
    function build(files) {
        const all = parts((files || []).map(entry));
        const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
        let at = 0;
        for (const part of all) {
            out.set(part, at);
            at += part.length;
        }
        return out;
    }

    const Zip = { build, entry, parts, crc32, dosTime };

    root.BB = root.BB || {};
    root.BB.Zip = Zip;
    if (typeof module !== 'undefined' && module.exports) module.exports = Zip;
})(typeof globalThis !== 'undefined' ? globalThis : this);
