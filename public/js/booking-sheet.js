/*
 * Queue a slot — a three-step bottom sheet (artboards 1e-1h).
 *
 * Eleven form fields become three screens because the boring ones (players, indoor,
 * facility, remarks) collapse into one summary row carried over from last time. The
 * second start time is the only field with its own bordered box: it is a different
 * START, not an end time, and it is the field people get wrong.
 *
 * The quota is counted on the NAME, so the name is asked first. That resolves the tally
 * before anyone fills in ten other fields, rather than after.
 */
(() => {
    'use strict';

    const { h, readJson, isoDate, MONTHS } = window.bookingShared;

    const DEFAULTS_STORE = 'lilai.booking.defaults';

    // Padel, tennis, table tennis, beach volleyball and outdoor basketball go through
    // KU Leuven's separate online tool, so they are not offered here at all.
    const SPORTS = ['Badminton', 'Basketball', 'Volleyball', 'Squash', 'Handball'];
    const DURATIONS = [1, 1.5, 2];

    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let root = null;
    let draft = null;
    let options = { facilities: [], languages: ['English', 'Nederlands'] };
    let quota = null;

    // --- Storage (best effort; Safari private mode throws) ---------------------------

    function readStore(key, fallback) {
        try {
            return JSON.parse(localStorage.getItem(key)) || fallback;
        } catch (error) {
            return fallback;
        }
    }

    function writeStore(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) { /* storage unavailable; the sheet still works */ }
    }

    // --- Dates -----------------------------------------------------------------------

    // Name the year only when it is not this one. A queue that reaches into next season
    // would otherwise offer "Wed 10 Feb" twice over and mean two different days.
    function prettyDate(iso) {
        const [y, m, d] = iso.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        const label = `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
        return y === new Date().getFullYear() ? label : `${label} ${y}`;
    }

    // One definition, on the board, so the quota line and the day picker cannot disagree
    // about which dates are still worth offering.
    const earliestPlayDate = () => window.bookingBoard.earliestPlayDate();

    function openingFor(playDate) {
        const [y, m, d] = playDate.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d) - 14 * 86400000);
    }

    function openingLabel(playDate) {
        const opening = openingFor(playDate);
        const iso = `${opening.getUTCFullYear()}-${String(opening.getUTCMonth() + 1).padStart(2, '0')}-${String(opening.getUTCDate()).padStart(2, '0')}`;
        const days = Math.round((opening - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000);
        const when = days <= 0 ? ' — already open' : days === 1 ? ' — tonight' : days === 2 ? ' — tomorrow night' : '';
        return { text: `${prettyDate(iso)} at 00:00`, suffix: when, iso };
    }

    /** The Brussels wall-clock start of a stored instant, for the held-slot list. */
    function startTimeOf(iso) {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false
        }).format(new Date(iso));
    }

    /*
     * What the rule would produce, asked of the server.
     *
     * Deliberately not computed here. A preview built from a second implementation of the
     * calendar rule drifts from the one that actually expands it, and a preview that
     * promises a date the server refuses is worse than none. `preview` holds the last
     * answer: dates, or the reason there are none.
     */
    let preview = null;
    let previewToken = 0;

    function repeatQuery() {
        return new URLSearchParams({
            playDate: draft.playDate || '',
            every: String(draft.repeatEvery),
            unit: draft.repeatUnit,
            weekdays: draft.repeatUnit === 'week' ? draft.repeatWeekdays.join(',') : '',
            until: draft.repeatUntil || ''
        }).toString();
    }

    async function refreshPreview() {
        if (!draft.repeatOn || !draft.playDate || !draft.repeatUntil) {
            preview = null;
            return renderStep();
        }
        // Answers can land out of order while someone clicks through weekdays; only the
        // newest one is allowed to paint.
        const token = ++previewToken;
        try {
            const data = await readJson(await fetch(`/api/bookings/repeat-preview?${repeatQuery()}`));
            if (token !== previewToken) return;
            preview = data.success
                ? { dates: data.dates, summary: data.summary }
                : { dates: [], message: data.message };
        } catch (error) {
            if (token !== previewToken) return;
            preview = { dates: [], message: 'Could not work out those dates.' };
        }
        renderStep();
    }

    function addHours(time, hours) {
        const [h, m] = time.split(':').map(Number);
        const total = h * 60 + m + hours * 60;
        return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }

    // --- Small DOM helpers -------------------------------------------------------------

    /** What the sheet is for right now — the same words wherever the sheet names itself. */
    function sheetTitle() {
        return draft.editingId ? 'Edit this slot' : draft.editingSeriesId ? 'Edit this schedule' : 'Queue a slot';
    }

    function pillGroup(values, current, onPick, labelOf = (v) => v) {
        return h('div', { class: 'bs-pills' }, values.map((value) => h('button', {
            type: 'button',
            class: `bs-pill${value === current ? ' selected' : ''}`,
            text: labelOf(value),
            onclick: () => onPick(value)
        })));
    }

    // --- Quota -------------------------------------------------------------------------

    async function refreshQuota() {
        quota = null;
        if (!draft.name || !draft.playDate) return renderStep();
        try {
            // While editing, neither the entry nor the schedule is competition for its own slot.
            const mine = draft.editingId ? `&excludeId=${encodeURIComponent(draft.editingId)}`
                : draft.editingSeriesId ? `&excludeSeries=${encodeURIComponent(draft.editingSeriesId)}`
                    : '';
            const response = await fetch(
                `/api/bookings/quota?name=${encodeURIComponent(draft.name)}&playDate=${draft.playDate}${mine}`);
            const data = await response.json();
            if (data.success) quota = data;
        } catch (error) { /* leave the strip generic */ }
        renderStep();
    }

    function quotaStrip() {
        const pips = h('span', { class: 'bs-pips' });
        const used = quota ? quota.used : 0;
        const limit = quota ? quota.limit : 2;
        for (let i = 0; i < limit; i += 1) {
            pips.append(h('span', { class: `bq-pip${i < used ? ' used' : ''}` }));
        }

        const who = draft.name ? `${draft.name} — ${used} of ${limit} slots used` : 'Two slots per person per week';
        // Always print the week in full: "this week" is exactly the ambiguity people ask about.
        const when = quota
            ? `week of ${prettyDate(quota.week.start)} – ${prettyDate(quota.week.end)}`
            : 'for the week you pick.';

        return h('div', { class: `bs-quota${quota && quota.remaining === 0 ? ' full' : ''}` }, [
            pips,
            h('span', { class: 'bs-quota-who', text: who }),
            h('span', { class: 'bs-quota-when', text: when })
        ]);
    }

    // --- Steps ---------------------------------------------------------------------------

    /*
     * Who the booking is for: a pick from the address book, not a name typed again.
     *
     * The name is asked first because the quota counts on it, and it is a pick rather than
     * free text because two spellings of one person used to become two people with four
     * slots a week. Adding someone happens here too — it is always something you are in the
     * middle of, never the errand you set out on.
     */
    function pickPerson(person) {
        draft.profileId = person.id;
        draft.name = person.name;
        window.bookingPeople.rememberLast(person.id);
        refreshQuota();
    }

    function stepWho() {
        const people = window.bookingPeople.list();

        const add = h('button', {
            type: 'button',
            class: 'bs-person-add',
            text: people.length === 0 ? 'Add the first person' : '+ Add a person',
            onclick: async () => {
                const saved = await window.bookingPeople.openEditor(null);
                if (saved) pickPerson(saved);
                else renderStep();
            }
        });

        const rows = people.map((person) => h('button', {
            type: 'button',
            class: `bs-person-row${person.id === draft.profileId ? ' selected' : ''}`,
            onclick: () => pickPerson(person)
        }, [
            h('span', { class: 'bs-person-name', text: person.name }),
            h('span', { class: 'bs-person-contact', text: `${person.emailMasked} · ${person.phoneMasked}` })
        ]));

        return h('div', { class: 'bs-field' }, [
            h('label', { class: 'bs-label', text: 'Who the booking is for' }),
            people.length === 0
                ? h('p', { class: 'bs-note', text: window.bookingPeople.loaded()
                    ? 'Nobody in the list yet. Add a person once and their email and phone are never asked for again.'
                    : 'Loading the people who book…' })
                : h('p', { class: 'bs-note bs-hint', text: 'Their email and phone are already on file. This name goes on the form, and it is what counts the two slots a week.' }),
            h('div', { class: 'bs-person-list' }, [...rows, add])
        ]);
    }

    function stepOne() {
        // One date input, no shortcuts. A shortcut that guesses wrong costs more than the
        // two seconds a picker takes, and the calendar already knows which dates are legal.
        const picker = h('input', {
            type: 'date',
            class: 'bs-date',
            min: isoDate(earliestPlayDate()),
            value: draft.playDate || ''
        });
        // A sports card covers one season. Past its end the calendar simply stops, so the
        // refusal is visible while choosing instead of arriving after the form is filled in.
        if (options.seasonEndsOn) picker.max = options.seasonEndsOn;
        picker.addEventListener('change', () => {
            if (picker.value) { draft.playDate = picker.value; refreshQuota(); }
        });

        const body = [
            quotaStrip(),
            stepWho(),
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Sport' }),
                pillGroup(SPORTS, draft.sport, (value) => { draft.sport = value; renderStep(); }),
                h('p', { class: 'bs-note', text: 'Padel, tennis, table tennis and beach volleyball are booked through KU Leuven’s separate online tool, not this form.' })
            ]),
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Day you want to play' }),
                picker,
                h('p', { class: 'bs-note', text: options.seasonEndsOn
                    ? `Nothing before ${prettyDate(isoDate(earliestPlayDate()))} — those windows have already closed — and nothing after ${prettyDate(options.seasonEndsOn)}, when this season's sports card runs out.`
                    : `Nothing before ${prettyDate(isoDate(earliestPlayDate()))} — those windows have already closed.` })
            ])
        ];

        if (draft.playDate) {
            const opening = openingLabel(draft.playDate);
            body.push(h('div', { class: 'bs-panel' }, [
                h('div', { class: 'eyebrow', text: 'What happens next' }),
                h('p', { class: 'bs-panel-lead' }, [
                    'The form for ',
                    h('strong', { text: prettyDate(draft.playDate) }),
                    ' opens ',
                    h('strong', { text: opening.text }),
                    opening.suffix
                ]),
                h('p', { class: 'bs-note', text: 'This slot sits in the queue until then, and goes out in the first minute.' })
            ]));
        }

        return body;
    }

    function stepTwo() {
        const duration = h('div', { class: 'bs-segment' }, DURATIONS.map((value) => h('button', {
            type: 'button',
            class: `bs-seg${draft.durationHours === value ? ' selected' : ''}`,
            text: value === 1 ? '1 hr' : `${value} hrs`,
            onclick: () => { draft.durationHours = value; renderStep(); }
        })));

        /*
         * Courts are handed out on the hour and the half hour, so those are the only times
         * offered. A free time field accepted 19:07 and sent it to KU Leuven, where nobody
         * could grant it — the server refuses those now, and a list means never having to.
         *
         * A stored value outside the list is added rather than dropped, so editing an old
         * entry cannot silently move its time.
         */
        const timeInput = (value, onset) => {
            const times = [];
            for (let minutes = 6 * 60; minutes <= 23 * 60 + 30; minutes += 30) {
                times.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
            }
            if (value && !times.includes(value)) times.push(value);
            times.sort();

            const select = h('select', { class: 'bs-time-input' }, [
                h('option', { value: '', text: 'Pick a time' }),
                ...times.map((time) => h('option', { value: time, text: time }))
            ]);
            select.value = value || '';
            select.addEventListener('change', () => { onset(select.value || null); renderStep(); });
            return select;
        };

        const starts = timeInput(draft.startPreferred, (value) => {
            draft.startPreferred = value;
            if (value && draft.startAlternative === value) draft.startAlternative = null;
        });

        const alternatives = timeInput(draft.startAlternative, (value) => {
            draft.startAlternative = value;
        });

        const example = draft.startPreferred && draft.startAlternative
            ? `${draft.startPreferred}–${addHours(draft.startPreferred, draft.durationHours)}, or ${draft.startAlternative}–${addHours(draft.startAlternative, draft.durationHours)}.`
            : 'Pick a first choice, then a fallback.';

        const where = draft.facility === 'Andere / Other'
            ? (draft.otherFacility || 'other — name it')
            : (draft.facility || 'no preference');
        const summary = `${draft.players} players · ${draft.indoorOutdoor.toLowerCase()} · ${where} · ${draft.remarks ? 'with remarks' : 'no remarks'}`;

        return [
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'How long' }),
                duration
            ]),
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Start at' }),
                starts
            ]),
            // The one field that earns a border: people read it as an end time.
            h('div', { class: 'bs-boxed' }, [
                h('div', { class: 'bs-boxed-head' }, [
                    h('span', { class: 'bs-boxed-title', text: 'Second choice of start time' }),
                    h('span', { class: 'bs-required', text: 'required' })
                ]),
                h('p', { class: 'bs-note' }, [
                    'Still ', h('strong', { text: draft.durationHours === 1 ? '1 hour' : `${draft.durationHours} hours` }),
                    ', just a different start. This is not an end time — it is the fallback if ',
                    draft.startPreferred || 'your first choice', ' is taken.'
                ]),
                alternatives,
                h('p', { class: 'bs-note bs-example', text: example })
            ]),
            repeatField(),
            h('div', { class: 'bs-summary' }, [
                h('div', { class: 'bs-summary-main' }, [
                    h('div', { class: 'bs-summary-title', text: 'Everything else' }),
                    h('div', { class: 'bs-summary-text', text: summary })
                ]),
                h('button', { type: 'button', class: 'btn ghost sm', text: 'Change', onclick: openDetails })
            ]),
            h('p', { class: 'bs-note', text: 'Carried over from your last booking. Players must be truthful — KU Leuven asks for at least 10.' })
        ];
    }

    /*
     * Repeat: a habit, typed once.
     *
     * Three questions, because they are genuinely different: how often, on which days, and
     * until when. Weekdays appear only for a weekly rule — offering them beside "every 3
     * days" would suggest a combination the server has no meaning for.
     *
     * Offered when making a new booking and when editing a schedule, never when editing one
     * queued row: turning one row into twelve from that screen would be a different act
     * wearing the same button. Editing a schedule cannot turn it OFF for the same reason —
     * to keep a single booking, edit the slot itself.
     */
    const WEEKDAY_PILLS = [
        [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']
    ];

    function repeatField() {
        if (draft.editingId) return null;

        const parts = [
            h('label', { class: 'bs-label', text: 'Repeat' }),
            draft.editingSeriesId ? null : pillGroup([false, true], draft.repeatOn, (value) => {
                draft.repeatOn = value;
                if (!value) preview = null;
                renderStep();
                if (value) refreshPreview();
            }, (value) => value ? 'Repeat' : 'Just once')
        ];

        if (!draft.repeatOn) return h('div', { class: 'bs-field' }, parts);

        const every = h('input', {
            type: 'number', class: 'bs-number', min: '1',
            max: String(options.repeatMaxEvery || 12), value: String(draft.repeatEvery)
        });
        every.addEventListener('change', () => {
            const value = Number(every.value);
            draft.repeatEvery = Number.isInteger(value) && value >= 1 ? value : 1;
            renderStep();
            refreshPreview();
        });

        const unit = h('select', { class: 'bs-time-input bs-unit' }, (options.repeatUnits || ['day', 'week', 'month'])
            .map((value) => h('option', { value, text: draft.repeatEvery === 1 ? value : `${value}s` })));
        unit.value = draft.repeatUnit;
        unit.addEventListener('change', () => {
            draft.repeatUnit = unit.value;
            renderStep();
            refreshPreview();
        });

        parts.push(h('div', { class: 'bs-every' }, [
            h('span', { class: 'bs-every-word', text: 'every' }),
            every,
            unit
        ]));

        if (draft.repeatUnit === 'week') {
            parts.push(h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label bs-label-sm', text: 'On these days' }),
                h('div', { class: 'bs-pills' }, WEEKDAY_PILLS.map(([day, label]) => h('button', {
                    type: 'button',
                    class: `bs-pill bs-day-pill${draft.repeatWeekdays.includes(day) ? ' selected' : ''}`,
                    text: label,
                    onclick: () => {
                        draft.repeatWeekdays = draft.repeatWeekdays.includes(day)
                            ? draft.repeatWeekdays.filter((picked) => picked !== day)
                            : [...draft.repeatWeekdays, day].sort((a, b) => a - b);
                        renderStep();
                        refreshPreview();
                    }
                }))),
                h('p', { class: 'bs-note', text: draft.repeatWeekdays.length === 0
                    ? `Nothing chosen means the day the first booking falls on${draft.playDate ? ` — ${prettyDate(draft.playDate).split(' ')[0]}` : ''}.`
                    : 'Two slots a week is the limit per person, so a third day will be reported as full.' })
            ]));
        }

        const until = h('input', {
            type: 'date', class: 'bs-date',
            min: draft.playDate,
            max: options.seasonEndsOn || null,
            value: draft.repeatUntil || ''
        });
        until.addEventListener('change', () => {
            draft.repeatUntil = until.value;
            renderStep();
            refreshPreview();
        });
        parts.push(h('div', { class: 'bs-field' }, [
            h('label', { class: 'bs-label bs-label-sm', text: 'Until' }),
            until
        ]));

        // Whatever the server says the rule expands to, verbatim — including its refusals.
        const dates = preview ? preview.dates : [];
        parts.push(h('p', { class: 'bs-note bs-example', text: !draft.repeatUntil
            ? 'Pick the last day to see what this books.'
            : preview && preview.message ? preview.message
                : dates.length === 0 ? 'Working out the dates…'
                    : `${dates.length} ${dates.length === 1 ? 'booking' : 'bookings'} — ${prettyDate(dates[0])} to ${prettyDate(dates[dates.length - 1])}.` }));
        parts.push(h('p', { class: 'bs-note', text: 'Each one is queued on its own: editable, cancellable, and counted against its own week. Weeks already full are reported, not silently skipped.' }));

        return h('div', { class: 'bs-field' }, parts);
    }

    function stepThree() {
        const person = draft.profileId ? window.bookingPeople.byId(draft.profileId) : null;

        const rows = [
            ['Sport', draft.sport],
            ['Day', prettyDate(draft.playDate)],
            ['Start', `${draft.startPreferred}, else ${draft.startAlternative}`],
            ['Duration', draft.durationHours === 1 ? '1 hr' : `${draft.durationHours} hrs`],
            ['Players', String(draft.players)],
            ['Where', `${draft.indoorOutdoor}${draft.facility ? ` · ${draft.facility === 'Andere / Other' ? draft.otherFacility : draft.facility}` : ''}`],
            [draft.repeatOn ? 'First goes out' : 'Goes out', `${openingLabel(draft.playDate).text}`]
        ];
        if (draft.repeatOn && preview && preview.dates.length > 0) {
            const dates = preview.dates;
            rows.splice(2, 0, ['Repeat',
                `${dates.length} bookings · ${preview.summary} · to ${prettyDate(dates[dates.length - 1])}`]);
        }

        /*
         * No contact fields. The email and phone come from the person picked in step 1, so
         * this step confirms who rather than asking a third time. An older entry whose
         * person has since been removed keeps the details it was queued with; the server
         * holds them and this step says so.
         */
        return [
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Booking for' }),
                h('div', { class: 'bs-person' }, [
                    h('div', {}, [
                        h('div', { class: 'bs-person-name', text: draft.name }),
                        h('div', { class: 'bs-person-contact', text: person
                            ? `${person.emailMasked} · ${person.phoneMasked}`
                            : 'Contact details kept with this entry' })
                    ]),
                    h('button', { type: 'button', class: 'text-link-btn', text: 'Not them?', onclick: () => goTo(1) })
                ])
            ]),
            person
                ? h('button', {
                    type: 'button', class: 'text-link-btn bs-person-edit', text: 'Change their email or phone',
                    onclick: async () => { if (await window.bookingPeople.openEditor(person)) renderStep(); }
                })
                : null,
            h('p', { class: 'bs-note', text: 'A valid KU Leuven sports card is required to book. We do not check it and never could — that is between the player and KU Leuven.' }),
            h('p', { class: 'bs-note', text: 'Email and phone never appear on the board — only the name does. The name is what counts the two slots a week.' }),
            h('div', { class: 'bs-table' }, [
                h('div', { class: 'bs-table-head', text: 'What we will submit' }),
                ...rows.map(([label, value]) => h('div', { class: 'bs-table-row' }, [
                    h('span', { class: 'bs-table-label', text: label }),
                    h('span', { class: 'bs-table-value', text: value })
                ]))
            ]),
            h('div', { class: 'bs-panel' }, [
                h('div', { class: 'bs-panel-lead', text: 'Queuing is not booking.' }),
                h('p', { class: 'bs-note', text: 'We submit the request at midnight. KU Leuven decides, and emails them directly — usually within a day or two.' })
            ])
        ];
    }

    /** 1h: refuse and redirect. No waitlist — nothing here can guarantee a handover. */
    function stepFull() {
        const held = quota.entries.map((entry) => h('div', { class: 'bs-held' }, [
            h('div', {}, [
                h('div', { class: 'bs-held-title', text: `${entry.sport} · ${prettyDate(entry.playDate)}, ${startTimeOf(entry.startPreferred)}` }),
                h('div', { class: 'bs-note', text: entry.swappable ? 'Waiting — has not gone out yet' : 'Already sent — awaiting their email' })
            ]),
            entry.swappable
                ? h('button', { type: 'button', class: 'bs-swap', text: 'Swap this', onclick: () => swap(entry.id) })
                : h('span', { class: 'bs-locked', text: 'locked' })
        ]));

        return [
            h('div', { class: 'bs-full' }, [
                h('div', { class: 'bs-full-head' }, [
                    h('span', { class: 'bs-pips' }, quota.entries.map(() => h('span', { class: 'bq-pip used warn' }))),
                    h('span', { class: 'bs-full-title', text: `That week is full for ${quota.name} — ${quota.used} of ${quota.limit}` })
                ]),
                h('p', { class: 'bs-note' }, [
                    'Everyone gets two slots in a play week, so courts spread around. The week of ',
                    h('strong', { text: `${prettyDate(quota.week.start)} – ${prettyDate(quota.week.end)}` }),
                    ' already holds these two:'
                ]),
                ...held,
                h('p', { class: 'bs-note', text: 'Only a slot still waiting can be swapped. Once a request has gone to KU Leuven it counts against the week whatever they answer.' })
            ])
        ];
    }

    async function swap(id) {
        const response = await fetch(`/api/bookings/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        let data;
        try {
            data = await readJson(response);
        } catch (error) {
            return setError(error.staleServer ? error.message : 'Could not reach the server. Try again.');
        }
        if (!data.success) return setError(data.message);
        await refreshQuota();
        goTo(1);
    }

    // --- Details sub-sheet ------------------------------------------------------------

    function openDetails() {
        const players = h('input', { type: 'number', class: 'bs-input', min: '10', max: '200', value: String(draft.players) });
        const remarks = h('textarea', { class: 'bs-input', rows: '2', placeholder: 'Anything KU Leuven should know' });
        remarks.value = draft.remarks || '';

        const facility = h('select', { class: 'bs-input' }, [
            h('option', { value: '', text: 'No preference' }),
            ...options.facilities.map((name) => h('option', { value: name, text: name }))
        ]);
        facility.value = draft.facility || '';

        const other = h('input', { type: 'text', class: 'bs-input', placeholder: 'Which court or hall?', value: draft.otherFacility || '' });
        const otherField = h('div', { class: 'bs-field' }, [h('label', { class: 'bs-label', text: 'Name the facility' }), other]);
        otherField.hidden = facility.value !== 'Andere / Other';
        facility.addEventListener('change', () => { otherField.hidden = facility.value !== 'Andere / Other'; });

        const body = h('div', { class: 'bs-details' }, [
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Players' }),
                players,
                h('p', { class: 'bs-note', text: 'At least 10, and it must be truthful — we will not round it up for you.' })
            ]),
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Indoor or outdoor' }),
                pillGroup(['Indoor', 'Outdoor'], draft.indoorOutdoor, (value) => {
                    draft.indoorOutdoor = value;
                    root.querySelector('.bs-modal')?.remove();
                    openDetails();
                })
            ]),
            h('div', { class: 'bs-field' }, [h('label', { class: 'bs-label', text: 'Facility' }), facility]),
            otherField,
            h('div', { class: 'bs-field' }, [h('label', { class: 'bs-label', text: 'Remarks' }), remarks]),
            h('div', { class: 'bs-modal-actions' }, [
                h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => root.querySelector('.bs-modal').remove() }),
                h('button', {
                    type: 'button',
                    class: 'btn accent',
                    text: 'Save',
                    onclick: () => {
                        draft.players = Math.max(10, parseInt(players.value, 10) || 10);
                        draft.facility = facility.value;
                        draft.otherFacility = other.value.trim();
                        draft.remarks = remarks.value.trim();
                        root.querySelector('.bs-modal').remove();
                        renderStep();
                    }
                })
            ])
        ]);

        root.append(h('div', { class: 'bs-modal' }, [h('div', { class: 'bs-modal-card' }, [
            h('h3', { text: 'Everything else' }), body
        ])]));
    }

    // --- Shell ---------------------------------------------------------------------------

    const STEP_TITLES = ['what and when', 'when exactly', 'who is responsible'];

    /*
     * Which of the three things the sheet is doing, said once and never overwritten.
     *
     * The title turns into "Badminton · Sun 4 Oct" from step 2 onwards, so it cannot carry
     * the mode; without this banner, editing an existing slot and creating a new one look
     * identical from the second screen on, and the difference matters — one of them
     * changes a slot someone is already counting on.
     */
    const MODE_TAG = {
        create: 'New slot',
        duplicate: 'New slot, copied from',
        edit: 'Editing'
    };

    function canAdvance() {
        if (quota && quota.remaining === 0) return false;
        if (draft.step === 1) return Boolean(draft.profileId && draft.sport && draft.playDate);
        if (draft.step === 2) {
            // A repeat may not advance on a preview that has not answered, or that refused:
            // the count on the button has to be a number the server agreed to.
            if (draft.repeatOn && (!preview || preview.dates.length === 0)) return false;
            return Boolean(draft.startPreferred && draft.startAlternative);
        }
        // An edit whose person has since been removed carries no profile — one entry's or a
        // whole schedule's. The server keeps the contact details it already has, so there is
        // nothing left to ask.
        return Boolean(draft.profileId || draft.editingId || draft.editingSeriesId);
    }

    function goTo(step) {
        draft.step = step;
        setError(null);
        renderStep();
    }

    function setError(message) {
        draft.error = message;
        const box = root && root.querySelector('.bs-error');
        if (box) {
            box.textContent = message || '';
            box.hidden = !message;
        }
    }

    function renderFooter() {
        const footer = root.querySelector('.bs-footer');
        footer.textContent = '';

        const full = quota && quota.remaining === 0;
        if (full) {
            footer.append(h('button', { type: 'button', class: 'btn ghost bs-wide', text: 'Leave it for now', onclick: close }));
            return;
        }
        if (draft.step > 1) {
            footer.append(h('button', { type: 'button', class: 'btn ghost', text: 'Back', onclick: () => goTo(draft.step - 1) }));
        }
        const count = draft.repeatOn && preview ? preview.dates.length : 1;
        const last = draft.editingId ? 'Save changes'
            : draft.editingSeriesId ? 'Save the schedule'
                : count > 1 ? `Queue all ${count}` : 'Put it in the queue';
        const label = draft.step === 1 ? 'Next — times' : draft.step === 2 ? 'Next — who is booking' : last;
        const next = h('button', {
            type: 'button',
            class: `btn ${draft.step === 3 ? 'dark' : 'accent'} bs-next`,
            text: label,
            onclick: () => (draft.step === 3 ? submit() : goTo(draft.step + 1))
        });
        next.disabled = !canAdvance();
        footer.append(next);
    }

    function renderStep() {
        if (!root) return;
        const full = quota && quota.remaining === 0;

        const body = root.querySelector('.bs-body');
        body.textContent = '';
        const step = full ? stepFull() : draft.step === 1 ? stepOne() : draft.step === 2 ? stepTwo() : stepThree();
        for (const part of step) { if (part) body.append(part); }

        root.querySelector('.bs-step').textContent = full
            ? 'That week is full'
            : `Step ${draft.step} of 3 · ${STEP_TITLES[draft.step - 1]}`;
        root.querySelector('.bs-title').textContent = draft.sport && draft.playDate && draft.step > 1
            ? `${draft.sport} · ${prettyDate(draft.playDate)}`
            : sheetTitle();

        const bars = root.querySelectorAll('.bs-bar');
        bars.forEach((bar, index) => bar.classList.toggle('done', !full && index < draft.step));

        renderFooter();
        setError(draft.error);
    }

    async function submit() {
        setError(null);
        const next = root.querySelector('.bs-next');
        next.disabled = true;
        next.textContent = (draft.editingId || draft.editingSeriesId) ? 'Saving…' : 'Queueing…';

        const payload = {
            sport: draft.sport,
            playDate: draft.playDate,
            startPreferred: draft.startPreferred,
            startAlternative: draft.startAlternative,
            durationHours: draft.durationHours,
            players: draft.players,
            indoorOutdoor: draft.indoorOutdoor,
            facility: draft.facility,
            otherFacility: draft.otherFacility,
            language: 'English',
            validSportsCard: true,
            // The server reads name, email and phone off the profile. Sending them from here
            // would let a sheet opened before an edit overwrite what the address book says.
            profileId: draft.profileId,
            remarks: draft.remarks,
            repeat: draft.repeatOn ? {
                every: draft.repeatEvery,
                unit: draft.repeatUnit,
                weekdays: draft.repeatUnit === 'week' ? draft.repeatWeekdays : [],
                until: draft.repeatUntil
            } : null,
            queuedBy: draft.name
        };

        /*
         * Three destinations, one payload. A schedule PUTs to its own route because the
         * server has to reconcile a queue against a rule there — keep what still fits,
         * cancel what no longer does, add what is newly wanted — and none of that is
         * anything the single-entry routes do.
         */
        const target = draft.editingId ? `/api/bookings/${encodeURIComponent(draft.editingId)}`
            : draft.editingSeriesId ? `/api/booking-series/${encodeURIComponent(draft.editingSeriesId)}`
                : '/api/bookings';
        try {
            const response = await fetch(target, {
                method: (draft.editingId || draft.editingSeriesId) ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await readJson(response);
            if (!data.success) {
                if (data.reason === 'quota_reached') {
                    quota = data.quota;
                    return renderStep();
                }
                if (data.reason === 'nothing_queued') {
                    return showOutcome([], data.skipped || []);
                }
                renderFooter();
                return setError(data.message
                    || ((draft.editingId || draft.editingSeriesId) ? 'Could not save that change.' : 'Could not queue that slot.'));
            }
            writeStore(DEFAULTS_STORE, {
                players: draft.players,
                indoorOutdoor: draft.indoorOutdoor,
                facility: draft.facility,
                otherFacility: draft.otherFacility,
                sport: draft.sport
            });
            if (window.bookingBoard) window.bookingBoard.load();
            // Everything asked for went in: nothing left to read, so get out of the way.
            if (!data.skipped || data.skipped.length === 0) return close();
            showOutcome(data.created || [data.booking], data.skipped);
        } catch (error) {
            renderFooter();
            setError(error.staleServer ? error.message : 'Could not reach the server. Try again.');
        }
    }

    /*
     * What a partly-landed repeat actually did. A repeat that quietly dropped three weeks
     * would look exactly like one that worked, so the dates it lost are named, with the
     * reason, and the sheet stays open until someone has read them.
     */
    function showOutcome(created, skipped) {
        const body = root.querySelector('.bs-body');
        body.textContent = '';
        root.querySelector('.bs-step').textContent = 'What went in';
        root.querySelector('.bs-title').textContent = created.length === 0
            ? 'Nothing could be queued'
            : `${created.length} of ${created.length + skipped.length} queued`;

        if (created.length > 0) {
            body.append(h('p', { class: 'bs-note', text: `Queued: ${created.map((entry) => prettyDate(entry.playDate)).join(', ')}.` }));
        }
        body.append(h('div', { class: 'bs-full' }, [
            h('div', { class: 'bs-full-head' }, [
                h('span', { class: 'bs-full-title', text: `${skipped.length} ${skipped.length === 1 ? 'date was' : 'dates were'} left out` })
            ]),
            ...skipped.map((miss) => h('div', { class: 'bs-held' }, [
                h('div', {}, [
                    h('div', { class: 'bs-held-title', text: prettyDate(miss.playDate) }),
                    h('div', { class: 'bs-note', text: miss.reason })
                ])
            ]))
        ]));

        const footer = root.querySelector('.bs-footer');
        footer.textContent = '';
        footer.append(h('button', { type: 'button', class: 'btn dark bs-wide', text: 'Done', onclick: close }));
        setError(null);
    }

    function close() {
        if (!root) return;
        root.remove();
        root = null;
        document.body.style.overflow = '';
    }

    async function loadReference() {
        const [optionsResponse] = await Promise.allSettled([
            fetch('/api/bookings/form-options').then(readJson),
            window.bookingPeople.load()
        ]);
        if (optionsResponse.status === 'fulfilled' && optionsResponse.value.success) {
            options = optionsResponse.value;
        }
        // A person removed since this entry was queued is no longer pickable, so the draft
        // must let go of them rather than send an id the server will refuse.
        if (draft.profileId && !window.bookingPeople.byId(draft.profileId)) draft.profileId = null;
        // A create with nobody chosen falls back to whoever this browser picked last —
        // one click saved, and no claim about who is actually typing.
        if (!draft.profileId && !draft.editingId) {
            const last = window.bookingPeople.byId(window.bookingPeople.readLast());
            if (last) { draft.profileId = last.id; draft.name = last.name; }
        }
        // A schedule opens with its rule already on, so its preview is owed from the start:
        // step 2 will not advance on a count the server has not agreed to.
        if (draft.repeatOn) refreshPreview();
        if (draft.profileId && draft.playDate) return refreshQuota();
        renderStep();
    }

    /*
     * `entry` turns the sheet into an edit of an existing queued slot. Email and phone are
     * deliberately absent from board data, so they start blank and the server keeps what it
     * already has unless something is typed — the contact details never leave the server.
     */
    function open(entry, { duplicate = false, series = null } = {}) {
        if (root) return;
        const defaults = readStore(DEFAULTS_STORE, {});
        const clock = (iso) => {
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false
            }).formatToParts(new Date(iso));
            const get = (type) => parts.find((part) => part.type === type).value;
            return `${get('hour')}:${get('minute')}`;
        };

        /*
         * A duplicate is a new booking that starts from an old one, so it carries no id and
         * goes through the create path — quota included. The date is kept only if it is
         * still bookable; repeating something from last month has to start with a new day.
         */
        const reusableDate = entry && !duplicate ? entry.playDate
            : entry && entry.playDate >= isoDate(earliestPlayDate()) ? entry.playDate : '';

        draft = entry ? {
            step: 1,
            mode: series ? 'series' : duplicate ? 'duplicate' : 'edit',
            source: series ? series.summary : `${entry.sport} · ${prettyDate(entry.playDate)}`,
            // A schedule edit changes the rule and every occurrence still waiting under it;
            // it is not an edit of the one row it happens to be seeded from.
            editingId: (duplicate || series) ? null : entry.id,
            editingSeriesId: series ? series.id : null,
            name: entry.name,
            // Both an edit and a duplicate start from the person the entry was booked for.
            // If that person has since been removed, step 1 asks for a new one.
            profileId: entry.profileId || null,
            sport: series ? series.sport : entry.sport,
            /*
             * A schedule is re-expanded from its first date, so that is where the sheet
             * starts — unless that day has gone by, in which case the run has to be pointed
             * at a new first day before anything can be queued.
             */
            playDate: series
                ? (series.startsOn >= isoDate(earliestPlayDate()) ? series.startsOn : '')
                : reusableDate,
            startPreferred: series ? series.startPreferred : clock(entry.startPreferred),
            startAlternative: series ? series.startAlternative : clock(entry.startAlternative),
            durationHours: Number(entry.durationHours),
            players: entry.players,
            indoorOutdoor: entry.indoorOutdoor,
            facility: entry.facility || '',
            otherFacility: entry.otherFacility || '',
            remarks: entry.remarks || '',
            repeatOn: Boolean(series),
            repeatEvery: series ? series.rule.every : 1,
            repeatUnit: series ? series.rule.unit : 'week',
            repeatWeekdays: series && series.rule.weekdays ? [...series.rule.weekdays] : [],
            repeatUntil: series ? series.until : '',
            error: null
        } : {
            step: 1,
            mode: 'create',
            source: null,
            editingId: null,
            editingSeriesId: null,
            name: '',
            // Filled in by loadReference from whoever this browser picked last.
            profileId: null,
            sport: defaults.sport || 'Badminton',
            playDate: '',
            startPreferred: '18:00',
            startAlternative: null,
            durationHours: 2,
            players: defaults.players || 10,
            indoorOutdoor: defaults.indoorOutdoor || 'Indoor',
            facility: defaults.facility || '',
            otherFacility: defaults.otherFacility || '',
            remarks: '',
            repeatOn: false,
            repeatEvery: 1,
            repeatUnit: 'week',
            repeatWeekdays: [],
            repeatUntil: '',
            error: null
        };
        quota = null;

        root = h('div', { class: 'bs-root' }, [
            h('div', { class: 'bs-backdrop', onclick: close }),
            h('section', { class: 'bs-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': sheetTitle() }, [
                h('div', { class: 'bs-handle' }),
                h('div', { class: `bs-mode bs-mode-${draft.mode}` }, [
                    h('span', { class: 'bs-mode-tag', text: MODE_TAG[draft.mode] }),
                    draft.source ? h('span', { class: 'bs-mode-src', text: draft.source }) : null
                ].filter(Boolean)),
                h('header', { class: 'bs-head' }, [
                    h('div', {}, [
                        h('div', { class: 'bs-title', text: sheetTitle() }),
                        h('div', { class: 'bs-step', text: 'Step 1 of 3 · what and when' })
                    ]),
                    h('div', { class: 'bs-bars' }, [1, 2, 3].map(() => h('span', { class: 'bs-bar' }))),
                    h('button', { type: 'button', class: 'bs-close', 'aria-label': 'Close', text: '×', onclick: close })
                ]),
                h('div', { class: 'bs-body' }),
                h('div', { class: 'bs-error', hidden: true }),
                h('div', { class: 'bs-footer' })
            ])
        ]);

        document.body.append(root);
        document.body.style.overflow = 'hidden';
        renderStep();
        loadReference();
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && root) close();
    });

    window.openBookingSheet = open;
    window.editBookingSheet = (entry) => open(entry);
    window.duplicateBookingSheet = (entry) => open(entry, { duplicate: true });
    // `template` is any one occurrence: the schedule knows the rule, the sport and the
    // times, but duration, players and the rest live on the rows it made.
    window.editSeriesSheet = (series, template) => open(template || {
        sport: series.sport, name: series.name, profileId: series.profileId,
        playDate: series.startsOn, startPreferred: series.startPreferred,
        startAlternative: series.startAlternative,
        durationHours: 2, players: 10, indoorOutdoor: 'Indoor', facility: '', otherFacility: '', remarks: ''
    }, { series });
})();
