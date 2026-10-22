// Pull the page down from its top to fetch the latest, the way iOS lists do: the page slides
// down, a spinner fills in spoke by spoke in the gap, turns, and the page springs back.
// A sheet, a sideways swipe (the date rail) or a page scrolled down never starts it.
// PullToRefresh.attach(onRefresh) — onRefresh returns a promise; the spinner turns until it settles.
(function (global) {
    'use strict';

    // The page follows at half the finger's travel; past this the release refreshes.
    const TRIGGER = 64;
    const MAX = 120;
    // Where the page waits while the spinner turns.
    const HOLD = 52;
    // A quick answer still spins this long, so the pull visibly did something.
    const MIN_SPIN_MS = 600;
    const SPOKES = 8;
    const BACK = '320ms cubic-bezier(0.32, 0.72, 0, 1)';

    function buildSpinner() {
        const wrap = document.createElement('div');
        wrap.className = 'ptr';
        wrap.setAttribute('aria-hidden', 'true');
        const lines = Array.from({ length: SPOKES }, (_, i) =>
            `<line x1="14" y1="3" x2="14" y2="8.5" opacity="${1 - i * 0.1}" transform="rotate(${i * (360 / SPOKES)} 14 14)" style="visibility:hidden"/>`
        ).join('');
        wrap.innerHTML = `<div class="ptr-spinner" role="status"><svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">${lines}</svg></div>`;
        document.body.appendChild(wrap);
        return wrap;
    }

    function attach(onRefresh) {
        // `top` on a relative <body> moves the page without becoming the frame of fixed elements.
        const page = document.body;
        const wrap = buildSpinner();
        const spinner = wrap.firstElementChild;
        const spokes = [...spinner.querySelectorAll('line')];
        let x0 = 0;
        let y0 = 0;
        let pull = 0;
        let busy = false;
        let state = 'idle'; // idle | maybe | drag

        function place(y, animate) {
            page.style.transition = animate ? `top ${BACK}` : 'none';
            page.style.top = y ? `${y}px` : '';
            spinner.style.transition = animate ? `transform ${BACK}` : 'none';
            spinner.style.transform = `translateY(${Math.max(0, y / 2 - 14)}px)`;
            const shown = busy ? SPOKES : Math.floor((y / TRIGGER) * SPOKES);
            spokes.forEach((l, i) => { l.style.visibility = i < shown ? 'visible' : 'hidden'; });
        }

        function setBusy(on) {
            busy = on;
            spinner.classList.toggle('is-spinning', on);
            wrap.setAttribute('aria-hidden', on ? 'false' : 'true');
            if (on) spinner.setAttribute('aria-label', 'Refreshing');
            else spinner.removeAttribute('aria-label');
        }

        function start(e) {
            if (busy || e.touches.length !== 1 || window.scrollY > 0) return;
            if (e.target.closest && e.target.closest('[role="dialog"]')) return;
            if (document.querySelector('.modal:not(.hidden)')) return;
            state = 'maybe';
            x0 = e.touches[0].clientX;
            y0 = e.touches[0].clientY;
            pull = 0;
        }

        function move(e) {
            if (state === 'idle') return;
            const dx = e.touches[0].clientX - x0;
            const dy = e.touches[0].clientY - y0;
            if (state === 'maybe') {
                if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                if (dy <= 0 || Math.abs(dx) >= dy || window.scrollY > 0) {
                    state = 'idle';
                    return;
                }
                state = 'drag';
            }
            // Ours, not the browser's: no rubber band, no page reload.
            e.preventDefault();
            pull = Math.min(MAX, Math.max(0, dy / 2));
            place(pull, false);
        }

        function end() {
            if (state !== 'drag') {
                state = 'idle';
                return;
            }
            state = 'idle';
            if (pull < TRIGGER) {
                place(0, true);
                return;
            }
            setBusy(true);
            place(HOLD, true);
            const wait = new Promise(r => setTimeout(r, MIN_SPIN_MS));
            Promise.all([Promise.resolve().then(onRefresh).catch(err => console.error('Refresh failed:', err)), wait])
                .finally(() => {
                    setBusy(false);
                    place(0, true);
                });
        }

        page.style.position = 'relative';
        window.addEventListener('touchstart', start, { passive: true });
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', end);
        window.addEventListener('touchcancel', end);
    }

    global.PullToRefresh = { attach };
})(window);
