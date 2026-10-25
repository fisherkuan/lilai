// Make an event: Home's slide-in sheet (index.html #event-sheet). Opens from any
// [data-make-event] button and from /#new (or /#new=<calendar>, which the calendar page uses).
// The form is js/event-form.js; the links this device holds are js/device-links.js.
(() => {
    'use strict';

    const NAME_KEY = 'lilai.attendeeName';
    const EMAIL_KEY = 'lilai.hostEmail';
    const sheet = document.getElementById('event-sheet');
    const form = document.getElementById('event-sheet-form');
    const made = document.getElementById('event-made');
    const signin = document.getElementById('event-signin');
    const submitBtn = document.getElementById('event-submit');
    const fields = EventForm.create(document.getElementById('event-form-fields'), { mode: 'create' });
    let config = null;
    let returnFocus = null;
    let wanted = null; // the calendar asked for, kept through a sign-in
    // What was typed, kept while Change takes the host to /me and back to /#new. In
    // localStorage, because a sign-in link with another email often opens in a new tab; it
    // lasts as long as that link (30 minutes).
    const DRAFT_KEY = 'lilai.eventDraft';
    const DRAFT_MS = 30 * 60 * 1000;

    function remembered(key) {
        try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // "Sat 3 Oct, 19:30" in the device's own zone, like Home.
    function whenText(iso) {
        const d = new Date(iso);
        return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    async function loadConfig() {
        if (config) return config;
        config = await (await fetch('/api/config')).json();
        return config;
    }

    // The calendars the signed-in email may write to (/api/me): open ones, and restricted ones
    // whose list holds it.
    function writableCalendars(me) {
        const allowed = new Set(me.writableCalendars || []);
        return ((config && config.eventCreation && config.eventCreation.calendars) || [])
            .filter(c => allowed.has(c.name));
    }

    function showFormError(message) {
        const el = document.getElementById('event-form-error');
        el.textContent = message || '';
        el.hidden = !message;
    }

    // The signed-in email and its name, else null. The session cookie is HttpOnly.
    async function whoAmI() {
        const res = await fetch('/api/me', { cache: 'no-store' });
        if (res.status === 401) return null;
        if (!res.ok) throw new Error('me');
        return res.json();
    }

    // An event is tied to the signed-in email, so the sheet asks for a sign-in first: an
    // emailed code, typed here (js/signin-code.js). A code sent in the last 30 minutes goes
    // straight to its field, even after iOS reloaded the app.
    function showSignIn() {
        AccountLink.remember('');
        form.hidden = true;
        made.hidden = true;
        signin.hidden = false;
        const waiting = SignInCode.pending();
        if (waiting) return showCodeField(waiting);
        document.getElementById('event-signin-fields').hidden = false;
        document.getElementById('event-signin-code').hidden = true;
        document.querySelector('#event-signin-send .text').textContent = 'Email me a code';
        const input = document.getElementById('event-signin-email');
        if (!input.value) input.value = remembered(EMAIL_KEY);
        setTimeout(() => input.focus(), 60);
    }

    function showCodeField(email) {
        document.getElementById('event-signin-email').value = email;
        document.getElementById('event-signin-fields').hidden = true;
        document.getElementById('event-signin-sent').textContent = `Type the code sent to ${email}. It works for 30 minutes. The link in the same email works too.`;
        const input = document.getElementById('event-code');
        input.value = '';
        document.getElementById('event-code-error').hidden = true;
        document.getElementById('event-signin-code').hidden = false;
        document.querySelector('#event-signin-send .text').textContent = 'Sign in';
        setTimeout(() => input.focus(), 60);
    }

    async function signInWithCode() {
        const input = document.getElementById('event-code');
        const error = document.getElementById('event-code-error');
        const button = document.getElementById('event-signin-send');
        error.hidden = true;
        if (!SignInCode.isCode(input.value)) {
            error.textContent = 'Type the six digits from the email.';
            error.hidden = false;
            return;
        }
        if (button.disabled) return;
        button.disabled = true;
        try {
            const { ok, result } = await SignInCode.redeem(document.getElementById('event-signin-email').value.trim(), input.value);
            if (!ok) {
                error.textContent = result.message || 'That did not go through. Try again.';
                error.hidden = false;
                return;
            }
            const back = returnFocus;
            await open(wanted);
            returnFocus = back;
        } catch (_) {
            error.textContent = 'No connection. Check your network and try again.';
            error.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    async function sendSignIn(e) {
        e.preventDefault();
        if (!document.getElementById('event-signin-code').hidden) return signInWithCode();
        const input = document.getElementById('event-signin-email');
        const error = document.getElementById('event-signin-error');
        const button = document.getElementById('event-signin-send');
        const email = input.value.trim();
        error.hidden = true;
        if (!email) {
            error.textContent = 'Type your email.';
            error.hidden = false;
            return;
        }
        button.disabled = true;
        try {
            const res = await fetch('/api/me/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, next: wanted ? `/#new=${encodeURIComponent(wanted)}` : '/#new' })
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) {
                error.textContent = result.message || 'That did not go through. Try again.';
                error.hidden = false;
                return;
            }
            SignInCode.remember(email, 'new');
            showCodeField(email);
        } catch (_) {
            error.textContent = 'No connection. Check your network and try again.';
            error.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    async function open(preferredCalendar) {
        returnFocus = document.activeElement;
        wanted = preferredCalendar || null;
        sheet.classList.remove('hidden');
        if (!made.hidden) {
            // The last one is made; start a fresh form.
            made.hidden = true;
            fields.reset();
        }
        signin.hidden = true;
        form.hidden = false;
        fields.setMinDate();
        try {
            const me = await whoAmI();
            if (!me) return showSignIn();
            AccountLink.remember(me.email);
            fields.setHostEmail(me.email);
            if (!document.getElementById('event-form-fields').dataset.named) {
                fields.setHostName(remembered(NAME_KEY) || me.name);
                document.getElementById('event-form-fields').dataset.named = '1';
            }
            await loadConfig();
            const draft = takeDraft();
            fields.setCalendars(writableCalendars(me).map(c => ({ ...c, shape: shapeFor(c.name) })), (draft && draft.calendar) || preferredCalendar || config.events?.defaultCreateCalendar);
            if (draft) {
                fields.set(draft);
                if (draft.hostName) fields.setHostName(draft.hostName);
            }
        } catch (_) {
            showFormError('Could not reach Lilai. Check your network and try again.');
        }
        setTimeout(() => fields.focus(), 60);
    }

    function takeDraft() {
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            localStorage.removeItem(DRAFT_KEY);
            const draft = raw ? JSON.parse(raw) : null;
            return draft && Date.now() - draft.at < DRAFT_MS ? draft : null;
        } catch (_) { return null; }
    }

    // Change (the email) leaves for /me; keep the form so Back finds it as it was.
    document.getElementById('event-form-fields').addEventListener('click', (e) => {
        if (!e.target.closest('[data-change-email]')) return;
        try {
            const { hostEmail, ...draft } = fields.value();
            localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, at: Date.now() }));
        } catch (_) { /* private mode: the form starts empty */ }
    });

    function close() {
        sheet.classList.add('hidden');
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        returnFocus = null;
    }

    async function submit(e) {
        e.preventDefault();
        showFormError('');
        if (!fields.check()) return;
        const body = fields.value();
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
            if (res.status === 401) return showSignIn();
            if (!res.ok || !result.success) {
                if (!(result.field && fields.showError(result.field, result.message))) {
                    showFormError(result.message || 'That did not go through. Try again.');
                }
                return;
            }
            try {
                if (body.hostName.trim()) localStorage.setItem(NAME_KEY, body.hostName.trim());
            } catch (_) { /* private mode */ }
            DeviceLinks.rememberHosted({ hostPath: result.hostPath, eventId: result.id, calendar: body.calendar, title: body.title.trim(), date: result.date, count: result.count });
            renderHosted();
            showMade(body, result);
        } catch (_) {
            showFormError('No connection. Check your network and try again.');
        } finally {
            submitBtn.disabled = false;
            text.textContent = 'Make event';
        }
    }

    function showMade(body, result) {
        const url = `${location.origin}${result.hostPath}`;
        form.hidden = true;
        document.getElementById('event-made-title').textContent = `${body.title.trim()} is on the calendar`;
        document.getElementById('event-made-when').textContent = result.count > 1
            ? `${result.count} dates, from ${whenText(result.date)}`
            : whenText(result.date);
        document.getElementById('event-made-url').textContent = url;
        document.getElementById('event-made-open').href = result.hostPath;
        document.getElementById('event-made-share').hidden = !navigator.share;
        // Only the caveat: a working publish needs no line.
        const publish = document.getElementById('event-made-publish');
        publish.hidden = result.publishing;
        publish.textContent = 'Not in Google Calendar yet: publishing is not set up.';
        made.hidden = false;
        made.focus();
    }

    async function shareMade(button, how) {
        const url = document.getElementById('event-made-url').textContent;
        const title = document.getElementById('event-made-title').textContent;
        let outcome;
        if (how === 'copy') {
            try {
                await navigator.clipboard.writeText(url);
                outcome = 'copied';
            } catch (_) {
                outcome = 'failed';
            }
        } else {
            outcome = await DeviceLinks.share({ title, text: 'Manage this Lilai event with me:', url });
        }
        const label = button.textContent;
        button.textContent = { copied: 'Copied', shared: 'Shared', failed: 'Select and copy it' }[outcome] || label;
        setTimeout(() => { button.textContent = label; }, 2000);
    }

    function clock(iso) {
        return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    // The calendar's shape, in config order like Home (circle, square, triangle, then diamond).
    function shapeFor(calendarName) {
        const names = ((config || (typeof appConfig !== 'undefined' ? appConfig : {})).calendars || []).filter(c => c.enabled).map(c => c.name);
        const i = names.indexOf(calendarName);
        return ['circle', 'square', 'triangle'][i] || 'diamond';
    }

    function shapeMark(shape) {
        return `<svg class="shape s-${shape}" aria-hidden="true" focusable="false"><use href="#shape-${shape}"/></svg>`;
    }

    // Whether a held event is cancelled. Home's lists leave cancelled events out, so a row with
    // no loaded event asks its management link once per page load.
    const cancelledState = new Map();
    function checkCancelled(e) {
        if (cancelledState.has(e.hostPath)) return;
        cancelledState.set(e.hostPath, null);
        const query = e.count > 1 || !e.eventId ? '' : `?event=${encodeURIComponent(e.eventId)}`;
        fetch(`/api${e.hostPath}${query}`)
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (!data || !data.event) return;
                cancelledState.set(e.hostPath, Boolean(data.event.cancelled));
                if (data.event.cancelled) renderHosted();
            })
            .catch(() => {});
    }

    // "You manage" in the sidebar: events whose management link this device holds, soonest
    // first, each as a day block like Home's cards. Home's loaded events add the clock range and
    // who is coming; app.js calls this again once they are in.
    function renderHosted() {
        const box = document.getElementById('hosted-list');
        if (!box) return;
        const now = Date.now();
        const loaded = typeof currentEvents !== 'undefined' ? currentEvents : [];
        const list = DeviceLinks.hosted()
            .filter(e => e.count > 1 || new Date(e.date).getTime() > now - 86400000)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        box.hidden = list.length === 0;
        document.getElementById('hosted-items').innerHTML = list.map(e => {
            const live = loaded.find(ev => ev.id === e.eventId);
            const d = new Date(e.date);
            const time = live && live.enddate ? `${clock(live.date)}–${clock(live.enddate)}` : clock(e.date);
            const meta = [e.count > 1 ? `${e.count} dates · next ${clock(e.date)}` : time];
            if (!live) checkCancelled(e);
            const cancelled = !live && cancelledState.get(e.hostPath) === true;
            if (live) {
                meta.push(`${live.attendingCount || 0} coming`);
                if (live.pendingCount) meta.push(`${live.pendingCount} asking`);
            }
            return `<li><a class="hosted-row${cancelled ? ' is-cancelled' : ''}" href="${escapeHtml(e.hostPath)}">`
                + `<span class="hosted-day"><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</span></span>`
                + `<span class="hosted-main"><span class="hosted-title">${shapeMark(shapeFor(e.calendar))}<span>${escapeHtml(live ? live.title : e.title)}</span></span>`
                + `<span class="hosted-meta">${cancelled ? '<b>Cancelled</b> · ' : ''}${escapeHtml(meta.join(' · '))}</span></span>`
                + '<svg class="hosted-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></a></li>';
        }).join('');
    }
    window.renderHosted = renderHosted;

    // /#new or /#new=<calendar>: open the sheet, then drop the hash so a reload does not reopen it.
    // /#new, or a code asked for here in the last 30 minutes (iOS reloaded the app meanwhile).
    function openFromHash() {
        const match = /^#new(?:=(.+))?$/.exec(location.hash);
        if (!match) {
            if (!location.hash && SignInCode.pendingWhere() === 'new') open();
            return;
        }
        history.replaceState(null, '', location.pathname + location.search);
        open(match[1] ? decodeURIComponent(match[1]) : null);
    }

    document.querySelectorAll('[data-make-event]').forEach(b => b.addEventListener('click', () => open()));
    sheet.addEventListener('click', (e) => {
        if (e.target === sheet || e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !sheet.classList.contains('hidden')) close();
    });
    form.addEventListener('submit', submit);
    signin.addEventListener('submit', sendSignIn);
    document.getElementById('event-code').addEventListener('input', (e) => {
        if (SignInCode.isCode(e.target.value)) signInWithCode();
    });
    document.getElementById('event-signin-other').addEventListener('click', () => {
        SignInCode.clear();
        showSignIn();
    });
    document.getElementById('event-made-copy').addEventListener('click', (e) => shareMade(e.currentTarget, 'copy'));
    document.getElementById('event-made-share').addEventListener('click', (e) => shareMade(e.currentTarget, 'share'));
    window.addEventListener('hashchange', openFromHash);
    renderHosted();
    openFromHash();
})();
