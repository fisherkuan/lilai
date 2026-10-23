/*
 * What every sheet does on a phone, whoever opened it: the RSVP sheets, the feedback sheet,
 * the booking sheet and the people manager all get it without opting in.
 *
 * - The page behind an open sheet does not scroll. `overflow: hidden` on the body is not
 *   enough on iOS, so the body is pinned with `position: fixed` at its scroll offset and
 *   put back where it was on the way out.
 * - A sheet lives in the visible part of the screen. iOS lays the keyboard over the page
 *   instead of shrinking it, so a layer pinned to `inset: 0` puts its sheet under the
 *   keyboard. The layer follows `visualViewport` instead (`--vv-top`, `--vv-h`).
 * - The grabber works: drag it (or the sheet's header) up to fill the screen, down to go
 *   back or to dismiss, and tap it to toggle. Dismissing clicks the sheet's own close
 *   button, so each sheet's close rules (a send in flight, a draft kept) still apply.
 *
 * From 640px sheets are drawers from the right and none of the dragging applies.
 */
(function (root) {
    'use strict';

    const LAYERS = '.modal:not(.hidden), .bs-root';
    const SHEETS = '.sheet, .bs-sheet';
    const CLOSE = '.sheet-head .icon-btn, .bs-close';
    const DRAG_FROM = '.sheet-grip, .sheet-head, .bs-mode, .bs-head';
    const NOT_FROM = 'button, a, input, select, textarea, label';
    const SETTLE_MS = 260;
    const FLICK = 0.5; // px per ms

    /*
     * Where a released drag lands. `dy` is how far the finger moved (down is positive),
     * `velocity` its speed at release in px/ms, `height` the sheet's height when the drag
     * began. A flick counts as much as a long drag.
     */
    function settle({ full, dy, velocity, height }) {
        const flickDown = velocity > FLICK;
        const flickUp = velocity < -FLICK;
        if (!full) {
            if (dy > Math.min(120, height * 0.25) || (flickDown && dy > 0)) return 'dismiss';
            if (dy < -60 || (flickUp && dy < 0)) return 'full';
            return 'normal';
        }
        if (dy > height * 0.55) return 'dismiss';
        if (dy > 80 || (flickDown && dy > 0)) return 'normal';
        return 'full';
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { settle };
        return;
    }

    const doc = root.document;
    const html = doc.documentElement;
    const phone = root.matchMedia('(max-width: 639px)');
    const vv = root.visualViewport;
    let lockedAt = null;

    function lock() {
        if (lockedAt !== null) return;
        lockedAt = root.scrollY;
        // Pinning the body drops the scrollbar; padding keeps the page from shifting.
        const bar = root.innerWidth - html.clientWidth;
        if (bar > 0) doc.body.style.paddingRight = `${bar}px`;
        doc.body.style.top = `-${lockedAt}px`;
        html.classList.add('sheet-locked');
        trackViewport();
    }

    function unlock() {
        if (lockedAt === null) return;
        const y = lockedAt;
        lockedAt = null;
        html.classList.remove('sheet-locked');
        doc.body.style.top = '';
        doc.body.style.paddingRight = '';
        html.style.removeProperty('--vv-top');
        html.style.removeProperty('--vv-h');
        // The page jumps back without the smooth scrolling some pages ask for.
        const behavior = html.style.scrollBehavior;
        html.style.scrollBehavior = 'auto';
        root.scrollTo(0, y);
        html.style.scrollBehavior = behavior;
    }

    function trackViewport() {
        if (!vv || lockedAt === null) return;
        html.style.setProperty('--vv-top', `${vv.offsetTop}px`);
        html.style.setProperty('--vv-h', `${vv.height}px`);
        // The sheet just got shorter: keep the field being typed in on screen.
        const active = doc.activeElement;
        if (active && active.closest && active.closest(SHEETS) && active.scrollIntoView) {
            active.scrollIntoView({ block: 'nearest' });
        }
    }

    if (vv) {
        vv.addEventListener('resize', trackViewport);
        vv.addEventListener('scroll', trackViewport);
    }

    // Every sheet gets a real grabber element, so it can take touches and stay on top
    // while the sheet scrolls under it.
    function prepare(sheet) {
        if (sheet.querySelector(':scope > .sheet-grip')) return;
        const grip = doc.createElement('div');
        grip.className = 'sheet-grip';
        grip.setAttribute('aria-hidden', 'true');
        sheet.prepend(grip);
    }

    function sync() {
        const open = doc.querySelectorAll(LAYERS);
        open.forEach(layer => layer.querySelectorAll(SHEETS).forEach(prepare));
        if (open.length) lock();
        else unlock();
        // A sheet put away while full opens at its usual height next time.
        doc.querySelectorAll('.modal.hidden .is-full').forEach(s => s.classList.remove('is-full'));
    }

    new MutationObserver(sync).observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
    sync();

    function animate(sheet, styles, done) {
        sheet.classList.add('is-settling');
        Object.assign(sheet.style, styles);
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            sheet.classList.remove('is-settling');
            done();
        };
        sheet.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, SETTLE_MS + 60);
    }

    function reset(sheet) {
        sheet.style.transform = '';
        sheet.style.height = '';
    }

    function naturalHeight(sheet) {
        const wasFull = sheet.classList.contains('is-full');
        const inline = sheet.style.height;
        sheet.classList.remove('is-full');
        sheet.style.height = '';
        const h = sheet.offsetHeight;
        sheet.classList.toggle('is-full', wasFull);
        sheet.style.height = inline;
        return h;
    }

    function land(sheet, where, current) {
        const layerHeight = sheet.parentElement.clientHeight;
        if (where === 'dismiss') {
            animate(sheet, { transform: `translateY(${layerHeight}px)` }, () => {
                const close = sheet.querySelector(CLOSE);
                if (close) close.click();
                sheet.classList.remove('is-full');
                reset(sheet);
            });
            return;
        }
        const target = where === 'full' ? layerHeight : naturalHeight(sheet);
        sheet.style.height = `${current}px`;
        void sheet.offsetHeight;
        animate(sheet, { transform: '', height: `${target}px` }, () => {
            sheet.classList.toggle('is-full', where === 'full');
            reset(sheet);
        });
    }

    let drag = null;

    doc.addEventListener('pointerdown', e => {
        if (!phone.matches || e.button !== 0 || drag) return;
        const handle = e.target.closest && e.target.closest(DRAG_FROM);
        if (!handle || e.target.closest(NOT_FROM)) return;
        const sheet = handle.closest(SHEETS);
        if (!sheet || !sheet.closest(LAYERS) || sheet.classList.contains('is-settling')) return;
        drag = {
            sheet,
            id: e.pointerId,
            y0: e.clientY,
            full: sheet.classList.contains('is-full'),
            height: sheet.offsetHeight,
            max: sheet.parentElement.clientHeight,
            moved: false,
            fromGrip: handle.classList.contains('sheet-grip'),
            samples: [{ y: e.clientY, t: e.timeStamp }]
        };
        sheet.classList.add('is-dragging');
        try { handle.setPointerCapture(e.pointerId); } catch (_) { /* already gone */ }
    });

    doc.addEventListener('pointermove', e => {
        if (!drag || e.pointerId !== drag.id) return;
        const dy = e.clientY - drag.y0;
        if (!drag.moved && Math.abs(dy) < 4) return;
        drag.moved = true;
        e.preventDefault();
        drag.samples.push({ y: e.clientY, t: e.timeStamp });
        if (drag.samples.length > 5) drag.samples.shift();
        if (dy >= 0) {
            drag.sheet.style.height = drag.full ? '' : `${drag.height}px`;
            drag.sheet.style.transform = `translateY(${dy}px)`;
        } else if (!drag.full) {
            drag.sheet.style.transform = '';
            drag.sheet.style.height = `${Math.min(drag.max, drag.height - dy)}px`;
        }
    }, { passive: false });

    function release(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const { sheet, full, height, moved, samples, y0, fromGrip } = drag;
        drag = null;
        sheet.classList.remove('is-dragging');
        if (!moved) {
            // A tap on the grabber toggles; a tap on the title is just a tap.
            if (fromGrip && e.type === 'pointerup') land(sheet, full ? 'normal' : 'full', sheet.offsetHeight);
            return;
        }
        const first = samples[0];
        const velocity = e.timeStamp > first.t ? (e.clientY - first.y) / (e.timeStamp - first.t) : 0;
        const where = e.type === 'pointercancel'
            ? (full ? 'full' : 'normal')
            : settle({ full, dy: e.clientY - y0, velocity, height });
        land(sheet, where, sheet.offsetHeight);
    }

    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
})(typeof window !== 'undefined' ? window : globalThis);
