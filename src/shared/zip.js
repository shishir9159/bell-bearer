/**
 * A zip file, stored rather than compressed: the container the bulk chat
 * export hands over, so forty chats are one download instead of forty.
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

    /** `files` is [{ name, data (string or bytes), at }]. Returns the archive's bytes. */
    function build(files) {
        const entries = (files || []).map((file) => {
            const name = encode(String(file.name));
            const data = encode(file.data);
            return { name, data, crc: crc32(data), ...dosTime(file.at) };
        });
        if (entries.length > 0xFFFF) throw new Error('Too many files for a zip without zip64');

        const localSize = entries.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
        const centralSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
        if (localSize + centralSize + 22 > LIMIT) throw new Error('Too large for a zip without zip64');

        const out = new Uint8Array(localSize + centralSize + 22);
        const view = new DataView(out.buffer);
        let at = 0;
        const u16 = (value) => { view.setUint16(at, value, true); at += 2; };
        const u32 = (value) => { view.setUint32(at, value, true); at += 4; };
        const bytes = (value) => { out.set(value, at); at += value.length; };

        // Version 2.0, and general-purpose bit 11: the name is UTF-8.
        const head = (e) => { u16(20); u16(0x0800); u16(0); u16(e.time); u16(e.date); u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0); };

        const offsets = [];
        for (const e of entries) {
            offsets.push(at);
            u32(0x04034B50);
            head(e);
            bytes(e.name);
            bytes(e.data);
        }
        const central = at;
        entries.forEach((e, index) => {
            u32(0x02014B50);
            u16(20);
            head(e);
            u16(0); u16(0); u16(0); u32(0);
            u32(offsets[index]);
            bytes(e.name);
        });
        u32(0x06054B50);
        u16(0); u16(0);
        u16(entries.length); u16(entries.length);
        u32(centralSize);
        u32(central);
        u16(0);
        return out;
    }

    const Zip = { build, crc32, dosTime };

    root.BB = root.BB || {};
    root.BB.Zip = Zip;
    if (typeof module !== 'undefined' && module.exports) module.exports = Zip;
})(typeof globalThis !== 'undefined' ? globalThis : this);
