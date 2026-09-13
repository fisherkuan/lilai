const test = require('node:test');
const assert = require('node:assert/strict');

const { maskEmail, maskPhone, publicProfile, fullProfile, validateProfile } = require('../server/booking-profiles');

test('a profile needs all three facts', () => {
    const ok = validateProfile({ name: '  Kuan   Fisher ', email: 'a@b.co', phone: '+32 470 11 22 33' });
    assert.deepEqual(ok, {
        name: 'Kuan Fisher',
        nameKey: 'kuan fisher',
        email: 'a@b.co',
        phone: '+32 470 11 22 33'
    });

    const fieldOf = (input) => {
        try {
            validateProfile(input);
            return null;
        } catch (error) {
            return error.field;
        }
    };
    assert.equal(fieldOf({ email: 'a@b.co', phone: '+32470112233' }), 'name');
    assert.equal(fieldOf({ name: 'A B', phone: '+32470112233' }), 'email');
    assert.equal(fieldOf({ name: 'A B', email: 'a@b.co' }), 'phone');
    assert.equal(fieldOf({ name: 'A B', email: 'not-an-email', phone: '+32470112233' }), 'email');
});

/*
 * The fold is the quota's fold. If a profile could exist twice under two spellings, the
 * two-slots-a-week rule would count them as two people.
 */
test('the key a profile is unique on is the key the quota counts on', () => {
    const { normalizeName } = require('../server/booking-validation');
    for (const spelling of ['Kuan Fisher', 'kuan  fisher', '  KUAN FISHER  ']) {
        assert.equal(validateProfile({ name: spelling, email: 'a@b.co', phone: '+32470112233' }).nameKey,
            normalizeName('Kuan Fisher'));
    }
});

test('masking shows enough to recognise your own and no more', () => {
    assert.equal(maskEmail('fisher.kuan@gmail.com'), 'f•••@gmail.com');
    assert.equal(maskPhone('+32 470 11 22 33'), '•••2233');
    // Nothing recognisable in, nothing leaked out.
    assert.equal(maskEmail('@nowhere'), '•••');
    assert.equal(maskPhone('12'), '•••');
});

test('the list shape carries no contact details, the single read does', () => {
    const row = {
        id: 'p1', name: 'Kuan Fisher', name_key: 'kuan fisher',
        email: 'fisher.kuan@gmail.com', phone: '+32 470 11 22 33'
    };
    const listed = publicProfile(row);
    assert.equal(JSON.stringify(listed).includes('fisher.kuan@gmail.com'), false);
    assert.equal(JSON.stringify(listed).includes('470'), false);
    assert.deepEqual(fullProfile(row), {
        id: 'p1', name: 'Kuan Fisher', nameKey: 'kuan fisher',
        email: 'fisher.kuan@gmail.com', phone: '+32 470 11 22 33'
    });
});
