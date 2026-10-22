// Which DB events a calendar sync may delete. Deleting an event cascades to its RSVPs,
// so a calendar whose feed could not be read keeps everything it had: an outage must
// never look like a calendar that was emptied.

// dbRows: [{id, source}] currently in the DB. calendarEvents: [{id, source}] from the feeds.
// unreadSources: calendar ids whose feed failed this time.
function findStaleEventIds(dbRows, calendarEvents, unreadSources) {
    const feedIds = new Set(calendarEvents.map(event => event.id));
    return dbRows
        .filter(row => !unreadSources.has(row.source) && !feedIds.has(row.id))
        .map(row => row.id);
}

// A 200 that is not iCalendar (a login page, an error page) carries no VEVENTs and
// would read as an empty calendar.
function looksLikeIcsFeed(text) {
    return typeof text === 'string' && text.includes('BEGIN:VCALENDAR');
}

module.exports = { findStaleEventIds, looksLikeIcsFeed };
