// 사용: node tools/update-cpi.js
// 한국 소비자물가지수(총지수, 월별)를 받아 cpi-data.json 으로 저장한다.
// TOP 50 페이지 그래프의 "물가 반영"(그 회차 금액을 지금 돈 가치로 바꿔 보기)이 이 파일을 쓴다.
//
// 받는 곳은 위에서부터 차례로 시도한다. 셋 다 같은 통계(통계청 소비자물가지수 총지수)를 옮겨 실은 것이다.
//   1. 한국은행 ECOS   — 저장소 비밀값 ECOS_API_KEY 가 있을 때만 (무료 인증키, ecos.bok.or.kr)
//   2. OECD 데이터 API — 키 없이 받는다. 한국 자료는 통계청 소비자물가지수(National methodology)
//   3. FRED            — 키 없이 받는다. OECD 자료를 옮겨 실은 것
// 기준연도(=100)는 곳마다 다를 수 있지만 상관없다. 그래프는 두 달의 비율만 쓴다.
//
// 이 컨테이너(Claude 작업 환경)에서는 위 주소들이 막혀 있어 GitHub Actions(.github/workflows/update-cpi.yml)에서 돈다.
// 매달 7일 예약 실행과, 이 파일을 고쳐 푸시했을 때 돈다. 바뀐 게 있으면 cpi-data.json 을 커밋한다.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'cpi-data.json');
const FIRST = '2002-12';          // 1회 추첨 달. 이 달부터 있어야 한다
const MAX_LAG_MONTHS = 5;         // 마지막 달이 이보다 오래되면 그 출처는 버린다(갱신이 멈춘 자료)

const ym = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };

async function get(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    try {
        const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'lottodraw.kr cpi updater', Accept: '*/*' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(t);
    }
}

// 따옴표가 든 칸까지 읽는 작은 CSV 해석기
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') q = false;
            else cell += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.length > 1 || r[0]);
}

const SOURCES = [
    {
        name: '한국은행 ECOS (통계청 소비자물가지수 총지수, 2020=100)',
        enabled: () => !!process.env.ECOS_API_KEY,
        url: () => `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(process.env.ECOS_API_KEY)}/json/kr/1/1000/901Y009/M/200201/${ym(new Date()).replace('-', '')}/0`,
        public: 'https://ecos.bok.or.kr/ (통계표 901Y009, 항목 0 총지수)',
        parse(text) {
            const j = JSON.parse(text);
            const rows = j && j.StatisticSearch && j.StatisticSearch.row;
            if (!Array.isArray(rows)) throw new Error('예상과 다른 응답: ' + text.slice(0, 160));
            const out = {};
            rows.forEach(r => { out[`${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}`] = Number(r.DATA_VALUE); });
            return out;
        },
    },
    {
        name: 'OECD 데이터 API (통계청 소비자물가지수 총지수)',
        enabled: () => true,
        url: () => 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/KOR.M.N.CPI.IX._T.N._Z?startPeriod=2002-01&dimensionAtObservation=AllDimensions&format=csvfile',
        public: 'https://data-explorer.oecd.org/ (Consumer price indices, Korea, monthly, index)',
        parse(text) {
            const rows = parseCsv(text);
            const head = rows.shift() || [];
            const ti = head.indexOf('TIME_PERIOD');
            const vi = head.indexOf('OBS_VALUE');
            if (ti < 0 || vi < 0) throw new Error('TIME_PERIOD/OBS_VALUE 칸이 없다: ' + head.join(',').slice(0, 160));
            const out = {};
            rows.forEach(r => { if (/^\d{4}-\d{2}$/.test(r[ti]) && r[vi] !== '') out[r[ti]] = Number(r[vi]); });
            return out;
        },
    },
    {
        name: 'FRED (OECD 소비자물가지수, 한국 총지수)',
        enabled: () => true,
        url: () => 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=KORCPIALLMINMEI',
        public: 'https://fred.stlouisfed.org/series/KORCPIALLMINMEI',
        parse(text) {
            const rows = parseCsv(text);
            rows.shift();
            const out = {};
            rows.forEach(r => { if (/^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r[1] !== '.' && r[1] !== '') out[r[0].slice(0, 7)] = Number(r[1]); });
            return out;
        },
    },
];

// 1회 달부터 마지막 달까지 빠짐없이, 값은 모두 양수, 마지막 달은 최근이어야 한다
function check(monthly) {
    const keys = Object.keys(monthly).sort();
    if (!keys.length) throw new Error('자료가 비었다');
    const from = keys.find(k => k >= FIRST);
    if (!from || keys[0] > FIRST) throw new Error(`${FIRST} 자료가 없다 (첫 달 ${keys[0]})`);
    const last = keys[keys.length - 1];
    const lag = monthsBetween(last, ym(new Date()));
    if (lag > MAX_LAG_MONTHS) throw new Error(`마지막 달이 ${last} 로 ${lag}개월 전이다 (갱신이 멈춘 자료)`);
    const out = {};
    for (let k = FIRST, n = 0; k <= last; n++) {
        const v = monthly[k];
        if (!(v > 0)) throw new Error(`${k} 값이 없거나 잘못됐다: ${v}`);
        out[k] = Math.round(v * 1000) / 1000;
        const [y, m] = k.split('-').map(Number);
        k = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
        if (n > 1000) throw new Error('달 계산이 끝나지 않는다');
    }
    return { monthly: out, latest: last };
}

async function main() {
    const errors = [];
    for (const src of SOURCES) {
        if (!src.enabled()) { console.log(`건너뜀: ${src.name} (설정 없음)`); continue; }
        try {
            const got = check(src.parse(await get(src.url())));
            const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
            const same = prev && JSON.stringify(prev.monthly) === JSON.stringify(got.monthly);
            const n = Object.keys(got.monthly).length;
            console.log(`받음: ${src.name} — ${FIRST} ~ ${got.latest} (${n}개월)${same ? ', 바뀐 것 없음' : ''}`);
            if (!same) {
                const data = {
                    source: src.name,
                    sourceUrl: src.public,
                    note: '월별 소비자물가지수(총지수). 그래프는 두 달의 비율만 쓰므로 기준연도와 상관없다.',
                    updated: new Date().toISOString().slice(0, 10),
                    latest: got.latest,
                    monthly: got.monthly,
                };
                fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
            }
            if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${same ? 'false' : 'true'}\nlatest=${got.latest}\n`);
            return;
        } catch (e) {
            console.log(`실패: ${src.name} — ${e.message}`);
            errors.push(`${src.name}: ${e.message}`);
        }
    }
    console.error('물가지수를 어디서도 받지 못했다. 기존 cpi-data.json 은 그대로 둔다.\n' + errors.join('\n'));
    process.exit(1);
}

if (require.main === module) main();
module.exports = { parseCsv, check, SOURCES };
