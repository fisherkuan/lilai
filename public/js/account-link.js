// The header's account link on every public page: "Sign in" (Find my events, /me), or
// "My events" once this device has signed in there. The session cookie is HttpOnly, so
// js/me.js keeps a note of it in lilai.signedIn; a stale note only changes the label.
(function (root) {
    'use strict';

    const KEY = 'lilai.signedIn';

    function signedIn() {
        try { return Boolean(root.localStorage.getItem(KEY)); } catch (_) { return false; }
    }

    function refresh() {
        document.querySelectorAll('[data-account-link]').forEach((a) => {
            a.textContent = signedIn() ? 'My events' : 'Sign in';
        });
    }

    function remember(email) {
        try {
            if (email) root.localStorage.setItem(KEY, email);
            else root.localStorage.removeItem(KEY);
        } catch (_) { /* private mode */ }
        refresh();
    }

    refresh();
    root.AccountLink = { remember, refresh };
})(window);
