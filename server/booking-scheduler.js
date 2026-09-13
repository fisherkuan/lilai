/*
 * Sends queued bookings the moment their window opens.
 *
 * Ported from the verified reference implementation at ~/code/sports-booking-bot
 * (booking_bot.py: due_state, process_locked, Ledger.claim). Four rules carry the weight:
 *
 *  1. An entry is due for the whole window from its opening to opening + grace. That
 *     makes recovery STATELESS — there is no catch-up path, because any process alive
 *     inside those five minutes picks the entry up through the ordinary check. A restart
 *     across midnight costs nothing.
 *  2. The claim is committed BEFORE the POST. A crash or timeout can therefore never
 *     trigger an automatic duplicate; the entry is left uncertain for a human instead.
 *  3. The due state is re-checked after the GET and the payload is built before the
 *     claim, so a slow fetch or a changed form cannot burn an entry.
 *  4. Nothing is ever retried automatically. A double submission cannot be undone, and
 *     no amount of convenience is worth that.
 *
 * Dry run is the default. Live submission needs BOOKING_SUBMIT=live, deliberately.
 */

const { BookingFormClient, buildFields, buildPayload, FormChangedError } = require('./booking-form');

const TICK_MS = 15000;

/**
 * waiting - the window has not opened.
 * due     - inside the window, and the slot has not been played yet.
 * missed  - the grace window has closed, or the slot itself has been and gone.
 */
function dueState(entry, now, graceSeconds) {
    const opensAt = new Date(entry.opens_at);
    const preferred = new Date(entry.start_preferred);
    const alternative = new Date(entry.start_alternative || entry.start_preferred);
    const earliestPlay = preferred <= alternative ? preferred : alternative;

    if (now < opensAt) return 'waiting';
    if (now >= earliestPlay) return 'missed';
    if (now.getTime() > opensAt.getTime() + graceSeconds * 1000) return 'missed';
    return 'due';
}

function createScheduler({
    pool,
    broadcast = () => {},
    settings,
    live = false,
    clientFactory = () => new BookingFormClient(),
    now = () => new Date(),
    toBoardEntry = (row) => row,
    log = console
} = {}) {
    // One dyno today, so in-memory pacing is enough. The DB claim is what actually
    // prevents a double send if that ever stops being true.
    let nextAllowedAt = 0;
    let timer = null;
    let running = false;
    // Interrupted rows are recovered on the first pass that reaches the database, not at
    // start(): a connection blip at boot must not leave them `sending` until the next deploy.
    let recovered = false;

    async function finish(client, id, status, note) {
        const result = await client.query(`
            UPDATE booking_queue
            SET status = $2, response_note = $3, submitted_at = COALESCE(submitted_at, NOW())
            WHERE id = $1
            RETURNING *
        `, [id, status, note ? String(note).slice(0, 2000) : null]);
        if (result.rows[0]) broadcast({ type: 'booking_update', booking: toBoardEntry(result.rows[0]) });
        return result.rows[0];
    }

    async function markMissed(client, entry) {
        const result = await client.query(`
            UPDATE booking_queue SET status = 'missed'
            WHERE id = $1 AND status = 'queued'
            RETURNING *
        `, [entry.id]);
        if (result.rows[0]) {
            log.warn(`[bookings] ${entry.id} missed its window (${entry.sport}, ${entry.play_date})`);
            broadcast({ type: 'booking_update', booking: toBoardEntry(result.rows[0]) });
        }
    }

    /*
     * A row still marked `sending` when the process starts was interrupted mid-flight.
     * We cannot know whether KU Leuven received it, so it becomes `unconfirmed` and waits
     * for a human. Retrying here is the one thing that could double-book.
     */
    async function recoverInterrupted(client) {
        const result = await client.query(`
            UPDATE booking_queue
            SET status = 'unconfirmed',
                response_note = 'Interrupted after the request was claimed; we cannot tell whether it was sent.'
            WHERE status = 'sending'
            RETURNING *
        `);
        for (const row of result.rows) {
            log.warn(`[bookings] ${row.id} was interrupted mid-submission; left unconfirmed for review`);
            broadcast({ type: 'booking_update', booking: toBoardEntry(row) });
        }
        return result.rows.length;
    }

    async function submitOne(client, entry) {
        const grace = settings.lateSubmissionGraceSeconds;

        // No POST has happened yet, so a failure here is free to retry on the next tick.
        const formClient = clientFactory();
        const form = await formClient.getForm();
        const values = buildFields({
            name: entry.name,
            email: entry.email,
            phone: entry.phone,
            language: entry.language,
            validSportsCard: entry.valid_sports_card,
            sport: entry.sport,
            players: entry.players,
            indoorOutdoor: entry.indoor_outdoor,
            facility: entry.facility,
            otherFacility: entry.other_facility,
            durationHours: entry.duration_hours,
            remarks: entry.remarks,
            startPreferred: new Date(entry.start_preferred),
            startAlternative: new Date(entry.start_alternative)
        });

        // Fail before claiming if the form changed under us.
        buildPayload(form, values);

        // The GET took time; the window may have closed while we waited.
        if (dueState(entry, now(), grace) !== 'due') {
            await markMissed(client, entry);
            return 'missed';
        }

        // Claim first, send second. This ordering is the whole safety story.
        const claimed = await client.query(`
            UPDATE booking_queue SET status = 'sending'
            WHERE id = $1 AND status = 'queued'
            RETURNING *
        `, [entry.id]);
        if (claimed.rows.length === 0) return 'already-claimed';
        broadcast({ type: 'booking_update', booking: toBoardEntry(claimed.rows[0]) });

        nextAllowedAt = Date.now() + settings.minimumRequestIntervalSeconds * 1000;

        if (!live) {
            /*
             * Dry run: the claim and the state machine are exercised, nothing is sent.
             *
             * This lands as `not_sent`, not `unconfirmed`. `unconfirmed` means the request
             * went out and the reply could not be read — the board says "Request sent" for
             * it, on purpose. Saying that here would be a lie the operator cannot detect:
             * the reason lives in response_note, which no page renders. A row must never
             * claim a request went in when none did.
             */
            await finish(client, entry.id, 'not_sent',
                'DRY RUN — nothing was submitted. Set BOOKING_SUBMIT=live to send for real.');
            log.info(`[bookings] DRY RUN would submit ${entry.sport} ${entry.play_date} for ${entry.name}`);
            return 'dry-run';
        }

        try {
            const result = await formClient.submit(form, values);
            await finish(client, entry.id, result.outcome,
                `HTTP ${result.status} — ${result.outcome}`);
            return result.outcome;
        } catch (error) {
            // We got as far as sending and cannot read the answer. Never retried.
            await finish(client, entry.id, 'unconfirmed',
                `Could not read the response: ${error.name}: ${error.message}`);
            return 'unconfirmed';
        }
    }

    /** One pass. Returns a small summary, which is what the tests assert on. */
    async function tick() {
        if (running) return { skipped: 'already running' };
        running = true;
        const summary = { due: 0, sent: 0, missed: 0, paced: 0, errors: 0 };
        // Inside the try: `running` is cleared on every exit, a refused connection included.
        // Outside it, one refused pool.connect() would report "already running" for the
        // rest of the process's life, and nothing would ever be sent again.
        let client = null;
        try {
            client = await pool.connect();
            if (!recovered) {
                await recoverInterrupted(client);
                recovered = true;
            }
            const grace = settings.lateSubmissionGraceSeconds;
            const candidates = await client.query(`
                SELECT * FROM booking_queue
                WHERE status = 'queued' AND opens_at <= NOW() + INTERVAL '1 minute'
                ORDER BY send_after ASC
            `);

            for (const entry of candidates.rows) {
                const state = dueState(entry, now(), grace);
                if (state === 'waiting') continue;
                if (state === 'missed') {
                    await markMissed(client, entry);
                    summary.missed += 1;
                    continue;
                }
                summary.due += 1;

                // Its own random delay has not elapsed yet.
                if (now().getTime() < new Date(entry.send_after).getTime()) continue;
                // Or we are still spacing requests apart.
                if (Date.now() < nextAllowedAt) { summary.paced += 1; continue; }

                try {
                    const outcome = await submitOne(client, entry);
                    if (outcome === 'missed') summary.missed += 1;
                    else if (outcome !== 'already-claimed') summary.sent += 1;
                } catch (error) {
                    summary.errors += 1;
                    if (error instanceof FormChangedError) {
                        // Loudly, and without consuming the entry: it can still go out if
                        // the form is fixed inside the grace window.
                        log.error(`[bookings] form changed, refusing to submit: ${error.message}`);
                    } else {
                        log.error(`[bookings] ${entry.id} could not be submitted: ${error.message}`);
                    }
                }
            }
        } finally {
            if (client) client.release();
            running = false;
        }
        return summary;
    }

    /*
     * The interval is installed before the first pass runs, so a database that is briefly
     * unreachable at boot costs one pass and nothing more. The first pass itself runs at
     * once rather than waiting out the interval: the grace window may be exactly what a
     * boot is recovering.
     */
    async function start() {
        log.info(`[bookings] scheduler started in ${live ? 'LIVE' : 'DRY RUN'} mode`);
        const guarded = (label) => (error) => log.error(`[bookings] ${label}:`, error.message);
        timer = setInterval(() => tick().catch(guarded('tick failed')), TICK_MS);
        if (timer.unref) timer.unref();
        await tick().catch(guarded('first pass failed, the next tick retries'));
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { start, stop, tick, recoverInterrupted, isLive: () => live };
}

module.exports = { dueState, createScheduler, TICK_MS };
