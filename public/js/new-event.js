// Make an event (/events/new). The server writes it to Google Calendar and answers with
// the host link, which this device remembers under "You host" (lilai.hostedEvents).
(() => {
    'use strict';

    const NAME_KEY = 'lilai.attendeeName';
    const HOSTED_KEY = 'lilai.hostedEvents';
    const HOSTED_MAX = 20;

    const form = document.getElementById('event-form');
    const submitBtn = document.getElementById('submit-btn');
    const startInput = document.getElementById('ev-start');
    const endInput = document.getElementById('ev-end');
    const dateInput = document.getElementById('ev-date');
    const limitInput = document.getElementById('ev-limit');
    let calendar = null;
    let limited = false;
    let approval = false;
    let endTouched = false;
    const linkEditor = EventLinks.create(document.getElementById('ev-links'));

    function read(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }

    function write(key, value) {
        try { localStorage.setItem(key, value); } catch (_) { /* private mode: nothing to keep */ }
    }

    function hostedEvents() {
        try {
            const list = JSON.parse(read(HOSTED_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (_) {
            return [];
        }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // "Sat 3 Oct, 19:30" in the device's own zone, like Home.
    function whenText(iso) {
        const d = new Date(iso);
        return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    function renderHosted() {
        const now = Date.now();
        const upcoming = hostedEvents().filter(e => new Date(e.date).getTime() > now - 86400000);
        const section = document.getElementById('hosted-list');
        section.hidden = upcoming.length === 0;
        document.getElementById('hosted-items').innerHTML = upcoming.map(e =>
            `<li><a class="text-link" href="${escapeHtml(e.hostPath)}">${escapeHtml(e.title)}</a><span class="ev-hosted-when">${escapeHtml(whenText(e.date))}</span></li>`
        ).join('');
    }

    function rememberHosted(entry) {
        const list = [entry, ...hostedEvents().filter(e => e.hostPath !== entry.hostPath)].slice(0, HOSTED_MAX);
        write(HOSTED_KEY, JSON.stringify(list));
    }

    // ---------- Choices ----------

    function selectIn(group, button) {
        group.querySelectorAll('[role="radio"]').forEach(b => b.setAttribute('aria-checked', String(b === button)));
    }

    // Arrow keys move along a radiogroup of buttons, as they would along native radios.
    function wireRadioGroup(group, onPick) {
        group.addEventListener('click', (e) => {
            const button = e.target.closest('[role="radio"]');
            if (!button) return;
            selectIn(group, button);
            onPick(button);
        });
        group.addEventListener('keydown', (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            const buttons = [...group.querySelectorAll('[role="radio"]')];
            const at = buttons.indexOf(document.activeElement);
            if (at < 0) return;
            e.preventDefault();
            const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
            const next = buttons[(at + step + buttons.length) % buttons.length];
            next.focus();
            selectIn(group, next);
            onPick(next);
        });
    }

    function setupCalendars(config) {
        const names = config.eventCreation?.calendars || [];
        const fallback = config.events?.defaultCreateCalendar;
        calendar = names.includes(fallback) ? fallback : names[0] || null;
        if (names.length < 2) return; // one calendar: nothing to choose
        const group = document.getElementById('calendar-choices');
        group.innerHTML = names.map(name =>
            `<button type="button" class="ev-seg" role="radio" aria-checked="${name === calendar}" data-calendar="${escapeHtml(name)}">${escapeHtml(name)}</button>`
        ).join('');
        document.getElementById('calendar-field').hidden = false;
        wireRadioGroup(group, b => { calendar = b.dataset.calendar; });
    }

    function setupChoices() {
        wireRadioGroup(document.querySelector('[aria-labelledby="places-label"]'), (b) => {
            limited = b.dataset.places === 'limit';
            document.getElementById('limit-row').hidden = !limited;
            if (limited) limitInput.focus();
        });
        wireRadioGroup(document.querySelector('[aria-labelledby="approval-label"]'), (b) => {
            approval = b.dataset.approval === 'true';
        });
        document.querySelectorAll('.ev-step').forEach(b => b.addEventListener('click', () => {
            const value = Math.min(500, Math.max(1, (parseInt(limitInput.value, 10) || 0) + Number(b.dataset.step)));
            limitInput.value = String(value);
        }));
    }

    // ---------- Times ----------

    function pad(n) { return String(n).padStart(2, '0'); }

    function localDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

    // A new start moves an untouched end to two hours later, like a calendar app.
    function onStartChange() {
        if (!endTouched && /^\d{2}:\d{2}$/.test(startInput.value)) {
            const [h, m] = startInput.value.split(':').map(Number);
            endInput.value = `${pad((h + 2) % 24)}:${pad(m)}`;
        }
        updateNextDayHint();
    }

    function updateNextDayHint() {
        const both = startInput.value && endInput.value;
        document.getElementById('next-day-hint').hidden = !(both && endInput.value <= startInput.value);
    }

    // ---------- Errors ----------

    function clearErrors() {
        document.querySelectorAll('[data-error-for]').forEach(el => { el.hidden = true; el.textContent = ''; });
        showFormError('');
    }

    function showFieldError(field, message) {
        const el = document.querySelector(`[data-error-for="${field}"]`);
        if (!el) return showFormError(message);
        el.textContent = message;
        el.hidden = false;
        const input = el.closest('.field')?.querySelector('input, textarea, button');
        if (input) input.focus();
    }

    function showFormError(message) {
        const el = document.getElementById('form-error');
        el.textContent = message;
        el.hidden = !message;
    }

    // ---------- Submit ----------

    function payload() {
        return {
            title: document.getElementById('ev-title').value,
            calendar,
            date: dateInput.value,
            start: startInput.value,
            end: endInput.value,
            location: document.getElementById('ev-location').value,
            description: document.getElementById('ev-description').value,
            links: linkEditor.value(),
            limit: limited ? limitInput.value : null,
            approval,
            hostName: document.getElementById('ev-host').value,
            hostJoins: document.getElementById('ev-host-joins').checked,
            hostEmail: document.getElementById('ev-email').value
        };
    }

    // The checks a person can fix before a round trip; the server repeats every one.
    function checkLocally(body) {
        if (!body.title.trim()) return ['title', 'Give it a title.'];
        if (!body.date || !body.start) return ['start', 'Pick a day and a start time.'];
        if (!body.end) return ['end', 'Pick an end time.'];
        if (!body.hostName.trim()) return ['hostName', 'Type your name, so people know who hosts.'];
        const badLink = linkEditor.invalid();
        if (badLink) return ['links', 'That is not a web address. It starts with https://', badLink];
        return null;
    }

    async function submit(e) {
        e.preventDefault();
        clearErrors();
        const body = payload();
        const problem = checkLocally(body);
        if (problem) {
            showFieldError(problem[0], problem[1]);
            if (problem[2]) problem[2].focus();
            return;
        }

        const text = submitBtn.querySelector('.text');
        submitBtn.disabled = true;
        text.textContent = 'Making…';
        try {
            const res = await fetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) {
                if (result.field) showFieldError(result.field, result.message);
                else showFormError(result.message || 'That did not go through. Try again.');
                return;
            }
            write(NAME_KEY, body.hostName.trim());
            const startIso = result.date;
            rememberHosted({ title: body.title.trim(), date: startIso, hostPath: result.hostPath });
            showDone(body, result, startIso);
        } catch (error) {
            showFormError('No connection. Check your network and try again.');
        } finally {
            submitBtn.disabled = false;
            text.textContent = 'Make event';
        }
    }

    function showDone(body, result, startIso) {
        const hostUrl = `${location.origin}${result.hostPath}`;
        form.hidden = true;
        document.getElementById('hosted-list').hidden = true;
        document.getElementById('done-title').textContent = `${body.title.trim()} is on the calendar`;
        document.getElementById('done-when').textContent = whenText(startIso);
        document.getElementById('done-hostlink').textContent = hostUrl;
        document.getElementById('done-hostlink-note').textContent = body.approval
            ? 'Accept or decline requests to join here. Anyone with the link can, so keep it to yourself.'
            : 'See who is coming here. Anyone with the link can manage the event, so keep it to yourself.';
        document.getElementById('done-open-host').href = result.hostPath;
        document.getElementById('done-home').href = `/#event-${encodeURIComponent(result.id)}`;
        const emailed = document.getElementById('done-emailed');
        emailed.hidden = !body.hostEmail.trim();
        emailed.textContent = result.emailed
            ? `We emailed it to ${body.hostEmail.trim()}.`
            : 'We could not email it. Copy it now; this device also keeps it under "You host".';
        const google = document.getElementById('done-google');
        google.hidden = !result.googleLink;
        if (result.googleLink) google.href = result.googleLink;
        const done = document.getElementById('done');
        done.hidden = false;
        done.focus();
        window.scrollTo({ top: 0 });
    }

    function copyHostLink() {
        const button = document.getElementById('copy-hostlink');
        const url = document.getElementById('done-hostlink').textContent;
        const finish = (label) => {
            button.textContent = label;
            setTimeout(() => { button.textContent = 'Copy'; }, 2000);
        };
        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => finish('Copied'), () => finish('Select and copy it'));
        } else {
            finish('Select and copy it');
        }
    }

    function makeAnother() {
        form.reset();
        linkEditor.set([]);
        endTouched = false;
        document.getElementById('done').hidden = true;
        form.hidden = false;
        document.getElementById('ev-host').value = read(NAME_KEY) || '';
        renderHosted();
        document.getElementById('ev-title').focus();
    }

    async function init() {
        dateInput.min = localDate(new Date());
        document.getElementById('ev-host').value = read(NAME_KEY) || '';
        renderHosted();
        setupChoices();
        startInput.addEventListener('change', onStartChange);
        endInput.addEventListener('input', () => { endTouched = true; updateNextDayHint(); });
        form.addEventListener('submit', submit);
        document.getElementById('copy-hostlink').addEventListener('click', copyHostLink);
        document.getElementById('make-another').addEventListener('click', makeAnother);

        try {
            const config = await (await fetch('/api/config')).json();
            if (!config.eventCreation?.enabled || !config.eventCreation.calendars?.length) {
                form.hidden = true;
                document.getElementById('not-set-up').hidden = false;
                return;
            }
            setupCalendars(config);
        } catch (error) {
            showFormError('Could not reach Lilai. Check your network and reload.');
        }
    }

    init();
})();
