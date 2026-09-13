/*
 * People who book.
 *
 * The sheet used to keep one requester in localStorage: per browser, per person, invisible
 * to anyone else, and gone with a cleared cache. A profile is the same three facts — name,
 * email, phone — kept where the bookings already are.
 *
 * A profile is an address book entry, never an account. There is no login here by design
 * (see the RSVP side of this app), so a profile proves nothing about who is typing; it only
 * saves everyone from typing a phone number into every request.
 */

const { normalizeName, validName, validEmail, validPhone, BookingInputError } = require('./booking-validation');

const TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS booking_profiles (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        name_key VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`;

/*
 * name_key is UNIQUE because it is the key the weekly quota counts on. Two profiles
 * folding to one key would look like two people and quietly hand one person four slots.
 */

/*
 * The link is nullable and ON DELETE SET NULL, and the booking keeps its own name, email
 * and phone. History must say what was actually submitted, not what the address book says
 * today — and removing someone must never break a request already waiting to go out.
 */
const LINK_SQL = `
    ALTER TABLE booking_queue
    ADD COLUMN IF NOT EXISTS profile_id VARCHAR(255)
    REFERENCES booking_profiles(id) ON DELETE SET NULL;
`;

const INDEX_SQL = [
    'CREATE INDEX IF NOT EXISTS idx_booking_profiles_name ON booking_profiles(name_key)'
];

/*
 * Seed the address book from the queue that predates it.
 *
 * One profile per distinct name_key, carrying the most recently queued contact details for
 * that person — the newest spelling and the newest phone number are the ones worth keeping.
 * Without this the picker would open empty against a queue that already holds dozens of
 * entries, and every person would have to be retyped.
 *
 * Idempotent: ON CONFLICT DO NOTHING, and the backfill only touches rows still unlinked.
 */
async function backfillProfiles(client, newId) {
    const people = await client.query(`
        SELECT DISTINCT ON (name_key) name_key, name, email, phone
        FROM booking_queue
        WHERE name_key NOT IN (SELECT name_key FROM booking_profiles)
        ORDER BY name_key, queued_at DESC
    `);
    for (const person of people.rows) {
        await client.query(
            `INSERT INTO booking_profiles (id, name, name_key, email, phone)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name_key) DO NOTHING`,
            [newId(), person.name, person.name_key, person.email, person.phone]
        );
    }
    const linked = await client.query(`
        UPDATE booking_queue AS q
        SET profile_id = p.id
        FROM booking_profiles AS p
        WHERE q.profile_id IS NULL AND q.name_key = p.name_key
    `);
    return { created: people.rowCount, linked: linked.rowCount };
}

async function createProfileSchema(client, newId) {
    await client.query(TABLE_SQL);
    await client.query(LINK_SQL);
    for (const sql of INDEX_SQL) await client.query(sql);
    return backfillProfiles(client, newId);
}

/*
 * Enough of a contact detail to recognise your own, not enough to harvest anyone else's.
 *
 * The board deliberately keeps email and phone off itself. A people list that handed both
 * out in full would undo that quietly, through a response the service worker caches. The
 * edit form reads the full record one profile at a time instead.
 */
function maskEmail(email) {
    const at = email.indexOf('@');
    if (at < 1) return '•••';
    return `${email[0]}•••${email.slice(at)}`;
}

function maskPhone(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length <= 4) return '•••';
    return `•••${digits.slice(-4)}`;
}

function publicProfile(row) {
    return {
        id: row.id,
        name: row.name,
        nameKey: row.name_key,
        emailMasked: maskEmail(row.email),
        phoneMasked: maskPhone(row.phone)
    };
}

function fullProfile(row) {
    return { id: row.id, name: row.name, nameKey: row.name_key, email: row.email, phone: row.phone };
}

/** Validate the three fields a profile holds. Throws BookingInputError with a `field`. */
function validateProfile(input = {}) {
    const name = validName(input.name);
    if (!name) throw new BookingInputError('Name is required, up to 100 characters.', 'name');

    const email = validEmail(input.email);
    if (!email) throw new BookingInputError('A valid email address is required — KU Leuven replies to it.', 'email');

    const phone = validPhone(input.phone);
    if (!phone) throw new BookingInputError('A valid phone number is required by the booking form.', 'phone');

    return { name, nameKey: normalizeName(name), email, phone };
}

module.exports = {
    createProfileSchema,
    maskEmail,
    maskPhone,
    publicProfile,
    fullProfile,
    validateProfile
};
