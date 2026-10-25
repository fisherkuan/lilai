// The booking queue is open to its organisers, who are not admins: hide the admin-only tabs
// (Donations, Places, Organisers) unless this device is signed in as an admin.
(function () {
    'use strict';

    fetch('/api/admin/session', { cache: 'no-store' })
        .then(res => {
            if (res.ok) return;
            document.querySelectorAll('.admin-nav [data-admin-only]').forEach(a => { a.hidden = true; });
        })
        .catch(() => { /* offline: leave the tabs; they ask for sign-in themselves */ });
})();
