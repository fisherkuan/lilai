/*
 * The address book: who this board books for.
 *
 * Three facts per person — name, email, phone — kept on the server. The queue sheet used to
 * ask for all three on every request and remember them in localStorage, which meant one
 * browser knew one person and a cleared cache knew nobody. A person is entered once here
 * and picked by name afterwards.
 *
 * Contact details arrive masked in the list on purpose; the editor reads one person in full
 * when it is actually opened. This module owns the list so the queue sheet and the manager
 * cannot disagree about who exists.
 */
(() => {
    'use strict';

    const { h, readJson } = window.bookingShared;

    // Which person this browser picked last. A convenience, not identity — the people
    // themselves live on the server, so losing this loses one click and nothing else.
    const LAST_PERSON = 'lilai.booking.lastPerson';

    let people = [];
    let loaded = false;
    let root = null;

    function readLast() {
        try {
            return localStorage.getItem(LAST_PERSON) || null;
        } catch (error) {
            return null;
        }
    }

    function rememberLast(id) {
        try {
            localStorage.setItem(LAST_PERSON, id);
        } catch (error) { /* storage unavailable; the picker still works */ }
    }

    // --- Data --------------------------------------------------------------------------

    const whyItFailed = (error) => error.staleServer
        ? error.message
        : 'Could not reach the server. Try again.';

    async function load() {
        try {
            const data = await readJson(await fetch('/api/booking-profiles'));
            if (data.success) {
                people = data.profiles;
                loaded = true;
            }
        } catch (error) { /* an empty list still offers "Add a person" */ }
        return people;
    }

    const list = () => people;
    const byId = (id) => people.find((person) => person.id === id) || null;

    // --- Editor ------------------------------------------------------------------------

    /*
     * Add or change one person. Resolves with the saved profile, or null if it was closed.
     *
     * It stacks on top of whatever opened it — the queue sheet, or the manager — because
     * adding a person is always something someone is in the middle of, never the errand
     * they set out on.
     */
    function openEditor(existing = null) {
        return new Promise((resolve) => {
            const name = h('input', {
                type: 'text', class: 'bs-input', maxlength: '100', autocomplete: 'off',
                placeholder: 'Family name first, e.g. Kuan Fisher', value: existing ? existing.name : ''
            });
            const email = h('input', {
                type: 'email', class: 'bs-input', placeholder: 'name@student.kuleuven.be', value: ''
            });
            // No country code, no spaces: KU Leuven's form takes the number as typed, and a
            // placeholder shaped like "+32 4xx xx xx xx" reads as a format requirement.
            const phone = h('input', {
                type: 'tel', class: 'bs-input', placeholder: '0470123456', value: ''
            });

            const error = h('div', { class: 'bs-error', hidden: true });
            const save = h('button', { type: 'button', class: 'btn primary bs-next', text: existing ? 'Save' : 'Add' });

            const layer = h('div', { class: 'bs-root bp-layer' }, [
                h('div', { class: 'bs-backdrop', onclick: () => done(null) }),
                h('section', { class: 'bs-sheet bp-sheet', role: 'dialog', 'aria-modal': 'true' }, [
                    h('div', { class: 'bs-handle' }),
                    h('header', { class: 'bs-head' }, [
                        h('div', {}, [
                            h('div', { class: 'bs-title', text: existing ? 'Edit this person' : 'Add a person' }),
                            h('div', { class: 'bs-step', text: 'Name, email and phone — asked once' })
                        ]),
                        h('button', { type: 'button', class: 'bs-close', 'aria-label': 'Close', text: '×', onclick: () => done(null) })
                    ]),
                    h('div', { class: 'bs-body' }, [
                        h('div', { class: 'bs-field' }, [
                            h('label', { class: 'bs-label', text: 'Name' }),
                            h('p', { class: 'bs-note bs-hint', text: 'Family name first, then given name — the order KU Leuven expects.' }),
                            name,
                            h('p', { class: 'bs-note', text: 'This name goes on the form, and it is what counts the two slots a week.' })
                        ]),
                        h('div', { class: 'bs-field' }, [
                            h('label', { class: 'bs-label', text: 'Email KU Leuven replies to' }),
                            email
                        ]),
                        h('div', { class: 'bs-field' }, [
                            h('label', { class: 'bs-label', text: 'Phone' }),
                            phone,
                            h('p', { class: 'bs-note', text: 'Any format KU Leuven can dial. No country code needed.' })
                        ]),
                        h('p', { class: 'bs-note', text: 'Email and phone never appear on the board — only the name does. They are filled into the KU Leuven form and nothing else.' })
                    ]),
                    error,
                    h('div', { class: 'bs-footer' }, [
                        h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => done(null) }),
                        save
                    ])
                ])
            ]);

            function fail(message) {
                error.textContent = message;
                error.hidden = false;
                save.disabled = false;
                save.textContent = existing ? 'Save' : 'Add';
            }

            function done(value) {
                layer.remove();
                document.removeEventListener('keydown', onKey);
                resolve(value);
            }

            function onKey(event) {
                if (event.key === 'Escape') { event.stopPropagation(); done(null); }
            }

            save.addEventListener('click', async () => {
                error.hidden = true;
                save.disabled = true;
                save.textContent = 'Saving…';
                const body = JSON.stringify({
                    name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim()
                });
                try {
                    const response = await fetch(
                        existing ? `/api/booking-profiles/${encodeURIComponent(existing.id)}` : '/api/booking-profiles',
                        { method: existing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body }
                    );
                    const data = await readJson(response);
                    if (!data.success) return fail(data.message || 'Could not save that.');
                    await load();
                    done(data.profile);
                } catch (fetchError) {
                    fail(whyItFailed(fetchError));
                }
            });

            document.addEventListener('keydown', onKey);
            document.body.append(layer);

            /*
             * An edit starts with the contact fields blank and reads the stored ones in,
             * so a slow network never shows an empty box that looks like a cleared value.
             */
            if (existing) {
                fetch(`/api/booking-profiles/${encodeURIComponent(existing.id)}`)
                    .then(readJson)
                    .then((data) => {
                        if (!data.success) return;
                        email.value = data.profile.email;
                        phone.value = data.profile.phone;
                    })
                    .catch(() => { /* the person can retype them */ });
            }
            name.focus();
        });
    }

    // --- Manager -----------------------------------------------------------------------

    async function remove(person) {
        try {
            const data = await readJson(
                await fetch(`/api/booking-profiles/${encodeURIComponent(person.id)}`, { method: 'DELETE' }));
            if (!data.success) return data.message || 'Could not remove that person.';
        } catch (error) {
            return whyItFailed(error);
        }
        await load();
        return null;
    }

    function renderManager() {
        const body = root.querySelector('.bs-body');
        body.textContent = '';

        if (people.length === 0) {
            body.append(h('p', { class: 'bs-note', text: 'Nobody here yet. Add the people who book, and the request form stops asking for an email and a phone number every time.' }));
        }

        for (const person of people) {
            body.append(h('div', { class: 'bp-row' }, [
                h('div', { class: 'bp-who' }, [
                    h('div', { class: 'bp-name', text: person.name }),
                    h('div', { class: 'bp-contact', text: `${person.emailMasked} · ${person.phoneMasked}` })
                ]),
                h('div', { class: 'bp-acts' }, [
                    h('button', {
                        type: 'button', class: 'bs-swap', text: 'Edit',
                        onclick: async () => { if (await openEditor(person)) renderManager(); }
                    }),
                    h('button', {
                        type: 'button', class: 'bp-remove', text: 'Remove',
                        onclick: () => confirmRemoval(person)
                    })
                ])
            ]));
        }

        body.append(h('button', {
            type: 'button', class: 'btn ghost bs-wide', text: '+ Add a person',
            onclick: async () => { if (await openEditor(null)) renderManager(); }
        }));
    }

    /*
     * Removing a person takes them out of the picker and nothing else: requests already
     * queued keep the name, email and phone they were made with and still go out at
     * midnight. That is worth saying in the confirmation, because "remove" reads like it
     * might cancel them.
     */
    function confirmRemoval(person) {
        const body = root.querySelector('.bs-body');
        body.textContent = '';
        const error = h('p', { class: 'bs-note bp-error', hidden: true });
        body.append(
            h('div', { class: 'bs-full' }, [
                h('div', { class: 'bs-full-head' }, [
                    h('span', { class: 'bs-full-title', text: `Remove ${person.name}?` })
                ]),
                h('p', { class: 'bs-note', text: 'They come out of the picker. Requests already in the queue keep the details they were made with and still go out — nothing is cancelled.' }),
                error,
                h('div', { class: 'bp-acts' }, [
                    h('button', { type: 'button', class: 'bs-swap', text: 'Keep them', onclick: renderManager }),
                    h('button', {
                        type: 'button', class: 'bp-remove', text: 'Remove',
                        onclick: async () => {
                            const message = await remove(person);
                            if (message) {
                                error.textContent = message;
                                error.hidden = false;
                                return;
                            }
                            renderManager();
                            if (window.bookingBoard) window.bookingBoard.load();
                        }
                    })
                ])
            ])
        );
    }

    function closeManager() {
        if (!root) return;
        root.remove();
        root = null;
        document.body.style.overflow = '';
    }

    async function openManager() {
        if (root) return;
        root = h('div', { class: 'bs-root' }, [
            h('div', { class: 'bs-backdrop', onclick: closeManager }),
            h('section', { class: 'bs-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'People' }, [
                h('div', { class: 'bs-handle' }),
                h('header', { class: 'bs-head' }, [
                    h('div', {}, [
                        h('div', { class: 'bs-title', text: 'People' }),
                        h('div', { class: 'bs-step', text: 'Who this board books for' })
                    ]),
                    h('button', { type: 'button', class: 'bs-close', 'aria-label': 'Close', text: '×', onclick: closeManager })
                ]),
                h('div', { class: 'bs-body' }),
                h('div', { class: 'bs-footer' }, [
                    h('button', { type: 'button', class: 'btn ghost bs-wide', text: 'Done', onclick: closeManager })
                ])
            ])
        ]);
        document.body.append(root);
        document.body.style.overflow = 'hidden';
        renderManager();
        await load();
        if (root) renderManager();
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && root) closeManager();
    });

    window.bookingPeople = {
        load, list, byId, openEditor, openManager,
        loaded: () => loaded,
        readLast, rememberLast
    };
})();
