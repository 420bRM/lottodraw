// 로또 규칙 도우미 — 내 번호 저장(등수 확인)과 이번 주 생성 번호 메일이 같이 쓴다.
//
// 회차는 날짜로 정한다(js/draw-countdown.js 와 같은 셈): 1회 추첨이 2002-12-07(토)이고 한 주도 빠짐없이 매주 한 회차.
// 판매는 토요일 20:00 에 마감하므로, 그 뒤에 산 번호는 다음 회차 것이다.
// 번호 생성 규칙은 홈 생성기(index.html 의 checkInvalidPattern)와 같다 — test/mynumbers.test.mjs 가 둘을 무작위 조합으로 견준다.

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

/* ───── 번호 생성 (홈 생성기와 같은 규칙) ───── */

function isPrime(n) {
    if (n <= 1) return false;
    if (n <= 3) return true;
    if (n % 2 === 0 || n % 3 === 0) return false;
    for (let i = 5; i * i <= n; i += 6) if (n % i === 0 || n % (i + 2) === 0) return false;
    return true;
}
// 특수 패턴 16가지(id 는 홈 생성기의 pattern1~16). 걸리면 그 id, 아니면 0
export function patternHit(numbers, ids) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const squares = [1, 4, 9, 16, 25, 36];
    const squareCount = sorted.filter(n => squares.includes(n)).length;
    const checks = {
        1: () => sorted[5] - sorted[0] === 5,
        2: () => sorted.every(n => n >= 1 && n <= 15),
        3: () => sorted.every(n => n >= 1 && n <= 20),
        4: () => sorted.every(n => n >= 1 && n <= 31),
        5: () => sorted.every(n => n % 3 === 0),
        6: () => sorted.every(n => n % 4 === 0),
        7: () => sorted.every(n => n % 5 === 0),
        8: () => sorted.every(n => n >= 31 && n <= 45),
        9: () => sorted.every(n => Math.floor(n / 10) === Math.floor(sorted[0] / 10)),
        10: () => sorted.every(isPrime),
        11: () => sorted.every(n => n % 2 !== 0),
        12: () => sorted.every(n => n % 2 === 0),
        13: () => sum < 50 || sum > 200,
        14: () => (sum >= 50 && sum <= 69) || (sum >= 181 && sum <= 200),
        15: () => squareCount >= 4,
        16: () => squareCount >= 5,
    };
    for (let id = 1; id <= 16; id++) if (ids.has(id) && checks[id]()) return id;
    return 0;
}
export const ALL_PATTERNS = new Set(Array.from({ length: 16 }, (_, i) => i + 1));

// 씨앗(바이트 16개 이상)에서 0 이상 1 미만 수를 내는 작은 난수기(sfc32). 같은 씨앗이면 같은 번호가 나온다 —
// 메일을 다시 보내야 할 때(발송 뒤 기록이 실패한 경우) 같은 번호가 가게
export function seeded(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let a = v.getUint32(0), b = v.getUint32(4), c = v.getUint32(8), d = v.getUint32(12);
    const next = () => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        const t = (a + b | 0) + d | 0;
        d = d + 1 | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = (c << 21 | c >>> 11);
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    };
    for (let i = 0; i < 12; i++) next();
    return next;
}

// 기본 규칙(특수 패턴 16가지 모두 제외, 고정수 · 제외수 없음)으로 count 게임. 한 장 안에서 같은 조합은 두 번 넣지 않는다
export function makeGames(random, count) {
    const out = [];
    const made = new Set();
    for (let tries = 0; out.length < count && tries < 10000; tries++) {
        const pool = Array.from({ length: 45 }, (_, i) => i + 1);
        const nums = [];
        while (nums.length < 6) nums.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
        nums.sort((a, b) => a - b);
        const key = nums.join(',');
        if (patternHit(nums, ALL_PATTERNS) || made.has(key)) continue;
        made.add(key);
        out.push(nums);
    }
    return out;
}
