/*
 * Booking queue board.
 *
 * One merged timeline, split by a NOW rule: slots still waiting for their midnight sit
 * above it, everything already sent sits below. Position is the status, which is why a
 * waiting row carries no chip at all.
 *
 * Ticking is rationed on purpose. Twenty countdowns running for three weeks is noise; the
 * last ten minutes before a window opens is the whole point. See scheduleTick().
 */
(() => {
    'use strict';

    const BRUSSELS = 'Europe/Brussels';
    const MINUTE = 60000;
    const HOUR = 3600000;
    const DAY = 86400000;

    /*
     * The four outcomes. No --success and no ticks anywhere: the best honest result is
     * "the request reached KU Leuven", and a green check would stop someone watching
     * their inbox. "Sent — unconfirmed" is its own state rather than a kind of failure,
     * because the word "failed" invites a re-queue and a re-queue can double-book.
     */
    const OUTCOMES = {
        sent: {
            label: 'Request sent',
            tone: 'accent',
            dot: 'ring',
            clause: 'reply comes by email',
            blurb: 'The request reached KU Leuven. They answer separately, by email, and it can be a no.'
        },
        unconfirmed: {
            label: 'Sent — unconfirmed',
            tone: 'warning',
            dot: 'ring-warning',
            clause: 'we could not read their answer — check your email before queueing it again',
            blurb: 'It may well have gone through. Check the inbox before re-queueing: sending twice can double-book.'
        },
        failed: {
            label: 'Request failed',
            tone: 'danger',
            dot: 'solid-danger',
            clause: 'nothing was booked',
            blurb: 'It did not go through, and nothing was booked.'
        },
        missed: {
            label: 'Missed',
            tone: 'warning',
            dot: 'solid-warning',
            clause: 'queued too late',
            blurb: 'The window passed before we could send it. Nothing broke — the clock ran out.'
        },
        cancelled: {
            label: 'Cancelled',
            tone: 'muted',
            dot: 'solid-muted',
            clause: 'taken out of the queue',
            blurb: 'Removed before it went out.'
        }
    };

    const state = {
        queued: [],
        history: [],
        historyHasMore: false,
        quotaPerWeek: 2,
        live: false,
        pending: [],
        tickHandle: null,
        tickEvery: 0,
        clockHandle: null,
        midnight: null,
        seen: new Set(),
        // Replaced by the server's value on first load; this is only the pre-load default.
        graceSeconds: 300
    };

    const el = (id) => document.getElementById(id);

    // --- Brussels formatting ----------------------------------------------------------

    const partsOf = (() => {
        const fmt = new Intl.DateTimeFormat('en-GB', {
            timeZone: BRUSSELS, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
        });
        return (date) => {
            const out = {};
            for (const part of fmt.formatToParts(date)) {
                if (part.type !== 'literal') out[part.type] = part.value;
            }
            out.hour = String(Number(out.hour) % 24).padStart(2, '0');
            return out;
        };
    })();

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function clockOf(date) {
        const p = partsOf(date);
        return `${p.hour}:${p.minute}`;
    }

    function secondsClockOf(date) {
        const p = partsOf(date);
        return `${p.hour}:${p.minute}:${p.second}`;
    }

    // Whole Brussels days between two instants, counted on the calendar, not in hours.
    function dayGap(from, to) {
        const key = (d) => {
            const p = partsOf(d);
            return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
        };
        return Math.round((key(to) - key(from)) / DAY);
    }

    function dayAndMonth(date) {
        const p = partsOf(date);
        const sameYear = partsOf(new Date()).year === p.year;
        const month = MONTHS[Number(p.month) - 1];
        const base = `${p.weekday} ${Number(p.day)}`;
        return sameYear && dayGap(new Date(), date) < 60 ? base : `${base} ${month}`;
    }

    /** The absolute moment under a waiting row's countdown. */
    function absoluteOpening(opensAt, now) {
        const gap = dayGap(now, opensAt);
        const time = clockOf(opensAt);
        if (gap === 0) return `today ${time}`;
        if (gap === 1 && Number(partsOf(opensAt).hour) < 4) return `tonight ${time}`;
        if (gap === 1) return `tomorrow ${time}`;
        return `${dayAndMonth(opensAt)}, ${time}`;
    }

    /** The countdown itself. Coarse far out, precise when it matters. */
    function timeToOpen(opensAt, now) {
        const ms = opensAt - now;
        if (ms <= 0) return 'any moment';
        if (ms < 10 * MINUTE) {
            const total = Math.floor(ms / 1000);
            return `in ${Math.floor(total / 60)} m ${String(total % 60).padStart(2, '0')} s`;
        }
        if (ms < HOUR) return `in ${Math.round(ms / MINUTE)} m`;
        if (ms < DAY) {
            const hours = Math.floor(ms / HOUR);
            return `in ${hours} h ${Math.floor((ms % HOUR) / MINUTE)} m`;
        }
        const gap = dayGap(now, opensAt);
        if (gap === 1) return 'tomorrow';
        return `in ${gap} days`;
    }

    function timeSince(when, now) {
        const ms = now - when;
        if (ms < MINUTE) return 'just now';
        if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
        if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
        const days = Math.floor(ms / DAY);
        return days === 1 ? 'yesterday' : `${days} days ago`;
    }

    /*
     * "Yuki Chen" shows as "Yuki C." A name without spaces — most Chinese and Japanese
     * names — is shown whole, because chopping it would mangle it rather than shorten it.
     */
    function displayName(name) {
        const parts = String(name || '').trim().split(/\s+/);
        if (parts.length < 2) return parts[0] || '';
        const last = parts[parts.length - 1];
        return `${parts.slice(0, -1).join(' ')} ${last[0]}.`;
    }

    function plural(n, word) {
        return `${n} ${word}${n === 1 ? '' : 's'}`;
    }

    // --- Row content -------------------------------------------------------------------

    function rowTitle(entry) {
        const start = new Date(entry.startPreferred);
        return `${entry.sport} · ${dayAndMonth(start)}, ${clockOf(start)}`;
    }

    function rowDetails(entry) {
        const bits = [];
        const hours = Number(entry.durationHours);
        bits.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}, or ${clockOf(new Date(entry.startAlternative))}`);
        bits.push(plural(entry.players, 'player'));
        const where = entry.facility === 'Andere / Other'
            ? (entry.otherFacility || 'other')
            : (entry.facility || entry.indoorOutdoor.toLowerCase());
        if (where) bits.push(where);
        return bits.join(' · ');
    }

    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function waitingRow(entry, now) {
        const row = node('li', 'bq-row bq-row-waiting');
        row.dataset.id = entry.id;

        const gutter = node('div', 'bq-gutter');
        const windowOpen = new Date(entry.opensAt) <= now;
        if (entry.status === 'sending') {
            gutter.append(node('div', 'bq-gutter-main bq-sending', 'sending'));
            gutter.append(node('div', 'bq-gutter-sub', 'in flight'));
        } else if (windowOpen) {
            gutter.append(node('div', 'bq-gutter-main', 'next'));
            gutter.append(node('div', 'bq-gutter-sub', 'within the minute'));
        } else {
            gutter.append(node('div', 'bq-gutter-main', timeToOpen(new Date(entry.opensAt), now)));
            gutter.append(node('div', 'bq-gutter-sub', absoluteOpening(new Date(entry.opensAt), now)));
        }

        const body = node('div', 'bq-body');
        body.append(node('div', 'bq-title', rowTitle(entry)));
        body.append(node('div', 'bq-details', rowDetails(entry)));

        // Third grid cell: its own column on desktop, stacked under the body on mobile.
        const aside = node('div', 'bq-aside');
        aside.append(node('div', 'bq-who', displayName(entry.name)));
        aside.append(node('div', 'bq-aside-sub', `queued ${dayAndMonth(new Date(entry.queuedAt))}`));

        row.append(gutter, body, aside);
        if (entry.status === 'sending') row.classList.add('bq-inflight');
        return row;
    }

    function sentRow(entry, now) {
        const outcome = OUTCOMES[entry.status] || OUTCOMES.failed;
        const when = new Date(entry.submittedAt || entry.opensAt);

        const row = node('li', 'bq-row bq-row-sent');
        row.dataset.id = entry.id;

        const gutter = node('div', 'bq-gutter');
        gutter.append(node('div', 'bq-gutter-age', timeSince(when, now)));
        gutter.append(node('div', 'bq-gutter-sub', secondsClockOf(when)));

        const body = node('div', 'bq-body');
        const head = node('div', 'bq-sent-head');
        head.append(node('span', 'bq-title', rowTitle(entry)));
        head.append(node('span', `bq-dot bq-dot-${outcome.dot}`));
        body.append(head);
        body.append(node('div', 'bq-outcome', outcome.label));
        // --text-secondary, never muted: this line is what stops "sent" reading as "booked".
        const clause = entry.status === 'cancelled' && entry.cancelledBy
            ? `removed by ${displayName(entry.cancelledBy)}`
            : outcome.clause;
        body.append(node('div', 'bq-clause', `${displayName(entry.name)} · ${clause}`));

        const aside = node('div', 'bq-aside');
        aside.append(node('div', 'bq-who', displayName(entry.name)));
        const link = node('a', 'bq-aside-link', 'details');
        link.href = `/admin/bookings/${entry.id}`;
        const sub = node('div', 'bq-aside-sub');
        sub.append(document.createTextNode(`${dayAndMonth(new Date(entry.queuedAt))} · `), link);
        aside.append(sub);

        row.append(gutter, body, aside);
        row.classList.add(`bq-tone-${outcome.tone}`);
        return row;
    }

    function nowRule(now) {
        const li = node('li', 'bq-now');
        li.append(node('span', 'bq-now-line'));
        const p = partsOf(now);
        li.append(node('span', 'bq-now-pill', `Now · ${p.weekday} ${p.hour}:${p.minute}`));
        li.append(node('span', 'bq-now-line'));
        return li;
    }

    function emptyBelow() {
        const li = node('li', 'bq-empty');
        li.append(node('div', 'bq-empty-title', 'Nothing has gone out yet.'));
        li.append(node('div', 'bq-empty-note',
            'Slots waiting for their midnight appear above this line. Everything we have sent stays below it.'));
        return li;
    }

    // --- Rendering ----------------------------------------------------------------------

    function render() {
        const now = new Date();
        const list = el('bq-timeline');
        list.textContent = '';

        const waiting = state.queued.slice().sort((a, b) => new Date(a.opensAt) - new Date(b.opensAt));
        for (const entry of waiting) list.append(waitingRow(entry, now));

        // The section meta already says "Nothing queued"; only mark the gap when there is
        // history below the rule and the reader needs to see the top half is genuinely empty.
        if (waiting.length === 0 && state.history.length > 0) {
            list.append(node('li', 'bq-none', 'Nothing queued'));
        }

        // The NOW rule renders even with no data: it is the element that explains the layout.
        list.append(nowRule(now));

        if (state.history.length === 0) {
            list.append(emptyBelow());
        } else {
            for (const entry of state.history) list.append(sentRow(entry, now));
        }

        renderMeta(waiting, now);
        renderRail(waiting, now);
        renderMidnight(waiting, now);
        renderExplainer(waiting);

        // Rows that were not below the rule a moment ago arrive with a fade, so the change
        // is noticed without anything jumping. Only history ids are remembered: the whole
        // point of the fade is the slot that just crossed the NOW rule, and it was in
        // `waiting` right before it crossed.
        for (const entry of state.history) {
            if (state.seen.has(entry.id)) continue;
            const row = list.querySelector(`[data-id="${entry.id}"]`);
            if (row && state.seen.size > 0) row.classList.add('bq-landed');
        }
        for (const entry of state.history) state.seen.add(entry.id);

        const more = el('bq-more');
        more.hidden = !state.historyHasMore;
        more.textContent = 'Show earlier';

        scheduleTick(waiting, now);
    }

    function renderMeta(waiting, now) {
        const meta = el('bq-meta');
        if (waiting.length === 0) {
            meta.textContent = 'Nothing queued';
            return;
        }
        const next = new Date(waiting[0].opensAt);
        meta.textContent = `${plural(waiting.length, 'slot')} queued · nearest window ${absoluteOpening(next, now)}`;
    }

    function renderRail(waiting, now) {
        const list = el('bq-key-list');
        list.textContent = '';
        for (const key of ['sent', 'unconfirmed', 'failed', 'missed']) {
            const outcome = OUTCOMES[key];
            const dt = node('dt');
            dt.append(node('span', `bq-dot bq-dot-${outcome.dot}`));
            dt.append(node('span', 'bq-key-label', outcome.label));
            list.append(dt, node('dd', null, outcome.blurb));
        }

        const time = el('bq-tonight-time');
        const note = el('bq-tonight-note');
        if (waiting.length === 0) {
            time.textContent = '—';
            note.textContent = 'Nothing is queued yet.';
            return;
        }
        const next = new Date(waiting[0].opensAt);
        time.textContent = clockOf(next);
        const sameWindow = waiting.filter((entry) => entry.opensAt === waiting[0].opensAt).length;
        const verb = sameWindow === 1 ? '1 request goes' : `${sameWindow} requests go`;
        note.textContent = `${absoluteOpening(next, now)} — ${verb} out then.`;
    }

    /*
     * A window is open while anything is in flight, or while a queued slot is inside its
     * grace period. This is the page's one moment of drama, and the only time the layout
     * changes shape.
     */
    function currentWindow(waiting, now) {
        const grace = state.graceSeconds * 1000;
        const live = waiting.filter((entry) => {
            if (entry.status === 'sending') return true;
            const opensAt = new Date(entry.opensAt).getTime();
            return opensAt <= now.getTime() && now.getTime() <= opensAt + grace;
        });
        if (live.length === 0) return null;

        const opensAt = live.reduce((earliest, entry) =>
            (new Date(entry.opensAt) < new Date(earliest.opensAt) ? entry : earliest), live[0]).opensAt;
        const justSent = state.history.filter((entry) =>
            entry.submittedAt && now - new Date(entry.submittedAt) < grace).length;
        return { entries: live, opensAt, justSent };
    }

    function renderMidnight(waiting, now) {
        const open = currentWindow(waiting, now);
        const banner = el('bq-midnight');
        const quota = el('bq-quota');

        state.midnight = open;
        banner.hidden = !open;
        // The banner replaces the quota line rather than sitting beside it.
        if (open) quota.hidden = true;

        if (!open) {
            stopClock();
            // The window has just closed: say so once, quietly, instead of vanishing.
            const done = state.history.filter((entry) =>
                entry.submittedAt && now - new Date(entry.submittedAt) < 60 * 60 * 1000).length;
            if (done > 0) {
                banner.hidden = false;
                banner.classList.add('done');
                el('bq-midnight-headline').textContent = 'Tonight\u2019s window is done';
                el('bq-midnight-sub').textContent = `${plural(done, 'request')} went out.`;
                el('bq-clock').textContent = '';
                el('bq-midnight').querySelector('.bq-clock-zone').textContent = '';
            }
            return;
        }

        banner.classList.remove('done');
        const playDate = dayAndMonth(new Date(open.entries[0].startPreferred));
        el('bq-midnight-headline').textContent = 'The window is open';
        el('bq-midnight-sub').textContent = `Submitting ${plural(open.entries.length, 'request')} for ${playDate}.`;
        el('bq-midnight').querySelector('.bq-clock-zone').textContent = 'Brussels';
        startClock();
    }

    /*
     * The clock is the ONLY per-second re-render on the page. It touches one text node,
     * rather than dragging the whole timeline through a redraw every second.
     */
    function startClock() {
        if (state.clockHandle) return;
        const paint = () => { el('bq-clock').textContent = secondsClockOf(new Date()); };
        paint();
        state.clockHandle = setInterval(paint, 1000);
    }

    function stopClock() {
        if (state.clockHandle) clearInterval(state.clockHandle);
        state.clockHandle = null;
    }

    function renderExplainer(waiting) {
        const firstVisit = waiting.length === 0 && state.history.length === 0;
        el('bq-explainer').hidden = !firstVisit;
        el('bq-cta-sub').hidden = !firstVisit;
        el('bq-queue-btn').querySelector('.bq-cta-label').textContent =
            firstVisit ? 'Queue the first slot' : 'Queue a slot';
    }

    // --- Ticking ------------------------------------------------------------------------

    /*
     * One timer for the page, at the coarsest cadence the data actually needs:
     * per second only while something is sending or inside its final ten minutes,
     * per minute while anything opens within a day, otherwise not at all.
     */
    function scheduleTick(waiting, now) {
        let every = 0;
        for (const entry of waiting) {
            const ms = new Date(entry.opensAt) - now;
            if (entry.status === 'sending' || (ms > 0 && ms < 10 * MINUTE)) { every = 1000; break; }
            if (ms > 0 && ms < DAY) every = Math.max(every, MINUTE);
        }
        if (every === state.tickEvery) return;
        state.tickEvery = every;
        if (state.tickHandle) clearInterval(state.tickHandle);
        state.tickHandle = every ? setInterval(onTick, every) : null;
    }

    function onTick() {
        if (document.hidden) return;
        render();
    }

    // --- Data ----------------------------------------------------------------------------

    async function load() {
        try {
            const response = await fetch('/api/bookings?limit=20');
            const data = await response.json();
            if (!data.success) throw new Error(data.message || 'Could not load the queue');
            state.queued = data.queued;
            state.history = data.history;
            state.historyHasMore = data.historyHasMore;
            state.quotaPerWeek = data.quotaPerWeek;
            if (data.graceSeconds) state.graceSeconds = data.graceSeconds;
            render();
        } catch (error) {
            el('bq-meta').textContent = 'Could not load the queue. Refresh to try again.';
            console.error(error);
        }
    }

    async function loadMore() {
        const oldest = state.history[state.history.length - 1];
        if (!oldest) return;
        const cursor = oldest.submittedAt || oldest.opensAt;
        const response = await fetch(`/api/bookings?limit=20&before=${encodeURIComponent(cursor)}`);
        const data = await response.json();
        if (!data.success) return;
        state.history = state.history.concat(data.history);
        state.historyHasMore = data.historyHasMore;
        render();
    }

    // --- Live updates -----------------------------------------------------------------------

    function applyUpdate(booking) {
        const drop = (list) => list.filter((entry) => entry.id !== booking.id);
        state.queued = drop(state.queued);
        state.history = drop(state.history);
        if (['queued', 'sending'].includes(booking.status)) {
            state.queued.push(booking);
        } else {
            state.history.unshift(booking);
        }
    }

    /*
     * Never reflow content under someone's finger: an update that would insert a row
     * above where they are reading is held back behind a counter they can tap.
     */
    function receive(booking) {
        const timeline = el('bq-timeline');
        const scrolledIn = window.scrollY > timeline.offsetTop + 40;
        if (scrolledIn) {
            state.pending.push(booking);
            const pill = el('bq-newpill');
            pill.hidden = false;
            pill.textContent = `${plural(state.pending.length, 'update')} — show`;
            return;
        }
        applyUpdate(booking);
        render();
    }

    function flushPending() {
        for (const booking of state.pending) applyUpdate(booking);
        state.pending = [];
        el('bq-newpill').hidden = true;
        render();
    }

    function connect() {
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        let socket;
        try {
            socket = new WebSocket(`${scheme}://${window.location.host}`);
        } catch (error) {
            return;
        }
        socket.addEventListener('open', () => {
            state.live = true;
            el('bq-live').hidden = false;
        });
        socket.addEventListener('close', () => {
            state.live = false;
            el('bq-live').hidden = true;
            setTimeout(connect, 5000);
        });
        socket.addEventListener('message', (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (error) {
                return;
            }
            if (message.type === 'booking_update' && message.booking) receive(message.booking);
        });
    }

    // --- Wiring --------------------------------------------------------------------------

    function init() {
        el('bq-more').addEventListener('click', loadMore);
        el('bq-newpill').addEventListener('click', flushPending);
        el('bq-queue-btn').addEventListener('click', () => {
            // Step 4 mounts the queue sheet here.
            if (window.openBookingSheet) window.openBookingSheet();
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) render();
        });
        load();
        connect();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.bookingBoard = { state, render, load, displayName, timeToOpen, absoluteOpening, OUTCOMES };
})();
