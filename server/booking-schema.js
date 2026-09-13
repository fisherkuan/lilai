/*
 * Schema for the sports booking queue.
 *
 * Lives in its own module so the server and the integration tests apply byte-identical
 * DDL — a test against a schema that has drifted from production proves nothing.
 * Idempotent, like every other migration here: it runs on each boot.
 */

const pgTypes = require('pg').types;

/*
 * Read DATE columns as the plain 'YYYY-MM-DD' string they are.
 *
 * By default pg parses a DATE into a JS Date at LOCAL midnight, so in Brussels
 * 2026-10-01 becomes 2026-09-30T22:00:00Z and any later .toISOString().slice(0,10)
 * reports the day before. play_date is a calendar day, not an instant; keeping it a
 * string removes the whole class of off-by-one.
 */
const PG_DATE_OID = 1082;
pgTypes.setTypeParser(PG_DATE_OID, (value) => value);

const TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS booking_queue (
        id VARCHAR(255) PRIMARY KEY,
        sport VARCHAR(255) NOT NULL,
        play_date DATE NOT NULL,
        start_preferred TIMESTAMPTZ NOT NULL,
        start_alternative TIMESTAMPTZ NOT NULL,
        duration_hours NUMERIC(2,1) NOT NULL,
        players INTEGER NOT NULL,
        indoor_outdoor VARCHAR(16) NOT NULL,
        facility VARCHAR(255) NOT NULL DEFAULT '',
        other_facility VARCHAR(255) NOT NULL DEFAULT '',
        language VARCHAR(32) NOT NULL DEFAULT 'English',
        valid_sports_card BOOLEAN NOT NULL DEFAULT FALSE,
        name VARCHAR(255) NOT NULL,
        name_key VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(64) NOT NULL,
        remarks TEXT NOT NULL DEFAULT '',
        queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        queued_by VARCHAR(255),
        opens_at TIMESTAMPTZ NOT NULL,
        send_after TIMESTAMPTZ NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        submitted_at TIMESTAMPTZ,
        response_note TEXT,
        cancelled_by VARCHAR(255),
        cancelled_at TIMESTAMPTZ,
        CONSTRAINT booking_queue_players_min CHECK (players >= 10),
        CONSTRAINT booking_queue_duration CHECK (duration_hours IN (1, 1.5, 2)),
        CONSTRAINT booking_queue_status CHECK (status IN
            ('queued', 'sending', 'sent', 'unconfirmed', 'failed', 'missed', 'cancelled'))
    );
`;

/*
 * When a cancellation happened, so the board can offer Undo for a short while and then let
 * the row go. Added separately because the table predates it; the column is nullable and
 * every historical cancellation simply has none, which reads correctly as "long over".
 */
const CANCELLED_AT_SQL = `
    ALTER TABLE booking_queue ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
`;

const INDEX_SQL = [
    // The scheduler's hot path: everything still owed a submission, in send order.
    'CREATE INDEX IF NOT EXISTS idx_booking_queue_due ON booking_queue(status, send_after)',
    // The quota check: one name's slots inside a Monday-Sunday play week.
    'CREATE INDEX IF NOT EXISTS idx_booking_queue_quota ON booking_queue(name_key, play_date)',
    'CREATE INDEX IF NOT EXISTS idx_booking_queue_opens ON booking_queue(opens_at)'
];

async function createBookingSchema(client) {
    await client.query(TABLE_SQL);
    await client.query(CANCELLED_AT_SQL);
    for (const sql of INDEX_SQL) {
        await client.query(sql);
    }
}

module.exports = { TABLE_SQL, CANCELLED_AT_SQL, INDEX_SQL, createBookingSchema };
