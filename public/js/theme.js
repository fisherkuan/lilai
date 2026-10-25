/*
 * Footer theme switch: Light or Dark. Light is the default whatever the device uses (owner,
 * 2026-10-25: no Auto); the choice sets data-theme on <html>, which the token blocks read.
 *
 * The saved choice is applied before first paint by a one-line script in each page's
 * <head>, so no page flashes the wrong theme; this file only draws the switch and saves.
 * The choice is per device (localStorage), like the remembered RSVP name. Profile's Display
 * card sets it too (window.LilaiTheme); every switch on the page follows 'lilai:theme'.
 */
(() => {
    'use strict';

    const KEY = 'lilaiTheme';
    const CHOICES = [['light', 'Light'], ['dark', 'Dark']];
    const BAR = { light: '#efefea', dark: '#111214' };

    function saved() {
        try {
            return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
        } catch (_) {
            return 'light';
        }
    }

    // The browser bar matches the page, not the phone, so both theme-color metas take it.
    function paintBar(choice) {
        document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute('content', BAR[choice]));
    }

    function apply(choice) {
        document.documentElement.dataset.theme = choice;
        try {
            if (choice === 'dark') localStorage.setItem(KEY, choice);
            else localStorage.removeItem(KEY);
        } catch (_) {
            /* private browsing: the choice holds for this page view only */
        }
        paintBar(choice);
        document.dispatchEvent(new CustomEvent('lilai:theme', { detail: choice }));
    }

    window.LilaiTheme = { get: saved, set: apply, choices: CHOICES };

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
        buttons.forEach(b => b.addEventListener('click', () => apply(b.dataset.themeChoice)));
        document.addEventListener('lilai:theme', e => mark(e.detail));
        const current = saved();
        mark(current);
        paintBar(current);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
    else render();
})();
