/*
 * The waiting list of a full event. A name on it holds no seat; the list keeps the order
 * people joined it in, and when a place opens the first name moves up by itself, in the same
 * transaction as the change that opened it. On an approval event it moves up to the host's
 * requests ('pending'), so the host still decides.
 *
 * Every caller holds the event row's lock (SELECT … FOR UPDATE), so two changes cannot both
 * hand out the same opening.
 */

const { STATUS } = require('./event-hosting');
const activity = require('./event-activity');

// The order of the list: who joined it first, then the row id for two at the same instant.
const ORDER = 'timestamp, id';

// Where a new name goes. Once anyone waits, newcomers queue behind them even when the host's
// requests leave a seat free, so nobody overtakes the list.
function joinStatus({ limit, approval, taken, waiting }) {
    if (waiting > 0 || (limit !== null && limit !== undefined && taken >= limit)) return STATUS.WAITING;
    return approval ? STATUS.PENDING : STATUS.YES;
}

// How many names move up now; Infinity without a limit. On an approval event the open
// requests count against the free seats: the host has that many people to choose from already.
function openings({ limit, approval, taken, asking }) {
    if (limit === null || limit === undefined) return Infinity;
    return Math.max(0, limit - taken - (approval ? asking : 0));
}

// "1st", "2nd", "3rd", "11th", "22nd".
function ordinal(n) {
    const teen = n % 100 >= 11 && n % 100 <= 13;
    const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return `${n}${suffix}`;
}

async function counts(db, eventId) {
    const result = await db.query(
        `SELECT COUNT(*) FILTER (WHERE attendance = 'yes')::int AS taken,
                COUNT(*) FILTER (WHERE attendance = 'pending')::int AS asking,
                COUNT(*) FILTER (WHERE attendance = 'waiting')::int AS waiting
         FROM rsvps WHERE event_id = $1`,
        [eventId]
    );
    return result.rows[0];
}

// A name's place on the list, from 1; null when it is not on it.
async function positionOf(db, eventId, name) {
    const result = await db.query(
        `SELECT attendee_name FROM rsvps WHERE event_id = $1 AND attendance = 'waiting' ORDER BY ${ORDER}`,
        [eventId]
    );
    const index = result.rows.findIndex(r => r.attendee_name === name);
    return index < 0 ? null : index + 1;
}

// Move the first names up into whatever opened. `event` is the locked row as it now stands.
// Returns the names that moved, in list order.
async function promote(db, event) {
    const free = openings({ limit: event.attendance_limit, approval: event.approval_required, ...(await counts(db, event.id)) });
    if (free === 0) return [];
    const next = await db.query(
        `SELECT id, attendee_name FROM rsvps WHERE event_id = $1 AND attendance = 'waiting' ORDER BY ${ORDER} LIMIT $2`,
        [event.id, Number.isFinite(free) ? free : null]
    );
    if (next.rows.length === 0) return [];
    const to = event.approval_required ? STATUS.PENDING : STATUS.YES;
    await db.query('UPDATE rsvps SET attendance = $1 WHERE id = ANY($2)', [to, next.rows.map(r => r.id)]);
    for (const row of next.rows) {
        await activity.logActivity(db, event.id, 'promoted', { name: row.attendee_name, detail: to === STATUS.PENDING ? 'asking' : null });
    }
    return next.rows.map(r => r.attendee_name);
}

module.exports = { ORDER, joinStatus, openings, ordinal, counts, positionOf, promote };
