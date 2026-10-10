#!/usr/bin/env node
// 동행복권 공식 조회 API → lotto-data.json 증분 갱신.
// 같은 응답의 2~5등(당첨 게임 수 · 1게임당 금액)과 회차 판매액은 prize-data.json 에 따로 둔다.
// lotto-data.json 은 모든 페이지가 받으므로 가볍게 두고, 2~5등은 쓰는 곳(생성기 · TOP 50)만 읽는다.
// 2026-10 Actions 로그로 확인: 1회부터 rnk2~5WnNope/WnAmt, wholEpsdSumNtslAmt(판매액)가 다 있다.
// rlvtEpsdSumNtslAmt 는 판매액이 아니다(262회 이후 판매액의 절반쯤 — 당첨금 재원 쪽).
//
//   node tools/update-lotto-data.js            새 회차 추가 + 최근 3회차 재확인
//   node tools/update-lotto-data.js --full     1회차부터 전부 API와 대조해 교정
//   node tools/update-lotto-data.js --missing  2~5등이 비었거나 집계 전인 회차만 다시 받는다(--full 이 중간에 놓친 회차 채우기)
//   node tools/update-lotto-data.js --dry-run  바뀔 내용만 출력하고 파일은 안 씀
//
// 의존성 없음. Node 8 이상. 브라우저에서 이 API를 부르면 CORS로 막히므로
// 수집은 반드시 이 스크립트(빌드 타임)에서만 한다.

'use strict';
const fs = require('fs');
const https = require('https');
const path = require('path');

const FILE = path.join(__dirname, '..', 'lotto-data.json');
const PRIZE_FILE = path.join(__dirname, '..', 'prize-data.json');
const API = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=';
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
// 추첨 직후에 받으면 1등 당첨자 수/금액이 0으로 들어오는 경우가 있다(1228회가 그랬다).
// 매번 최근 몇 회차를 다시 받아 늦게 확정된 값을 반영한다.
const REFRESH_RECENT = 3;
const DELAY_MS = 150;
const FULL_DELAY_MS = 300;   // 전 회차를 다시 받을 때는 조금 더 천천히

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const MISSING = args.includes('--missing');
// 여러 회차를 한꺼번에 받을 때(--full, --missing)는 한 회차가 끝내 안 받아져도 멈추지 않고 넘어간다 — 2026-10 첫 --full 이
// 1094회 timeout 하나로 앞의 1,093회차 결과까지 버렸다. 놓친 회차는 끝에 한 번 더 받고, 그래도 안 되면 --missing 으로 채운다
const BULK = FULL || MISSING;
const DRY = args.includes('--dry-run');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getText(url) {
    return new Promise((resolve, reject) => {
        // https.get(url, options, cb) 형태는 Node 10.9+ 전용이라 options 하나로 넘긴다
        const opts = Object.assign(require('url').parse(url), {
            headers: { 'User-Agent': UA, 'Accept': 'application/json' },
            timeout: 15000,
        });
        const req = https.get(opts, res => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}${res.headers.location ? ' → ' + res.headers.location : ''}`));
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', c => { body += c; });
            res.on('end', () => resolve(body));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

// 응답 한 줄 → 2~5등 · 판매액. 숫자가 아니면 null(그 회차는 비워 둔다)
const PRIZE_KEYS = [['w2', 'rnk2WnNope'], ['a2', 'rnk2WnAmt'], ['w3', 'rnk3WnNope'], ['a3', 'rnk3WnAmt'],
    ['w4', 'rnk4WnNope'], ['a4', 'rnk4WnAmt'], ['w5', 'rnk5WnNope'], ['a5', 'rnk5WnAmt'], ['sales', 'wholEpsdSumNtslAmt']];
function prizeOf(x) {
    const p = { round: x.ltEpsd };
    for (const [k, src] of PRIZE_KEYS) {
        const v = Number(x[src]);
        if (!Number.isInteger(v) || v < 0) return null;
        p[k] = v;
    }
    return p;
}

// 반환: { draw, prize }, 또는 아직 추첨 전이면 null. prize 는 2~5등 · 판매액(못 읽으면 null).
// "추첨 전(빈 목록)"과 "차단/구조 변경(JSON 아님)"을 구분해야 한다 — 뒤쪽을 끝으로
// 착각하면 무인 실행에서 조용히 갱신이 멈춘다.
async function fetchRoundFull(round, tries) {
    let lastErr;
    for (let attempt = 1; attempt <= (tries || 4); attempt++) {
        try {
            const text = await getText(API + round);
            let json;
            try { json = JSON.parse(text); } catch (e) {
                throw new Error(`JSON이 아닌 응답 (차단 또는 API 변경?): ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
            }
            const list = json && json.data && json.data.list;
            if (!Array.isArray(list)) throw new Error(`예상과 다른 응답 구조: ${text.slice(0, 120)}`);
            if (list.length === 0) return null;
            const x = list[0];
            if (x.ltEpsd !== round) throw new Error(`${round}회를 요청했는데 ${x.ltEpsd}회가 왔다`);
            const ymd = String(x.ltRflYmd);
            const draw = {
                round: x.ltEpsd,
                date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
                numbers: [x.tm1WnNo, x.tm2WnNo, x.tm3WnNo, x.tm4WnNo, x.tm5WnNo, x.tm6WnNo].sort((a, b) => a - b),
                bonus: x.bnsWnNo,
                firstPrizeWinners: x.rnk1WnNope,
                firstPrizeAmount: x.rnk1WnAmt,
            };
            return { draw: draw, prize: prizeOf(x) };
        } catch (e) {
            lastErr = e;
            if (/JSON이 아닌|예상과 다른|요청했는데/.test(e.message)) break; // 재시도해도 같다
            await sleep(1000 * Math.pow(2, attempt - 1));
        }
    }
    throw new Error(`${round}회 조회 실패: ${lastErr.message}`);
}
// 회차 객체만 (tools/wait-for-draw.js 가 쓴다)
const fetchRound = round => fetchRoundFull(round).then(r => (r ? r.draw : null));

// 2~5등 검사: 정수 · 0 이상, 당첨 게임이 있으면 금액도 있어야 한다.
// 추첨 직후에는 2~5등이 0으로 올 수 있다 — 5등 0게임이면 "아직 집계 전"으로 보고 오류로 치지 않는다(다음 실행이 고친다)
function prizeProblems(p) {
    const errs = [];
    PRIZE_KEYS.forEach(([k]) => { if (!Number.isInteger(p[k]) || p[k] < 0) errs.push(`${p.round}회 ${k} 이상: ${p[k]}`); });
    if (p.w5 > 0) [2, 3, 4, 5].forEach(r => { if (p['w' + r] > 0 && !(p['a' + r] > 0)) errs.push(`${p.round}회 ${r}등 당첨 게임은 있는데 금액이 0`); });
    return errs;
}
function validatePrize(list) {
    return [].concat(...list.map(prizeProblems));
}
// prize-data.json: 회차 하나에 한 줄 (diff 가 회차 단위로 보이게)
function prizeJson(list, lastUpdated, eol) {
    const head = { source: '동행복권 회차별 당첨 결과(selectPstLt645Info.do)', note: 'w2~w5: 당첨 게임 수, a2~a5: 1게임당 당첨금(원), sales: 회차 판매액(원). 1등은 lotto-data.json', lastUpdated: lastUpdated };
    const lines = list.map(p => '    ' + JSON.stringify(p));
    return '{' + eol + Object.keys(head).map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(head[k])},`).join(eol) + eol
        + '  "draws": [' + eol + lines.join(',' + eol) + eol + '  ]' + eol + '}' + eol;
}

function validate(data) {
    const errs = [];
    const draws = data.draws;
    draws.forEach((d, i) => {
        const expectRound = draws.length - i;
        if (d.round !== expectRound) errs.push(`${i}번째 항목 회차 ${d.round} (기대값 ${expectRound}) — 누락/중복/정렬 오류`);
        // 회차 목록과 날짜 표시에 쓰이므로 날짜가 빠진 회차가 있으면 안 된다
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) errs.push(`${d.round}회 날짜 없음/형식 오류: ${d.date} (처음이면 --full 로 실행)`);
        else if (i > 0 && draws[i - 1].date && draws[i - 1].date <= d.date) errs.push(`${d.round}회 날짜가 다음 회차보다 늦다: ${d.date}`);
        const n = d.numbers;
        const ok = Array.isArray(n) && n.length === 6 && new Set(n).size === 6 &&
            n.every(v => Number.isInteger(v) && v >= 1 && v <= 45) &&
            n.every((v, k) => k === 0 || n[k - 1] < v);
        if (!ok) errs.push(`${d.round}회 번호 이상: ${JSON.stringify(n)}`);
        if (!Number.isInteger(d.bonus) || d.bonus < 1 || d.bonus > 45 || (ok && n.includes(d.bonus)))
            errs.push(`${d.round}회 보너스 이상: ${d.bonus}`);
        if (!Number.isInteger(d.firstPrizeWinners) || d.firstPrizeWinners < 0) errs.push(`${d.round}회 1등 당첨자 수 이상`);
        if (!Number.isInteger(d.firstPrizeAmount) || d.firstPrizeAmount < 0) errs.push(`${d.round}회 1등 금액 이상`);
    });
    if (data.totalDraws !== draws.length) errs.push(`totalDraws ${data.totalDraws} ≠ 실제 ${draws.length}`);
    return errs;
}

function diffDraw(a, b) {
    return ['date', 'numbers', 'bonus', 'firstPrizeWinners', 'firstPrizeAmount']
        .filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
        .map(k => `${k} ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
}

function setOutput(key, value) {
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function main() {
    const raw = fs.readFileSync(FILE, 'utf8');
    // 원본의 줄바꿈/끝 개행을 그대로 따른다. 안 그러면 한 회차만 추가해도 전체 파일 diff가 된다.
    const eol = /\r\n/.test(raw) ? '\r\n' : '\n';
    const trailing = /\r?\n$/.test(raw);
    const data = JSON.parse(raw);
    const byRound = new Map(data.draws.map(d => [d.round, d]));
    const maxRound = data.draws.reduce((m, d) => Math.max(m, d.round), 0);

    // 2~5등 (없으면 새로 만든다 — 처음엔 --full 로 채운다)
    let prizeRaw = '';
    try { prizeRaw = fs.readFileSync(PRIZE_FILE, 'utf8'); } catch (e) { /* 처음 */ }
    const prizeBy = new Map((prizeRaw ? JSON.parse(prizeRaw).draws : []).map(p => [p.round, p]));
    let prizeChanged = 0;
    let prizeMissing = 0;
    // 새로 받은 2~5등이 앞뒤가 안 맞으면(당첨 게임은 있는데 금액 0 등) 이번에는 저장하지 않는다 — 1등 갱신을 막지 않고,
    // 최근 회차는 다음 실행이 다시 받는다(REFRESH_RECENT). 파일에 이미 있던 값이 이상한 것만 검증에서 멈춘다
    const putPrize = (r, p) => {
        if (!p) { prizeMissing++; return; }
        const bad = prizeProblems(p);
        if (bad.length) { prizeMissing++; console.log(`  ! 2~5등 값이 이상해 이번에는 건너뛴다: ${bad.join(' / ')}`); return; }
        if (JSON.stringify(prizeBy.get(r)) !== JSON.stringify(p)) { prizeBy.set(r, p); prizeChanged++; }
    };

    const added = [];
    const changed = [];

    const refreshFrom = FULL ? 1 : Math.max(1, maxRound - REFRESH_RECENT + 1);
    const todo = [];
    if (MISSING) {
        for (let r = 1; r <= maxRound; r++) { const p = prizeBy.get(r); if (!p || !(p.w5 > 0)) todo.push(r); }
        console.log(`현재 ${maxRound}회차까지 보유. 2~5등이 비었거나 집계 전인 ${todo.length}회차를 받는다.`);
    } else {
        for (let r = refreshFrom; r <= maxRound; r++) todo.push(r);
        console.log(`현재 ${maxRound}회차까지 보유. ${refreshFrom}~${maxRound}회 재확인 후 ${maxRound + 1}회부터 새로 받는다.`);
    }

    const refresh = async r => {
        const res = await fetchRoundFull(r, BULK ? 6 : 4);
        if (!res) throw new Error(`${r}회는 이미 보유한 회차인데 API가 빈 목록을 돌려줬다`);
        const got = res.draw;
        const diffs = diffDraw(byRound.get(r), got);
        if (diffs.length) { changed.push({ round: r, diffs }); byRound.set(r, got); }
        putPrize(r, res.prize);
    };
    let missed = [];
    for (let k = 0; k < todo.length; k++) {
        const r = todo[k];
        if (!BULK) await refresh(r);
        else {
            try { await refresh(r); } catch (e) { missed.push(r); console.log(`  ! ${e.message} — 끝에 다시 받는다`); }
        }
        if (BULK && (k + 1) % 100 === 0) console.log(`  … ${k + 1}/${todo.length}회차 확인 (${r}회)`);
        await sleep(BULK ? FULL_DELAY_MS : DELAY_MS);
    }
    if (missed.length) {
        console.log(`  놓친 ${missed.length}회차를 30초 쉬고 다시 받는다: ${missed.join(', ')}`);
        await sleep(30000);
        const again = [];
        for (const r of missed) {
            try { await refresh(r); } catch (e) { again.push(r); console.log(`  ! ${e.message}`); }
            await sleep(1000);
        }
        missed = again;
        if (missed.length) console.log(`  끝내 못 받은 회차 ${missed.length}개(${missed.join(', ')}) — 받은 것만 저장한다. --missing 으로 다시 채운다`);
    }

    // 새 회차: --missing 은 빈 칸만 채우므로 찾지 않는다. --full 은 찾되, 조회가 끝내 안 되면 오류로 치지 않고 그만 찾는다
    // (추첨 전 회차를 물었는데 응답이 늦게 와서 앞에서 받은 1,245회차를 버린 일이 있다 — 새 회차는 다음 정기 실행이 받는다)
    for (let r = maxRound + 1; !MISSING; r++) {
        let res;
        try { res = await fetchRoundFull(r); } catch (e) {
            if (!BULK) throw e;
            console.log(`  ! ${e.message} — 새 회차는 다음 실행에서 받는다`);
            break;
        }
        if (!res) break;
        const got = res.draw;
        byRound.set(r, got);
        putPrize(r, res.prize);
        added.push(r);
        console.log(`  + ${r}회 ${got.date} [${got.numbers.join(', ')}] +${got.bonus}`);
        await sleep(DELAY_MS);
    }

    const draws = [...byRound.values()].sort((a, b) => b.round - a.round);
    const next = { totalDraws: draws.length, lastUpdated: draws[0].date || data.lastUpdated, draws };

    const prizeList = [...prizeBy.values()].filter(p => byRound.has(p.round)).sort((a, b) => b.round - a.round);
    const errs = validate(next).concat(validatePrize(prizeList));
    if (errs.length) {
        console.error(`검증 실패 — 파일을 쓰지 않는다:\n  ${errs.slice(0, 20).join('\n  ')}${errs.length > 20 ? `\n  … 외 ${errs.length - 20}건` : ''}`);
        process.exit(1);
    }

    // 날짜만 새로 붙은 회차는 한 줄로 요약한다 (--full 첫 실행 때 1,000줄 넘게 찍히지 않도록)
    const dateOnly = changed.filter(c => c.diffs.length === 1 && c.diffs[0].startsWith('date undefined'));
    changed.filter(c => dateOnly.indexOf(c) === -1).forEach(c => console.log(`  ~ ${c.round}회 교정: ${c.diffs.join(' / ')}`));
    if (dateOnly.length) console.log(`  ~ 추첨일 새로 기록: ${dateOnly.length}회차`);

    let out = JSON.stringify(next, null, 2).replace(/\n/g, eol);
    if (trailing) out += eol;

    const prizeOut = prizeJson(prizeList, next.lastUpdated, eol);
    const prizeIsChanged = prizeOut !== prizeRaw;
    const isChanged = out !== raw;
    console.log(`\n추가 ${added.length}회차, 교정 ${changed.length}회차 → 최신 ${draws[0].round}회 (${next.lastUpdated})`);
    console.log(`2~5등: ${prizeList.length}회차 보유, 이번에 바뀐 회차 ${prizeChanged}${prizeMissing ? `, 응답에서 못 읽은 회차 ${prizeMissing}` : ''}`);
    setOutput('changed', isChanged || prizeIsChanged);
    setOutput('missed', missed.length);
    setOutput('latest', draws[0].round);
    setOutput('added', added.length);

    if (!isChanged && !prizeIsChanged) { console.log('변경 없음.'); return; }
    if (DRY) { console.log('--dry-run: 파일은 쓰지 않았다.'); return; }
    if (isChanged) { fs.writeFileSync(FILE, out); console.log(`${path.basename(FILE)} 저장.`); }
    if (prizeIsChanged) { fs.writeFileSync(PRIZE_FILE, prizeOut); console.log(`${path.basename(PRIZE_FILE)} 저장.`); }
}

// tools/wait-for-draw.js 가 fetchRound 를 빌려 쓴다. 불러 쓸 때는 수집을 돌리지 않는다.
module.exports = { fetchRound };

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
