/*
 * Validation for queued sports bookings.
 *
 * Every rule here is ported from the verified reference implementation at
 * ~/code/sports-booking-bot (booking_bot.py: validate, occurrences, fields). They are
 * the KU Leuven form's own constraints, so breaking one means a request that fails at
 * midnight instead of at the moment someone typed it.
 */

const { parseBrusselsWallTime, openingFor, brusselsDateOf } = require('./booking-time');

const DURATIONS = [1, 1.5, 2];
const MIN_PLAYERS = 10;
const LANGUAGES = ['English', 'Nederlands'];
const PLACEMENTS = ['Indoor', 'Outdoor'];
const OTHER_FACILITY = 'Andere / Other';

// These use KU Leuven's separate online booking tool, not the form this app submits.
const SPORTS_ELSEWHERE = new Set([
    'padel', 'tennis', 'tabletennis', 'tafeltennis', 'beachvolleyball', 'beachvolleybal'
]);
const BASKETBALL = new Set(['basketball', 'basketbal']);

function sportKey(sport) {
    return String(sport).toLowerCase().replace(/[ -]/g, '');
}

/**
 * Names are the identity this app counts slots against, so two spellings of one person
 * must collapse to one key: trimmed, inner whitespace collapsed, accents dropped,
 * lowercased. Deliberately NOT stripping punctuation or reordering words — that would
 * merge people who are actually different.
 */
function normalizeName(name) {
    return String(name ?? '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function validName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0 || trimmed.length > 100) return null;
    if (/<script|javascript:|onerror=|onclick=|onload=/i.test(trimmed)) return null;
    return trimmed;
}

function validEmail(email) {
    if (typeof email !== 'string') return null;
    const trimmed = email.trim();
    if (trimmed.length > 254) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

function validPhone(phone) {
    if (typeof phone !== 'string') return null;
    const trimmed = phone.trim();
    if (trimmed.length < 6 || trimmed.length > 32) return null;
    return /^[+0-9 ()./-]+$/.test(trimmed) ? trimmed : null;
}

class BookingInputError extends Error {
    constructor(message, field) {
        super(message);
        this.name = 'BookingInputError';
        this.field = field;
    }
}

function fail(message, field) {
    throw new BookingInputError(message, field);
}

/**
 * Validate a queue submission and return the normalized row to persist.
 * Throws BookingInputError with a `field` the client can highlight.
 */
function validateBooking(input = {}) {
    const name = validName(input.name);
    if (!name) fail('Name is required, up to 100 characters.', 'name');

    const email = validEmail(input.email);
    if (!email) fail('A valid email address is required — KU Leuven replies to it.', 'email');

    const phone = validPhone(input.phone);
    if (!phone) fail('A valid phone number is required by the booking form.', 'phone');

    // The form asks the requester to declare a valid sports card. This app never verifies
    // it; it only refuses to submit a declaration the requester has not actually made.
    if (input.validSportsCard !== true) {
        fail('Confirm the person booking holds a valid KU Leuven sports card.', 'validSportsCard');
    }

    const language = input.language ?? 'English';
    if (!LANGUAGES.includes(language)) fail('Language must be English or Nederlands.', 'language');

    const sport = typeof input.sport === 'string' ? input.sport.trim() : '';
    if (!sport) fail('Sport is required.', 'sport');

    const placement = input.indoorOutdoor;
    if (!PLACEMENTS.includes(placement)) fail('Choose Indoor or Outdoor.', 'indoorOutdoor');

    const key = sportKey(sport);
    if (SPORTS_ELSEWHERE.has(key) || (BASKETBALL.has(key) && placement === 'Outdoor')) {
        fail(`${sport} is booked through KU Leuven's separate online tool, not this form.`, 'sport');
    }

    // Truthfulness rule, not a form quirk: the reference implementation refuses to round up.
    const players = input.players;
    if (!Number.isInteger(players) || typeof players === 'boolean' || players < MIN_PLAYERS) {
        fail(`Players must be a truthful whole number, at least ${MIN_PLAYERS}.`, 'players');
    }
    if (players > 200) fail('Players looks wrong — check the number.', 'players');

    const duration = input.durationHours;
    if (typeof duration === 'boolean' || !DURATIONS.includes(duration)) {
        fail('Duration must be 1, 1.5 or 2 hours.', 'durationHours');
    }

    const facility = typeof input.facility === 'string' ? input.facility.trim() : '';
    const otherFacility = typeof input.otherFacility === 'string' ? input.otherFacility.trim() : '';
    if (facility === OTHER_FACILITY && !otherFacility) {
        fail('Name the facility when choosing "Andere / Other".', 'otherFacility');
    }

    const remarks = typeof input.remarks === 'string' ? input.remarks.trim() : '';
    if (remarks.length > 1000) fail('Remarks are too long.', 'remarks');

    const playDate = typeof input.playDate === 'string' ? input.playDate.trim() : '';

    let startPreferred;
    try {
        startPreferred = parseBrusselsWallTime(playDate, input.startPreferred);
    } catch (error) {
        fail(error.message, 'startPreferred');
    }

    // The form requires a second choice, and it is a different START time for the same
    // duration — not an end time. The reference refuses to build a POST without it.
    let startAlternative;
    try {
        startAlternative = parseBrusselsWallTime(input.alternativeDate || playDate, input.startAlternative);
    } catch (error) {
        fail(error.message, 'startAlternative');
    }
    if (startAlternative.getTime() === startPreferred.getTime()) {
        fail('The second choice must be a different start time.', 'startAlternative');
    }

    const opensAtInstant = openingFor(startPreferred, startAlternative);

    // Both preferences must open before the earlier of them is played.
    const earliestPlay = startPreferred <= startAlternative ? startPreferred : startAlternative;
    if (opensAtInstant >= earliestPlay) {
        fail('Those two dates are too far apart to be submitted in one request.', 'startAlternative');
    }

    return {
        sport,
        playDate: brusselsDateOf(startPreferred),
        startPreferred,
        startAlternative,
        durationHours: duration,
        players,
        indoorOutdoor: placement,
        facility,
        otherFacility: facility === OTHER_FACILITY ? otherFacility : '',
        language,
        validSportsCard: true,
        name,
        nameKey: normalizeName(name),
        email,
        phone,
        remarks,
        opensAt: opensAtInstant
    };
}

module.exports = {
    BookingInputError,
    DURATIONS,
    MIN_PLAYERS,
    LANGUAGES,
    PLACEMENTS,
    OTHER_FACILITY,
    normalizeName,
    sportKey,
    validName,
    validEmail,
    validPhone,
    validateBooking
};
