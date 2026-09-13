const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULTS, bookingSettings, sampleSendAfter, graceDeadline } = require('../server/booking-settings');

test('defaults match the verified reference implementation', () => {
    assert.deepEqual(bookingSettings({}), {
        openingDelayMinSeconds: 5,
        openingDelayMaxSeconds: 60,
        minimumRequestIntervalSeconds: 10,
        lateSubmissionGraceSeconds: 300,
        cancelUndoSeconds: 300,
        seasonEndsOn: null
    });
});

test('the season end is a date, and an absent one caps nothing', () => {
    assert.equal(bookingSettings({ booking: { seasonEndsOn: '2027-09-30' } }).seasonEndsOn, '2027-09-30');
    assert.equal(bookingSettings({ booking: { seasonEndsOn: null } }).seasonEndsOn, null);
    assert.throws(() => bookingSettings({ booking: { seasonEndsOn: '30-09-2027' } }), /YYYY-MM-DD/);
    assert.throws(() => bookingSettings({ booking: { seasonEndsOn: 20270930 } }), /YYYY-MM-DD/);
});

test('config overrides are merged over the defaults', () => {
    const settings = bookingSettings({ booking: { openingDelayMaxSeconds: 45 } });
    assert.equal(settings.openingDelayMaxSeconds, 45);
    assert.equal(settings.openingDelayMinSeconds, DEFAULTS.openingDelayMinSeconds);
});

test('delay bounds must be ordered and inside the grace window', () => {
    assert.throws(() => bookingSettings({ booking: { openingDelayMinSeconds: 90, openingDelayMaxSeconds: 30 } }),
        /ordered/);
    assert.throws(() => bookingSettings({ booking: { openingDelayMinSeconds: -1 } }), /ordered/);
    // A delay past the grace window would push every entry beyond its own deadline.
    assert.throws(() => bookingSettings({ booking: { openingDelayMaxSeconds: 400 } }), /ordered/);
});

test('the pacing interval has a floor of ten seconds', () => {
    assert.throws(() => bookingSettings({ booking: { minimumRequestIntervalSeconds: 9 } }), /at least 10/);
    assert.equal(bookingSettings({ booking: { minimumRequestIntervalSeconds: 10 } }).minimumRequestIntervalSeconds, 10);
});

test('non-integer settings are refused', () => {
    assert.throws(() => bookingSettings({ booking: { lateSubmissionGraceSeconds: 300.5 } }), /whole number/);
    assert.throws(() => bookingSettings({ booking: { openingDelayMinSeconds: '5' } }), /whole number/);
    assert.throws(() => bookingSettings({ booking: { openingDelayMinSeconds: true } }), /whole number/);
});

test('the sampled send time lands inside the configured delay range, inclusive', () => {
    const settings = bookingSettings({});
    const opensAt = new Date('2026-09-11T22:00:00.000Z');

    assert.equal(sampleSendAfter(opensAt, settings, () => 0).toISOString(), '2026-09-11T22:00:05.000Z');
    // Math.random() never returns 1, so the top of the range needs the nearest value below it.
    assert.equal(sampleSendAfter(opensAt, settings, () => 0.9999999).toISOString(), '2026-09-11T22:01:00.000Z');

    for (let i = 0; i < 500; i += 1) {
        const offset = (sampleSendAfter(opensAt, settings).getTime() - opensAt.getTime()) / 1000;
        assert.ok(offset >= 5 && offset <= 60, `sampled ${offset}s, outside 5-60`);
        assert.ok(Number.isInteger(offset), `sampled ${offset}s, not a whole second`);
    }
});

test('the grace deadline is the opening plus the grace window', () => {
    const opensAt = new Date('2026-09-11T22:00:00.000Z');
    assert.equal(graceDeadline(opensAt, bookingSettings({})).toISOString(), '2026-09-11T22:05:00.000Z');
});
