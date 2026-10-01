// 이용권 종류와 가격. **실제로 받는 금액은 여기서 정한다.**
// 화면(js/premium-config.js)에도 같은 값이 적혀 있지만, 서버가 켜져 있으면
// 결제 페이지는 /api/config 로 이 값을 받아 덮어쓴다.
//
// 가격만 바꿀 때는 코드를 고치지 않고 Worker 환경변수 PRICES 에
// {"week":2900,"month":5900,"lifetime":12900} 처럼 넣어도 된다.
export const BASE_PLANS = {
    week:     { name: '1주 이용권',   amount: 2900,  days: 7 },
    month:    { name: '1개월 이용권', amount: 5900,  days: 30 },
    lifetime: { name: '평생 이용권',  amount: 12900, days: 0 },
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
