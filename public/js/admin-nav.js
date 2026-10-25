// The admin tabs on the booking pages, and their sign-in. The booking queue is open to its
// organisers, who are not admins: hide the admin-only tabs (Donations, Places, Organisers)
// unless this device is signed in as an admin. A booking request answered 401 (the session
// ran out) goes to sign-in and back; 403 (taken off the list) reloads into the server's page.
(function () {
    'use strict';

    fetch('/api/admin/session', { cache: 'no-store' })
        .then(res => {
            if (res.ok) return;
            document.querySelectorAll('.admin-nav [data-admin-only]').forEach(a => { a.hidden = true; });
        })
        .catch(() => { /* offline: leave the tabs; they ask for sign-in themselves */ });

    const send = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const res = await send(input, init);
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.origin === location.origin && /^\/api\/booking/.test(url.pathname)) {
            if (res.status === 401) location.assign(`/me?next=${encodeURIComponent(location.pathname + location.search)}`);
            else if (res.status === 403) location.reload();
        }
        return res;
    };
})();
