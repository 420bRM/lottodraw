// 이용권 종류와 가격. **실제로 받는 금액은 여기서 정한다.**
// 화면(js/premium-config.js)에도 같은 값이 적혀 있지만, 서버가 켜져 있으면
// 결제 페이지는 /api/config 로 이 값을 받아 덮어쓴다.
//
// 가격만 바꿀 때는 코드를 고치지 않고 Worker 환경변수 PRICES 에
// {"day":1500,"round":2900,"month":5900,"lifetime":12900} 처럼 넣어도 된다.
//
// round(이번 회차 이용권, 2026-10-21): 기간이 날짜 수가 아니라 "판매 중인 회차의 토요일 밤 12시(KST)까지"다(roundEndsAt).
//   토요일 20:00(판매 마감) 전에 발급되면 그 토요일, 뒤면 다음 토요일. days 는 null.
// week(1주 이용권)는 이번 회차 이용권으로 바꾸며 팔지 않는다(sale: false) — 이미 판 키 · 주문 기록과 관리자 직접 발급에만 남는다.
export const BASE_PLANS = {
    day:      { name: '1일 이용권',     amount: 1500,  days: 1 },
    round:    { name: '이번 회차 이용권', amount: 2900,  days: null },
    week:     { name: '1주 이용권',     amount: 2900,  days: 7, sale: false },
    month:    { name: '1개월 이용권',   amount: 5900,  days: 30 },
    lifetime: { name: '평생 이용권',    amount: 12900, days: 0 },
};

export function plansFor(env) {
    let override = {};
    if (env && env.PRICES) {
        try { override = JSON.parse(env.PRICES) || {}; } catch (e) { override = {}; }
    }
    const out = {};
    Object.keys(BASE_PLANS).forEach(id => {
        const amount = Number(override[id]);
        out[id] = Object.assign({}, BASE_PLANS[id], Number.isInteger(amount) && amount >= 1000 ? { amount } : {});
    });
    return out;
}

// 이번 회차 이용권이 끝나는 때(ms). 판매는 토요일 20:00 KST 에 마감되고 그 회차는 그날 20:35 에 추첨한다.
// 마감 전이면 그 토요일 밤 12시(일요일 0시), 마감 뒤(토요일 20:00 ~ 밤 12시)면 다음 토요일 밤 12시. 한국은 서머타임이 없다
const KST = 9 * 3600 * 1000;
const DAY = 86400 * 1000;
export function roundEndsAt(nowMs) {
    const k = new Date(nowMs + KST);   // UTC 칸에 한국 시각
    const midnight = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST;   // 오늘 0시(KST)
    let sat = midnight + ((6 - k.getUTCDay() + 7) % 7) * DAY;   // 이번 토요일 0시
    if (nowMs >= sat + 20 * 3600 * 1000) sat += 7 * DAY;        // 토요일 판매 마감 뒤면 다음 회차
    return sat + DAY;                                          // 토요일 밤 12시 = 일요일 0시
}
