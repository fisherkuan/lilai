/*
 * Taking a Google calendar over, once.
 *
 * Before Lilai owned events, it read each calendar's public feed into rows named
 * cal-<iCal UID>, and RSVPs hang off those rows. The import lists the calendar through the API
 * and lands every Google event on the same row, now marked `managed`. A past event is left as
 * Google has it; an upcoming one is published once, so its copy loses the old settings lines
 * and gains the way back to Lilai. From then on the feed is never read for that calendar, and
 * Lilai's publisher writes Google instead.
 *
 * An unmanaged row of the calendar that Google no longer lists was deleted there; the feed
 * would have dropped it, so the import does too. A managed row is Lilai's and is never touched.
 *
 * The "limit: N" and "link: URL" lines that old descriptions carried move into their own
 * fields here, once (convertLegacyDescription).
 */

const { convertLegacyDescription } = require('./event-hosting');
const { parseBrusselsWallTime } = require('./booking-time');

// One Google event -> the row Lilai keeps, or null for one it does not keep.
function rowFromGoogleEvent(gev, calendarId, sanitize = (s) => s) {
    if (!gev || gev.status === 'cancelled' || !gev.start) return null;
    const instant = (when) => {
        if (!when) return null;
        if (when.dateTime) return new Date(when.dateTime);
        if (when.date) return parseBrusselsWallTime(when.date, '00:00'); // an all-day event
        return null;
    };
    const start = instant(gev.start);
    if (!start || Number.isNaN(start.getTime())) return null;
    // The iCal UID is what the old feed keyed rows on. A repeating event's instances share
    // one UID, so each instance is keyed by its own Google id instead.
    const id = gev.recurringEventId ? `cal-${gev.id}@google.com` : `cal-${gev.iCalUID || `${gev.id}@google.com`}`;
    const legacy = convertLegacyDescription(sanitize(gev.description || ''));
    return {
        id,
        title: (gev.summary || '').trim() || '(No title)',
        date: start,
        endDate: instant(gev.end),
        description: legacy.description || null,
        location: (gev.location || '').trim() || null,
        source: calendarId,
        googleEventId: gev.id,
        googleLink: gev.htmlLink || null,
        legacyLimit: legacy.limit,
        legacyLink: legacy.link
    };
}

/*
 * Import one calendar. Returns { imported, removed }. Throws if Google cannot be listed, so the
 * caller retries later; nothing is marked imported until the listing is complete.
 */
async function importCalendar({ pool, googleCalendar, calendarId, sanitize }) {
    const items = await googleCalendar.listEvents(calendarId);
    const rows = [];
    const seen = new Set();
    for (const gev of items) {
        const row = rowFromGoogleEvent(gev, calendarId, sanitize);
        if (!row || seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const row of rows) {
            await client.query(
                `INSERT INTO events (id, title, date, endDate, description, location, source, attendance_limit, links,
                                     managed, google_calendar_id, google_event_id, google_link,
                                     version, synced_version, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $7, $10, $11,
                         CASE WHEN $3::timestamptz > NOW() THEN 2 ELSE 1 END, 1, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title, date = EXCLUDED.date, endDate = EXCLUDED.endDate,
                    description = EXCLUDED.description, location = EXCLUDED.location, source = EXCLUDED.source,
                    attendance_limit = COALESCE(events.attendance_limit, EXCLUDED.attendance_limit),
                    links = CASE WHEN events.links = '[]'::jsonb THEN EXCLUDED.links ELSE events.links END,
                    managed = TRUE, google_calendar_id = EXCLUDED.google_calendar_id,
                    google_event_id = EXCLUDED.google_event_id, google_link = EXCLUDED.google_link,
                    version = EXCLUDED.version, synced_version = 1, updated_at = NOW()
                 WHERE events.managed = FALSE`,
                [row.id, row.title, row.date, row.endDate, row.description, row.location, calendarId,
                    row.legacyLimit, JSON.stringify(row.legacyLink ? [{ url: row.legacyLink }] : []),
                    row.googleEventId, row.googleLink]
            );
        }
        const removed = await client.query(
            `DELETE FROM events WHERE source = $1 AND managed = FALSE AND NOT (id = ANY($2::varchar[]))`,
            [calendarId, rows.map(r => r.id)]
        );
        await client.query(
            `INSERT INTO calendar_state (calendar_id, imported_at) VALUES ($1, NOW())
             ON CONFLICT (calendar_id) DO UPDATE SET imported_at = NOW()`,
            [calendarId]
        );
        await client.query('COMMIT');
        return { imported: rows.length, removed: removed.rowCount };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { /* connection gone */ }
        throw error;
    } finally {
        client.release();
    }
}

async function createImportSchema(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS calendar_state (
            calendar_id VARCHAR(255) PRIMARY KEY,
            imported_at TIMESTAMPTZ
        )
    `);
}

async function importedCalendarIds(pool) {
    const result = await pool.query('SELECT calendar_id FROM calendar_state WHERE imported_at IS NOT NULL');
    return new Set(result.rows.map(r => r.calendar_id));
}

module.exports = { rowFromGoogleEvent, importCalendar, createImportSchema, importedCalendarIds };
