// 로또 규칙 도우미 — 내 번호 저장(등수 확인)과 추첨 결과 메일이 같이 쓴다.
//
// 회차는 날짜로 정한다(js/draw-countdown.js 와 같은 셈): 1회 추첨이 2002-12-07(토)이고 한 주도 빠짐없이 매주 한 회차.
// 판매는 토요일 20:00 에 마감하므로, 그 뒤에 산 번호는 다음 회차 것이다.

const KST = 9 * 3600e3;
const HOUR = 3600e3, DAY = 24 * HOUR, WEEK = 7 * DAY;
const SAT1 = Date.UTC(2002, 11, 7) - KST;   // 1회 추첨일(토) 0시 KST
const SALE_END_H = 20;                     // 토요일 20:00 판매 마감

export const sat = n => SAT1 + (n - 1) * WEEK;   // n회 토요일 0시(KST)
export const saleEnd = n => sat(n) + SALE_END_H * HOUR;
// 지금 사면 몇 회 번호인가 (토 20:00 ~ 일 06:00 판매 중단 시간에는 다음 회차로 친다)
export function saleRound(now) {
    const n = Math.max(1, Math.floor((now - SAT1) / WEEK) + 1);   // sat(n) <= now < sat(n+1)
    return now < saleEnd(n) ? n : n + 1;
}
// 한국 시각의 요일(0 = 일)과 시
export function kstParts(now) {
    const d = new Date(now + KST);
    return { dow: d.getUTCDay(), hour: d.getUTCHours(), ymd: d.toISOString().slice(0, 10) };
}
// n회 추첨일 "10월 24일(토)"
export function drawDay(n) {
    const d = new Date(sat(n) + KST);
    return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(토)`;
}

// 번호 6개(1~45, 겹치지 않음) → 오름차순 배열, 아니면 null
export function cleanGame(raw) {
    if (!Array.isArray(raw) || raw.length !== 6) return null;
    const n = raw.map(Number);
    if (!n.every(v => Number.isInteger(v) && v >= 1 && v <= 45) || new Set(n).size !== 6) return null;
    return n.sort((a, b) => a - b);
}

// 등수: 6개 1등, 5개 + 보너스 2등, 5개 3등, 4개 4등, 3개 5등, 그 밖 0(낙첨)
export function rankOf(game, draw) {
    const hit = game.filter(n => draw.numbers.includes(n));
    const bonus = game.includes(draw.bonus);
    const m = hit.length;
    const rank = m === 6 ? 1 : m === 5 && bonus ? 2 : m === 5 ? 3 : m === 4 ? 4 : m === 3 ? 5 : 0;
    return { rank, match: m, bonus: m === 5 && bonus, hit };
}
