/* 한국어 ↔ 영어 전환. 사전은 js/i18n-dict.js 에 있다.
 *
 * 문장을 페이지마다 흩어 두지 않는 게 요점이다. 문구를 고칠 곳은 사전 한 군데다.
 *
 * 세 가지 표기를 쓴다.
 *   data-i18n="key"       사전에서 문장을 가져와 텍스트로 넣는다
 *   data-i18n-html="key"  같지만 <b> 같은 태그가 든 문장용
 *   data-i18n-en="문장"   영문을 속성에 직접 달아 둔다. 숫자가 섞여 회차마다
 *                         달라지는 문장(생성기가 찍는 해설)이 여기 해당한다
 *   data-i18n-attr="placeholder:key title:key"   속성값을 바꾼다
 *
 * 한국어 원문은 HTML 에 그대로 남는다. 검색 로봇이 보는 것도, 사전이 비었을 때
 * 보이는 것도 한국어다 — 영어가 빠진 자리에 빈 화면이 나오지 않는다.
 *
 * 언어를 바꾸면 페이지를 다시 읽는다. 차트와 표는 스크립트가 그리므로, 이미
 * 그려진 것을 일일이 다시 칠하는 것보다 한 번 새로 그리는 쪽이 어긋날 여지가 없다.
 */
(function (global) {
    'use strict';

    const STORE = 'lottodraw.lang';
    const LANGS = ['ko', 'en'];
    const DEFAULT = 'ko';

    const dict = () => global.I18N_DICT || {};

    const store = {
        get() { try { return localStorage.getItem(STORE); } catch (e) { return null; } },
        set(v) { try { localStorage.setItem(STORE, v); } catch (e) { /* 프라이빗 모드 */ } },
    };

    // 주소의 ?lang= 가 가장 세다. 링크 하나로 영어 화면을 보여줄 수 있어야 한다.
    function detect() {
        let q = null;
        try { q = new URLSearchParams(location.search).get('lang'); } catch (e) { /* 구형 */ }
        if (q && LANGS.indexOf(q) !== -1) return q;
        const saved = store.get();
        if (saved && LANGS.indexOf(saved) !== -1) return saved;
        // 브라우저 언어로 자동 판단하지 않는다. 검색 로봇 상당수가 영어로 보고하는데,
        // 그때 영문 화면을 색인하면 한국어 검색에서 손해를 본다.
        return DEFAULT;
    }

    let lang = detect();

    // 값이 끼워지는 문장: t('gen.tries', { n: 3 }) → "3번째 시도"
    function f(key, vars) {
        return String(t(key)).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
    }

    function t(key, fallback) {
        const row = dict()[key];
        if (!row) return fallback !== undefined ? fallback : key;
        return row[lang] !== undefined ? row[lang] : (row.ko !== undefined ? row.ko : key);
    }

    // 한국어 원문을 처음 한 번만 붙잡아 둔다. 영어로 갔다가 돌아올 때 쓴다.
    // dataset 키는 붙임표 뒤에 소문자가 오면 브라우저가 예외를 던진다("aria-label" 등).
    // 그래서 슬롯 이름에서 영숫자만 남긴다.
    function original(el, slot, current) {
        const k = 'i18nKo' + String(slot).replace(/[^A-Za-z0-9]/g, '');
        if (el.dataset[k] === undefined) el.dataset[k] = current;
        return el.dataset[k];
    }

    function applyTo(root) {
        const scope = root || document;

        scope.querySelectorAll('[data-i18n]').forEach(el => {
            const ko = original(el, 'Text', el.textContent);
            el.textContent = lang === 'ko' ? ko : t(el.dataset.i18n, ko);
        });

        scope.querySelectorAll('[data-i18n-html]').forEach(el => {
            const ko = original(el, 'Html', el.innerHTML);
            el.innerHTML = lang === 'ko' ? ko : t(el.dataset.i18nHtml, ko);
        });

        // 생성기가 찍어 둔 영문 문장. 숫자가 든 해설이라 사전에 키를 둘 수 없다.
        scope.querySelectorAll('[data-i18n-en]').forEach(el => {
            const ko = original(el, 'En', el.innerHTML);
            el.innerHTML = lang === 'ko' ? ko : el.dataset.i18nEn;
        });

        scope.querySelectorAll('[data-i18n-attr]').forEach(el => {
            el.dataset.i18nAttr.trim().split(/\s+/).forEach(pair => {
                const cut = pair.indexOf(':');
                if (cut < 1) return;
                const attr = pair.slice(0, cut);
                const key = pair.slice(cut + 1);
                const ko = original(el, 'Attr_' + attr, el.getAttribute(attr) || '');
                el.setAttribute(attr, lang === 'ko' ? ko : t(key, ko));
            });
        });
    }

    function paintToggle() {
        document.querySelectorAll('[data-lang-btn]').forEach(btn => {
            const on = btn.dataset.langBtn === lang;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.classList.toggle('is-on', on);
        });
    }

    function setLang(next) {
        if (LANGS.indexOf(next) === -1 || next === lang) return;
        store.set(next);
        // ?lang= 가 주소에 남아 있으면 저장값보다 세서 되돌아가지 않는다. 지우고 다시 읽는다.
        try {
            const url = new URL(location.href);
            url.searchParams.delete('lang');
            location.replace(url.toString());
        } catch (e) {
            location.reload();
        }
    }

    function init() {
        document.documentElement.setAttribute('lang', lang);
        document.documentElement.setAttribute('data-lang', lang);
        // 단추를 먼저 단다. 번역 중에 무엇이 잘못돼도 언어 전환은 살아 있어야 한다.
        document.addEventListener('click', e => {
            const btn = e.target && e.target.closest && e.target.closest('[data-lang-btn]');
            if (btn) { e.preventDefault(); setLang(btn.dataset.langBtn); }
        });
        try {
            applyTo(document);
        } catch (err) {
            console.error('i18n: 번역 중 오류', err);
        }
        paintToggle();
        // 영어 화면에서 잠깐 한국어가 비치는 것을 막으려고 가려 뒀다 (css 의 .i18n-wait)
        document.documentElement.classList.remove('i18n-wait');
    }

    global.I18N = {
        get lang() { return lang; },
        t: t,
        f: f,
        apply: applyTo,     // 스크립트가 새로 그린 곳만 다시 칠할 때
        set: setLang,
    };

    // 로그인·좋아요(js/account.js)를 붙인다. 공개 페이지는 모두 이 파일을 읽으므로 여기서 한 번에 —
    // 페이지마다 <script> 를 따로 넣지 않는다. 같은 폴더의 account.js 를 쓴다(blog/·round/ 에서도 맞는 주소).
    (function loadAccount() {
        const me = document.currentScript;
        if (!me || !me.src || !document.createElement) return;
        const s = document.createElement('script');
        s.src = me.src.replace(/i18n\.js(\?.*)?$/, 'account.js');
        s.defer = true;
        document.head.appendChild(s);
    })();

    // 영어로 볼 때만 잠시 가린다. 한국어(대다수)는 가리는 일 없이 그대로 그려진다.
    if (lang !== 'ko') document.documentElement.classList.add('i18n-wait');

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);
