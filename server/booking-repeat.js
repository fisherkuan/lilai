/*
 * Repeats: a rule, expanded into play dates.
 *
 * A court booking is a habit — Tuesdays and Thursdays at six, all season — and typing it
 * out twenty times is how dates get wrong. The rule is entered once and expanded here into
 * ordinary dates, which are then queued as ordinary independent rows.
 *
 * The rule has three shapes, and they are genuinely different questions:
 *
 *   every N days    — a cadence. "Every third day", regardless of what day that lands on.
 *   every N weeks   — a weekday habit, on one or more chosen days of the week.
 *   every N months  — the same date each month. A month without that date is skipped, not
 *                     slid onto the 28th: a booking on the wrong day is worse than none.
 *
 * All arithmetic is plain calendar days in UTC. These are dates, not instants; adding days
 * to a Brussels wall clock is how a DST weekend quietly shifts an hour.
 */

/*
 * Two slots per person per week is the quota, so twenty-six weeks of repeat can produce at
 * most fifty-two useful bookings. The cap is that number: a guard against one click filling
 * a season, not an opinion about how often anyone may play.
 */
const MAX_OCCURRENCES = 52;
const UNITS = ['day', 'week', 'month'];
const MAX_EVERY = 12;
const DAY_MS = 86400000;

class RepeatError extends Error {
    constructor(message, field) {
        super(message);
        this.name = 'RepeatError';
        this.field = field;
    }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
    const date = new Date(ms);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** 0 = Sunday, matching Date.getUTCDay, so a weekday set needs no translation layer. */
const weekdayOf = (iso) => new Date(toUtc(iso)).getUTCDay();

/** The Monday on or before a date. Weeks run Monday-Sunday here, as the quota does. */
function mondayOf(iso) {
    const at = toUtc(iso);
    const shift = (new Date(at).getUTCDay() + 6) % 7;
    return at - shift * DAY_MS;
}

function validateRule(rule, playDate, seasonEndsOn) {
    if (!ISO.test(playDate)) {
        throw new RepeatError('Pick the first day before setting a repeat.', 'playDate');
    }

    const unit = rule.unit;
    if (!UNITS.includes(unit)) {
        throw new RepeatError('Repeat by day, week or month.', 'repeatUnit');
    }

    const every = rule.every;
    if (!Number.isInteger(every) || typeof every === 'boolean' || every < 1 || every > MAX_EVERY) {
        throw new RepeatError(`Repeat every 1 to ${MAX_EVERY} ${unit}s.`, 'repeatEvery');
    }

    const until = typeof rule.until === 'string' ? rule.until.trim() : '';
    if (!ISO.test(until)) throw new RepeatError('Say which date the repeat runs until.', 'repeatUntil');
    if (until < playDate) throw new RepeatError('The repeat ends before it starts.', 'repeatUntil');
    if (seasonEndsOn && until > seasonEndsOn) {
        throw new RepeatError(`The season this app books for ends on ${seasonEndsOn}. A repeat cannot run past it.`, 'repeatUntil');
    }

    /*
     * Weekdays belong to a weekly rule and nothing else. Silently ignoring them on a daily
     * rule would let the sheet show "Mondays" over a run that lands on every day.
     */
    let weekdays = null;
    if (unit === 'week') {
        const picked = Array.isArray(rule.weekdays) ? rule.weekdays : [];
        for (const day of picked) {
            if (!Number.isInteger(day) || day < 0 || day > 6) {
                throw new RepeatError('Weekdays must be Sunday through Saturday.', 'repeatWeekdays');
            }
        }
        // No day chosen means the one the first booking already falls on.
        weekdays = picked.length > 0 ? [...new Set(picked)].sort((a, b) => a - b) : [weekdayOf(playDate)];
    } else if (Array.isArray(rule.weekdays) && rule.weekdays.length > 0) {
        throw new RepeatError('Weekdays only apply to a weekly repeat.', 'repeatWeekdays');
    }

    return { every, unit, weekdays, until };
}

function weeklyDates(playDate, rule) {
    const dates = [];
    const last = toUtc(rule.until);
    const stride = rule.every * 7 * DAY_MS;
    const start = toUtc(playDate);
    for (let weekStart = mondayOf(playDate); weekStart <= last; weekStart += stride) {
        for (const weekday of rule.weekdays) {
            // Monday is index 0 inside the week; getUTCDay calls Sunday 0.
            const at = weekStart + ((weekday + 6) % 7) * DAY_MS;
            if (at >= start && at <= last) dates.push(at);
        }
    }
    // Weekdays are emitted week by week, so a set spanning a week boundary needs one sort.
    return dates.sort((a, b) => a - b).map(fromUtc);
}

function dailyDates(playDate, rule) {
    const dates = [];
    const last = toUtc(rule.until);
    for (let at = toUtc(playDate); at <= last; at += rule.every * DAY_MS) dates.push(fromUtc(at));
    return dates;
}

/*
 * The same date each month. February has no 31st, so a run anchored there skips February
 * rather than sliding to the 28th — a booking on a day nobody asked for is worse than a
 * gap, and the gap is visible in the preview.
 */
function monthlyDates(playDate, rule) {
    const [year, month, day] = playDate.split('-').map(Number);
    const dates = [];
    const last = toUtc(rule.until);
    for (let step = 0; ; step += 1) {
        const at = Date.UTC(year, month - 1 + step * rule.every, day);
        if (at > last) break;
        // Date.UTC rolls an impossible day into the next month; that is the skip signal.
        if (new Date(at).getUTCDate() === day) dates.push(fromUtc(at));
        if (step > 12 * MAX_EVERY) break;
    }
    return dates;
}

/**
 * Expand a repeat into the play dates it covers, the first one included.
 * Returns `[playDate]` when there is no rule.
 */
function expandRepeat(playDate, repeat, { seasonEndsOn = null, cap = MAX_OCCURRENCES } = {}) {
    if (!repeat) return [playDate];

    const rule = validateRule(repeat, playDate, seasonEndsOn);
    const dates = rule.unit === 'week' ? weeklyDates(playDate, rule)
        : rule.unit === 'day' ? dailyDates(playDate, rule)
            : monthlyDates(playDate, rule);

    /*
     * The cap refuses rather than truncating. A repeat that quietly stopped in March would
     * look exactly like one that worked, and nobody re-reads a queue they believe landed.
     */
    if (dates.length > cap) {
        throw new RepeatError(`That is ${dates.length} bookings in one go, past the limit of ${cap}. Shorten the repeat.`, 'repeatUntil');
    }
    /*
     * Only a weekly rule can come out empty — Sundays only, ending on the Wednesday — but
     * every caller indexes the first date, so an empty answer is a refusal, not a result.
     */
    if (dates.length === 0) {
        throw new RepeatError(`That repeat lands on no dates between ${playDate} and ${rule.until}. Move the end date or pick another weekday.`, 'repeatUntil');
    }
    return dates;
}

/** How a rule reads in a sentence — the board and the sheet must not word it differently. */
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeRule(rule) {
    if (!rule) return 'One-off';
    const every = rule.every === 1 ? `Every ${rule.unit}` : `Every ${rule.every} ${rule.unit}s`;
    if (rule.unit !== 'week' || !rule.weekdays || rule.weekdays.length === 0) return every;
    const days = rule.weekdays.map((day) => WEEKDAY_NAMES[day]).join(', ');
    return rule.every === 1 ? `Every week on ${days}` : `Every ${rule.every} weeks on ${days}`;
}

module.exports = {
    MAX_OCCURRENCES,
    MAX_EVERY,
    UNITS,
    WEEKDAY_NAMES,
    RepeatError,
    validateRule,
    expandRepeat,
    describeRule
};
