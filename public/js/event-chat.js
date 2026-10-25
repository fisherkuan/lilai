// Chat in an event: the slide-in thread behind each card's chat button (index.html #chat-sheet).
// Anyone reads and likes; posting needs this device signed in with an email (Find my events'
// session), so a name in the thread is backed by an address. The author edits or deletes their
// own messages. Messages arrive live over Home's WebSocket (app.js calls EventChat.onBroadcast).
// Opens from a card's [data-chat] button and from /#chat-<id>, where a chat sign-in link lands.
(function (root) {
    'use strict';

    const LIKER_KEY = 'lilai.likerKey';
    const NAME_KEY = 'lilai.attendeeName';
    const MAX_BODY = 1000;

    // "19:02" today, "Sat 3 Oct, 19:02" before. Pure, for the tests.
    function stampText(iso, now = new Date()) {
        const d = new Date(iso);
        const clock = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        if (d.toDateString() === now.toDateString()) return clock;
        return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock}`;
    }

    // A run of messages from one person within five minutes shows their name once.
    function groupStarts(messages) {
        return messages.map((m, i) => {
            const prev = messages[i - 1];
            if (!prev) return true;
            const sameAuthor = prev.name === m.name && prev.wasName === m.wasName && prev.mine === m.mine && prev.host === m.host;
            return !sameAuthor || new Date(m.at) - new Date(prev.at) > 5 * 60 * 1000;
        });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { stampText, groupStarts };
        return;
    }

    const doc = root.document;
    const $ = (id) => doc.getElementById(id);
    const sheet = $('chat-sheet');
    if (!sheet) return;
    const list = $('chat-list');

    let eventId = null;
    let messages = [];
    let me = null;
    let returnFocus = null;
    let editingId = null;
    let confirmDeleteId = null;
    let confirmTimer = null;
    let loadSeq = 0;
    // Ids already drawn in this thread: a message not among them pops in. Null until the
    // thread's first draw, so opening it does not animate every bubble.
    let shownIds = null;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function stored(key) {
        try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
    }

    // A random key per device: a like belongs to it, so a second tap takes the like back.
    function likerKey() {
        let key = stored(LIKER_KEY);
        if (!/^[A-Za-z0-9-]{16,64}$/.test(key)) {
            key = root.crypto && root.crypto.randomUUID
                ? root.crypto.randomUUID()
                : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
            try { localStorage.setItem(LIKER_KEY, key); } catch (_) { /* likes still work this visit */ }
        }
        return key;
    }

    function showError(id, message) {
        const el = $(id);
        el.textContent = message || '';
        el.hidden = !message;
    }

    async function api(path, options = {}) {
        const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/messages${path}`, {
            cache: 'no-store',
            ...options,
            headers: options.body ? { 'Content-Type': 'application/json' } : undefined
        });
        const result = await res.json().catch(() => ({}));
        return { status: res.status, ok: res.ok && result.success !== false, result };
    }

    // ---------- Drawing ----------

    const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z"/></svg>';

    function messageHtml(m, first) {
        const cls = ['chat-msg'];
        if (m.mine) cls.push('is-mine');
        if (first) cls.push('is-first');
        if (shownIds && !shownIds.has(m.id)) cls.push('is-new');
        const head = first
            ? `<p class="chat-meta"><span class="chat-name">${escapeHtml(m.name)}</span>`
              + `${m.wasName ? `<span class="chat-was">was ${escapeHtml(m.wasName)}</span>` : ''}`
              + `${m.host ? '<span class="chat-host">Host</span>' : ''}</p>`
            : '';
        const editing = m.id === editingId;
        const bubble = editing
            ? `<form class="chat-edit" data-id="${escapeHtml(m.id)}">
                   <textarea class="input chat-input" maxlength="${MAX_BODY}" aria-label="Edit your message" rows="2">${escapeHtml(m.body)}</textarea>
                   <div class="chat-edit-actions">
                       <button type="submit" class="btn btn-solid">Save</button>
                       <button type="button" class="text-btn" data-cancel-edit>Cancel</button>
                   </div>
               </form>`
            : `<div class="chat-bubble">${escapeHtml(m.body)}</div>`;
        const likeLabel = `${m.liked ? 'Unlike' : 'Like'}${m.likes ? `, ${m.likes} ${m.likes === 1 ? 'like' : 'likes'}` : ''}`;
        const own = m.mine && !editing
            ? `<button type="button" class="text-btn chat-tool" data-edit="${escapeHtml(m.id)}">Edit</button>`
              + `<button type="button" class="text-btn chat-tool" data-delete="${escapeHtml(m.id)}">${confirmDeleteId === m.id ? 'Delete it?' : 'Delete'}</button>`
            : '';
        return `<li class="${cls.join(' ')}" data-id="${escapeHtml(m.id)}">${head}${bubble}
            <div class="chat-tools">
                <time class="chat-time" datetime="${escapeHtml(m.at)}">${escapeHtml(stampText(m.at))}${m.editedAt ? ' · edited' : ''}</time>
                <button type="button" class="chat-like" data-like="${escapeHtml(m.id)}" aria-pressed="${m.liked}" aria-label="${escapeHtml(likeLabel)}">${HEART}<span>${m.likes || ''}</span></button>
                ${own}
            </div></li>`;
    }

    function render({ stick = false } = {}) {
        const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        if (!messages.length) {
            list.innerHTML = '<li class="chat-empty">No messages yet. Say hi, or ask who brings the ball.</li>';
        } else {
            const starts = groupStarts(messages);
            list.innerHTML = messages.map((m, i) => messageHtml(m, starts[i])).join('');
        }
        shownIds = new Set(messages.map(m => m.id));
        if (stick || nearBottom) list.scrollTop = list.scrollHeight;
    }

    function renderFoot() {
        const signedIn = Boolean(me);
        $('chat-form').hidden = !signedIn;
        $('chat-signin').hidden = signedIn;
        if (signedIn) {
            const name = me.name || '';
            $('chat-name').value = $('chat-name').value || name || stored(NAME_KEY);
            $('chat-name-field').hidden = Boolean(name);
            $('chat-name-hint').hidden = true;
            $('chat-as').hidden = !name;
            $('chat-as-name').textContent = name;
        }
    }

    // ---------- Loading ----------

    async function load({ stick = false } = {}) {
        const seq = ++loadSeq;
        const { ok, result } = await api(`?liker=${encodeURIComponent(likerKey())}`);
        if (seq !== loadSeq) return;
        if (!ok) {
            list.innerHTML = `<li class="chat-empty">${escapeHtml(result.message || 'Could not load the chat. Try again.')}</li>`;
            $('chat-form').hidden = true;
            $('chat-signin').hidden = true;
            return;
        }
        messages = result.messages || [];
        me = result.me || null;
        render({ stick });
        renderFoot();
        setCount(eventId, messages.length);
    }

    // The card's count, wherever the event is drawn.
    function setCount(id, count) {
        // Home's two lists (app.js) hold separate copies of an event; both keep the count.
        if (typeof currentEvents !== 'undefined' && typeof allCalendarEvents !== 'undefined') {
            [currentEvents, allCalendarEvents].forEach((events) => {
                const ev = events.find(x => x.id === id);
                if (ev) ev.messageCount = count;
            });
        }
        doc.querySelectorAll(`.chat-trigger[data-event-id="${CSS.escape(id)}"]`).forEach((b) => {
            b.querySelector('.chat-count').textContent = count ? String(count) : '';
            b.setAttribute('aria-label', count ? `Chat, ${count} ${count === 1 ? 'message' : 'messages'}` : 'Chat');
        });
    }

    async function eventInfo(id) {
        const known = typeof findEvent === 'function' ? findEvent(id) : null;
        if (known) return known;
        try {
            const res = await fetch(`/api/events/${encodeURIComponent(id)}`);
            return res.ok ? await res.json() : null;
        } catch (_) {
            return null;
        }
    }

    // ---------- Open and close ----------

    async function open(id) {
        if (!sheet.classList.contains('hidden') && eventId === id) return;
        returnFocus = doc.activeElement;
        eventId = id;
        messages = [];
        me = null;
        shownIds = null;
        editingId = null;
        confirmDeleteId = null;
        $('chat-title').textContent = 'Chat';
        $('chat-when').textContent = '';
        list.innerHTML = '<li class="chat-empty">Loading…</li>';
        $('chat-form').hidden = true;
        $('chat-signin').hidden = true;
        $('chat-signin-sent').hidden = true;
        $('chat-signin-fields').hidden = false;
        showError('chat-error', '');
        showError('chat-signin-error', '');
        sheet.classList.remove('hidden');
        const info = await eventInfo(id);
        if (eventId !== id) return;
        if (info) {
            $('chat-title').textContent = info.title;
            $('chat-when').textContent = typeof formatSheetDate === 'function' ? formatSheetDate(info) : '';
        }
        try {
            await load({ stick: true });
        } catch (_) {
            list.innerHTML = '<li class="chat-empty">Could not reach Lilai. Check your network and try again.</li>';
        }
        if (me && me.name) setTimeout(() => $('chat-input').focus(), 60);
    }

    function close() {
        sheet.classList.add('hidden');
        eventId = null;
        loadSeq++;
        if (returnFocus && doc.contains(returnFocus)) returnFocus.focus();
        returnFocus = null;
    }

    // ---------- Posting ----------

    async function send(e) {
        e.preventDefault();
        showError('chat-error', '');
        const input = $('chat-input');
        const body = input.value.trim();
        const name = ($('chat-name').value || '').trim() || (me && me.name) || '';
        if (!name) {
            $('chat-name-field').hidden = false;
            $('chat-as').hidden = true;
            $('chat-name').focus();
            return showError('chat-error', 'Type your name, so people know who wrote.');
        }
        if (!body) return input.focus();
        const button = $('chat-send');
        button.disabled = true;
        try {
            const { status, ok, result } = await api('', { method: 'POST', body: JSON.stringify({ body, name }) });
            if (status === 401) {
                me = null;
                renderFoot();
                return;
            }
            if (!ok) return showError('chat-error', result.message || 'That did not go through. Try again.');
            input.value = '';
            autosize(input);
            const renamed = Boolean(me.name) && me.name !== result.message.name;
            me = { ...me, name: result.message.name };
            $('chat-name').value = '';
            if (!messages.some(m => m.id === result.message.id)) messages.push(result.message);
            render({ stick: true });
            renderFoot();
            // A new name renamed my earlier messages too: draw them as the server has them.
            if (renamed) load({ stick: true }).catch(() => {});
            setCount(eventId, result.count);
            input.focus();
        } catch (_) {
            showError('chat-error', 'No connection. Check your network and try again.');
        } finally {
            button.disabled = false;
        }
    }

    async function askLink(e) {
        e.preventDefault();
        showError('chat-signin-error', '');
        const email = $('chat-email').value.trim();
        if (!email) return showError('chat-signin-error', 'Type your email.');
        const button = $('chat-email-send');
        button.disabled = true;
        try {
            const { ok, result } = await api('/signin', { method: 'POST', body: JSON.stringify({ email }) });
            if (!ok) return showError('chat-signin-error', result.message || 'That did not go through. Try again.');
            $('chat-signin-fields').hidden = true;
            $('chat-signin-sent').textContent = `A link is on its way to ${email}. Open it on this device within 30 minutes; it brings you back here.`;
            $('chat-signin-sent').hidden = false;
        } catch (_) {
            showError('chat-signin-error', 'No connection. Check your network and try again.');
        } finally {
            button.disabled = false;
        }
    }

    // ---------- A message's own buttons ----------

    async function like(id) {
        const m = messages.find(x => x.id === id);
        if (!m) return;
        const on = !m.liked;
        m.liked = on;
        m.likes = Math.max(0, (m.likes || 0) + (on ? 1 : -1));
        render();
        try {
            const { ok, result } = await api(`/${encodeURIComponent(id)}/like`, { method: 'POST', body: JSON.stringify({ liker: likerKey(), like: on }) });
            if (ok) {
                m.likes = result.likes;
                m.liked = result.liked;
            } else {
                m.liked = !on;
                m.likes = Math.max(0, m.likes + (on ? -1 : 1));
                showError('chat-error', result.message || 'That did not go through. Try again.');
            }
        } catch (_) {
            m.liked = !on;
            m.likes = Math.max(0, m.likes + (on ? -1 : 1));
        }
        render();
    }

    async function saveEdit(form) {
        const id = form.dataset.id;
        const body = form.querySelector('textarea').value.trim();
        if (!body) return;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const { ok, result } = await api(`/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ body }) });
            if (!ok) {
                showError('chat-error', result.message || 'That did not go through. Try again.');
                button.disabled = false;
                return;
            }
            const at = messages.findIndex(m => m.id === id);
            if (at >= 0) messages[at] = { ...messages[at], ...result.message };
            editingId = null;
            render();
        } catch (_) {
            showError('chat-error', 'No connection. Check your network and try again.');
            button.disabled = false;
        }
    }

    // Delete asks once on the button itself: a second tap within four seconds deletes.
    async function remove(id) {
        if (confirmDeleteId !== id) {
            confirmDeleteId = id;
            clearTimeout(confirmTimer);
            confirmTimer = setTimeout(() => { confirmDeleteId = null; render(); }, 4000);
            render();
            return;
        }
        confirmDeleteId = null;
        clearTimeout(confirmTimer);
        try {
            const { ok, result } = await api(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!ok) return showError('chat-error', result.message || 'That did not go through. Try again.');
            messages = messages.filter(m => m.id !== id);
            render();
            setCount(eventId, result.count);
        } catch (_) {
            showError('chat-error', 'No connection. Check your network and try again.');
        }
    }

    function autosize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }

    // ---------- Live ----------

    function onBroadcast(payload) {
        if (!payload || !payload.eventId) return;
        if (typeof payload.count === 'number') setCount(payload.eventId, payload.count);
        if (payload.eventId !== eventId || sheet.classList.contains('hidden')) return;
        if (payload.action === 'liked') {
            const m = messages.find(x => x.id === payload.id);
            if (m && m.likes !== payload.likes) {
                m.likes = payload.likes;
                render();
            }
            return;
        }
        // A message I am editing stays as it is until I save; anything else reloads the thread,
        // which also tells this device which messages are its own.
        if (editingId) {
            if (payload.action === 'posted' && payload.message && !messages.some(m => m.id === payload.message.id)) {
                messages.push(payload.message);
                render();
            }
            return;
        }
        load().catch(() => {});
    }

    // ---------- Wiring ----------

    doc.addEventListener('click', (e) => {
        const trigger = e.target.closest('.chat-trigger');
        if (trigger) {
            open(trigger.dataset.eventId);
            return;
        }
        if (!sheet.contains(e.target)) return;
        if (e.target === sheet || e.target.closest('[data-close]')) return close();
        const likeBtn = e.target.closest('[data-like]');
        if (likeBtn) return like(likeBtn.dataset.like);
        const editBtn = e.target.closest('[data-edit]');
        if (editBtn) {
            editingId = editBtn.dataset.edit;
            confirmDeleteId = null;
            render();
            const area = list.querySelector('.chat-edit textarea');
            if (area) {
                area.focus();
                area.setSelectionRange(area.value.length, area.value.length);
            }
            return;
        }
        if (e.target.closest('[data-cancel-edit]')) {
            editingId = null;
            render();
            return;
        }
        const deleteBtn = e.target.closest('[data-delete]');
        if (deleteBtn) return remove(deleteBtn.dataset.delete);
    });
    list.addEventListener('submit', (e) => {
        const form = e.target.closest('.chat-edit');
        if (!form) return;
        e.preventDefault();
        saveEdit(form);
    });
    doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !sheet.classList.contains('hidden')) {
            if (editingId) {
                editingId = null;
                render();
            } else {
                close();
            }
        }
    });
    $('chat-form').addEventListener('submit', send);
    $('chat-signin').addEventListener('submit', askLink);
    // Changing the name is a caveat worth a line: it renames what was already written.
    $('chat-name').addEventListener('input', () => {
        const typed = $('chat-name').value.trim();
        const current = me && me.name;
        const hint = $('chat-name-hint');
        hint.hidden = !current || !typed || typed.toLowerCase() === current.toLowerCase();
        if (!hint.hidden) hint.textContent = `Your earlier messages change to ${typed} too, marked "was ${current}" for a week.`;
    });
    $('chat-rename').addEventListener('click', () => {
        $('chat-as').hidden = true;
        $('chat-name-field').hidden = false;
        $('chat-name').focus();
        $('chat-name').select();
    });
    const input = $('chat-input');
    input.addEventListener('input', () => autosize(input));
    // Enter sends on a keyboard; Shift+Enter is a new line. Phones keep Enter as a new line.
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && root.matchMedia('(hover: hover)').matches) {
            e.preventDefault();
            $('chat-form').requestSubmit();
        }
    });

    // /#chat-<id>: a chat sign-in link lands here, signed in, on its thread.
    const match = /^#chat-(.+)$/.exec(root.location.hash);
    if (match) {
        history.replaceState(null, '', root.location.pathname + root.location.search);
        open(decodeURIComponent(match[1]));
    }

    root.EventChat = { open, onBroadcast };
})(typeof window !== 'undefined' ? window : globalThis);
