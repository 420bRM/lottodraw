/* 블로그 조회수. tools/build-blog.js 가 글(blog/<글>.html)과 목록(blog/index.html)에 붙인다.
 *
 * - 자리: <span class="post-views" data-post="글 이름" hidden> — 글은 제목 아래 카테고리 옆, 목록은 카드 머리.
 * - 글: 열면 worker /api/view 에 글 이름만 보내 하나 세고, 돌아온 수를 적는다. 같은 브라우저의 같은 글은
 *   하루(이 기기 날짜) 한 번만 센다 — 센 날을 localStorage 에 둔다. 그날 다시 열면 읽기만 한다(/api/views).
 * - 목록: 카드의 글 이름을 모아 /api/views 로 한 번에 읽는다. 받은 수는 자리마다 data-n 에도 적고(숨긴 수 포함)
 *   document 에 'ld:views' 를 알린다 — 목록의 "많이 읽은 순" 정렬(tools/build-blog.js)이 이걸 쓴다.
 * - MIN 보다 작은 수는 적지 않는다. 서버가 안 되면 아무것도 안 보인다(조회수는 덤).
 */
(function () {
    'use strict';

    const MIN = 1;
    const KEY = 'ld_viewed';   // { 글 이름: 'YYYY-MM-DD' } — 오늘 센 글만 남긴다
    const spots = Array.prototype.slice.call(document.querySelectorAll('.post-views[data-post]'));
    if (!spots.length || !window.fetch) return;

    const api = String((window.PREMIUM_CONFIG && window.PREMIUM_CONFIG.apiBase) || 'https://api.lottodraw.kr').replace(/\/+$/, '');
    const tr = (key, ko) => (window.I18N ? window.I18N.t(key, ko) : ko);
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    function seen() {
        try {
            const all = JSON.parse(localStorage.getItem(KEY) || '{}');
            const out = {};
            Object.keys(all).forEach(p => { if (all[p] === today) out[p] = today; });   // 지난날 기록은 버린다
            return out;
        } catch (e) { return null; }   // 저장소를 못 쓰면 세지 않는다(새로 고칠 때마다 올라가지 않게)
    }

    function show(views) {
        spots.forEach(s => {
            const n = views && views[s.getAttribute('data-post')];
            if (typeof n !== 'number') return;
            s.setAttribute('data-n', n);
            if (n < MIN) return;
            s.textContent = tr(n === 1 ? 'views.one' : 'views.n', '조회 {n}').replace('{n}', n.toLocaleString('ko-KR'));
            s.hidden = false;
        });
        document.dispatchEvent(new CustomEvent('ld:views'));
    }

    const read = ids => fetch(api + '/api/views?ids=' + ids.map(encodeURIComponent).join(','))
        .then(r => (r.ok ? r.json() : {}));

    // 글 페이지(자리가 하나)만 센다. 목록은 읽기만
    const post = spots.length === 1 && /\/blog\/(?!index\.html$)[a-z0-9-]+\.html$/.test(location.pathname) ? spots[0].getAttribute('data-post') : null;
    const mine = post ? seen() : null;
    let job;
    if (post && mine && !mine[post] && !navigator.webdriver) {
        job = fetch(api + '/api/view', { method: 'POST', body: JSON.stringify({ p: post }), keepalive: true })
            .then(r => (r.ok ? r.json() : {}))
            .then(data => {
                if (data.views && typeof data.views[post] === 'number') {
                    mine[post] = today;
                    try { localStorage.setItem(KEY, JSON.stringify(mine)); } catch (e) { /* 다음에 다시 세질 뿐 */ }
                }
                return data;
            });
    } else {
        job = read(spots.map(s => s.getAttribute('data-post')));
    }
    job.then(data => show(data.views), () => { /* 조회수는 덤 */ });
}());
