/**
 * Per-site branding for the dashboard's site launcher and the settings page's
 * site-specific panels: the site's own mark, a name and a one-line
 * description per site Bell Bearer knows how to work with.
 *
 * Each mark is a single hand-picked path lifted from Simple Icons rather
 * than the whole package — there is no bundler here to tree-shake an npm
 * dependency down to the icons actually used, so the same effect is had by
 * only ever copying in the one path a site needs. A site with no vector mark
 * anywhere carries its favicon as an `image` instead.
 *
 * The `id` is the one src/content/site.js#detectSite returns, so a card, a
 * settings panel and the popup all name a site the same way.
 */
(function (root) {
    'use strict';

    const SITES = {
        youtube: {
            id: 'youtube',
            name: 'YouTube',
            description: 'Checkpoints on videos and channel subscriptions organized into topics',
            color: '#FF0000',
            viewBox: '0 0 24 24',
            path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.016 3.016 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.016 3.016 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
        },
        chess: {
            id: 'chess',
            name: 'Chess.com',
            description: 'Games played, win/loss and time management by time control, time at the board',
            color: '#81B64C',
            viewBox: '0 0 24 24',
            path: 'M12 0a3.85 3.85 0 0 0-3.875 3.846A3.84 3.84 0 0 0 9.73 6.969l-2.79 1.85c0 .622.144 1.114.434 1.649H9.83c-.014.245-.014.549-.014.925 0 .025.003.048.006.071-.064 1.353-.507 3.472-3.62 5.842-.816.625-1.423 1.495-1.806 2.533a.33.33 0 0 0-.045.084 8.124 8.124 0 0 0-.39 2.516c0 .1.216 1.561 8.038 1.561s8.038-1.46 8.038-1.561c0-2.227-.824-4.048-2.24-5.133-4.034-3.08-3.586-5.74-3.644-6.838h2.458c.29-.535.434-1.027.434-1.649l-2.79-1.836a3.86 3.86 0 0 0 1.604-3.123A3.873 3.873 0 0 0 13.445.275c-.004-.002-.01.004-.015.004A3.76 3.76 0 0 0 12 0Z',
        },
        lichess: {
            id: 'lichess',
            name: 'Lichess',
            description: 'Games played, win/loss and time management by time control, time at the board',
            // Lichess's mark is black on white; currentColor keeps it legible at night.
            color: 'currentColor',
            viewBox: '0 0 24 24',
            path: 'M10.457 6.161a.237.237 0 0 0-.296.165c-.8 2.785 2.819 5.579 5.214 7.428.653.504 1.216.939 1.591 1.292 1.745 1.642 2.564 2.851 2.733 3.178a.24.24 0 0 0 .275.122c.047-.013 4.726-1.3 3.934-4.574a.257.257 0 0 0-.023-.06L18.204 3.407 18.93.295a.24.24 0 0 0-.262-.293c-1.7.201-3.115.435-4.5 1.425-4.844-.323-8.718.9-11.213 3.539C.334 7.737-.246 11.515.085 14.128c.763 5.655 5.191 8.631 9.081 9.532.993.229 1.974.34 2.923.34 3.344 0 6.297-1.381 7.946-3.85a.24.24 0 0 0-.372-.3c-3.411 3.527-9.002 4.134-13.296 1.444-4.485-2.81-6.202-8.41-3.91-12.749C4.741 4.221 8.801 2.362 13.888 3.31c.056.01.115 0 .165-.029l.335-.197c.926-.546 1.961-1.157 2.873-1.279l-.694 1.993a.243.243 0 0 0 .02.202l6.082 10.192c-.193 2.028-1.706 2.506-2.226 2.611-.287-.645-.814-1.364-2.306-2.803-.422-.407-1.21-.941-2.124-1.56-2.364-1.601-5.937-4.02-5.391-5.984a.239.239 0 0 0-.165-.295z',
        },
        twitter: {
            id: 'twitter',
            // "Twitter", not "X". The site renamed itself; nobody who uses it
            // did, and a one-letter name in a row of proper nouns reads as a
            // rendering fault rather than as a brand. The id stays `twitter`,
            // which is what detectSite has always returned.
            name: 'Twitter',
            description: 'People and posts filed into two sets of topics, and a daily time limit',
            // X's mark is black on white, so it takes the page's ink the way
            // Lichess's does rather than a brand colour that vanishes at night.
            color: 'currentColor',
            viewBox: '0 0 24 24',
            path: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
        },
        leetcode: {
            id: 'leetcode',
            name: 'LeetCode',
            description: 'Problems timed and graded, a review schedule, notes and code templates',
            color: '#FFA116',
            viewBox: '0 0 24 24',
            path: 'M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.94-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-1.045-2.774-1.202l2.015-2.158A1.384 1.384 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z',
        },
        typeracer: {
            id: 'typeracer',
            name: 'TypeRacer',
            description: 'Races logged, the letter pairs you stall on, and what correcting them costs',
            // TypeRacer has no vector mark to lift: Simple Icons does not carry
            // one, and the site ships nothing but a 16px favicon, a typewriter.
            // So that favicon is the mark, as it is, drawn pixelated — smoothed
            // up to card size, sixteen pixels turn to mud.
            viewBox: '0 0 16 16',
            image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAADOUlEQVR42oXNbUzUBQDH8X8vcG4RNajohW1kVAohcOLdgQE3noLyRBd5SNDlwx3n3aEEwp8QeZLjGXXCrBWy7rbaagVzNDmhE1sc3jycVzjJs6m14UbO6uTkAO3/bbeZ81V+t9/Lz36C8KDh4bGbPEiSYPnePyws3efOwjJ/zi/xhy/Azdt3WQgskZGh7hUeTaerfsLhmJh/HP59zsfi0j0KCrTWhzgkZEVFaGhYldN5QXocvj57m4XAMoWFO38OCVlRGbRCZWUXwXk8Myzf/3/864055v0BOjv7+c8JHo8Xp9OD13uDwCP41p1F5nyLzN7yP8S/XJ3lr7/9jIxMEHTBCTX1xxDFVlyuKS5fucr0jJeh7+y0dfSg0xvZrTPS0tqF46yL7x3nuHhxmr4+K2JNOzUNHyNEr5GhVKbT2NhM46FWkuQKSkv3olLlkr9FQ7rqTZRKFeHhz6LV7qauroHi4l3ExSWSXVKLYDCIiGIHfn+AyfNT5OdvIzv7bS7NeKnYLzJz5RoWSzvJyRmo1Vvx+e5itzvR66v5wHAQQSFTsFGRislkJisri8R4GanKDWwv1BAZGYlMJkO/U8tLL64iKmo1ZrOZQk0RG+KT2JiSgeCyqhn9ZD0fmdZz/KCJM0fyOGfL5svOVzlQuQtbVR6TA5sZ71dwqCKW7gMfcrotB5ctl8EjaxGkyR1IZ+Scan0KS4kKyd0AP26GsVco2xLBJds+cO2B8Te49kU4JWkxSO4WmHgXaSwWoVfchm2fnCHxdYY6FJywxHPYnM7J8li+aVLwdYeMo6KCgfIUhvavZbBdia0tgZ69adRtj0Ew7THQW5oDniZwv480Hotx69NMf7YDfhLBmcdvg89RkroGphrggh5pXEa9Lowysxlh9Fgm33avo6sqhVONmZxuUWLvS2PAEkN/7SaGqxMYO5rJycOJdItJDDe/xUi9jNE+FQNN0QicL4Wzydi7wmjWKJCCL5MF4HgNw6YnuWw1gtsMP6i4/lUERSnRSO4mcL0HjjiEz+s19BkTkK9eSVzUC/RUa7HW5lL7zioiwlZSlJPMifpiPi2Xk7sulKjnn6G5rAhrnRpL8cv8CyyYnz+qRn53AAAAAElFTkSuQmCC',
        },
        chatgpt: {
            id: 'chatgpt',
            name: 'ChatGPT',
            description: 'An outline and a branch tree for long chats, pins, prompt templates, a prompt queue and exports',
            // OpenAI's mark, which is ChatGPT's own. The site draws it black on
            // white, so it takes the page's ink the way Lichess's and X's do.
            color: 'currentColor',
            viewBox: '0 0 24 24',
            path: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
        },
        claude: {
            id: 'claude',
            name: 'Claude',
            description: 'The same chat panel as ChatGPT — outline, branches, pins, prompts, a queue — and artifacts in exports',
            color: '#D97757',
            viewBox: '0 0 24 24',
            path: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
        },
        reddit: {
            id: 'reddit',
            name: 'Reddit',
            description: 'A daily time limit, and how much of today has gone to it',
            color: '#FF4500',
            viewBox: '0 0 24 24',
            path: 'M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z',
        },
    };

    const ORDER = ['youtube', 'chess', 'lichess', 'twitter', 'reddit', 'leetcode', 'typeracer', 'chatgpt', 'claude'];

    /**
     * The sites in the order they are shown: the user's own, dragged into
     * place on the dashboard, then any site it does not name yet — a site
     * added after the order was saved turns up at the end rather than
     * nowhere. Unknown and repeated ids in a saved order are passed over.
     */
    function list(order) {
        const seen = new Set();
        const mine = (Array.isArray(order) ? order : []).filter((id) => {
            if (!SITES[id] || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        return mine.concat(ORDER.filter((id) => !seen.has(id))).map((id) => SITES[id]);
    }

    /**
     * Which of the skin's four tints a site's card sits on — fixed per site
     * rather than per slot, so a card dragged elsewhere keeps its colour
     * instead of the whole row repainting under the pointer.
     */
    function tint(id) {
        const at = ORDER.indexOf(id);
        return (at < 0 ? 0 : at % 4) + 1;
    }

    function get(id) {
        return SITES[id] || null;
    }

    /** An inline `<svg>` for the site: its path in its brand color, or its favicon. */
    function svg(id, { size = 24 } = {}) {
        const site = get(id);
        if (!site) return '';
        const mark = site.image
            ? `<image href="${site.image}" width="100%" height="100%" style="image-rendering:pixelated"/>`
            : `<path fill="${site.color}" d="${site.path}"/>`;
        return `<svg viewBox="${site.viewBox}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${mark}</svg>`;
    }

    const SiteIcons = { list, get, svg, tint, ORDER: Object.freeze(ORDER.slice()) };

    root.BB = root.BB || {};
    root.BB.SiteIcons = SiteIcons;
    if (typeof module !== 'undefined' && module.exports) module.exports = SiteIcons;
})(typeof globalThis !== 'undefined' ? globalThis : this);
