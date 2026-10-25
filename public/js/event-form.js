// EventForm: the one form for making an event (Home's sheet) and editing one (the management
// page's sheet). mode 'create' adds the calendar, the repeat and the host; 'edit' carries only
// what the event itself holds. The server checks everything again. Needs js/event-links.js.
(function (root) {
    'use strict';

    // Monday first, as the week reads here; values are Date.getDay numbers (0 = Sunday).
    const WEEKDAYS = [[1, 'Mon', 'M'], [2, 'Tue', 'T'], [3, 'Wed', 'W'], [4, 'Thu', 'T'], [5, 'Fri', 'F'], [6, 'Sat', 'S'], [0, 'Sun', 'S']];
    const UNITS = ['day', 'week', 'month'];
    let uid = 0;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    // Events start and end on the hour or the half hour, as courts and rooms are handed out.
    function timeOptions() {
        let html = '<option value="">Pick a time</option>';
        for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
            const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
            html += `<option value="${time}">${time}</option>`;
        }
        return html;
    }

    // A stored time off the half-hour grid is added rather than dropped, so editing an old
    // event cannot silently move it.
    function setTime(select, value) {
        if (value && ![...select.options].some(o => o.value === value)) {
            const option = new Option(value, value);
            const after = [...select.options].find(o => o.value && o.value > value);
            select.insertBefore(option, after || null);
        }
        select.value = value || '';
    }
    function localDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function shortDay(iso) {
        return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    }

    function debounce(fn, ms) {
        let t = null;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    }

    function radio(value, label, checked, attr) {
        return `<button type="button" class="ev-seg" role="radio" aria-checked="${checked}" data-${attr}="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    }

    // A date field that reads yyyy/mm/dd: our text, with the native input invisible on top.
    function dateBox(id) {
        return `<div class="ev-datebox"><span class="input ev-date-show is-empty" aria-hidden="true">yyyy/mm/dd</span>`
            + `<input type="date" id="${id}" class="ev-date-native"></div>`;
    }

    function markup(p, mode) {
        const create = mode === 'create';
        return `
        <section class="ev-card" aria-labelledby="${p}-c-what">
            <h3 class="ev-card-title" id="${p}-c-what">What</h3>
            ${create ? `
            <div class="field" data-part="calendar" hidden>
                <span class="ev-label" id="${p}-cal-label">Calendar</span>
                <div class="ev-cals" data-group="calendar" role="radiogroup" aria-labelledby="${p}-cal-label"></div>
                <p class="field-error" data-error-for="calendar" role="alert" hidden></p>
            </div>` : ''}
            <div class="field">
                <label for="${p}-title">Title</label>
                <input type="text" id="${p}-title" class="input" maxlength="120" autocomplete="off" placeholder="Badminton at the Sportkot">
                <p class="field-error" data-error-for="title" role="alert" hidden></p>
            </div>
        </section>
        <section class="ev-card" aria-labelledby="${p}-c-when">
            <h3 class="ev-card-title" id="${p}-c-when">When and where</h3>
            <div class="field">
                <label for="${p}-date">Day</label>
                ${dateBox(`${p}-date`)}
            </div>
            <div class="field">
                <div class="ev-two">
                    <div class="ev-col">
                        <label for="${p}-start">Starts</label>
                        <select id="${p}-start" class="input select ev-time">${timeOptions()}</select>
                    </div>
                    <div class="ev-col">
                        <label for="${p}-end">Ends</label>
                        <select id="${p}-end" class="input select ev-time">${timeOptions()}</select>
                    </div>
                </div>
                <p class="ev-hint" data-hint="next-day" hidden>Ends the next day.</p>
                <p class="field-error" data-error-for="start" role="alert" hidden></p>
                <p class="field-error" data-error-for="end" role="alert" hidden></p>
            </div>
            ${create ? `
            <div class="field" data-part="repeat">
                <span class="ev-label" id="${p}-rep-label">Repeats</span>
                <div class="ev-segment" data-group="repeat" role="radiogroup" aria-labelledby="${p}-rep-label">
                    ${radio('off', 'Once', true, 'repeat')}${radio('on', 'Repeats', false, 'repeat')}
                </div>
                <div class="ev-repeat" data-hint="repeat-body" hidden>
                    <div class="ev-every">
                        <span class="ev-every-word">Every</span>
                        <input type="number" id="${p}-every" class="input ev-number" min="1" max="12" value="1" inputmode="numeric" aria-label="Every how many">
                        <select id="${p}-unit" class="input select ev-unit" aria-label="Days, weeks or months">
                            ${UNITS.map(u => `<option value="${u}"${u === 'week' ? ' selected' : ''}>${u}</option>`).join('')}
                        </select>
                    </div>
                    <div class="ev-days" data-hint="weekdays" role="group" aria-label="On these days">
                        ${WEEKDAYS.map(([n, name, letter]) => `<button type="button" class="ev-seg ev-day" aria-pressed="false" data-day="${n}" aria-label="${name}">${letter}</button>`).join('')}
                    </div>
                    <div class="ev-until">
                        <label for="${p}-until">Until</label>
                        ${dateBox(`${p}-until`)}
                    </div>
                    <p class="ev-hint ev-preview" data-hint="preview" aria-live="polite"></p>
                </div>
                <p class="field-error" data-error-for="repeat" role="alert" hidden></p>
            </div>` : ''}
            <div class="field">
                <label for="${p}-location">Where</label>
                <div class="ev-place">
                    <input type="text" id="${p}-location" class="input" maxlength="255" autocomplete="off" spellcheck="false"
                        placeholder="Search places" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${p}-place-list">
                    <ul class="ev-place-list" id="${p}-place-list" role="listbox" aria-label="Places" hidden></ul>
                </div>
                <p class="field-error" data-error-for="location" role="alert" hidden></p>
            </div>
        </section>
        <section class="ev-card" aria-labelledby="${p}-c-more">
            <h3 class="ev-card-title" id="${p}-c-more">Details and links</h3>
            <div class="field">
                <label for="${p}-description">Details <span class="ev-optional">optional</span></label>
                <textarea id="${p}-description" class="input ev-textarea" maxlength="4000" rows="4"></textarea>
                <p class="field-error" data-error-for="description" role="alert" hidden></p>
            </div>
            <div class="field">
                <span class="ev-label" id="${p}-links-label">Links <span class="ev-optional">optional</span></span>
                <div data-part="links" role="group" aria-labelledby="${p}-links-label"></div>
                <p class="field-error" data-error-for="links" role="alert" hidden></p>
            </div>
        </section>
        <section class="ev-card" aria-labelledby="${p}-c-who">
            <h3 class="ev-card-title" id="${p}-c-who">Who gets a place</h3>
            <div class="field">
                <span class="ev-label" id="${p}-places-label">Places</span>
                <div class="ev-segment" data-group="places" role="radiogroup" aria-labelledby="${p}-places-label">
                    ${radio('open', 'No limit', true, 'places')}${radio('limit', 'Limited', false, 'places')}
                </div>
                <div class="ev-limit" data-hint="limit" hidden>
                    <button type="button" class="ev-step" data-step="-1" aria-label="One place fewer">−</button>
                    <input type="number" id="${p}-limit" class="input ev-number" min="1" max="500" value="8" inputmode="numeric" aria-label="Number of places">
                    <button type="button" class="ev-step" data-step="1" aria-label="One place more">+</button>
                    <span class="ev-limit-word">places</span>
                </div>
                <p class="field-error" data-error-for="limit" role="alert" hidden></p>
            </div>
            <div class="field">
                <span class="ev-label" id="${p}-approval-label">Joining</span>
                <div class="ev-choice-list" data-group="approval" role="radiogroup" aria-labelledby="${p}-approval-label">
                    <button type="button" class="ev-choice" role="radio" aria-checked="true" data-approval="false">
                        <span class="ev-choice-title">Open</span>
                        <span class="ev-choice-note">First come, first served.</span>
                    </button>
                    <button type="button" class="ev-choice" role="radio" aria-checked="false" data-approval="true">
                        <span class="ev-choice-title">I approve each person</span>
                        <span class="ev-choice-note">You accept each request on the management page.</span>
                    </button>
                </div>
            </div>
        </section>
        ${create ? `
        <section class="ev-card" data-part="you" aria-labelledby="${p}-c-you">
            <h3 class="ev-card-title" id="${p}-c-you">You</h3>
            <div class="field">
                <p class="ev-label">Email</p>
                <p class="ev-signed-as"><span id="${p}-email"></span> <a class="text-link" href="/me">Change</a></p>
                <p class="field-error" data-error-for="hostEmail" role="alert" hidden></p>
            </div>
            <label class="ev-check">
                <input type="checkbox" id="${p}-joins" checked>
                <span>I'm coming too (takes a place)</span>
            </label>
            <div class="field" id="${p}-host-field">
                <label for="${p}-host">Your name</label>
                <input type="text" id="${p}-host" class="input" maxlength="100" autocomplete="name">
                <p class="field-error" data-error-for="hostName" role="alert" hidden></p>
            </div>
        </section>` : ''}`;
    }

    function create(container, { mode = 'create' } = {}) {
        const p = `ef${++uid}`;
        container.innerHTML = markup(p, mode);
        const $ = (suffix) => container.querySelector(`#${p}-${suffix}`);
        const part = (name) => container.querySelector(`[data-part="${name}"]`);
        const hint = (name) => container.querySelector(`[data-hint="${name}"]`);
        const group = (name) => container.querySelector(`[data-group="${name}"]`);
        // Copies each date input's value into its yyyy/mm/dd text. Call after setting one from code.
        const showDates = () => container.querySelectorAll('.ev-date-native').forEach((input) => {
            const show = input.previousElementSibling;
            show.textContent = input.value ? input.value.replaceAll('-', '/') : 'yyyy/mm/dd';
            show.classList.toggle('is-empty', !input.value);
        });
        container.querySelectorAll('.ev-date-native').forEach((input) => {
            input.addEventListener('input', showDates);
            input.addEventListener('change', showDates);
            // A laptop browser opens its calendar only from the icon; open it from anywhere.
            input.addEventListener('click', () => { try { input.showPicker(); } catch (_) { /* not supported */ } });
        });

        const state = { calendar: null, limited: false, approval: false, repeatOn: false, weekdays: [], weekdaysTouched: false, endTouched: false, keptPlace: '', pickedPlace: null };
        const linkEditor = EventLinks.create(part('links'));

        // ---------- Radio groups of buttons, with arrow keys like native radios ----------
        function select(groupEl, button) {
            groupEl.querySelectorAll('[role="radio"]').forEach(b => b.setAttribute('aria-checked', String(b === button)));
        }
        function wire(groupEl, onPick) {
            if (!groupEl) return;
            groupEl.addEventListener('click', (e) => {
                const button = e.target.closest('[role="radio"]');
                if (!button) return;
                select(groupEl, button);
                onPick(button);
            });
            groupEl.addEventListener('keydown', (e) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                const buttons = [...groupEl.querySelectorAll('[role="radio"]')];
                const at = buttons.indexOf(document.activeElement);
                if (at < 0) return;
                e.preventDefault();
                const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
                const next = buttons[(at + step + buttons.length) % buttons.length];
                next.focus();
                select(groupEl, next);
                onPick(next);
            });
        }
        function pick(groupName, attr, value) {
            const groupEl = group(groupName);
            const button = groupEl && groupEl.querySelector(`[data-${attr}="${CSS.escape(String(value))}"]`);
            if (button) select(groupEl, button);
        }

        wire(group('places'), (b) => setLimited(b.dataset.places === 'limit', true));
        wire(group('approval'), (b) => { state.approval = b.dataset.approval === 'true'; });
        wire(group('calendar'), (b) => { state.calendar = b.dataset.calendar; });
        wire(group('repeat'), (b) => setRepeat(b.dataset.repeat === 'on'));

        function setLimited(on, focus) {
            state.limited = on;
            pick('places', 'places', on ? 'limit' : 'open');
            hint('limit').hidden = !on;
            if (on && focus) $('limit').focus();
        }
        container.querySelectorAll('.ev-step').forEach(b => b.addEventListener('click', () => {
            const value = Math.min(500, Math.max(1, (parseInt($('limit').value, 10) || 0) + Number(b.dataset.step)));
            $('limit').value = String(value);
        }));

        // ---------- Times: a new start moves an untouched end to two hours later ----------
        $('start').addEventListener('change', () => {
            if (!state.endTouched && /^\d{2}:\d{2}$/.test($('start').value)) {
                const [h, m] = $('start').value.split(':').map(Number);
                setTime($('end'), `${pad((h + 2) % 24)}:${pad(m)}`);
            }
            nextDayHint();
        });
        $('end').addEventListener('change', () => { state.endTouched = true; nextDayHint(); });
        function nextDayHint() {
            const s = $('start').value;
            const e = $('end').value;
            hint('next-day').hidden = !(s && e && e <= s);
        }

        // ---------- Repeat (create only) ----------
        function setRepeat(on) {
            state.repeatOn = on;
            hint('repeat-body').hidden = !on;
            if (on && !$('until').value && $('date').value) {
                // A sensible first answer: two months on.
                const d = new Date(`${$('date').value}T12:00:00`);
                d.setMonth(d.getMonth() + 2);
                $('until').value = localDate(d);
                showDates();
            }
            if (on) startDayFirst();
            syncWeekdays();
            preview();
        }
        // The first day's own weekday starts ticked (owner, 2026-10-25), and follows the date
        // until the host picks days themselves.
        const weekdayOf = (iso) => new Date(`${iso}T12:00:00`).getDay();
        function startDayFirst() {
            if (state.weekdaysTouched || !$('date').value) return;
            state.weekdays = [weekdayOf($('date').value)];
        }
        function syncWeekdays() {
            if (!hint('weekdays')) return;
            hint('weekdays').hidden = $('unit').value !== 'week';
            hint('weekdays').querySelectorAll('.ev-day').forEach(b => {
                b.setAttribute('aria-pressed', String(state.weekdays.includes(Number(b.dataset.day))));
            });
        }
        function repeatRule() {
            return {
                every: parseInt($('every').value, 10) || 1,
                unit: $('unit').value,
                weekdays: $('unit').value === 'week' ? state.weekdays.slice() : [],
                until: $('until').value
            };
        }
        let previewSeq = 0;
        const preview = debounce(async () => {
            const out = hint('preview');
            if (!out || !state.repeatOn) return;
            const rule = repeatRule();
            if (!$('date').value || !rule.until) {
                out.textContent = 'Pick the first day and an end date.';
                return;
            }
            const seq = ++previewSeq;
            const qs = new URLSearchParams({ date: $('date').value, every: rule.every, unit: rule.unit, weekdays: rule.weekdays.join(','), until: rule.until });
            try {
                const res = await fetch(`/api/events/repeat-preview?${qs}`);
                const body = await res.json();
                if (seq !== previewSeq) return;
                if (!res.ok) {
                    out.textContent = body.error || 'That repeat does not work.';
                    return;
                }
                const n = body.dates.length;
                const dates = n === 1
                    ? `1 date: ${shortDay(body.dates[0])}.`
                    : `${n} dates, ${shortDay(body.dates[0])} to ${shortDay(body.dates[n - 1])}.`;
                // The first day is left out when its weekday is not ticked: say so.
                const first = $('date').value;
                const skipped = n > 0 && body.dates[0] !== first;
                out.textContent = skipped
                    ? `${shortDay(first)} is not one of the days, so it starts ${shortDay(body.dates[0])}. ${dates}`
                    : dates;
            } catch (_) {
                if (seq === previewSeq) out.textContent = '';
            }
        }, 250);
        if (mode === 'create') {
            $('unit').addEventListener('change', () => {
                [...$('unit').options].forEach(o => { o.textContent = (parseInt($('every').value, 10) || 1) === 1 ? o.value : `${o.value}s`; });
                syncWeekdays();
                preview();
            });
            $('every').addEventListener('input', () => $('unit').dispatchEvent(new Event('change')));
            $('until').addEventListener('change', preview);
            // The name is only asked of a host who takes a place.
            $('joins').addEventListener('change', () => { $('host-field').hidden = !$('joins').checked; });
            $('date').addEventListener('change', () => {
                // No weekday picked means the first day's own, as the server reads it.
                startDayFirst();
                syncWeekdays();
                preview();
            });
            hint('weekdays').addEventListener('click', (e) => {
                const b = e.target.closest('.ev-day');
                if (!b) return;
                const day = Number(b.dataset.day);
                state.weekdays = state.weekdays.includes(day) ? state.weekdays.filter(d => d !== day) : [...state.weekdays, day];
                state.weekdaysTouched = true;
                syncWeekdays();
                preview();
            });
        }

        // ---------- Where: the owner's places first, then Google Maps ----------
        // The owner's list loads once and js/place-search.js ranks it as the place is typed.
        // When the server has a Maps key, Google's suggestions follow under "Google Maps"; a
        // place picked there keeps its address and id (state.pickedPlace). Without the key,
        // any place typed is taken as typed. An edited event may keep the place it had.
        let placeList = [];
        let googleOn = false;
        let placeMatches = [];
        let placeActive = -1;
        let googleFor = '';
        let googleResults = [];
        let googleBusy = false;
        let placeSession = '';
        const placeInput = $('location');
        const placeBox = $('place-list');
        const placesReady = fetch('/api/places').then(r => r.json())
            .then(body => { placeList = body.places || []; googleOn = Boolean(body.google); })
            .catch(() => { /* the server still checks the place */ });
        const findPlace = (name) => placeList.find(pl => PlaceSearch.fold(pl.name) === PlaceSearch.fold(name));
        const optionHtml = (pl, i) => `<li role="option" id="${p}-place-${i}" data-index="${i}" aria-selected="${i === placeActive}">`
            + `<span class="ev-place-name">${escapeHtml(pl.name)}</span>`
            + (pl.address ? `<span class="ev-place-address">${escapeHtml(pl.address)}</span>` : '') + '</li>';
        function drawPlaces(keepActive) {
            const q = placeInput.value.trim();
            const listed = PlaceSearch.rank(placeList, q, q ? 5 : 8).map(pl => ({ ...pl, source: 'list' }));
            const fromGoogle = googleOn && q.length >= 2 && googleFor === q ? googleResults : [];
            const seen = new Set(listed.map(pl => PlaceSearch.fold(pl.name)));
            const google = fromGoogle.filter(r => !seen.has(PlaceSearch.fold(r.name))).map(r => ({ ...r, source: 'google' }));
            placeMatches = [...listed, ...google];
            if (!keepActive || placeActive >= placeMatches.length) placeActive = q && placeMatches.length ? 0 : -1;
            let html = listed.map(optionHtml).join('');
            if (google.length) {
                html += '<li class="ev-place-group" role="presentation">Google Maps</li>'
                    + google.map((pl, i) => optionHtml(pl, listed.length + i)).join('');
            }
            if (!placeMatches.length && q) {
                const note = !googleOn ? 'Not on the list. It is saved as typed.'
                    : googleBusy || q.length < 2 ? 'Searching Google Maps…' : 'No place found.';
                html = `<li class="ev-place-none" role="presentation">${note}</li>`;
            }
            placeBox.innerHTML = html;
            openPlaces(Boolean(html));
        }
        const searchGoogle = debounce(async () => {
            const q = placeInput.value.trim();
            if (!googleOn || q.length < 2 || q === googleFor) { googleBusy = false; return; }
            try {
                const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}&session=${placeSession}`);
                const body = await res.json();
                googleFor = q;
                googleResults = body.results || [];
            } catch (_) {
                googleFor = q;
                googleResults = [];
            }
            googleBusy = false;
            if (document.activeElement === placeInput && placeInput.value.trim() === q) drawPlaces(true);
        }, 250);
        function openPlaces(open) {
            placeBox.hidden = !open;
            placeInput.setAttribute('aria-expanded', String(open));
            markActive();
        }
        function markActive() {
            placeBox.querySelectorAll('[role="option"]').forEach(li => li.setAttribute('aria-selected', String(Number(li.dataset.index) === placeActive)));
            const active = placeActive >= 0 ? $(`place-${placeActive}`) : null;
            if (active) { placeInput.setAttribute('aria-activedescendant', active.id); active.scrollIntoView({ block: 'nearest' }); }
            else placeInput.removeAttribute('aria-activedescendant');
        }
        function choosePlace(pl) {
            placeInput.value = pl.name;
            state.pickedPlace = pl.source === 'google' ? { name: pl.name, address: pl.address || '', placeId: pl.placeId } : null;
            placeSession = '';
            openPlaces(false);
            const error = container.querySelector('[data-error-for="location"]');
            if (error) { error.hidden = true; error.textContent = ''; }
        }
        placeInput.addEventListener('focus', () => placesReady.then(() => {
            if (document.activeElement !== placeInput) return;
            if (!placeSession) placeSession = root.crypto?.randomUUID ? root.crypto.randomUUID() : String(Date.now());
            drawPlaces();
        }));
        placeInput.addEventListener('input', () => {
            state.pickedPlace = null;
            googleBusy = googleOn && placeInput.value.trim().length >= 2 && placeInput.value.trim() !== googleFor;
            drawPlaces();
            searchGoogle();
        });
        placeInput.addEventListener('keydown', (e) => {
            const open = !placeBox.hidden;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!open) return drawPlaces();
                if (!placeMatches.length) return;
                const step = e.key === 'ArrowDown' ? 1 : -1;
                placeActive = (placeActive + step + placeMatches.length) % placeMatches.length;
                markActive();
            } else if (e.key === 'Enter' && open && placeActive >= 0) {
                e.preventDefault();
                choosePlace(placeMatches[placeActive]);
            } else if (e.key === 'Escape' && open) {
                e.preventDefault();
                e.stopPropagation();
                openPlaces(false);
            }
        });
        // A tap picks on pointerup, before the field's blur closes the list. Safari on iPhone
        // drops the click after a cancelled touch pointerdown, so only a mouse cancels it (to
        // keep the focus in the field). A finger that moved was scrolling the list, not picking.
        let placePress = null;
        let placePicked = false;
        placeBox.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') e.preventDefault();
            placePress = { id: e.pointerId, x: e.clientX, y: e.clientY };
            placePicked = false;
        });
        placeBox.addEventListener('pointerup', (e) => {
            const press = placePress;
            placePress = null;
            if (!press || press.id !== e.pointerId || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) return;
            const li = e.target.closest('[role="option"]');
            if (!li) return;
            placePicked = true;
            choosePlace(placeMatches[Number(li.dataset.index)]);
        });
        placeBox.addEventListener('pointercancel', () => { placePress = null; });
        // Keyboards and screen readers still pick by click.
        placeBox.addEventListener('click', (e) => {
            if (placePicked) { placePicked = false; return; }
            const li = e.target.closest('[role="option"]');
            if (li) choosePlace(placeMatches[Number(li.dataset.index)]);
        });
        placeInput.addEventListener('blur', () => {
            openPlaces(false);
            // A name typed in full takes the list's own spelling.
            const exact = !state.pickedPlace && findPlace(placeInput.value);
            if (exact) placeInput.value = exact.name;
        });

        // ---------- Errors ----------
        function clearErrors() {
            container.querySelectorAll('[data-error-for]').forEach(el => { el.hidden = true; el.textContent = ''; });
        }
        // Shows a message under its field and focuses it. False when the form has no such field.
        function showError(field, message, focusEl) {
            const el = container.querySelector(`[data-error-for="${field}"]`);
            if (!el) return false;
            el.textContent = message;
            el.hidden = false;
            const target = focusEl || el.closest('.field')?.querySelector('input, textarea, select, button');
            if (target) target.focus();
            return true;
        }

        return {
            // calendars: [{ name, shape? }]. Each is a tile with its shape, as on Home.
            setCalendars(calendars, preferred) {
                const names = calendars.map(c => c.name);
                state.calendar = names.includes(preferred) ? preferred : names[0] || null;
                const field = part('calendar');
                if (!field) return;
                group('calendar').innerHTML = calendars.map(c => {
                    const shape = c.shape || 'diamond';
                    return `<button type="button" class="ev-cal" role="radio" aria-checked="${c.name === state.calendar}" data-calendar="${escapeHtml(c.name)}">`
                        + `<svg class="shape s-${shape}" aria-hidden="true" focusable="false"><use href="#shape-${shape}"/></svg>`
                        + `<span>${escapeHtml(c.name)}</span></button>`;
                }).join('');
                field.hidden = names.length < 2;
            },
            setHostName(name) {
                if ($('host')) $('host').value = name || '';
            },
            // The signed-in email; the host email is never typed (the server takes it from the session).
            setHostEmail(email) {
                if ($('email')) $('email').textContent = email || '';
            },
            // The edit sheet opens on the event as it stands.
            set(values) {
                $('title').value = values.title || '';
                $('date').value = values.date || '';
                showDates();
                setTime($('start'), values.start);
                setTime($('end'), values.end);
                state.endTouched = Boolean(values.end);
                $('location').value = values.location || '';
                state.keptPlace = values.location || '';
                state.pickedPlace = null;
                $('description').value = values.description || '';
                linkEditor.set(values.links || []);
                const limited = values.limit !== null && values.limit !== undefined && values.limit !== '';
                if (limited) $('limit').value = String(values.limit);
                setLimited(limited, false);
                state.approval = Boolean(values.approval);
                pick('approval', 'approval', String(state.approval));
                nextDayHint();
            },
            reset() {
                container.querySelectorAll('input[type="text"], input[type="date"], input[type="email"], textarea, select.ev-time')
                    .forEach(el => { el.value = ''; });
                if ($('joins')) {
                    $('joins').checked = true;
                    $('host-field').hidden = false;
                }
                $('limit').value = '8';
                linkEditor.set([]);
                setLimited(false, false);
                state.approval = false;
                pick('approval', 'approval', 'false');
                state.endTouched = false;
                state.keptPlace = '';
                state.pickedPlace = null;
                if (mode === 'create') {
                    state.weekdays = [];
                    state.weekdaysTouched = false;
                    $('every').value = '1';
                    $('unit').value = 'week';
                    pick('repeat', 'repeat', 'off');
                    setRepeat(false);
                }
                nextDayHint();
                clearErrors();
                showDates();
            },
            value() {
                const body = {
                    title: $('title').value,
                    date: $('date').value,
                    start: $('start').value,
                    end: $('end').value,
                    location: $('location').value,
                    // Only a place picked from Google carries these; the server fills a listed one.
                    locationAddress: state.pickedPlace?.name === $('location').value ? state.pickedPlace.address : '',
                    placeId: state.pickedPlace?.name === $('location').value ? state.pickedPlace.placeId : '',
                    description: $('description').value,
                    links: linkEditor.value(),
                    limit: state.limited ? $('limit').value : null,
                    approval: state.approval
                };
                if (mode === 'create') {
                    Object.assign(body, {
                        calendar: state.calendar,
                        repeat: state.repeatOn ? repeatRule() : null,
                        hostName: $('joins').checked ? $('host').value : '',
                        hostJoins: $('joins').checked,
                        hostEmail: $('email').textContent
                    });
                }
                return body;
            },
            // What can be fixed before a round trip. True when the form may be sent.
            check() {
                clearErrors();
                const body = this.value();
                if (!body.title.trim()) return !showError('title', 'Give it a title.');
                if (!body.date || !body.start) return !showError('start', 'Pick a day and a start time.', $(body.date ? 'start' : 'date'));
                if (!body.end) return !showError('end', 'Pick an end time.', $('end'));
                const place = body.location.trim();
                if (!place) return !showError('location', 'Pick a place.');
                if (googleOn && !findPlace(place) && !body.placeId && place !== state.keptPlace) {
                    return !showError('location', 'Pick a place from the suggestions.');
                }
                const badLink = linkEditor.invalid();
                if (badLink) return !showError('links', 'That is not a web address. It starts with https://', badLink);
                if (mode === 'create') {
                    if (!body.calendar) return !showError('calendar', 'Pick a calendar.');
                    if (body.repeat && !body.repeat.until) return !showError('repeat', 'Say until when it repeats.', $('until'));
                    if (!body.hostEmail.trim()) return !showError('hostEmail', 'Sign in to make an event.');
                    if (body.hostJoins && !body.hostName.trim()) return !showError('hostName', 'Add your name for the guest list.');
                }
                return true;
            },
            showError,
            clearErrors,
            focus() { $('title').focus(); },
            setMinDate() { $('date').min = localDate(new Date()); }
        };
    }

    const EventForm = { create };
    if (typeof module !== 'undefined' && module.exports) module.exports = EventForm;
    else root.EventForm = EventForm;
})(typeof window !== 'undefined' ? window : globalThis);
