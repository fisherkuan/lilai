const test = require('node:test');
const assert = require('node:assert/strict');
require('../public/js/signin-code');

const { SignInCode } = globalThis;

function memoryStore() {
    const data = {};
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; }
    };
}

test('a code is six digits, spaces ignored', () => {
    assert.equal(SignInCode.isCode('042917'), true);
    assert.equal(SignInCode.isCode(' 042 917 '), true);
    assert.equal(SignInCode.isCode('04291'), false);
    assert.equal(SignInCode.isCode('04291a'), false);
    assert.equal(SignInCode.clean(' 042 917 '), '042917');
});

test('a sent code is remembered for its 30 minutes, then forgotten', () => {
    const store = memoryStore();
    const at = Date.parse('2026-10-25T16:00:00Z');
    assert.equal(SignInCode.pending(at, store), '');
    SignInCode.remember('ann@lilai.test', 'chat-e1', at, store);
    assert.equal(SignInCode.pending(at + 29 * 60 * 1000, store), 'ann@lilai.test');
    assert.equal(SignInCode.pendingWhere(at + 29 * 60 * 1000, store), 'chat-e1');
    assert.equal(SignInCode.pending(at + 30 * 60 * 1000, store), '');
    assert.equal(SignInCode.pendingWhere(at + 30 * 60 * 1000, store), '');
    SignInCode.clear(store);
    assert.equal(SignInCode.pending(at, store), '');
});

test('a broken entry counts as nothing kept', () => {
    const store = memoryStore();
    store.setItem('lilai.signinPending', '{oops');
    assert.equal(SignInCode.pending(Date.now(), store), '');
});
