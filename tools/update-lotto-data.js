#!/usr/bin/env node
// 동행복권 공식 조회 API → lotto-data.json 증분 갱신.
//
//   node tools/update-lotto-data.js            새 회차 추가 + 최근 3회차 재확인
//   node tools/update-lotto-data.js --full     1회차부터 전부 API와 대조해 교정
//   node tools/update-lotto-data.js --dry-run  바뀔 내용만 출력하고 파일은 안 씀
//
// 의존성 없음. Node 8 이상. 브라우저에서 이 API를 부르면 CORS로 막히므로
// 수집은 반드시 이 스크립트(빌드 타임)에서만 한다.

'use strict';
const fs = require('fs');
const https = require('https');
const path = require('path');

const FILE = path.join(__dirname, '..', 'lotto-data.json');
const API = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=';
const UA = 'Mozilla/5.0 (compatible; lottodraw.kr data updater)';
// 추첨 직후에 받으면 1등 당첨자 수/금액이 0으로 들어오는 경우가 있다(1228회가 그랬다).
// 매번 최근 몇 회차를 다시 받아 늦게 확정된 값을 반영한다.
const REFRESH_RECENT = 3;
const DELAY_MS = 150;

const args = process.argv.slice(2);
const FULL = args.includes('--full');
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

// 반환: 회차 객체, 또는 아직 추첨 전이면 null.
// "추첨 전(빈 목록)"과 "차단/구조 변경(JSON 아님)"을 구분해야 한다 — 뒤쪽을 끝으로
// 착각하면 무인 실행에서 조용히 갱신이 멈춘다.
async function fetchRound(round) {
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
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
            return {
                round: x.ltEpsd,
                date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
                numbers: [x.tm1WnNo, x.tm2WnNo, x.tm3WnNo, x.tm4WnNo, x.tm5WnNo, x.tm6WnNo].sort((a, b) => a - b),
                bonus: x.bnsWnNo,
                firstPrizeWinners: x.rnk1WnNope,
                firstPrizeAmount: x.rnk1WnAmt,
            };
        } catch (e) {
            lastErr = e;
            if (/JSON이 아닌|예상과 다른|요청했는데/.test(e.message)) break; // 재시도해도 같다
            await sleep(1000 * Math.pow(2, attempt - 1));
        }
    }
    throw new Error(`${round}회 조회 실패: ${lastErr.message}`);
}

function validate(data) {
    const errs = [];
    const draws = data.draws;
    draws.forEach((d, i) => {
        const expectRound = draws.length - i;
        if (d.round !== expectRound) errs.push(`${i}번째 항목 회차 ${d.round} (기대값 ${expectRound}) — 누락/중복/정렬 오류`);
        // 30일 통계가 추첨일로 기간을 자르므로 날짜가 빠진 회차가 있으면 안 된다
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

    const added = [];
    const changed = [];

    const refreshFrom = FULL ? 1 : Math.max(1, maxRound - REFRESH_RECENT + 1);
    console.log(`현재 ${maxRound}회차까지 보유. ${refreshFrom}~${maxRound}회 재확인 후 ${maxRound + 1}회부터 새로 받는다.`);

    for (let r = refreshFrom; r <= maxRound; r++) {
        const got = await fetchRound(r);
        if (!got) throw new Error(`${r}회는 이미 보유한 회차인데 API가 빈 목록을 돌려줬다`);
        const diffs = diffDraw(byRound.get(r), got);
        if (diffs.length) { changed.push({ round: r, diffs }); byRound.set(r, got); }
        if (FULL && r % 100 === 0) console.log(`  … ${r}회 확인`);
        await sleep(DELAY_MS);
    }

    for (let r = maxRound + 1; ; r++) {
        const got = await fetchRound(r);
        if (!got) break;
        byRound.set(r, got);
        added.push(r);
        console.log(`  + ${r}회 ${got.date} [${got.numbers.join(', ')}] +${got.bonus}`);
        await sleep(DELAY_MS);
    }

    const draws = [...byRound.values()].sort((a, b) => b.round - a.round);
    const next = { totalDraws: draws.length, lastUpdated: draws[0].date || data.lastUpdated, draws };

    const errs = validate(next);
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

    const isChanged = out !== raw;
    console.log(`\n추가 ${added.length}회차, 교정 ${changed.length}회차 → 최신 ${draws[0].round}회 (${next.lastUpdated})`);
    setOutput('changed', isChanged);
    setOutput('latest', draws[0].round);
    setOutput('added', added.length);

    if (!isChanged) { console.log('변경 없음.'); return; }
    if (DRY) { console.log('--dry-run: 파일은 쓰지 않았다.'); return; }
    fs.writeFileSync(FILE, out);
    console.log(`${path.basename(FILE)} 저장.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
