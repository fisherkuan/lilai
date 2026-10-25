// The header's account link on every public page: "Sign in" (the sign-in page, /me), or
// "Profile" once this device has signed in there (the same page shows the profile), plus
// "Admin" at the very end of the header while this device carries the organiser flag. Both are
// sprites (js/sprites.js) where that is loaded, with the word as their label. [data-signed-out] links (Home's sidebar
// "Sign in") show only before then. The session cookie is HttpOnly, so
// js/me.js keeps a note of it in lilai.signedIn; a stale note only changes the label.
(function (root) {
    'use strict';

    const KEY = 'lilai.signedIn';
    // The organiser flag Home sets (?admin=1, or five taps on its heading); app.js explains it.
    const ADMIN_KEY = 'lilaiOrganizer';
    const ADMIN_HOME = '/admin/bookings';

    function organizer() {
        try { return root.localStorage.getItem(ADMIN_KEY) === '1'; } catch (_) { return false; }
    }

    // "Admin" last in the header, after the bug, on every page that has one, while the flag is on.
    function showAdmin(on = organizer()) {
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

    function remember(email) {
        try {
            if (email) root.localStorage.setItem(KEY, email);
            else root.localStorage.removeItem(KEY);
        } catch (_) { /* private mode */ }
        refresh();
    }

    refresh();
    showAdmin();
    root.AccountLink = { remember, refresh, showAdmin };
})(window);
