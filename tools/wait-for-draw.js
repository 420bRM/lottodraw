#!/usr/bin/env node
// 토요일 추첨(20:35 KST) 결과가 동행복권에 올라올 때까지 기다린다. 파일은 쓰지 않는다.
// .github/workflows/draw-night.yml 이 부르고, 결과를 보고 update-lotto-data 를 바로 실행한다.
//
//   node tools/wait-for-draw.js [--budget=분]    이번 실행이 기다려도 되는 시간 (기본 330분)
//
// 결과 (GITHUB_OUTPUT)
//   ready=true     수집할 때다 → 워크플로가 update-lotto-data 를 실행한다
//                  · 오늘 회차의 1등 당첨자 수까지 나왔다
//                  · 토요일(한국 시간)이 아니거나 오늘 회차를 이미 갖고 있다 → 기다리지 않고 평소 갱신
//   handoff=true   --budget 이 끝났다 → 워크플로가 자기 자신을 다시 실행해 이어서 기다린다
//   둘 다 false    토요일 자정까지 안 나왔다 → 그만둔다. 일요일 새벽 정기 갱신이 받는다
//
// 왜 1등 당첨자 수까지 기다리나: 추첨 직후에는 API 가 1등 0명/0원을 돌려줄 때가 있다(1228회).
// 그대로 올리면 회차 페이지에 "1등 당첨자가 없어 이월"이라고 잘못 나간다. 정말 이월된 회차면
// 자정까지 기다리다 그만두고, 일요일 정기 갱신이 그대로 올린다.
//
// 왜 낮부터 시작해서 기다리나: GitHub 예약 실행은 2시간 반~5시간씩 늦게 시작한다(2026-09 기록).
// 추첨 시각에 맞춰 예약하면 밤 11시~새벽에야 돈다.
'use strict';
const fs = require('fs');
const path = require('path');
const { fetchRound } = require('./update-lotto-data.js');

const FILE = path.join(__dirname, '..', 'lotto-data.json');
const KST = 9 * 3600 * 1000;
const OPEN = '20:40';           // 이 시각(KST) 전에는 조회하지 않고 잔다
const POLL_MS = 60 * 1000;

const budgetArg = process.argv.find(a => a.startsWith('--budget='));
const BUDGET_MIN = budgetArg ? Number(budgetArg.split('=')[1]) : 330;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const kstDate = t => new Date(t + KST).toISOString().slice(0, 10);
const clock = t => new Date(t + KST).toISOString().slice(11, 16);

function setOutput(key, value) {
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function done(ready, handoff, msg) {
    console.log(msg);
    setOutput('ready', ready);
    setOutput('handoff', handoff);
}

async function main() {
    if (!(BUDGET_MIN > 0)) throw new Error(`--budget 값이 이상하다: ${budgetArg}`);
    const start = Date.now();
    const end = start + BUDGET_MIN * 60 * 1000;
    const today = kstDate(start);
    const latest = JSON.parse(fs.readFileSync(FILE, 'utf8')).draws.reduce((a, d) => (d.round > a.round ? d : a));

    if (new Date(start + KST).getUTCDay() !== 6)
        return done(true, false, `오늘(${today})은 토요일이 아니다 — 기다리지 않고 평소처럼 갱신한다.`);
    if (latest.date >= today)
        return done(true, false, `${latest.round}회(${latest.date})를 이미 갖고 있다 — 기다리지 않고 평소처럼 갱신한다.`);

    const target = latest.round + 1;
    const open = Date.parse(`${today}T${OPEN}:00+09:00`);
    const midnight = Date.parse(`${today}T00:00:00+09:00`) + 24 * 3600 * 1000;
    console.log(`${target}회를 기다린다. ${OPEN}부터 1분마다 조회, 이 실행은 ${clock(end)}까지, 자정이 지나면 그만둔다.`);

    let last = '';
    const note = (t, state, msg) => { if (state !== last) console.log(`  ${clock(t)} ${msg}`); last = state; };

    for (;;) {
        const now = Date.now();
        if (now >= midnight)
            return done(false, false, `자정까지 ${target}회 1등 정보가 나오지 않았다 — 일요일 정기 갱신에 맡긴다.`);
        if (now >= end)
            return done(false, true, `${clock(now)} 이 실행의 시간이 끝났다 — 다음 실행이 이어서 기다린다.`);
        if (now < open) {
            note(now, 'sleep', `${OPEN}까지 잔다.`);
            await sleep(Math.min(open, end) - now);
            continue;
        }

        let got = null;
        try {
            got = await fetchRound(target);
            if (!got) note(now, 'none', '아직 안 나왔다.');
        } catch (e) {
            // 추첨 직후에는 접속이 몰려 대기열 페이지가 오기도 한다. 계속 기다린다
            note(now, 'error', `조회 실패, 계속 기다린다: ${e.message}`);
        }
        if (got && got.firstPrizeWinners > 0)
            return done(true, false, `${clock(Date.now())} ${target}회 확인: [${got.numbers.join(', ')}] +${got.bonus}, 1등 ${got.firstPrizeWinners}명 — 수집을 시작한다.`);
        if (got) note(now, 'pending', '번호는 나왔다. 1등 당첨자 수 집계를 기다린다.');

        await sleep(Math.max(0, Math.min(POLL_MS, end - Date.now())));
    }
}

main().catch(e => { console.error(e.message); process.exit(1); });
