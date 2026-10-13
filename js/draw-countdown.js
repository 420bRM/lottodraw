/* 홈: 다음 추첨 방송까지 남은 시간 (1초마다).
 *
 * 방송은 매주 토요일 20:35 KST(MBC 생방송 — tools/wait-for-draw.js 와 같은 시각). 기기 시간대와 상관없이
 * 한국 시각으로 센다. 방송 시작부터 LIVE_MIN 분 동안은 "지금 방송 중", 그 뒤로는 다음 주 방송을 센다.
 *
 * 회차는 날짜로 정한다: 1회(2002-12-07)부터 한 주도 빠짐없이 매주 한 회차라(1~1245회 lotto-data.json 으로
 * 확인) 데이터를 받기 전에도, 추첨 뒤 데이터가 갱신되기 전에도 맞는 회차가 나온다.
 * 편성 사정으로 방송이 늦어지는 날(스포츠 중계 등)은 따로 알 길이 없어 평소 시각으로 센다.
 */
(function () {
    'use strict';

    const box = document.getElementById('draw-countdown');
    if (!box) return;

    const KST = 9 * 3600e3;            // 한국은 서머타임이 없다
    const WEEK = 7 * 864e5;
    const DRAW_DAY = 6;                 // 토요일
    const DRAW_H = 20, DRAW_M = 35;     // 바꾸면 사전 'cd.when' 의 "오후"도 맞는지 볼 것
    const LIVE_MIN = 10;
    const ROUND1 = Date.UTC(2002, 11, 7, DRAW_H, DRAW_M) - KST;
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const label = document.getElementById('dc-label');
    const time = document.getElementById('dc-time');
    const when = document.getElementById('dc-when');
    const pad = n => String(n).padStart(2, '0');

    // 지금 기다리는(또는 방송 중인) 회차의 방송 시작 시각(ms)
    function target(now) {
        const k = new Date(now + KST);   // UTC 칸에 한국 시각이 들어 있다
        let t = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + (DRAW_DAY - k.getUTCDay() + 7) % 7, DRAW_H, DRAW_M) - KST;
        if (now >= t + LIVE_MIN * 60e3) t += WEEK;
        return t;
    }

    let shown = 0;   // 회차 · 날짜 줄은 대상이 바뀔 때만 다시 쓴다
    function tick() {
        const now = Date.now();
        const t = target(now);
        const n = 1 + Math.round((t - ROUND1) / WEEK);
        const live = now >= t;
        if (t !== shown || box.classList.contains('is-live') !== live) {
            shown = t;
            const k = new Date(t + KST);
            label.textContent = I18N.f(live ? 'cd.liveLabel' : 'cd.until', { n: n });
            when.textContent = I18N.f('cd.when', {
                m: k.getUTCMonth() + 1, mon: MON[k.getUTCMonth()], d: k.getUTCDate(),
                hm: (DRAW_H % 12 || 12) + ':' + pad(DRAW_M),
            });
            box.classList.toggle('is-live', live);
        }
        if (live) {
            time.textContent = I18N.t('cd.live');
        } else {
            const s = Math.ceil((t - now) / 1000);   // 올림 — 00:00:00 이 되는 순간 "방송 중"으로 넘어간다
            const d = Math.floor(s / 86400);
            const hms = pad(Math.floor(s / 3600) % 24) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
            time.textContent = d ? I18N.f('cd.days', { d: d }) + ' ' + hms : hms;
        }
    }

    // 배포 직후 옛 site.css 를 쥔 브라우저에서는 모양 없이 글자만 흩어진다 — 그때는 감춘 채로 둔다
    box.hidden = false;
    if (getComputedStyle(box).display !== 'grid') { box.hidden = true; return; }

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
