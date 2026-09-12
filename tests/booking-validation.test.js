const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeName, validateBooking, BookingInputError } = require('../server/booking-validation');

// A submission that passes, which each test then breaks in exactly one way.
function good(overrides = {}) {
    return {
        sport: 'Badminton',
        playDate: '2026-09-26',
        startPreferred: '18:00',
        startAlternative: '20:00',
        durationHours: 2,
        players: 12,
        indoorOutdoor: 'Indoor',
        facility: '',
        otherFacility: '',
        language: 'English',
        validSportsCard: true,
        name: 'Yuki Chen',
        email: 'yuki@student.kuleuven.be',
        phone: '+32 470 12 34 56',
        remarks: '',
        ...overrides
    };
}

function fieldOf(input) {
    try {
        validateBooking(input);
    } catch (error) {
        assert.ok(error instanceof BookingInputError, `expected BookingInputError, got ${error}`);
        return error.field;
    }
    assert.fail('expected validation to reject this submission');
}

test('a well-formed submission is accepted and normalized', () => {
    const row = validateBooking(good());
    assert.equal(row.playDate, '2026-09-26');
    assert.equal(row.nameKey, 'yuki chen');
    assert.equal(row.startPreferred.toISOString(), '2026-09-26T16:00:00.000Z');
    assert.equal(row.opensAt.toISOString(), '2026-09-11T22:00:00.000Z');
    assert.equal(row.validSportsCard, true);
});

// --- The player count is a truthfulness rule, not a form quirk -------------------------

test('fewer than ten players is refused, and never quietly rounded up', () => {
    assert.equal(fieldOf(good({ players: 9 })), 'players');
    assert.equal(fieldOf(good({ players: 4 })), 'players');
    assert.equal(validateBooking(good({ players: 10 })).players, 10);
});

test('the player count must be a whole number, and a boolean is not one', () => {
    assert.equal(fieldOf(good({ players: 10.5 })), 'players');
    assert.equal(fieldOf(good({ players: '12' })), 'players');
    assert.equal(fieldOf(good({ players: true })), 'players');
});

// --- Duration ------------------------------------------------------------------------

test('duration is exactly 1, 1.5 or 2 hours', () => {
    for (const hours of [1, 1.5, 2]) {
        assert.equal(validateBooking(good({ durationHours: hours })).durationHours, hours);
    }
    assert.equal(fieldOf(good({ durationHours: 1.25 })), 'durationHours');
    assert.equal(fieldOf(good({ durationHours: 3 })), 'durationHours');
    assert.equal(fieldOf(good({ durationHours: '2' })), 'durationHours');
    assert.equal(fieldOf(good({ durationHours: true })), 'durationHours');
});

// --- Sports that belong to KU Leuven's other tool --------------------------------------

test('sports booked through the separate online tool are refused', () => {
    for (const sport of ['Padel', 'tennis', 'Table tennis', 'tafeltennis', 'Beach volleyball']) {
        assert.equal(fieldOf(good({ sport })), 'sport', `${sport} should be refused`);
    }
});

test('basketball is indoor-only on this form', () => {
    assert.equal(fieldOf(good({ sport: 'Basketball', indoorOutdoor: 'Outdoor' })), 'sport');
    assert.equal(validateBooking(good({ sport: 'Basketball', indoorOutdoor: 'Indoor' })).sport, 'Basketball');
    // Volleyball outdoors is fine — only the beach variant goes elsewhere.
    assert.equal(validateBooking(good({ sport: 'Volleyball', indoorOutdoor: 'Outdoor' })).sport, 'Volleyball');
});

test('an empty sport is refused', () => {
    assert.equal(fieldOf(good({ sport: '   ' })), 'sport');
});

// --- Facility ------------------------------------------------------------------------

test('"Andere / Other" needs the facility named', () => {
    assert.equal(fieldOf(good({ facility: 'Andere / Other', otherFacility: '' })), 'otherFacility');
    const row = validateBooking(good({ facility: 'Andere / Other', otherFacility: 'Sportkot hall 3' }));
    assert.equal(row.otherFacility, 'Sportkot hall 3');
});

test('free text is dropped unless the facility is actually "Other"', () => {
    const row = validateBooking(good({ facility: '', otherFacility: 'leftover text' }));
    assert.equal(row.otherFacility, '');
});

// --- The two start times --------------------------------------------------------------

test('the second choice is a different start time, not the same one', () => {
    assert.equal(fieldOf(good({ startAlternative: '18:00' })), 'startAlternative');
});

test('a second choice whose window opens after the first is played is refused', () => {
    // Preferences three weeks apart can never be inside the two-week window together.
    assert.equal(fieldOf(good({ alternativeDate: '2026-10-17', startAlternative: '20:00' })), 'startAlternative');
});

test('two preferences on different days take the later opening', () => {
    const row = validateBooking(good({ alternativeDate: '2026-09-27', startAlternative: '20:00' }));
    assert.equal(row.opensAt.toISOString(), '2026-09-12T22:00:00.000Z'); // 13 Sep, not 12 Sep
    assert.equal(row.playDate, '2026-09-26'); // the play date still follows the primary
});

test('DST-invalid start times are refused with the reason', () => {
    assert.equal(fieldOf(good({ playDate: '2026-03-29', startPreferred: '02:30' })), 'startPreferred');
    assert.equal(fieldOf(good({ playDate: '2026-10-25', startPreferred: '02:30' })), 'startPreferred');
});

// --- Contact and the sports-card declaration -------------------------------------------

test('the sports card must be declared, not assumed', () => {
    assert.equal(fieldOf(good({ validSportsCard: false })), 'validSportsCard');
    assert.equal(fieldOf(good({ validSportsCard: undefined })), 'validSportsCard');
    assert.equal(fieldOf(good({ validSportsCard: 'yes' })), 'validSportsCard');
});

test('a usable email is required — it is where KU Leuven replies', () => {
    assert.equal(fieldOf(good({ email: 'yuki' })), 'email');
    assert.equal(fieldOf(good({ email: 'yuki@kuleuven' })), 'email');
    assert.equal(fieldOf(good({ email: '' })), 'email');
});

test('a name is required and is capped', () => {
    assert.equal(fieldOf(good({ name: '  ' })), 'name');
    assert.equal(fieldOf(good({ name: 'a'.repeat(101) })), 'name');
    assert.equal(fieldOf(good({ name: '<script>alert(1)</script>' })), 'name');
});

test('language is English or Nederlands, defaulting to English', () => {
    assert.equal(validateBooking(good({ language: undefined })).language, 'English');
    assert.equal(validateBooking(good({ language: 'Nederlands' })).language, 'Nederlands');
    assert.equal(fieldOf(good({ language: 'Français' })), 'language');
});

// --- Name normalization: what the two-a-week gate actually counts on ---------------------

test('spelling variants of one person collapse to one key', () => {
    const variants = ['Fisher Kuan', 'fisher kuan', '  Fisher   Kuan  ', 'FISHER KUAN', 'Fisher\tKuan'];
    const keys = new Set(variants.map(normalizeName));
    assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(' | ')}`);
    assert.equal([...keys][0], 'fisher kuan');
});

test('accents are folded so one person is not counted twice', () => {
    assert.equal(normalizeName('Chloé Dubois'), normalizeName('Chloe Dubois'));
    assert.equal(normalizeName('CHLOÉ DUBOIS'), 'chloe dubois');
});

test('CJK names survive normalization intact', () => {
    assert.equal(normalizeName('  林小明 '), '林小明');
    assert.equal(normalizeName('林小明'), normalizeName('林小明'));
});

test('different people keep different keys', () => {
    assert.notEqual(normalizeName('Fisher Kuan'), normalizeName('Fisher Kuang'));
    // Word order is NOT normalized: reordering could merge two real people.
    assert.notEqual(normalizeName('Fisher Kuan'), normalizeName('Kuan Fisher'));
});

test('the stored name keeps its display spelling while the key is folded', () => {
    const row = validateBooking(good({ name: '  Chloé   Dubois ' }));
    assert.equal(row.name, 'Chloé Dubois');
    assert.equal(row.nameKey, 'chloe dubois');
});
