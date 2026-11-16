// 토요일 밤 추첨 결과 깨우기(2026-11-16).
//
// 전에는 GitHub draw-night 가 토요일 낮에 미리 시작해 20:40 까지 잠들어 기다렸다(GitHub 예약 실행이 2시간 반~5시간씩
// 늦게 떠서). 그 기다림이 한 달 750분쯤 GitHub Actions 시간을 썼다 — 저장소를 비공개로 돌리면 무료 2,000분에서 깎인다.
// 이제는 시각이 정확한 Cloudflare 예약(wrangler.toml 의 DRAW_CRON — 토요일 20:00~23:50 KST, 10분마다)이
// 20:40 부터 사이트 lotto-data.json 맨 앞 회차가 오늘 것이 아니면 GitHub draw-night 를 mode=once 로 부른다.
// draw-night 는 동행복권을 한 번만 조회해 1등 당첨자 수까지 나왔으면 update-lotto-data 를 부르고 30초 안에 끝난다.
// 오늘 회차가 사이트에 올라가면 그다음부터는 부르지 않는다. 깨우기가 안 되면 일요일 새벽 정기 갱신이 받는다.
//
// 동행복권 조회를 여기서 하지 않는 까닭: 클라우드 서버 주소에서 막히는지 확인하지 못했다 — 이미 잘 되는 GitHub 쪽을 쓴다.
// 비밀값 GH_DISPATCH_TOKEN: GitHub 세분화 토큰(저장소 lottodraw 하나 · Actions 읽기와 쓰기). 없으면 아무것도 하지 않는다.
// 토큰을 처음 넣으면(또는 바꾸면) 한 시간 예약에서 한 번 draw-night 를 mode=check(아무 일도 안 함)로 불러 되는지 보고 알림을 보낸다.

export const DRAW_CRON = '*/10 11-14 * * SAT';
export const GH_REPO = '420bRM/lottodraw';
const KST = 9 * 3600 * 1000;
const OPEN_MIN = 20 * 60 + 40;   // 20:40 KST 전에는 부르지 않는다(추첨 20:35)

// Cloudflare 가 넘겨 주는 cron 문자열이 대소문자 · 띄어쓰기 · 요일 숫자(7 = 토요일)로 바뀌어도 알아본다
export const isDrawCron = c => {
    const s = String(c || '').replace(/\s+/g, ' ').trim().toUpperCase();
    return s === DRAW_CRON.toUpperCase() || /^\*\/10 11-14 \* \* (SAT|7)$/.test(s);
};

const kstOf = now => new Date(now + KST);
const minuteOfDay = k => k.getUTCHours() * 60 + k.getUTCMinutes();

// 지금(now) 부를 때인가: 한국 시간 토요일 20:40 뒤이고, 사이트 맨 앞 회차 날짜(siteDate)가 오늘보다 앞일 때
export function pokeDue(now, siteDate) {
    const k = kstOf(now);
    if (k.getUTCDay() !== 6 || minuteOfDay(k) < OPEN_MIN) return false;
    const today = k.toISOString().slice(0, 10);
    return !(siteDate && siteDate >= today);
}

// 응답 앞부분만 읽고 끊는다(Cloudflare 정적 파일은 Range 를 무시하고 32만 바이트를 다 준다)
async function readHead(res, n) {
    if (!res.body) return (await res.text()).slice(0, n);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let s = '';
    try {
        while (s.length < n) {
            const { done, value } = await reader.read();
            if (done) break;
            s += dec.decode(value, { stream: true });
        }
    } finally { reader.cancel().catch(() => {}); }
    return s;
}

// 사이트 lotto-data.json 맨 앞(최신) 회차의 날짜 "YYYY-MM-DD". 못 읽으면 null
export async function siteLatestDate(site, fetchFn = fetch) {
    const res = await fetchFn(site + '/lotto-data.json', { headers: { Range: 'bytes=0-1023' }, cf: { cacheTtl: 60 } });
    if (!res.ok && res.status !== 206) return null;
    const m = (await readHead(res, 2048)).match(/"round":\s*\d+,\s*"date":\s*"(\d{4}-\d{2}-\d{2})"/);
    return m ? m[1] : null;
}

function dispatch(env, mode, fetchFn) {
    return fetchFn(`https://api.github.com/repos/${GH_REPO}/actions/workflows/draw-night.yml/dispatches`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'lottodraw-api',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'html', inputs: { mode } }),
    });
}
const dispatched = r => r.status === 204 || r.status === 200;

// 토요일 예약(DRAW_CRON)에서: 부를 때면 draw-night 를 mode=once 로 부른다. 실패하면 그날 첫 번째(20:40~20:49)에만 알린다
export async function drawPoke(env, now, { site, notify, fetchFn = fetch } = {}) {
    if (!pokeDue(now, null)) return { poked: false, why: 'time' };
    let date = null;
    try { date = await siteLatestDate(site, fetchFn); } catch (e) { /* 사이트를 못 읽으면 부른다 — draw-night 가 저장소 기준으로 다시 본다 */ }
    if (!pokeDue(now, date)) return { poked: false, why: 'have', date };
    if (!env.GH_DISPATCH_TOKEN) return { poked: false, why: 'no_token', date };
    const r = await dispatch(env, 'once', fetchFn);
    if (dispatched(r)) return { poked: true, date };
    if (notify && minuteOfDay(kstOf(now)) < OPEN_MIN + 10) {
        await notify(`토요일 추첨 확인(draw-night) 부르기 실패: GitHub ${r.status}. 토큰 GH_DISPATCH_TOKEN 의 만료 · 권한(Actions 쓰기)을 확인하세요. 오늘 결과는 일요일 새벽 정기 갱신이 받습니다.`).catch(() => {});
    }
    return { poked: false, why: 'github_' + r.status, date };
}

// 한 시간 예약에서: 토큰이 새로 들어왔으면(토큰마다 한 번) draw-night 를 mode=check 로 불러 되는지 보고 알린다
export async function drawPokeSelfTest(env, { notify, fetchFn = fetch } = {}) {
    if (!env.GH_DISPATCH_TOKEN || !env.DB) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.GH_DISPATCH_TOKEN));
    const key = 'meta:drawpoke-check:' + [...new Uint8Array(digest)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
    if (await env.DB.get(key)) return null;
    const r = await dispatch(env, 'check', fetchFn);
    const ok = dispatched(r);
    await env.DB.put(key, JSON.stringify({ ok, status: r.status, at: Date.now() }));
    if (notify) {
        await notify(ok
            ? '토요일 추첨 깨우기 준비 완료: GitHub draw-night 를 부를 수 있습니다(토큰 확인). 토요일 20:40부터 10분마다 확인합니다.'
            : `토요일 추첨 깨우기 토큰 확인 실패: GitHub ${r.status}. GH_DISPATCH_TOKEN 의 저장소(lottodraw) · 권한(Actions 읽기와 쓰기)을 확인하세요.`).catch(() => {});
    }
    return { ok, status: r.status };
}
