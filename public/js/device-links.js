// DeviceLinks: the links this device holds, and sharing one.
//
// - Management links (lilai.hostedEvents): every event this device made or opened the
//   management page of, so Home can list them under "You manage".
// - Calendar keys (lilai.calendarKeys, { calendar name: token }): opened from a calendar link,
//   they let this device make events in a restricted calendar.
//
// localStorage is a convenience here: a private window forgets, and the link itself still works.
(function (root) {
    'use strict';

    const HOSTED_KEY = 'lilai.hostedEvents';
    const CAL_KEY = 'lilai.calendarKeys';
    const MAX_HOSTED = 30;

    function read(key, fallback) {
        try {
            const value = JSON.parse(root.localStorage.getItem(key) || 'null');
            return value === null ? fallback : value;
        } catch (_) {
            return fallback;
        }
    }

    function write(key, value) {
        try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
    }

    function hosted() {
        const list = read(HOSTED_KEY, []);
        return Array.isArray(list) ? list.filter(e => e && typeof e.hostPath === 'string') : [];
    }

    // entry: { hostPath, title, date, count? }. The newest first; one entry per link.
    function rememberHosted(entry) {
        const list = [entry, ...hosted().filter(e => e.hostPath !== entry.hostPath)].slice(0, MAX_HOSTED);
        write(HOSTED_KEY, list);
    }

    function forgetHosted(hostPath) {
        write(HOSTED_KEY, hosted().filter(e => e.hostPath !== hostPath));
    }

    function calendarKeys() {
        const keys = read(CAL_KEY, {});
        return keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
    }

    function rememberCalendarKey(name, token) {
        write(CAL_KEY, { ...calendarKeys(), [name]: token });
    }

    // The phone's share sheet where there is one, else the clipboard.
    // Resolves to 'shared', 'copied', 'cancelled' or 'failed'.
    async function share({ title, text, url }) {
        if (root.navigator.share) {
            try {
                await root.navigator.share({ title, text, url });
                return 'shared';
            } catch (error) {
                if (error && error.name === 'AbortError') return 'cancelled';
            }
        }
        try {
            await root.navigator.clipboard.writeText(url);
            return 'copied';
        } catch (_) {
            return 'failed';
        }
    }

    root.DeviceLinks = { hosted, rememberHosted, forgetHosted, calendarKeys, rememberCalendarKey, share };
})(window);
