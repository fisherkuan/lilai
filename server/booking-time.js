/*
 * Europe/Brussels calendar arithmetic for the sports booking queue.
 *
 * Ported from the verified reference implementation at ~/code/sports-booking-bot
 * (booking_bot.py: local_datetime, opens_at, Booking.opening). The rules that matter:
 *
 *   - Booking times are Brussels wall times to minute precision. Ambiguous times (the
 *     hour that repeats when DST ends) and nonexistent times (the hour skipped when DST
 *     starts) are rejected rather than guessed.
 *   - A slot opens at 00:00 Brussels, 14 calendar days before the play date.
 *   - When a request carries two preferred start times, it can only go out once BOTH are
 *     inside the two-week window, so the opening is the later of the two.
 *
 * No dependencies: Intl carries the IANA rules, including historical ones.
 */

const BRUSSELS = 'Europe/Brussels';
const WINDOW_DAYS = 14;

const partsFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: BRUSSELS,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
});

// The wall-clock reading in Brussels at a given instant.
function zonedParts(instantMs) {
    const parts = {};
    for (const part of partsFormat.formatToParts(new Date(instantMs))) {
        if (part.type !== 'literal') parts[part.type] = part.value;
    }
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        // Some ICU builds render midnight as hour 24 under hour12:false.
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        second: Number(parts.second)
    };
}

// Brussels' UTC offset in ms at a given instant (+2h in summer, +1h in winter).
function offsetMsAt(instantMs) {
    const p = zonedParts(instantMs);
    const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Turn a Brussels wall time into a UTC instant.
 * Throws on the DST gap (nonexistent) and the DST overlap (ambiguous), matching the
 * reference implementation's refusal to guess which side of a transition was meant.
 */
function brusselsWallTimeToUtc(year, month, day, hour, minute) {
    const stamp = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        + `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    // Reject 31 February before any timezone work: Date.UTC would silently roll it over
    // into March, and the reader would then get a confusing DST error instead.
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        throw new Error(`No such date: ${stamp.slice(0, 10)}`);
    }

    const naive = Date.UTC(year, month - 1, day, hour, minute);

    // Probe a day either side so both offsets around a transition are considered. Taking
    // the offset only at `naive` misses the repeated hour: both probes land after the
    // change and agree, and the ambiguity goes unnoticed.
    const offsets = new Set([
        offsetMsAt(naive - 86400000),
        offsetMsAt(naive),
        offsetMsAt(naive + 86400000)
    ]);

    const readsBack = (instantMs) => {
        const p = zonedParts(instantMs);
        return p.year === year && p.month === month && p.day === day
            && p.hour === hour && p.minute === minute;
    };

    const candidates = [...new Set([...offsets].map((offset) => naive - offset))].filter(readsBack);

    if (candidates.length === 0) {
        throw new Error(`Nonexistent local time (clocks skip it when DST starts): ${stamp}`);
    }
    if (candidates.length > 1) {
        throw new Error(`Ambiguous local time (it happens twice when DST ends): ${stamp}`);
    }
    return new Date(candidates[0]);
}

// "YYYY-MM-DD" + "HH:MM" -> Date. Rejects anything not at minute precision.
function parseBrusselsWallTime(dateText, timeText) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText ?? '').trim());
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeText ?? '').trim());
    if (!dateMatch) throw new Error(`Date must be YYYY-MM-DD: ${dateText}`);
    if (!timeMatch) throw new Error(`Time must be HH:MM in Brussels local time: ${timeText}`);

    const [, y, mo, d] = dateMatch.map(Number);
    const [, h, mi] = timeMatch.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`Date out of range: ${dateText}`);
    if (h > 23 || mi > 59) throw new Error(`Time out of range: ${timeText}`);

    return brusselsWallTimeToUtc(y, mo, d, h, mi);
}

// The Brussels calendar date of an instant, as "YYYY-MM-DD".
function brusselsDateOf(instant) {
    const p = zonedParts(instant instanceof Date ? instant.getTime() : instant);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// The wall time of an instant, as "HH:MM". Used to build the form payload.
function brusselsTimeOf(instant) {
    const p = zonedParts(instant instanceof Date ? instant.getTime() : instant);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// The exact string the KU Leuven form wants: local wall time, no offset.
function formStamp(instant) {
    return `${brusselsDateOf(instant)}T${brusselsTimeOf(instant)}`;
}

/** Midnight Brussels, 14 calendar days before the play date of this start time. */
function opensAt(startInstant) {
    const playDate = brusselsDateOf(startInstant);
    return openingForPlayDate(playDate);
}

/** Same, from a plain "YYYY-MM-DD" play date. */
function openingForPlayDate(playDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(playDate ?? '').trim());
    if (!match) throw new Error(`Play date must be YYYY-MM-DD: ${playDate}`);
    const [, y, mo, d] = match.map(Number);

    // Shift the calendar date in UTC, where days are always 24h, then read it back out.
    const shifted = new Date(Date.UTC(y, mo - 1, d) - WINDOW_DAYS * 86400000);
    const openDate = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;

    // Brussels never transitions at midnight, so this is always unambiguous.
    return parseBrusselsWallTime(openDate, '00:00');
}

/**
 * When a request can go out: both preferred start times must be inside the window,
 * so the later opening wins (Booking.opening in the reference implementation).
 */
function openingFor(primaryInstant, alternativeInstant) {
    const primaryOpen = opensAt(primaryInstant);
    if (!alternativeInstant) return primaryOpen;
    const alternativeOpen = opensAt(alternativeInstant);
    return primaryOpen >= alternativeOpen ? primaryOpen : alternativeOpen;
}

/** Monday–Sunday of the week containing a "YYYY-MM-DD" play date. */
function weekBounds(playDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(playDate ?? '').trim());
    if (!match) throw new Error(`Play date must be YYYY-MM-DD: ${playDate}`);
    const [, y, mo, d] = match.map(Number);

    const noon = Date.UTC(y, mo - 1, d);
    const weekday = new Date(noon).getUTCDay();       // 0 = Sunday
    const sinceMonday = (weekday + 6) % 7;            // 0 = Monday
    const monday = new Date(noon - sinceMonday * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);

    const iso = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return { start: iso(monday), end: iso(sunday) };
}

module.exports = {
    BRUSSELS,
    WINDOW_DAYS,
    brusselsWallTimeToUtc,
    parseBrusselsWallTime,
    brusselsDateOf,
    brusselsTimeOf,
    formStamp,
    opensAt,
    openingForPlayDate,
    openingFor,
    weekBounds
};
