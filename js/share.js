/* 공유 줄. <div class="share-bar" data-share data-url="…" data-title="…"> 안의 .share-btns 에 단추를 단다.
 *
 * - 휴대폰: "공유하기"가 기기 공유 창을 연다(Web Share API) — 카카오톡 · 문자 · 인스타그램 등이 여기서 다 된다.
 *   PC 브라우저는 대개 이 기능이 없어 단추를 숨긴다.
 * - 어디서나: 링크 복사, X, 페이스북, 네이버, 밴드 — 각 서비스가 공개한 공유 주소를 새 창으로 연다. 앱 키가 필요 없다.
 * - 카카오톡 전용 카드(PC 에서도 카톡으로 보내기)는 카카오 개발자 앱 키가 있어야 한다 — 아직 넣지 않았다.
 *
 * 블로그 글은 tools/build-blog.js 가 이 줄을 만든다. 다른 페이지에도 같은 모양으로 붙이면 된다.
 */
(function () {
    'use strict';

    const tr = (key, ko) => (window.I18N ? window.I18N.t(key, ko) : ko);
    const enc = encodeURIComponent;

    function el(tag, props, text) {
        const n = document.createElement(tag);
        Object.keys(props || {}).forEach(k => { if (k === 'className') n.className = props[k]; else n.setAttribute(k, props[k]); });
        if (text != null) n.textContent = text;
        return n;
    }

    async function copy(url, btn) {
        const done = () => {
            const old = btn.textContent;
            btn.textContent = tr('share.copied', '복사했습니다');
            setTimeout(() => { btn.textContent = old; }, 1600);
        };
        try {
            await navigator.clipboard.writeText(url);
            done();
        } catch (e) {
            window.prompt(tr('share.copyManual', '아래 주소를 복사해 주세요'), url);
        }
    }

    function build(bar) {
        const box = bar.querySelector('.share-btns');
        if (!box || box.childElementCount) return;
        const canon = document.querySelector('link[rel="canonical"]');
        // 영어 화면에서 공유하면 영어 제목에 ?lang=en 주소를 보낸다. 받는 쪽도 영어로 열리게.
        const en = window.I18N && window.I18N.lang === 'en';
        let url = bar.dataset.url || (canon && canon.href) || location.href.split('#')[0];
        if (en) { const u = new URL(url, location.href); u.searchParams.set('lang', 'en'); url = u.href; }
        const title = (en && bar.dataset.titleEn) || bar.dataset.title || document.title;

        if (navigator.share) {
            const b = el('button', { type: 'button', className: 'share-btn is-main' }, tr('share.native', '공유하기 (카톡 등)'));
            b.addEventListener('click', () => { navigator.share({ title: title, url: url }).catch(() => { /* 닫았거나 막힘 */ }); });
            box.appendChild(b);
        }
        const c = el('button', { type: 'button', className: 'share-btn' }, tr('share.copy', '링크 복사'));
        c.addEventListener('click', () => copy(url, c));
        box.appendChild(c);

        [
            ['X', `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`],
            [tr('share.facebook', '페이스북'), `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
            [tr('share.naver', '네이버'), `https://share.naver.com/web/shareView?url=${enc(url)}&title=${enc(title)}`],
            [tr('share.band', '밴드'), `https://band.us/plugin/share?body=${enc(title + '\n' + url)}&route=${enc(url)}`],
        ].forEach(([label, href]) => {
            box.appendChild(el('a', { className: 'share-btn', href: href, target: '_blank', rel: 'noopener noreferrer' }, label));
        });
    }

    const start = () => document.querySelectorAll('[data-share]').forEach(build);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
