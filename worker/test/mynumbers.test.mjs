// 내 번호 저장 · 등수 확인 · 추첨 결과 메일. 구글 서버 · Resend 대신 가짜를 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { _resetForTests, _resultMailForTests as resultMail, Community } from '../src/index.js';
import { _resetGoogleForTests } from '../src/google.js';
import { b64urlEncode } from '../src/keys.js';
import { saleRound, rankOf, cleanGame, sat } from '../src/lotto.js';
import { MYNUM } from '../src/community.js';

const ADMIN = 'admin-token-0123456789abcdef';
const ORIGIN = 'https://www.lottodraw.kr';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const KST = 9 * 3600e3;
const kstTime = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi || 0) - KST;

function memoryKV() {
    const m = new Map();
    return {
        _m: m,
        async get(k, type) { const e = m.get(k); if (!e) return null; return type === 'json' ? JSON.parse(e.value) : e.value; },
        async put(k, value, opts) { m.set(k, { value: String(value), metadata: opts && opts.metadata }); },
        async delete(k) { m.delete(k); },
        async list({ prefix }) {
            return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).sort().map(name => ({ name, metadata: m.get(name).metadata })), list_complete: true };
        },
    };
}

// Durable Object 흉내: 저장소는 Map, 요청은 클래스의 fetch 로 바로 넘긴다.
// _reads: 읽은 줄 수와 list 한 접두어(실서버 요금의 "읽은 행"), restart(): 메모리를 비우고 다시 뜬 것처럼
function memoryDO() {
    const map = new Map();
    const reads = { rows: 0, lists: [] };
    const clone = v => (v === undefined ? undefined : structuredClone(v));
    const storage = {
        async get(k) {
            if (Array.isArray(k)) { reads.rows += k.length; const out = new Map(); k.forEach(x => { if (map.has(x)) out.set(x, clone(map.get(x))); }); return out; }
            reads.rows += 1;
            return clone(map.get(k));
        },
        async put(k, v) { map.set(k, clone(v)); },
        async delete(k) {
            if (Array.isArray(k)) { let n = 0; k.forEach(x => { if (map.delete(x)) n++; }); return n; }
            return map.delete(k);
        },
        async list({ prefix, startAfter, limit, reverse } = {}) {
            let keys = [...map.keys()].filter(k => k.startsWith(prefix || '') && (startAfter === undefined || k > startAfter)).sort();
            if (reverse) keys.reverse();
            if (limit) keys = keys.slice(0, limit);
            reads.rows += keys.length;
            reads.lists.push(prefix || '');
            const out = new Map();
            keys.forEach(k => out.set(k, clone(map.get(k))));
            return out;
        },
    };
    let inst = new Community({ storage });
    return {
        _m: map, _reads: reads, restart() { inst = new Community({ storage }); },
        idFromName: n => n, get: () => ({ fetch: (url, init) => inst.fetch(new Request(url, init)) }),
    };
}

// 아래 시험들은 가입 체험을 켠 서버(SIGNUP_TRIAL_DAYS 3)로 돈다. 실서버 기본은 꺼짐(2026-10-11~) — '가입 체험 끔' 시험이 따로 본다
function makeEnv(extra) {
    return Object.assign({
        DB: memoryKV(), COMMUNITY: memoryDO(), GOOGLE_CLIENT_ID: CLIENT_ID, SIGNUP_TRIAL_DAYS: '3',
        SITE_URL: 'https://www.lottodraw.kr', ALLOWED_ORIGINS: 'https://www.lottodraw.kr,https://lottodraw.kr', ADMIN_TOKEN: ADMIN,
    }, extra || {});
}

const ctx = { waitUntil() {} };
async function call(env, method, path, { body, headers } = {}) {
    const h = Object.assign({ Origin: ORIGIN }, headers || {});
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await worker.fetch(new Request('https://api.lottodraw.kr' + path, { method, headers: h, body: payload }), env, ctx);
    return { status: res.status, data: await res.json(), headers: res.headers };
}
const asAdmin = { Authorization: 'Bearer ' + ADMIN };
const auth = s => ({ Authorization: 'Bearer ' + s });

/* ───── 가짜 구글 ───── */
const enc = o => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
async function rsaKey(kid) {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return { kid, privateKey: pair.privateKey, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}
const GOOD = await rsaKey('kid-1');
const EVIL = await rsaKey('kid-1');   // 같은 kid, 다른 키 — 위조

async function idToken(claims, key = GOOD) {
    const now = Math.floor(Date.now() / 1000);
    const head = enc({ alg: 'RS256', kid: key.kid, typ: 'JWT' });
    const body = enc(Object.assign({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1001', email: 'Buyer@Gmail.com', email_verified: true, iat: now, exp: now + 3600 }, claims));
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(head + '.' + body)));
    return head + '.' + body + '.' + b64urlEncode(sig);
}


const realFetch = globalThis.fetch;
let resend = [];          // Resend 로 간 묶음들
let resendFail = 0;       // 이만큼 실패로 답한다
let drawHead = null;      // 가짜 lotto-data.json 앞부분
function fakeInternet() {
    resend = []; resendFail = 0;
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u === CERTS_URL) return new Response(JSON.stringify({ keys: [GOOD.jwk] }), { headers: { 'Cache-Control': 'public, max-age=20000' } });
        if (u === 'https://api.resend.com/emails/batch') {
            if (resendFail > 0) { resendFail--; return new Response(JSON.stringify({ message: 'daily quota' }), { status: 429 }); }
            resend.push({ body: JSON.parse(init.body), headers: init.headers });
            return new Response('{"data":[]}');
        }
        if (u === 'https://www.lottodraw.kr/lotto-data.json') return drawHead ? new Response(drawHead, { status: 206 }) : new Response('', { status: 404 });
        if (u.startsWith('https://api.telegram.org/') || u === 'https://api.resend.com/emails') return new Response('{}');
        throw new Error('바깥 요청: ' + u);
    };
}
async function fresh(extra) {
    _resetForTests();
    _resetGoogleForTests();
    fakeInternet();
    const env = makeEnv(Object.assign({ SIGNUP_TRIAL_DAYS: undefined, RESEND_API_KEY: 're_test', MAIL_FROM: 'lottodraw.kr <key@lottodraw.kr>' }, extra || {}));
    await call(env, 'POST', '/api/admin/setup-key', { headers: asAdmin });
    return env;
}
const login = async (env, claims) => (await call(env, 'POST', '/api/auth/google', { body: { credential: await idToken(claims) } })).data.session;
test.after(() => { globalThis.fetch = realFetch; });

/* ───── 규칙 ───── */

test('회차: 토요일 20시 판매 마감 전은 그 회차, 뒤는 다음 회차 (1245회 = 2026-10-10)', () => {
    assert.equal(saleRound(kstTime(2026, 10, 10, 19, 59)), 1245);
    assert.equal(saleRound(kstTime(2026, 10, 10, 20, 0)), 1246);
    assert.equal(saleRound(kstTime(2026, 10, 11, 6, 0)), 1246);
    assert.equal(saleRound(kstTime(2026, 10, 16, 9, 17)), 1246, '금요일');
    assert.equal(saleRound(kstTime(2002, 12, 7, 12, 0)), 1);
    assert.equal(new Date(sat(1245) + KST).toISOString().slice(0, 10), '2026-10-10');
    // lotto-data.json 의 모든 회차 날짜와 맞는다
    const data = JSON.parse(fs.readFileSync(new URL('../../lotto-data.json', import.meta.url)));
    for (const d of data.draws) assert.equal(new Date(sat(d.round) + KST).toISOString().slice(0, 10), d.date, d.round + '회');
});

test('등수: 6개 1등 · 5개+보너스 2등 · 5개 3등 · 4개 4등 · 3개 5등', () => {
    const draw = { numbers: [4, 5, 25, 28, 32, 42], bonus: 12 };
    assert.deepEqual(rankOf([4, 5, 25, 28, 32, 42], draw).rank, 1);
    assert.deepEqual(rankOf([4, 5, 25, 28, 32, 12], draw), { rank: 2, match: 5, bonus: true, hit: [4, 5, 25, 28, 32] });
    assert.equal(rankOf([4, 5, 25, 28, 32, 1], draw).rank, 3);
    assert.equal(rankOf([4, 5, 25, 28, 12, 1], draw).rank, 4, '4개 + 보너스도 4등');
    assert.equal(rankOf([4, 5, 25, 1, 2, 3], draw).rank, 5);
    assert.equal(rankOf([4, 5, 12, 1, 2, 3], draw).rank, 0, '2개 + 보너스는 낙첨');
    assert.deepEqual(cleanGame([6, 5, 4, 3, 2, 1]), [1, 2, 3, 4, 5, 6]);
    for (const bad of [[1, 2, 3, 4, 5], [1, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 46], [1, 2, 3, 4, 5, 6.5], 'x', null]) assert.equal(cleanGame(bad), null, JSON.stringify(bad));
});

/* ───── 내 번호 API ───── */

test('내 번호: 저장 · 같은 조합 건너뜀 · 잘못된 번호 · 회차 범위 · 지우기', async () => {
    const env = await fresh();
    const s = await login(env);
    const top = saleRound(Date.now());
    assert.equal((await call(env, 'GET', '/api/me/numbers')).status, 401, '로그인 필요');
    let r = await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top, games: [[45, 1, 2, 3, 4, 5], [7, 8, 9, 10, 11, 12]], src: 'g' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.added, 2);
    assert.deepEqual(r.data.games[0].n, [1, 2, 3, 4, 5, 45], '오름차순으로 다듬는다');
    assert.equal(r.data.games[0].s, 'g');
    r = await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top, games: [[1, 2, 3, 4, 5, 45]] } });
    assert.equal(r.data.added, 0);
    assert.equal(r.data.dup, 1, '같은 회차 같은 조합은 한 번만');
    r = await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top - 1, games: [[1, 2, 3, 4, 5, 45]] } });
    assert.equal(r.data.added, 1, '다른 회차면 저장');
    assert.equal((await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top + 1, games: [[1, 2, 3, 4, 5, 6]] } })).data.error, 'bad_round', '아직 팔지 않는 회차');
    assert.equal((await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: 0, games: [[1, 2, 3, 4, 5, 6]] } })).data.error, 'bad_round');
    const cur = await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { games: [[11, 12, 13, 14, 15, 16]], src: 'g' } });
    assert.equal(cur.data.added, 1, '회차를 빼면 지금 판매 중인 회차');
    assert.equal(cur.data.games.find(g => g.n[0] === 11).r, top);
    await call(env, 'POST', '/api/me/numbers/delete', { headers: auth(s), body: { id: cur.data.games.find(g => g.n[0] === 11).id } });
    const bad = await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top, games: [[1, 2, 3, 4, 5, 6], [1, 1, 2, 3, 4, 5]] } });
    assert.equal(bad.data.error, 'bad_games');
    assert.match(bad.data.message, /2번째/);
    const got = await call(env, 'GET', '/api/me/numbers', { headers: auth(s) });
    assert.equal(got.data.games.length, 3);
    assert.equal(got.data.saleRound, top);
    assert.equal(got.data.mail, false);
    assert.deepEqual(got.data.games.map(g => g.r), [top, top, top - 1], '최근 회차가 앞');
    // 한 게임 지우기, 한 회차 지우기
    r = await call(env, 'POST', '/api/me/numbers/delete', { headers: auth(s), body: { id: got.data.games[0].id } });
    assert.equal(r.data.removed, 1);
    r = await call(env, 'POST', '/api/me/numbers/delete', { headers: auth(s), body: { round: top - 1 } });
    assert.equal(r.data.removed, 1);
    assert.equal(r.data.games.length, 1);
    // 다른 회원에게는 안 보인다
    const other = await login(env, { sub: '3003', email: 'other@gmail.com' });
    assert.equal((await call(env, 'GET', '/api/me/numbers', { headers: auth(other) })).data.games.length, 0);
});

test('내 번호 한도: 한 회차 20게임, 오래된 회차부터 지워 최근 104회차 · 600게임까지', async () => {
    const env = await fresh();
    const s = await login(env);
    const top = saleRound(Date.now());
    const games = n => Array.from({ length: n }, (_, i) => [1, 2, 3, 4, 5, 6 + i]);
    let r = await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top, games: games(20) } });
    assert.equal(r.data.added, 20);
    r = await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top, games: [[10, 11, 12, 13, 14, 15]] } });
    assert.equal(r.data.full, 1, '21번째는 넣지 않는다');
    assert.equal((await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top, games: games(21) } })).data.error, 'bad_games', '한 번에 21게임은 거절');
    for (let k = 1; k <= MYNUM.rounds + 5; k++) await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: top - k, games: [[1, 2, 3, 4, 5, 6]] } });
    const got = (await call(env, 'GET', '/api/me/numbers', { headers: auth(s) })).data.games;
    const rounds = new Set(got.map(g => g.r));
    assert.equal(rounds.size, MYNUM.rounds);
    assert.ok(rounds.has(top) && !rounds.has(top - MYNUM.rounds), '가장 오래된 회차가 빠진다');
    assert.ok(got.length <= MYNUM.total);
});

test('탈퇴하면 내 번호와 메일 구독도 지운다', async () => {
    const env = await fresh();
    const s = await login(env);
    await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: saleRound(Date.now()), games: [[1, 2, 3, 4, 5, 6]] } });
    assert.equal((await call(env, 'POST', '/api/me/mail', { headers: auth(s), body: { on: true } })).data.mail, true);
    assert.ok(env.COMMUNITY._m.has('k:1001') && env.COMMUNITY._m.has('ms:1001'));
    assert.equal((await call(env, 'GET', '/api/admin/status', { headers: asAdmin })).data.weekly.subs, 1);
    assert.equal((await call(env, 'POST', '/api/me/delete', { headers: auth(s), body: { confirm: true } })).status, 200);
    assert.ok(!env.COMMUNITY._m.has('k:1001') && !env.COMMUNITY._m.has('ms:1001'), '남은 줄: ' + [...env.COMMUNITY._m.keys()].join(','));
    assert.equal((await call(env, 'GET', '/api/admin/status', { headers: asAdmin })).data.weekly.subs, 0);
});

/* ───── 추첨 결과 메일 ───── */

const R = 1246;                               // 2026-10-17(토) 추첨
const SUN = kstTime(2026, 10, 18, 9, 17);     // 그 다음 일요일 09:17
const MON = kstTime(2026, 10, 19, 9, 17);
const WIN = [4, 5, 25, 28, 32, 42], BONUS = 12;
// 가짜 lotto-data.json 앞부분(최신 회차가 맨 앞)
const head = (round, nums, bonus) => `{\n  "totalDraws": ${round},\n  "lastUpdated": "x",\n  "draws": [\n    {\n      "round": ${round},\n      "date": "x",\n      "numbers": [\n        ${nums.join(',\n        ')}\n      ],\n      "bonus": ${bonus},`;
// 구독자 n 명. games 가 있으면 R 회 번호로 저장한다(내 번호)
async function subscribers(env, n, games) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const s = await login(env, { sub: String(5000 + i), email: `m${i}@gmail.com` });
        assert.equal((await call(env, 'POST', '/api/me/mail', { headers: auth(s), body: { on: true } })).data.mail, true);
        if (games) assert.equal((await call(env, 'POST', '/api/me/numbers', { headers: auth(s), body: { round: R, games } })).status, 200);
        out.push(s);
    }
    return out;
}
const sentTo = () => resend.flatMap(b => b.body.map(m => m.to[0])).sort();

test('결과 메일: 일 · 월요일 09~21시에만 보낸다(토요일 추첨 직후 · 밤 · 다른 요일은 쉰다)', async () => {
    const env = await fresh();
    drawHead = head(R, WIN, BONUS);
    await subscribers(env, 1, [[1, 2, 3, 4, 5, 6]]);
    for (const t of [kstTime(2026, 10, 17, 21, 17), kstTime(2026, 10, 18, 8, 59), kstTime(2026, 10, 18, 21, 17), kstTime(2026, 10, 19, 3, 17), kstTime(2026, 10, 19, 21, 0), kstTime(2026, 10, 20, 12, 0), kstTime(2026, 10, 23, 9, 17)]) {
        assert.equal((await resultMail(env, t)).skipped, 'window', new Date(t + KST).toISOString());
    }
    assert.equal(resend.length, 0);
    assert.equal((await resultMail(await fresh({ RESEND_API_KEY: '' }), SUN)).skipped, 'window', '메일 설정이 없으면 하지 않는다');
    drawHead = null;
});

test('결과 메일: 사이트에 그 회차 당첨번호가 올라오기 전에는 기다린다', async () => {
    const env = await fresh();
    await subscribers(env, 1, [[1, 2, 3, 4, 5, 6]]);
    drawHead = null;
    assert.equal((await resultMail(env, SUN)).skipped, 'no_draw', '파일을 못 읽음');
    drawHead = head(R - 1, WIN, BONUS);
    assert.equal((await resultMail(env, SUN + 3600e3)).skipped, 'no_draw', '아직 지난 회차가 최신');
    assert.equal(resend.length, 0);
    drawHead = head(R, WIN, BONUS);
    assert.deepEqual(await resultMail(env, SUN + 2 * 3600e3), { sent: 1, done: true });
    drawHead = null;
});

test('결과 메일: 당첨번호 · 저장한 번호의 등수와 맞은 번호 · 회차 페이지 링크, 그 회차 번호가 없는 구독자는 건너뛴다', async () => {
    const env = await fresh({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
    drawHead = head(R, WIN, BONUS);
    const games = [[4, 5, 25, 28, 32, 12], [4, 5, 25, 1, 2, 3], [6, 7, 8, 9, 10, 11]];   // 2등 · 5등 · 낙첨
    await subscribers(env, 2, games);
    // 그 회차 번호가 없는 구독자 · 지난 회차 번호만 있는 구독자
    const s3 = await login(env, { sub: '6000', email: 'none@gmail.com' });
    await call(env, 'POST', '/api/me/mail', { headers: auth(s3), body: { on: true } });
    const s4 = await login(env, { sub: '6001', email: 'old@gmail.com' });
    await call(env, 'POST', '/api/me/mail', { headers: auth(s4), body: { on: true } });
    await call(env, 'POST', '/api/me/numbers', { headers: auth(s4), body: { round: R - 1, games: [games[0]] } });
    // 예전 생성 번호 메일(같은 회차)이 남긴 기록은 막지 않고 치운다
    env.COMMUNITY._m.set('mw:' + R, { cursor: 'ms:9999', sent: 1, tries: 0, done: true });
    const kvBefore = JSON.stringify([...env.DB._m.entries()]);
    const r = await resultMail(env, SUN);
    assert.deepEqual(r, { sent: 2, done: true });
    assert.deepEqual(sentTo(), ['m0@gmail.com', 'm1@gmail.com'], '그 회차 번호를 저장한 구독자에게만');
    assert.equal(resend.length, 1, '한 묶음(batch)으로');
    for (const m of resend[0].body) {
        assert.equal(m.subject, `[lottodraw.kr] ${R}회 당첨번호와 내 번호 결과`);
        assert.match(m.text, /^10월 17일\(토\) 1246회 추첨 결과입니다\./);
        assert.match(m.text, /당첨번호: 4 · 5 · 25 · 28 · 32 · 42 \+ 보너스 12/);
        assert.match(m.text, /내 번호에 저장한 1246회 번호 3게임 중 2게임 당첨 — 2등 1게임 · 5등 1게임/);
        assert.match(m.text, /1\) {2}4 · 5 · 12 · 25 · 28 · 32 {2}→ {2}2등 \(맞은 번호 4 · 5 · 25 · 28 · 32 \+ 보너스 12\)/);
        assert.match(m.text, /2\) {2}1 · 2 · 3 · 4 · 5 · 25 {2}→ {2}5등 \(맞은 번호 4 · 5 · 25\)/);
        assert.match(m.text, /3\) {2}6 · 7 · 8 · 9 · 10 · 11 {2}→ {2}낙첨 \(맞은 번호 없음\)/);
        assert.match(m.text, /https:\/\/www\.lottodraw\.kr\/round\/1246\.html/);
        assert.match(m.text, /https:\/\/www\.lottodraw\.kr\/mypage\.html/);
        assert.match(m.text, /복권 실물과 동행복권에서 한 번 더 확인/);
        assert.doesNotMatch(m.text, /^[A-E] {3}/m, '생성 번호는 보내지 않는다');
        assert.doesNotMatch(m.subject + m.text, /추천|예측|적중|확률 상승|확률을 높|생성 번호/);
        const url = m.text.match(/수신 거부: (\S+)/)[1];
        assert.equal(m.headers['List-Unsubscribe'], `<${url}>`);
        assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
        assert.doesNotMatch(url, /500\d/, '링크에 구글 계정 번호가 없다');
    }
    assert.ok(resend[0].headers['Idempotency-Key'].startsWith(`result-${R}-`));
    assert.ok(!env.COMMUNITY._m.has('mw:' + R), '예전 기록을 치웠다');
    assert.equal((await resultMail(env, SUN + 3600e3)).skipped, 'done', '다시 돌아도 두 번 보내지 않는다');
    assert.equal(resend.length, 1);
    assert.equal(JSON.stringify([...env.DB._m.entries()]), kvBefore, '결제 KV 는 그대로');
    drawHead = null;
});

test('결과 메일: 모두 낙첨이면 "모두 낙첨", 보낼 사람이 없으면 메일 없이 끝낸다', async () => {
    const env = await fresh();
    drawHead = head(R, WIN, BONUS);
    await subscribers(env, 1, [[6, 7, 8, 9, 10, 11], [4, 6, 7, 8, 9, 10]]);
    await resultMail(env, SUN);
    assert.match(resend[0].body[0].text, /번호 2게임 모두 낙첨/);
    assert.match(resend[0].body[0].text, /2\) {2}4 · 6 · 7 · 8 · 9 · 10 {2}→ {2}낙첨 \(맞은 번호 4\)/);
    const env2 = await fresh();
    await subscribers(env2, 3);
    assert.deepEqual(await resultMail(env2, SUN), { sent: 0, done: true });
    assert.equal(resend.length, 0);
    assert.equal((await resultMail(env2, SUN + 3600e3)).skipped, 'done');
    drawHead = null;
});

test('결과 메일: 하루 한도를 넘으면 나머지는 다음 날(월요일) 보낸다', async () => {
    const env = await fresh({ WEEKLY_MAIL_DAILY: '2' });
    drawHead = head(R, WIN, BONUS);
    await subscribers(env, 3, [[1, 2, 3, 4, 5, 6]]);
    assert.deepEqual(await resultMail(env, SUN), { sent: 2, done: false });
    assert.equal((await resultMail(env, SUN + 3600e3)).skipped, 'budget', '같은 날은 더 보내지 않는다');
    assert.deepEqual(await resultMail(env, MON), { sent: 1, done: true });
    assert.deepEqual(sentTo(), ['m0@gmail.com', 'm1@gmail.com', 'm2@gmail.com'], '한 사람에 한 통씩');
    drawHead = null;
});

test('결과 메일: Resend 가 실패하면 다음 시간에 다시, 세 번 연달아 실패하면 그 회차는 멈추고 알린다. 사이트 API 는 그대로', async () => {
    const env = await fresh({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
    drawHead = head(R, WIN, BONUS);
    await subscribers(env, 1, [[1, 2, 3, 4, 5, 6]]);
    resendFail = 1;
    assert.match((await resultMail(env, SUN)).failed, /429/);
    assert.deepEqual(await resultMail(env, SUN + 3600e3), { sent: 1, done: true }, '두 번째에 보낸다');
    const env2 = await fresh({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
    const [s] = await subscribers(env2, 1, [[1, 2, 3, 4, 5, 6]]);
    resendFail = 3;
    for (let i = 0; i < 3; i++) await resultMail(env2, SUN + i * 3600e3);
    assert.equal((await resultMail(env2, SUN + 4 * 3600e3)).skipped, 'done', '멈췄다');
    assert.equal(resend.length, 0);
    assert.equal((await call(env2, 'GET', '/api/config')).status, 200);
    assert.equal((await call(env2, 'GET', '/api/me/numbers', { headers: auth(s) })).status, 200);
    drawHead = null;
});

test('수신 거부: 링크를 열기만 해서는 꺼지지 않고(GET), 단추 · 메일 앱(POST)으로 끈다. 서명이 틀리면 거절', async () => {
    const env = await fresh();
    drawHead = head(R, WIN, BONUS);
    const [s] = await subscribers(env, 1, [[1, 2, 3, 4, 5, 6]]);
    await resultMail(env, SUN);
    const url = new URL(resend[0].body[0].text.match(/수신 거부: (\S+)/)[1]);
    const get = await worker.fetch(new Request(url, { method: 'GET' }), env, ctx);
    assert.equal(get.status, 200);
    const page = await get.text();
    assert.match(page, /<form method="post"/);
    assert.match(page, /추첨 결과 메일 수신 거부/);
    assert.equal((await call(env, 'GET', '/api/me/numbers', { headers: auth(s) })).data.mail, true, 'GET 만으로는 그대로');
    const forged = new URL(url); forged.searchParams.set('t', 'A'.repeat(22));
    assert.match(await (await worker.fetch(new Request(forged, { method: 'POST' }), env, ctx)).text(), /올바르지 않습니다/);
    assert.equal((await call(env, 'GET', '/api/me/numbers', { headers: auth(s) })).data.mail, true);
    const post = await worker.fetch(new Request(url, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), env, ctx);
    assert.match(await post.text(), /수신 거부되었습니다/);
    assert.equal((await call(env, 'GET', '/api/me/numbers', { headers: auth(s) })).data.mail, false);
    assert.equal((await call(env, 'GET', '/api/admin/status', { headers: asAdmin })).data.weekly.subs, 0);
    // 다시 보낼 때가 와도(그 회차 기록을 지워 흉내) 보내지 않는다
    env.COMMUNITY._m.delete('mr:' + R);
    resend = [];
    await resultMail(env, SUN + 3600e3);
    assert.equal(resend.length, 0);
    drawHead = null;
});

test('메일을 켜려면 메일 발송 설정이 있어야 한다', async () => {
    const env = await fresh({ RESEND_API_KEY: '' });
    const s = await login(env);
    assert.equal((await call(env, 'POST', '/api/me/mail', { headers: auth(s), body: { on: true } })).data.error, 'no_mail');
    assert.equal((await call(env, 'POST', '/api/me/mail', { headers: auth(s), body: { on: false } })).data.mail, false, '끄기는 된다');
});
