const API_BASE_URL = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('donation-form');
    form.addEventListener('submit', handleSubmit);
    document.getElementById('reset-btn').addEventListener('click', resetForm);
});

function setAmountError(message) {
    const el = document.getElementById('amount-error');
    el.textContent = message || '';
    el.hidden = !message;
}

function handleSubmit(e) {
    e.preventDefault();
    setAmountError('');

    const formData = new FormData(e.target);
    const amount = parseFloat(formData.get('amount'));
    const donator = formData.get('donator').trim();
    const description = formData.get('description').trim();
    const entryDate = formData.get('entry_date');

    if (!amount || amount === 0) {
        setAmountError('Amount is required and cannot be zero.');
        return;
    }

    const donationData = {
        amount: amount,
        donator: donator || null,
        description: description || null,
        entry_date: entryDate || null
    };

    submitDonation(donationData);
}

async function submitDonation(data) {
    showMessage('Submitting…', 'loading');

    try {
        // The admin session's cookie goes along; a 401 sends us to sign-in (js/admin-session.js).
        const response = await AdminSession.adminFetch(`${API_BASE_URL}/api/donations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            resetFields();
            showMessage(`Added: ${formatEntryPrint(data)}`, 'success');
        } else {
            showMessage(result.message || 'Error adding donation entry.', 'error');
        }
    } catch (error) {
        console.error('Error submitting donation:', error);
        showMessage('Error submitting donation. Please try again.', 'error');
    }
}

// Print-in-place confirmation text (Print-Not-Toast): say exactly what was added.
function formatEntryPrint(data) {
    const amountLabel = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(data.amount);
    return data.description ? `${amountLabel} — ${data.description}` : amountLabel;
}

function showMessage(message, type) {
    const messageDiv = document.getElementById('form-message');
    messageDiv.textContent = message;
    messageDiv.className = `row-status${type === 'error' ? ' is-error' : ''}`;
    messageDiv.hidden = !message;
}

function resetFields() {
    document.getElementById('donation-form').reset();
    setAmountError('');
}

// The Reset button discards the draft and any printed result. A successful
// submit only clears the fields (resetFields) — the result stays printed in
// place until the next submit or an explicit reset replaces it.
function resetForm() {
    resetFields();
    showMessage('', '');
}
