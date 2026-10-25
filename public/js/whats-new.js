/*
 * What's new: a guided tour of making an event in Lilai (events used to be made in Google
 * Calendar until 2026-10-24). Home opens it by itself once per device, on the first visit after
 * the release; `lilai.tourSeen` keeps the version seen, so it never opens by itself again. The
 * footer's "What's new" replays it. EN and 繁中 share the FAQ's choice (`faqLang`).
 *
 * Self-contained like feedback.js: the sheet is built on first open. Media lives in
 * /whats-new/: screenshots and short muted clips recorded from the real app.
 */
(() => {
    'use strict';

    const VERSION = '2026-10-events';
    const SEEN_KEY = 'lilai.tourSeen';
    const LANG_KEY = 'faqLang';
    const MEDIA = '/whats-new/';

    const STRINGS = {
        en: {
            htmlLang: 'en',
            label: "What's new",
            step: (i, n) => `${i} of ${n}`,
            back: 'Back',
            next: 'Next',
            make: 'Make an event',
            close: 'Close'
        },
        'zh-TW': {
            htmlLang: 'zh-Hant-TW',
            label: '新功能',
            step: (i, n) => `${i} / ${n}`,
            back: '上一步',
            next: '下一步',
            make: '建立活動',
            close: '關閉'
        }
    };

    const STEPS = [
        {
            image: 'home.jpg',
            en: ['Events now start in Lilai', 'You used to add events in Google Calendar. Now you make them here: tap + on Home. Every event still gets a copy in its Google calendar, so subscriptions keep working.'],
            'zh-TW': ['活動現在在 Lilai 建立', '以前要到 Google 日曆新增活動，現在直接在這裡建立：點首頁的 +。每個活動仍會自動複製一份到 Google 日曆，已訂閱的行事曆照常更新。']
        },
        {
            image: 'signin.jpg',
            en: ['Sign in once', 'An event belongs to your email. Lilai emails you a sign-in link; open it on this phone and you land back in the form. This device stays signed in for 90 days.'],
            'zh-TW': ['先登入一次', '建立活動會綁定你的 email。Lilai 會寄登入連結給你，在這支手機上打開，就會回到建立活動的表單。這台裝置會保持登入 90 天。']
        },
        {
            video: 'make-fill',
            en: ['Title, time and place', 'Pick a calendar, a title and a day. Times scroll on a wheel, on the hour or half hour. Where suggests the usual courts as you type. Repeats makes a weekly series in one go.'],
            'zh-TW': ['標題、時間、地點', '選行事曆、輸入標題、選日期。時間用滾輪選，以整點或半點為單位。輸入地點時會列出常用場地。選 Repeats 可以一次建立每週重複的活動。']
        },
        {
            video: 'make-who',
            en: ['Who gets a place', 'Set a limit, and once it is full Lilai keeps a waiting list: when someone leaves, the next name moves up. Choose "I approve each person" to accept each request yourself.'],
            'zh-TW': ['名額與報名方式', '設定名額後，額滿會自動排候補：有人退出，下一位就自動遞補。選「I approve each person」，每個人報名都要經過你同意。']
        },
        {
            image: 'made.jpg',
            en: ['Keep your management link', 'Making the event gives you its management link. Copy it or share it with a co-host: anyone with the link can manage the event. Lost it? Profile lists every event you host.'],
            'zh-TW': ['保存管理連結', '建立後會拿到活動的管理連結。可以複製，或分享給共同主辦：有連結的人都能管理這個活動。連結不見了？到 Profile 可以找到你主辦的所有活動。']
        },
        {
            video: 'manage',
            en: ['Manage it here, not in Google', 'Edit, cancel or restore the event, and accept or decline requests. Each change reaches the Google calendar by itself. Changes made in Google Calendar are no longer read.'],
            'zh-TW': ['在這裡管理，不用再進 Google', '可以修改、取消或恢復活動，也能接受或婉拒報名。每次變更都會自動同步到 Google 日曆；直接在 Google 日曆修改的內容，Lilai 不會再讀取。']
        }
    ];

    let root = null;
    let index = 0;
    let lang = 'en';
    let returnFocus = null;

    function read(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }

    function write(key, value) {
        try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
    }

    function detectLang() {
        const stored = read(LANG_KEY);
        if (STRINGS[stored]) return stored;
        const tags = navigator.languages || [navigator.language || ''];
        return tags.some(t => String(t).toLowerCase().startsWith('zh')) ? 'zh-TW' : 'en';
    }

    function reducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function mediaHtml(step, i) {
        if (step.video) {
            // Only the shown clip plays; preload none so the tour costs one clip at a time.
            return `<video class="tour-shot" data-index="${i}" src="${MEDIA}${step.video}.mp4" poster="${MEDIA}${step.video}-poster.jpg"`
                + ' muted loop playsinline preload="none" aria-hidden="true"></video>';
        }
        return `<img class="tour-shot" data-index="${i}" src="${MEDIA}${step.image}" alt="" loading="lazy" decoding="async">`;
    }

    function build() {
        root = document.createElement('div');
        root.id = 'tour-sheet';
        root.className = 'modal hidden';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'tour-title');
        root.innerHTML = `
            <div class="sheet sheet-tour" tabindex="-1">
                <div class="sheet-head tour-head">
                    <div class="lang-switch" role="group" aria-label="Language / 語言">
                        <button type="button" class="lang-btn" data-lang="en" aria-pressed="false" lang="en">EN</button>
                        <button type="button" class="lang-btn" data-lang="zh-TW" aria-pressed="false" lang="zh-Hant">繁中</button>
                    </div>
                    <button type="button" class="icon-btn" data-tour-close>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                    </button>
                </div>
                <div class="tour-stage">
                    <div class="tour-frame">${STEPS.map(mediaHtml).join('')}</div>
                </div>
                <div class="tour-text" aria-live="polite">
                    <p class="tour-step" id="tour-step"></p>
                    <h3 class="tour-title" id="tour-title"></h3>
                    <p class="tour-body" id="tour-body"></p>
                </div>
                <ol class="tour-marks" aria-hidden="true">${STEPS.map(() => '<li></li>').join('')}</ol>
                <div class="sheet-actions tour-actions">
                    <button type="button" class="btn btn-line" data-tour-back></button>
                    <button type="button" class="btn btn-solid" data-tour-next></button>
                </div>
            </div>`;
        document.body.append(root);

        root.addEventListener('click', (e) => {
            if (e.target === root || e.target.closest('[data-tour-close]')) return close();
            const langBtn = e.target.closest('[data-lang]');
            if (langBtn) {
                lang = langBtn.dataset.lang;
                write(LANG_KEY, lang);
                return render();
            }
            if (e.target.closest('[data-tour-back]')) return go(index - 1);
            if (e.target.closest('[data-tour-next]')) {
                if (index < STEPS.length - 1) return go(index + 1);
                close();
                const make = document.querySelector('[data-make-event]');
                if (make) make.click();
            }
        });
        root.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
            if (e.target.closest('input, textarea')) return;
            if (e.key === 'ArrowRight') go(index + 1);
            if (e.key === 'ArrowLeft') go(index - 1);
        });

        // A sideways swipe on the picture turns the page.
        let startX = null;
        let startY = null;
        const stage = root.querySelector('.tour-stage');
        stage.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });
        stage.addEventListener('touchend', (e) => {
            if (startX === null) return;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;
            startX = null;
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
        });
    }

    function go(i) {
        if (i < 0 || i >= STEPS.length) return;
        index = i;
        render();
    }

    function render() {
        const s = STRINGS[lang];
        const step = STEPS[index];
        const [title, body] = step[lang];
        const last = index === STEPS.length - 1;

        root.lang = s.htmlLang;
        root.setAttribute('aria-label', s.label);
        root.querySelector('[data-tour-close].icon-btn').setAttribute('aria-label', s.close);
        root.querySelector('#tour-step').textContent = `${s.label} · ${s.step(index + 1, STEPS.length)}`;
        root.querySelector('#tour-title').textContent = title;
        root.querySelector('#tour-body').textContent = body;
        root.querySelectorAll('[data-lang]').forEach(b => {
            const on = b.dataset.lang === lang;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
        const back = root.querySelector('[data-tour-back]');
        back.textContent = s.back;
        back.hidden = index === 0;
        root.querySelector('[data-tour-next]').textContent = last ? s.make : s.next;
        root.querySelectorAll('.tour-marks li').forEach((li, i) => li.classList.toggle('is-on', i <= index));

        root.querySelectorAll('.tour-shot').forEach(el => {
            const shown = Number(el.dataset.index) === index;
            el.classList.toggle('is-shown', shown);
            if (el.tagName !== 'VIDEO') return;
            if (shown && !reducedMotion()) {
                el.currentTime = 0;
                const playing = el.play();
                if (playing) playing.catch(() => { /* autoplay refused: the poster stays */ });
            } else {
                el.pause();
            }
        });
        // Fetch the next picture ahead, so turning the page shows it at once.
        const next = root.querySelector(`.tour-shot[data-index="${index + 1}"]`);
        if (next && next.tagName === 'VIDEO' && next.preload === 'none') next.preload = 'auto';
    }

    function open() {
        if (!root) build();
        returnFocus = document.activeElement;
        lang = detectLang();
        index = 0;
        root.classList.remove('hidden');
        render();
        // Focus the sheet itself: a ring on Next the moment the tour opens reads as a warning.
        setTimeout(() => root.querySelector('.sheet-tour').focus(), 60);
    }

    function close() {
        if (!root || root.classList.contains('hidden')) return;
        root.classList.add('hidden');
        root.querySelectorAll('video').forEach(v => v.pause());
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        returnFocus = null;
    }

    // The footer's way back in.
    function addFooterLink() {
        const footer = document.querySelector('.colophon');
        if (!footer) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-btn colophon-link';
        button.textContent = "What's new";
        button.addEventListener('click', open);
        footer.append(button);
    }

    // Once per device. A visit that lands on a link (#new, #event-…, #chat-…) has somewhere to
    // be, so the tour waits for a later visit. Without storage it never opens by itself, rather
    // than on every visit.
    function openOnFirstVisit() {
        if (location.hash) return;
        if (read(SEEN_KEY) === VERSION) return;
        if (!write(SEEN_KEY, VERSION)) return;
        open();
    }

    addFooterLink();
    window.WhatsNew = { open };
    if (document.readyState === 'complete') openOnFirstVisit();
    else window.addEventListener('load', openOnFirstVisit, { once: true });
})();
