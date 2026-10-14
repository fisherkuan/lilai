const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isValidIban, formatIban, maskIban, readBankDetails, buildEpcPayload, renderEpcQrSvg
} = require('../server/donation-bank');

// Published example IBANs with valid check digits.
const BE_IBAN = 'BE68539007547034';

test('isValidIban accepts a valid IBAN with spaces and lower case', () => {
    assert.equal(isValidIban('be68 5390 0754 7034'), true);
});

test('isValidIban rejects a wrong check digit', () => {
    assert.equal(isValidIban('BE69539007547034'), false);
});

test('formatIban groups in fours', () => {
    assert.equal(formatIban(BE_IBAN), 'BE68 5390 0754 7034');
});

test('maskIban keeps the first and last four characters', () => {
    assert.equal(maskIban(BE_IBAN), 'BE68 •••• •••• 7034');
});

test('readBankDetails is null when holder or IBAN is missing', () => {
    assert.equal(readBankDetails({}), null);
    assert.equal(readBankDetails({ DONATION_IBAN: BE_IBAN }), null);
});

test('readBankDetails throws on an invalid IBAN', () => {
    assert.throws(() => readBankDetails({ DONATION_IBAN: 'BE00123', DONATION_ACCOUNT_HOLDER: 'A' }), /valid IBAN/);
});

test('readBankDetails refuses a non-https pay link', () => {
    assert.throws(() => readBankDetails({
        DONATION_IBAN: BE_IBAN, DONATION_ACCOUNT_HOLDER: 'A', DONATION_PAY_LINK: 'javascript:alert(1)'
    }), /https/);
});

test('readBankDetails applies defaults', () => {
    const details = readBankDetails({ DONATION_IBAN: BE_IBAN, DONATION_ACCOUNT_HOLDER: ' Fisher Kuan ' });
    assert.equal(details.accountHolder, 'Fisher Kuan');
    assert.equal(details.reference, 'Lilai donation');
    assert.equal(details.bic, '');
    assert.equal(details.payLink, '');
});

test('buildEpcPayload follows EPC069-12 with no amount', () => {
    const details = readBankDetails({
        DONATION_IBAN: BE_IBAN, DONATION_ACCOUNT_HOLDER: 'Fisher Kuan', DONATION_BIC: 'kred bebb'
    });
    assert.deepEqual(buildEpcPayload(details).split('\n'), [
        'BCD', '002', '1', 'SCT', 'KREDBEBB', 'Fisher Kuan', BE_IBAN, '', '', '', 'Lilai donation'
    ]);
});

test('renderEpcQrSvg returns an SVG', async () => {
    const details = readBankDetails({ DONATION_IBAN: BE_IBAN, DONATION_ACCOUNT_HOLDER: 'Fisher Kuan' });
    const svg = await renderEpcQrSvg(details);
    assert.match(svg, /^<svg/);
});
