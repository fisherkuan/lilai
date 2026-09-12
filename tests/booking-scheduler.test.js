const test = require('node:test');
const assert = require('node:assert/strict');

const { dueState } = require('../server/booking-scheduler');

const GRACE = 300;

function entry({ opensAt, play = '2026-10-01T16:00:00.000Z', alt = '2026-10-01T18:00:00.000Z' }) {
    return { opens_at: opensAt, start_preferred: play, start_alternative: alt };
}

const OPENS = '2026-09-17T22:00:00.000Z'; // 18 Sep, 00:00 Brussels

test('before its opening an entry is waiting', () => {
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T21:59:59Z'), GRACE), 'waiting');
});

test('an entry is due from the opening instant', () => {
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date(OPENS), GRACE), 'due');
});

test('an entry stays due for the whole grace window — this is what makes recovery stateless', () => {
    // Any process alive inside these five minutes picks the entry up through the ordinary
    // check, so a restart across midnight costs nothing and needs no catch-up path.
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T22:04:59Z'), GRACE), 'due');
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T22:05:00Z'), GRACE), 'due');
});

test('past the grace window it is missed, never submitted late', () => {
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T22:05:01Z'), GRACE), 'missed');
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-18T09:00:00Z'), GRACE), 'missed');
});

test('a slot whose own start time has passed is missed, even while still inside the grace', () => {
    // Opening late enough that the 24h grace is still running when kick-off arrives, so
    // only the play-time rule can be what expires this entry.
    const late = entry({ opensAt: '2026-09-30T22:00:00.000Z' });
    const generous = 86400;
    assert.equal(dueState(late, new Date('2026-10-01T15:59:00Z'), generous), 'due');
    assert.equal(dueState(late, new Date('2026-10-01T16:00:00Z'), generous), 'missed');
});

test('the earlier of the two preferences is the one that expires the entry', () => {
    // The alternative is earlier here, so it decides.
    const swapped = entry({
        opensAt: '2026-09-30T22:00:00.000Z',
        play: '2026-10-01T18:00:00.000Z',
        alt: '2026-10-01T16:00:00.000Z'
    });
    assert.equal(dueState(swapped, new Date('2026-10-01T15:59:00Z'), 86400), 'due');
    assert.equal(dueState(swapped, new Date('2026-10-01T16:00:00Z'), 86400), 'missed');
});

test('a grace of zero leaves exactly the opening instant', () => {
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date(OPENS), 0), 'due');
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T22:00:01Z'), 0), 'missed');
});

test('a missing alternative falls back to the preferred start', () => {
    const single = {
        opens_at: '2026-09-30T22:00:00.000Z',
        start_preferred: '2026-10-01T16:00:00.000Z',
        start_alternative: null
    };
    assert.equal(dueState(single, new Date('2026-10-01T15:00:00Z'), 86400), 'due');
    assert.equal(dueState(single, new Date('2026-10-01T16:00:01Z'), 86400), 'missed');
});
