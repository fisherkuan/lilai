/*
 * Repeats: the same slot, every week, typed once.
 *
 * A court booking is a weekday habit — Tuesday at six, all season — and typing it out
 * fourteen times is how dates get wrong. A repeat is expanded here into ordinary dates and
 * then queued as ordinary independent rows. There is deliberately no series record: every
 * occurrence edits, cancels, duplicates and shows exactly like any other entry, which is
 * worth more on a board this small than being able to change a series in one go.
 */

const MAX_OCCURRENCES = 26;
const INTERVALS = [7, 14, 21, 28];

class RepeatError extends Error {
    constructor(message, field) {
        super(message);
        this.name = 'RepeatError';
        this.field = field;
    }
}

function toUtc(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
    const date = new Date(ms);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Expand a repeat into the play dates it covers, the first one included.
 *
 * Whole weeks only, so every occurrence lands on the same weekday — which is the thing a
 * repeat is actually for. Plain calendar arithmetic in UTC: these are dates, not instants,
 * and adding days to a Brussels wall clock is how a DST weekend shifts an hour.
 */
function expandRepeat(playDate, repeat, { seasonEndsOn = null, cap = MAX_OCCURRENCES } = {}) {
    if (!repeat) return [playDate];

    // Repeating counts forward from the first date, so a malformed one has to be caught
    // here rather than producing an empty run that looks like "nothing to queue".
    if (!/^\d{4}-\d{2}-\d{2}$/.test(playDate)) {
        throw new RepeatError('Pick the first day before setting a repeat.', 'playDate');
    }

    const every = repeat.every;
    if (!INTERVALS.includes(every)) {
        throw new RepeatError('A repeat runs in whole weeks, up to four apart.', 'repeat');
    }

    const until = typeof repeat.until === 'string' ? repeat.until.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
        throw new RepeatError('Say which date the repeat runs until.', 'repeatUntil');
    }
    if (until < playDate) {
        throw new RepeatError('The repeat ends before it starts.', 'repeatUntil');
    }
    if (seasonEndsOn && until > seasonEndsOn) {
        throw new RepeatError(`The season this app books for ends on ${seasonEndsOn}. A repeat cannot run past it.`, 'repeatUntil');
    }

    const dates = [];
    const last = toUtc(until);
    for (let at = toUtc(playDate); at <= last; at += every * 86400000) {
        dates.push(fromUtc(at));
        /*
         * The cap is a guard against one click filling a season, not a rule about how often
         * anyone may play. It refuses rather than silently truncating: a repeat that quietly
         * stopped in March would look like it worked.
         */
        if (dates.length > cap) {
            throw new RepeatError(`That is more than ${cap} bookings in one go. Shorten the repeat.`, 'repeatUntil');
        }
    }
    return dates;
}

module.exports = { MAX_OCCURRENCES, INTERVALS, RepeatError, expandRepeat };
