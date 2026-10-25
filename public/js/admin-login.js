// Admin sign-in: an email on the admin list gets a six-digit code, the code sets a 30-day
// cookie (server/admin-auth.js), then the page that sent us here opens.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const next = new URLSearchParams(location.search).get('next');
    const target = next && next.startsWith('/admin/') ? next : '/admin/donations';

    // Back to the page that sent someone here (not an admin page, which would send them back), else Home.
    try {
        const from = new URL(document.referrer);
        if (from.origin === location.origin && !from.pathname.startsWith('/admin')) $('login-back').href = from.pathname + from.search + from.hash;
    } catch (_) { /* no referrer */ }
    let email = '';
    try { $('email').value = localStorage.getItem('lilaiAdminEmail') || ''; } catch (_) { /* private mode */ }

    function status(id, message, isError) {
        const el = $(id);
        el.textContent = message || '';
        el.className = `row-status${isError ? ' is-error' : ''}`;
        el.hidden = !message;
    }

    async function post(url, body) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'That did not work. Try again.');
        return data;
    }

    async function sendCode(button) {
        button.disabled = true;
        try {
            await post('/api/admin/code', { email });
            try { localStorage.setItem('lilaiAdminEmail', email); } catch (_) { /* not remembered */ }
            $('email-form').hidden = true;
            $('code-form').hidden = false;
            $('code-sent').textContent = `If ${email} is an admin address, a code is on its way. It works for ten minutes.`;
            $('code').value = '';
            $('code').focus();
            return true;
        } catch (error) {
            status($('email-form').hidden ? 'code-message' : 'email-message', error.message, true);
            return false;
        } finally {
            button.disabled = false;
        }
    }

    $('email-form').addEventListener('submit', (e) => {
        e.preventDefault();
        email = $('email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return status('email-message', 'Type your email address.', true);
        status('email-message', '');
        sendCode(e.submitter || $('email-form').querySelector('button[type="submit"]'));
    });

    $('code-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const error = document.querySelector('[data-error-for="code"]');
        error.hidden = true;
        status('code-message', '');
        const code = $('code').value.replace(/\s/g, '');
        try {
            await post('/api/admin/session', { email, code });
            location.replace(target);
        } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
            $('code').focus();
        }
    });

    // A full code, typed or filled by the phone, signs in straight away.
    $('code').addEventListener('input', () => {
        if (/^\d{6}$/.test($('code').value.trim())) $('code-form').requestSubmit();
    });

    $('resend-btn').addEventListener('click', async (e) => {
        if (await sendCode(e.currentTarget)) status('code-message', 'A new code is on its way.');
    });

    $('other-btn').addEventListener('click', () => {
        $('code-form').hidden = true;
        $('email-form').hidden = false;
        status('code-message', '');
        $('email').focus();
    });
})();
