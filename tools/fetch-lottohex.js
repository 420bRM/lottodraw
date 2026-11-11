#!/usr/bin/env node
/* LottoHex 이번 주 모습(2026-11-09 — lottohex.html 정적 본문용)을 lottohex-snapshot.json 에 적는다.
 *
 * 서버의 공개 API(/api/territory — 로그인 없이 누구나 보는 것)만 읽는다: 참여자 수, 차지된 칸 번호, Map 랭킹 10위, 지난 분기 확정 10위.
 * 별명 · 칸 수 · 다녀온 판매점 수는 지도에서도 모두에게 보이는 값이다(개인정보 처리방침 pv.m7). 어느 판매점을 언제는 서버도 내주지 않는다.
 *
 * - update-lotto-data 워크플로가 매주 build-static-stats.js 앞에서 부른다.
 * - 받지 못하면(네트워크 · 서버 오류) 파일을 그대로 두고 0 으로 끝난다 — 지난주 모습으로 페이지를 만든다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'lottohex-snapshot.json');
const API = process.env.LOTTOHEX_API || 'https://api.lottodraw.kr/api/territory';
const TOP = 10;

const kstDate = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

async function main() {
    let j;
    try {
        const r = await fetch(API, { headers: { Accept: 'application/json', 'User-Agent': 'lottodraw-build' }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        j = await r.json();
        if (!j || !j.season || !j.cells) throw new Error('모양이 다름');
    } catch (e) {
        console.log('LottoHex 를 받지 못해 지난 모습을 그대로 씁니다: ' + e.message);
        return;
    }
    const pick = r => ({ nick: r.nick || null, cells: r.cells || 0, stores: r.stores || 0 });
    const snap = {
        note: 'LottoHex 공개 모습(api /api/territory). tools/fetch-lottohex.js 가 매주 적는다 — lottohex.html 정적 본문용',
        at: kstDate(Date.now()),
        season: { id: j.season.id, from: j.season.from, to: j.season.to },
        players: j.players || 0,
        cells: Object.keys(j.cells).sort(),
        rank: (j.rank || []).slice(0, TOP).map(pick),
        last: j.last && j.last.rank ? { id: j.last.id, rank: j.last.rank.slice(0, TOP).map(pick) } : null,
    };
    // 날짜만 바뀐 것이면 다시 쓰지 않는다(쓸데없는 커밋을 줄인다)
    try {
        const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
        const same = JSON.stringify(Object.assign({}, old, { at: '' })) === JSON.stringify(Object.assign({}, snap, { at: '' }));
        if (same) { console.log('LottoHex 모습이 그대로입니다(' + old.at + ')'); return; }
    } catch (e) { /* 처음 */ }
    fs.writeFileSync(OUT, JSON.stringify(snap) + '\n');
    console.log(`LottoHex: 참여 ${snap.players}명 · 차지된 칸 ${snap.cells.length}개 · 랭킹 ${snap.rank.length}명 (${snap.at})`);
}

main().catch(e => { console.log('LottoHex 스냅숏 실패: ' + e.message); });
