const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createOrganizersSchema, createOrganizers } = require('../server/organizers');

const CONNECTION = process.env.TEST_DATABASE_URL;
const scratch = CONNECTION && /test|scratch|local/i.test(new URL(CONNECTION).pathname);

test('the owner keeps a list of booking organisers', { skip: !scratch && 'no TEST_DATABASE_URL' }, async () => {
    const pool = new Pool({ connectionString: CONNECTION });
    try {
        await createOrganizersSchema(pool);
        await pool.query('TRUNCATE organizers');
        const organizers = createOrganizers(pool);

        assert.deepEqual(await organizers.add('not an address'), { error: 'Type an email address.' });
        assert.deepEqual(await organizers.add(' Ann@Lilai.test ', 'owner@lilai.test'), { email: 'ann@lilai.test' });
        await organizers.add('ann@lilai.test'); // twice is fine
        await organizers.add('bob@lilai.test');
        assert.deepEqual((await organizers.list()).map(o => o.email), ['ann@lilai.test', 'bob@lilai.test']);

        assert.equal(await organizers.has('ANN@lilai.test'), true);
        assert.equal(await organizers.has('carl@lilai.test'), false);
        assert.equal(await organizers.has(null), false);

        assert.equal(await organizers.remove('Ann@lilai.test'), true);
        assert.equal(await organizers.has('ann@lilai.test'), false);
        assert.equal(await organizers.remove('ann@lilai.test'), false);
    } finally {
        await pool.end();
    }
});
