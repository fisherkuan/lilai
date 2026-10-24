// Which DB events a calendar sync may delete. Deleting an event cascades to its RSVPs,
// so a calendar whose feed could not be read keeps everything it had: an outage must
// never look like a calendar that was emptied.

// dbRows: [{id, source}] currently in the DB. calendarEvents: [{id, source}] from the feeds.
// unreadSources: calendar ids whose feed failed this time. keepIds: events to keep even so,
// because Google says they still exist (see appEventsToCheck).
function findStaleEventIds(dbRows, calendarEvents, unreadSources, keepIds = new Set()) {
    const feedIds = new Set(calendarEvents.map(event => event.id));
    return dbRows
        .filter(row => !unreadSources.has(row.source) && !feedIds.has(row.id) && !keepIds.has(row.id))
        .map(row => row.id);
}

// Google's public feed can take hours to show an event made through the API, so an event
// Lilai made that is missing from a feed is checked with Google before it may go: missing
// from the feed alone would delete it, and its RSVPs, minutes after it was made.
// dbRows: [{id, source, google_event_id}]. Returns the rows to ask Google about.
function appEventsToCheck(dbRows, calendarEvents, unreadSources) {
    const feedIds = new Set(calendarEvents.map(event => event.id));
    return dbRows.filter(row => row.google_event_id
        && !unreadSources.has(row.source) && !feedIds.has(row.id));
}

// Google's answer for one such row -> keep it this round? A row Google could not answer
// for is kept for a day after it was made, then treated like any other dropped event,
// so a lost credential cannot pin a deleted event forever.
const UNANSWERED_GRACE_MS = 24 * 60 * 60 * 1000;
function keepAppEvent(gone, createdInAppAt, nowMs = Date.now()) {
    if (gone === false) return true;
    if (gone === true) return false;
    return createdInAppAt != null && nowMs - new Date(createdInAppAt).getTime() < UNANSWERED_GRACE_MS;
}

// A 200 that is not iCalendar (a login page, an error page) carries no VEVENTs and
// would read as an empty calendar.
function looksLikeIcsFeed(text) {
    return typeof text === 'string' && text.includes('BEGIN:VCALENDAR');
}

module.exports = { findStaleEventIds, appEventsToCheck, keepAppEvent, looksLikeIcsFeed };
