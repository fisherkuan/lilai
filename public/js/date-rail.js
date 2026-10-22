// DateRail: a horizontally scrolling row of day buttons, today plus the next days, each
// showing a mark per event. The screen supplies the events, the selected day, the marks and
// an onSelect callback; the rail owns only its row. Works as a browser global and in Node.
(function (root) {
    'use strict';

    const MAX_MARKS = 3;

    function startOfDay(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function dayKey(d) {
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }

    // `count` local days from `today`, each with its events sorted by start time. Built from
    // calendar fields, not milliseconds, so a DST change never skips or repeats a day.
    function buildDays(today, count, events) {
        const start = startOfDay(today);
        const byKey = {};
        (events || []).forEach(ev => {
            const k = dayKey(new Date(ev.date));
            (byKey[k] = byKey[k] || []).push(ev);
        });
        const days = [];
        for (let i = 0; i < count; i++) {
            const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const key = dayKey(date);
            const list = (byKey[key] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
            days.push({ date, key, events: list, isToday: i === 0, startsMonth: i > 0 && date.getDate() === 1 });
        }
        return days;
    }

    // "22 Oct – 4 Nov"; the year shows only when the range crosses one.
    function rangeLabel(days, locale = 'en-GB') {
        if (!days.length) return '';
        const first = days[0].date;
        const last = days[days.length - 1].date;
        const withYear = first.getFullYear() !== last.getFullYear();
        const fmt = d => d.toLocaleDateString(locale, withYear
            ? { day: 'numeric', month: 'short', year: 'numeric' }
            : { day: 'numeric', month: 'short' });
        return `${fmt(first)} – ${fmt(last)}`;
    }

    // Up to three marks; past three, two marks and "+N" so the row keeps its width.
    function marksFor(events, mark) {
        if (events.length <= MAX_MARKS) return { shown: events.map(mark), more: 0 };
        return { shown: events.slice(0, MAX_MARKS - 1).map(mark), more: events.length - (MAX_MARKS - 1) };
    }

    function dayLabel(day, locale) {
        const full = day.date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
        const n = day.events.length;
        const count = n === 0 ? 'no events' : `${n} event${n === 1 ? '' : 's'}`;
        return `${day.isToday ? 'Today, ' : ''}${full}, ${count}`;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /**
     * Mounts a rail in `container`.
     * opts: { count = 14, events = [], selected = today, onSelect(date, day, { via: 'click' | 'key' }), mark(event) -> HTML,
     *         locale = 'en-GB', label = 'Pick a day', today = new Date() }
     * Returns { update({ events, selected, today }), select(date, { focus }), days, selected }.
     */
    function create(container, opts = {}) {
        const state = {
            count: opts.count || 14,
            events: opts.events || [],
            locale: opts.locale || 'en-GB',
            mark: opts.mark || (() => '<span class="rail-dot"></span>'),
            onSelect: opts.onSelect || (() => {}),
            today: opts.today || new Date(),
            selectedKey: null,
            days: []
        };

        const scroller = document.createElement('div');
        scroller.className = 'rail';
        scroller.setAttribute('role', 'group');
        scroller.setAttribute('aria-label', opts.label || 'Pick a day');
        container.appendChild(scroller);

        function dayButton(day) {
            const pressed = day.key === state.selectedKey;
            const dow = day.date.toLocaleDateString(state.locale, { weekday: 'short' });
            const { shown, more } = marksFor(day.events, state.mark);
            const marks = shown.map(m => `<span class="rail-mark">${m}</span>`).join('')
                + (more ? `<span class="rail-more">+${more}</span>` : '');
            const classes = ['rail-day'];
            if (day.isToday) classes.push('is-today');
            if (day.events.length) classes.push('has-events');
            return `<button type="button" class="${classes.join(' ')}" data-key="${day.key}" aria-pressed="${pressed}" tabindex="${pressed ? 0 : -1}" aria-label="${escapeHtml(dayLabel(day, state.locale))}">`
                + `<span class="rail-dow" aria-hidden="true">${escapeHtml(dow)}</span>`
                + `<span class="rail-num" aria-hidden="true">${day.date.getDate()}</span>`
                + `<span class="rail-marks" aria-hidden="true">${marks}</span>`
                + '</button>';
        }

        function render() {
            state.days = buildDays(state.today, state.count, state.events);
            if (!state.days.some(d => d.key === state.selectedKey)) state.selectedKey = state.days[0].key;
            const hadFocus = scroller.contains(document.activeElement);
            const left = scroller.scrollLeft;
            scroller.innerHTML = state.days.map(day => {
                const month = day.startsMonth
                    ? `<span class="rail-month" aria-hidden="true">${escapeHtml(day.date.toLocaleDateString(state.locale, { month: 'short' }))}</span>`
                    : '';
                return month + dayButton(day);
            }).join('');
            scroller.scrollLeft = left;
            if (hadFocus) buttonFor(state.selectedKey).focus({ preventScroll: true });
        }

        function buttonFor(key) {
            return scroller.querySelector(`.rail-day[data-key="${key}"]`);
        }

        function selectedDay() {
            return state.days.find(d => d.key === state.selectedKey);
        }

        function setSelected(key, { focus = false, notify = false, via = 'click' } = {}) {
            if (!state.days.some(d => d.key === key)) return;
            const changed = key !== state.selectedKey;
            state.selectedKey = key;
            scroller.querySelectorAll('.rail-day').forEach(btn => {
                const on = btn.dataset.key === key;
                btn.setAttribute('aria-pressed', String(on));
                btn.tabIndex = on ? 0 : -1;
            });
            const btn = buttonFor(key);
            if (focus) btn.focus({ preventScroll: true });
            btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            // A click reports even an unchanged day, so the screen can act on a second tap.
            if (notify && (changed || via === 'click')) state.onSelect(new Date(selectedDay().date), selectedDay(), { via });
        }

        scroller.addEventListener('click', e => {
            const btn = e.target.closest('.rail-day');
            if (btn) setSelected(btn.dataset.key, { notify: true, via: 'click' });
        });

        // Arrows step one day, Home and End jump to the ends; the selection follows focus.
        scroller.addEventListener('keydown', e => {
            const i = state.days.findIndex(d => d.key === state.selectedKey);
            const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: state.days.length - 1 }[e.key];
            if (to === undefined) return;
            e.preventDefault();
            const day = state.days[Math.max(0, Math.min(state.days.length - 1, to))];
            setSelected(day.key, { focus: true, notify: true, via: 'key' });
        });

        if (opts.selected) state.selectedKey = dayKey(opts.selected);
        render();

        return {
            update(next = {}) {
                if (next.events) state.events = next.events;
                if (next.today) state.today = next.today;
                if (next.selected) state.selectedKey = dayKey(next.selected);
                render();
            },
            select(date, { focus = false } = {}) {
                setSelected(dayKey(date), { focus });
            },
            get days() { return state.days; },
            get selected() { return selectedDay(); }
        };
    }

    const DateRail = { create, buildDays, rangeLabel, marksFor, dayKey };
    if (typeof module !== 'undefined' && module.exports) module.exports = DateRail;
    else root.DateRail = DateRail;
})(typeof window !== 'undefined' ? window : globalThis);
