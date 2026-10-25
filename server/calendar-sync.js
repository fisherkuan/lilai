// The legacy feed: before Lilai took a calendar over (calendar-import.js), it read the
// calendar's public iCal feed. That path stays only for a calendar not yet imported (Google
// credentials missing), and it never touches a row Lilai owns (`managed`).
//
// Which unmanaged rows a feed refresh may delete. Deleting an event cascades to its RSVPs,
// so a calendar whose feed could not be read keeps everything it had: an outage must never
// look like a calendar that was emptied.

// dbRows: [{id, source}] unmanaged rows in the DB. calendarEvents: [{id, source}] from the
// feeds. unreadSources: calendar ids whose feed was not read this time (failed, or imported).
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
