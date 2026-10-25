const test = require('node:test');
const assert = require('node:assert/strict');
const { decisionKind, changedFields, KINDS } = require('../server/event-activity');

test('decisionKind names what a host decision did, from the status before and after', () => {
    assert.equal(decisionKind('pending', 'yes'), 'accepted');
    assert.equal(decisionKind('declined', 'yes'), 'readded');
    assert.equal(decisionKind('yes', 'declined'), 'removed');
    assert.equal(decisionKind('pending', 'declined'), 'declined');
    assert.equal(decisionKind('declined', 'pending'), 'reasked');
    assert.equal(decisionKind('yes', 'yes'), null);
    for (const from of ['yes', 'pending', 'declined']) {
        for (const to of ['yes', 'pending', 'declined']) {
            const kind = decisionKind(from, to);
            assert.ok(kind === null || KINDS.includes(kind), `${from} -> ${to}`);
        }
    }
});

test('changedFields lists what an edit changed, in form order', () => {
    const before = { title: 'Badminton', date: '2026-10-28', start: '19:00', end: '21:00', location: 'Gym', description: '', links: [], limit: 8, approval: false };
    assert.deepEqual(changedFields(before, { ...before }), []);
    assert.deepEqual(changedFields(before, { ...before, location: 'Sportoase', start: '19:30' }), ['start', 'place']);
    assert.deepEqual(changedFields(before, { ...before, limit: null }), ['places']);
    assert.deepEqual(changedFields(before, { ...before, links: [{ url: 'https://example.com' }] }), ['links']);
});
