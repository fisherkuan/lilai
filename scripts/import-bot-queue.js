#!/usr/bin/env node
/*
 * Import the sports-booking-bot's planned bookings into the queue.
 *
 * Produce the input with scripts/export-bot-queue.py. This mirrors the bot exactly: the
 * ids are the bot's own booking keys, the send delays are the ones it already sampled, and
 * the two requests it has already made come across as history with their real timestamps.
 *
 * The two-a-week quota is NOT applied. These bookings predate the rule and are being moved,
 * not made; refusing them here would silently drop about forty of them. Everything queued
 * through the sheet afterwards is still gated, including for the same name.
 *
 *   node scripts/import-bot-queue.js <bot-queue.json>            # dry run, prints the plan
 *   node scripts/import-bot-queue.js <bot-queue.json> --write    # actually insert
 */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const { validateBooking, BookingInputError } = require('../server/booking-validation');
const { createBookingSchema } = require('../server/booking-schema');

const file = process.argv[2];
const write = process.argv.includes('--write');
if (!file) {
    console.error('usage: node scripts/import-bot-queue.js <bot-queue.json> [--write]');
    process.exit(2);
}

const { bookings } = JSON.parse(fs.readFileSync(file, 'utf8'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/* Every row goes through the app's own validator first: an import must not be able to
 * create a combination the sheet would have refused. */
function check(booking) {
    try {
        validateBooking(booking);
        return null;
    } catch (error) {
        if (error instanceof BookingInputError) return `${error.field}: ${error.message}`;
        throw error;
    }
}

(async () => {
    const invalid = bookings.map((b) => [b, check(b)]).filter(([, why]) => why);
    if (invalid.length) {
        for (const [b, why] of invalid) console.error(`INVALID ${b.id} ${b.playDate} ${b.sport} — ${why}`);
        console.error(`\n${invalid.length} of ${bookings.length} would be refused by the app's own validator. Nothing written.`);
        process.exit(1);
    }

    const client = await pool.connect();
    try {
        await createBookingSchema(client);

        const existing = await client.query(
            'SELECT id FROM booking_queue WHERE id = ANY($1)', [bookings.map((b) => b.id)]);
        const known = new Set(existing.rows.map((r) => r.id));
        const fresh = bookings.filter((b) => !known.has(b.id));

        console.log(`${bookings.length} in file · ${known.size} already in the queue · ${fresh.length} to insert`);
        const counts = fresh.reduce((acc, b) => ({ ...acc, [b.status]: (acc[b.status] || 0) + 1 }), {});
        console.log('by status:', counts);
        if (fresh.length) {
            const span = [fresh[0], fresh[fresh.length - 1]];
            console.log(`play dates ${span[0].playDate} … ${span[1].playDate}`);
        }

        if (!write) {
            console.log('\nDry run. Re-run with --write to insert.');
            return;
        }

        let inserted = 0;
        for (const b of fresh) {
            const entry = validateBooking(b);
            const sendAfter = new Date(new Date(b.opensAt).getTime() + (b.sendAfterSeconds || 0) * 1000);
            await client.query(`
                INSERT INTO booking_queue (
                    id, sport, play_date, start_preferred, start_alternative, duration_hours,
                    players, indoor_outdoor, facility, other_facility, language, valid_sports_card,
                    name, name_key, email, phone, remarks, queued_by, opens_at, send_after,
                    status, submitted_at, response_note
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
                ON CONFLICT (id) DO NOTHING
            `, [
                b.id, entry.sport, entry.playDate, entry.startPreferred, entry.startAlternative,
                entry.durationHours, entry.players, entry.indoorOutdoor, entry.facility,
                entry.otherFacility, entry.language, entry.validSportsCard,
                entry.name, entry.nameKey, entry.email, entry.phone, entry.remarks,
                'import:sports-booking-bot', entry.opensAt, sendAfter,
                b.status, b.submittedAt || null, b.responseNote || null
            ]);
            inserted += 1;
        }
        console.log(`\ninserted ${inserted}`);
    } finally {
        client.release();
        await pool.end();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
