/**
 * The branch tree, drawn: an SVG string built from ChatTree.layout, the way
 * src/page/spark.js and heat-map.js build theirs.
 *
 * No colour in the markup, only classes, which the skins paint — so the tree
 * follows a skin or a day/night change without being redrawn, like every
 * other surface the extension injects. A prompt is a ring and an answer a dot;
 * the path the page is showing is the accent; a turn under a fork carries its
 * `k/n`, the same numbers the page's own arrows show; a folded run is a
 * segment with its length. Each node has a <title> with its first line, which
 * is the hover.
 *
 * Pure string-building, node-tested.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');

    /** Pixels per slot across and per turn down, and the margin round it all. */
    const DX = 30;
    const DY = 34;
    const PAD = 18;

    const at = (slot) => ({ x: PAD + slot.x * DX, y: PAD + slot.y * DY });

    function nodeHtml(slot, { picked }) {
        const { x, y } = at(slot);
        const classes = ['bb-tree-node', `is-${slot.role}`];
        if (slot.onPath) classes.push('is-path');
        if (picked.includes(slot.id)) classes.push('is-picked');
        const title = `<title>${Dom.escapeHtml(slot.text || (slot.role === 'user' ? 'A prompt' : 'An answer'))}</title>`;

        let mark;
        if (slot.run) {
            mark = `<rect class="bb-tree-run" x="${x - 9}" y="${y - 7}" width="18" height="14" rx="3"></rect>
                    <text class="bb-tree-count" x="${x}" y="${y + 3.5}" text-anchor="middle">${slot.run}</text>`;
        } else if (slot.role === 'user') {
            mark = `<circle class="bb-tree-dot" cx="${x}" cy="${y}" r="6"></circle>`;
        } else {
            mark = `<circle class="bb-tree-dot" cx="${x}" cy="${y}" r="4.5"></circle>`;
        }
        const sib = slot.sib
            ? `<text class="bb-tree-sib" x="${x + 9}" y="${y - 6}">${slot.sib.index}/${slot.sib.count}</text>` : '';
        // A generous invisible target: a 9px dot is a hard thing to hit.
        const hit = `<circle class="bb-tree-hit" cx="${x}" cy="${y}" r="12"></circle>`;
        return `<g class="${classes.join(' ')}" data-bb-chat-node="${Dom.escapeAttr(slot.id)}">${title}${hit}${mark}${sib}</g>`;
    }

    function edgeHtml(edge, byId) {
        const from = at(byId.get(edge.from));
        const to = at(byId.get(edge.to));
        // Straight down when the child is under its parent, and an elbow
        // otherwise, so a fork reads as a fork rather than a fan of diagonals.
        const d = from.x === to.x
            ? `M${from.x} ${from.y}V${to.y}`
            : `M${from.x} ${from.y}V${from.y + DY / 2}H${to.x}V${to.y}`;
        return `<path class="bb-tree-edge${edge.onPath ? ' is-path' : ''}" d="${d}"></path>`;
    }

    /**
     * `picked` is the one or two nodes chosen for comparing; they are marked
     * so a second shift-click knows what the first one was.
     */
    function render(layout, { picked = [] } = {}) {
        if (!layout || !layout.nodes.length) return '';
        const byId = new Map(layout.nodes.map((slot) => [slot.id, slot]));
        const width = PAD * 2 + Math.max(0, layout.width - 1) * DX + 30;
        const height = PAD * 2 + Math.max(0, layout.height - 1) * DY;
        return `<svg class="bb-chat-tree" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
                     role="img" aria-label="The conversation's branches">
            <g class="bb-tree-edges">${layout.edges.map((edge) => edgeHtml(edge, byId)).join('')}</g>
            <g class="bb-tree-nodes">${layout.nodes.map((slot) => nodeHtml(slot, { picked })).join('')}</g>
        </svg>`;
    }

    const ChatTreeView = { render, DX, DY, PAD };

    root.BB = root.BB || {};
    root.BB.ChatTreeView = ChatTreeView;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatTreeView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
