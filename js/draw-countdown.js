/* 다음 회차 판매 마감 · 추첨 방송까지 남은 시간 (1초마다).
 *
 * 홈은 제목 줄의 #draw-countdown 상자를 채우고, 다른 페이지는 메뉴(.nav) 바로 아래에 한 줄 띠를 만든다.
 * 한 파일이 모든 페이지에 들어간다 — 손으로 관리하는 페이지는 각 파일에, 생성 페이지는 build-static-stats.js 의 shell().
 *
 * 시각은 기기 시간대와 상관없이 한국 시각(KST, 서머타임 없음)으로 센다.
 *   판매: 일요일 06:00 ~ 토요일 20:00 (방송이 늦어져도 마감은 그대로)
 *   방송: 토요일 20:35 MBC 생방송 (tools/wait-for-draw.js 와 같은 시각). 시작부터 LIVE_MIN 분은 "지금 방송 중",
 *         그 뒤로는 다음 회차를 센다. 스포츠 중계 등으로 편성이 바뀐 회차는 SPECIAL 에 적는다.
 * 회차는 날짜로 정한다: 1회(2002-12-07)부터 한 주도 빠짐없이 매주 한 회차라(1~1245회 lotto-data.json 으로
 * 확인) 데이터를 받기 전에도, 추첨 뒤 데이터가 갱신되기 전에도 맞는 회차가 나온다.
 */
(function () {
    'use strict';

    if (!window.I18N) return;

    const KST = 9 * 3600e3;
    const HOUR = 3600e3, DAY = 24 * HOUR, WEEK = 7 * DAY;
    const DRAW_AT = [20, 35];        // 토요일 추첨 방송
    const SALE_END = [20, 0];        // 토요일 판매 마감
    const SALE_START = [-6, 6, 0];   // 다음 회차 판매 시작: 토요일에서 6일 전(일요일) 06:00
    const LIVE_MIN = 10;
    // 편성이 바뀐 회차의 방송 시각 { 회차: [시, 분] }. 지난 회차는 지워도 된다. 예) 1244회는 아시안게임 축구 결승으로 21:35
    const SPECIAL = {};
    const SAT1 = Date.UTC(2002, 11, 7) - KST;   // 1회 추첨일(토) 0시 KST
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const sat = n => SAT1 + (n - 1) * WEEK;   // n회 토요일 0시
    const drawAt = n => { const hm = SPECIAL[n] || DRAW_AT; return sat(n) + hm[0] * HOUR + hm[1] * 60e3; };
    const saleEnd = n => sat(n) + SALE_END[0] * HOUR + SALE_END[1] * 60e3;
    const saleStart = n => sat(n) + SALE_START[0] * DAY + SALE_START[1] * HOUR + SALE_START[2] * 60e3;

    // 지금 기다리는(또는 방송 중인) 회차
    function roundAt(now) {
        let n = Math.max(1, Math.floor((now - SAT1) / WEEK) + 1);
        while (now >= drawAt(n) + LIVE_MIN * 60e3) n++;
        return n;
    }

    const pad = v => String(v).padStart(2, '0');
    const kst = t => new Date(t + KST);   // UTC 칸에 한국 시각이 들어 있다
    function clock(t) {
        const k = kst(t), h = k.getUTCHours();
        return I18N.f(h < 12 ? 'cd.am' : 'cd.pm', { t: (h % 12 || 12) + ':' + pad(k.getUTCMinutes()) });
    }
    function left(ms) {
        const s = Math.ceil(ms / 1000);   // 올림 — 00:00:00 이 되는 순간 다음 상태로 넘어간다
        const d = Math.floor(s / 86400);
        const hms = pad(Math.floor(s / 3600) % 24) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
        return d ? I18N.f('cd.days', { d: d }) + ' ' + hms : hms;
    }

    // 홈은 HTML 에 있는 상자, 다른 페이지는 메뉴 아래 띠
    let box = document.getElementById('draw-countdown');
    if (!box) {
        const nav = document.querySelector('.page > nav.nav');
        if (!nav) return;
        box = document.createElement('div');
        box.className = 'dc-strip';
        box.hidden = true;
        nav.after(box);
    }
    box.innerHTML =
        '<span class="dc-head"><b class="dc-round"></b> <span class="dc-date"></span></span>' +
        ['dc-sale', 'dc-draw'].map(c =>
            `<span class="dc-pair ${c}"><span class="dc-label"><span class="dc-what"></span> <small class="dc-at"></small></span>` +
            '<span class="dc-time" role="timer"></span></span>').join('');
    const $ = s => box.querySelector(s);
    const el = {
        round: $('.dc-round'), date: $('.dc-date'),
        saleWhat: $('.dc-sale .dc-what'), saleAt: $('.dc-sale .dc-at'), saleTime: $('.dc-sale .dc-time'),
        drawWhat: $('.dc-draw .dc-what'), drawAt: $('.dc-draw .dc-at'), drawTime: $('.dc-draw .dc-time'),
    };
    const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };

    function tick() {
        const now = Date.now();
        const n = roundAt(now);
        const k = kst(sat(n));
        put(el.round, I18N.f('cd.round', { n: n }));
        put(el.date, I18N.f('cd.date', { m: k.getUTCMonth() + 1, mon: MON[k.getUTCMonth()], d: k.getUTCDate() }));

        // 판매: 시작 전(토요일 방송 뒤 ~ 일요일 06:00) → 마감까지 → 마감
        const open = saleStart(n), end = saleEnd(n);
        const closed = now >= end;
        put(el.saleWhat, I18N.t(now < open ? 'cd.saleStart' : closed ? 'cd.sale' : 'cd.saleEnd'));
        put(el.saleAt, I18N.f('cd.at', { t: clock(now < open ? open : end) }));
        put(el.saleTime, closed ? I18N.t('cd.closed') : left((now < open ? open : end) - now));
        box.classList.toggle('is-closed', closed);

        // 방송
        const t = drawAt(n);
        const live = now >= t;
        put(el.drawWhat, I18N.t(live ? 'cd.draw' : 'cd.drawIn'));
        put(el.drawAt, I18N.f('cd.atMbc', { t: clock(t) }));
        put(el.drawTime, live ? I18N.t('cd.live') : left(t - now));
        box.classList.toggle('is-live', live);
    }

    // 배포 직후 옛 site.css 를 쥔 브라우저에서는 모양 없이 글자만 흩어진다 — 그때는 감춘 채로 둔다
    box.hidden = false;
    const shown = getComputedStyle(box).display;
    if (shown !== 'grid' && shown !== 'flex') { box.hidden = true; return; }

    // 초가 바뀌는 순간에 맞춰 돈다. 숨은 탭에서는 브라우저가 타이머를 늦추니 다시 보일 때 바로 한 번
    let timer = 0;
    function loop() {
        tick();
        clearTimeout(timer);
        timer = setTimeout(loop, 1000 - Date.now() % 1000 + 20);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
    loop();
})();
