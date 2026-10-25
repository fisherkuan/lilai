// Google Maps place search for the event form's Where field: Places API (New) Autocomplete,
// called from the server so the key never reaches a browser. Results lean towards Leuven
// but are not limited to it. Off without GOOGLE_MAPS_API_KEY; the form then offers the
// owner's list alone.
//
// Each request is one billed Autocomplete call (no Place Details follows), so answers are
// cached and each address gets a small budget per minute.
//
// The key may be restricted to the site in Cloud Console ("Websites"). A server request has no
// Referer of its own, so it names the site's address (`referer`, from publicUrl).

const ENDPOINT = 'https://places.googleapis.com/v1/places:autocomplete';
const LEUVEN = { latitude: 50.8798, longitude: 4.7005 };
const CACHE_MAX = 500;
const CACHE_MS = 24 * 3600 * 1000;
const PER_MINUTE = 30;

function createPlaceAutocomplete({ apiKey, referer = '', fetchImpl = fetch, now = () => Date.now() } = {}) {
    const cache = new Map();
    const budgets = new Map();

    // False once this caller has used its budget for the current minute.
    function allow(caller) {
        const minute = Math.floor(now() / 60000);
        const entry = budgets.get(caller);
        if (!entry || entry.minute !== minute) {
            if (budgets.size > 5000) budgets.clear();
            budgets.set(caller, { minute, count: 1 });
            return true;
        }
        entry.count += 1;
        return entry.count <= PER_MINUTE;
    }

    // [{ name, address, placeId }], at most five. Throws on a refused or failed call.
    async function search(query, { sessionToken, caller = '' } = {}) {
        const input = String(query || '').trim().slice(0, 80);
        if (!apiKey || input.length < 2) return [];
        const key = input.toLowerCase();
        const hit = cache.get(key);
        if (hit && now() - hit.at < CACHE_MS) return hit.results;
        if (!allow(caller)) return [];

        const body = {
            input,
            locationBias: { circle: { center: LEUVEN, radius: 30000 } },
            regionCode: 'be',
            languageCode: 'en'
        };
        if (sessionToken && /^[A-Za-z0-9-]{8,64}$/.test(sessionToken)) body.sessionToken = sessionToken;
        const res = await fetchImpl(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, ...(referer ? { Referer: referer } : {}) },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`Places autocomplete answered ${res.status}`);
        const data = await res.json();
        const results = (data.suggestions || [])
            .map(s => s.placePrediction)
            .filter(p => p && p.placeId)
            .slice(0, 5)
            .map(p => ({
                name: p.structuredFormat?.mainText?.text || p.text?.text || '',
                address: p.structuredFormat?.secondaryText?.text || '',
                placeId: p.placeId
            }))
            .filter(r => r.name);
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(key, { at: now(), results });
        return results;
    }

    return { enabled: Boolean(apiKey), search };
}

module.exports = { createPlaceAutocomplete };
