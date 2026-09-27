/*
 * One entry in full.
 *
 * The heading of the explanation card is the whole point of this page: a request that
 * reached KU Leuven is NOT a booked court. Everything else here is supporting detail.
 */
(() => {
    'use strict';

    const { h, BRUSSELS } = window.bookingShared;

    const OUTCOMES = {
        queued: {
            label: 'Waiting',
            tone: 'muted',
            mark: 'open',
            headline: 'Nothing has been sent yet.',
            blurb: 'This slot is waiting for its window. We submit the form in the first seconds after it opens.'
        },
        sending: {
            label: 'Sending',
            tone: 'sent',
            mark: 'open',
            headline: 'The request is going out now.',
            blurb: 'The window has opened and the form is being submitted.'
        },
        sent: {
            label: 'Request sent',
            tone: 'sent',
            mark: 'solid',
            headline: 'The request went in.',
            blurb: 'It reached KU Leuven inside the opening minute, which is everything this app can do. What they decide is theirs. This entry will not change again.'
        },
        /*
         * Not a state of its own, and not a failure. The request went out; what we could
         * not read is the form's reply. It says "Request sent" like any other, with an
         * open square for the part that is missing — the same vocabulary the board uses,
         * because the two pages describe the same row and disagreeing is worse than either
         * wording. "Failed" invites a re-queue, and a re-queue can double-book.
         */
        unconfirmed: {
            label: 'Request sent',
            tone: 'sent',
            mark: 'open',
            headline: 'The request went in, but the form never answered.',
            blurb: 'It may well have gone through — we simply cannot tell from here. Check your email before queueing this slot again: sending the same one twice can double-book it, and we never retry on our own.'
        },
        /*
         * Submission was switched off when this slot's midnight came round. We know
         * exactly what happened, which is nothing — so it is not `unconfirmed`, and not a
         * failure either: nothing broke. The one page that can explain it, does.
         */
        not_sent: {
            label: 'Not sent',
            tone: 'muted',
            mark: 'slash',
            headline: 'Nothing was submitted.',
            blurb: 'Submitting is switched off on this server, so the slot reached its opening and we deliberately sent no request. KU Leuven never heard about it. Set BOOKING_SUBMIT=live to send for real.'
        },
        /*
         * Still queued, but its window has already opened. Not a status of its own: the
         * row is `queued` until the scheduler claims it. The board calls these "next"
         * for the first five minutes and "catching up" after that; this page must agree,
         * or the same row reads as early on one page and late on the other.
         */
        queued_opening: {
            label: 'Waiting',
            tone: 'muted',
            mark: 'open',
            headline: 'Nothing has been sent yet.',
            blurb: 'Its window has just opened. The form goes out within the minute.'
        },
        queued_late: {
            label: 'Catching up',
            tone: 'muted',
            mark: 'open',
            headline: 'Nothing has been sent yet.',
            blurb: 'Its window opened a while ago and the request has not gone out. It is sent when the server next checks, usually within seconds. A late request often gets a worse court than a punctual one.'
        },
        failed: {
            label: 'Request failed',
            tone: 'failed',
            mark: 'cross',
            headline: 'It did not go through.',
            blurb: 'Nothing was booked. The slot can be queued again if its window is still open.'
        },
        missed: {
            label: 'Missed',
            tone: 'missed',
            mark: 'half',
            headline: 'The window passed before we could send it.',
            blurb: 'Nothing broke — the clock ran out. Once a window has fully closed the request is never submitted behind your back.'
        },
        cancelled: {
            label: 'Cancelled',
            tone: 'muted',
            mark: 'slash',
            headline: 'This slot was taken out of the queue.',
            blurb: 'It never went to KU Leuven.'
        }
    };


    const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: BRUSSELS, ...opts });
    const timeOf = (iso) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
    const secondsOf = (iso) => fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));
    const shortStamp = (iso) => fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

    function displayName(name) {
        const parts = String(name || '').trim().split(/\s+/);
        if (parts.length < 2) return parts[0] || '';
        return `${parts.slice(0, -1).join(' ')} ${parts[parts.length - 1][0]}.`;
    }

    function endTime(startIso, hours) {
        return timeOf(new Date(new Date(startIso).getTime() + Number(hours) * 3600000).toISOString());
    }

    /*
     * Every step carries its own date. A bare "00:00:03" is unreadable on a page whose three
     * moments can be weeks apart — queued today, window opening in ten days, submitted at a
     * midnight somewhere in between.
     */
    const stampWithSeconds = (iso) => `${fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))}, ${secondsOf(iso)}`;

    function timeline(booking) {
        const steps = [['Queued by', `${displayName(booking.queuedBy || booking.name)} · ${shortStamp(booking.queuedAt)}`]];
        const opened = new Date(booking.opensAt) <= new Date();
        steps.push(['Window opened', opened ? stampWithSeconds(booking.opensAt) : `${shortStamp(booking.opensAt)} — not yet`, !opened]);
        // Submitting the form and the outcome of submitting it happen at the same instant;
        // two steps a second apart implied a wait that never existed.
        if (booking.submittedAt) {
            steps.push([OUTCOMES[booking.status].label, stampWithSeconds(booking.submittedAt)]);
        }
        return h('section', { class: 'bd-card' }, [
            h('h2', { class: 'bd-card-title', text: 'What happened' }),
            // A step that has not happened yet keeps an open square: filled means it did.
            h('ol', { class: 'bd-steps' }, steps.map(([label, when, ahead], index) => h('li', {
                class: [index === steps.length - 1 ? 'last' : '', ahead ? 'ahead' : ''].join(' ').trim()
            }, [
                h('span', { class: 'bd-step-dot' }),
                h('span', {}, [h('span', { class: 'bd-step-label', text: label }), h('span', { class: 'bd-step-when', text: when })])
            ])))
        ]);
    }

    function sentTable(booking) {
        const where = booking.facility === 'Andere / Other'
            ? `${booking.indoorOutdoor} · ${booking.otherFacility}`
            : `${booking.indoorOutdoor}${booking.facility ? ` · ${booking.facility}` : ''}`;
        const rows = [
            ['Start', `${timeOf(booking.startPreferred)}, else ${timeOf(booking.startAlternative)}`],
            ['Duration', `${Number(booking.durationHours)} ${Number(booking.durationHours) === 1 ? 'hr' : 'hrs'}`],
            ['Players', String(booking.players)],
            ['Where', where],
            ['Responsible', booking.name]
        ];
        if (booking.remarks) rows.splice(4, 0, ['Remarks', booking.remarks]);

        return h('section', { class: 'bd-card' }, [
            // Nothing was sent for a dry run, so neither heading is true of it: what
            // the table holds is the request that would have gone.
            h('h2', { class: 'bd-card-title', text: booking.status === 'not_sent'
                ? 'What we would have sent'
                : (booking.submittedAt ? 'What we sent' : 'What we will send') }),
            h('div', { class: 'bd-table' }, rows.map(([label, value]) => h('div', { class: 'bd-row' }, [
                h('span', { class: 'bd-row-label', text: label }),
                h('span', { class: 'bd-row-value', text: value })
            ])))
        ]);
    }

    // The board's LIVE_WINDOW_MS (admin-bookings.js): how long "next" lasts before "catching up".
    const LIVE_WINDOW_MS = 5 * 60 * 1000;

    function outcomeKey(booking) {
        if (booking.status !== 'queued') return booking.status;
        const sinceOpen = Date.now() - new Date(booking.opensAt).getTime();
        if (sinceOpen < 0) return 'queued';
        return sinceOpen < LIVE_WINDOW_MS ? 'queued_opening' : 'queued_late';
    }

    function render(booking) {
        const outcome = OUTCOMES[outcomeKey(booking)] || OUTCOMES.failed;
        document.getElementById('bd-ref').textContent = `Entry ${booking.id.slice(0, 8)}`;

        const main = document.getElementById('bd-main');
        main.textContent = '';
        /*
         * The play date leads, as a numeral, the way every event on Home does: it is the
         * one fact this page is about, and the only type allowed to break scale here.
         */
        const start = new Date(booking.startPreferred);
        main.append(
            h('div', { class: 'bd-date' }, [
                h('span', { class: 'bd-day', text: fmt({ day: 'numeric' }).format(start) }),
                h('span', { class: 'bd-daymeta', text: `${fmt({ weekday: 'long' }).format(start)} · ${fmt({ month: 'long' }).format(start)}` })
            ]),
            h('h1', { class: 'admin-title bd-title', text: `${booking.sport}, ${timeOf(booking.startPreferred)}–${endTime(booking.startPreferred, booking.durationHours)}` }),
            h('p', { class: `bd-status bd-tone-${outcome.tone}` }, [
                h('span', { class: `bq-mark bq-mark-${outcome.mark}`, 'aria-hidden': 'true' }),
                outcome.label
            ]),
            h('section', { class: 'bd-headline' }, [
                h('h2', { text: outcome.headline }),
                h('p', { text: outcome.blurb })
            ]),
            timeline(booking),
            sentTable(booking)
        );

        document.title = `${booking.sport} ${timeOf(booking.startPreferred)} — Booking queue`;
    }

    function notFound() {
        const main = document.getElementById('bd-main');
        main.textContent = '';
        main.append(
            h('h1', { class: 'admin-title bd-title', text: 'Entry not found' }),
            h('p', { class: 'bd-note', text: 'It may have been removed. Go back to the board to see what is queued.' })
        );
    }

    async function init() {
        const match = window.location.pathname.match(/\/admin\/bookings\/([^/]+)$/);
        if (!match) return notFound();

        try {
            const response = await fetch(`/api/bookings/${encodeURIComponent(match[1])}`);
            const data = await response.json();
            if (!data.success) throw new Error(data.message);
            render(data.booking);
        } catch (error) {
            notFound();
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
