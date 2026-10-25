// PlaceSearch: ranks the owner's place list (config/app.json `places`) against what someone
// types, the closest match first, the way a map search does. Pure; the event form draws the list.
//
// A place is { name, address?, aliases? }. Matching ignores case, accents and spaces, so
// "tsh1" finds "TSH 1" and "topsport" finds the address "Topsporthal, …". Ties keep the
// list's own order, which is the owner's order of importance.
(function (root) {
    'use strict';

    function fold(text) {
        return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }
    const LOOSE_MAX = 20; // every outright match scores above this, every guess below
    const compact = (text) => fold(text).replace(/[\s\-_.,'’&]+/g, '');
    const words = (text) => fold(text).split(/[\s\-_.,'’&/()]+/).filter(Boolean);

    // Letters of the query in order inside the target, as in "tpsh" for "topsporthal".
    function subsequence(query, target) {
        let i = 0;
        for (const ch of target) { if (ch === query[i]) i += 1; if (i === query.length) return true; }
        return false;
    }

    // How well one piece of text matches: 0 for none, higher for closer. Addresses skip the
    // loose letters-in-order match: they hold so many letters that nearly anything would match.
    function fieldScore(query, text, weight, loose = true) {
        const q = compact(query);
        const t = compact(text);
        if (!q || !t) return 0;
        if (t === q) return 100 * weight;
        if (t.startsWith(q)) return 80 * weight;
        const tokens = words(query);
        if (t.includes(q) && words(text).some(w => w.startsWith(tokens[0]))) return 65 * weight;
        if (t.includes(q)) return 45 * weight;
        if (tokens.length > 1 && tokens.every(tok => t.includes(compact(tok)))) return 35 * weight;
        if (loose && q.length >= 3 && subsequence(q, t)) return 12 * weight; // below LOOSE_MAX
        return 0;
    }

    function score(place, query) {
        return Math.max(
            fieldScore(query, place.name, 1),
            ...(place.aliases || []).map(a => fieldScore(query, a, 0.9)),
            fieldScore(query, place.address, 0.6, false)
        );
    }

    // The places matching `query`, best first, at most `limit`. An empty query lists them all.
    function rank(places, query, limit = 8) {
        const list = Array.isArray(places) ? places.filter(p => p && p.name) : [];
        if (!fold(query)) return list.slice(0, limit);
        const scored = list.map((place, index) => ({ place, index, score: score(place, query) }));
        // Letters-in-order guesses show only when nothing matches outright.
        const floor = scored.some(r => r.score >= LOOSE_MAX) ? LOOSE_MAX : 0;
        return scored
            .filter(r => r.score > floor)
            .sort((a, b) => b.score - a.score || a.index - b.index)
            .slice(0, limit)
            .map(r => r.place);
    }

    const PlaceSearch = { rank, score, fold };
    if (typeof module !== 'undefined' && module.exports) module.exports = PlaceSearch;
    else root.PlaceSearch = PlaceSearch;
})(typeof window !== 'undefined' ? window : globalThis);
