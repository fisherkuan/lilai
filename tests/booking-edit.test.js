const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeContact, sendAfterForEdit } = require('../server/booking-edit');
const { bookingSettings } = require('../server/booking-settings');

const STORED = {
    email: 'kept@example.com',
    phone: '0470000000',
    opens_at: new Date('2026-09-15T22:00:00Z'),
    send_after: new Date('2026-09-15T22:00:41Z')
};

const SETTINGS = bookingSettings({});

// --- Contact details ---------------------------------------------------------------------

test('a blank contact field keeps the one already stored', () => {
    const merged = mergeContact({ name: 'Kuan Fisher', email: '', phone: '' }, STORED);
    assert.equal(merged.email, 'kept@example.com');
    assert.equal(merged.phone, '0470000000');
});

test('a missing contact field keeps the one already stored', () => {
    const merged = mergeContact({ name: 'Kuan Fisher' }, STORED);
    assert.equal(merged.email, 'kept@example.com');
    assert.equal(merged.phone, '0470000000');
});

test('a missing name keeps the one already stored — the sheet sends a profile, never a name', () => {
    const stored = { ...STORED, name: 'Yuki Chen' };
    assert.equal(mergeContact({ email: '', phone: '' }, stored).name, 'Yuki Chen');
    assert.equal(mergeContact({ name: '  ' }, stored).name, 'Yuki Chen');
    assert.equal(mergeContact({ name: 'Wei Lin' }, stored).name, 'Wei Lin');
});

test('whitespace is blank, not a new value', () => {
    const merged = mergeContact({ email: '   ', phone: '\t' }, STORED);
    assert.equal(merged.email, 'kept@example.com');
    assert.equal(merged.phone, '0470000000');
});

test('a supplied contact field replaces the stored one', () => {
    const merged = mergeContact({ email: 'new@example.com', phone: '+32470111222' }, STORED);
    assert.equal(merged.email, 'new@example.com');
    assert.equal(merged.phone, '+32470111222');
});

test('everything else on the edit passes straight through', () => {
    const merged = mergeContact({ sport: 'Badminton', players: 14 }, STORED);
    assert.equal(merged.sport, 'Badminton');
    assert.equal(merged.players, 14);
});

// --- The place in the night's order -------------------------------------------------------

test('an edit that leaves the opening alone keeps the delay already rolled', () => {
    const same = new Date('2026-09-15T22:00:00Z');
    const never = () => { throw new Error('re-rolled when it should not have'); };
    assert.equal(sendAfterForEdit(STORED, same, SETTINGS, never), STORED.send_after);
});

test('moving the entry to another midnight re-rolls the delay from the new opening', () => {
    const moved = new Date('2026-09-22T22:00:00Z');
    const sendAfter = sendAfterForEdit(STORED, moved, SETTINGS, () => 0.5);
    assert.notEqual(sendAfter, STORED.send_after);
    const offset = (sendAfter.getTime() - moved.getTime()) / 1000;
    assert.ok(offset >= SETTINGS.openingDelayMinSeconds && offset <= SETTINGS.openingDelayMaxSeconds,
        `delay ${offset}s is outside the configured bounds`);
});

test('the opening is compared as an instant, not by object identity', () => {
    // A fresh Date for the same moment must still count as unmoved.
    const equivalent = new Date(STORED.opens_at.getTime());
    const never = () => { throw new Error('re-rolled for an identical instant'); };
    assert.equal(sendAfterForEdit(STORED, equivalent, SETTINGS, never), STORED.send_after);
});
