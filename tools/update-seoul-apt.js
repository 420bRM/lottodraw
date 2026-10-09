// 사용: node tools/update-seoul-apt.js
// 서울 · 강남 아파트 평균 매매가격(월별)을 받아 seoul-apt.json 으로 저장한다.
// TOP 50 페이지 그래프의 "서울 아파트 평균가" · "강남 아파트 평균가" 비교선(1인당 당첨금으로 살 수 있나)이 이 파일을 쓴다.
//
// 받는 곳: KB부동산 데이터허브(data.kbland.kr)가 화면에 쓰는 자료 주소. 키가 필요 없다.
//   1. 평균 매매가격(아파트 · 매매, 만 원)  — 2008년 12월부터 있다
//   2. 매매가격지수(아파트 · 월간)          — 1986년부터 있다. 평균가가 없는 2002-12 ~ 2008-11 을
//      "2008-12 평균가 × 그 달 지수 ÷ 2008-12 지수"로 거꾸로 환산한다(추정). 지수 기준 달이 바뀌어도 비율은 같다
// 강남은 KB 권역 "강남11개구"(한강 이남 11개 구)를 쓴다. 이 자료에는 구 단위(강남구 단독)가 없다 — 2026-10 확인:
// 지역 25개(전국 · 서울 · 강북14개구 · 강남11개구 · 수도권 · 광역시 · 도)뿐이고, 지역코드=11 을 줘도 같은 목록이 온다.
// 실제로 쓴 지역 이름은 파일의 gangnam.name 에 남는다(화면 이름표가 이것을 따른다).
// 공개 문서가 없는 주소라 모양이 바뀌거나 막힐 수 있다. 서울을 못 받으면 기존 seoul-apt.json 을 그대로 두고 실패로 끝난다
// (사이트는 저장해 둔 값으로 계속 보인다). 강남만 못 받으면 강남은 지난 값을 그대로 둔다. 받은 지역 목록과 실패 이유는 Actions 기록에 찍는다.
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
const isGangnamArea = r => String(r['지역코드'] || '') === '1B0000' || /^강남/.test(String(r['지역명'] || ''));

// 지역 하나: 평균가(원, 2008-12부터) + 지수로 거꾸로 환산한 2002-12 ~ 2008-11 추정. 지수를 못 받으면 실제 구간만
function buildRegion(name, avgMan, idx, now, maxValue) {
    const avg = {};
    Object.keys(avgMan).sort().forEach(k => { avg[k] = Math.round(avgMan[k] * 10000); });   // 만 원 → 원
    const months = Object.keys(avg).sort();
    const latest = months[months.length - 1];
    if (!avg[ACTUAL_FROM]) throw new Error(`${name} 평균가에 ${ACTUAL_FROM} 이 없다 (첫 달 ${months[0]})`);
    if (monthsBetween(latest, now) > MAX_LAG_MONTHS) throw new Error(`${name} 평균가 마지막 달 ${latest} 이 너무 오래됐다`);
    // 아파트 평균값이 1억 ~ maxValue 밖이면 단위나 지역을 잘못 읽은 것
    const bad = months.filter(k => !(avg[k] > 1e8 && avg[k] < maxValue));
    if (bad.length) throw new Error(`${name} 평균가 값이 이상하다: ${bad.slice(0, 5).map(k => k + '=' + avg[k]).join(', ')}`);
    for (let k = ACTUAL_FROM; k <= latest; k = nextMonth(k)) if (!avg[k]) throw new Error(`${name} 평균가에 ${k} 가 빠졌다`);

    let est = null;
    if (idx && idx[FIRST] && idx[ACTUAL_FROM]) {
        est = {};
        for (let k = FIRST; k < ACTUAL_FROM; k = nextMonth(k)) {
            if (!idx[k]) { est = null; break; }
            est[k] = Math.round(avg[ACTUAL_FROM] * idx[k] / idx[ACTUAL_FROM] / 1e4) * 1e4;   // 만 원 단위로
        }
    }
    if (est) console.log(`  ${name} 추정: ${FIRST} ${est[FIRST]} 원 … 2008-11 ${est['2008-11']} 원 (2008-12 실제 ${avg[ACTUAL_FROM]} 원)`);
    else console.log(`  ${name}: 지수로 추정 못 함 — ${ACTUAL_FROM} 부터만 싣는다`);
    const monthly = {};
    if (est) Object.keys(est).sort().forEach(k => { monthly[k] = est[k]; });
    months.filter(k => k >= ACTUAL_FROM || !est).forEach(k => { monthly[k] = avg[k]; });
    return { monthly: monthly, latest: latest, estimatedBefore: est ? ACTUAL_FROM : null };
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
    const seoul = buildRegion('서울', rowSeries(top, seoulRow), await getIndex({}, isSeoul, '서울 지수'), now, 1e10);

    // 강남 (있으면): KB 권역 강남11개구. 못 받으면 지난 값을 그대로 둔다
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 처음 */ }
    let gangnam = null;
    try {
        const row = top.rows.find(isGangnamArea);
        if (!row) throw new Error('평균가에 강남 권역 줄이 없다');
        const gName = String(row['지역명']);
        gangnam = Object.assign({ name: gName }, buildRegion(gName, rowSeries(top, row), await getIndex({}, isGangnamArea, '강남 지수'), now, 3e10));
    } catch (e) {
        console.log('강남을 못 만들었다 — 지난 값을 그대로 둔다:', e.message);
        gangnam = prev && prev.gangnam ? prev.gangnam : null;
    }

    const out = {
        source: 'KB부동산 월간 주택가격동향 — 아파트 평균 매매가격(서울' + (gangnam ? ' · ' + gangnam.name : '') + ')',
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
