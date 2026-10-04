#!/usr/bin/env node
// 바뀐 페이지를 네이버·Bing 에 바로 알린다 (IndexNow). 검색 로봇이 언젠가 찾아오기를 기다리지 않는다.
// 구글은 IndexNow 를 받지 않는다 — 구글은 지금처럼 sitemap.xml 로 간다.
//
//   node tools/indexnow.js <바뀐 파일…>   예: round/1245.html index.html (워크플로가 git diff 로 넘긴다)
//   node tools/indexnow.js --latest       최신 회차 기준으로 매주 바뀌는 페이지 전부 (수동 실행용)
//
// 보내기 전에 사이트에 실제로 반영됐는지(배포가 끝났는지) 확인한다. 반영 전에 알리면 로봇이
// 옛 페이지나 404 를 가져간다. 15분이 지나도 반영이 안 보이면 그냥 보낸다.
// 실패해도 종료 코드는 0 이다. 당첨번호 반영은 이미 끝났고, 다음 갱신 때 다시 알린다.
//
// 열쇠: 사이트 뿌리의 <KEY>.txt (내용도 KEY). 검색엔진이 이 파일로 우리 사이트가 보낸 요청인지
// 확인한다. 공개돼도 되는 값이지만 파일을 지우거나 바꾸면 요청이 거절된다.
'use strict';
const fs = require('fs');
const path = require('path');

const KEY = 'df151d56acb974ec33c521ed980fa1f2';
const HOST = 'www.lottodraw.kr';
const SITE = `https://${HOST}`;
const ENDPOINTS = [
    ['네이버', 'https://searchadvisor.naver.com/indexnow'],
    ['Bing', 'https://www.bing.com/indexnow'],
];
// 블로그는 매주 머리글의 최신 회차만 바뀌어서 알리지 않는다. admin 은 검색 제외 페이지다.
const SKIP = /^(blog\/|admin\.html$|naver[0-9a-f]+\.html$)/;
const LIVE_WAIT_MS = 15 * 60 * 1000;
const LIVE_POLL_MS = 15 * 1000;
const MEANING = {
    200: '접수',
    202: '접수 (열쇠 확인 대기 — 처음 보낼 때 정상)',
    400: '요청 형식 오류',
    403: '열쇠 확인 실패 — 열쇠 파일이 사이트에 떠 있는지 확인',
    422: '주소가 이 사이트 것이 아니거나 열쇠가 다르다',
    429: '너무 자주 보냄',
};

const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const urlOf = f => (f === 'index.html' ? `${SITE}/` : `${SITE}/${f}`);
const warn = msg => console.log(`::warning::IndexNow: ${msg}`);

// --latest: 매주 갱신 때 같이 바뀌는 페이지 (tools/build-static-stats.js 가 만드는 것 중 블로그 빼고)
function latestFiles() {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'lotto-data.json'), 'utf8'));
    const n = data.draws.reduce((m, d) => Math.max(m, d.round), 0);
    const stats = fs.readdirSync(ROOT).filter(f => /^statistics-.+\.html$/.test(f)).sort();
    return ['index.html', 'draws.html', `round/${n}.html`, `round/${n - 1}.html`, ...stats,
        'probability.html', 'tax.html', 'top-prize.html'];
}

// 사이트에 뜬 내용이 저장소 파일과 같아질 때까지 기다린다 (GitHub Pages 는 HTML 을 그대로 올린다)
async function waitLive(file) {
    const want = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const until = Date.now() + LIVE_WAIT_MS;
    let last = '';
    while (Date.now() < until) {
        try {
            const res = await fetch(urlOf(file), { signal: AbortSignal.timeout(20000) });
            const body = await res.text();
            if (res.status === 200 && body === want) return true;
            last = `HTTP ${res.status}${res.status === 200 ? ', 아직 옛 내용' : ''}`;
        } catch (e) {
            last = e.message;
        }
        await sleep(LIVE_POLL_MS);
    }
    warn(`${urlOf(file)} 반영을 15분 안에 확인하지 못했다(${last}). 그대로 보낸다.`);
    return false;
}

async function main() {
    const args = process.argv.slice(2);
    const files = [...new Set(args.includes('--latest') ? latestFiles() : args)]
        .filter(f => /\.html$/.test(f) && !SKIP.test(f) && fs.existsSync(path.join(ROOT, f)));
    if (!files.length) { console.log('알릴 페이지가 없다.'); return; }

    const keyFile = path.join(ROOT, `${KEY}.txt`);
    if (!fs.existsSync(keyFile) || fs.readFileSync(keyFile, 'utf8').trim() !== KEY) {
        warn(`열쇠 파일 ${KEY}.txt 이 없거나 내용이 다르다. 보내지 않는다.`);
        return;
    }

    // 새 회차 페이지가 있으면 그것으로, 없으면 첫 페이지로 반영 여부를 본다
    const rounds = files.filter(f => /^round\/\d+\.html$/.test(f));
    const probe = rounds.length ? rounds.sort((a, b) => parseInt(b.slice(6)) - parseInt(a.slice(6)))[0] : files[0];
    console.log(`${files.length}쪽을 알린다. 먼저 ${urlOf(probe)} 이 사이트에 반영됐는지 본다.`);
    if (await waitLive(probe)) console.log('반영 확인.');

    const urlList = files.map(urlOf);
    const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList });
    for (const [name, endpoint] of ENDPOINTS) {
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body,
                signal: AbortSignal.timeout(30000),
            });
            const msg = `${name}: HTTP ${res.status} ${MEANING[res.status] || ''}`.trim();
            if (res.status === 200 || res.status === 202) console.log(msg);
            else warn(`${msg} ${(await res.text()).slice(0, 200)}`);
        } catch (e) {
            warn(`${name}: 보내지 못했다 — ${e.message}`);
        }
    }
    urlList.forEach(u => console.log(`  ${u}`));
}

main().catch(e => { warn(e.message); });
