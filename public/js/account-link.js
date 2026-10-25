// The header's account link on every public page: "Sign in" (the sign-in page, /me), or
// "Profile" once this device has signed in there (the same page shows the profile), plus
// "Admin" at the very end of the header when the signed-in address is an admin or a booking
// organiser (GET /api/me/roles; the owner keeps the organisers on /admin/organisers). Both are
// sprites (js/sprites.js) where that is loaded, with the word as their label. [data-signed-out] links (Home's sidebar
// "Sign in") show only before then. The session cookie is HttpOnly, so
// js/me.js keeps a note of it in lilai.signedIn; a stale note only changes the label.
(function (root) {
    'use strict';

    const KEY = 'lilai.signedIn';
    const ADMIN_HOME = '/admin/bookings';
    // The old organiser flag (?admin=1, five taps on Home's heading), retired 2026-10-25.
    try { root.localStorage.removeItem('lilaiOrganizer'); } catch (_) { /* private mode */ }

    // "Admin" last in the header, after the bug, on every page that has one.
    function showAdmin(on) {
        document.querySelectorAll('.masthead').forEach((bar) => {
            const existing = bar.querySelector('[data-admin-link]');
            if (!on) { if (existing) existing.remove(); return; }
            if (existing) return;
            const link = document.createElement('a');
            link.href = ADMIN_HOME;
            link.textContent = 'Admin';
            link.dataset.adminLink = 'true';
            if (root.Sprites) root.Sprites.iconize(link, 'star', 'Admin');
            bar.appendChild(link);
        });
    }

    function signedIn() {
        try { return Boolean(root.localStorage.getItem(KEY)); } catch (_) { return false; }
    }

    function refresh() {
        const yes = signedIn();
        document.querySelectorAll('[data-account-link]').forEach((a) => {
            const label = yes ? 'Profile' : 'Sign in';
            if (root.Sprites) root.Sprites.iconize(a, yes ? 'head' : 'ghost', label);
            else a.textContent = label;
        });
        document.querySelectorAll('[data-signed-out]').forEach((a) => { a.hidden = yes; });
    }

    // What the signed-in address may see: { admin, organizer }, asked once per page and only
    // when this device notes a sign-in, so nobody else sends the request.
    let rolesAsked = null;
    function roles() {
        if (!rolesAsked) {
            rolesAsked = !signedIn()
                ? Promise.resolve({ admin: false, organizer: false })
                : fetch('/api/me/roles', { cache: 'no-store' })
                    .then(r => (r.ok ? r.json() : {}))
                    .then(b => ({ admin: Boolean(b.admin), organizer: Boolean(b.organizer) }))
                    .catch(() => ({ admin: false, organizer: false }));
        }
        return rolesAsked;
    }

    function remember(email) {
        try {
            if (email) root.localStorage.setItem(KEY, email);
            else root.localStorage.removeItem(KEY);
        } catch (_) { /* private mode */ }
        rolesAsked = null;
        refresh();
        roles().then(r => showAdmin(r.organizer));
    }

    refresh();
    roles().then(r => showAdmin(r.organizer));
    root.AccountLink = { remember, refresh, showAdmin, signedIn, roles };
})(window);
