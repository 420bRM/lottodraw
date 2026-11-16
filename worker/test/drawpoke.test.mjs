// 토요일 밤 추첨 깨우기(src/drawpoke.js, 2026-11-16)
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDrawCron, pokeDue, siteLatestDate, drawPoke, drawPokeSelfTest, DRAW_CRON } from '../src/drawpoke.js';

// 한국 시간 → epoch ms
const kst = s => Date.parse(s + '+09:00');
const SAT = '2026-11-21';   // 토요일
const site = 'https://www.lottodraw.kr';
const lotto = date => JSON.stringify({ updated: 'x', draws: [{ round: 1251, date, numbers: [1, 2, 3, 4, 5, 6], bonus: 7 }, { round: 1250, date: '2026-11-14', numbers: [1, 2, 3, 4, 5, 6], bonus: 7 }] }) + ' '.repeat(300000);

function fakeFetch(siteBody, ghStatus = 204) {
    const calls = [];
    const fn = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).startsWith(site)) return siteBody === null ? new Response('no', { status: 404 }) : new Response(siteBody, { status: 200 });
        if (String(url).startsWith('https://api.github.com/')) return new Response(null, { status: ghStatus });
        throw new Error('unexpected ' + url);
    };
    fn.calls = calls;
    return fn;
}
const memoryKV = () => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, m }; };

test('예약 문자열: 둘째 예약만 깨우기로 알아본다(요일 숫자 7 · 대소문자도)', () => {
    assert.ok(isDrawCron(DRAW_CRON));
    assert.ok(isDrawCron('*/10 11-14 * * sat'));
    assert.ok(isDrawCron('*/10  11-14 * * 7'));
    assert.ok(!isDrawCron('17 * * * *'));
    assert.ok(!isDrawCron(undefined));
});

test('부를 때: 한국 토요일 20:40 뒤 · 사이트에 오늘 회차가 없을 때만', () => {
    assert.equal(pokeDue(kst(`${SAT}T20:39:00`), null), false, '20:40 전');
    assert.equal(pokeDue(kst(`${SAT}T20:40:00`), null), true);
    assert.equal(pokeDue(kst(`${SAT}T23:50:00`), '2026-11-14'), true, '지난주 회차뿐');
    assert.equal(pokeDue(kst(`${SAT}T21:10:00`), SAT), false, '오늘 회차가 이미 올라감');
    assert.equal(pokeDue(kst('2026-11-20T21:00:00'), null), false, '금요일');
    assert.equal(pokeDue(kst('2026-11-22T00:05:00'), null), false, '일요일 새벽');
});

test('사이트 lotto-data.json 맨 앞 회차 날짜 — 큰 파일도 앞부분만 읽는다', async () => {
    assert.equal(await siteLatestDate(site, fakeFetch(lotto(SAT))), SAT);
    assert.equal(await siteLatestDate(site, fakeFetch(null)), null);
    assert.equal(await siteLatestDate(site, fakeFetch('{"draws":[]}')), null);
});

test('토요일 밤: 사이트에 오늘 회차가 없으면 draw-night 를 mode=once 로 부르고, 있으면 부르지 않는다', async () => {
    const env = { GH_DISPATCH_TOKEN: 'github_pat_x' };
    let f = fakeFetch(lotto('2026-11-14'));
    let r = await drawPoke(env, kst(`${SAT}T20:50:00`), { site, fetchFn: f });
    assert.deepEqual(r, { poked: true, date: '2026-11-14' });
    const gh = f.calls.find(c => c.url.startsWith('https://api.github.com/'));
    assert.equal(gh.url, 'https://api.github.com/repos/420bRM/lottodraw/actions/workflows/draw-night.yml/dispatches');
    assert.equal(gh.init.method, 'POST');
    assert.equal(gh.init.headers.Authorization, 'Bearer github_pat_x');
    assert.ok(gh.init.headers['User-Agent'], 'GitHub API 는 User-Agent 가 있어야 한다');
    assert.deepEqual(JSON.parse(gh.init.body), { ref: 'html', inputs: { mode: 'once' } });

    f = fakeFetch(lotto(SAT));
    r = await drawPoke(env, kst(`${SAT}T21:30:00`), { site, fetchFn: f });
    assert.equal(r.why, 'have');
    assert.ok(!f.calls.some(c => c.url.startsWith('https://api.github.com/')), '오늘 회차가 있으면 GitHub 를 부르지 않는다');

    f = fakeFetch(lotto('2026-11-14'));
    r = await drawPoke(env, kst(`${SAT}T20:30:00`), { site, fetchFn: f });
    assert.equal(r.why, 'time');
    assert.equal(f.calls.length, 0, '20:40 전에는 사이트도 읽지 않는다');

    r = await drawPoke({}, kst(`${SAT}T21:00:00`), { site, fetchFn: fakeFetch(lotto('2026-11-14')) });
    assert.equal(r.why, 'no_token');

    // 사이트를 못 읽으면(404) 그냥 부른다 — draw-night 가 저장소 기준으로 다시 본다
    r = await drawPoke(env, kst(`${SAT}T21:00:00`), { site, fetchFn: fakeFetch(null) });
    assert.equal(r.poked, true);
});

test('부르기 실패: 그날 첫 번째(20:40~20:49)에만 알린다', async () => {
    const env = { GH_DISPATCH_TOKEN: 'expired' };
    const sent = [];
    const notify = async m => { sent.push(m); };
    let r = await drawPoke(env, kst(`${SAT}T20:41:00`), { site, notify, fetchFn: fakeFetch(lotto('2026-11-14'), 401) });
    assert.equal(r.why, 'github_401');
    r = await drawPoke(env, kst(`${SAT}T21:01:00`), { site, notify, fetchFn: fakeFetch(lotto('2026-11-14'), 401) });
    assert.equal(r.why, 'github_401');
    assert.equal(sent.length, 1);
    assert.match(sent[0], /GitHub 401/);
});

test('토큰 시험: 토큰마다 한 번만 draw-night 를 mode=check 로 부르고 결과를 알린다', async () => {
    const DB = memoryKV();
    const sent = [];
    const notify = async m => { sent.push(m); };
    assert.equal(await drawPokeSelfTest({ DB }, { notify, fetchFn: fakeFetch('') }), null, '토큰이 없으면 아무것도 안 한다');

    let f = fakeFetch('', 204);
    let r = await drawPokeSelfTest({ DB, GH_DISPATCH_TOKEN: 'tok-a' }, { notify, fetchFn: f });
    assert.deepEqual(r, { ok: true, status: 204 });
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { ref: 'html', inputs: { mode: 'check' } });
    assert.equal(await drawPokeSelfTest({ DB, GH_DISPATCH_TOKEN: 'tok-a' }, { notify, fetchFn: fakeFetch('', 204) }), null, '같은 토큰은 다시 시험하지 않는다');

    r = await drawPokeSelfTest({ DB, GH_DISPATCH_TOKEN: 'tok-b' }, { notify, fetchFn: fakeFetch('', 403) });
    assert.deepEqual(r, { ok: false, status: 403 });
    assert.equal(sent.length, 2);
    assert.match(sent[0], /준비 완료/);
    assert.match(sent[1], /실패: GitHub 403/);
    assert.ok(![...DB.m.keys()].some(k => k.includes('tok')), 'KV 키에 토큰을 그대로 적지 않는다');
});
