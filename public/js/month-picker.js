// MonthPicker: a month calendar in place of a date field (the event form's Day and Until).
// MonthPicker.attach(input) hides the <input type="date"> and draws the month under it; the
// input keeps the value (YYYY-MM-DD), its min, and fires input and change when a day is picked,
// so the form reads it as before. Call refresh() after setting the value or min from code.
// Weeks start on Monday. Days before min are drawn grey and cannot be picked.
(function (root) {
    'use strict';

    const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const pad = (n) => String(n).padStart(2, '0');
    const isoDate = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
    const ARROW = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

    // The cells of one month, Monday first: null for the blanks before day 1 and after the last.
    function monthCells(year, month) {
        const lead = (new Date(year, month, 1).getDay() + 6) % 7;
        const days = new Date(year, month + 1, 0).getDate();
        const cells = Array(lead).fill(null);
        for (let d = 1; d <= days; d += 1) cells.push(isoDate(year, month, d));
        while (cells.length % 7) cells.push(null);
        return cells;
    }

    // ISO date plus n days, by the calendar (no clock, no DST).
    function addDays(iso, n) {
        const [y, m, d] = iso.split('-').map(Number);
        const date = new Date(y, m - 1, d + n);
        return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function attach(input, { label } = {}) {
        const box = document.createElement('div');
        box.className = 'mp';
        box.setAttribute('role', 'group');
        if (label) box.setAttribute('aria-label', label);
        box.innerHTML = `
            <div class="mp-head">
                <button type="button" class="mp-arrow" data-step="-1" aria-label="Previous month">${ARROW('m15 6-6 6 6 6')}</button>
                <span class="mp-month" aria-live="polite"></span>
                <button type="button" class="mp-arrow" data-step="1" aria-label="Next month">${ARROW('m9 6 6 6-6 6')}</button>
            </div>
            <div class="mp-grid">${WEEKDAYS.map(w => `<span class="mp-wd" aria-hidden="true">${w}</span>`).join('')}<div class="mp-days"></div></div>`;
        input.hidden = true;
        input.tabIndex = -1;
        input.after(box);
        const daysEl = box.querySelector('.mp-days');
        const today = () => { const t = new Date(); return isoDate(t.getFullYear(), t.getMonth(), t.getDate()); };
        let view = null; // [year, month]

        function viewOf(iso) {
            const [y, m] = (iso || today()).split('-').map(Number);
            return [y, m - 1];
        }

        function render() {
            const [y, m] = view;
            const min = input.min || '';
            const now = today();
            box.querySelector('.mp-month').textContent = new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
            box.querySelector('[data-step="-1"]').disabled = Boolean(min) && isoDate(y, m, 1) <= min;
            const focusable = input.value && input.value.startsWith(`${y}-${pad(m + 1)}`) ? input.value
                : (now.startsWith(`${y}-${pad(m + 1)}`) && (!min || now >= min) ? now : null);
            daysEl.innerHTML = monthCells(y, m).map((iso) => {
                if (!iso) return '<span class="mp-blank"></span>';
                const off = Boolean(min) && iso < min;
                const name = new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                const classes = ['mp-day', iso === now ? 'is-today' : ''].filter(Boolean).join(' ');
                return `<button type="button" class="${classes}" data-date="${iso}" aria-pressed="${iso === input.value}" aria-label="${name}"`
                    + ` tabindex="${iso === focusable ? 0 : -1}"${off ? ' disabled' : ''}>${Number(iso.slice(8))}</button>`;
            }).join('');
            if (!daysEl.querySelector('[tabindex="0"]')) {
                const first = daysEl.querySelector('.mp-day:not([disabled])');
                if (first) first.tabIndex = 0;
            }
        }

        function choose(iso) {
            input.value = iso;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            render();
        }

        function focusDay(iso) {
            const b = daysEl.querySelector(`[data-date="${iso}"]`);
            if (b) b.focus();
        }

        box.addEventListener('click', (e) => {
            const arrow = e.target.closest('.mp-arrow');
            if (arrow) {
                const d = new Date(view[0], view[1] + Number(arrow.dataset.step), 1);
                view = [d.getFullYear(), d.getMonth()];
                render();
                return;
            }
            const day = e.target.closest('.mp-day');
            if (day && !day.disabled) choose(day.dataset.date);
        });

        // Arrow keys walk the days, a week up or down; crossing a month turns the page.
        daysEl.addEventListener('keydown', (e) => {
            const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
            const day = e.target.closest('.mp-day');
            if (!step || !day) return;
            e.preventDefault();
            const next = addDays(day.dataset.date, step);
            if (input.min && next < input.min) return;
            const [ny, nm] = viewOf(next);
            if (ny !== view[0] || nm !== view[1]) { view = [ny, nm]; render(); }
            daysEl.querySelectorAll('.mp-day').forEach(b => { b.tabIndex = b.dataset.date === next ? 0 : -1; });
            focusDay(next);
        });

        const picker = {
            refresh() { view = viewOf(input.value || (input.min > today() ? input.min : '')); render(); },
            focus() { (daysEl.querySelector('[tabindex="0"]') || box.querySelector('.mp-arrow')).focus(); }
        };
        input.monthPicker = picker;
        picker.refresh();
        return picker;
    }

    const MonthPicker = { attach, monthCells, addDays };
    if (typeof module !== 'undefined' && module.exports) module.exports = MonthPicker;
    else root.MonthPicker = MonthPicker;
})(typeof window !== 'undefined' ? window : globalThis);
