// The header's account link on every public page: "Sign in" (Find my events, /me), or
// "My events" once this device has signed in there. [data-signed-out] links (Home's sidebar
// "Find my events") show only before then. The session cookie is HttpOnly, so
// js/me.js keeps a note of it in lilai.signedIn; a stale note only changes the label.
(function (root) {
    'use strict';

    const KEY = 'lilai.signedIn';

    function signedIn() {
        try { return Boolean(root.localStorage.getItem(KEY)); } catch (_) { return false; }
    }

    function refresh() {
        const yes = signedIn();
        document.querySelectorAll('[data-account-link]').forEach((a) => {
            a.textContent = yes ? 'My events' : 'Sign in';
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
    root.AccountLink = { remember, refresh };
})(window);
