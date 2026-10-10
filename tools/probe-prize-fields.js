// 임시 검사(다 보면 지운다): 동행복권 회차 응답에 2~5등 · 판매액 필드가 있는지, 옛 회차에도 들어 있는지 로그로 찍는다.
// 파일은 쓰지 않는다. .github/workflows/probe-prize-fields.yml 이 작업 브랜치 push 때 돌린다.
'use strict';
const https = require('https');
const API = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=';
const get = url => new Promise((resolve, reject) => {
    https.get(Object.assign(require('url').parse(url), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; lottodraw.kr data updater)', Accept: 'application/json' }, timeout: 15000 }), res => {
        let b = ''; res.setEncoding('utf8'); res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
});
(async () => {
    for (const r of [1, 2, 9, 87, 88, 91, 262, 600, 1019, 1057, 1150, 1243, 1244]) {
        try {
            const { status, body } = await get(API + r);
            const j = JSON.parse(body);
            const x = j && j.data && j.data.list && j.data.list[0];
            if (!x) { console.log(`${r}회: 목록 없음 (HTTP ${status}) ${body.slice(0, 200)}`); continue; }
            if (r === 1 || r === 1244) console.log(`${r}회 전체 응답: ${JSON.stringify(x)}`);
            else console.log(`${r}회: ` + Object.keys(x).filter(k => /rnk|Ntsl|Amt|Nope|Sum|Auto|Mnl|Semi/i.test(k)).map(k => `${k}=${x[k]}`).join(' '));
        } catch (e) { console.log(`${r}회 실패: ${e.message}`); }
        await new Promise(res => setTimeout(res, 400));
    }
})();
