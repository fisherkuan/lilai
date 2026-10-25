/*
 * The header's bug button and the footer's "Send feedback" button, and their sheet, ported from splitly's feedback form.
 * It posts { message, email, page, files } to /api/feedback, which saves the message and
 * emails it to the owner. Files go base64 in the JSON body and reach the email only.
 *
 * Self-contained like theme.js: every page with a .colophon footer gets the button, and
 * the sheet is built on first open, so pages carry no extra markup.
 */
(() => {
    'use strict';

    const MAX_FILES = 5;
    const MAX_BYTES = 10 * 1024 * 1024;
    const MESSAGES = {
        too_long: "That's too long to send",
        too_many_files: `Attach up to ${MAX_FILES} files`,
        too_large: 'Files must add up to under 10 MB',
        bad_email: 'That email address does not look right'
    };
    // Without js/sprites.js (the Goomba): splitly's bug (src/components/icons.tsx, 2026-10).
    const BUG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9h8v6a4 4 0 0 1-8 0zM9.5 9V7a2.5 2.5 0 0 1 5 0v2M12 12v7M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2"/></svg>';
    const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

    let modal = null;
    let files = [];
    let opener = null;

    function build() {
        modal = document.createElement('div');
        modal.id = 'feedback-modal';
        modal.className = 'modal hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'feedback-title');
        modal.innerHTML = `
            <form class="sheet feedback-sheet" novalidate>
                <div class="sheet-head">
                    <h3 class="sheet-title" id="feedback-title">Send feedback</h3>
                    <button type="button" class="icon-btn" data-close aria-label="Close">${CLOSE_ICON}</button>
                </div>
                <p class="sheet-when">Something broken, missing or nice? It goes straight to Fisher.</p>
                <div class="field">
                    <label for="feedback-message">Message</label>
                    <textarea id="feedback-message" class="input textarea" rows="6" maxlength="10000" required></textarea>
                </div>
                <div class="field">
                    <label for="feedback-email">Email, if you want a reply</label>
                    <input type="email" id="feedback-email" class="input" autocomplete="email" inputmode="email">
                </div>
                <ul class="feedback-files" aria-label="Attachments" hidden></ul>
                <button type="button" class="text-btn feedback-attach">Attach a file</button>
                <input type="file" class="feedback-picker" multiple hidden aria-label="Attachment">
                <p class="field-error" id="feedback-error" role="alert" hidden></p>
                <div class="sheet-actions">
                    <button type="submit" class="btn btn-solid feedback-send" disabled>Send</button>
                    <button type="button" class="text-btn" data-close>Cancel</button>
                </div>
            </form>`;
        document.body.appendChild(modal);

        const form = modal.querySelector('form');
        const message = modal.querySelector('#feedback-message');
        const picker = modal.querySelector('.feedback-picker');
        message.addEventListener('input', sync);
        modal.querySelector('.feedback-attach').addEventListener('click', () => picker.click());
        picker.addEventListener('change', () => {
            add(picker.files);
            picker.value = '';
        });
        modal.querySelector('.feedback-files').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove]');
            if (!btn) return;
            files.splice(Number(btn.dataset.remove), 1);
            showError(null);
            renderFiles();
        });
        modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        form.addEventListener('submit', e => {
            e.preventDefault();
            send();
        });
    }

    function showError(text) {
        const el = modal.querySelector('#feedback-error');
        el.textContent = text || '';
        el.hidden = !text;
    }

    function sync() {
        const busy = modal.dataset.busy === '1';
        modal.querySelector('.feedback-send').disabled = busy || !modal.querySelector('#feedback-message').value.trim();
        modal.querySelector('.feedback-attach').hidden = files.length >= MAX_FILES;
    }

    function add(picked) {
        const next = [...files, ...(picked || [])];
        if (next.length > MAX_FILES) return showError(MESSAGES.too_many_files);
        if (next.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) return showError(MESSAGES.too_large);
        showError(null);
        files = next;
        renderFiles();
    }

    function renderFiles() {
        const list = modal.querySelector('.feedback-files');
        list.hidden = files.length === 0;
        list.innerHTML = '';
        files.forEach((f, i) => {
            const li = document.createElement('li');
            const name = document.createElement('span');
            name.className = 'feedback-file-name';
            name.textContent = f.name;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'icon-btn';
            remove.dataset.remove = String(i);
            remove.setAttribute('aria-label', `Remove ${f.name}`);
            remove.innerHTML = CLOSE_ICON;
            li.append(name, remove);
            list.appendChild(li);
        });
        sync();
    }

    function toBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    function setBusy(busy) {
        modal.dataset.busy = busy ? '1' : '';
        modal.querySelectorAll('textarea, input, .feedback-files button').forEach(el => { el.disabled = busy; });
        sync();
    }

    async function send() {
        const sendBtn = modal.querySelector('.feedback-send');
        showError(null);
        setBusy(true);
        sendBtn.textContent = 'Sending…';
        try {
            const body = {
                message: modal.querySelector('#feedback-message').value,
                email: modal.querySelector('#feedback-email').value,
                page: window.location.pathname,
                files: await Promise.all(files.map(async f => ({ name: f.name, type: f.type, data: await toBase64(f) })))
            };
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const { error } = await res.json().catch(() => ({}));
                throw new Error(MESSAGES[error] || 'Could not send, try again');
            }
            sendBtn.textContent = 'Sent';
            setTimeout(() => close(true), 700);
        } catch (err) {
            showError(err instanceof TypeError ? "You're offline, try again" : err.message);
            sendBtn.textContent = 'Send';
            setBusy(false);
        }
    }

    function open() {
        if (!modal) build();
        opener = document.activeElement;
        modal.classList.remove('hidden');
        modal.querySelector('#feedback-message').focus();
    }

    // After a send the draft is cleared; a plain close keeps it for next time.
    function close(sent) {
        if (!modal || modal.dataset.busy === '1' && sent !== true) return;
        modal.classList.add('hidden');
        if (sent === true) {
            modal.querySelector('form').reset();
            files = [];
            modal.querySelector('.feedback-send').textContent = 'Send';
            setBusy(false);
            renderFiles();
        }
        if (opener && opener.focus) opener.focus();
    }

    function render() {
        const footer = document.querySelector('.colophon');
        if (!footer) return;
        // In the header: the bug leads the icons.
        const masthead = document.querySelector('.masthead');
        if (masthead) {
            const bug = document.createElement('button');
            bug.type = 'button';
            bug.className = 'icon-btn report-bug';
            bug.setAttribute('aria-label', 'Report a bug');
            bug.title = 'Report a bug';
            bug.innerHTML = window.Sprites ? window.Sprites.svg('goomba') : BUG_ICON;
            bug.classList.toggle('hdr-icon', Boolean(window.Sprites));
            bug.addEventListener('click', open);
            // First after the wordmark, ahead of the links (owner, 2026-10-25).
            masthead.insertBefore(bug, masthead.querySelector('.app-header-links') || masthead.querySelector('[data-admin-link]'));
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'feedback-btn';
        btn.textContent = 'Send feedback';
        btn.addEventListener('click', open);
        // Beside the credit line, ahead of the theme switch that theme.js appends.
        const credit = footer.querySelector('p');
        if (credit) credit.after(btn);
        else footer.prepend(btn);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) close();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
    else render();
})();
