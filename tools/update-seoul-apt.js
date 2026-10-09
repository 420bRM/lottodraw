// 사용: node tools/update-seoul-apt.js
// 서울 아파트 평균 매매가격(월별)을 받아 seoul-apt.json 으로 저장한다.
// TOP 50 페이지 그래프의 "서울 아파트 평균가" 비교선(1인당 당첨금으로 서울 아파트를 살 수 있나)이 이 파일을 쓴다.
//
// 받는 곳: KB부동산 데이터허브(data.kbland.kr)가 화면에 쓰는 자료 주소. 키가 필요 없다.
//   1. 평균 매매가격(아파트 · 매매 · 서울, 만 원)  — 2008년 12월부터 있다
//   2. 매매가격지수(아파트 · 서울, 월간)          — 1986년부터 있다. 평균가가 없는 2002-12 ~ 2008-11 을
//      "2008-12 평균가 × 그 달 지수 ÷ 2008-12 지수"로 거꾸로 환산한다(추정). 지수 기준 달이 바뀌어도 비율은 같다
// 공개 문서가 없는 주소라 모양이 바뀌거나 막힐 수 있다. 그러면 기존 seoul-apt.json 을 그대로 두고 실패로 끝난다
// (사이트는 저장해 둔 값으로 계속 보인다). 실패하면 Actions 기록에 받은 응답 앞부분을 찍어 둔다.
//
// 이 컨테이너(Claude 작업 환경)에서는 주소가 막혀 있어 GitHub Actions(.github/workflows/update-seoul-apt.yml)에서 돈다.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'seoul-apt.json');
const FIRST = '2002-12';          // 1회 추첨 달
const ACTUAL_FROM = '2008-12';    // KB 평균가가 시작하는 달
const MAX_LAG_MONTHS = 4;
const KB = 'https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/';

const q = o => Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
const ym = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
const nextMonth = k => { const [y, m] = k.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

async function get(url) {
    for (let attempt = 0; ; attempt++) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 60000);
        try {
            const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; lottodraw.kr-apt/1.0; +https://www.lottodraw.kr)', Accept: 'application/json', Referer: 'https://data.kbland.kr/' } });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
            return text;
        } catch (e) {
            if (attempt >= 1 || /HTTP 4\d\d/.test(e.message)) throw new Error(e.message + (e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''));
            await new Promise(r => setTimeout(r, 3000));
        } finally {
            clearTimeout(t);
        }
    }
}

// "202609" · "2026.09" · "2026-09" → "2026-09"
function toYm(v) {
    const m = String(v).match(/^(\d{4})[.\-/]?(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
}
const num = v => (v === null || v === undefined || v === '' ? NaN : Number(String(v).replace(/,/g, '')));

// 응답 { dataBody: { data: { 날짜리스트: [...], 데이터리스트: [{ 지역코드, 지역명, dataList: [...] }] } } } 에서 서울 줄을 월별로 꺼낸다.
// 모양이 조금 달라도 찾을 수 있게: 날짜 목록은 "날짜"가 들어간 배열, 지역 줄은 이름이 "서울"이거나 코드가 11 로 시작
function seoulSeries(text, label) {
    let body;
    try { body = JSON.parse(text); } catch (e) { throw new Error(`${label}: JSON 이 아니다: ${text.slice(0, 300)}`); }
    const data = body && body.dataBody && body.dataBody.data;
    const dump = () => JSON.stringify(body).slice(0, 1500);
    if (!data) throw new Error(`${label}: dataBody.data 가 없다: ${dump()}`);
    const dateKey = Object.keys(data).find(k => /날짜/.test(k) && Array.isArray(data[k]));
    const rowKey = Object.keys(data).find(k => /데이터/.test(k) && Array.isArray(data[k]));
    if (!dateKey || !rowKey) throw new Error(`${label}: 날짜·데이터 목록을 못 찾았다 (키: ${Object.keys(data).join(', ')}): ${dump()}`);
    const rows = data[rowKey];
    const row = rows.find(r => r['지역명'] === '서울' || r['지역명'] === '서울특별시')
        || rows.find(r => /^11/.test(String(r['지역코드'] || '')));
    if (!row) throw new Error(`${label}: 서울 줄이 없다 (지역: ${rows.map(r => r['지역명'] + '/' + r['지역코드']).slice(0, 30).join(', ')})`);
    const listKey = Object.keys(row).find(k => Array.isArray(row[k]));
    const vals = row[listKey] || [];
    const dates = data[dateKey];
    // 날짜와 값 개수가 다르면 어느 쪽이 어긋났는지 알 수 없다 — 응답 모양을 찍고 쓰지 않는다
    if (vals.length !== dates.length) {
        const brief = a => JSON.stringify(a.slice(0, 4)) + ' … ' + JSON.stringify(a.slice(-4));
        throw new Error(`${label}: 날짜 ${dates.length}개 · 값 ${vals.length}개가 다르다. 데이터 키: ${Object.keys(data).join(', ')} · 줄 키: ${Object.keys(row).join(', ')}`
            + ` · 날짜 ${brief(dates)} · 값 ${brief(vals)} · 다른 키: ${JSON.stringify(Object.fromEntries(Object.keys(data).filter(k => k !== dateKey && k !== rowKey).map(k => [k, data[k]]))).slice(0, 400)}`);
    }
    const out = {};
    dates.forEach((d, i) => {
        const k = toYm(d);
        const v = num(vals[i]);
        if (k && Number.isFinite(v) && v > 0) out[k] = v;
    });
    console.log(`  ${label}: ${row['지역명']}(${row['지역코드']}) ${Object.keys(out).length}달, ${Object.keys(out)[0]} ~ ${Object.keys(out).slice(-1)[0]}`);
    return out;
}

async function main() {
    const now = ym(new Date());
    const avgUrl = KB + 'avgPrc?' + q({ '매물종별구분': '01', '매매전세코드': '01' });
    // 지수는 기본으로 최근 2년만 준다. 기간을 넓히는 이름이 문서에 없어 몇 가지를 차례로 시도한다
    const idxBase = { '월간주간구분코드': '01', '매물종별구분': '01', '매매전세코드': '01' };
    const idxUrls = [
        Object.assign({ '기간': '30' }, idxBase),
        Object.assign({ '기간': '전체' }, idxBase),
        Object.assign({ '조회시작일자': '200201', '조회종료일자': now.replace('-', '') }, idxBase),
        Object.assign({ '시작년월': '200201', '종료년월': now.replace('-', '') }, idxBase),
        Object.assign({ '기간': '99' }, idxBase),
    ].map(o => KB + 'priceIndex?' + q(o));
    console.log('평균 매매가격:', avgUrl);
    const avgMan = seoulSeries(await get(avgUrl), '평균가');
    // 만 원 → 원
    const avg = {};
    Object.keys(avgMan).sort().forEach(k => { avg[k] = Math.round(avgMan[k] * 10000); });
    const months = Object.keys(avg).sort();
    const latest = months[months.length - 1];
    if (!avg[ACTUAL_FROM]) throw new Error(`평균가에 ${ACTUAL_FROM} 이 없다 (첫 달 ${months[0]})`);
    if (monthsBetween(latest, now) > MAX_LAG_MONTHS) throw new Error(`평균가 마지막 달 ${latest} 이 너무 오래됐다`);
    // 서울 아파트 평균값이 1억 ~ 100억 밖이면 단위나 지역을 잘못 읽은 것
    const bad = months.filter(k => !(avg[k] > 1e8 && avg[k] < 1e10));
    if (bad.length) throw new Error(`평균가 값이 이상하다: ${bad.slice(0, 5).map(k => k + '=' + avg[k]).join(', ')}`);
    for (let k = ACTUAL_FROM; k <= latest; k = nextMonth(k)) if (!avg[k]) throw new Error(`평균가에 ${k} 가 빠졌다`);

    // 2002-12 ~ 2008-11: 지수로 거꾸로 환산 (안 되면 실제 평균가 구간만 싣는다)
    let estimated = null;
    try {
        let idx = null;
        for (const u of idxUrls) {
            console.log('매매가격지수:', decodeURIComponent(u));
            try {
                const got = seoulSeries(await get(u), '지수');
                if (got[FIRST] && got[ACTUAL_FROM]) { idx = got; break; }
            } catch (e) {
                console.log('  ', e.message.slice(0, 1200));
            }
        }
        if (!idx) throw new Error(`${FIRST}·${ACTUAL_FROM} 이 다 들어 있는 지수를 못 받았다`);
        const base = idx[ACTUAL_FROM];
        if (!base) throw new Error(`지수에 ${ACTUAL_FROM} 이 없다`);
        const est = {};
        for (let k = FIRST; k < ACTUAL_FROM; k = nextMonth(k)) {
            if (!idx[k]) throw new Error(`지수에 ${k} 가 없다`);
            est[k] = Math.round(avg[ACTUAL_FROM] * idx[k] / base / 1e4) * 1e4;   // 만 원 단위로
        }
        estimated = est;
        console.log(`  추정: ${FIRST} ${est[FIRST]} 원 … 2008-11 ${est['2008-11']} 원 (2008-12 실제 ${avg[ACTUAL_FROM]} 원)`);
    } catch (e) {
        console.log('  지수로 추정 못 함 — 2008-12 부터만 싣는다:', e.message);
    }

    const monthly = {};
    if (estimated) Object.keys(estimated).sort().forEach(k => { monthly[k] = estimated[k]; });
    months.filter(k => k >= (estimated ? ACTUAL_FROM : months[0])).forEach(k => { monthly[k] = avg[k]; });

    const out = {
        source: 'KB부동산 월간 주택가격동향 — 아파트 평균 매매가격(서울)',
        credit: { ko: 'KB부동산 월간 주택가격동향', en: 'KB Real Estate monthly housing price survey' },
        link: 'https://data.kbland.kr/',
        unit: 'KRW',
        actualFrom: ACTUAL_FROM,
        estimatedBefore: estimated ? ACTUAL_FROM : null,   // 이 달보다 앞은 지수로 거꾸로 환산한 추정
        estimateNote: estimated ? 'KB 아파트 매매가격지수(서울) 비율로 2008-12 평균가를 거꾸로 환산' : null,
        latest: latest,
        monthly: monthly,
    };

    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 처음 */ }
    const same = prev && JSON.stringify(prev.monthly) === JSON.stringify(out.monthly) && prev.latest === out.latest && prev.estimatedBefore === out.estimatedBefore;
    if (!same) fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
    console.log(same ? '바뀐 것 없음' : `seoul-apt.json 저장: ${Object.keys(monthly)[0]} ~ ${latest}, 최신 ${monthly[latest]} 원`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${same ? 'false' : 'true'}\nlatest=${latest}\n`);
}

main().catch(e => {
    console.error('실패:', e.message);
    process.exit(1);
});
