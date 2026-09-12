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

    /*
     * How much of the timeline is worth showing at rest.
     *
     * A recurring booking puts seventy slots in this queue, and a chronological wall of
     * them buries the one thing the page is for: what goes out next, and what came back.
     * Both far ends collapse behind a count, and the NOW rule stays near the top where it
     * can be read without scrolling.
     */
    const UPCOMING_AT_REST = 8;
    const HISTORY_AT_REST = 6;

    const state = {
        queued: [],
        history: [],
        historyHasMore: false,
        quotaPerWeek: 2,
        live: false,
        showAllUpcoming: false,
        historyShown: HISTORY_AT_REST,
        tickHandle: null,
        tickEvery: 0,
        clockHandle: null,
        midnight: null,
        quota: null,
        seen: new Set()
    };

    const el = (id) => document.getElementById(id);

    /*
     * The soonest play date still worth offering: the next midnight that has not passed,
     * plus fourteen days. The five minutes is a rounding allowance for someone sitting on
     * the page as midnight ticks over, NOT the grace window — grace is twelve hours, and
     * letting it govern this would offer dates whose window opened this morning.
     */
    function earliestPlayDate() {
        const now = new Date();
        const opening = new Date(now);
        opening.setHours(0, 0, 0, 0);
        if (now.getTime() > opening.getTime() + 5 * 60000) opening.setDate(opening.getDate() + 1);
        const play = new Date(opening);
        play.setDate(play.getDate() + 14);
        return play;
    }

    function isoDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /* The name this browser last queued under. Social identity, not auth. */
    function rememberedName() {
        try {
            return (JSON.parse(localStorage.getItem('lilai.booking.requester')) || {}).name || '';
        } catch (error) {
            return '';
        }
    }

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

    // Always name the month. "Sun 4" is ambiguous the moment a queue spans a month end,
    // which a fourteen-day booking window guarantees it will.
    function dayAndMonth(date) {
        const p = partsOf(date);
        const label = `${p.weekday} ${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`;
        return partsOf(new Date()).year === p.year ? label : `${label} ${p.year}`;
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
    // The board shows the whole name. An initial is not enough to tell two people apart,
    // and the name is what the two-a-week gate counts.
    function displayName(name) {
        return String(name || '').trim().replace(/\s+/g, ' ');
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
        const sinceOpen = now - new Date(entry.opensAt);
        if (entry.status === 'sending') {
            gutter.append(node('div', 'bq-gutter-main bq-sending', 'sending'));
            gutter.append(node('div', 'bq-gutter-sub', 'in flight'));
        } else if (sinceOpen >= 0 && sinceOpen < LIVE_WINDOW_MS) {
            gutter.append(node('div', 'bq-gutter-main', 'next'));
            gutter.append(node('div', 'bq-gutter-sub', 'within the minute'));
        } else if (sinceOpen >= 0) {
            // Its window opened a while ago and it has not gone yet: grace is still
            // running. Say so plainly rather than promising it any second now.
            gutter.append(node('div', 'bq-gutter-main', 'catching up'));
            gutter.append(node('div', 'bq-gutter-sub', `opened ${timeSince(new Date(entry.opensAt), now)}`));
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

        aside.append(rowActions(entry));

        row.append(gutter, body, aside);
        if (entry.status === 'sending') row.classList.add('bq-inflight');
        return row;
    }

    /*
     * Edit and Cancel only while a slot is still `queued` — once the scheduler has claimed
     * it there is nothing left to change, so they are absent rather than disabled. Duplicate
     * is always there: the common case is a run of bookings identical but for the date, and
     * repeating one that already went out is just as useful as repeating one still waiting.
     */
    function rowActions(entry) {
        const actions = node('div', 'bq-actions');

        if (entry.status === 'queued') {
            const edit = node('button', 'bq-action-link', 'Edit');
            edit.type = 'button';
            edit.addEventListener('click', () => window.editBookingSheet(entry));
            actions.append(edit);
        }

        const copy = node('button', 'bq-action-link', 'Duplicate');
        copy.type = 'button';
        copy.addEventListener('click', () => window.duplicateBookingSheet(entry));
        actions.append(copy);

        if (entry.status === 'queued') {
            const cancel = node('button', 'bq-action-link bq-action-danger', 'Cancel');
            cancel.type = 'button';
            cancel.addEventListener('click', () => cancelEntry(entry, cancel));
            actions.append(cancel);
        }
        return actions;
    }

    /*
     * Cancelling asks once, in the row. A slot someone else queued can be cancelled by
     * anyone who can reach this page — social cost, not authentication, like the rest of
     * the site. The confirm exists because the action cannot be undone, not to gate it.
     */
    async function cancelEntry(entry, button) {
        const label = `${entry.sport} on ${dayAndMonth(new Date(entry.startPreferred))} for ${displayName(entry.name)}`;
        if (!window.confirm(`Cancel ${label}?\n\nThe slot leaves the queue and no request is sent.`)) return;

        button.disabled = true;
        button.textContent = 'Cancelling…';
        try {
            const response = await fetch(`/api/bookings/${encodeURIComponent(entry.id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cancelledBy: rememberedName() || null })
            });
            const data = await response.json();
            if (!data.success) {
                window.alert(data.message || 'Could not cancel that slot.');
                button.disabled = false;
                button.textContent = 'Cancel';
                return;
            }
            load();
        } catch (error) {
            window.alert('Could not reach the server. Try again.');
            button.disabled = false;
            button.textContent = 'Cancel';
        }
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
        aside.append(rowActions(entry));

        row.append(gutter, body, aside);
        row.classList.add(`bq-tone-${outcome.tone}`);
        return row;
    }

    /* A collapsed run of rows, shown as one line that opens it. */
    function foldRow(label, onclick) {
        const row = node('li', 'bq-fold');
        const button = node('button', 'bq-fold-btn', label);
        button.type = 'button';
        button.addEventListener('click', onclick);
        row.append(button);
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

        // Nearest windows first, so the collapse sits between the near future and the
        // distant one — where the timeline genuinely thins out.
        const upcomingShown = state.showAllUpcoming ? waiting.length : Math.min(waiting.length, UPCOMING_AT_REST);
        for (const entry of waiting.slice(0, upcomingShown)) list.append(waitingRow(entry, now));
        if (waiting.length > upcomingShown) {
            list.append(foldRow(
                `${waiting.length - upcomingShown} further out`,
                () => { state.showAllUpcoming = true; render(); }
            ));
        } else if (state.showAllUpcoming && waiting.length > UPCOMING_AT_REST) {
            list.append(foldRow('Show fewer', () => { state.showAllUpcoming = false; render(); }));
        }

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
            for (const entry of state.history.slice(0, state.historyShown)) list.append(sentRow(entry, now));
        }

        renderMeta(waiting, now);
        renderQuota();
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

        // "Show earlier" reveals what is already loaded before going back to the server,
        // so the common case costs no request.
        const more = el('bq-more');
        const heldBack = state.history.length - state.historyShown;
        more.hidden = heldBack <= 0 && !state.historyHasMore;
        more.textContent = heldBack > 0 ? `Show ${heldBack} earlier` : 'Show earlier';

        scheduleTick(waiting, now);
    }

    function renderMeta(waiting, now) {
        const meta = el('bq-meta');
        if (waiting.length === 0) {
            // The gap above the rule already carries "Nothing queued"; saying it twice,
            // eight pixels apart, reads as a rendering fault rather than as emphasis.
            meta.textContent = state.history.length > 0
                ? 'Everything queued has gone out'
                : 'Nothing queued';
            return;
        }
        const next = new Date(waiting[0].opensAt);
        meta.textContent = `${plural(waiting.length, 'slot')} queued · nearest window ${absoluteOpening(next, now)}`;
    }

    /*
     * A window is open while anything is in flight, or while a slot opened within the last
     * few minutes. This is the page's one moment of drama, and the only time the layout
     * changes shape.
     *
     * Deliberately NOT the grace window. Grace is twelve hours: it exists so a process
     * that was asleep at midnight can still send, and a banner counting seconds all
     * morning would be a lie about what is happening. A slot that does go out late still
     * lifts out of the timeline and lands with a fade, just without the countdown.
     */
    const LIVE_WINDOW_MS = 5 * 60 * 1000;

    function currentWindow(waiting, now) {
        const live = waiting.filter((entry) => {
            if (entry.status === 'sending') return true;
            const opensAt = new Date(entry.opensAt).getTime();
            return opensAt <= now.getTime() && now.getTime() <= opensAt + LIVE_WINDOW_MS;
        });
        if (live.length === 0) return null;

        const opensAt = live.reduce((earliest, entry) =>
            (new Date(entry.opensAt) < new Date(earliest.opensAt) ? entry : earliest), live[0]).opensAt;
        const justSent = state.history.filter((entry) =>
            entry.submittedAt && now - new Date(entry.submittedAt) < LIVE_WINDOW_MS).length;
        return { entries: live, opensAt, justSent };
    }

    function renderMidnight(waiting, now) {
        const open = currentWindow(waiting, now);
        const banner = el('bq-midnight');
        const quota = el('bq-quota');

        state.midnight = open;
        banner.hidden = !open;
        // The banner replaces the quota line rather than sitting beside it, and hands the
        // row back when it closes.
        quota.hidden = open ? true : !state.quota;

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
            const justOpened = ms <= 0 && -ms < LIVE_WINDOW_MS;
            if (entry.status === 'sending' || justOpened || (ms > 0 && ms < 10 * MINUTE)) { every = 1000; break; }
            // Past the live window and still queued: grace is running, so keep the
            // "opened N ago" label honest, just not at a per-second cost.
            if (ms <= 0 || ms < DAY) every = Math.max(every, MINUTE);
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

    /*
     * The quota line only means something once we know who is reading. It is the tally for
     * the soonest week anyone can still book into, which is the week the "Queue a slot"
     * button would land you in.
     */
    async function loadQuota() {
        const name = rememberedName();
        if (!name) { state.quota = null; return; }
        try {
            const playDate = isoDate(earliestPlayDate());
            const response = await fetch(
                `/api/bookings/quota?name=${encodeURIComponent(name)}&playDate=${playDate}`);
            const data = await response.json();
            state.quota = data.success ? data : null;
        } catch (error) {
            state.quota = null;
        }
    }

    function renderQuota() {
        const box = el('bq-quota');
        // While the banner is up it owns this row; renderMidnight decides.
        if (!state.quota) { box.hidden = true; return; }
        const { used, limit, week } = state.quota;

        const pips = el('bq-pips');
        pips.textContent = '';
        // A full week turns amber rather than red: nothing is wrong, there is just no room.
        const fill = used >= limit ? ' used warn' : ' used';
        for (let i = 0; i < limit; i += 1) {
            pips.append(node('span', `bq-pip${i < used ? fill : ''}`, ''));
        }
        el('bq-quota-text').textContent = `${used} of ${limit} slots`;
        el('bq-quota-week').textContent = `week of ${weekLabel(week)}`;
        box.hidden = false;
    }

    // Quota weeks always run Monday to Sunday, so the weekday names are fixed. The month
    // is named once unless the week straddles two.
    function weekLabel(week) {
        if (!week || !week.start || !week.end) return '';
        const [, sm, sd] = week.start.split('-').map(Number);
        const [, em, ed] = week.end.split('-').map(Number);
        const from = sm === em ? `Mon ${sd}` : `Mon ${sd} ${MONTHS[sm - 1]}`;
        return `${from} – Sun ${ed} ${MONTHS[em - 1]}`;
    }

    async function load() {
        try {
            const response = await fetch('/api/bookings?limit=20');
            const data = await response.json();
            if (!data.success) throw new Error(data.message || 'Could not load the queue');
            state.queued = data.queued;
            state.history = data.history;
            state.historyHasMore = data.historyHasMore;
            state.quotaPerWeek = data.quotaPerWeek;
            await loadQuota();
            render();
        } catch (error) {
            el('bq-meta').textContent = 'Could not load the queue. Refresh to try again.';
            console.error(error);
        }
    }

    async function loadMore() {
        if (state.history.length > state.historyShown) {
            state.historyShown = state.history.length;
            return render();
        }
        const oldest = state.history[state.history.length - 1];
        if (!oldest) return;
        const cursor = oldest.submittedAt || oldest.opensAt;
        const response = await fetch(`/api/bookings?limit=20&before=${encodeURIComponent(cursor)}`);
        const data = await response.json();
        if (!data.success) return;
        state.history = state.history.concat(data.history);
        state.historyShown = state.history.length;
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
            // Keep a row that has just landed visible rather than folding it away.
            state.historyShown = Math.max(state.historyShown, 1);
        }
    }

    /*
     * Apply every update at once, and hold the reader's place while doing it.
     *
     * The old behaviour queued updates behind a "show" pill whenever the page was scrolled
     * — which, on a queue seventy rows long, was always, and the pill itself was off-screen
     * at the top. The result looked like a page that simply did not refresh. Anchoring on a
     * row that is actually on screen gives live updates with nothing moving under the eye.
     */
    function receive(booking) {
        const anchor = visibleAnchor();
        applyUpdate(booking);
        render();
        restoreAnchor(anchor);
    }

    /** The first timeline row at or below the top of the viewport, and where it sits. */
    function visibleAnchor() {
        for (const row of el('bq-timeline').children) {
            const top = row.getBoundingClientRect().top;
            if (top >= 0 && row.dataset.id) return { id: row.dataset.id, top };
        }
        return null;
    }

    function restoreAnchor(anchor) {
        if (!anchor) return;
        const row = el('bq-timeline').querySelector(`[data-id="${anchor.id}"]`);
        if (!row) return;
        const shift = row.getBoundingClientRect().top - anchor.top;
        if (shift) window.scrollBy(0, shift);
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

    window.bookingBoard = {
        state, render, load, displayName, timeToOpen, absoluteOpening,
        earliestPlayDate, OUTCOMES
    };
})();
