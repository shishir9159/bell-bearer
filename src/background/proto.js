/**
 * The wire format the sowon timer decodes.
 *
 * These two functions are a cross-language contract: the exact byte sequence is
 * asserted here in tests/background.test.js and again in Zig, in
 * sowon-zig/src/server.zig's decodeFocusUpdate test. Change one, change both.
 *
 * Declared on the global object rather than exported, because the test page
 * loads this file as a plain <script>.
 */
(function (root) {
    'use strict';

    const encoder = new TextEncoder();

    /**
     * One length-delimited protobuf field: tag byte, varint length, UTF-8 bytes.
     * @returns {number[]}
     */
    function pbStringField(fieldNumber, str) {
        const data = encoder.encode(str);
        const bytes = [(fieldNumber << 3) | 2];

        let remaining = data.length;
        do {
            bytes.push((remaining & 0x7f) | (remaining > 0x7f ? 0x80 : 0));
            remaining >>>= 7;
        } while (remaining > 0);

        return [...bytes, ...data];
    }

    /**
     * A FocusUpdate wrapped in a gRPC-Web frame: one flag byte (0 = not
     * compressed) then a big-endian uint32 length, then the message.
     * @returns {Uint8Array}
     */
    function encodeFocusUpdateFrame(group, title, domain) {
        const message = [
            ...pbStringField(1, group),
            ...pbStringField(2, title),
            ...pbStringField(3, domain || ''),
        ];

        const frame = new Uint8Array(5 + message.length);
        frame[0] = 0;
        new DataView(frame.buffer).setUint32(1, message.length, false);
        frame.set(message, 5);
        return frame;
    }

    root.pbStringField = pbStringField;
    root.encodeFocusUpdateFrame = encodeFocusUpdateFrame;
})(typeof globalThis !== 'undefined' ? globalThis : self);
