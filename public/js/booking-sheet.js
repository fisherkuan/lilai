/*
 * Queue a slot — one scrolling sheet of grouped cards, as in Make an event (owner,
 * 2026-10-25; it was three steps until then).
 *
 * Who, sport and day; times; repeat; players and court, then what happens next. The quiet
 * fields (players, indoor, facility, remarks) are filled in from last time. The second
 * start time is the field people get wrong: it is a different START, not an end time.
 *
 * The quota is counted on the NAME, so the name is asked first. That resolves the tally
 * before anyone fills in ten other fields, rather than after.
 */
(() => {
    'use strict';

    const { h, readJson, isoDate, MONTHS } = window.bookingShared;

    const DEFAULTS_STORE = 'lilai.booking.defaults';

    // KU Leuven's own form asks for the sport as free text, so this one does too — typed,
    // not picked. Padel, tennis, table tennis, beach volleyball and outdoor basketball go
    // through KU Leuven's separate online tool, and the server refuses them whatever the
    // spelling.
    const SPORT_MAX = 100;
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
        return { text: `${prettyDate(iso)} at 00:00`, suffix: when, iso, open: days <= 0 };
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
            return render();
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
        render();
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

    /*
     * Two mutually exclusive answers laid out as one control: tiles that share their
     * borders, so the choice reads as a single object rather than as loose buttons. Used
     * for duration and for the repeat toggle, which are the same shape of question.
     */
    function segment(values, current, onPick, labelOf = (v) => v) {
        return h('div', { class: 'bs-segment' }, values.map((value) => h('button', {
            type: 'button',
            class: `bs-seg${value === current ? ' selected' : ''}`,
            text: labelOf(value),
            onclick: () => onPick(value)
        })));
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
        if (!draft.name || !draft.playDate) return render();
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
        render();
    }

    /*
     * The tally, under the name it counts.
     *
     * It used to be a grey strip at the top of the sheet, saying "Two slots per person per
     * week" before anyone had been picked — a rule where a fact belongs. It renders once
     * the server has answered for a real name and a real week, and not before: a count
     * without the week it counts is the exact ambiguity people ask about. A full week says
     * it in its own card, under the day, so the strip stands down.
     */
    function quotaStrip() {
        if (!quota || quota.remaining === 0) return null;
        const pips = h('span', { class: 'bs-pips' });
        for (let i = 0; i < quota.limit; i += 1) {
            pips.append(h('span', { class: `bq-pip${i < quota.used ? ' used' : ''}` }));
        }
        return h('div', { class: 'bs-tally' }, [
            pips,
            h('span', {}, [
                h('span', { class: 'bs-tally-used', text: `${quota.used} of ${quota.limit} slots used` }),
                ` · week of ${prettyDate(quota.week.start)} – ${prettyDate(quota.week.end)}`
            ])
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

    async function addPerson() {
        const saved = await window.bookingPeople.openEditor(null);
        if (saved) pickPerson(saved);
        else render();
    }

    /*
     * The people manager, opened from inside the sheet.
     *
     * It owns its own layer and does not report when it closes, so the sheet is repainted
     * when that layer leaves the DOM — a person added in there has to appear in the select
     * that sent you to it, and a person deleted in there must not stay picked.
     */
    async function openPeopleManager() {
        const before = document.querySelectorAll('.bs-root').length;
        await window.bookingPeople.openManager();
        const roots = document.querySelectorAll('.bs-root');
        const layer = roots.length > before ? roots[roots.length - 1] : null;
        if (!layer) return render();
        const watch = new MutationObserver(() => {
            if (layer.isConnected) return;
            watch.disconnect();
            if (draft.profileId && !window.bookingPeople.byId(draft.profileId)) {
                draft.profileId = null;
                draft.name = '';
                quota = null;
            }
            render();
        });
        watch.observe(document.body, { childList: true });
    }

    /*
     * One line, not a list.
     *
     * The address book used to render as full-width rows carrying a masked email and phone
     * each: at four people the sport field was below the fold, and nobody was ever choosing
     * between two spellings of one person's address. The contact details are a promise kept
     * on the next screen, not a thing to pick between here.
     */
    // Grouped cards (owner, 2026-10-25): each part of the page is a raised card on the grey
    // sheet, under a small uppercase title when it needs one.
    function card(title, parts) {
        const kept = parts.filter(Boolean);
        if (kept.length === 0) return null;
        return h('section', { class: 'bs-card' }, [title ? h('h3', { class: 'bs-card-title', text: title }) : null, ...kept].filter(Boolean));
    }

    // A date field that reads yyyy/mm/dd, as in Make an event: our text, with the native
    // input invisible on top so a tap still opens the phone's picker.
    function dateBox(input) {
        const show = h('span', { class: 'bs-date bs-date-show', 'aria-hidden': 'true' });
        const sync = () => {
            show.textContent = input.value ? input.value.replaceAll('-', '/') : 'yyyy/mm/dd';
            show.classList.toggle('is-empty', !input.value);
        };
        input.classList.add('bs-date-native');
        input.addEventListener('input', sync);
        input.addEventListener('change', sync);
        input.addEventListener('click', () => { try { input.showPicker(); } catch (_) { /* not supported */ } });
        sync();
        return h('div', { class: 'bs-datebox' }, [show, input]);
    }

    function stepWho() {
        const people = window.bookingPeople.list();

        const head = h('div', { class: 'bs-label-row' }, [
            h('label', { class: 'bs-label', text: 'Booking for' }),
            h('button', { type: 'button', class: 'text-btn bs-manage', text: 'Manage people', onclick: openPeopleManager })
        ]);

        if (people.length === 0) {
            return h('div', { class: 'bs-field' }, [
                head,
                h('button', { type: 'button', class: 'bs-person-add', text: 'Add the first person', onclick: addPerson }),
                h('p', { class: 'bs-note', text: window.bookingPeople.loaded()
                    ? 'Nobody in the list yet. Add a person once and their email and phone are never asked for again.'
                    : 'Loading the people who book…' })
            ]);
        }

        // Names only. Adding someone is not a person you can book, and a list that offers
        // both asks the reader to tell a choice from a command; "Manage people", on the
        // label row, is where that happens.
        const select = h('select', { class: 'bs-select', 'aria-label': 'Booking for' }, [
            draft.profileId ? null : h('option', { value: '', text: 'Choose a person' }),
            ...people.map((person) => h('option', { value: person.id, text: person.name }))
        ]);
        select.value = draft.profileId || '';
        const picked = draft.profileId ? window.bookingPeople.byId(draft.profileId) : null;
        select.addEventListener('change', () => {
            const person = window.bookingPeople.byId(select.value);
            if (person) pickPerson(person);
        });

        return h('div', { class: 'bs-field' }, [
            head,
            select,
            quotaStrip(),
            // The privacy sentence sits under the contact details it is about.
            h('p', { class: 'bs-note', text: picked
                ? `${picked.emailMasked} · ${picked.phoneMasked}. They go on KU Leuven\u2019s form and nowhere else; the board shows only the name.`
                : 'Email and phone come with the name, never asked for twice.' })
        ]);
    }

    function whoAndDay() {
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

        const sport = h('input', {
            type: 'text',
            class: 'bs-input',
            maxlength: String(SPORT_MAX),
            placeholder: 'Badminton, basketball, …',
            value: draft.sport || '',
            'aria-label': 'Sport'
        });
        // Re-rendering the page on every keystroke would take the caret with it. Only the
        // footer reads this field, so only the footer is refreshed while typing.
        sport.addEventListener('input', () => { draft.sport = sport.value.trim(); renderFooter(); });

        const day = card('Sport and day', [h('div', { class: 'bs-field' }, [
            h('label', { class: 'bs-label', text: 'Sport' }),
            sport,
            h('p', { class: 'bs-note', text: 'Padel, tennis, table tennis and beach volleyball are booked through KU Leuven’s separate online tool, not this form.' })
        ]),
        h('div', { class: 'bs-field' }, [
            h('label', { class: 'bs-label', text: 'Day you want to play' }),
            dateBox(picker),
            h('p', { class: 'bs-note', text: options.seasonEndsOn
                ? `Any day from today to ${prettyDate(options.seasonEndsOn)}, when this season's sports card runs out.`
                : 'Any day from today.' })
        ])]);
        // render() keeps this card in place while it holds the focus.
        day.dataset.part = 'day';

        return [card(null, [stepWho()]), day];
    }

    function timesAndCourt() {
        const duration = segment(DURATIONS, draft.durationHours,
            (value) => { draft.durationHours = value; render(); },
            (value) => (value === 1 ? '1 hr' : `${value} hrs`));

        /*
         * Courts are handed out on the hour and the half hour, so those are the only times
         * offered. A free time field accepted 19:07 and sent it to KU Leuven, where nobody
         * could grant it — the server refuses those now, and a list means never having to.
         *
         * A stored value outside the list is added rather than dropped, so editing an old
         * entry cannot silently move its time.
         */
        const timeInput = (value, onset, name, fallback = '18:00') => {
            const times = [];
            for (let minutes = 6 * 60; minutes <= 23 * 60 + 30; minutes += 30) {
                times.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
            }
            if (value && !times.includes(value)) times.push(value);
            times.sort();

            const select = h('select', { class: 'bs-time-input', 'aria-label': name }, [
                h('option', { value: '', text: 'Pick a time' }),
                ...times.map((time) => h('option', { value: time, text: time }))
            ]);
            select.value = value || '';
            select.addEventListener('change', () => { onset(select.value || null); render(); });
            // A wheel instead of a list (js/time-wheel.js); it needs the select in the page.
            if (window.TimeWheel) requestAnimationFrame(() => { if (select.isConnected) window.TimeWheel.attach(select, { fallback: value || fallback }); });
            return select;
        };

        const starts = timeInput(draft.startPreferred, (value) => {
            draft.startPreferred = value;
            if (value && draft.startAlternative === value) draft.startAlternative = null;
        }, 'First choice start');

        const alternatives = timeInput(draft.startAlternative, (value) => {
            draft.startAlternative = value;
        }, 'Start if that is taken', addHours(draft.startPreferred || '18:00', 1));

        /*
         * The one sentence that has to land: both fields are starts.
         *
         * It used to take a bordered panel, a "required" tag and three notes to say it,
         * because the second field was being read as an end time. A sub-label and one
         * worked example do the same job in a line, and the example is computed from the
         * draft, so it is this booking's own hours rather than a stock illustration.
         */
        const hoursWord = draft.durationHours === 1 ? '1-hour' : `${draft.durationHours}-hour`;
        const example = draft.startPreferred && draft.startAlternative
            ? [
                `Both are ${hoursWord} slots: `,
                h('span', { class: 'bs-ink', text:
                    `${draft.startPreferred}–${addHours(draft.startPreferred, draft.durationHours)}, or ${draft.startAlternative}–${addHours(draft.startAlternative, draft.durationHours)}` }),
                '. The second is another start, not an end time.'
            ]
            : [`Both are ${hoursWord} starts, not a start and an end. The second is the fallback if the first is taken.`];

        return [
            card('Times', [h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'How long' }),
                duration
            ]),
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Start time' }),
                h('div', { class: 'bs-two' }, [
                    h('div', { class: 'bs-col' }, [
                        h('span', { class: 'bs-sublabel', text: 'First choice' }),
                        starts
                    ]),
                    h('div', { class: 'bs-col' }, [
                        h('span', { class: 'bs-sublabel', text: 'If that\u2019s taken' }),
                        alternatives
                    ])
                ]),
                h('p', { class: 'bs-note' }, example)
            ])]),
            repeatCard(),
            card('Players and court', detailFields())
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

    // render() keeps this card in place while "Until" holds the focus.
    function repeatCard() {
        const repeat = card(null, [repeatField()]);
        if (repeat) repeat.dataset.part = 'repeat';
        return repeat;
    }

    // A tap on a button leaves the focus in a date field on iOS, and render() would then
    // keep a card these buttons are about to change.
    function releaseFocus() {
        const focused = document.activeElement;
        if (focused && focused.blur) focused.blur();
    }

    function repeatField() {
        if (draft.editingId) return null;

        const parts = [
            h('label', { class: 'bs-label', text: 'Repeat' }),
            draft.editingSeriesId ? null : segment([false, true], draft.repeatOn, (value) => {
                draft.repeatOn = value;
                if (!value) preview = null;
                releaseFocus();
                render();
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
            render();
            refreshPreview();
        });

        const unit = h('select', { class: 'bs-time-input bs-unit' }, (options.repeatUnits || ['day', 'week', 'month'])
            .map((value) => h('option', { value, text: draft.repeatEvery === 1 ? value : `${value}s` })));
        unit.value = draft.repeatUnit;
        unit.addEventListener('change', () => {
            draft.repeatUnit = unit.value;
            render();
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
                h('div', { class: 'bs-pills bs-pills-days' }, WEEKDAY_PILLS.map(([day, label]) => h('button', {
                    type: 'button',
                    class: `bs-pill bs-day-pill${draft.repeatWeekdays.includes(day) ? ' selected' : ''}`,
                    text: label,
                    onclick: () => {
                        draft.repeatWeekdays = draft.repeatWeekdays.includes(day)
                            ? draft.repeatWeekdays.filter((picked) => picked !== day)
                            : [...draft.repeatWeekdays, day].sort((a, b) => a - b);
                        releaseFocus();
                        render();
                        refreshPreview();
                    }
                }))),
                // The two-a-week limit is already said by the tally under the name and by the
                // preview below; a third copy here was the one nobody read.
                draft.repeatWeekdays.length === 0
                    ? h('p', { class: 'bs-note', text: `Nothing chosen means the day the first booking falls on${draft.playDate ? ` — ${prettyDate(draft.playDate).split(' ')[0]}` : ''}.` })
                    : null
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
            render();
            refreshPreview();
        });
        parts.push(h('div', { class: 'bs-field' }, [
            h('label', { class: 'bs-label bs-label-sm', text: 'Until' }),
            dateBox(until)
        ]));

        // Whatever the server says the rule expands to, verbatim — including its refusals.
        const dates = preview ? preview.dates : [];
        parts.push(h('p', { class: 'bs-preview', 'data-live': 'preview', text: !draft.repeatUntil
            ? 'Pick the last day to see what this books.'
            : preview && preview.message ? preview.message
                : dates.length === 0 ? 'Working out the dates…'
                    : `${dates.length} ${dates.length === 1 ? 'booking' : 'bookings'} — ${prettyDate(dates[0])} to ${prettyDate(dates[dates.length - 1])}.` }));
        parts.push(h('p', { class: 'bs-note', text: 'Each one is queued on its own: editable, cancellable, counted against its own week. Weeks already full are reported, not silently skipped.' }));

        return h('div', { class: 'bs-field' }, parts);
    }

    /*
     * What happens next, at the foot of the page: when the request goes out and who answers.
     * Queuing is not booking, so the card says KU Leuven decides.
     */
    function whatNext() {
        const firstName = String(draft.name || '').trim().split(/\s+/)[0] || 'the person booking';
        const opening = draft.playDate ? openingLabel(draft.playDate) : null;
        const lead = !opening ? null
            : h('p', { class: 'bs-block-lead' }, opening.open
                ? ['The form for ', h('strong', { text: prettyDate(draft.playDate) }), ' opened ', h('strong', { text: opening.text }), '. The request goes out as soon as you queue it.']
                : ['The form for ', h('strong', { text: prettyDate(draft.playDate) }), ' opens ', h('strong', { text: opening.text }), opening.suffix, '. The slot waits here and goes out in the first minute.']);
        return [
            h('div', { class: 'bs-block' }, [
                h('div', { class: 'bs-block-title', text: 'What happens next' }),
                lead,
                h('p', { class: 'bs-block-note', text: `KU Leuven decides, and emails ${firstName} directly, usually within a day or two. A sent request is not a booked court.` })
            ].filter(Boolean)),
            // The only fine print left, and it stays readable: 12px muted grey on white is
            // 2.5:1, which is not a colour this sentence may be set in.
            h('p', { class: 'bs-note', text: 'A valid KU Leuven sports card is required to book. We do not check it and never could — that is between the player and KU Leuven.' })
        ];
    }

    /**
     * 1h: refuse and redirect. No waitlist — nothing here can guarantee a handover. It sits
     * under the day field, which stays live: another week is the usual way out.
     */
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
            h('div', { class: 'bs-full bs-card' }, [
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
                h('p', { class: 'bs-note', text: 'Only a slot still waiting can be swapped. Once a request has gone to KU Leuven it counts against the week whatever they answer.' }),
                h('p', { class: 'bs-note', text: 'To book another week, change the day above.' })
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
    }

    // --- Everything else ----------------------------------------------------------------

    /*
     * Players, indoor or outdoor, facility and remarks, laid out on the page itself.
     *
     * They used to fold into a one-line summary with a Change button that opened a second
     * sheet over the first. That hid the player count, the one of the four that has to be
     * true, behind a tap, and a sheet on top of a sheet was a place people lost their way.
     * They still carry over from last time, so most bookings never touch them.
     *
     * The typed fields write to the draft as you type and never repaint the page, which
     * would take the caret with it. Only the choices that change what is shown repaint.
     */
    function detailFields() {
        const players = h('input', { type: 'number', class: 'bs-input', min: '10', max: '200', value: String(draft.players) });
        players.addEventListener('change', () => {
            draft.players = Math.max(10, parseInt(players.value, 10) || 10);
            players.value = String(draft.players);
        });

        const facility = h('select', { class: 'bs-input', 'aria-label': 'Facility' }, [
            h('option', { value: '', text: 'No preference' }),
            ...options.facilities.map((name) => h('option', { value: name, text: name }))
        ]);
        facility.value = draft.facility || '';
        facility.addEventListener('change', () => { draft.facility = facility.value; render(); });

        const other = h('input', { type: 'text', class: 'bs-input', placeholder: 'Which court or hall?', value: draft.otherFacility || '' });
        other.addEventListener('input', () => { draft.otherFacility = other.value.trim(); });

        const remarks = h('textarea', { class: 'bs-input', rows: '2', placeholder: 'Anything KU Leuven should know' });
        remarks.value = draft.remarks || '';
        remarks.addEventListener('input', () => { draft.remarks = remarks.value.trim(); });

        return [
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Players' }),
                players,
                h('p', { class: 'bs-note', text: 'At least 10, and it must be truthful — we will not round it up for you.' })
            ]),
            h('div', { class: 'bs-field' }, [
                h('label', { class: 'bs-label', text: 'Indoor or outdoor' }),
                pillGroup(['Indoor', 'Outdoor'], draft.indoorOutdoor, (value) => {
                    draft.indoorOutdoor = value;
                    render();
                })
            ]),
            h('div', { class: 'bs-field' }, [h('label', { class: 'bs-label', text: 'Facility' }), facility]),
            draft.facility === 'Andere / Other'
                ? h('div', { class: 'bs-field' }, [h('label', { class: 'bs-label', text: 'Name the facility' }), other])
                : null,
            h('div', { class: 'bs-field' }, [h('label', { class: 'bs-label', text: 'Remarks' }), remarks])
        ];
    }

    // --- Shell ---------------------------------------------------------------------------

    /*
     * Which of the three things the sheet is doing, said once and never overwritten.
     *
     * The title says what the sheet does, but not which slot; without this banner, editing an
     * existing slot and copying one look alike, and the difference matters — one of them
     * changes a slot someone is already counting on.
     */
    const MODE_TAG = {
        create: 'New slot',
        duplicate: 'New slot, copied from',
        edit: 'Editing'
    };

    /*
     * What still stops the queue, in page order, or null. The button stays live and says
     * this on a tap: a grey button at the foot of a long page would not say why.
     */
    function missing() {
        if (!draft.profileId) return 'Choose who the booking is for.';
        if (!draft.sport) return 'Type the sport.';
        if (!draft.playDate) return 'Pick the day you want to play.';
        if (!draft.startPreferred || !draft.startAlternative) return 'Pick both start times.';
        // The count on the button has to be a number the server agreed to.
        if (draft.repeatOn && (!preview || preview.dates.length === 0)) return 'Pick when the repeat ends, and wait for its dates.';
        return null;
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
            footer.append(h('button', { type: 'button', class: 'btn btn-line bs-wide', text: 'Leave it for now', onclick: close }));
            return;
        }
        const count = draft.repeatOn && preview ? preview.dates.length : 1;
        const label = draft.editingId ? 'Save changes'
            : draft.editingSeriesId ? 'Save the schedule'
                : count > 1 ? `Queue all ${count}` : 'Put it in the queue';
        footer.append(h('button', { type: 'button', class: 'btn btn-solid bs-next', text: label, onclick: submit }));
    }

    function render() {
        if (!root) return;
        const full = quota && quota.remaining === 0;

        // Every choice repaints the page, so keep the reader where they were.
        const body = root.querySelector('.bs-body');
        const scroll = body.scrollTop;
        // A full week replaces the rest of the form, never the person and the day: a picker
        // that lands on this week first (it opens on today) must not lock out the next one.
        const parts = [...whoAndDay(), ...(full ? stepFull() : [...timesAndCourt(), ...whatNext()])].filter(Boolean);
        /*
         * The card (`data-part`) that holds a focused date field stays where it is. iOS fills an empty
         * date field with today the moment its picker opens, and a repaint that took the
         * field out of the page shut the picker before anyone had picked. That covers the
         * day card and the repeat card's "Until". The next repaint after the focus leaves
         * catches the card up; until then, what it shows of the draft is patched in place
         * (`data-live`), so the preview for the picked date is already right.
         */
        const focused = document.activeElement;
        const holder = focused && body.contains(focused) && focused.matches('input[type="date"]')
            ? focused.closest('[data-part]') : null;
        const fresh = holder ? parts.find((part) => part.dataset.part === holder.dataset.part) : null;
        const kept = fresh ? holder : null;
        if (kept) {
            for (const live of fresh.querySelectorAll('[data-live]')) {
                const old = kept.querySelector(`[data-live="${live.dataset.live}"]`);
                if (old) old.textContent = live.textContent;
            }
        }
        for (const child of [...body.children]) { if (child !== kept) child.remove(); }
        let beforeKept = Boolean(kept);
        for (const part of parts) {
            if (kept && part === fresh) { beforeKept = false; continue; }
            if (beforeKept) body.insertBefore(part, kept);
            else body.append(part);
        }
        body.scrollTop = scroll;

        root.querySelector('.bs-step').textContent = full ? 'That week is full' : '';
        root.querySelector('.bs-title').textContent = sheetTitle();

        renderFooter();
        setError(draft.error);
    }

    async function submit() {
        const gap = missing();
        if (gap) return setError(gap);
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
                    return render();
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
        footer.append(h('button', { type: 'button', class: 'btn btn-solid bs-wide', text: 'Done', onclick: close }));
        setError(null);
    }

    function close() {
        if (!root) return;
        root.remove();
        root = null;
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
        // the sheet will not queue on a count the server has not agreed to.
        if (draft.repeatOn) refreshPreview();
        if (draft.profileId && draft.playDate) return refreshQuota();
        render();
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
            mode: series ? 'series' : duplicate ? 'duplicate' : 'edit',
            source: series ? series.summary : `${entry.sport} · ${prettyDate(entry.playDate)}`,
            // A schedule edit changes the rule and every occurrence still waiting under it;
            // it is not an edit of the one row it happens to be seeded from.
            editingId: (duplicate || series) ? null : entry.id,
            editingSeriesId: series ? series.id : null,
            name: entry.name,
            // Both an edit and a duplicate start from the person the entry was booked for.
            // If that person has since been removed, the sheet asks for a new one.
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
            mode: 'create',
            source: null,
            editingId: null,
            editingSeriesId: null,
            name: '',
            // Filled in by loadReference from whoever this browser picked last.
            profileId: null,
            sport: defaults.sport || '',
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
                // A new slot needs no strip: its title already says "Queue a slot". Only an
                // edit or a copy, whose title becomes the booking's name, keeps one.
                draft.mode === 'create' ? null : h('div', { class: `bs-mode bs-mode-${draft.mode}` }, [
                    h('span', { class: 'bs-mode-tag', text: MODE_TAG[draft.mode] }),
                    draft.source ? h('span', { class: 'bs-mode-src', text: draft.source }) : null
                ].filter(Boolean)),
                h('header', { class: 'bs-head' }, [
                    h('div', {}, [
                        h('div', { class: 'bs-title', text: sheetTitle() }),
                        h('div', { class: 'bs-step' })
                    ]),
                    h('button', { type: 'button', class: 'bs-close icon-btn', 'aria-label': 'Close', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>', onclick: close })
                ]),
                h('div', { class: 'bs-body' }),
                h('div', { class: 'bs-error', hidden: true }),
                h('div', { class: 'bs-footer' })
            ])
        ]);

        document.body.append(root);
        render();
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
