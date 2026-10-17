// 내 번호 저장 · 등수 확인 · 이번 주 생성 번호 메일. 구글 서버 · Resend 대신 가짜를 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, { _resetForTests, _weeklyMailForTests as weeklyMail, Community } from '../src/index.js';
import { _resetGoogleForTests } from '../src/google.js';
import { b64urlEncode } from '../src/keys.js';
import { saleRound, rankOf, patternHit, makeGames, seeded, cleanGame, ALL_PATTERNS, sat } from '../src/lotto.js';
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

test('특수 패턴 16가지가 홈 생성기(index.html)와 같다 — 무작위 조합 3만 개', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const code = html.slice(html.indexOf('    function isPrime(n) {'), html.indexOf('    // 시도 로그:'));
    const box = { I18N: { t: k => k } };
    vm.runInNewContext(code + '\nthis.check = checkInvalidPattern;', box);
    let rnd = seeded(new Uint8Array(16).map((_, i) => i * 37 + 1));
    let hits = 0;
    for (let i = 0; i < 30000; i++) {
        const pool = Array.from({ length: 45 }, (_, k) => k + 1);
        const nums = [];
        // 패턴에 잘 걸리게 절반은 좁은 범위에서 뽑는다
        const span = i % 2 ? 45 : 6 + Math.floor(rnd() * 30);
        const narrow = pool.slice(0, span);
        while (nums.length < 6) nums.push(narrow.splice(Math.floor(rnd() * narrow.length), 1)[0]);
        const ids = new Set([...ALL_PATTERNS].filter(() => rnd() < 0.6));
        const site = box.check(nums, ids);
        const ours = patternHit(nums, ids);
        assert.equal(site === null ? 0 : Number(site.slice('gen.r'.length)), ours, JSON.stringify([nums, [...ids]]));
        if (ours) hits++;
    }
    assert.ok(hits > 3000, '패턴에 걸린 조합도 충분히 견줬다: ' + hits);
});

test('생성: 5게임, 서로 다르고 패턴에 안 걸린다. 같은 씨앗이면 같은 번호', () => {
    const seed = new Uint8Array(32).map((_, i) => i);
    const a = makeGames(seeded(seed), 5);
    const b = makeGames(seeded(seed), 5);
    assert.deepEqual(a, b);
    assert.equal(a.length, 5);
    assert.equal(new Set(a.map(g => g.join())).size, 5);
    for (const g of a) { assert.deepEqual(cleanGame(g), g); assert.equal(patternHit(g, ALL_PATTERNS), 0); }
    assert.notDeepEqual(makeGames(seeded(seed.map(x => x ^ 1)), 5), a);
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

/* ───── 이번 주 생성 번호 메일 ───── */

const FRI = kstTime(2026, 10, 16, 9, 17);    // 1246회 주 금요일 09:17
const SAT = kstTime(2026, 10, 17, 9, 17);
async function subscribers(env, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const s = await login(env, { sub: String(5000 + i), email: `m${i}@gmail.com` });
        assert.equal((await call(env, 'POST', '/api/me/mail', { headers: auth(s), body: { on: true } })).data.mail, true);
        out.push(s);
    }
    return out;
}

test('메일: 금요일 09시 전 · 밤 9시 ~ 아침 9시 · 토요일 18시 뒤 · 다른 요일에는 보내지 않는다', async () => {
    const env = await fresh();
    await subscribers(env, 1);
    for (const t of [kstTime(2026, 10, 16, 8, 59), kstTime(2026, 10, 16, 21, 17), kstTime(2026, 10, 17, 3, 17), kstTime(2026, 10, 17, 18, 0), kstTime(2026, 10, 15, 12, 0), kstTime(2026, 10, 18, 12, 0)]) {
        assert.equal((await weeklyMail(env, t)).skipped, 'window');
    }
    assert.equal(resend.length, 0);
    assert.equal((await weeklyMail(await fresh({ RESEND_API_KEY: '' }), FRI)).skipped, 'window', '메일 설정이 없으면 하지 않는다');
});

test('메일: 금요일에 구독자마다 5게임 · "이번 주 생성 번호" · 수신 거부 링크, 다시 돌아도 두 번 보내지 않는다, KV 는 건드리지 않는다', async () => {
    const env = await fresh({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
    await subscribers(env, 3);
    const kvBefore = JSON.stringify([...env.DB._m.entries()]);
    const r = await weeklyMail(env, FRI);
    assert.deepEqual(r, { sent: 3, done: true });
    assert.equal(resend.length, 1, '한 묶음(batch)으로');
    const mails = resend[0].body;
    assert.equal(mails.length, 3);
    for (const m of mails) {
        assert.equal(m.subject, '[lottodraw.kr] 1246회 이번 주 생성 번호');
        assert.match(m.text, /1246회 이번 주 생성 번호입니다\. 추첨은 10월 17일\(토\) 오후 8시 35분/);
        assert.equal((m.text.match(/^[A-E]   /gm) || []).length, 5, m.text);
        assert.doesNotMatch(m.subject + m.text, /추천|예측해|적중|확률 상승|확률을 높/);
        assert.match(m.text, /예측하지 않고/);
        const url = m.text.match(/수신 거부: (\S+)/)[1];
        assert.equal(m.headers['List-Unsubscribe'], `<${url}>`);
        assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
        assert.doesNotMatch(url, /500\d/, '링크에 구글 계정 번호가 없다');
    }
    assert.equal(new Set(mails.map(m => m.to[0])).size, 3);
    assert.notEqual(mails[0].text.split('\n')[3], mails[1].text.split('\n')[3], '회원마다 번호가 다르다');
    assert.ok(resend[0].headers['Idempotency-Key'].startsWith('weekly-1246-'));
    assert.equal((await weeklyMail(env, FRI + 3600e3)).skipped, 'done');
    assert.equal(resend.length, 1);
    assert.equal(JSON.stringify([...env.DB._m.entries()]), kvBefore, '결제 KV 는 그대로');
});

test('메일: 하루 한도를 넘으면 나머지는 다음 날(토요일) 보낸다', async () => {
    const env = await fresh({ WEEKLY_MAIL_DAILY: '2' });
    await subscribers(env, 3);
    assert.deepEqual(await weeklyMail(env, FRI), { sent: 2, done: false });
    assert.equal((await weeklyMail(env, FRI + 3600e3)).skipped, 'budget', '같은 날은 더 보내지 않는다');
    assert.deepEqual(await weeklyMail(env, SAT), { sent: 1, done: true });
    const to = resend.flatMap(b => b.body.map(m => m.to[0])).sort();
    assert.deepEqual(to, ['m0@gmail.com', 'm1@gmail.com', 'm2@gmail.com'], '한 사람에 한 통씩');
});

test('메일: Resend 가 실패하면 다음 시간에 다시, 세 번 연달아 실패하면 그 회차는 멈추고 알린다. 사이트 API 는 그대로', async () => {
    const env = await fresh({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
    const [s] = await subscribers(env, 1);
    resendFail = 1;
    assert.match((await weeklyMail(env, FRI)).failed, /429/);
    assert.deepEqual(await weeklyMail(env, FRI + 3600e3), { sent: 1, done: true }, '두 번째에 보낸다');
    // 다음 주: 세 번 실패
    resendFail = 3;
    const NEXT = FRI + 7 * 86400e3;
    for (let i = 0; i < 3; i++) await weeklyMail(env, NEXT + i * 3600e3);
    assert.equal((await weeklyMail(env, NEXT + 4 * 3600e3)).skipped, 'done', '멈췄다');
    assert.equal(resend.length, 1);
    // 그동안 사이트 · 결제는 그대로
    assert.equal((await call(env, 'GET', '/api/config')).status, 200);
    assert.equal((await call(env, 'GET', '/api/me/numbers', { headers: auth(s) })).status, 200);
});

test('메일: 지난주 받은 번호 결과 한 줄 (당첨번호가 갱신됐을 때만)', async () => {
    const env = await fresh();
    await subscribers(env, 1);
    await weeklyMail(env, FRI);   // 1246회 메일
    const games = resend[0].body[0].text.split('\n').filter(l => /^[A-E]   /.test(l)).map(l => l.slice(4).trim().split(/\s+/).map(Number));
    assert.equal(games.length, 5);
    assert.doesNotMatch(resend[0].body[0].text, /지난주/, '첫 메일에는 없다');
    const head = (round, nums, bonus) => `{\n  "totalDraws": ${round},\n  "lastUpdated": "x",\n  "draws": [\n    {\n      "round": ${round},\n      "date": "x",\n      "numbers": [\n        ${nums.join(',\n        ')}\n      ],\n      "bonus": ${bonus},`;
    // 1246회가 아직 반영되지 않았으면(최신이 1245회) 줄이 없다
    drawHead = head(1245, [4, 5, 25, 28, 32, 42], 12);
    const env2 = await fresh();
    await subscribers(env2, 1);
    await weeklyMail(env2, FRI);
    const g = resend[0].body[0].text.split('\n').filter(l => /^[A-E]   /.test(l)).map(l => l.slice(4).trim().split(/\s+/).map(Number));
    const NEXT = FRI + 7 * 86400e3;
    await weeklyMail(env2, NEXT);
    assert.doesNotMatch(resend[1].body[0].text, /지난주/);
    // 1246회 당첨번호 = A 게임 5개 + (다섯 게임 어디에도 없는 번호), 보너스 = A 의 여섯째 → A 는 2등
    const env3 = await fresh();
    await subscribers(env3, 1);
    await weeklyMail(env3, FRI);
    const g3 = resend[0].body[0].text.split('\n').filter(l => /^[A-E]   /.test(l)).map(l => l.slice(4).trim().split(/\s+/).map(Number));
    const unused = Array.from({ length: 45 }, (_, i) => i + 1).find(n => !g3.flat().includes(n));
    drawHead = head(1246, [...g3[0].slice(0, 5), unused].sort((x, y) => x - y), g3[0][5]);
    await weeklyMail(env3, NEXT);
    const text = resend[1].body[0].text;
    assert.match(text, /지난주\(1246회\) 받은 번호 5게임 결과: 2등/, text);
    assert.match(text, /가장 좋은 게임 2등\(5개 일치 \+ 보너스\)/);
    assert.equal(resend[1].body[0].subject, '[lottodraw.kr] 1247회 이번 주 생성 번호');
    void g; void games;
    drawHead = null;
});

test('수신 거부: 링크를 열기만 해서는 꺼지지 않고(GET), 단추 · 메일 앱(POST)으로 끈다. 서명이 틀리면 거절', async () => {
    const env = await fresh();
    const [s] = await subscribers(env, 1);
    await weeklyMail(env, FRI);
    const url = new URL(resend[0].body[0].text.match(/수신 거부: (\S+)/)[1]);
    const get = await worker.fetch(new Request(url, { method: 'GET' }), env, ctx);
    assert.equal(get.status, 200);
    assert.match(await get.text(), /<form method="post"/);
    assert.equal((await call(env, 'GET', '/api/me/numbers', { headers: auth(s) })).data.mail, true, 'GET 만으로는 그대로');
    const forged = new URL(url); forged.searchParams.set('t', 'A'.repeat(22));
    assert.match(await (await worker.fetch(new Request(forged, { method: 'POST' }), env, ctx)).text(), /올바르지 않습니다/);
    assert.equal((await call(env, 'GET', '/api/me/numbers', { headers: auth(s) })).data.mail, true);
    const post = await worker.fetch(new Request(url, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), env, ctx);
    assert.match(await post.text(), /수신 거부되었습니다/);
    assert.equal((await call(env, 'GET', '/api/me/numbers', { headers: auth(s) })).data.mail, false);
    assert.equal((await call(env, 'GET', '/api/admin/status', { headers: asAdmin })).data.weekly.subs, 0);
    // 다음 주에는 보내지 않는다
    resend = [];
    await weeklyMail(env, FRI + 7 * 86400e3);
    assert.equal(resend.length, 0);
});

test('메일을 켜려면 메일 발송 설정이 있어야 한다', async () => {
    const env = await fresh({ RESEND_API_KEY: '' });
    const s = await login(env);
    assert.equal((await call(env, 'POST', '/api/me/mail', { headers: auth(s), body: { on: true } })).data.error, 'no_mail');
    assert.equal((await call(env, 'POST', '/api/me/mail', { headers: auth(s), body: { on: false } })).data.mail, false, '끄기는 된다');
});
