// Booking organisers: the people who run the booking queue. Signed in with an address on this
// list, a device shows the header's Admin link (to /admin/bookings). The owner edits the list
// on /admin/organisers, so it changes without a deploy. Admins (ADMIN_EMAILS) are not on it:
// they see the link anyway. The booking queue itself stays open by design; the list only
// decides who is shown the way in.

const normalEmail = (value) => String(value ?? '').trim().toLowerCase().slice(0, 254);
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function createOrganizersSchema(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS organizers (
            email VARCHAR(254) PRIMARY KEY,
            added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            added_by VARCHAR(254)
        )`);
}

function createOrganizers(pool) {
    async function list() {
        const result = await pool.query('SELECT email, added_at FROM organizers ORDER BY email');
        return result.rows.map(r => ({ email: r.email, addedAt: r.added_at }));
    }

    async function has(email) {
        const who = normalEmail(email);
        if (!who) return false;
        return (await pool.query('SELECT 1 FROM organizers WHERE email = $1', [who])).rowCount > 0;
    }

    // { email } once added (adding twice is fine), or { error } for an address that is not one.
    async function add(email, addedBy = null) {
        const who = normalEmail(email);
        if (!looksLikeEmail(who)) return { error: 'Type an email address.' };
        await pool.query('INSERT INTO organizers (email, added_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [who, addedBy]);
        return { email: who };
    }

    async function remove(email) {
        return (await pool.query('DELETE FROM organizers WHERE email = $1', [normalEmail(email)])).rowCount > 0;
    }

    return { list, has, add, remove };
}

module.exports = { createOrganizersSchema, createOrganizers };
