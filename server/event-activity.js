/*
 * What happened to an event, newest first: who joined, asked, left or was removed, and what
 * the host changed. The management page shows it beside the event on a laptop.
 *
 * A row is written in the same transaction as the change it records, so the log never
 * claims something that rolled back. Nobody signs in, so a row names the person a change
 * was about, never who made it: "the host" is whoever holds the management link.
 */

const KINDS = [
    'created',   // the event was made
    'joined',    // took a place (RSVP, or the host joining at creation)
    'asked',     // asked to join an approval-only event
    'left',      // cancelled their own place
    'accepted',  // the host gave a request a place
    'declined',  // the host turned a request down
    'removed',   // the host took away a place
    'readded',   // the host gave a declined person a place after all
    'reasked',   // the host put a declined person back among the requests
    'listed',    // joined the waiting list of a full event
    'leftlist',  // took their own name off the waiting list
    'promoted',  // moved up from the waiting list when a place opened; `detail` 'asking' on an approval event
    'movedin',   // the host gave someone on the waiting list a place by hand
    'delisted',  // the host took someone off the waiting list
    'relisted',  // the host put a declined person back on the waiting list
    'edited',    // the host changed details; `detail` lists what
    'cancelled',
    'restored'
];

// Which kind a host decision on an RSVP records, from its status before and after.
function decisionKind(from, to) {
    if (from === to) return null;
    if (to === 'yes') return from === 'declined' ? 'readded' : from === 'waiting' ? 'movedin' : 'accepted';
    if (to === 'declined') return from === 'yes' ? 'removed' : from === 'waiting' ? 'delisted' : 'declined';
    if (to === 'pending') return 'reasked';
    if (to === 'waiting') return 'relisted';
    return null;
}

const FIELD_LABELS = {
    title: 'title',
    date: 'day',
    start: 'start',
    end: 'end',
    location: 'place',
    description: 'details',
    links: 'links',
    limit: 'places',
    approval: 'who gets a place'
};

// What an edit changed, as labels in form order, from two hosting.formValues() results.
function changedFields(before, after) {
    return Object.keys(FIELD_LABELS)
        .filter(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
        .map(key => FIELD_LABELS[key]);
}

async function createActivitySchema(client) {
    const existed = (await client.query("SELECT to_regclass('event_activity') AS t")).rows[0].t !== null;
    await client.query(`
        CREATE TABLE IF NOT EXISTS event_activity (
            id BIGSERIAL PRIMARY KEY,
            event_id VARCHAR(255) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            kind VARCHAR(20) NOT NULL,
            name VARCHAR(255),
            detail TEXT
        )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS event_activity_event_at ON event_activity (event_id, at DESC)');
    if (existed) return 0;
    // Once, when the table is new: the places and requests already on file become the log's
    // first rows, at the time each was made, so a live event does not open on an empty history.
    // A declined row's timestamp is when the person asked or joined, not when they were turned
    // away, so declines, removals and departures before today stay unknown rather than misdated.
    const seeded = await client.query(`
        INSERT INTO event_activity (event_id, at, kind, name)
        SELECT event_id, timestamp, CASE attendance WHEN 'yes' THEN 'joined' ELSE 'asked' END, attendee_name
        FROM rsvps WHERE event_id IS NOT NULL AND attendance IN ('yes', 'pending')
    `);
    return seeded.rowCount;
}

async function logActivity(db, eventId, kind, { name = null, detail = null } = {}) {
    if (!KINDS.includes(kind)) throw new Error(`Unknown activity kind: ${kind}`);
    await db.query(
        'INSERT INTO event_activity (event_id, kind, name, detail) VALUES ($1, $2, $3, $4)',
        [eventId, kind, name, detail]
    );
}

async function listActivity(db, eventId, limit = 200) {
    const rows = await db.query(
        'SELECT id, at, kind, name, detail FROM event_activity WHERE event_id = $1 ORDER BY at DESC, id DESC LIMIT $2',
        [eventId, limit]
    );
    return rows.rows.map(r => ({ id: String(r.id), at: r.at, kind: r.kind, name: r.name, detail: r.detail }));
}

module.exports = { KINDS, decisionKind, changedFields, createActivitySchema, logActivity, listActivity };
