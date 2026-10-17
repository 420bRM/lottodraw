#!/usr/bin/env node
// 동행복권 "당첨 판매점 조회" → stores-data.json (회차별 1등 · 2등 판매점)
//
// 받는 곳: https://www.dhlottery.co.kr/wnprchsplcsrch/selectLtWnShp.do?srchWnShpRnk=all&srchLtEpsd=<회차>
//   동행복권 사이트의 "당첨 판매점 조회" 화면이 부르는 것과 같은 공개 조회(GET, 로그인 없음). robots.txt 는
//   /resources/ · /winImages/ 만 막는다(2026-10-17 확인). 262회(2007-12)부터 자료가 있고 그 앞은 빈 목록이다.
//   1등은 자동 · 수동 · 반자동이 나오고, 2등은 최근 회차만 나온다(그래서 2등은 판매점 번호만 둔다).
// 예의: 한 번에 한 요청, 요청 사이 1초(전체 다시 받기) · 0.3초(평소). 평소에는 새 회차 + 최근 3회차만 받는다.
//
// 저장하는 것(통계에 필요한 만큼만): 판매점 번호 · 상호 · 시도 · 시군구 · 폐점 여부.
// 도로명 상세 주소 · 전화번호 · 좌표는 저장하지 않는다.
//
//   node tools/update-stores.js           새 회차 + 최근 3회차 다시 확인
//   node tools/update-stores.js --full    262회부터 전부 다시
//   node tools/update-stores.js --slow    빠진 회차까지 천천히(처음 채울 때). STORES_MAX_MINUTES=40 이면 40분 뒤 저장하고 멈춘다
//
// 실패해도 로또 갱신을 막지 않는다(워크플로에서 continue-on-error). 1등 판매점 수가 그 회차 1등 당첨자 수와
// 다르면(추첨 직후 아직 안 올라옴 등) 그 회차는 저장하지 않고 다음 실행에 다시 받는다.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'stores-data.json');
const API = 'https://www.dhlottery.co.kr/wnprchsplcsrch/selectLtWnShp.do?srchWnShpRnk=all&srchLtEpsd=';
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
const FIRST = 262;            // 이 회차부터 판매점 자료가 있다
const RECHECK = 3;
const FULL = process.argv.includes('--full');
const SLOW = FULL || process.argv.includes('--slow');   // 많이 받을 때(처음 한 번)는 천천히
const DELAY = SLOW ? 1000 : 300;
// 이 분이 지나면 받던 것까지 저장하고 멈춘다(다음 실행이 빠진 회차부터 잇는다). 0 = 끝까지
const MAX_MIN = Number(process.env.STORES_MAX_MINUTES || 0);
const INTERNET = '51100000';  // 동행복권 인터넷 판매 — 판매점 하나로 나온다

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 요청마다 15초 상한(서버가 응답을 끌어도 멈추지 않게)
async function getJson(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.text();
    try { return JSON.parse(body); } catch (e) { throw new Error('JSON 아님: ' + body.slice(0, 100)); }
}
async function fetchRound(r) {
    let err;
    for (let i = 0; i < 4; i++) {
        try {
            const j = await getJson(API + r);
            const list = j && j.data && j.data.list;
            if (!Array.isArray(list)) throw new Error('예상과 다른 응답');
            if (j.data.total !== list.length) throw new Error(`목록이 잘렸다 (${list.length}/${j.data.total})`);
            return list;
        } catch (e) { err = e; await sleep(2000 * (i + 1)); }
    }
    throw new Error(`${r}회: ${err.message}`);
}

// "서울 성북구 …", "경기도 용인시 처인구 …", "강원특별자치도 …" → ['서울', '성북구']
// 동행복권은 광주를 "전남광주"로 적기도 한다(전남에는 구가 없다) — 먼저 본다
const SIDO = [['전남광주', '광주'], ['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'], ['대전', '대전'], ['울산', '울산'], ['세종', '세종'],
    ['경기', '경기'], ['강원', '강원'], ['충북', '충북'], ['충청북', '충북'], ['충남', '충남'], ['충청남', '충남'], ['전북', '전북'], ['전라북', '전북'],
    ['전남', '전남'], ['전라남', '전남'], ['경북', '경북'], ['경상북', '경북'], ['경남', '경남'], ['경상남', '경남'], ['제주', '제주']];
function place(x) {
    if (String(x.ltShpId) === INTERNET) return ['인터넷', ''];
    for (const addr of [x.shpAddr, x.befAddr, x.befRdnm && x.befRdnm.replace(/^\(당첨 당시 주소\)\s*/, '')]) {
        const parts = String(addr || '').trim().split(/\s+/);
        const hit = SIDO.find(([k]) => parts[0] && parts[0].startsWith(k));
        if (!hit) continue;
        const gu = /[시군구]$/.test(parts[1] || '') ? parts[1] : '';
        return [hit[1] === '전남' && /구$/.test(gu) ? '광주' : hit[1], gu];
    }
    return ['', ''];
}
const METHOD = { 자동: 'A', 수동: 'M', 반자동: 'S' };

function serialize(d) {
    const shops = Object.keys(d.shops).sort().map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(d.shops[k])}`);
    const rounds = Object.keys(d.rounds).map(Number).sort((a, b) => a - b).map(r => `    "${r}": ${JSON.stringify(d.rounds[r])}`);
    return '{\n'
        + `  "source": ${JSON.stringify(d.source)},\n  "note": ${JSON.stringify(d.note)},\n  "from": ${d.from},\n  "lastRound": ${d.lastRound},\n  "lastUpdated": ${JSON.stringify(d.lastUpdated)},\n`
        + '  "shops": {\n' + shops.join(',\n') + '\n  },\n'
        + '  "rounds": {\n' + rounds.join(',\n') + '\n  }\n}\n';
}

async function main() {
    const lotto = JSON.parse(fs.readFileSync(path.join(ROOT, 'lotto-data.json'), 'utf8'));
    const winners = new Map(lotto.draws.map(x => [x.round, x.firstPrizeWinners]));
    const latest = Math.max(...lotto.draws.map(x => x.round));
    let d = { shops: {}, rounds: {} };
    if (!FULL && fs.existsSync(FILE)) d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    d.source = '동행복권 당첨 판매점 조회(wnprchsplcsrch/selectLtWnShp.do)';
    d.note = 'shops: 판매점 번호 → [상호, 시도, 시군구, 폐점이면 1]. rounds: 회차 → { w1: [[판매점, A 자동 | M 수동 | S 반자동], …] 1등 게임마다 하나, w2: [판매점, …] 2등 게임마다 하나 }. 인터넷 판매는 시도 "인터넷"';
    d.from = FIRST;
    const have = Object.keys(d.rounds).map(Number);
    const last = have.length ? Math.max(...have) : FIRST - 1;
    const todo = [];
    for (let r = FULL ? FIRST : Math.max(FIRST, last - RECHECK + 1); r <= latest; r++) todo.push(r);
    // 빠진 회차(이전 실행에서 건너뛴 것)도 다시
    for (let r = FIRST; r <= last; r++) if (!d.rounds[r] && !todo.includes(r)) todo.push(r);
    todo.sort((a, b) => a - b);
    console.log(`판매점 자료 ${have.length}회차 보유. ${todo.length}회차를 받는다 (${todo[0] || '-'}~${todo[todo.length - 1] || '-'}).`);

    let changed = 0, skipped = [], failed = [];
    const t0 = Date.now();
    const save = () => {
        const rs = Object.keys(d.rounds).map(Number);
        d.lastRound = rs.length ? Math.max(...rs) : 0;
        d.lastUpdated = lotto.lastUpdated;
        fs.writeFileSync(FILE, serialize(d));
    };
    for (let i = 0; i < todo.length; i++) {
        const r = todo[i];
        if (MAX_MIN && Date.now() - t0 > MAX_MIN * 60e3) { console.log(`${MAX_MIN}분이 지나 ${r}회 앞에서 멈춘다 — 다음 실행이 잇는다`); break; }
        if (i && i % 25 === 0) console.log(`  … ${r}회 (${i}/${todo.length}, ${Math.round((Date.now() - t0) / 1000)}초, 실패 ${failed.length})`);
        if (changed && i % 50 === 0) save();   // 중간 저장(멈춰도 받은 데까지 남게)
        let list;
        try { list = await fetchRound(r); } catch (e) { failed.push(e.message); await sleep(DELAY); continue; }
        const w1 = [], w2 = [];
        for (const x of list) {
            const id = String(x.ltShpId || '');
            if (!/^\d{4,12}$/.test(id)) continue;
            const [sido, gu] = place(x);
            const prev = d.shops[id];
            d.shops[id] = [String(x.shpNm || x.tradNm || (prev && prev[0]) || '').trim(), sido || (prev ? prev[1] : ''), gu || (prev ? prev[2] : ''), x.status === '폐점' || x.slrOperSttsCd === '3' ? 1 : 0];
            if (x.wnShpRnk === 1) w1.push([id, METHOD[x.atmtPsvYnTxt] || '']);
            else if (x.wnShpRnk === 2) w2.push(id);
        }
        const expect = winners.get(r);
        if (expect !== undefined && w1.length !== expect) {
            // 추첨 직후에는 판매점이 늦게 올라온다 — 최근 회차는 다음에 다시. 오래된 회차는 공개 자료 그대로 두고 알린다
            if (r > latest - RECHECK) { skipped.push(`${r}회 1등 판매점 ${w1.length}곳 / 당첨 ${expect}게임 — 다음에 다시`); await sleep(DELAY); continue; }
            skipped.push(`${r}회 1등 판매점 ${w1.length}곳 / 당첨 ${expect}게임 (그대로 저장)`);
        }
        const rec = { w1, w2 };
        if (JSON.stringify(d.rounds[r]) !== JSON.stringify(rec)) { d.rounds[r] = rec; changed++; }
        await sleep(DELAY);
    }
    const rounds = Object.keys(d.rounds).map(Number);
    skipped.forEach(s => console.log('  ! ' + s));
    failed.forEach(s => console.log('  ✘ ' + s));
    if (!changed && fs.existsSync(FILE)) { console.log('바뀐 회차 없음'); setOutput('changed', 'false'); return; }
    save();
    console.log(`저장: ${changed}회차 바뀜, 모두 ${rounds.length}회차 · 판매점 ${Object.keys(d.shops).length}곳 (마지막 ${d.lastRound}회)`);
    setOutput('changed', 'true');
    if (failed.length > 20) process.exitCode = 1;
}
function setOutput(k, v) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); }

main().catch(e => { console.error(e); process.exit(1); });
