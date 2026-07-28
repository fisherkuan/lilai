const API_BASE_URL = window.location.origin;

const TABLET_VIEW_QUERY = window.matchMedia('(max-width: 768px)');

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
    setupDonateButton();
    setupRefreshButton();
});

function renderBalanceBar(balance) {
    const fill = document.getElementById('donation-progress-fill');
    if (!fill) return;
    const range = balanceBarRange(balance);
    const min = document.getElementById('balance-bar-min');
    const max = document.getElementById('balance-bar-max');
    if (min) min.textContent = `−€${range}`;
    if (max) max.textContent = `+€${range}`;
    const clamped = Math.max(-range, Math.min(range, balance));
    const magnitudePct = Math.abs(clamped) / range * 50;
    if (clamped >= 0) {
        fill.style.left = '50%';
        fill.style.right = 'auto';
    } else {
        fill.style.left = 'auto';
        fill.style.right = '50%';
    }
    fill.style.width = `${magnitudePct}%`;
    fill.classList.toggle('negative', clamped < 0);
}

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
            '<p class="error-message">Error loading donations. Please try again later.</p>';
    }
}

function displayBalance(balance) {
    const balanceAmount = document.getElementById('balance-amount');
    
    // Format balance as currency
    const formattedBalance = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2
    }).format(balance);
    
    balanceAmount.textContent = formattedBalance;
    
    // Set color based on balance
    if (balance > 0) {
        balanceAmount.classList.add('positive');
        balanceAmount.classList.remove('negative');
    } else if (balance < 0) {
        balanceAmount.classList.add('negative');
        balanceAmount.classList.remove('positive');
    } else {
        balanceAmount.classList.remove('positive', 'negative');
    }
}

function displayDonations(donations) {
    const donationsList = document.getElementById('donations-list');
    
    if (donations.length === 0) {
        donationsList.innerHTML = '<p>No donations yet.</p>';
        return;
    }
    
    const donationsHtml = donations.map(donation => {
        const dateToUse = donation.entry_date || donation.created_at;
        const date = new Date(dateToUse);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
        });

        const amount = new Intl.NumberFormat('en-US', {
            style: 'currency', currency: 'EUR', minimumFractionDigits: 2
        }).format(donation.amount);

        const amountClass = donation.amount >= 0 ? 'positive' : 'negative';
        const signedAmount = donation.amount > 0 ? `+${amount}` : amount;
        const donatorHtml = donation.donator ? escapeHtml(donation.donator) : 'Anonymous';
        const descHtml = donation.description ? escapeHtml(donation.description) : '';

        return `
            <div class="donation-entry">
                <div class="donation-date date">${formattedDate}</div>
                <div>
                    <div class="donation-donator donator">${donatorHtml}</div>
                    ${descHtml ? `<div class="donation-description desc">${descHtml}</div>` : ''}
                </div>
                <div class="donation-amount ${amountClass}">${signedAmount}</div>
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

function setupDonateButton() {
    const donateBtn = document.getElementById('donate-btn');
    if (donateBtn) {
        donateBtn.addEventListener('click', donate);
    }
}

async function donate() {
    try {
        const keyResponse = await fetch(`${API_BASE_URL}/api/stripe-key`);
        const { publicKey } = await keyResponse.json();
        const stripe = window.Stripe(publicKey);

        const response = await fetch(`${API_BASE_URL}/api/create-donation-checkout-session`, {
            method: 'POST',
        });
        const session = await response.json();
        const result = await stripe.redirectToCheckout({
            sessionId: session.id,
        });

        if (result.error) {
            alert(result.error.message);
        }
    } catch (error) {
        console.error('Error creating checkout session:', error);
        alert('Error creating checkout session. Please try again.');
    }
}

// Scroll-snap page indicators for mobile
function setupScrollSnapIndicators() {
    // Only activate on mobile/tablet
    if (!TABLET_VIEW_QUERY.matches) {
        return;
    }

    const scrollContainer = document.querySelector('.scroll-snap-container');
    const pageDots = document.querySelectorAll('.page-dot');
    
    if (!scrollContainer || !pageDots.length) {
        return;
    }

    // Update active dot based on scroll position
    const updateActiveDot = debounce(() => {
        const scrollLeft = scrollContainer.scrollLeft;
        const windowWidth = window.innerWidth;

        // Calculate which page we're on (0 or 1)
        const currentPage = Math.round(scrollLeft / windowWidth);
        const maxPageIndex = pageDots.length - 1;
        const clampedPage = Math.max(0, Math.min(maxPageIndex, currentPage));
        
        // Update dot active states
        pageDots.forEach((dot, index) => {
            if (index === clampedPage) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }, 100);

    // Listen to scroll events
    scrollContainer.addEventListener('scroll', updateActiveDot);
    window.addEventListener('resize', updateActiveDot);

    // Click handler for dots - scroll to page
    pageDots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            const targetScrollLeft = index * window.innerWidth;
            scrollContainer.scrollTo({
                left: targetScrollLeft,
                top: 0,
                behavior: 'smooth'
            });
        });
    });

    // Initial update
    updateActiveDot();
}

