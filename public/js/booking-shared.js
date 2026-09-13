/*
 * What the four booking scripts have in common.
 *
 * There is no build step here, so sharing means one script loaded before the others and a
 * single global. Each of these used to live in every file that needed it, and the copies
 * had already begun to differ — one h() knew about event handlers, one did not — which is
 * the only thing a copy ever does over time.
 */
(() => {
    'use strict';

    const BRUSSELS = 'Europe/Brussels';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** A calendar date in the browser's own zone, as the date inputs and the API write it. */
    function isoDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /**
     * Build an element: `h('button', { class: 'x', text: 'Go', onclick: fn }, [children])`.
     * `text` sets textContent, `html` sets innerHTML, `on*` adds a listener, `true` sets a
     * bare attribute, `false`/null set nothing.
     */
    function h(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key === 'html') node.innerHTML = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else if (value === true) node.setAttribute(key, '');
            else if (value !== false && value != null) node.setAttribute(key, value);
        }
        for (const child of [].concat(children)) {
            if (child) node.append(child.nodeType ? child : document.createTextNode(child));
        }
        return node;
    }

    /*
     * A response that is not JSON is not a network failure. Saying so sends people to check
     * their wifi over a server that is simply running older code — its SPA fallback answers
     * an unknown path with the page itself.
     */
    async function readJson(response) {
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (error) {
            const stale = new Error('This server is running older code and does not know this request. Restart it.');
            stale.staleServer = true;
            throw stale;
        }
    }

    window.bookingShared = { BRUSSELS, MONTHS, isoDate, h, readJson };
})();
