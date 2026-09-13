/*
 * A recurring schedule, as a thing you can act on.
 *
 * The first cut of repeats deliberately kept no series record: every occurrence was an
 * ordinary row, and that is still true — each one edits, cancels and counts against its own
 * week exactly like a one-off. What was missing is the handle. "Cancel the rest of the
 * Tuesday badminton" is a single intent, and without a series it meant clicking Cancel
 * eleven times and hoping none were missed.
 *
 * So the series is a LABEL on rows, not their owner. Deleting it cancels nothing; cancelling
 * every remaining occurrence leaves the series visible with nothing left to cancel. The rows
 * stay the truth, which is what keeps history honest.
 */

const { describeRule } = require('./booking-repeat');

const TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS booking_series (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        name_key VARCHAR(255) NOT NULL,
        profile_id VARCHAR(255),
        sport VARCHAR(255) NOT NULL,
        every INTEGER NOT NULL,
        unit VARCHAR(16) NOT NULL,
        weekdays INTEGER[],
        starts_on DATE NOT NULL,
        until DATE NOT NULL,
        start_preferred VARCHAR(5) NOT NULL,
        start_alternative VARCHAR(5) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT booking_series_unit CHECK (unit IN ('day', 'week', 'month'))
    );
`;

/*
 * ON DELETE SET NULL, like profile_id: removing the schedule from the list must never take
 * a queued request with it. The row keeps everything it needs to be submitted.
 */
const LINK_SQL = `
    ALTER TABLE booking_queue
    ADD COLUMN IF NOT EXISTS series_id VARCHAR(255)
    REFERENCES booking_series(id) ON DELETE SET NULL;
`;

const INDEX_SQL = [
    'CREATE INDEX IF NOT EXISTS idx_booking_queue_series ON booking_queue(series_id)'
];

async function createSeriesSchema(client) {
    await client.query(TABLE_SQL);
    await client.query(LINK_SQL);
    for (const sql of INDEX_SQL) await client.query(sql);
}

/*
 * Statuses that a "cancel the rest" may still touch. Only `queued`: once the scheduler has
 * claimed a row it is in flight or already answered, and a bulk action must not pretend
 * otherwise. The count of what it could NOT touch is reported alongside.
 */
const CANCELLABLE = ['queued'];

/** The shape the board reads: the rule, plus what became of it. */
function toSeriesView(row) {
    const rule = {
        every: row.every,
        unit: row.unit,
        weekdays: row.weekdays || null
    };
    return {
        id: row.id,
        name: row.name,
        profileId: row.profile_id || null,
        sport: row.sport,
        rule,
        summary: describeRule(rule),
        startsOn: row.starts_on,
        until: row.until,
        startPreferred: row.start_preferred,
        startAlternative: row.start_alternative,
        createdAt: row.created_at,
        queued: Number(row.queued || 0),
        sent: Number(row.sent || 0),
        cancelled: Number(row.cancelled || 0),
        // The next occurrence still owed a submission, so the card can say when it acts.
        nextOpensAt: row.next_opens_at || null,
        nextPlayDate: row.next_play_date || null,
        lastCancelledAt: row.last_cancelled_at || null
    };
}

/*
 * One query, counting rows by outcome per series. A series with nothing left to send is
 * still listed — it is the record of a habit, and its history is the point.
 *
 * The board and the edit sheet read the same shape, so the tallies they show cannot drift:
 * one `where` for the list, another for a single schedule, and nothing else differs.
 */
const selectSeries = (where) => `
    SELECT s.*,
           COUNT(q.id) FILTER (WHERE q.status IN ('queued', 'sending'))                 AS queued,
           COUNT(q.id) FILTER (WHERE q.status IN ('sent', 'unconfirmed'))               AS sent,
           COUNT(q.id) FILTER (WHERE q.status IN ('cancelled', 'failed', 'missed'))     AS cancelled,
           MIN(q.opens_at)  FILTER (WHERE q.status = 'queued')                          AS next_opens_at,
           MIN(q.play_date) FILTER (WHERE q.status = 'queued')                          AS next_play_date,
           -- The most recent cancellation, so the card can offer "Undo all" for as long as
           -- a single row would offer its own Undo, and not a second longer.
           MAX(q.cancelled_at) FILTER (WHERE q.status = 'cancelled')                    AS last_cancelled_at
    FROM booking_series s
    LEFT JOIN booking_queue q ON q.series_id = s.id
    ${where}
    GROUP BY s.id
    ORDER BY s.created_at DESC
`;

const LIST_SQL = selectSeries('');
const ONE_SQL = selectSeries('WHERE s.id = $1');

module.exports = {
    TABLE_SQL,
    LINK_SQL,
    INDEX_SQL,
    LIST_SQL,
    ONE_SQL,
    CANCELLABLE,
    createSeriesSchema,
    toSeriesView
};
