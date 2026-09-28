/*
 * Footer theme switch: Auto, Light or Dark. Auto follows the device and is the default;
 * Light and Dark set data-theme on <html>, which the token blocks in lilai.css read.
 *
 * The saved choice is applied before first paint by a one-line script in each page's
 * <head>, so no page flashes the wrong theme; this file only draws the switch and saves.
 * The choice is per device (localStorage), like the remembered RSVP name.
 */
(() => {
    'use strict';

    const KEY = 'lilaiTheme';
    const CHOICES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
    const BAR = { light: '#ffffff', dark: '#121212' };

    function saved() {
        try {
            const v = localStorage.getItem(KEY);
            return v === 'light' || v === 'dark' ? v : 'auto';
        } catch (_) {
            return 'auto';
        }
    }

    // The browser bar colour follows the device through its media attributes. A manual
    // choice overrides both, so the bar matches the page rather than the phone.
    function paintBar(choice) {
        document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
            const media = meta.getAttribute('media') || '';
            const own = media.includes('dark') ? BAR.dark : BAR.light;
            meta.setAttribute('content', choice === 'auto' ? own : BAR[choice]);
        });
    }

    function apply(choice) {
        if (choice === 'auto') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = choice;
        try {
            if (choice === 'auto') localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, choice);
        } catch (_) {
            /* private browsing: the choice holds for this page view only */
        }
        paintBar(choice);
    }

    function render() {
        const footer = document.querySelector('.colophon');
        if (!footer) return;
        const group = document.createElement('div');
        group.className = 'theme-switch';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Theme');
        group.innerHTML = '<span class="theme-switch-label">Theme</span>' + CHOICES.map(([value, label]) =>
            `<button type="button" class="theme-btn" data-theme-choice="${value}" aria-pressed="false">${label}</button>`
        ).join('');
        footer.appendChild(group);

        const buttons = [...group.querySelectorAll('.theme-btn')];
        const mark = choice => buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice)));
        buttons.forEach(b => b.addEventListener('click', () => {
            apply(b.dataset.themeChoice);
            mark(b.dataset.themeChoice);
        }));
        const current = saved();
        mark(current);
        paintBar(current);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
    else render();
})();
