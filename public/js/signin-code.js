// The emailed sign-in code, shared by /me, Make an event and an event's chat. The code comes
// first: mail apps offer to copy or fill it, and an iPhone home-screen app cannot open the
// link (Mail opens it in Safari, whose cookie the app never sees). The link in the same email
// is the fallback.
//
// A sent code is remembered for its 30 minutes (lilai.signinPending: the address, and where the
// code was asked for, 'new' or 'chat-<event id>' on Home, else ''): iOS often reloads a
// home-screen app while the person reads their mail, and Home reopens that sheet with the code
// field when they come back.
(function (root) {
    'use strict';

    const KEY = 'lilai.signinPending';
    const LIFE_MS = 30 * 60 * 1000;

    function storage() {
        try { return root.localStorage || null; } catch (_) { return null; }
    }

    function clean(value) {
        return String(value ?? '').replace(/\s/g, '');
    }

    function isCode(value) {
        return /^\d{6}$/.test(clean(value));
    }

    function entry(now, store) {
        try {
            const p = JSON.parse(store.getItem(KEY) || 'null');
            if (p && p.email && now - p.at >= 0 && now - p.at < LIFE_MS) return p;
        } catch (_) { /* nothing kept */ }
        return null;
    }

    // The address a code was sent to in the last 30 minutes, else ''.
    function pending(now = Date.now(), store = storage()) {
        return (entry(now, store) || {}).email || '';
    }

    // Where that code was asked for: 'new', 'chat-<event id>', or ''.
    function pendingWhere(now = Date.now(), store = storage()) {
        return (entry(now, store) || {}).where || '';
    }

    function remember(email, where = '', now = Date.now(), store = storage()) {
        try { store.setItem(KEY, JSON.stringify({ email, where, at: now })); } catch (_) { /* private mode */ }
    }

    function clear(store = storage()) {
        try { store.removeItem(KEY); } catch (_) { /* private mode */ }
    }

    // Signs this device in with the code. Answers { ok, result }; result carries email and name.
    async function redeem(email, code) {
        const res = await fetch('/api/me/session', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code: clean(code) })
        });
        const result = await res.json().catch(() => ({}));
        const ok = res.ok && result.success !== false;
        if (ok) {
            clear();
            if (root.AccountLink) root.AccountLink.remember(result.email);
        }
        return { ok, result };
    }

    root.SignInCode = { isCode, clean, pending, pendingWhere, remember, clear, redeem };
})(typeof window !== 'undefined' ? window : globalThis);
