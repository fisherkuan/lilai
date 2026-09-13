/*
 * The two rules an edit has that a create does not.
 *
 * Both are easy to get wrong in a way nothing else would notice: a blank contact field
 * silently wiping someone's email, or an unrelated edit quietly moving an entry's place in
 * the night's order. They live here so they can be tested without standing up the route.
 */

const { sampleSendAfter } = require('./booking-settings');

/**
 * Fill in contact details the edit form could not show.
 *
 * Email and phone never reach the board, so an edit form starts with them blank. Blank
 * therefore has to mean "keep what is stored", not "clear it" — otherwise every edit of
 * anything would destroy the contact details the request needs.
 *
 * The name too: the sheet sends a profile id, never a name, so an entry whose person has
 * since left the address book arrives with neither and must keep the one it was made with.
 */
function mergeContact(body, stored) {
    const supplied = (value) => typeof value === 'string' && value.trim() !== '';
    return {
        ...body,
        name: supplied(body.name) ? body.name : stored.name,
        email: supplied(body.email) ? body.email : stored.email,
        phone: supplied(body.phone) ? body.phone : stored.phone
    };
}

/**
 * The moment an edited entry may be submitted.
 *
 * The random delay is re-rolled ONLY when the opening moves. Correcting a spelling should
 * not cost someone their place in the order requests go out in; changing which midnight
 * the entry belongs to has to, because the old delay was measured from a different opening.
 */
function sendAfterForEdit(stored, opensAt, settings, random = Math.random) {
    const moved = new Date(stored.opens_at).getTime() !== opensAt.getTime();
    return moved ? sampleSendAfter(opensAt, settings, random) : stored.send_after;
}

module.exports = { mergeContact, sendAfterForEdit };
