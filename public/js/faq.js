const FAQ_LANGS = {
    'en': {
        file: 'faq.md',
        htmlLang: 'en',
        title: 'FAQ — Lilai',
        back: 'Back to events',
        heading: 'FAQ',
        intro: 'Everything you might wonder about RSVPs, calendars, donations, and how this little app is run.',
        loading: 'Loading FAQ...',
        error: 'Unable to load FAQ content right now. Please try again later.'
    },
    'zh-TW': {
        file: 'faq.zh-TW.md',
        htmlLang: 'zh-Hant-TW',
        title: '常見問題 — Lilai',
        back: '回到活動',
        heading: '常見問題',
        intro: '關於報名、行事曆、捐款，還有這個小網站是怎麼運作的。',
        loading: '載入中...',
        error: '目前無法載入常見問題，請稍後再試。'
    }
};

const FAQ_LANG_KEY = 'faqLang';
const faqMarkdownCache = new Map();

function readStoredLang() {
    try {
        const stored = localStorage.getItem(FAQ_LANG_KEY);
        return FAQ_LANGS[stored] ? stored : null;
    } catch (error) {
        return null;
    }
}

function storeLang(lang) {
    try {
        localStorage.setItem(FAQ_LANG_KEY, lang);
    } catch (error) {
        /* private browsing — the choice just does not survive the visit */
    }
}

function detectLang() {
    const stored = readStoredLang();
    if (stored) return stored;
    const browserLangs = navigator.languages || [navigator.language || ''];
    const prefersChinese = browserLangs.some(tag => String(tag).toLowerCase().startsWith('zh'));
    return prefersChinese ? 'zh-TW' : 'en';
}

document.addEventListener('DOMContentLoaded', () => {
    const faqContainer = document.getElementById('faq-content');
    if (!faqContainer) return;

    const buttons = Array.from(document.querySelectorAll('.lang-switch [data-lang]'));
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const lang = button.dataset.lang;
            if (!FAQ_LANGS[lang]) return;
            storeLang(lang);
            applyLang(lang, faqContainer, buttons);
        });
    });

    applyLang(detectLang(), faqContainer, buttons);
});

async function applyLang(lang, faqContainer, buttons) {
    const strings = FAQ_LANGS[lang];

    document.documentElement.lang = strings.htmlLang;
    document.title = strings.title;
    setText('back-link-label', strings.back);
    setText('faq-title', strings.heading);
    setText('faq-intro', strings.intro);

    buttons.forEach(button => {
        const active = button.dataset.lang === lang;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    faqContainer.setAttribute('aria-busy', 'true');
    faqContainer.innerHTML = `<p class="state-line">${escapeHtml(strings.loading)}</p>`;

    try {
        faqContainer.innerHTML = renderFaqMarkdown(await loadFaqMarkdown(lang));
    } catch (error) {
        console.error('Error loading FAQ content:', error);
        faqContainer.innerHTML = `<p class="state-line is-error">${escapeHtml(strings.error)}</p>`;
    } finally {
        faqContainer.setAttribute('aria-busy', 'false');
    }
}

async function loadFaqMarkdown(lang) {
    if (faqMarkdownCache.has(lang)) return faqMarkdownCache.get(lang);
    const response = await fetch(FAQ_LANGS[lang].file);
    if (!response.ok) throw new Error(`Failed to load FAQ (status ${response.status})`);
    const markdownText = await response.text();
    faqMarkdownCache.set(lang, markdownText);
    return markdownText;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

/**
 * Renders FAQ markdown into accordion structure.
 * - `# Title` and `## Section` → section headers (<h2>).
 * - `### Question` → <details><summary>Question</summary>...answer...</details>.
 * Inline markdown: **bold**, *italic*, [label](url), line breaks.
 */
function renderFaqMarkdown(markdown) {
    const lines = markdown.split(/\r?\n/);
    let out = '';

    let currentAnswer = [];        // lines of current FAQ item answer
    let currentQuestion = null;    // current question text
    let listBuffer = null;         // { type: 'ol'|'ul', items: [] }
    let tableBuffer = null;        // rows of a pipe table, header first

    const flushList = () => {
        if (!listBuffer || listBuffer.items.length === 0) {
            listBuffer = null;
            return '';
        }
        const tag = listBuffer.type;
        let html = `<${tag}>`;
        listBuffer.items.forEach(i => { html += `<li>${inline(i)}</li>`; });
        html += `</${tag}>`;
        listBuffer = null;
        return html;
    };

    const splitRow = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
    const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
    const isTableDivider = (line) => /^\s*\|[\s|:-]+\|\s*$/.test(line);

    const flushTable = () => {
        if (!tableBuffer || tableBuffer.length === 0) {
            tableBuffer = null;
            return '';
        }
        const [header, ...body] = tableBuffer;
        let html = '<div class="faq-table-wrap"><table class="faq-table"><thead><tr>';
        header.forEach(cell => { html += `<th>${inline(cell)}</th>`; });
        html += '</tr></thead><tbody>';
        body.forEach(row => {
            html += '<tr>';
            header.forEach((_, i) => { html += `<td>${inline(row[i] || '')}</td>`; });
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        tableBuffer = null;
        return html;
    };

    const flushAnswer = () => {
        if (currentQuestion === null) return '';
        let ansHtml = '';
        let paraBuf = [];

        const flushPara = () => {
            if (paraBuf.length === 0) return;
            const text = paraBuf.join(' ').trim();
            if (text) ansHtml += `<p>${inline(text)}</p>`;
            paraBuf = [];
        };

        currentAnswer.forEach(line => {
            const ul = line.match(/^\s*[-*+]\s+(.*)$/);
            const ol = line.match(/^\s*(\d+)\.\s+(.*)$/);
            if (isTableRow(line)) {
                flushPara();
                ansHtml += flushList();
                if (isTableDivider(line)) return;   // the |---|---| rule carries no content
                if (!tableBuffer) tableBuffer = [];
                tableBuffer.push(splitRow(line));
            } else if (ul || ol) {
                flushPara();
                ansHtml += flushTable();
                const type = ol ? 'ol' : 'ul';
                if (!listBuffer || listBuffer.type !== type) {
                    ansHtml += flushList();
                    listBuffer = { type, items: [] };
                }
                listBuffer.items.push(ol ? ol[2] : ul[1]);
            } else if (line.trim() === '') {
                flushPara();
                ansHtml += flushList();
                ansHtml += flushTable();
            } else {
                ansHtml += flushList();
                ansHtml += flushTable();
                paraBuf.push(line.trim());
            }
        });
        flushPara();
        ansHtml += flushList();
        ansHtml += flushTable();

        const html = `
            <details class="faq-item">
                <summary>
                    <span class="faq-q">${inline(currentQuestion)}</span>
                    <svg class="faq-toggle" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                </summary>
                <div class="faq-answer">${ansHtml}</div>
            </details>
        `;
        currentQuestion = null;
        currentAnswer = [];
        return html;
    };

    for (const line of lines) {
        const h1 = line.match(/^#\s+(.*)$/);
        const h2 = line.match(/^##\s+(.*)$/);
        const h3 = line.match(/^###\s+(.*)$/);

        if (h3) {
            out += flushAnswer();
            currentQuestion = h3[1].trim();
            currentAnswer = [];
        } else if (h2) {
            out += flushAnswer();
            out += `<h2 class="faq-section-header">${inline(h2[1].trim())}</h2>`;
        } else if (h1) {
            // skip — handled in page hero
        } else if (currentQuestion !== null) {
            currentAnswer.push(line);
        }
        // otherwise ignore preamble text before first ###
    }
    out += flushAnswer();
    return out;
}

function inline(text) {
    if (!text) return '';
    // Links [label](url)
    const withLinks = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
        const safeHref = href.trim().replace(/"/g, '&quot;');
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${inline(label)}</a>`;
    });
    return withLinks
        .replace(/__(.*?)__/g, '<strong>$1</strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
}
