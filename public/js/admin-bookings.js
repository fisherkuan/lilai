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

    /*
     * What this file is.
     *
     * There is no build step here, so a page has no other way to know whether the script it
     * is running is the script on disk. A stale service-worker copy has now three times
     * looked like a broken feature — a missing repeat field, a dead Undo, a Cancel button
     * that did nothing — and each time it cost a round of debugging the wrong thing. The
     * server reads this same constant out of the file and reports it; when the two disagree,
     * the page says so instead of misbehaving silently.
     *
     * Bump it when changing anything in public/js or public/styles.css.
     */
    const BUILD = '2026-09-13l';

    const { BRUSSELS, MONTHS } = window.bookingShared;
    const MINUTE = 60000;
    const HOUR = 3600000;
    const DAY = 86400000;

    /*
     * Three outcomes, measured against what this app is for: getting the request in at
     * midnight. "Request sent" is that job done, and it gets a green dot. What KU Leuven
     * decides afterwards is theirs, and this app has no way to observe it.
     *
     * `unconfirmed` is a server status but not a fourth word. It reads as "Request sent"
     * with a clause and a hollow dot, because "failed" invites a re-queue and a re-queue
     * can double-book — while a state of its own made people ask what it meant.
     *
     * `cancelled` is not here at all: nothing was sent, so nothing came back. A cancelled
     * slot stays above the NOW rule, struck through, until its undo runs out.
     */
    const OUTCOMES = {
        sent: { label: 'Request sent', dot: 'solid-success', tone: 'accent' },
        failed: { label: 'Request failed', dot: 'solid-danger', tone: 'danger' },
        missed: { label: 'Missed', dot: 'solid-warning', tone: 'warning' },
        /*
         * The fourth word, and the only one that is about this app rather than about the
         * booking. It appears when submission is switched off: the slot reached its
         * midnight and we deliberately sent nothing. It is not an outcome of a request, so
         * it takes the muted dot — but it has to be visible, because the alternative is a
         * board that says "Request sent" when nothing left the building.
         */
        not_sent: { label: 'Not sent', dot: 'solid-muted', tone: 'muted' }
    };

    const NO_REPLY = '· no reply from the form — check your email before re-queueing';
    const NOT_LIVE = '· submitting is switched off — nothing went to KU Leuven';

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
        live: false,
        showAllUpcoming: false,
        historyShown: HISTORY_AT_REST,
        tickHandle: null,
        tickEvery: 0,
        clockHandle: null,
        midnight: null,
        graceSeconds: 43200,
        cancelUndoSeconds: 300,
        series: [],
        countdownHandle: null,
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

    /*
     * Yes/no is asked in the row, never with window.confirm.
     *
     * A browser can switch page dialogs off — Chrome offers "Prevent this page from creating
     * additional dialogs" after a couple of them, and the setting sticks across reloads for
     * that tab. From then on every confirm() returns false without showing anything, so every
     * action behind one silently does nothing: no dialog, no error, no console line, no clue.
     * Asking in the row cannot be switched off, and it reads better besides.
     */
    function askThen(button, question, yesLabel, run) {
        const row = button.parentNode;
        const kept = [...row.childNodes];
        const put = (nodes) => { row.textContent = ''; for (const item of nodes) row.append(item); };

        const yes = node('button', 'bq-action-link bq-action-danger', yesLabel);
        yes.type = 'button';
        yes.addEventListener('click', () => run(yes));
        const no = node('button', 'bq-action-link', 'Keep it');
        no.type = 'button';
        no.addEventListener('click', () => put(kept));

        put([node('span', 'bq-ask', question), yes, no]);
    }

    /* Trouble is reported in the row too, and for the same reason alert cannot be trusted. */
    function sayTrouble(button, message) {
        const existing = button.parentNode.querySelector('.bq-action-trouble');
        if (existing) existing.remove();
        button.parentNode.append(node('span', 'bq-action-trouble', message));
    }

    /* Something worth saying that outlives the redraw the action causes. */
    function notice(message) {
        const bar = el('bq-notice');
        if (!bar) return;
        bar.textContent = message || '';
        bar.hidden = !message;
    }

    function waitingRow(entry, now) {
        const row = node('li', 'bq-row bq-row-waiting');
        row.dataset.id = entry.id;

        const gutter = node('div', 'bq-gutter');
        const sinceOpen = now - new Date(entry.opensAt);
        if (entry.status === 'cancelled') {
            row.classList.add('bq-row-cancelled');
            gutter.append(node('div', 'bq-gutter-main', 'cancelled'));
            gutter.append(node('div', 'bq-gutter-sub', absoluteOpening(new Date(entry.opensAt), now)));
        } else if (entry.status === 'sending') {
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
        // Name, then the actions directly under it. When the slot was queued is not
        // something anyone reads a row for, and the gutter already carries the date.
        const aside = node('div', 'bq-aside');
        aside.append(node('div', 'bq-who', displayName(entry.name)));
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

        /*
         * A cancelled slot keeps a way back for a short while, and says how long is left.
         * The countdown is not decoration: past it the row leaves the board entirely, and a
         * button that vanishes without warning reads as a fault. The server enforces the
         * same window, so the two cannot disagree.
         */
        if (entry.status === 'cancelled') {
            const left = undoMsLeft(entry, Date.now());
            if (left <= 0) return actions;
            const undo = node('button', 'bq-action-link', 'Undo');
            undo.type = 'button';
            undo.addEventListener('click', () => restoreEntry(entry, undo));
            actions.append(undo);
            const note = node('span', 'bq-action-note', `${countdown(left)} left`);
            note.dataset.undoUntil = String(Date.now() + left);
            actions.append(note);
            startCountdowns();
            return actions;
        }

        // Only a slot still waiting can be acted on. Past rows are a record; the way to
        // repeat one is to queue it fresh, where the dates are chosen deliberately.
        if (entry.status !== 'queued') return actions;

        for (const [label, extra, onclick] of [
            ['Edit', '', () => window.editBookingSheet(entry)],
            ['Duplicate', '', () => window.duplicateBookingSheet(entry)],
            ['Cancel', ' bq-action-danger', null]
        ]) {
            const button = node('button', `bq-action-link${extra}`, label);
            button.type = 'button';
            button.addEventListener('click', onclick || (() => cancelEntry(entry, button)));
            actions.append(button);
        }
        return actions;
    }

    /*
     * Every row button follows one shape: go busy, ask the server, and on any failure come
     * back with the label it had and say what went wrong next to it. Three copies of this
     * had already begun to word the same failure differently.
     */
    async function rowAction(button, { busy, idle, request, failed, onSuccess = () => load() }) {
        button.disabled = true;
        button.textContent = busy;
        try {
            const data = await (await request()).json();
            if (!data.success) {
                button.disabled = false;
                button.textContent = idle;
                sayTrouble(button, data.message || failed);
                return;
            }
            await onSuccess(data);
        } catch (error) {
            button.disabled = false;
            button.textContent = idle;
            sayTrouble(button, 'Could not reach the server. Try again.');
        }
    }

    function restoreEntry(entry, button) {
        return rowAction(button, {
            busy: 'Restoring…', idle: 'Undo', failed: 'Could not restore that slot.',
            request: () => fetch(`/api/bookings/${encodeURIComponent(entry.id)}/restore`, { method: 'POST' })
        });
    }

    /*
     * Cancelling asks once, in the row. A slot someone else queued can be cancelled by
     * anyone who can reach this page — social cost, not authentication, like the rest of
     * the site. The confirm exists because the action cannot be undone, not to gate it.
     */
    function cancelEntry(entry, button) {
        askThen(
            button,
            `Cancel ${entry.sport} on ${dayAndMonth(new Date(entry.startPreferred))}?`,
            'Cancel it',
            (yes) => sendCancel(entry, yes)
        );
    }

    function sendCancel(entry, button) {
        return rowAction(button, {
            busy: 'Cancelling…', idle: 'Cancel it', failed: 'Could not cancel that slot.',
            request: () => fetch(`/api/bookings/${encodeURIComponent(entry.id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
        });
    }

    function sentRow(entry, now) {
        // A POST whose answer we could not read reports as sent, with the clause that says
        // so and a hollow dot. It is not a failure: "failed" invites a re-queue, and a
        // re-queue can double-book.
        const noReply = entry.status === 'unconfirmed';
        const outcome = noReply ? OUTCOMES.sent : (OUTCOMES[entry.status] || OUTCOMES.failed);
        const clause = noReply ? NO_REPLY : (entry.status === 'not_sent' ? NOT_LIVE : null);
        const when = new Date(entry.submittedAt || entry.opensAt);

        const row = node('li', 'bq-row bq-row-sent');
        row.dataset.id = entry.id;

        const gutter = node('div', 'bq-gutter');
        gutter.append(node('div', 'bq-gutter-age', timeSince(when, now)));
        gutter.append(node('div', 'bq-gutter-sub', secondsClockOf(when)));

        const body = node('div', 'bq-body');
        body.append(node('div', 'bq-title', rowTitle(entry)));

        // The dot belongs beside the words it modifies. Appended to the title line it
        // floated 200px away at the far right, modifying nothing anyone could see.
        const line = node('div', 'bq-outcome');
        line.append(node('span', `bq-dot bq-dot-${noReply ? 'ring-success' : outcome.dot}`));
        const words = node('span', '', outcome.label);
        if (clause) {
            words.append(document.createTextNode(' '));
            words.append(node('span', 'bq-outcome-clause', clause));
            line.classList.add('bq-outcome-wrap');
        }
        line.append(words);
        body.append(line);

        const aside = node('div', 'bq-aside');
        aside.append(node('div', 'bq-who', displayName(entry.name)));
        const link = node('a', 'bq-aside-link', 'Details');
        link.href = `/admin/bookings/${entry.id}`;
        aside.append(link);
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

    function emptyAbove() {
        const li = node('li', 'bq-empty');
        li.append(node('div', 'bq-empty-title', 'Nothing has gone out yet.'));
        li.append(node('div', 'bq-empty-note',
            'Everything we have sent stays above this line. Slots still waiting for their midnight are below it.'));
        return li;
    }

    // --- Rendering ----------------------------------------------------------------------

    /** The moment the timeline orders a row by: when we acted, or when we will. */
    function axisMoment(entry) {
        return new Date(entry.submittedAt || entry.opensAt).getTime();
    }

    /*
     * How long a cancelled row may still be undone. Zero once the window has run out, and
     * zero for a cancellation from before the server recorded the moment — which is the
     * right reading: those are long over.
     */
    function undoMsLeft(entry, now) {
        if (entry.status !== 'cancelled' || !entry.cancelledAt) return 0;
        const deadline = new Date(entry.cancelledAt).getTime() + state.cancelUndoSeconds * 1000;
        // A slot whose window has closed cannot come back however recently it was cancelled.
        const sendable = new Date(entry.opensAt).getTime() + state.graceSeconds * 1000;
        return Math.min(deadline, sendable) - now;
    }

    function countdown(ms) {
        const total = Math.max(0, Math.ceil(ms / 1000));
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }

    /*
     * Two redraws the server would also make, applied here so a page left open stays honest
     * between fetches.
     *
     * A cancelled slot stays above the NOW rule for as long as it is on the board at all.
     * It is not an outcome — nothing was sent, so nothing came back — and moving it below
     * the rule filed it with the requests that did go out. Once its undo window has run out
     * it leaves the board altogether: nothing is deleted, but a timeline of things that are
     * NOT happening is noise, and a called-off schedule generates it a dozen rows at a time.
     */
    function reconcile(now) {
        const expired = (entry) => entry.status === 'cancelled' && undoMsLeft(entry, now.getTime()) <= 0;
        const before = state.queued.length + state.history.length;
        state.queued = state.queued.filter((entry) => !expired(entry));
        state.history = state.history.filter((entry) => !expired(entry));
        state.historyShown = Math.max(
            HISTORY_AT_REST,
            state.historyShown - (before - (state.queued.length + state.history.length))
        );

        // Nothing was sent, so nothing came back: a cancelled slot is not an outcome and
        // never belongs below the rule. The server pages it into history all the same, and
        // a cancellation can land there live, so it is lifted back here — otherwise
        // sentRow, which knows only three outcomes, would report it as "Request failed".
        const above = state.history.filter((entry) => entry.status === 'cancelled');
        if (above.length === 0) return;
        const ids = new Set(above.map((entry) => entry.id));
        state.history = state.history.filter((entry) => !ids.has(entry.id));
        state.queued = state.queued.concat(above);
        state.historyShown = Math.max(HISTORY_AT_REST, state.historyShown - above.length);
    }

    /*
     * The page is running code older than the server has. Nothing here can fix that — only a
     * reload can — so it says exactly that, with the reason, rather than letting buttons
     * behave in ways the current code does not explain.
     */
    function showStaleBanner(serverBuild) {
        const banner = el('bq-stale');
        if (!banner) return;
        banner.hidden = !serverBuild || serverBuild === BUILD;
    }

    // --- Recurring schedules ------------------------------------------------------------

    async function loadSeries() {
        try {
            const response = await fetch('/api/booking-series');
            const data = await response.json();
            state.series = data.success ? data.series : [];
        } catch (error) {
            state.series = [];
        }
    }

    // Plural weekday names, because the card states a habit rather than a date.
    const SERIES_WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

    /*
     * The rule in words, because the rule is what the card IS. Saying only the first start
     * time read as a one-off, which is the one thing this card is not.
     *
     * A weekly rule with no weekdays chosen repeats on the day the run starts — the same
     * reading the server expands it with — so the card names that day rather than staying
     * silent about which day it means.
     */
    function rulePhrase(series) {
        const { every, unit, weekdays } = series.rule;
        if (unit !== 'week') return every === 1 ? `every ${unit}` : `every ${every} ${unit}s`;
        const days = (weekdays && weekdays.length > 0)
            ? weekdays
            : [new Date(`${series.startsOn}T12:00:00Z`).getUTCDay()];
        const named = days.map((day) => SERIES_WEEKDAYS[day]).join(', ');
        return every === 1 ? named : `${named}, every ${every} weeks`;
    }

    /*
     * One card per habit, on one line: what it books and how often, then who it is for and
     * how much of it is left. That last count is what the buttons follow — a schedule with
     * eight waiting can be cancelled, one with none has run its course.
     */
    function renderSeries(now) {
        const section = el('bq-series');
        section.hidden = state.series.length === 0;
        if (section.hidden) return;

        el('bq-series-meta').textContent = `${state.series.length} ${state.series.length === 1 ? 'schedule' : 'schedules'}`;
        const list = el('bq-series-list');
        list.textContent = '';

        for (const series of state.series) {
            const card = node('div', 'bq-series-card');

            const main = node('div', 'bq-series-main');
            main.append(node('div', 'bq-series-title',
                `${series.sport} · ${rulePhrase(series)}, ${series.startPreferred}`));

            /*
             * One number: how many are still waiting. What has gone out is in the timeline
             * above the line, and what an edit replaced is nowhere a reader can see — an
             * "8 cancelled" nobody remembers cancelling only asks a question the board
             * cannot answer.
             */
            const left = series.queued > 0
                ? (series.nextPlayDate
                    ? `${series.queued} waiting, next ${dayAndMonth(new Date(`${series.nextPlayDate}T12:00:00Z`))}`
                    : `${series.queued} waiting`)
                : 'nothing waiting';
            main.append(node('div', 'bq-series-rule', [
                series.name, left, `until ${dayAndMonth(new Date(`${series.until}T12:00:00Z`))}`
            ].join(' · ')));

            card.append(main);

            /*
             * "Undo all" outranks "Cancel the rest" while a bulk cancellation is still
             * inside its window: cancelling eleven occurrences and then having to restore
             * them one at a time would not be an undo.
             */
            const undoLeft = series.lastCancelledAt
                ? new Date(series.lastCancelledAt).getTime() + state.cancelUndoSeconds * 1000 - now.getTime()
                : 0;

            const actions = node('div', 'bq-series-actions');
            if (undoLeft > 0) {
                const undo = node('button', 'bq-action-link', 'Undo all');
                undo.type = 'button';
                undo.addEventListener('click', () => seriesAction(series, 'restore-remaining', undo));
                const note = node('span', 'bq-action-note', `${countdown(undoLeft)} left`);
                note.dataset.undoUntil = String(now.getTime() + undoLeft);
                actions.append(undo, note);
                startCountdowns();
            }
            const edit = node('button', 'bq-action-link', 'Edit');
            edit.type = 'button';
            edit.addEventListener('click', () => editSeries(series, edit));
            actions.append(edit);

            if (series.queued > 0) {
                const cancel = node('button', 'bq-action-link bq-action-danger', `Cancel the remaining ${series.queued}`);
                cancel.type = 'button';
                // One click used to cancel a whole season. It asks now, like every other
                // button here: the number in the question is the point of asking.
                cancel.addEventListener('click', () => askThen(
                    cancel,
                    `Cancel ${plural(series.queued, 'booking')} still waiting?`,
                    'Cancel them',
                    (yes) => seriesAction(series, 'cancel-remaining', yes)
                ));
                actions.append(cancel);
            }

            card.append(actions);
            list.append(card);
        }
    }

    /*
     * The rule is on the schedule; duration, players and the rest are on the rows it made.
     * So the sheet is opened from one occurrence, fetched here rather than kept on the card:
     * the board has no use for it until someone actually edits.
     */
    async function editSeries(series, button) {
        button.disabled = true;
        try {
            const response = await fetch(`/api/booking-series/${encodeURIComponent(series.id)}`);
            const data = await response.json();
            if (!data.success) throw new Error(data.message);
            window.editSeriesSheet(data.series, data.template);
        } catch (error) {
            sayTrouble(button, 'Could not open that schedule.');
        } finally {
            button.disabled = false;
        }
    }

    function seriesAction(series, action, button) {
        return rowAction(button, {
            busy: '…', idle: button.textContent, failed: 'That did not work.',
            request: () => fetch(`/api/booking-series/${encodeURIComponent(series.id)}/${action}`, { method: 'POST' }),
            onSuccess: async (data) => {
                /*
                 * Say what could NOT be touched. A request already sent cannot be recalled,
                 * and a bulk button that quietly leaves some behind is exactly the kind of
                 * silence that gets noticed at midnight instead of now.
                 */
                notice(data.alreadyGone > 0
                    ? `${data.alreadyGone} of them had already gone to KU Leuven and cannot be taken back.`
                    : '');
                await load();
            }
        });
    }

    function render() {
        const now = new Date();
        const list = el('bq-timeline');
        list.textContent = '';

        reconcile(now);
        renderSeries(now);
        // Newest first, matching the order the server pages history in.
        state.history.sort((a, b) => axisMoment(b) - axisMoment(a));

        const waiting = state.queued.slice().sort((a, b) => new Date(a.opensAt) - new Date(b.opensAt));
        /*
         * Everything above the rule is a row; only some of it is a slot we are going to
         * send. A cancelled row now holds its place there until its undo runs out, and
         * counting it would say "6 queued" for five, open the midnight banner for
         * something nobody is submitting, and drive the per-second tick for it.
         */
        const pending = waiting.filter((entry) => entry.status !== 'cancelled');

        /*
         * One timeline, read top to bottom as time runs forward: what already happened,
         * then NOW, then what is still coming. Both far ends collapse, because a recurring
         * booking puts seventy slots below the rule and months of outcomes above it, and
         * neither end is what anyone opens this page to see.
         */
        const shownHistory = state.history.slice(0, state.historyShown);
        const heldBack = state.history.length - shownHistory.length;
        if (heldBack > 0 || state.historyHasMore) {
            list.append(foldRow(heldBack > 0 ? `${heldBack} earlier` : 'earlier', loadMore));
        }

        if (state.history.length === 0) {
            list.append(emptyAbove());
        } else {
            // Oldest first, so the most recent outcome sits directly against the NOW rule.
            for (const entry of shownHistory.slice().reverse()) list.append(sentRow(entry, now));
        }

        // The NOW rule renders even with no data: it is the element that explains the layout.
        list.append(nowRule(now));

        if (waiting.length === 0 && state.history.length > 0) {
            list.append(node('li', 'bq-none', 'Nothing queued'));
        }

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

        renderMeta(pending, now);
        renderMidnight(pending, now);
        renderExplainer(waiting);

        // Rows that were not above the rule a moment ago arrive with a fade, so the change
        // is noticed without anything jumping. Only history ids are remembered: the whole
        // point of the fade is the slot that just crossed the NOW rule, and it was in
        // `waiting` right before it crossed.
        for (const entry of state.history) {
            if (state.seen.has(entry.id)) continue;
            const row = list.querySelector(`[data-id="${entry.id}"]`);
            if (row && state.seen.size > 0) row.classList.add('bq-landed');
        }
        for (const entry of state.history) state.seen.add(entry.id);

        scheduleTick(pending, now);
    }

    function renderMeta(pending, now) {
        const meta = el('bq-meta');
        if (pending.length === 0) {
            // The gap above the rule already carries "Nothing queued"; saying it twice,
            // eight pixels apart, reads as a rendering fault rather than as emphasis.
            meta.textContent = state.history.length > 0
                ? 'Everything queued has gone out'
                : 'Nothing queued';
            return;
        }
        const next = new Date(pending[0].opensAt);
        meta.textContent = `${pending.length} queued · nearest window ${absoluteOpening(next, now)}`;
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

        state.midnight = open;
        banner.hidden = !open;

        if (!open) {
            stopClock();
            // The window has just closed: say so once, quietly, instead of vanishing.
            // A dry run reaches its opening and is stamped like any other, but no
            // request left the building. Counting it here would put the lie back one
            // line above the row that corrects it.
            const closed = state.history.filter((entry) =>
                entry.submittedAt && now - new Date(entry.submittedAt) < 60 * 60 * 1000);
            const done = closed.filter((entry) => entry.status !== 'not_sent').length;
            const skipped = closed.length - done;
            if (closed.length > 0) {
                banner.hidden = false;
                banner.classList.add('done');
                el('bq-midnight-headline').textContent = 'Tonight\u2019s window is done';
                el('bq-midnight-sub').textContent = done > 0
                    ? `${plural(done, 'request')} went out.`
                    : `${plural(skipped, 'slot')} reached the window. Submitting is switched off, so nothing was sent.`;
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

    /*
     * Countdowns are repainted in place, not by re-rendering.
     *
     * Driving the whole board from the second hand rebuilt every row once a second, which
     * pulled the buttons out from under the cursor: going to cancel a second slot meant
     * clicking a node that had just been replaced. A countdown changes one string; that is
     * all it may touch. The single re-render that does happen is when one runs out, because
     * the row then has to leave the board.
     */
    function paintCountdowns() {
        const now = Date.now();
        let counting = 0;
        let expired = false;
        for (const element of document.querySelectorAll('[data-undo-until]')) {
            const left = Number(element.dataset.undoUntil) - now;
            if (left <= 0) { expired = true; continue; }
            element.textContent = `${countdown(left)} left`;
            counting += 1;
        }
        if (expired) return load();
        if (counting === 0) stopCountdowns();
    }

    function startCountdowns() {
        if (state.countdownHandle) return;
        state.countdownHandle = setInterval(paintCountdowns, 1000);
    }

    function stopCountdowns() {
        if (state.countdownHandle) clearInterval(state.countdownHandle);
        state.countdownHandle = null;
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
            if (data.graceSeconds) state.graceSeconds = data.graceSeconds;
            if (data.cancelUndoSeconds) state.cancelUndoSeconds = data.cancelUndoSeconds;
            showStaleBanner(data.build);
            await loadSeries();
            render();
        } catch (error) {
            el('bq-meta').textContent = 'Could not load the queue. Refresh to try again.';
            console.error(error);
        }
    }

    async function loadMore() {
        if (state.history.length > state.historyShown) {
            state.historyShown = state.history.length;
            render();
            return;
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
        // Same rule as the server: a cancelled slot whose window has not opened is still
        // ahead of NOW and must not jump into history.
        const stillAhead = ['queued', 'sending'].includes(booking.status)
            || (booking.status === 'cancelled' && new Date(booking.opensAt) > new Date());
        if (stillAhead) {
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
     *
     * A bulk action arrives as one message per row — a repeat of fifty-two is fifty-two
     * messages in the same instant — so the redraw waits for the next frame and happens
     * once, whatever arrived in between.
     */
    let redrawPending = false;
    function receive(booking) {
        applyUpdate(booking);
        if (redrawPending) return;
        redrawPending = true;
        requestAnimationFrame(() => {
            redrawPending = false;
            const anchor = visibleAnchor();
            render();
            restoreAnchor(anchor);
        });
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
            // Silent while it works. "Live" next to the button read as a property of the
            // queue, and a badge that is always on says nothing; the only fact worth a
            // word is that the board has STOPPED updating.
            el('bq-live').hidden = true;
        });
        socket.addEventListener('close', () => {
            state.live = false;
            el('bq-live').hidden = false;
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
        el('bq-queue-btn').addEventListener('click', () => {
            // Step 4 mounts the queue sheet here.
            if (window.openBookingSheet) window.openBookingSheet();
        });
        el('bq-people').addEventListener('click', () => {
            if (window.bookingPeople) window.bookingPeople.openManager();
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
