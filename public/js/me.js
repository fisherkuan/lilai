// Sign in and profile (/me, the header's Sign in or Profile): type an email, open the emailed link (/me/signin/<token>), and this
// device lists the events that address hosts. Manage mints a fresh management link and keeps
// it under "You manage" (js/device-links.js). Sign out ends this device's session; Delete my
// email takes the address off every event and signs out every device.
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const parts = location.pathname.split('/').filter(Boolean);
    const signinToken = parts[1] === 'signin' ? decodeURIComponent(parts[2] || '') : '';
    // A link asked for from an event's chat goes back to that thread once signed in.
    const nextRaw = new URLSearchParams(location.search).get('next') || '';
    const next = /^\/(?![\/\\])/.test(nextRaw) ? nextRaw : '';
    const backText = next.startsWith('/#chat-') ? 'Back to the chat'
        : next.startsWith('/#new') ? 'Back to your event' : '';
    let email = '';
    // The keys Home's RSVP sheet and Make an event fill in from (app.js, js/make-event.js).
    const NAME_KEY = 'lilai.attendeeName';
    const EMAIL_KEY = 'lilai.hostEmail';

    function stored(key) {
        try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
    }

    function store(key, value) {
        try {
            if (value) localStorage.setItem(key, value);
            else localStorage.removeItem(key);
        } catch (_) { /* private mode */ }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function whenText(iso) {
        const d = new Date(iso);
        return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    function seats(e) {
        const asking = e.pendingCount ? ` · ${e.pendingCount} asking` : '';
        return e.attendance_limit !== null ? `${e.attendingCount} of ${e.attendance_limit}${asking}` : `${e.attendingCount} coming${asking}`;
    }

    function showState(message, isError = false) {
        $('me-state').textContent = message;
        $('me-state').classList.toggle('is-error', isError);
        $('me-state').hidden = !message;
    }

    function showOnly(id) {
        for (const section of ['me-ask', 'me-redeem', 'me-name-step', 'me-list']) $(section).hidden = section !== id;
        showState('');
    }

    function showError(id, message) {
        $(id).textContent = message || '';
        $(id).hidden = !message;
    }

    async function api(url, options = {}) {
        const res = await fetch(url, {
            cache: 'no-store',
            ...options,
            headers: options.body ? { 'Content-Type': 'application/json' } : undefined
        });
        const result = await res.json().catch(() => ({}));
        return { status: res.status, ok: res.ok && result.success !== false, result };
    }

    // ---------- Not signed in ----------

    function showAsk() {
        AccountLink.remember('');
        document.title = 'Sign in — Lilai';
        showOnly('me-ask');
        $('me-form').hidden = false;
        $('me-sent').hidden = true;
        $('me-code-form').hidden = true;
    }

    async function sendLink(e) {
        e.preventDefault();
        showError('me-error', '');
        const typed = $('me-email').value.trim();
        if (!typed) return showError('me-error', 'Type your email.');
        const button = $('me-send');
        const text = button.querySelector('.text');
        button.disabled = true;
        text.textContent = 'Sending…';
        try {
            const { ok, result } = await api('/api/me/link', { method: 'POST', body: JSON.stringify(next ? { email: typed, next } : { email: typed }) });
            if (!ok) return showError('me-error', result.message || 'That did not go through. Try again.');
            $('me-form').hidden = true;
            $('me-sent-text').textContent = `A link and a code are on their way to ${typed}. Open the link, or type the code here. Both work for 30 minutes.`;
            $('me-code').value = '';
            showError('me-code-error', '');
            $('me-code-form').hidden = false;
            $('me-sent').hidden = false;
            $('me-code').focus();
        } catch (_) {
            showError('me-error', 'No connection. Check your network and try again.');
        } finally {
            button.disabled = false;
            text.textContent = 'Email me a link';
        }
    }

    // ---------- The emailed link ----------

    // Straight away, on load. The link works any number of times for its 30 minutes, so a mail
    // scanner that opened it first has not used it up.
    function redeemFailed(message, retry) {
        showOnly('me-redeem');
        showError('me-redeem-error', message);
        $('me-redeem-btn').textContent = retry ? 'Try again' : 'Email me a new link';
        $('me-redeem-btn').dataset.retry = retry ? '1' : '';
        $('me-redeem-btn').disabled = false;
    }

    async function redeem() {
        showState('Signing you in…');
        try {
            const { ok, result } = await api('/api/me/session', { method: 'POST', body: JSON.stringify({ token: signinToken }) });
            if (!ok) return redeemFailed(result.message || 'That did not go through.', false);
            await signedIn(result);
        } catch (_) {
            redeemFailed('No connection. Check your network.', true);
        }
    }

    // The emailed code, for a device the link does not open on (an iPhone home-screen app:
    // Mail opens links in Safari, which keeps its own cookies). Six digits sign in by themselves.
    async function redeemCode(e) {
        if (e) e.preventDefault();
        showError('me-code-error', '');
        const code = $('me-code').value.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) return showError('me-code-error', 'Type the six digits from the email.');
        const button = $('me-code-btn');
        const text = button.querySelector('.text');
        if (button.disabled) return;
        button.disabled = true;
        text.textContent = 'Signing in…';
        try {
            const { ok, result } = await api('/api/me/session', { method: 'POST', body: JSON.stringify({ email: $('me-email').value.trim(), code }) });
            if (!ok) return showError('me-code-error', result.message || 'That did not go through. Try again.');
            await signedIn(result);
        } catch (_) {
            showError('me-code-error', 'No connection. Check your network and try again.');
        } finally {
            button.disabled = false;
            text.textContent = 'Sign in';
        }
    }

    async function signedIn(result) {
        // The header's "Profile" link, even when this goes straight back to a chat.
        AccountLink.remember(result.email);
        // The email's one name is asked here, once, not in each chat.
        if (!result.name) {
            showOnly('me-name-step');
            $('me-first-name').value = stored(NAME_KEY);
            $('me-first-name').focus();
            return;
        }
        await goOn();
    }

    // After sign-in: back to the chat the link came from, else this device's events.
    async function goOn() {
        if (next) {
            location.replace(next);
            return;
        }
        history.replaceState(null, '', '/me');
        await load();
    }

    async function saveFirstName(e) {
        e.preventDefault();
        showError('me-first-name-error', '');
        const typed = $('me-first-name').value.trim();
        if (!typed) return showError('me-first-name-error', 'Type your name, or skip for now.');
        const button = $('me-first-name-save');
        button.disabled = true;
        try {
            const { ok, result } = await api('/api/me/name', { method: 'PUT', body: JSON.stringify({ name: typed }) });
            if (!ok) throw new Error(result.message || 'That did not go through. Try again.');
            store(NAME_KEY, result.name);
            await goOn();
        } catch (error) {
            showError('me-first-name-error', error.message === 'Failed to fetch' ? 'No connection. Check your network and try again.' : error.message);
            button.disabled = false;
        }
    }

    // ---------- Signed in ----------

    // The calendar's shape, in config order like Home (circle, square, triangle, then diamond).
    let shapeBySource = {};
    async function loadShapes() {
        try {
            const config = await (await fetch('/api/config')).json();
            const names = ['circle', 'square', 'triangle'];
            let i = 0;
            for (const cal of config.calendars || []) {
                if (!cal.enabled) continue;
                let id = null;
                try { id = new URL(cal.url).searchParams.get('src'); } catch (_) { /* no id */ }
                if (id) shapeBySource[id] = names[i] || 'diamond';
                i += 1;
            }
        } catch (_) {
            shapeBySource = {};
        }
    }

    // One event as a day block, like "You manage" on Home: the whole row opens it. Hosted rows
    // open the management page, joined ones the event on Home.
    function row(e, { manage = true, note = '' } = {}) {
        const d = new Date(e.date);
        const shape = shapeBySource[e.source] || 'diamond';
        const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        const meta = [time, seats(e)];
        if (e.count > 1) meta.push(`${e.count} dates`);
        const inner = `<span class="hosted-day"><b>${d.getDate()}</b><span>${escapeHtml(d.toLocaleDateString('en-GB', { weekday: 'short' }))}</span></span>`
            + `<span class="hosted-main"><span class="hosted-title"><svg class="shape s-${shape}" aria-hidden="true" focusable="false"><use href="#shape-${shape}"/></svg><span>${escapeHtml(e.title)}</span></span>`
            + `<span class="hosted-meta">${e.cancelled ? '<b>Cancelled</b> · ' : ''}${escapeHtml(meta.join(' · '))}${escapeHtml(note)}</span></span>`
            + '<svg class="hosted-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
        const cls = `hosted-row${e.cancelled ? ' is-cancelled' : ''}`;
        const month = d.toLocaleDateString('en-GB', { month: 'long' });
        return manage
            ? `<li><button type="button" class="${cls}" data-manage="${escapeHtml(e.id)}" data-title="${escapeHtml(e.title)}" aria-label="${escapeHtml(`Manage ${e.title}, ${d.getDate()} ${month}`)}">${inner}</button></li>`
            : `<li><a class="${cls}" href="/#event-${encodeURIComponent(e.id)}" aria-label="${escapeHtml(`Open ${e.title}, ${d.getDate()} ${month}`)}">${inner}</a></li>`;
    }

    // The header: an initial in an ink disc, the name, the email.
    function renderIdentity(name) {
        const shown = (name || '').trim();
        $('me-avatar').textContent = (shown || email || '?').charAt(0).toUpperCase();
        $('me-id-name').textContent = shown || 'No name yet';
        $('me-id-name').classList.toggle('is-empty', !shown);
    }

    function render(data) {
        email = data.email;
        AccountLink.remember(email);
        $('me-who').textContent = email;
        document.title = 'Profile — Lilai';
        renderIdentity(data.name);
        $('me-name').value = data.name || '';
        savedName = data.name || '';
        chatMessages = data.chatMessages || 0;
        nameHint();
        // This device fills in what it does not know yet; what it was told stays.
        if (!stored(NAME_KEY) && data.name) store(NAME_KEY, data.name);
        if (!stored(EMAIL_KEY)) store(EMAIL_KEY, email);
        $('me-upcoming-count').textContent = data.upcoming.length ? String(data.upcoming.length) : '';
        $('me-upcoming').innerHTML = data.upcoming.length
            ? data.upcoming.map(e => row(e)).join('')
            : '<li class="me-empty">No events made with this email yet.</li>';
        $('me-joined-block').hidden = !data.joined.length;
        $('me-joined').innerHTML = data.joined
            .map(e => row(e, { manage: false, note: e.attendance === 'pending' ? ' · you asked to join' : e.attendance === 'waiting' ? ' · on the waiting list' : '' })).join('');
        $('me-past-block').hidden = !data.past.length;
        $('me-past').innerHTML = data.past.map(e => row(e)).join('');
        $('me-delete-confirm').hidden = true;
        showOnly('me-list');
    }

    async function load() {
        try {
            const [{ status, ok, result }] = await Promise.all([api('/api/me'), loadShapes()]);
            if (status === 401) return showAsk();
            if (!ok) return showState(result.message || 'Could not load your events. Reload to try again.', true);
            render(result);
        } catch (_) {
            showState('Could not reach Lilai. Check your network and reload.', true);
        }
    }

    // This device's link for the event when it has one, else a fresh one; then the page.
    async function manage(button) {
        const id = button.dataset.manage;
        const known = DeviceLinks.hosted().find(h => h.eventId === id);
        if (known) {
            location.href = known.hostPath;
            return;
        }
        button.disabled = true;
        showError('me-list-error', '');
        try {
            const { status, ok, result } = await api(`/api/me/events/${encodeURIComponent(id)}/manage`, { method: 'POST' });
            if (status === 401) return showAsk();
            if (!ok) throw new Error(result.message || 'That did not go through. Try again.');
            const name = button.dataset.title;
            DeviceLinks.rememberHosted({ hostPath: result.hostPath, eventId: id, title: name, date: new Date().toISOString() });
            location.href = result.hostPath;
        } catch (error) {
            showError('me-list-error', error.message);
            button.disabled = false;
        }
    }

    async function saveName(e) {
        e.preventDefault();
        const button = $('me-name-save');
        button.disabled = true;
        try {
            const { status, ok, result } = await api('/api/me/name', { method: 'PUT', body: JSON.stringify({ name: $('me-name').value }) });
            if (status === 401) return showAsk();
            if (!ok) throw new Error(result.message || 'That did not go through. Try again.');
            $('me-name').value = result.name;
            savedName = result.name;
            renderIdentity(result.name);
            store(NAME_KEY, result.name);
            // Came from a chat or Make an event to set the name: back to it.
            if (backText && result.name) {
                location.replace(next);
                return;
            }
            $('me-name-hint').textContent = 'Saved.';
            setTimeout(nameHint, 2000);
        } catch (error) {
            showError('me-list-error', error.message);
        } finally {
            button.disabled = false;
        }
    }

    async function signOut() {
        await api('/api/me/session', { method: 'DELETE' }).catch(() => {});
        showAsk();
    }

    function askDelete() {
        $('me-delete-text').textContent = `This takes ${email} off every event you made and signs out every device. `
            + 'Your events, your name and who is coming stay. Keep your management links: without the email, they are the only way in.';
        $('me-delete-confirm').hidden = false;
        $('me-delete-confirm').focus();
    }

    async function deleteEmail() {
        const button = $('me-delete-yes');
        button.disabled = true;
        try {
            const { ok, result } = await api('/api/me', { method: 'DELETE' });
            if (!ok) throw new Error(result.message || 'That did not go through. Try again.');
            if (stored(EMAIL_KEY).toLowerCase() === email) store(EMAIL_KEY, '');
            showAsk();
            $('me-form').hidden = true;
            $('me-sent-text').textContent = `Deleted. Lilai no longer has ${email}.`;
            $('me-code-form').hidden = true;
            $('me-sent').hidden = false;
        } catch (error) {
            showError('me-list-error', error.message);
        } finally {
            button.disabled = false;
        }
    }

    // The name field says what a change does: a caveat, so it earns a line.
    let savedName = '';
    let chatMessages = 0;
    function nameHint() {
        const typed = $('me-name').value.trim();
        const renames = chatMessages > 0 && savedName && typed && typed.toLowerCase() !== savedName.toLowerCase();
        $('me-name-hint').textContent = renames
            ? `Your chat messages change to ${typed} too, marked "was ${savedName}" for a week.`
            : chatMessages > 0 ? 'Shown on your chat messages, and filled in when you join or make an event.'
                : 'Filled in when you join or make an event, and shown when you post in a chat.';
    }
    $('me-name').addEventListener('input', nameHint);
    $('me-first-name-form').addEventListener('submit', saveFirstName);
    $('me-first-name-skip').addEventListener('click', goOn);
    // Back where /me was opened from: the chat, or Make an event (its Change link).
    document.querySelectorAll('[data-me-back]').forEach((a) => {
        if (!backText) return;
        a.href = next;
        a.textContent = backText;
        a.hidden = false;
    });

    // Display: the footer's choices as iOS switches, on this device only. Dark picks Dark or
    // Light (the default); Header icons is the sprites (off: short words). Each follows the
    // footer through the page events js/theme.js and js/sprites.js send.
    function setSwitch(button, on) {
        button.setAttribute('aria-checked', String(on));
    }
    if (window.LilaiTheme && $('me-dark')) {
        const showTheme = choice => setSwitch($('me-dark'), choice === 'dark');
        $('me-dark').addEventListener('click', () => {
            window.LilaiTheme.set($('me-dark').getAttribute('aria-checked') === 'true' ? 'light' : 'dark');
        });
        document.addEventListener('lilai:theme', e => showTheme(e.detail));
        showTheme(window.LilaiTheme.get());
    }
    if (window.Sprites && $('me-icons')) {
        const showIcons = mode => setSwitch($('me-icons'), mode === 'icons');
        $('me-icons').addEventListener('click', () => {
            window.Sprites.setMode($('me-icons').getAttribute('aria-checked') === 'true' ? 'text' : 'icons');
        });
        document.addEventListener('lilai:header', e => showIcons(e.detail));
        showIcons(window.Sprites.mode());
    }

    $('me-form').addEventListener('submit', sendLink);
    $('me-code-form').addEventListener('submit', redeemCode);
    $('me-code').addEventListener('input', () => {
        if (/^\d{6}$/.test($('me-code').value.trim())) redeemCode();
    });
    $('me-name-form').addEventListener('submit', saveName);
    $('me-other').addEventListener('click', () => {
        showAsk();
        $('me-email').value = '';
        $('me-email').focus();
    });
    $('me-redeem-btn').addEventListener('click', (e) => {
        if (e.currentTarget.dataset.retry) return redeem();
        history.replaceState(null, '', '/me');
        showAsk();
        $('me-email').focus();
    });
    document.querySelector('#me-list').addEventListener('click', (e) => {
        const button = e.target.closest('[data-manage]');
        if (button) manage(button);
    });
    $('me-signout').addEventListener('click', signOut);
    $('me-delete').addEventListener('click', askDelete);
    $('me-delete-no').addEventListener('click', () => { $('me-delete-confirm').hidden = true; });
    $('me-delete-yes').addEventListener('click', deleteEmail);

    if (signinToken) redeem();
    else load();
})();
