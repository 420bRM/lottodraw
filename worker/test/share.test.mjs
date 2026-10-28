// 판매점 공유 주소 /s/판매점번호 — 미리보기 제목 · 설명, 지도로 넘기기, 검색 제외
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { _resetShareCache } from '../src/share.js';

const SITE = 'https://www.lottodraw.kr';
const files = {
    'store-map-ids.json': { w: ['11100004', '11100016'], a: ['22200001'] },
    'store-map-data.json': { first: 262, last: 1247, sido: ['서울', '부산'], rows: [[37.66, 127.05, 52, 246, '스파', 0, '노원구', 0], [35.1, 129.0, 1, 3, '복<권>방', 1, '동구', 1]] },
    'store-map-all.json': { sido: ['서울'], rows: [[37.5, 127.0, '동네마트', 0, '종로구']] },
};
const realFetch = globalThis.fetch;
let fetched = 0;
globalThis.fetch = async (u, i) => {
    const f = String(u).startsWith(SITE + '/') && String(u).slice(SITE.length + 1);
    if (f && files[f]) { fetched++; return new Response(JSON.stringify(files[f])); }
    return realFetch(u, i);
};
test.after(() => { globalThis.fetch = realFetch; });

const get = (path, ua) => worker.fetch(new Request('https://api.lottodraw.kr' + path, { headers: ua ? { 'User-Agent': ua } : {} }), { SITE_URL: SITE }, { waitUntil() {} });

test('판매점 공유 주소: 이름 · 지역 · 횟수를 미리보기에, 사람은 지도 카드로, 검색 제외', async () => {
    _resetShareCache();
    const r = await get('/s/11100004', 'kakaotalk-scrap/1.0');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('X-Robots-Tag'), 'noindex');
    const html = await r.text();
    assert.match(html, /<meta property="og:title" content="스파 · 서울 노원구 로또 판매점">/);
    assert.match(html, /1등 52번 · 2등 246번\(262~1247회\)\. 어디서 사든 1등 확률은 1\/8,145,060으로 같습니다\./);
    assert.match(html, /location\.replace\("https:\/\/www\.lottodraw\.kr\/store-map\.html\?shop=11100004"\)/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    // 이름은 글자 그대로(HTML 로 해석하지 않는다)
    assert.match(await (await get('/s/11100016')).text(), /복&lt;권&gt;방 · 부산 동구/);
    // 일반 판매점
    assert.match(await (await get('/s/22200001')).text(), /동네마트 · 서울 종로구[\s\S]*262회부터 1등 · 2등 기록이 없는 판매점/);
    // 없는 번호 · 이상한 주소는 지도 첫 화면으로
    const none = await get('/s/99999999');
    assert.equal(none.status, 302);
    assert.equal(none.headers.get('Location'), SITE + '/store-map.html');
    assert.equal((await get('/s/1234')).status, 404);
    assert.ok(fetched <= 3, '자료는 한 번 받아 들고 있는다');
});
