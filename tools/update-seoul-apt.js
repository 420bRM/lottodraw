// 사용: node tools/update-seoul-apt.js
// 서울 · 강남 아파트 평균 매매가격(월별)을 받아 seoul-apt.json 으로 저장한다.
// TOP 50 페이지 그래프의 "서울 아파트 평균가" · "강남3구 아파트값" 비교선(1인당 당첨금으로 살 수 있나)이 이 파일을 쓴다.
//
// 받는 곳: KB부동산 데이터허브(data.kbland.kr)가 화면에 쓰는 자료 주소. 키가 필요 없다.
//   1. 평균 매매가격(아파트 · 매매, 만 원)  — 2008년 12월부터 있다
//   2. 매매가격지수(아파트 · 월간)          — 1986년부터 있다. 평균가가 없는 2002-12 ~ 2008-11 을
//      "2008-12 평균가 × 그 달 지수 ÷ 2008-12 지수"로 거꾸로 환산한다(추정). 지수 기준 달이 바뀌어도 비율은 같다
// 강남은 강남3구(강남구 · 서초구 · 송파구) 평균이다. KB 평균가 자료에는 구 단위가 없어(지역 25개 = 권역 · 시도뿐, 2026-10 확인)
// "㎡당 평균 매매가격"을 쓴다:
//   3. ㎡당 평균 매매가격(아파트 · 매매, 만 원/㎡, 전용면적) — 지역코드=11 이면 서울 + 25개 구. 구 단위는 2013-04 부터 있다.
//      × 84㎡(전용, 이른바 국민평형) = 그 구의 "84㎡ 아파트값". KB 도 "국평(전용 84㎡) 평균가"를 이렇게 발표하고,
//      서울 평균가도 서울 ㎡당 값의 약 83배라 비슷한 잣대다
//   4. 구 매매가격지수(지역코드=11, 2002-12 부터) — 구마다 2013-03 이전을 2번과 같은 방식으로 거꾸로 환산한다(추정)
//   세 구를 따로 만든 뒤 달마다 단순 평균한다(구마다 아파트 수 가중치는 KB 자료에 없다)
// 공개 문서가 없는 주소라 모양이 바뀌거나 막힐 수 있다. 서울을 못 받으면 기존 seoul-apt.json 을 그대로 두고 실패로 끝난다
// (사이트는 저장해 둔 값으로 계속 보인다). 강남3구만 못 받으면 강남은 지난 값을 그대로 둔다. 받은 지역 목록과 실패 이유는 Actions 기록에 찍는다.
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
const SQM = 84;                   // 구 아파트값 = ㎡당 평균가 × 전용 84㎡(국민평형)
const GU_FROM = '2013-04';        // KB ㎡당 평균가가 구 단위로 시작하는 달
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

// 응답 { dataBody: { data: { 날짜리스트: [...], 데이터리스트: [{ 지역코드, 지역명, dataList: [...] }] } } } 를 읽는다.
// 모양이 조금 달라도 찾을 수 있게: 날짜 목록은 "날짜"가 들어간 배열, 지역 줄 목록은 "데이터"가 들어간 배열
function parseKb(text, label) {
    let body;
    try { body = JSON.parse(text); } catch (e) { throw new Error(`${label}: JSON 이 아니다: ${text.slice(0, 300)}`); }
    const data = body && body.dataBody && body.dataBody.data;
    if (!data) throw new Error(`${label}: dataBody.data 가 없다: ${JSON.stringify(body).slice(0, 1500)}`);
    const dateKey = Object.keys(data).find(k => /날짜/.test(k) && Array.isArray(data[k]));
    const rowKey = Object.keys(data).find(k => /데이터/.test(k) && Array.isArray(data[k]));
    if (!dateKey || !rowKey) throw new Error(`${label}: 날짜·데이터 목록을 못 찾았다 (키: ${Object.keys(data).join(', ')}): ${JSON.stringify(body).slice(0, 1500)}`);
    const rows = data[rowKey];
    console.log(`  ${label} 지역 ${rows.length}개: ${rows.map(r => r['지역명'] + '(' + r['지역코드'] + ')').join(', ').slice(0, 900)}`);
    return { data: data, dates: data[dateKey], rows: rows, label: label };
}

// 지역 줄 하나를 { 'YYYY-MM': 값 } 으로
function rowSeries(parsed, row) {
    const { dates, label } = parsed;
    const listKey = Object.keys(row).find(k => Array.isArray(row[k]));
    const vals = (row[listKey] || []).slice();
    // 지수 응답은 값 목록 끝에 변동률 몇 개(전월 대비 등)가 더 붙어 온다(2026-10 확인: 날짜 361 · 값 364, 마지막 달 값 다음에
    // 1.13 · 10.30 · 15.04). 그래서 값이 조금(5개 이하) 많으면 앞에서부터 날짜 수만큼만 쓴다.
    // 그 밖에 개수가 다르면 어느 쪽이 어긋났는지 알 수 없다 — 응답 모양을 찍고 쓰지 않는다
    if (vals.length > dates.length && vals.length - dates.length <= 5) {
        vals.length = dates.length;
    } else if (vals.length !== dates.length) {
        const brief = a => JSON.stringify(a.slice(0, 4)) + ' … ' + JSON.stringify(a.slice(-4));
        throw new Error(`${label} ${row['지역명']}: 날짜 ${dates.length}개 · 값 ${vals.length}개가 다르다 · 줄 키: ${Object.keys(row).join(', ')} · 날짜 ${brief(dates)} · 값 ${brief(vals)}`);
    }
    const out = {};
    dates.forEach((d, i) => {
        const k = toYm(d);
        const v = num(vals[i]);
        if (k && Number.isFinite(v) && v > 0) out[k] = v;
    });
    const ks = Object.keys(out);
    console.log(`  ${label}: ${row['지역명']}(${row['지역코드']}) ${ks.length}달, ${ks[0]} ~ ${ks[ks.length - 1]}`);
    return out;
}

const isSeoul = r => r['지역명'] === '서울' || r['지역명'] === '서울특별시' || String(r['지역코드'] || '') === '1100000000';
// 강남3구: 이름과 지역코드(법정동 앞 10자리)
const GANGNAM3 = [['강남구', '1168000000'], ['서초구', '1165000000'], ['송파구', '1171000000']];
const isGu = (name, code) => r => String(r['지역코드'] || '') === code || r['지역명'] === name;

// 지역 하나: 평균가(원) + 지수로 거꾸로 환산한 2002-12 ~ (실제 값 첫 달 - 1) 추정. 지수를 못 받으면 실제 구간만.
// expectFrom: 실제 값이 적어도 이 달부터는 있어야 한다(자료가 짧게 오면 실패 — 추정 구간이 몰래 길어지지 않게)
function buildRegion(name, avgMan, idx, now, maxValue, expectFrom) {
    const avg = {};
    Object.keys(avgMan).sort().forEach(k => { avg[k] = Math.round(avgMan[k] * 10000); });   // 만 원 → 원
    const months = Object.keys(avg).sort();
    const anchor = months[0];
    const latest = months[months.length - 1];
    if (!anchor || anchor > expectFrom) throw new Error(`${name} 평균가가 ${expectFrom} 부터 있어야 하는데 첫 달이 ${anchor} 이다`);
    if (monthsBetween(latest, now) > MAX_LAG_MONTHS) throw new Error(`${name} 평균가 마지막 달 ${latest} 이 너무 오래됐다`);
    // 아파트 평균값이 1억 ~ maxValue 밖이면 단위나 지역을 잘못 읽은 것
    const bad = months.filter(k => !(avg[k] > 1e8 && avg[k] < maxValue));
    if (bad.length) throw new Error(`${name} 평균가 값이 이상하다: ${bad.slice(0, 5).map(k => k + '=' + avg[k]).join(', ')}`);
    for (let k = anchor; k <= latest; k = nextMonth(k)) if (!avg[k]) throw new Error(`${name} 평균가에 ${k} 가 빠졌다`);

    let est = null;
    if (anchor > FIRST && idx && idx[FIRST] && idx[anchor]) {
        est = {};
        for (let k = FIRST; k < anchor; k = nextMonth(k)) {
            if (!idx[k]) { est = null; break; }
            est[k] = Math.round(avg[anchor] * idx[k] / idx[anchor] / 1e4) * 1e4;   // 만 원 단위로
        }
    }
    if (est) console.log(`  ${name} 추정: ${FIRST} ${est[FIRST]} 원 … 직전 달 ${est[Object.keys(est).sort().pop()]} 원 (${anchor} 실제 ${avg[anchor]} 원)`);
    else if (anchor > FIRST) console.log(`  ${name}: 지수로 추정 못 함 — ${anchor} 부터만 싣는다`);
    const monthly = {};
    if (est) Object.keys(est).sort().forEach(k => { monthly[k] = est[k]; });
    months.forEach(k => { monthly[k] = avg[k]; });
    return { monthly: monthly, latest: latest, estimatedBefore: est ? anchor : null };
}

// ㎡당 평균가 줄 하나를 { 'YYYY-MM': 값 } 으로. 이 응답은 값이 날짜보다 1개 적다(날짜는 200401 ~ 이번 달, 이번 달 값이 아직 없다).
// 값은 날짜 목록 "앞에서부터" 맞춘다 — 2026-10 기사 값으로 확인: 강남구 2025-04 3,191만 원/㎡(파이낸셜뉴스),
// 2025-12 3,716.7(3.3㎡당 1억 2,286.6만, 뉴시스), 2026-04 3,740.1(3.3㎡당 1억 2,342만, 헤럴드경제), 서초구 · 송파구 2025-12 도 같다.
// 끝에서부터 맞추면 한 달씩 밀린다. 값이 날짜보다 많거나 2개 넘게 적으면 모양이 바뀐 것 — 쓰지 않는다
function rowSeriesFromStart(parsed, row) {
    const { dates, label } = parsed;
    const listKey = Object.keys(row).find(k => Array.isArray(row[k]));
    const vals = row[listKey] || [];
    if (vals.length > dates.length || dates.length - vals.length > 2) {
        throw new Error(`${label} ${row['지역명']}: 날짜 ${dates.length}개 · 값 ${vals.length}개 — 맞추는 방법을 모른다`);
    }
    const out = {};
    vals.forEach((x, i) => {
        const k = toYm(dates[i]);
        const v = num(x);
        if (k && Number.isFinite(v) && v > 0) out[k] = v;
    });
    const ks = Object.keys(out);
    console.log(`  ${label}: ${row['지역명']}(${row['지역코드']}) ${ks.length}달, ${ks[0]} ~ ${ks[ks.length - 1]} (날짜 끝 ${dates[dates.length - 1]})`);
    return out;
}

// 지역 여러 개를 달마다 단순 평균한다. 모든 지역에 값이 있는 달만, 마지막 달은 가장 이른 마지막 달.
// 어느 지역이라도 추정인 달은 추정 — estimatedBefore 는 가장 늦은 것
function averageRegions(regions) {
    const latest = regions.map(r => r.latest).sort()[0];
    const months = Object.keys(regions[0].monthly).filter(k => k <= latest && regions.every(r => r.monthly[k] > 0)).sort();
    if (!months.length) throw new Error('평균 낼 달이 없다');
    const monthly = {};
    months.forEach(k => { monthly[k] = Math.round(regions.reduce((a, r) => a + r.monthly[k], 0) / regions.length); });
    const est = regions.map(r => r.estimatedBefore).filter(Boolean).sort().pop() || null;
    return { monthly: monthly, latest: latest, estimatedBefore: est && est > months[0] ? est : null };
}

// 지수: 기간(햇수)을 넓혀 가며 받는다. 2026-10 확인: 기간 30 → 1996-09부터, 99 → 1986-01부터, '전체'는 400 오류.
// 기간을 안 주면 최근 2년만 준다
async function getIndex(extra, pick, label) {
    for (const n of ['30', '99']) {
        const u = KB + 'priceIndex?' + q(Object.assign({ '기간': n, '월간주간구분코드': '01', '매물종별구분': '01', '매매전세코드': '01' }, extra));
        console.log('매매가격지수:', decodeURIComponent(u));
        try {
            const parsed = parseKb(await get(u), label);
            const row = parsed.rows.find(pick);
            if (!row) { console.log(`  ${label}: 찾는 지역이 없다`); continue; }
            const s = rowSeries(parsed, row);
            if (s[FIRST] && s[ACTUAL_FROM]) return s;
        } catch (e) {
            console.log('  ', e.message.slice(0, 1200));
        }
    }
    return null;
}

async function main() {
    const now = ym(new Date());
    const avgBase = { '매물종별구분': '01', '매매전세코드': '01' };
    const avgUrl = KB + 'avgPrc?' + q(avgBase);
    console.log('평균 매매가격:', avgUrl);
    const top = parseKb(await get(avgUrl), '평균가');

    // 서울 (필수)
    const seoulRow = top.rows.find(isSeoul) || top.rows.find(r => /^11/.test(String(r['지역코드'] || '')));
    if (!seoulRow) throw new Error('평균가에 서울 줄이 없다');
    const seoul = buildRegion('서울', rowSeries(top, seoulRow), await getIndex({}, isSeoul, '서울 지수'), now, 1e10, ACTUAL_FROM);

    // 강남3구 (있으면): 구마다 ㎡당 평균가 × 84㎡ (+ 지수로 추정), 달마다 세 구 평균. 하나라도 못 받으면 지난 값을 그대로 둔다
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 처음 */ }
    let gangnam = null;
    try {
        const sqmUrl = KB + 'avgPrcPerSqmt?' + q(Object.assign({ '지역코드': '11' }, avgBase));
        console.log('㎡당 평균 매매가격:', sqmUrl);
        const sqm = parseKb(await get(sqmUrl), '㎡당 평균가');
        const parts = [];
        for (const [name, code] of GANGNAM3) {
            const row = sqm.rows.find(isGu(name, code));
            if (!row) throw new Error(`㎡당 평균가에 ${name} 줄이 없다`);
            const perSqm = rowSeriesFromStart(sqm, row);
            const man = {};
            Object.keys(perSqm).forEach(k => { man[k] = perSqm[k] * SQM; });
            parts.push(buildRegion(name, man, await getIndex({ '지역코드': '11' }, isGu(name, code), name + ' 지수'), now, 3e10, GU_FROM));
        }
        gangnam = Object.assign({ name: '강남3구', parts: GANGNAM3.map(g => g[0]), sqm: SQM }, averageRegions(parts));
        const k = gangnam.latest;
        console.log(`  강남3구 ${k}: ${parts.map((r, i) => GANGNAM3[i][0] + ' ' + r.monthly[k]).join(' · ')} → 평균 ${gangnam.monthly[k]} 원`);
    } catch (e) {
        console.log('강남3구를 못 만들었다 — 지난 값을 그대로 둔다:', e.message);
        gangnam = prev && prev.gangnam ? prev.gangnam : null;
    }

    const out = {
        source: 'KB부동산 월간 주택가격동향 — 아파트 평균 매매가격(서울)' + (gangnam && gangnam.sqm ? ` · ㎡당 평균 매매가격 × ${gangnam.sqm}㎡(${gangnam.name})` : gangnam ? ` · 평균 매매가격(${gangnam.name})` : ''),
        credit: { ko: 'KB부동산 월간 주택가격동향', en: 'KB Real Estate monthly housing price survey' },
        link: 'https://data.kbland.kr/',
        unit: 'KRW',
        actualFrom: ACTUAL_FROM,
        estimatedBefore: seoul.estimatedBefore,   // 이 달보다 앞은 지수로 거꾸로 환산한 추정
        estimateNote: seoul.estimatedBefore ? 'KB 아파트 매매가격지수 비율로 2008-12 평균가를 거꾸로 환산' : null,
        latest: seoul.latest,
        monthly: seoul.monthly,
        gangnam: gangnam,
    };

    const same = prev && JSON.stringify(prev.monthly) === JSON.stringify(out.monthly) && prev.latest === out.latest
        && prev.estimatedBefore === out.estimatedBefore && JSON.stringify(prev.gangnam || null) === JSON.stringify(out.gangnam);
    if (!same) fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
    console.log(same ? '바뀐 것 없음' : `seoul-apt.json 저장: 서울 ${Object.keys(out.monthly)[0]} ~ ${out.latest}, 최신 ${out.monthly[out.latest]} 원`
        + (gangnam ? ` · ${gangnam.name} ${Object.keys(gangnam.monthly)[0]} ~ ${gangnam.latest}, 최신 ${gangnam.monthly[gangnam.latest]} 원` : ' · 강남 없음'));
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${same ? 'false' : 'true'}\nlatest=${out.latest}\n`);
}

main().catch(e => {
    console.error('실패:', e.message);
    process.exit(1);
});
