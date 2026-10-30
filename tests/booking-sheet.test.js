const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/*
 * The booking sheet in a DOM, with the server and the address book faked. iOS fires `change`
 * on an empty date field the moment its picker opens, and a repaint that takes the field out
 * of the page shuts the picker: these tests fire that `change` and look at the field.
 */
async function openSheet() {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    const preview = { success: true, dates: ['2026-11-04', '2026-11-11'], summary: 'two' };
    window.fetch = async (url) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(String(url).includes('repeat-preview') ? preview
            : String(url).includes('form-options') ? { success: true, facilities: [], seasonEndsOn: '2027-06-30' }
                : { success: true })
    });
    window.bookingBoard = { earliestPlayDate: () => new Date(2026, 9, 30), load() {} };
    window.bookingPeople = {
        list: () => [], loaded: () => true, byId: () => null, readLast: () => null,
        rememberLast() {}, load: async () => {}
    };
    window.eval(read('booking-shared.js'));
    window.eval(read('booking-sheet.js'));
    window.openBookingSheet();
    await tick();
    return window;
}

const day = (window) => window.document.querySelector('[data-part="day"] input[type="date"]');
const until = (window) => window.document.querySelector('[data-part="repeat"] input[type="date"]');

function pick(window, input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('the day picker stays in the page, with the focus, when iOS fills in today (FK-38)', async () => {
    const window = await openSheet();
    const field = day(window);
    pick(window, field, '2026-11-04');
    await tick();
    assert.equal(day(window), field);
    assert.equal(window.document.activeElement, field);
});

test('the Until picker stays in the page, with the focus, when iOS fills in today (FK-119)', async () => {
    const window = await openSheet();
    [...window.document.querySelectorAll('.bs-body button')].find((b) => b.textContent === 'Repeat').click();
    const field = until(window);
    assert.ok(field, 'Until is on the page once repeat is on');

    pick(window, field, '2026-10-30');
    await tick();

    assert.equal(until(window), field);
    assert.equal(window.document.activeElement, field);
});

test('once the focus leaves Until, the next repaint shows the preview for the picked date', async () => {
    const window = await openSheet();
    const { document } = window;
    pick(window, day(window), '2026-11-04');
    [...document.querySelectorAll('.bs-body button')].find((b) => b.textContent === 'Repeat').click();
    await tick();
    const field = until(window);

    pick(window, field, '2026-11-11');
    await tick();
    assert.match(document.querySelector('.bs-preview').textContent, /2 bookings/);

    field.blur();
    // Any choice repaints the page; here, the weekday pill.
    document.querySelector('.bs-pills .bs-pill').click();
    await tick();
    assert.notEqual(until(window), field, 'the card is rebuilt once the focus has left');
    assert.equal(until(window).value, '2026-11-11');
    assert.match(document.querySelector('.bs-preview').textContent, /2 bookings/);
});

test('a repeat unit changed while its select has the focus rebuilds the card, without the weekday ticks', async () => {
    const window = await openSheet();
    const { document } = window;
    [...document.querySelectorAll('.bs-body button')].find((b) => b.textContent === 'Repeat').click();
    assert.ok(document.querySelector('.bs-pills-days'), 'weekday ticks show for a weekly rule');

    const select = document.querySelector('[data-part="repeat"] select.bs-unit');
    select.focus();
    select.value = 'day';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();

    assert.equal(document.querySelector('.bs-pills-days'), null);
    assert.equal(document.querySelector('[data-part="repeat"] select.bs-unit').value, 'day');
});
