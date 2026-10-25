/*
 * The header's icons as 16x16 pixel sprites, in a Super Mario spirit (owner, 2026-10-25):
 * FAQ a ? block, Donate a coin over a brick, Sign in / Profile a capped head, Report a bug a
 * Goomba-like critter, Admin a star. Drawn for Lilai, not traced from the games.
 *
 * Each sprite is rows of palette letters ('.' is empty); `Sprites.svg(name)` turns one into an
 * inline SVG of 1x1 squares, one path per colour. The colours are fixed: a sprite looks the
 * same in both themes, like the calendar shapes. The links keep their word as aria-label and
 * title, so a screen reader and a long press still name them.
 */
(function (root) {
    'use strict';

    const ART = {
        star: {
            pal: { O: '#d86a10', Y: '#f8b830', K: '#1a1a1a' },
            rows: [
                '.......OO.......', '......OYYO......', '......OYYO......', '.....OYYYYO.....',
                'OOOOOOYYYYOOOOOO', 'OYYYYYYYYYYYYYYO', '.OYYYYKYYKYYYYO.', '..OYYYKYYKYYYO..',
                '...OYYYYYYYYO...', '...OYYYYYYYYO...', '..OYYYYYYYYYYO..', '..OYYYYOOYYYYO..',
                '.OYYYYO..OYYYYO.', '.OYYOO....OOYYO.', 'OYOO........OOYO', 'OO............OO'
            ]
        },
        question: {
            pal: { O: '#f8c878', Y: '#e89a3c', K: '#2a1a0a', D: '#8a4c10' },
            rows: [
                '.OOOOOOOOOOOOOO.', 'OYYYYYYYYYYYYYYK', 'OYKYYYYYYYYYYKYK', 'OYYYYDDDDYYYYYYK',
                'OYYYDDKKDDYYYYYK', 'OYYYDDKYDDKYYYYK', 'OYYYYKKYDDKYYYYK', 'OYYYYYYDDKKYYYYK',
                'OYYYYYDDKKYYYYYK', 'OYYYYYDDKYYYYYYK', 'OYYYYYYKKYYYYYYK', 'OYYYYYDDYYYYYYYK',
                'OYYYYYDDKYYYYYYK', 'OYKYYYYKKYYYYKYK', 'OYYYYYYYYYYYYYYK', 'KKKKKKKKKKKKKKKK'
            ]
        },
        coin: {
            pal: { K: '#111111', W: '#ffffff', Y: '#f8c800', D: '#d89020' },
            rows: [
                '.....KKKKKK.....', '....KWWYYYYK....', '...KWYYYYYYDK...', '..KWYYYYYYYYDK..',
                '..KWYYYWKYYYDK..', '.KWYYYYWKYYYYDK.', '.KWYYYYWKYYYYDK.', '.KWYYYYWKYYYYDK.',
                '.KWYYYYWKYYYYDK.', '.KWYYYYWKYYYYDK.', '.KWYYYYWKYYYYDK.', '..KYYYYKKYYYDK..',
                '..KYYYYYYYYDDK..', '...KYYYYYYDDK...', '....KDDDDDDK....', '.....KKKKKK.....'
            ]
        },
        head: {
            pal: { R: '#e0201c', r: '#9c0c0c', W: '#ffffff', K: '#111111', S: '#fcd2a0', s: '#e0a070', H: '#6b2a08', E: '#2aa8f0', B: '#1868e0', Y: '#f4d400' },
            rows: [
                '.....RRRRRRr....', '...RRWWWWWWWRr..', '..RRRWRWWWRWRRr.', '..RRRWRRWRRWRRr.',
                '.RRRRWRWRWRWRRRr', '.rrrrrrrrrrrrrrr', '..HKKKSSSSKKKH..', '.SHSSESSSSESSHS.',
                '.SHSSESSSSESSHS.', '..HSSSSWsSSSSH..', '..SKKKKssKKKKS..', '..SKKKKKKKKKKS..',
                '...SSKKKKKKSS...', '....ssSSSSss....', '..RRBBRRRRBBRR..', '.RRRBYBBBBYBRRR.'
            ]
        },
        goomba: {
            pal: { B: '#a0521c', T: '#f0c890', W: '#ffffff', K: '#1a1a1a' },
            rows: [
                '......BBBB......', '.....BBBBBB.....', '....BBBBBBBB....', '...BBBBBBBBBB...',
                '..BKKBBBBBBKKB..', '.BBBWKKBBKKWBBB.', '.BBBWKWBBWKWBBB.', 'BBBBWKWBBWKWBBBB',
                'BBBBWWWBBWWWBBBB', 'BBBBBBBBBBBBBBBB', '.BBBBTTTTTTBBBB.', '....TTTTTTTT....',
                '....TTTTTTTT....', '..KKKTTTTTTKKK..', '.KKKKKTTTTKKKKK.', '.KKKKKK..KKKKKK.'
            ]
        }
    };

    function svg(name) {
        const art = ART[name];
        if (!art) return '';
        const paths = {};
        art.rows.forEach((row, y) => [...row].forEach((c, x) => {
            if (c !== '.') (paths[c] = paths[c] || []).push(`M${x} ${y}h1v1h-1z`);
        }));
        return '<svg class="sprite" viewBox="0 0 16 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges">'
            + Object.entries(paths).map(([c, d]) => `<path fill="${art.pal[c]}" d="${d.join('')}"/>`).join('')
            + '</svg>';
    }

    // A header link becomes its sprite; its word moves to aria-label and title.
    function iconize(link, name, label) {
        if (!link) return;
        link.setAttribute('aria-label', label);
        link.title = label;
        if (link.dataset.sprite === name) return;
        link.dataset.sprite = name;
        link.classList.add('hdr-icon');
        link.innerHTML = svg(name);
    }

    function decorate() {
        document.querySelectorAll('.app-header-links').forEach((nav) => {
            iconize(nav.querySelector('[data-hdr="faq"]'), 'question', 'FAQ');
            iconize(nav.querySelector('[data-hdr="donate"]'), 'coin', 'Donate');
        });
    }

    decorate();
    root.Sprites = { svg, iconize };
})(window);
