#!/usr/bin/env node
// 동행복권 "판매점 찾기" → shops-all.json (지금 로또 6/45 를 파는 전국 판매점 — 판매점 지도의 "일반 판매점" 층)
//
// 받는 곳: https://www.dhlottery.co.kr/prchsplcsrch/selectLtShp.do?srchCtpvNm=<시도>&pageNum=<쪽>
//   동행복권 사이트의 "판매점 찾기" 화면이 부르는 것과 같은 공개 조회(GET, 로그인 없음). 한 쪽에 10곳으로 고정이고
//   (recordCountPerPage 를 키워도 10), 응답은 { data: { total, list: [{ ltShpId, conmNm, tm1BplcLctnAddr(시도),
//   tm2BplcLctnAddr(시군구), l645LtNtslYn(로또 판매), shpLat, shpLot, ... }] } }. robots.txt 는 /resources/ · /winImages/ 만 막는다.
//   시도를 비우면 전국(2026-10-26 14,577곳 · 1,458쪽 — 연금복권 · 스피또만 파는 곳 포함, 그런 곳은 뺀다). 쪽 순서는 늘 같다.
// 예의: 한 번에 한 요청, 요청 사이 1.2초(빨리 받으면 몇백 번째에서 연결이 끊겼다). 40분쯤 걸린다 — 판매점은 자주 안 바뀌니 한 달에 한 번이면 된다.
// 끊기면 5 · 20 · 60 · 120초 쉬고 다시. 그래도 안 되는 쪽은 건너뛰고, 건너뛴 쪽이 2%를 넘으면 저장하지 않는다.
//
// 저장하는 것: 판매점 번호 · 상호 · 시도 · 시군구 · 지도 좌표(소수 5자리)만. 도로명 상세 주소 · 전화번호는 저장하지 않는다
// (stores-data.json 과 같은 원칙. 카드의 카카오맵 · 네이버지도 링크로 찾아갈 수 있다).
// 사업장 위치라 개인위치정보가 아니다(README 4-9).
//
//   node tools/update-all-shops.js
//
// 새로 받은 곳이 전보다 20% 넘게 적으면(사이트 고장 · 막힘) 덮어쓰지 않고 실패로 끝낸다.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'shops-all.json');
const API = 'https://www.dhlottery.co.kr/prchsplcsrch/selectLtShp.do?';
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.dhlottery.co.kr/prchsplcsrch/home' };
const DELAY = 1200;
const BACKOFF = [5, 20, 60, 120];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(n) {
    const q = new URLSearchParams({ srchCtpvNm: '', srchSggNm: '', pageNum: String(n), recordCountPerPage: '10', pageCount: '5' });
    for (let tryNo = 0; ; tryNo++) {
        try {
            const res = await fetch(API + q, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const j = await res.json();
            if (!j || !j.data || !Array.isArray(j.data.list)) throw new Error('모양이 다름');
            return j.data;
        } catch (e) {
            if (tryNo >= BACKOFF.length) throw new Error(`${n}쪽: ${e.message}`);
            await sleep(BACKOFF[tryNo] * 1000);
        }
    }
}
function coord(v, lo, hi) { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1e5) / 1e5 : null; }
// update-stores.js 의 place 와 같은 셈: "전남광주"는 구면 광주, 시 · 군이면 전남
function sidoOf(x) {
    const s = String(x.tm1BplcLctnAddr || '').trim(), gu = String(x.tm2BplcLctnAddr || '').trim();
    if (s === '전남광주' || s === '전남' || s === '광주') return /구$/.test(gu) ? '광주' : '전남';
    return s;
}

(async () => {
    const t0 = Date.now();
    const shops = new Map();
    const first = await page(1);
    const pages = Math.ceil((first.total || 0) / 10);
    console.log(`전국 ${first.total || 0}곳 · ${pages}쪽`);
    const skipped = [];
    for (let n = 1; n <= pages; n++) {
        let d = first;
        if (n > 1) {
            await sleep(DELAY);
            try { d = await page(n); } catch (e) { console.log('  건너뜀', e.message); skipped.push(n); continue; }
        }
        {
            for (const x of d.list) {
                if (x.l645LtNtslYn !== 'Y') continue;   // 로또 6/45 를 안 파는 곳(연금 · 스피또만)
                const lat = coord(x.shpLat, 33, 39), lng = coord(x.shpLot, 124, 132);
                if (lat === null || lng === null || !x.ltShpId) continue;
                shops.set(String(x.ltShpId), [String(x.conmNm || '').trim(), sidoOf(x), String(x.tm2BplcLctnAddr || '').trim(), lat, lng]);
            }
            if (n % 100 === 0) console.log(`  ${n}/${pages}쪽 · 지금까지 ${shops.size}곳 · ${Math.round((Date.now() - t0) / 60000)}분`);
        }
    }
    if (skipped.length > pages * 0.02) { console.error(`건너뛴 쪽이 ${skipped.length}개 — 저장하지 않는다`); process.exit(1); }
    const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
    const oldCount = old ? Object.keys(old.shops).length : 0;
    console.log(`받은 판매점 ${shops.size}곳 (전 ${oldCount}곳) · ${Math.round((Date.now() - t0) / 60000)}분`);
    if (shops.size < 1000 || shops.size < oldCount * 0.8) { console.error('너무 적다 — 저장하지 않는다'); process.exit(1); }
    const sorted = Object.fromEntries([...shops].sort((a, b) => a[0].localeCompare(b[0])));
    const out = {
        source: 'https://www.dhlottery.co.kr/prchsplcsrch/home (동행복권 판매점 찾기)',
        note: 'shops: { 판매점 번호: [상호, 시도, 시군구, 위도, 경도] } — 지금 로또 6/45 를 파는 곳. tools/update-all-shops.js 가 만든다',
        updated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
        shops: sorted,
    };
    const prev = old ? JSON.stringify(old.shops) : '';
    if (prev === JSON.stringify(sorted)) { console.log('바뀐 것 없음'); return; }
    fs.writeFileSync(FILE, JSON.stringify(out) + '\n');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
    console.log('저장했다');
})().catch(e => { console.error(e.message); process.exit(1); });
