// The signed-in admin on Donations and Places (server/admin-auth.js): who it is, Sign out,
// and the way back to sign-in when the session has run out.
(function (root) {
    'use strict';

    function toSignIn() {
        location.assign(`/admin/login?next=${encodeURIComponent(location.pathname)}`);
    }

    // fetch for admin changes: the session cookie goes along by itself; a 401 means sign in again.
    async function adminFetch(url, init) {
        const res = await fetch(url, init);
        if (res.status === 401) {
            toSignIn();
            throw new Error('Signed out. Sign in again.');
        }
        return res;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const who = document.getElementById('admin-email');
        fetch('/api/admin/session').then(res => (res.ok ? res.json() : toSignIn()))
            .then(body => { if (body && who) who.textContent = body.email; })
            .catch(() => { /* the page still works; a change will ask again */ });
        document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
            await fetch('/api/admin/session', { method: 'DELETE' }).catch(() => {});
            location.assign('/admin/login');
        });
    });

    root.AdminSession = { adminFetch, toSignIn };
})(window);
