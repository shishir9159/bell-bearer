/**
 * The codes two browsers trade to open a peer-to-peer party without any
 * server between them: an invite from the host, a reply from the guest.
 *
 * A WebRTC session description is a couple of kilobytes of SDP, and nearly
 * all of it is the same every time. What actually differs between two
 * connections is small: the ICE username and password, the DTLS
 * certificate's fingerprint, and the addresses to try. So that is all a code
 * carries — packed as bytes, base64url, about 150 characters — and the SDP is
 * rebuilt around it on the other side.
 *
 * Only the *remote* description is rebuilt. Each browser's own description is
 * the one it generated, set untouched, so none of this is SDP munging (which
 * Chrome is deprecating) — a synthesized remote description is ordinary
 * signaling that happens to have arrived compressed.
 *
 *     invite  bbp1i.  ver kind tag | ufrag pwd fingerprint candidates | room secret
 *     reply   bbp1r.  ver kind tag | ufrag pwd fingerprint candidates | mac
 *
 * `tag` names the invite a reply answers: one invite is one peer connection,
 * and a host with three guests pending has three. The secret is minted per
 * invite, and the reply's `mac` is HMAC(secret, the reply's bytes), so a
 * reply is only taken from someone who read that invite. The tracker's sealed
 * blobs (party-tracker.js) use the same packing with no prefix, since the
 * seal already authenticates them.
 */
(function (root) {
    'use strict';

    const FINGERPRINT_BYTES = 32;
    /** Typical is two to four; past this the code stops fitting in a chat message. */
    const MAX_CANDIDATES = 8;
    const TYPES = Object.freeze(['host', 'srflx', 'prflx', 'relay']);
    /** RFC 8445's recommended type preferences, for the priorities rebuilt into SDP. */
    const TYPE_PREF = Object.freeze({ host: 126, prflx: 110, srflx: 100, relay: 0 });
    const ICE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    // ---------------------------------------------------------- addresses

    const validIce = (text, min) => typeof text === 'string' && text.length >= min && text.length <= 255 &&
        [...text].every((ch) => ICE_CHARS.includes(ch));

    function ipv6Bytes(text) {
        const [head, tail = null, extra] = text.split('::');
        if (extra !== undefined) return null;
        const groups = (part) => (part ? part.split(':') : []);
        const left = groups(head);
        const right = tail === null ? [] : groups(tail);
        const fill = 8 - left.length - right.length;
        if (fill < 0 || (tail === null && fill !== 0)) return null;
        const all = [...left, ...Array(fill).fill('0'), ...right];
        if (!all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
        return all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]);
    }

    /** { family, bytes } for an address SDP may carry, or null for one a code cannot. */
    function packAddress(address) {
        const text = String(address).toLowerCase();
        const v4 = text.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (v4) {
            const parts = v4.slice(1).map(Number);
            return parts.every((n) => n <= 255) ? { family: 'ipv4', bytes: parts } : null;
        }
        // Chrome hides a host address behind a random name that only resolves on the LAN.
        const mdns = text.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/);
        if (mdns) {
            const hex = mdns.slice(1).join('');
            return { family: 'mdns', bytes: Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)) };
        }
        const v6 = text.includes(':') ? ipv6Bytes(text) : null;
        return v6 ? { family: 'ipv6', bytes: v6 } : null;
    }

    function unpackAddress(family, bytes) {
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        if (family === 'ipv4') return Array.from(bytes).join('.');
        if (family === 'mdns') return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
        return hex.match(/.{4}/g).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
    }

    // ----------------------------------------------------------------- SDP

    /**
     * What a code needs from a description: {ufrag, pwd, fingerprint,
     * candidates, mid}, or null. TCP candidates are left out — a data channel
     * over ICE-TCP is a last resort that makes the code longer for nothing —
     * and so is anything a code cannot carry.
     */
    function parseSdp(sdp) {
        const desc = { ufrag: null, pwd: null, fingerprint: null, candidates: [], mid: null };
        for (const line of String(sdp || '').split(/\r?\n/)) {
            const [key, ...rest] = line.replace(/^a=/, '').split(':');
            const value = rest.join(':').trim();
            if (key === 'ice-ufrag') desc.ufrag = desc.ufrag || value;
            else if (key === 'ice-pwd') desc.pwd = desc.pwd || value;
            else if (key === 'mid') desc.mid = desc.mid === null ? value : desc.mid;
            else if (key === 'fingerprint' && /^sha-256 /i.test(value)) {
                const hex = value.split(' ')[1].split(':');
                if (hex.length === FINGERPRINT_BYTES) desc.fingerprint = hex.map((h) => parseInt(h, 16));
            } else if (key === 'candidate') {
                const f = value.split(/\s+/);
                const type = f[f.indexOf('typ') + 1];
                const port = Number(f[5]);
                const packed = packAddress(f[4]);
                if (f[1] !== '1' || f[2].toLowerCase() !== 'udp' || !TYPES.includes(type) || !packed || !(port > 0 && port < 65536)) continue;
                const address = unpackAddress(packed.family, packed.bytes);
                if (desc.candidates.some((c) => c.address === address && c.port === port)) continue;
                desc.candidates.push({ type, address, port });
            }
        }
        desc.candidates = desc.candidates.slice(0, MAX_CANDIDATES);
        return validIce(desc.ufrag, 4) && validIce(desc.pwd, 22) && desc.fingerprint ? desc : null;
    }

    /**
     * The remote description, rebuilt. `type` is the side the *remote* peer
     * played: 'offer' (DTLS role left to us) or 'answer' (it took the client
     * role). `mid` has to be the one our own offer used when this is an
     * answer to it; an offer we are answering has its mid chosen here.
     */
    function buildSdp(desc, { type, mid = '0' }) {
        const hex = desc.fingerprint.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
        const lines = [
            'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', `a=group:BUNDLE ${mid}`, 'a=msid-semantic: WMS',
            'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
            ...desc.candidates.map((c, i) => {
                const priority = TYPE_PREF[c.type] * 2 ** 24 + (65535 - i) * 256 + 255;
                const related = c.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0';
                return `a=candidate:${i + 1} 1 udp ${priority} ${c.address} ${c.port} typ ${c.type}${related}`;
            }),
            'a=end-of-candidates', `a=ice-ufrag:${desc.ufrag}`, `a=ice-pwd:${desc.pwd}`, `a=fingerprint:sha-256 ${hex}`,
            `a=setup:${type === 'offer' ? 'actpass' : 'active'}`, `a=mid:${mid}`, 'a=sctp-port:5000', 'a=max-message-size:262144',
        ];
        return lines.join('\r\n') + '\r\n';
    }

    // ------------------------------------------------------------ packing

    const VERSION = 1;
    const PREFIX = Object.freeze({ invite: 'bbp1i.', reply: 'bbp1r.' });
    const KINDS = Object.freeze({ invite: 1, reply: 2, offer: 3, answer: 4 });
    const TAG_BYTES = 4;
    const ROOM_BYTES = 6;
    const SECRET_BYTES = 16;
    const MAC_BYTES = 8;
    const FAMILIES = Object.freeze(['ipv4', 'ipv6', 'mdns']);

    function toBase64Url(bytes) {
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function fromBase64Url(text) {
        if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
        try {
            return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        } catch (_) {
            return null;
        }
    }

    function randomBytes(n) {
        const bytes = new Uint8Array(n);
        root.crypto.getRandomValues(bytes);
        return bytes;
    }

    const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

    function writer() {
        const out = [];
        return {
            byte: (b) => out.push(b & 0xff),
            bytes: (bs) => { for (const b of bs) out.push(b); },
            u16: (n) => out.push((n >> 8) & 0xff, n & 0xff),
            done: () => Uint8Array.from(out),
        };
    }

    /** Reads past the end throw; decode() turns that into null. */
    function reader(bytes) {
        let at = 0;
        const take = (n) => {
            if (at + n > bytes.length) throw new Error('short');
            at += n;
            return bytes.slice(at - n, at);
        };
        return {
            byte: () => take(1)[0],
            bytes: take,
            u16: () => { const [hi, lo] = take(2); return (hi << 8) | lo; },
            left: () => bytes.length - at,
        };
    }

    /**
     * ICE credentials are drawn from exactly the base64 alphabet, so each
     * character is six bits: Chrome's 24-character password is 18 bytes.
     */
    function writeIce(w, text) {
        w.byte(text.length);
        let acc = 0;
        let bits = 0;
        for (const ch of text) {
            acc = ((acc << 6) | ICE_CHARS.indexOf(ch)) & 0xffff;
            bits += 6;
            while (bits >= 8) {
                bits -= 8;
                w.byte(acc >> bits);
            }
        }
        if (bits) w.byte(acc << (8 - bits));
    }

    function readIce(r) {
        const length = r.byte();
        const packed = r.bytes(Math.ceil((length * 6) / 8));
        let text = '';
        let acc = 0;
        let bits = 0;
        for (const b of packed) {
            acc = ((acc << 8) | b) & 0xffff;
            bits += 8;
            while (bits >= 6 && text.length < length) {
                bits -= 6;
                text += ICE_CHARS[(acc >> bits) & 63];
            }
        }
        return text;
    }

    const EXTRAS = { invite: [['room', ROOM_BYTES], ['secret', SECRET_BYTES]], reply: [['mac', MAC_BYTES]], offer: [], answer: [] };

    /** `fields` is {tag, desc} plus the kind's extras, as byte arrays. */
    function pack(kind, fields) {
        const w = writer();
        w.byte(VERSION);
        w.byte(KINDS[kind]);
        w.bytes(fields.tag);
        writeIce(w, fields.desc.ufrag);
        writeIce(w, fields.desc.pwd);
        w.bytes(fields.desc.fingerprint);
        const candidates = fields.desc.candidates.map((c) => ({ ...c, packed: packAddress(c.address) })).filter((c) => c.packed);
        w.byte(candidates.length);
        for (const c of candidates) {
            w.byte((TYPES.indexOf(c.type) << 4) | FAMILIES.indexOf(c.packed.family));
            w.bytes(c.packed.bytes);
            w.u16(c.port);
        }
        for (const [name] of EXTRAS[kind]) w.bytes(fields[name]);
        return w.done();
    }

    /** {kind, tag, desc, …extras} from bytes, or null. */
    function unpack(bytes) {
        try {
            const r = reader(bytes);
            if (r.byte() !== VERSION) return null;
            const kindByte = r.byte();
            const kind = Object.keys(KINDS).find((k) => KINDS[k] === kindByte);
            if (!kind) return null;
            const out = { kind, tag: r.bytes(TAG_BYTES) };
            const desc = { ufrag: readIce(r), pwd: readIce(r), fingerprint: Array.from(r.bytes(FINGERPRINT_BYTES)), candidates: [] };
            for (let n = r.byte(); n > 0; n--) {
                const head = r.byte();
                const type = TYPES[head >> 4];
                const family = FAMILIES[head & 15];
                if (!type || !family) return null;
                const address = unpackAddress(family, r.bytes(family === 'ipv4' ? 4 : 16));
                desc.candidates.push({ type, address, port: r.u16() });
            }
            out.desc = desc;
            for (const [name, size] of EXTRAS[kind]) out[name] = r.bytes(size);
            return r.left() === 0 ? out : null;
        } catch (_) {
            return null;
        }
    }

    async function hmac(secret, bytes) {
        const subtle = root.crypto.subtle;
        const key = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return new Uint8Array(await subtle.sign('HMAC', key, bytes));
    }

    const inviteCode = ({ tag, desc, room, secret }) => PREFIX.invite + toBase64Url(pack('invite', { tag, desc, room, secret }));

    function readInvite(code) {
        const text = String(code || '').trim();
        if (!text.startsWith(PREFIX.invite)) return null;
        const bytes = fromBase64Url(text.slice(PREFIX.invite.length));
        const out = bytes && unpack(bytes);
        return out && out.kind === 'invite' ? out : null;
    }

    /** The reply is signed over everything but its own mac, so it is async. */
    async function replyCode({ tag, desc }, secret) {
        const unsigned = pack('reply', { tag, desc, mac: new Uint8Array(MAC_BYTES) });
        const body = unsigned.slice(0, unsigned.length - MAC_BYTES);
        const mac = (await hmac(secret, body)).slice(0, MAC_BYTES);
        return PREFIX.reply + toBase64Url(Uint8Array.from([...body, ...mac]));
    }

    /** {tag, desc} of a reply, unverified; which secret checks it depends on the tag. */
    function readReply(code) {
        const text = String(code || '').trim();
        if (!text.startsWith(PREFIX.reply)) return null;
        const bytes = fromBase64Url(text.slice(PREFIX.reply.length));
        const out = bytes && unpack(bytes);
        return out && out.kind === 'reply' ? { ...out, body: bytes.slice(0, bytes.length - MAC_BYTES) } : null;
    }

    async function verifyReply(reply, secret) {
        const mac = (await hmac(secret, reply.body)).slice(0, MAC_BYTES);
        return sameBytes(mac, reply.mac);
    }

    const PRIVATE_V4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

    /**
     * The addresses a code gives away, in plain words — the code is a string
     * of letters, and the person pasting it into a chat should be able to see
     * that it holds their public IP and a port.
     */
    function describe(desc) {
        return desc.candidates.map((c) => {
            const where = c.address.includes(':') ? `[${c.address}]:${c.port}` : `${c.address}:${c.port}`;
            if (c.type === 'relay') return `relay ${where}`;
            if (c.address.endsWith('.local')) return 'this computer on your network (address hidden)';
            if (c.type === 'host' && (PRIVATE_V4.test(c.address) || /^f[cd]|^fe80/.test(c.address))) return `local network ${where}`;
            return `public ${where}`;
        });
    }

    const PartyCode = {
        VERSION, PREFIX, KINDS, TAG_BYTES, ROOM_BYTES, SECRET_BYTES, MAC_BYTES, MAX_CANDIDATES, TYPES,
        toBase64Url, fromBase64Url, randomBytes, sameBytes, hmac,
        parseSdp, buildSdp, pack, unpack, inviteCode, readInvite, replyCode, readReply, verifyReply, describe,
    };

    root.BB = root.BB || {};
    root.BB.PartyCode = PartyCode;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyCode;
})(typeof globalThis !== 'undefined' ? globalThis : this);
