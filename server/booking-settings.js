/*
 * Timing settings for the booking queue, ported from the verified reference
 * implementation at ~/code/sports-booking-bot (booking_bot.py: timing_settings).
 *
 * Why these numbers exist:
 *   - The random opening delay keeps submissions from arriving as a scripted flood the
 *     instant the window opens.
 *   - The minimum interval paces our own requests against each other.
 *   - The grace window is what makes recovery stateless: any process alive within it
 *     picks a due entry up through the ordinary check, so a restart across midnight
 *     costs nothing. Past it, an entry is missed rather than silently submitted late.
 */

const DEFAULTS = {
    openingDelayMinSeconds: 5,
    openingDelayMaxSeconds: 60,
    minimumRequestIntervalSeconds: 10,
    lateSubmissionGraceSeconds: 300
};

function isWholeNumber(value) {
    return Number.isInteger(value) && typeof value !== 'boolean';
}

/** Read and validate the `booking` section of config/app.json. Throws on nonsense. */
function bookingSettings(appConfig = {}) {
    const settings = { ...DEFAULTS, ...(appConfig.booking || {}) };

    for (const [key, value] of Object.entries(settings)) {
        if (!isWholeNumber(value)) throw new Error(`booking.${key} must be a whole number of seconds`);
    }

    const { openingDelayMinSeconds: low, openingDelayMaxSeconds: high } = settings;
    const { minimumRequestIntervalSeconds: gap, lateSubmissionGraceSeconds: grace } = settings;

    if (grace < 0 || grace > 86400) {
        throw new Error('booking.lateSubmissionGraceSeconds must be between 0 and 86400');
    }
    // A delay longer than the grace window would push every entry past its own deadline.
    if (!(low >= 0 && low <= high && high <= grace)) {
        throw new Error('booking delay bounds must be ordered, nonnegative, and within the grace window');
    }
    if (gap < 10) {
        throw new Error('booking.minimumRequestIntervalSeconds must be at least 10');
    }
    return settings;
}

/**
 * Pick the moment an entry may be submitted: its opening plus an independent random
 * delay. Sampled ONCE when the entry is queued and never re-rolled, so a restart cannot
 * move an entry's place in the night's order.
 */
function sampleSendAfter(opensAt, settings, random = Math.random) {
    const { openingDelayMinSeconds: low, openingDelayMaxSeconds: high } = settings;
    const seconds = low + Math.floor(random() * (high - low + 1));
    return new Date(opensAt.getTime() + seconds * 1000);
}

/** The last moment an entry may still go out. */
function graceDeadline(opensAt, settings) {
    return new Date(opensAt.getTime() + settings.lateSubmissionGraceSeconds * 1000);
}

module.exports = { DEFAULTS, bookingSettings, sampleSendAfter, graceDeadline };
