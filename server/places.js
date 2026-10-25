// The saved places: the owner's list an event's Where offers first, edited on /admin/places.
// The `places` table is filled once from config/app.json `places` when it is first made;
// after that the table is the list and config is never read again. The list is small and
// read on every event made, so it is kept in memory and reloaded after each change.

const MAX_NAME = 255;
const MAX_ADDRESS = 255;
const MAX_ALIASES = 10;
const MAX_ALIAS = 60;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

class PlaceInputError extends Error {
    constructor(field, message) {
        super(message);
        this.field = field;
    }
}

// { name, address, aliases, placeId } from an admin's form, or a PlaceInputError.
function validatePlaceInput(body) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new PlaceInputError('name', 'Give the place a name.');
    if (name.length > MAX_NAME) throw new PlaceInputError('name', `The name is at most ${MAX_NAME} characters.`);
    const address = String(body?.address ?? '').trim();
    if (address.length > MAX_ADDRESS) throw new PlaceInputError('address', `The address is at most ${MAX_ADDRESS} characters.`);
    const raw = Array.isArray(body?.aliases) ? body.aliases : String(body?.aliases ?? '').split(',');
    const aliases = [...new Set(raw.map(a => String(a).trim()).filter(Boolean))];
    if (aliases.length > MAX_ALIASES) throw new PlaceInputError('aliases', `At most ${MAX_ALIASES} other names.`);
    if (aliases.some(a => a.length > MAX_ALIAS)) throw new PlaceInputError('aliases', `Each other name is at most ${MAX_ALIAS} characters.`);
    const placeId = String(body?.placeId ?? '').trim();
    if (placeId && !PLACE_ID.test(placeId)) throw new PlaceInputError('placeId', 'That Google Maps id does not look right.');
    return { name, address, aliases, placeId: placeId || null };
}

async function createPlacesSchema(client, seed = []) {
    const existed = await client.query(`SELECT to_regclass('places') AS t`);
    await client.query(`
        CREATE TABLE IF NOT EXISTS places (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            address TEXT NOT NULL DEFAULT '',
            aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
            place_id VARCHAR(300),
            position INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS places_name_key ON places (LOWER(name))');
    if (existed.rows[0].t) return 0;
    let position = 0;
    for (const item of seed) {
        let place;
        try { place = validatePlaceInput(item); } catch (_) { continue; }
        position += 1;
        await client.query(
            `INSERT INTO places (name, address, aliases, place_id, position) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [place.name, place.address, JSON.stringify(place.aliases), place.placeId, position]
        );
    }
    return position;
}

const toPlace = (row) => ({ id: row.id, name: row.name, address: row.address || '', aliases: row.aliases || [], placeId: row.place_id || null });

function createPlaceStore(pool) {
    let cache = [];

    async function load() {
        const result = await pool.query('SELECT * FROM places ORDER BY position, id');
        cache = result.rows.map(toPlace);
        return cache;
    }

    // A second place with the same name (any case) is refused on the name field.
    async function guard(work) {
        try {
            const out = await work();
            await load();
            return out;
        } catch (error) {
            if (error.code === '23505') throw new PlaceInputError('name', 'There is already a place with that name.');
            throw error;
        }
    }

    return {
        load,
        // In the owner's order. Synchronous: the event validator reads it on every request.
        list: () => cache,
        add: (body) => guard(async () => {
            const p = validatePlaceInput(body);
            const result = await pool.query(
                `INSERT INTO places (name, address, aliases, place_id, position)
                 VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(position), 0) + 1 FROM places)) RETURNING *`,
                [p.name, p.address, JSON.stringify(p.aliases), p.placeId]
            );
            return toPlace(result.rows[0]);
        }),
        update: (id, body) => guard(async () => {
            const p = validatePlaceInput(body);
            const result = await pool.query(
                `UPDATE places SET name = $2, address = $3, aliases = $4, place_id = $5, updated_at = NOW()
                 WHERE id = $1 RETURNING *`,
                [id, p.name, p.address, JSON.stringify(p.aliases), p.placeId]
            );
            return result.rows[0] ? toPlace(result.rows[0]) : null;
        }),
        remove: (id) => guard(async () => (await pool.query('DELETE FROM places WHERE id = $1', [id])).rowCount > 0),
        // ids in their new order; ids not named keep their place after them.
        reorder: (ids) => guard(async () => {
            const order = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
            const rest = cache.map(p => p.id).filter(id => !order.includes(id));
            const all = [...order, ...rest];
            await pool.query(
                `UPDATE places p SET position = o.n, updated_at = NOW()
                 FROM UNNEST($1::int[]) WITH ORDINALITY AS o(id, n) WHERE p.id = o.id`,
                [all]
            );
            return true;
        })
    };
}

module.exports = { PlaceInputError, validatePlaceInput, createPlacesSchema, createPlaceStore };
