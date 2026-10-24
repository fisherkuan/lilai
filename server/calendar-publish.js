/*
 * Keeps each Google calendar a copy of Lilai's events.
 *
 * Every change to an event bumps its `version`. The publisher pushes any managed row whose
 * version is ahead of `synced_version`, then records the version it pushed, so a change made
 * while a push is in flight is simply pushed again. It runs every 30 seconds and right after
 * each change (nudge()).
 *
 * A push can be retried without harm: a new copy is inserted under Lilai's own id (a second
 * insert is refused with 409 and becomes an update), a live copy is replaced whole (PUT, which
 * also brings back a copy someone deleted in Google), and a cancelled event's copy is deleted
 * (already gone counts as done). A failure waits a little longer each time, up to six hours,
 * and the management page shows the reason.
 *
 * Without Google credentials nothing is pushed. Events still work in Lilai; their copies go
 * out once credentials exist.
 */

const { googleEventResource } = require('./event-hosting');

const BATCH = 25;
const MAX_RETRY_SECONDS = 6 * 3600;

// 30 s, 1 min, 2 min … capped at six hours.
function retryDelaySeconds(attempts) {
    return Math.min(30 * 2 ** Math.max(0, attempts - 1), MAX_RETRY_SECONDS);
}

// What a push does for a row: delete the copy, insert a first copy, or replace it.
function pushAction(row) {
    if (row.cancelled_at) return 'delete';
    return Number(row.synced_version) === 0 ? 'insert' : 'update';
}

function createPublisher({ pool, googleCalendar, publicUrl, places = [], broadcast = () => {}, intervalMs = 30000 }) {
    let timer = null;
    let running = false;
    let again = false;

    async function upsertCopy(row, action) {
        const resource = googleEventResource(row, { publicUrl, places });
        const calendarId = row.google_calendar_id;
        const eventId = row.google_event_id;
        if (action === 'insert') {
            try {
                return await googleCalendar.insertEvent(calendarId, { ...resource, id: eventId });
            } catch (error) {
                if (error.status !== 409) throw error;
                return googleCalendar.updateEvent(calendarId, eventId, resource);
            }
        }
        try {
            return await googleCalendar.updateEvent(calendarId, eventId, resource);
        } catch (error) {
            if (error.status !== 404) throw error;
            return googleCalendar.insertEvent(calendarId, { ...resource, id: eventId });
        }
    }

    async function pushOne(row) {
        const action = pushAction(row);
        try {
            let copy = null;
            if (action === 'delete') {
                try {
                    await googleCalendar.deleteEvent(row.google_calendar_id, row.google_event_id);
                } catch (error) {
                    if (error.status !== 404 && error.status !== 410) throw error;
                }
            } else {
                copy = await upsertCopy(row, action);
            }
            await pool.query(
                `UPDATE events SET synced_version = $2, push_attempts = 0, push_error = NULL, next_push_at = NULL,
                        google_link = COALESCE($3, google_link)
                 WHERE id = $1 AND synced_version < $2`,
                [row.id, row.version, copy?.htmlLink || null]
            );
        } catch (error) {
            const attempts = Number(row.push_attempts) + 1;
            console.error(`[publish] ${row.id} (${action}) failed, attempt ${attempts}:`, error.message);
            await pool.query(
                `UPDATE events SET push_attempts = $2, push_error = $3,
                        next_push_at = NOW() + make_interval(secs => $4)
                 WHERE id = $1`,
                [row.id, attempts, String(error.message || 'Unknown error').slice(0, 300), retryDelaySeconds(attempts)]
            );
        }
        // The management page shows where the copy stands; tell it to look again.
        broadcast({ type: 'event_published', payload: { id: row.id } });
    }

    async function tick() {
        if (!googleCalendar) return;
        if (running) {
            again = true;
            return;
        }
        running = true;
        try {
            do {
                again = false;
                const due = await pool.query(
                    `SELECT * FROM events
                     WHERE managed AND google_calendar_id IS NOT NULL AND version > synced_version
                       AND (next_push_at IS NULL OR next_push_at <= NOW())
                     ORDER BY next_push_at NULLS FIRST, updated_at NULLS FIRST
                     LIMIT ${BATCH}`
                );
                for (const row of due.rows) await pushOne(row);
                if (due.rows.length === BATCH) again = true;
            } while (again);
        } catch (error) {
            console.error('[publish] tick failed:', error.message);
        } finally {
            running = false;
        }
    }

    return {
        start() {
            if (!googleCalendar || timer) return;
            timer = setInterval(tick, intervalMs);
            timer.unref();
            tick();
        },
        stop() {
            clearInterval(timer);
            timer = null;
        },
        // Right after a change, so a host sees "In Google Calendar" within seconds.
        nudge() {
            setImmediate(tick);
        },
        tick
    };
}

module.exports = { createPublisher, retryDelaySeconds, pushAction };
