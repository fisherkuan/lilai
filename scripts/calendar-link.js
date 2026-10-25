#!/usr/bin/env node
/*
 * Mint a calendar key link: whoever opens it can make events in that calendar and manage
 * any of its events. Needed for a restricted calendar (TSA); works for any calendar.
 *
 *   heroku run -a lilai-eu node scripts/calendar-link.js TSA --label "TSA admins"
 *   heroku run -a lilai-eu node scripts/calendar-link.js TSA --revoke
 *
 * --revoke stops every existing link for that calendar first. The link is printed once;
 * only its hash is stored.
 */

require('dotenv').config();
const { Pool } = require('pg');
const appConfig = require('../config/app.json');
const { createCalendarAccessSchema, createCalendarKey, revokeCalendarKeys } = require('../server/calendar-access');

async function main() {
    const args = process.argv.slice(2);
    const name = args.find(a => !a.startsWith('--'));
    const labelAt = args.indexOf('--label');
    const label = labelAt > -1 ? args[labelAt + 1] : null;
    const names = (appConfig.calendars || []).filter(c => c.enabled).map(c => c.name);
    if (!name || !names.includes(name)) {
        console.error(`Usage: node scripts/calendar-link.js <calendar> [--label "who it is for"] [--revoke]\nCalendars: ${names.join(', ')}`);
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    const client = await pool.connect();
    try {
        await createCalendarAccessSchema(client);
        if (args.includes('--revoke')) {
            const revoked = await revokeCalendarKeys(client, name);
            console.log(`Revoked ${revoked} earlier link${revoked === 1 ? '' : 's'} for ${name}.`);
        }
        const token = await createCalendarKey(client, name, label);
        const base = (process.env.PUBLIC_URL || appConfig.publicUrl || 'http://localhost:3000').replace(/\/+$/, '');
        console.log(`${name} calendar link (shown once):\n${base}/calendars/${token}`);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
