/*
 * One entry in full.
 *
 * The heading of the explanation card is the whole point of this page: a request that
 * reached KU Leuven is NOT a booked court. Everything else here is supporting detail.
 */
(() => {
    'use strict';

    const BRUSSELS = 'Europe/Brussels';

    const OUTCOMES = {
        queued: {
            label: 'Waiting',
            tone: 'muted',
            dot: 'solid-muted',
            headline: 'Nothing has been sent yet.',
            blurb: 'This slot is waiting for its window. We submit the form in the first seconds after it opens.'
        },
        sending: {
            label: 'Sending',
            tone: 'accent',
            dot: 'ring',
            headline: 'The request is going out now.',
            blurb: 'The window has opened and the form is being submitted.'
        },
        sent: {
            label: 'Request sent',
            tone: 'accent',
            dot: 'solid-success',
            headline: 'The request went in.',
            blurb: 'It reached KU Leuven inside the opening minute, which is everything this app can do. What they decide is theirs. This entry will not change again.'
        },
        unconfirmed: {
            label: 'Sent — unconfirmed',
            tone: 'warning',
            dot: 'ring-warning',
            headline: 'We could not read their answer.',
            blurb: 'The request may well have gone through — we simply cannot tell. Check before queueing it again: sending the same slot twice can double-book it, and we will not retry on our own.'
        },
        failed: {
            label: 'Request failed',
            tone: 'danger',
            dot: 'solid-danger',
            headline: 'It did not go through.',
            blurb: 'Nothing was booked. The slot can be queued again if its window is still open.'
        },
        missed: {
            label: 'Missed',
            tone: 'warning',
            dot: 'solid-warning',
            headline: 'The window passed before we could send it.',
            blurb: 'Nothing broke — the clock ran out. Once a window has fully closed the request is never submitted behind your back.'
        },
        cancelled: {
            label: 'Cancelled',
            tone: 'muted',
            dot: 'solid-muted',
            headline: 'This slot was taken out of the queue.',
            blurb: 'It never went to KU Leuven.'
        }
    };


    const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: BRUSSELS, ...opts });
    const timeOf = (iso) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
    const secondsOf = (iso) => fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));
    const longDate = (iso) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
    const shortStamp = (iso) => fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

    function h(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (value != null && value !== false) node.setAttribute(key, value);
        }
        for (const child of [].concat(children)) {
            if (child) node.append(child.nodeType ? child : document.createTextNode(child));
        }
        return node;
    }

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
        steps.push(['Window opened', opened ? stampWithSeconds(booking.opensAt) : `${shortStamp(booking.opensAt)} — not yet`]);
        // Submitting the form and the outcome of submitting it happen at the same instant;
        // two steps a second apart implied a wait that never existed.
        if (booking.submittedAt) {
            steps.push([OUTCOMES[booking.status].label, stampWithSeconds(booking.submittedAt)]);
        }
        return h('div', { class: 'card bd-card' }, [
            h('h3', { text: 'What happened' }),
            h('ol', { class: 'bd-steps' }, steps.map(([label, when], index) => h('li', {
                class: index === steps.length - 1 ? 'last' : ''
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

        return h('div', { class: 'card bd-card' }, [
            h('h3', { text: booking.submittedAt ? 'What we sent' : 'What we will send' }),
            h('div', { class: 'bd-table' }, rows.map(([label, value]) => h('div', { class: 'bd-row' }, [
                h('span', { class: 'bd-row-label', text: label }),
                h('span', { class: 'bd-row-value', text: value })
            ])))
        ]);
    }

    function render(booking) {
        const outcome = OUTCOMES[booking.status] || OUTCOMES.failed;
        document.getElementById('bd-ref').textContent = `Entry ${booking.id.slice(0, 8)}`;

        const main = document.getElementById('bd-main');
        main.textContent = '';
        main.append(
            h('div', { class: 'eyebrow', text: longDate(booking.startPreferred) }),
            h('h1', { class: 'bd-title', text: `${booking.sport}, ${timeOf(booking.startPreferred)}–${endTime(booking.startPreferred, booking.durationHours)}` }),
            h('span', { class: `bd-pill bd-tone-${outcome.tone}` }, [
                h('span', { class: `bq-dot bq-dot-${outcome.dot}` }),
                outcome.label
            ]),
            h('div', { class: 'card bd-headline' }, [
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
            h('h1', { class: 'bd-title', text: 'Entry not found' }),
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
