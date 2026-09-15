/* 공용 헤더 스크립트 — lotto-data.json 을 한 번만 받아 캐시하고,
   헤더의 "최신 회차" 문구를 채운다. 본문에서도 SiteHeader.loadData() 로
   같은 응답을 재사용한다 (json 이 300KB 넘어 두 번 받지 않는다). */
(function (global) {
    'use strict';

    let dataPromise = null;

    function loadData() {
        if (!dataPromise) {
            dataPromise = fetch('lotto-data.json')
                .then(r => {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                });
        }
        return dataPromise;
    }

    function renderLatestCallout(box, draw) {
        box.textContent = `제${draw.round}회 ${draw.numbers.join(' ')} `;
        const sep = document.createElement('span');
        sep.className = 'bonus-sep';
        sep.textContent = '+';
        box.appendChild(sep);
        box.appendChild(document.createTextNode(` ${draw.bonus}`));
    }

    function initLatestCallout() {
        const box = document.getElementById('latest-callout');
        if (!box) return;
        loadData()
            .then(data => {
                const latest = data.draws.reduce((a, b) => (b.round > a.round ? b : a));
                renderLatestCallout(box, latest);
            })
            .catch(err => {
                console.error(err);
                box.textContent = '최신 회차 정보를 불러오지 못했습니다';
            });
    }

    global.SiteHeader = { loadData, initLatestCallout };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLatestCallout);
    } else {
        initLatestCallout();
    }
})(window);
