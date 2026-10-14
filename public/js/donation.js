const API_BASE_URL = window.location.origin;

let donationData = {
    balance: 0,
    donations: []
};

// Debounce function
function debounce(func, wait, immediate) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

const BALANCE_BAR_MIN_RANGE = 100; // smallest half-width of the bar, in euros

// Round up to the next 1/2/5 × 10ⁿ so the axis labels stay round numbers.
function niceRange(value) {
    if (!(value > 0)) return BALANCE_BAR_MIN_RANGE;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    for (const step of [1, 2, 5]) {
        const candidate = step * magnitude;
        if (candidate >= value) return candidate;
    }
    return 10 * magnitude;
}

// The bar spans ±range around zero. Growing the range with the balance keeps the
// fill off the end stop and keeps the axis labels honest about the scale.
function balanceBarRange(balance) {
    return Math.max(BALANCE_BAR_MIN_RANGE, niceRange(Math.abs(balance)));
}

document.addEventListener('DOMContentLoaded', () => {
    loadDonations();
    loadTransferDetails();
    setupRefreshButton();
});

function setupRefreshButton() {
    const refreshBtn = document.getElementById('refresh-donations-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', debounce(loadDonations, 250));
    }
}

async function loadDonations() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/donations?limit=20`);
        const data = await response.json();

        donationData = data;
        displayBalance(data.balance);
        renderBalanceBar(data.balance || 0);
        displayDonations(data.donations);
    } catch (error) {
        console.error('Error loading donations:', error);
        document.getElementById('donations-list').innerHTML =
            '<p class="state-line is-error">Error loading donations. Please try again later.</p>';
    }
}

// The fill is driven by transform: scaleX() from the zero tick, never by animating
// width — width is a layout property and scaling from a fixed transform-origin is the
// compositor-only way to grow/shrink a bar from a point.
function renderBalanceBar(balance) {
    const fill = document.getElementById('donation-progress-fill');
    if (!fill) return;
    const range = balanceBarRange(balance);
    const min = document.getElementById('balance-bar-min');
    const max = document.getElementById('balance-bar-max');
    if (min) min.textContent = `−€${range}`;
    if (max) max.textContent = `+€${range}`;
    const clamped = Math.max(-range, Math.min(range, balance));
    const fraction = Math.abs(clamped) / range;
    if (clamped >= 0) {
        fill.style.left = '50%';
        fill.style.right = 'auto';
        fill.style.transformOrigin = 'left center';
    } else {
        fill.style.left = 'auto';
        fill.style.right = '50%';
        fill.style.transformOrigin = 'right center';
    }
    fill.style.transform = `scaleX(${fraction})`;
    fill.classList.toggle('negative', clamped < 0);
}

// A true minus (U+2212), not the hyphen-minus Intl reaches for by default — it collides
// with the € sign at display size, and the axis labels beside the bar already use U+2212.
function formatEuros(amount) {
    const parts = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2
    }).formatToParts(amount);
    return parts.map(part => part.type === 'minusSign' ? '−' : part.value).join('');
}

function displayBalance(balance) {
    const balanceAmount = document.getElementById('balance-amount');
    balanceAmount.textContent = formatEuros(balance);
}

function displayDonations(donations) {
    const donationsList = document.getElementById('donations-list');

    if (donations.length === 0) {
        donationsList.innerHTML = '<p class="state-line">No donations yet.</p>';
        return;
    }

    const donationsHtml = donations.map(donation => {
        const dateToUse = donation.entry_date || donation.created_at;
        const date = new Date(dateToUse);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
        });

        const amount = formatEuros(donation.amount);
        const signedAmount = donation.amount > 0 ? `+${amount}` : amount;
        const donatorHtml = donation.donator ? escapeHtml(donation.donator) : 'Anonymous';
        const descHtml = donation.description ? escapeHtml(donation.description) : '';

        return `
            <div class="donation-entry">
                <div class="donation-date">${formattedDate}</div>
                <div>
                    <div class="donation-donator">${donatorHtml}</div>
                    ${descHtml ? `<div class="donation-description">${descHtml}</div>` : ''}
                </div>
                <div class="donation-amount">${signedAmount}</div>
            </div>
        `;
    }).join('');

    donationsList.innerHTML = donationsHtml;
}

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Bank transfer details come from the server (env vars there), so the public repo
// never carries the IBAN. A 404 means transfers are not set up yet.
async function loadTransferDetails() {
    const state = document.getElementById('transfer-state');
    try {
        const response = await fetch(`${API_BASE_URL}/api/donation-details`);
        if (response.status === 404) {
            state.textContent = 'Bank details are not available yet.';
            return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const details = await response.json();

        document.getElementById('transfer-holder').textContent = details.accountHolder;
        document.getElementById('transfer-iban').textContent = details.ibanDisplay;
        // BIC and message stay in the QR payload; the page omits them to stay short.
        document.getElementById('transfer-qr').src = `${API_BASE_URL}/api/donation-qr.svg`;
        setupCopyIban(details.iban);

        if (details.payLink) {
            document.getElementById('pay-link').href = details.payLink;
            document.getElementById('pay-link-section').hidden = false;
        }

        document.getElementById('transfer-details').hidden = false;
        state.hidden = true;
    } catch (error) {
        console.error('Error loading bank details:', error);
        state.textContent = 'Error loading bank details. Please try again later.';
        state.classList.add('is-error');
    }
}

function setupCopyIban(iban) {
    const button = document.getElementById('copy-iban-btn');
    if (!navigator.clipboard) {
        button.hidden = true;
        return;
    }
    button.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(iban);
            button.textContent = 'Copied';
        } catch {
            button.textContent = 'Copy failed';
        }
        setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    });
}
