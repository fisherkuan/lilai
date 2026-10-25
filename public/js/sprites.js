/*
 * The header's icons as 16x16 pixel sprites, in a Super Mario spirit (owner, 2026-10-25):
 * Report a bug a Goomba-like critter (first), FAQ a ? block, Donate a coin, Sign in a ghost
 * and Profile a capped head (the account link swaps them), Admin a star (last). Drawn for Lilai, not traced from the games.
 *
 * Each sprite is rows of palette letters ('.' is empty); `Sprites.svg(name)` turns one into an
 * inline SVG of 1x1 squares, one path per colour. The colours are fixed: a sprite looks the
 * same in both themes, like the calendar shapes. The links keep their word as aria-label and
 * title, so a screen reader and a long press still name them. The header shows short words
 * unless this device picked the sprites with the footer switch (lilai.headerStyle).
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
        ghost: {
            pal: { K: '#111111', W: '#ffffff', G: '#a8a8a8', R: '#f0283c' },
            rows: [
                '.....KKKKKK.....', '...KKWWWWWWKK...', '..KGWWWWWWWWWK..', '.KGWWWWWWWKWKWK.',
                '.KGWWWWWWWKWKWK.', 'KGWKKWWWWWWWWWWK', 'KGKWWKWWWRWRWRWK', 'KGKWWWWWRRRRRRWK',
                'KGWKWWWWRRRRRRWK', 'KGWWWWWWRRWRRWWK', '.KGWWWWWWRWWRWK.', '.KGGGWWWWWWWWK..',
                '..KKGGGWWWWWKK..', '....KKGGGGKK....', '......KKKK......', '................'
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

    // The header shows short words by default, or sprites when the device chose them
    // (the footer's "Header icons" switch; owner 2026-10-25).
    const MODE_KEY = 'lilai.headerStyle';
    function mode() {
        try { return root.localStorage.getItem(MODE_KEY) === 'icons' ? 'icons' : 'text'; } catch (_) { return 'text'; }
    }

    // A link may keep a line icon in text mode instead of a word (the bug, owner 2026-10-25).
    const textIcons = new WeakMap();

    // Draw one header link (or the bug button) as its sprite, or in text mode as its short word
    // or line icon. The full word stays as aria-label always, and as the tooltip under an icon.
    function draw(link) {
        const { sprite, label, short } = link.dataset;
        const now = mode();
        link.setAttribute('aria-label', label);
        if (link.dataset.drawn === `${sprite}:${now}`) return;
        link.dataset.drawn = `${sprite}:${now}`;
        const glyph = now === 'text' ? textIcons.get(link) : null;
        link.classList.toggle('hdr-icon', now === 'icons');
        link.classList.toggle('hdr-text', now === 'text' && !glyph);
        link.classList.toggle('hdr-glyph', Boolean(glyph));
        if (now === 'icons' || glyph) {
            link.title = label;
            link.innerHTML = glyph || svg(sprite);
        } else {
            link.removeAttribute('title');
            link.textContent = short;
        }
    }

    function iconize(link, name, label, short = label, textIcon = null) {
        if (!link) return;
        if (textIcon) textIcons.set(link, textIcon);
        Object.assign(link.dataset, { sprite: name, label, short });
        draw(link);
    }

    function setMode(next) {
        try { root.localStorage.setItem(MODE_KEY, next); } catch (_) { /* private mode: this page only */ }
        document.querySelectorAll('[data-sprite]').forEach(draw);
        document.dispatchEvent(new CustomEvent('lilai:header', { detail: next }));
    }

    function decorate() {
        document.querySelectorAll('.app-header-links').forEach((nav) => {
            iconize(nav.querySelector('[data-hdr="faq"]'), 'question', 'FAQ');
            iconize(nav.querySelector('[data-hdr="donate"]'), 'coin', 'Donate');
        });
    }

    // Footer: a "Header icons" switch, beside the Dark one and drawn like it.
    function renderSwitch() {
        const footer = document.querySelector('.colophon');
        if (!footer || !document.querySelector('.masthead')) return;
        const row = document.createElement('div');
        row.className = 'footer-toggle';
        row.innerHTML = '<span id="footer-icons-label">Header icons</span>'
            + '<button type="button" class="ios-switch" role="switch" aria-checked="false" aria-labelledby="footer-icons-label"></button>';
        (root.LilaiFooterToggles ? root.LilaiFooterToggles(footer) : footer).appendChild(row);
        const toggle = row.querySelector('.ios-switch');
        const mark = () => toggle.setAttribute('aria-checked', String(mode() === 'icons'));
        row.addEventListener('click', () => setMode(mode() === 'icons' ? 'text' : 'icons'));
        document.addEventListener('lilai:header', mark);
        mark();
    }

    decorate();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderSwitch);
    else renderSwitch();
    root.Sprites = { svg, iconize, setMode, mode };
})(window);
