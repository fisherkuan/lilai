// Google descriptions are HTML (from the calendar UI) or plain text (from other apps). Lilai
// keeps and shows plain text: line breaks kept, a link written as "text (url)", tags dropped.

function decodeHtmlEntities(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, '\'')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

function sanitizeHtmlText(value) {
    if (typeof value !== 'string') {
        return '';
    }

    let text = value;

    text = text.replace(/<(br|hr)\s*\/?>/gi, '\n');
    text = text.replace(/<\/p\s*>/gi, '\n');
    text = text.replace(/<\/div\s*>/gi, '\n');

    text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (match, href, linkText) => {
        const trimmedLinkText = (linkText || '').trim();
        if (trimmedLinkText && trimmedLinkText !== href) {
            return `${trimmedLinkText} (${href})`;
        }
        return href;
    });

    text = text.replace(/<[^>]+>/g, '');

    return decodeHtmlEntities(text)
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .trim();
}

module.exports = { decodeHtmlEntities, sanitizeHtmlText };
