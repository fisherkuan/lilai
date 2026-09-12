/*
 * Two slots per person per week.
 *
 * The week is Monday–Sunday of the PLAY date, not of the day someone queued. The person
 * is identified by their normalized name (see normalizeName) because that is what the
 * community agreed to count on — email is collected for the KU Leuven form and is never
 * used as an identity here, nor rendered to the board.
 */

const { weekBounds } = require('./booking-time');
const { normalizeName } = require('./booking-validation');

const QUOTA_PER_WEEK = 2;

/*
 * Which statuses consume one of the two slots.
 *
 *   queued / sending  — holds a slot; the request is still coming.
 *   sent              — went out; counts whatever KU Leuven answers.
 *   unconfirmed       — we could not read their answer, so it may well have landed.
 *                       Counting it is the safe side of an unknown.
 *
 * Deliberately excluded: `failed` (nothing was booked), `missed` (never submitted) and
 * `cancelled`. None of those can have taken a court, so none should cost a slot.
 */
const HOLDING_STATUSES = ['queued', 'sending', 'sent', 'unconfirmed'];

/**
 * Count the slots a name already holds in the play date's week.
 * Pass `excludeId` when re-checking an entry that is itself already in the table.
 */
async function countHeld(client, nameKey, playDate, { excludeId = null } = {}) {
    const week = weekBounds(playDate);
    const params = [nameKey, week.start, week.end, HOLDING_STATUSES];
    let sql = `
        SELECT COUNT(*)::int AS held
        FROM booking_queue
        WHERE name_key = $1
          AND play_date BETWEEN $2 AND $3
          AND status = ANY($4)
    `;
    if (excludeId) {
        params.push(excludeId);
        sql += ` AND id <> $${params.length}`;
    }
    const result = await client.query(sql, params);
    return result.rows[0].held;
}

/**
 * The tally the queue sheet shows live as someone types a name.
 * Returns the held entries too, so the "that week is full" branch can offer a swap.
 */
async function quotaFor(client, name, playDate, options = {}) {
    const nameKey = normalizeName(name);
    const week = weekBounds(playDate);

    const result = await client.query(`
        SELECT id, sport, play_date, start_preferred, status, name
        FROM booking_queue
        WHERE name_key = $1
          AND play_date BETWEEN $2 AND $3
          AND status = ANY($4)
        ORDER BY start_preferred ASC
    `, [nameKey, week.start, week.end, HOLDING_STATUSES]);

    const entries = options.excludeId
        ? result.rows.filter((row) => row.id !== options.excludeId)
        : result.rows;

    // Answer in the spelling the queue already knows, so "yuki CHEN" is told about
    // "Yuki Chen" rather than being shown its own typing back.
    const knownName = entries.length > 0 ? entries[entries.length - 1].name : name;

    return {
        name: knownName,
        typedName: name,
        nameKey,
        week,
        limit: QUOTA_PER_WEEK,
        used: entries.length,
        remaining: Math.max(0, QUOTA_PER_WEEK - entries.length),
        // Only a slot that has not gone out yet can be swapped; once submitted it is spent.
        entries: entries.map((row) => ({
            id: row.id,
            sport: row.sport,
            playDate: row.play_date,
            startPreferred: row.start_preferred,
            status: row.status,
            swappable: row.status === 'queued'
        }))
    };
}

module.exports = {
    QUOTA_PER_WEEK,
    HOLDING_STATUSES,
    countHeld,
    quotaFor
};
