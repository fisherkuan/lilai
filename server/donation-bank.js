// Bank-transfer donations. Stripe refused donation payments for this account
// (restricted business), so the Donate page shows an IBAN, a SEPA "scan to pay"
// QR code and, optionally, a payment link such as revolut.me. Nothing here moves money: the
// owner still records each donation by hand in admin Donations.
//
// The details come from the environment, never config/app.json, because the
// repository is public and an IBAN should not live in its history.

const QRCode = require('qrcode');

const DEFAULT_REFERENCE = 'Lilai donation';

function normaliseIban(value) {
    return String(value || '').replace(/\s+/g, '').toUpperCase();
}

// ISO 13616 mod-97 check. A typo in an env var should fail loudly at startup,
// not send a donor's transfer to a rejected account.
function isValidIban(value) {
    const iban = normaliseIban(value);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    const digits = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
    let remainder = 0;
    for (const digit of digits) {
        remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder === 1;
}

// Groups of four, the way a bank statement prints it.
function formatIban(value) {
    return normaliseIban(value).replace(/(.{4})(?=.)/g, '$1 ');
}

// Only https links, so a bad value cannot become a javascript: URL on the page.
function readPayLink(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('DONATION_PAY_LINK is not a URL');
    }
    if (url.protocol !== 'https:') {
        throw new Error('DONATION_PAY_LINK must be an https URL');
    }
    return url.href;
}

// Returns null when donations by transfer are not configured, so the page can
// say so instead of showing half a set of payment details.
function readBankDetails(env = process.env) {
    const iban = normaliseIban(env.DONATION_IBAN);
    const accountHolder = String(env.DONATION_ACCOUNT_HOLDER || '').trim();
    if (!iban || !accountHolder) return null;
    if (!isValidIban(iban)) {
        throw new Error('DONATION_IBAN is not a valid IBAN');
    }
    return {
        accountHolder,
        iban,
        ibanDisplay: formatIban(iban),
        bic: String(env.DONATION_BIC || '').replace(/\s+/g, '').toUpperCase(),
        reference: String(env.DONATION_REFERENCE || DEFAULT_REFERENCE).trim(),
        payLink: readPayLink(env.DONATION_PAY_LINK)
    };
}

// EPC069-12 "SEPA credit transfer" QR payload, version 002 (BIC optional).
// The amount is left empty so the donor chooses it in their banking app.
function buildEpcPayload(details) {
    return [
        'BCD',
        '002',
        '1',
        'SCT',
        details.bic || '',
        details.accountHolder.slice(0, 70),
        details.iban,
        '',
        '',
        '',
        details.reference.slice(0, 140)
    ].join('\n');
}

// The EPC spec asks for error correction level M.
function renderEpcQrSvg(details) {
    return QRCode.toString(buildEpcPayload(details), {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2
    });
}

module.exports = {
    isValidIban,
    formatIban,
    readBankDetails,
    buildEpcPayload,
    renderEpcQrSvg
};
