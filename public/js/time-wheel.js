/*
 * A time picker that scrolls (owner, 2026-10-25): two snapping columns, hours and minutes,
 * in place of a long list. Phones show a <select> as a pop-up list of 48 times; this shows
 * only what the select offers.
 *
 * `TimeWheel.attach(select)` takes over an existing <select> of "HH:MM" options. The select
 * stays in the page, hidden, and keeps the value: forms read `select.value` and listen for
 * `change` as before, and a value set from code shows on the button. A tap on the button opens
 * the wheel under it; Done, a tap outside or Escape puts the scrolled time in the select and
 * fires `change` once. The button also steps through the times with the arrow keys.
 */
(function (root) {
    'use strict';

    const ROW = 40; // px, one row of a column; .tw-cell in lilai.css uses the same height
    const doc = root.document;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    let openWheel = null;

    function times(select) {
        return [...select.options].map(o => o.value).filter(v => /^\d{2}:\d{2}$/.test(v));
    }

    function attach(select, { placeholder = 'Pick a time', fallback = '18:00' } = {}) {
        if (!select || select.dataset.wheel) return null;
        select.dataset.wheel = 'on';

        const button = doc.createElement('button');
        button.type = 'button';
        button.className = `${select.className} tw-button`.replace(/\bselect\b/, '').trim();
        button.setAttribute('aria-haspopup', 'true');
        button.setAttribute('aria-expanded', 'false');
        const label = select.id && doc.querySelector(`label[for="${select.id}"]`);
        const name = select.getAttribute('aria-label') || (label ? label.textContent.trim() : 'Time');
        // The label now names the button; the hidden select leaves the tab order.
        if (label) { button.id = `${select.id}-wheel`; label.htmlFor = button.id; }
        select.hidden = true;
        select.style.display = 'none';
        select.tabIndex = -1;
        select.after(button);

        function show() {
            const v = select.value;
            button.textContent = v || placeholder;
            button.classList.toggle('is-empty', !v);
            button.setAttribute('aria-label', `${name}, ${v || 'not set'}`);
        }

        // A value set from code (the end following the start, a form reset) shows at once.
        Object.defineProperty(select, 'value', {
            configurable: true,
            get() { return valueSetter.get.call(this); },
            set(v) { valueSetter.set.call(this, v); show(); }
        });

        function commit(value) {
            if (!value || value === select.value) return show();
            valueSetter.set.call(select, value);
            show();
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        button.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const list = times(select);
            const i = list.indexOf(select.value);
            const next = i < 0 ? list.indexOf(fallback) : i + (e.key === 'ArrowDown' ? 1 : -1);
            if (next >= 0 && next < list.length) commit(list[next]);
        });

        button.addEventListener('click', () => {
            if (openWheel && openWheel.button === button) return openWheel.close(true);
            if (openWheel) openWheel.close(true);
            open();
        });

        function open() {
            const list = times(select);
            if (!list.length) return;
            const hours = [...new Set(list.map(t => t.slice(0, 2)))];
            const minutesOf = (h) => list.filter(t => t.startsWith(`${h}:`)).map(t => t.slice(3));
            const allMinutes = [...new Set(list.map(t => t.slice(3)))].sort();
            const start = list.includes(select.value) ? select.value
                : list.includes(fallback) ? fallback : list[0];

            const panel = doc.createElement('div');
            panel.className = 'tw-panel';
            panel.innerHTML = '<div class="tw-cols"><div class="tw-band" aria-hidden="true"></div>'
                + `<div class="tw-col" data-col="h" role="listbox" aria-label="Hour" tabindex="0">${hours.map(h => `<div class="tw-cell" role="option" data-v="${h}">${h}</div>`).join('')}</div>`
                + '<span class="tw-colon" aria-hidden="true">:</span>'
                + `<div class="tw-col" data-col="m" role="listbox" aria-label="Minutes" tabindex="0">${allMinutes.map(m => `<div class="tw-cell" role="option" data-v="${m}">${m}</div>`).join('')}</div>`
                + '</div><button type="button" class="btn btn-solid tw-done">Done</button>';
            button.after(panel);
            button.setAttribute('aria-expanded', 'true');

            const hourCol = panel.querySelector('[data-col="h"]');
            const minCol = panel.querySelector('[data-col="m"]');
            const at = (col) => {
                const cells = col.querySelectorAll('.tw-cell');
                return cells[Math.max(0, Math.min(cells.length - 1, Math.round(col.scrollTop / ROW)))];
            };
            const scrollTo = (col, v, smooth) => {
                const cells = [...col.querySelectorAll('.tw-cell')];
                const i = cells.findIndex(c => c.dataset.v === v);
                if (i >= 0) col.scrollTo({ top: i * ROW, behavior: smooth ? 'smooth' : 'auto' });
            };
            // The time under the band; a minute this hour lacks falls back to its nearest.
            function current() {
                const h = at(hourCol).dataset.v;
                const offered = minutesOf(h);
                const m = at(minCol).dataset.v;
                if (offered.includes(m)) return `${h}:${m}`;
                const near = offered.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), offered[0]);
                return `${h}:${near}`;
            }
            function mark() {
                for (const col of [hourCol, minCol]) {
                    const here = at(col);
                    col.querySelectorAll('.tw-cell').forEach(c => c.setAttribute('aria-selected', String(c === here)));
                }
                button.textContent = current();
                button.classList.remove('is-empty');
            }
            for (const col of [hourCol, minCol]) {
                let t = null;
                col.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(mark, 60); }, { passive: true });
                // A tap on a cell scrolls it under the band.
                col.addEventListener('click', (e) => {
                    const cell = e.target.closest('.tw-cell');
                    if (cell) scrollTo(col, cell.dataset.v, true);
                });
                col.addEventListener('keydown', (e) => {
                    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    col.scrollBy({ top: e.key === 'ArrowDown' ? ROW : -ROW, behavior: 'smooth' });
                });
            }
            scrollTo(hourCol, start.slice(0, 2), false);
            scrollTo(minCol, start.slice(3), false);
            requestAnimationFrame(mark);
            panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

            function onOutside(e) {
                if (!panel.contains(e.target) && e.target !== button) wheel.close(true);
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.stopPropagation(); wheel.close(false); button.focus(); }
            }
            const wheel = {
                button,
                close(keep) {
                    if (openWheel === wheel) openWheel = null;
                    doc.removeEventListener('pointerdown', onOutside, true);
                    doc.removeEventListener('keydown', onKey, true);
                    button.setAttribute('aria-expanded', 'false');
                    const value = current();
                    panel.remove();
                    if (keep) commit(value);
                    else show();
                }
            };
            panel.querySelector('.tw-done').addEventListener('click', () => { wheel.close(true); button.focus(); });
            doc.addEventListener('pointerdown', onOutside, true);
            doc.addEventListener('keydown', onKey, true);
            openWheel = wheel;
        }

        show();
        return { refresh: show };
    }

    root.TimeWheel = { attach };
})(window);
