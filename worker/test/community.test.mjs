// 회원(구글 로그인) · 무료 체험 · 좋아요 · 탈퇴. 구글 서버 대신 시험용 RSA 키로 ID 토큰을 만들어 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { _resetForTests, Community } from '../src/index.js';
import { score } from '../src/community.js';
import { _resetGoogleForTests } from '../src/google.js';
import { parseKey, b64urlEncode } from '../src/keys.js';

const ADMIN = 'admin-token-0123456789abcdef';
const ORIGIN = 'https://www.lottodraw.kr';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

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
const outbound = [];
function fakeInternet() {
    outbound.length = 0;
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        outbound.push(u);
        if (u === CERTS_URL) return new Response(JSON.stringify({ keys: [GOOD.jwk] }), { headers: { 'Cache-Control': 'public, max-age=20000' } });
        if (u.startsWith('https://api.telegram.org/') || u === 'https://api.resend.com/emails') return new Response('{}');
        return realFetch(url, init);
    };
}

async function fresh(extra) {
    _resetForTests();
    _resetGoogleForTests();
    fakeInternet();
    const env = makeEnv(extra);
    await call(env, 'POST', '/api/admin/setup-key', { headers: asAdmin });
    return env;
}
const login = async (env, claims) => call(env, 'POST', '/api/auth/google', { body: { credential: await idToken(claims) } });

test.after(() => { globalThis.fetch = realFetch; });

test('로그인 설정: 클라이언트 ID 가 없으면 꺼져 있고, 넣으면 /api/config 에 나온다', async () => {
    const off = await fresh({ GOOGLE_CLIENT_ID: '' });
    assert.equal((await call(off, 'GET', '/api/config')).data.login, null);
    assert.equal((await login(off)).data.error, 'no_login');
    const on = await fresh();
    assert.deepEqual((await call(on, 'GET', '/api/config')).data.login, { google: CLIENT_ID, trialDays: 3 });
    const noTrial = await fresh({ SIGNUP_TRIAL_DAYS: undefined });
    assert.deepEqual((await call(noTrial, 'GET', '/api/config')).data.login, { google: CLIENT_ID, trialDays: 0 }, '체험을 끄면 0');
});

test('가입 체험 끔(실서버 기본): 새 가입은 키 · 주문 · 체험 기록 없이 가입만, 텔레그램에 새 가입 알림, 예전 체험 키는 그대로', async () => {
    // 체험을 켠 서버에서 한 명이 체험을 받은 뒤 …
    const env = await fresh({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
    const old = await login(env, { sub: '2001', email: 'old@gmail.com' });
    assert.equal(old.data.trialNew, true);
    assert.ok([...env.COMMUNITY._m.keys()].some(k => k.startsWith('t:')), '체험을 받은 계정 기록이 있다');
    // … 체험을 끈다 (SIGNUP_TRIAL_DAYS 를 지운 것과 같다)
    delete env.SIGNUP_TRIAL_DAYS;
    const sent = [];
    const telegram = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://api.telegram.org/')) sent.push(JSON.parse(init.body).text); return telegram(url, init); };
    const waits = [];
    const res = await worker.fetch(new Request('https://api.lottodraw.kr/api/auth/google', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: await idToken({ sub: '2002', email: 'new@gmail.com' }) }) }), env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    globalThis.fetch = telegram;
    const a = await res.json();
    assert.equal(res.status, 200, JSON.stringify(a));
    assert.equal(a.isNew, true);
    assert.equal(a.trialNew, false);
    assert.equal(a.user.trial, null, '새 가입에는 체험 키가 없다');
    assert.ok(sent.some(t => t.startsWith('새 가입')), '새 가입 알림: ' + JSON.stringify(sent));
    const orders = (await call(env, 'GET', '/api/admin/orders?status=paid', { headers: asAdmin })).data.orders;
    assert.equal(orders.length, 1, '체험 주문은 예전 것 하나뿐');
    assert.ok(![...env.COMMUNITY._m.keys()].some(k => k.startsWith('t:')), '체험을 받은 계정 기록(t:)은 지운다');
    // 예전에 받은 체험 키는 그대로, 다시 로그인해도 새로 받지 않는다
    const again = await login(env, { sub: '2001', email: 'old@gmail.com' });
    assert.equal(again.data.trialNew, false);
    assert.equal(again.data.user.trial.key, old.data.user.trial.key);
    const st = (await call(env, 'GET', '/api/admin/status', { headers: asAdmin })).data;
    assert.deepEqual(st.login, { users: 2, trials: 1, trialDays: 0 }, '관리자 상태: 체험 꺼짐');
});

test('구글 가입: 처음 한 번 3일 무료 체험 키, 다시 로그인하면 같은 키, 메일은 보내지 않는다', async () => {
    const env = await fresh({ RESEND_API_KEY: 're_test', MAIL_FROM: 'lottodraw.kr <key@lottodraw.kr>', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
    const a = await login(env);
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.equal(a.data.isNew, true);
    assert.equal(a.data.trialNew, true);
    assert.equal(a.data.user.email, 'buyer@gmail.com');
    const key = parseKey(a.data.user.trial.key);
    assert.equal(key.plan, 'trial');
    const days = (key.expiresAt - key.issuedAt) / 86400;
    assert.equal(days, 3);
    assert.ok(!outbound.includes('https://api.resend.com/emails'), '체험 키는 메일로 보내지 않는다');

    // 주문처럼 남는다 (0원, 무료 체험) — 이메일은 주문에 적지 않는다
    const orders = (await call(env, 'GET', '/api/admin/orders?status=paid', { headers: asAdmin })).data.orders;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].m, 'trial');
    assert.equal(orders[0].a, 0);
    const order = (await call(env, 'GET', `/api/admin/orders/${orders[0].id}`, { headers: asAdmin })).data.order;
    assert.ok(!JSON.stringify(order).includes('gmail'), '주문에 이메일이 없다');

    // 다시 로그인 → 새 체험 없음, 같은 키
    const b = await login(env);
    assert.equal(b.data.isNew, false);
    assert.equal(b.data.trialNew, false);
    assert.equal(b.data.user.trial.key, a.data.user.trial.key);
    assert.equal((await call(env, 'GET', '/api/admin/orders?status=paid', { headers: asAdmin })).data.orders.length, 1);

    // 내 정보
    const me = await call(env, 'GET', '/api/me', { headers: auth(b.data.session) });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, 'buyer@gmail.com');
    assert.ok(!('sub' in me.data.user), '구글 계정 번호는 내보내지 않는다');

    // 관리자 상태에 가입 수
    const st = (await call(env, 'GET', '/api/admin/status', { headers: asAdmin })).data;
    assert.deepEqual(st.login, { users: 1, trials: 1, trialDays: 3 });
});

test('번호 생성기 설정: 로그인한 회원만 저장 · 다듬어 저장 · 내 정보에만 · 지우기 · 탈퇴하면 함께 사라진다', async () => {
    const env = await fresh();
    const a = await login(env);
    const s = a.data.session;
    assert.equal(a.data.user.gen, null);
    // 로그인 없이는 안 된다
    assert.equal((await call(env, 'POST', '/api/me/generator', { body: { gen: { inc: [1] } } })).status, 401);
    // 엉뚱한 값은 걸러 낸다: 범위 밖 · 겹침 · 고정수 7개 · 제외수와 고정수 겹침 · 패턴 번호 · 칸 범위
    const saved = await call(env, 'POST', '/api/me/generator', { headers: auth(s), body: { gen: {
        inc: [7, 3, 3, 0, 46, 'x', 1, 2, 4, 5, 6], exc: [10, 3, 45, 45, 99], pat: [16, 1, 1, 17, 0], recent: 99, ac: 12.7, extra: 'nope' } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const g = saved.data.user.gen;
    assert.deepEqual(g.inc, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(g.exc, [10, 45], '고정수와 겹친 제외수는 뺀다');
    assert.deepEqual(g.pat, [1, 16]);
    assert.equal(g.recent, 10);
    assert.equal(g.ac, 10, 'AC값 조건은 0~10');
    assert.ok(!('extra' in g) && g.at > 0);
    // 내 정보에 나온다
    const me = await call(env, 'GET', '/api/me', { headers: auth(s) });
    assert.deepEqual(me.data.user.gen.inc, [1, 2, 3, 4, 5, 6]);
    // 이상한 본문은 거절
    assert.equal((await call(env, 'POST', '/api/me/generator', { headers: auth(s), body: { gen: 'x' } })).status, 400);
    // AC값이 이상하면 끔(0)
    const odd = await call(env, 'POST', '/api/me/generator', { headers: auth(s), body: { gen: { ac: 'x', acExact: true } } });
    assert.equal(odd.data.user.gen.ac, 0);
    assert.equal(odd.data.user.gen.acExact, false, 'AC값 조건이 꺼져 있으면 "이 값만"도 끔');
    // "이 값만": true 일 때만 켠다(문자열 · 숫자는 끔). 예전 설정(acExact 없음)은 범위(이상)로
    const exact = await call(env, 'POST', '/api/me/generator', { headers: auth(s), body: { gen: { ac: 8, acExact: true } } });
    assert.equal(exact.data.user.gen.ac, 8);
    assert.equal(exact.data.user.gen.acExact, true);
    const loose = await call(env, 'POST', '/api/me/generator', { headers: auth(s), body: { gen: { ac: 8, acExact: 'yes' } } });
    assert.equal(loose.data.user.gen.acExact, false);
    assert.equal(g.acExact, false, '없으면 범위(이상)');
    // 지우기
    const cleared = await call(env, 'POST', '/api/me/generator', { headers: auth(s), body: { gen: null } });
    assert.equal(cleared.data.user.gen, null);
    // 다시 저장한 뒤 탈퇴하면 계정과 함께 사라진다
    await call(env, 'POST', '/api/me/generator', { headers: auth(s), body: { gen: { inc: [8] } } });
    assert.equal((await call(env, 'POST', '/api/me/delete', { body: { confirm: true }, headers: auth(s) })).status, 200);
    assert.ok(![...env.COMMUNITY._m.values()].some(v => v && v.gen), '탈퇴하면 설정도 지워진다');
});

test('구글 토큰 위조·다른 사이트·만료·미확인 이메일은 거절한다', async () => {
    const env = await fresh();
    const now = Math.floor(Date.now() / 1000);
    const bad = async (claims, key) => (await call(env, 'POST', '/api/auth/google', { body: { credential: await idToken(claims, key) } })).data.error;
    assert.equal(await bad({}, EVIL), 'bad_credential');
    assert.equal(await bad({ aud: 'other.apps.googleusercontent.com' }), 'bad_credential');
    assert.equal(await bad({ iss: 'https://evil.example' }), 'bad_credential');
    assert.equal(await bad({ exp: now - 600 }), 'bad_credential');
    assert.equal(await bad({ email_verified: false }), 'bad_credential');
    assert.equal((await call(env, 'POST', '/api/auth/google', { body: { credential: 'a.b.c' } })).data.error, 'bad_credential');
    assert.equal((await call(env, 'POST', '/api/auth/google', { body: {} })).data.error, 'bad_credential');
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth('x'.repeat(43)) })).status, 401);
});

test('좋아요: 하트·달러를 따로 켜고 끄고, 누른 수는 누구나 보며, 누르려면 로그인', async () => {
    const env = await fresh();
    const a = (await login(env, { sub: 'A', email: 'a@gmail.com' })).data.session;
    const b = (await login(env, { sub: 'B', email: 'b@gmail.com' })).data.session;
    const counts = async () => (await call(env, 'GET', '/api/reactions?ids=statistics-sum,blog-ac-value-explained')).data.counts;
    assert.deepEqual((await counts())['statistics-sum'], { h: 0, d: 0, w: 0 });

    assert.equal((await call(env, 'POST', '/api/reactions', { body: { id: 'statistics-sum', type: 'h' } })).status, 401);
    const press = (s, id, type) => call(env, 'POST', '/api/reactions', { body: { id, type }, headers: auth(s) });
    assert.deepEqual((await press(a, 'statistics-sum', 'h')).data, { counts: { h: 1, d: 0, w: 0 }, mine: 'h' });
    assert.deepEqual((await press(a, 'statistics-sum', 'd')).data, { counts: { h: 1, d: 1, w: 0 }, mine: 'hd' });
    assert.deepEqual((await press(b, 'statistics-sum', 'h')).data, { counts: { h: 2, d: 1, w: 0 }, mine: 'h' });
    assert.deepEqual((await press(a, 'statistics-sum', 'h')).data, { counts: { h: 1, d: 1, w: 0 }, mine: 'd' }, '다시 누르면 취소');
    assert.deepEqual((await counts())['statistics-sum'], { h: 1, d: 1, w: 0 });
    assert.deepEqual((await call(env, 'GET', '/api/me', { headers: auth(a) })).data.reactions, { 'statistics-sum': 'd' });

    assert.equal((await press(a, 'Bad Id!', 'h')).data.error, 'bad_ids');
    assert.equal((await press(a, 'statistics-sum', 'x')).data.error, 'bad_type');
    assert.equal((await call(env, 'GET', '/api/reactions?ids=')).data.error, 'bad_ids');
    const many = Array.from({ length: 31 }, (_, i) => 'p' + i).join(',');
    assert.equal((await call(env, 'GET', '/api/reactions?ids=' + many)).data.error, 'bad_ids');
    assert.equal((await call(env, 'GET', '/api/admin/members')).status, 401, '회원 명부는 관리자만');
});

test('회원 명부: 별명·이메일·가입일·체험·누른 수를 보고, 별명을 지우거나 회원을 삭제한다', async () => {
    const env = await fresh();
    const a = (await login(env, { sub: 'A', email: 'a@gmail.com' })).data;
    const b = (await login(env, { sub: 'B', email: 'b@gmail.com' })).data;
    await call(env, 'POST', '/api/me/nickname', { body: { nickname: '바보멍청이' }, headers: auth(a.session) });
    await call(env, 'POST', '/api/reactions', { body: { id: 'index-stat-sum', type: 'h' }, headers: auth(a.session) });
    await call(env, 'POST', '/api/reactions', { body: { id: 'index-stat-sum', type: 'd' }, headers: auth(b.session) });

    let list = (await call(env, 'GET', '/api/admin/members', { headers: asAdmin })).data;
    assert.equal(list.members.length, 2);
    const ma = list.members.find(m => m.email === 'a@gmail.com');
    assert.equal(ma.nick, '바보멍청이');
    assert.equal(ma.hearts, 1);
    assert.ok(ma.trial && ma.trial.keyId && ma.trial.expiresAt);
    assert.ok(ma.createdAt && ma.lastAt);
    assert.deepEqual(list.reactions, [{ id: 'index-stat-sum', h: 1, d: 1, w: 0 }]);
    assert.deepEqual(list.meta, { users: 2, trials: 2 });

    // 별명 지우기 → 그 별명은 다시 쓸 수 있다
    assert.equal((await call(env, 'POST', `/api/admin/members/${ma.sub}/clear-nick`, { headers: asAdmin })).status, 200);
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(a.session) })).data.user.nick, null);
    assert.equal((await call(env, 'POST', '/api/me/nickname', { body: { nickname: '바보멍청이' }, headers: auth(b.session) })).status, 200);

    // 회원 삭제 → 로그인이 끝나고 좋아요 합계에서 빠진다
    assert.equal((await call(env, 'POST', `/api/admin/members/${ma.sub}/delete`, { headers: asAdmin })).status, 200);
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(a.session) })).status, 401);
    list = (await call(env, 'GET', '/api/admin/members', { headers: asAdmin })).data;
    assert.equal(list.members.length, 1);
    assert.deepEqual(list.reactions, [{ id: 'index-stat-sum', h: 0, d: 1, w: 0 }].filter(x => x.h + x.d > 0));
    assert.equal((await call(env, 'POST', '/api/admin/members/nobody/delete', { headers: asAdmin })).status, 200, '없는 회원 삭제는 그냥 지나간다');
    assert.equal((await call(env, 'POST', '/api/admin/members/A/clear-nick', { headers: asAdmin })).data.error, 'no_member');
});

test('로그아웃하면 세션이 끝나고, 탈퇴하면 계정·좋아요가 지워지며 다시 가입해도 체험은 한 번뿐', async () => {
    const env = await fresh();
    const first = (await login(env)).data;
    const s1 = first.session;
    const s2 = (await login(env)).data.session;
    await call(env, 'POST', '/api/reactions', { body: { id: 'index', type: 'd' }, headers: auth(s1) });

    // 로그아웃: 그 세션만 끝난다
    assert.equal((await call(env, 'POST', '/api/auth/logout', { headers: auth(s1) })).status, 200);
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(s1) })).status, 401);
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(s2) })).status, 200);

    // 탈퇴: 확인 없이는 안 된다
    assert.equal((await call(env, 'POST', '/api/me/delete', { body: {}, headers: auth(s2) })).data.error, 'need_confirm');
    assert.equal((await call(env, 'POST', '/api/me/delete', { body: { confirm: true }, headers: auth(s2) })).status, 200);
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(s2) })).status, 401);
    assert.deepEqual((await call(env, 'GET', '/api/admin/members', { headers: asAdmin })).data.reactions, [], '내 좋아요도 빠진다');
    assert.ok(![...env.COMMUNITY._m.values()].some(v => JSON.stringify(v).includes('gmail')), '저장소에 이메일이 남지 않는다');

    // 다시 가입: 새 계정이지만 체험은 이미 받았다
    const again = (await login(env)).data;
    assert.equal(again.isNew, true);
    assert.equal(again.trialNew, false);
    assert.equal(again.user.trial, null);
    assert.equal((await call(env, 'GET', '/api/admin/status', { headers: asAdmin })).data.login.trials, 1);
    // 받은 체험 키 자체는 기간까지 그대로 (정지 목록에 없다)
    assert.ok(!(await call(env, 'GET', '/api/revoked')).data.ids.includes(parseKey(first.user.trial.key).id));
});

test('가입 단추를 두 번 눌러 요청이 겹쳐도 체험 키는 하나만 발급된다', async () => {
    const env = await fresh();
    const [a, b] = await Promise.all([login(env), login(env)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal([a.data.trialNew, b.data.trialNew].filter(Boolean).length, 1);
    assert.equal((await call(env, 'GET', '/api/admin/orders?status=paid', { headers: asAdmin })).data.orders.length, 1);
    const me = await call(env, 'GET', '/api/me', { headers: auth(b.data.session) });
    assert.ok(me.data.user.trial && me.data.user.trial.key, '겹친 쪽도 다음 조회에서 체험 키가 보인다');
});

test('별명: 정하고 바꾸고, 겹치거나 규칙에 안 맞으면 거절, 탈퇴하면 다른 사람이 쓸 수 있다', async () => {
    const env = await fresh();
    const a = (await login(env, { sub: 'A', email: 'a@gmail.com' })).data;
    const b = (await login(env, { sub: 'B', email: 'b@gmail.com' })).data;
    assert.equal(a.user.nick, null);
    const nick = (s, nickname) => call(env, 'POST', '/api/me/nickname', { body: { nickname }, headers: auth(s) });

    let r = await nick(a.session, '행운의곰');
    assert.equal(r.status, 200);
    assert.equal(r.data.user.nick, '행운의곰');
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(a.session) })).data.user.nick, '행운의곰');
    assert.equal((await login(env, { sub: 'A', email: 'a@gmail.com' })).data.user.nick, '행운의곰', '다시 로그인해도 남는다');

    assert.equal((await nick(b.session, '행운의곰')).data.error, 'taken_nick');
    assert.equal((await nick(b.session, 'a')).data.error, 'bad_nick');
    assert.equal((await nick(b.session, '띄어 쓰기')).data.error, 'bad_nick');
    assert.equal((await nick(b.session, '<script>')).data.error, 'bad_nick');
    assert.equal((await nick(b.session, '관리자님')).data.error, 'reserved_nick');
    assert.equal((await nick(b.session, 'LottoDraw1')).data.error, 'reserved_nick');
    assert.equal((await call(env, 'POST', '/api/me/nickname', { body: { nickname: '아무개' } })).status, 401);

    // 바꾸려면 500포인트가 필요하다 (가입한 날 출석 10점뿐이면 안 된다)
    const short = await nick(a.session, 'LuckyBear');
    assert.equal(short.status, 402);
    assert.equal(short.data.error, 'need_points');
    assert.equal((await nick(a.session, '행운의곰')).data.cost, 0, '같은 별명을 다시 넣는 것은 공짜');
    const give = (sub, won) => { const u = env.COMMUNITY._m.get('u:' + sub); u.buy = won; env.COMMUNITY._m.set('u:' + sub, u); };
    give('A', 6000);   // 600점 + 출석 10점

    // 바꾸면 옛 별명은 풀린다 (대소문자는 같은 별명으로 본다), 500포인트를 쓴다
    const changed = (await nick(a.session, 'LuckyBear')).data;
    assert.equal(changed.user.nick, 'LuckyBear');
    assert.equal(changed.cost, 500);
    assert.deepEqual([changed.user.score.total, changed.user.score.spent, changed.user.score.avail], [610, 500, 110], '랭킹 점수는 그대로, 쓸 수 있는 포인트만 준다');
    assert.equal((await nick(a.session, '또바꿈')).data.error, 'need_points', '남은 110점으로는 또 못 바꾼다');
    assert.equal((await nick(b.session, 'luckybear')).data.error, 'taken_nick');
    assert.equal((await nick(b.session, '행운의곰')).status, 200);

    // 탈퇴하면 별명도 풀린다
    await call(env, 'POST', '/api/me/delete', { body: { confirm: true }, headers: auth(a.session) });
    give('B', 5000);
    assert.equal((await nick(b.session, 'LuckyBear')).status, 200);
});

test('₩ 원화 반응도 따로 켜고 끈다', async () => {
    const env = await fresh();
    const a = (await login(env, { sub: 'A', email: 'a@gmail.com' })).data.session;
    const press = (id, type) => call(env, 'POST', '/api/reactions', { body: { id, type }, headers: auth(a) });
    assert.deepEqual((await press('index-stat-sum', 'w')).data, { counts: { h: 0, d: 0, w: 1 }, mine: 'w' });
    assert.deepEqual((await press('index-stat-sum', 'h')).data, { counts: { h: 1, d: 0, w: 1 }, mine: 'hw' });
    assert.deepEqual((await press('index-stat-sum', 'w')).data, { counts: { h: 1, d: 0, w: 0 }, mine: 'h' });
});

test('랭킹: 출석(하루 한 번)·반응·로그인한 채 산 이용권으로 점수, 별명 있는 회원만 공개, 환불하면 빠진다', async () => {
    const env = await fresh({ DEPOSIT_HOOK_SECRET: 'hook-secret-0123456789', BANK_NAME: '우리은행', BANK_ACCOUNT: '1002-123-456789', BANK_HOLDER: '홍길동' });
    const a = (await login(env, { sub: 'A', email: 'a@gmail.com' })).data;
    const b = (await login(env, { sub: 'B', email: 'b@gmail.com' })).data;
    assert.equal(a.attended, true, '가입한 날이 첫 출석');
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(a.session) })).data.attended, false, '같은 날 두 번은 안 된다');
    await call(env, 'POST', '/api/me/nickname', { body: { nickname: '첫째' }, headers: auth(a.session) });

    // 반응 2개 → 4점
    await call(env, 'POST', '/api/reactions', { body: { id: 'index-stat-sum', type: 'h' }, headers: auth(a.session) });
    await call(env, 'POST', '/api/reactions', { body: { id: 'index-stat-sum', type: 'w' }, headers: auth(a.session) });

    // 로그인한 채 1일 이용권 주문 → 입금 → 결제 금액 100원당 10점
    const ord = (await call(env, 'POST', '/api/orders', { body: { plan: 'day', method: 'bank', name: '홍길동', contact: '', agree: true }, headers: Object.assign({ 'CF-Connecting-IP': '10.9.0.1' }, auth(a.session)) })).data;
    assert.ok(ord.order, JSON.stringify(ord));
    await call(env, 'POST', '/api/hooks/deposit', { body: { text: `입금 ${ord.order.amount}원 홍길동` }, headers: { Authorization: 'Bearer hook-secret-0123456789' } });
    const paid = (await call(env, 'GET', `/api/admin/orders/${ord.order.id}`, { headers: asAdmin })).data.order;
    assert.equal(paid.status, 'paid');
    assert.ok(paid.memberRef && !JSON.stringify(paid).includes('"A"'), '주문에는 계정 번호 대신 참조값만');
    const buyPts = Math.floor(ord.order.amount * 10 / 100);
    assert.ok(buyPts >= 140 && buyPts <= 150, '1일 이용권(1,401~1,499원) → 140~149점');

    // 로그인 없이 산 주문은 점수가 없다
    const anon = (await call(env, 'POST', '/api/orders', { body: { plan: 'day', method: 'bank', name: '김철수', contact: '', agree: true }, headers: { 'CF-Connecting-IP': '10.9.0.2' } })).data;
    assert.equal((await call(env, 'GET', `/api/admin/orders/${anon.order.id}`, { headers: asAdmin })).data.order.memberRef, undefined);

    let r = (await call(env, 'GET', '/api/ranking')).data;
    assert.deepEqual(r.top, [{ rank: 1, nick: '첫째', points: 10 + 4 + buyPts, days: 1 }], '별명 없는 B 는 공개 목록에 없다');
    assert.equal(r.me, null);
    assert.deepEqual(r.points, { attend: 10, react: 2, buyPer100: 10, nickChange: 500 });

    // 내 순위: 별명이 없어도 알려 준다
    r = (await call(env, 'GET', '/api/ranking', { headers: auth(b.session) })).data;
    assert.equal(r.me.rank, 2);
    assert.equal(r.me.total, 10);
    assert.equal(r.me.nick, null);
    const meA = (await call(env, 'GET', '/api/me', { headers: auth(a.session) })).data.user.score;
    assert.deepEqual(meA, { total: 10 + 4 + buyPts, days: 1, reacts: 2, buy: buyPts, spent: 0, avail: 10 + 4 + buyPts });

    // 환불하면 구매 점수가 빠진다
    await call(env, 'POST', `/api/admin/orders/${ord.order.id}/refund`, { headers: asAdmin });
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(a.session) })).data.user.score.buy, 0);
    assert.equal((await call(env, 'GET', '/api/ranking')).data.top[0].points, 14);
});

test('운영자 계정: 관리자가 지정하면 운영자 별명을 쓰고, 별명 바꾸기는 무료, 랭킹에서 빠진다', async () => {
    const env = await fresh();
    const op = (await login(env, { sub: 'OP', email: 'lottodraw.admin@gmail.com' })).data.session;
    const u = (await login(env, { sub: 'U', email: 'user@gmail.com' })).data.session;
    const nick = (s, nickname) => call(env, 'POST', '/api/me/nickname', { body: { nickname }, headers: auth(s) });
    await nick(u, '일반회원');
    assert.equal((await nick(op, '운영자')).data.error, 'reserved_nick', '지정 전에는 못 쓴다');

    assert.equal((await call(env, 'POST', '/api/admin/members/OP/staff', { headers: asAdmin })).status, 200);
    assert.equal((await call(env, 'POST', '/api/admin/members/OP/staff')).status, 401, '관리자 토큰 필요');
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(op) })).data.user.staff, true);
    assert.equal((await nick(op, '운영자')).status, 200);
    const again = (await nick(op, '로또드로우운영자')).data;
    assert.equal(again.user.nick, '로또드로우운영자');
    assert.equal(again.cost, 0, '운영자는 별명 바꾸기 무료');

    const r = (await call(env, 'GET', '/api/ranking')).data;
    assert.deepEqual(r.top.map(x => x.nick), ['일반회원'], '운영자는 랭킹에서 빠진다');
    assert.equal((await call(env, 'GET', '/api/admin/members', { headers: asAdmin })).data.members.find(m => m.sub === 'OP').staff, true);

    assert.equal((await call(env, 'POST', '/api/admin/members/OP/unstaff', { headers: asAdmin })).status, 200);
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(op) })).data.user.staff, false);
});

test('랭킹 색인: 볼 때 회원 기록을 다 읽지 않고, 점수 · 별명 · 운영자 · 탈퇴가 바로 반영되며, 다시 떠도 같다', async () => {
    const env = await fresh();
    const s = {};
    for (const [sub, nick] of [['A', '가나'], ['B', '다라'], ['C', null], ['D', '마바']]) {
        s[sub] = (await login(env, { sub, email: sub.toLowerCase() + '@gmail.com' })).data.session;
        if (nick) await call(env, 'POST', '/api/me/nickname', { body: { nickname: nick }, headers: auth(s[sub]) });
    }
    const react = (sub, id) => call(env, 'POST', '/api/reactions', { body: { id, type: 'h' }, headers: auth(s[sub]) });
    const board = async () => (await call(env, 'GET', '/api/ranking')).data.top.map(x => [x.rank, x.nick, x.points]);
    await react('B', 'index-stat-sum');   // B 12점, 나머지 출석 10점
    assert.deepEqual(await board(), [[1, '다라', 12], [2, '가나', 10], [2, '마바', 10]], '같은 점수는 같은 순위, 먼저 가입한 회원이 위');

    // 줄을 만든 뒤에는 랭킹을 봐도 회원 기록을 훑지 않는다
    const reads = env.COMMUNITY._reads;
    reads.rows = 0; reads.lists.length = 0;
    await board(); await board();
    assert.equal(reads.rows, 0, '로그인하지 않은 랭킹은 저장소를 읽지 않는다');
    const meC = (await call(env, 'GET', '/api/ranking', { headers: auth(s.C) })).data;
    assert.deepEqual([meC.me.rank, meC.me.of, meC.me.nick, meC.me.total, meC.total], [2, 4, null, 10, 3], '별명 없는 C 는 자기를 끼워 센다');
    assert.ok(reads.rows <= 3, '세션 · 내 기록만 읽는다: ' + reads.rows);
    assert.deepEqual(reads.lists, []);

    await react('D', 'index-stat-sum'); await react('D', 'index-stat-gap');
    assert.deepEqual(await board(), [[1, '마바', 14], [2, '다라', 12], [3, '가나', 10]]);
    await react('D', 'index-stat-gap');   // 취소
    assert.deepEqual(await board(), [[1, '다라', 12], [1, '마바', 12], [3, '가나', 10]]);
    await call(env, 'POST', '/api/admin/members/B/clear-nick', { headers: asAdmin });
    await call(env, 'POST', '/api/admin/members/A/staff', { headers: asAdmin });
    assert.deepEqual(await board(), [[1, '마바', 12]], '별명이 지워진 B · 운영자 A 는 빠진다');
    await call(env, 'POST', '/api/admin/members/A/unstaff', { headers: asAdmin });
    assert.equal((await call(env, 'POST', '/api/me/delete', { body: { confirm: true }, headers: auth(s.D) })).status, 200);
    assert.deepEqual(await board(), [[1, '가나', 10]], '운영자를 풀면 돌아오고, 탈퇴한 D 는 빠진다');
    assert.equal(env.COMMUNITY._m.has('b:D'), false);

    // 다시 떠도 색인(b:)만 읽어 같은 줄
    env.COMMUNITY.restart();
    reads.lists.length = 0;
    assert.deepEqual(await board(), [[1, '가나', 10]]);
    assert.deepEqual(reads.lists, ['b:']);

    // 색인이 생기기 전부터 있던 회원: 처음 한 번만 u: 를 훑어 색인을 채운다
    for (const k of [...env.COMMUNITY._m.keys()]) if (k.startsWith('b:') || k === 'board') env.COMMUNITY._m.delete(k);
    await call(env, 'POST', '/api/me/nickname', { body: { nickname: '사아' }, headers: auth(s.C) });
    env.COMMUNITY.restart();
    reads.lists.length = 0;
    assert.deepEqual(await board(), [[1, '가나', 10], [1, '사아', 10]]);
    assert.deepEqual(reads.lists, ['u:', 'b:']);
    env.COMMUNITY.restart();
    reads.lists.length = 0;
    await board();
    assert.deepEqual(reads.lists, ['b:'], '두 번째부터는 색인만');
});

// 예전 방식(회원 기록을 다 훑어 세기) 그대로 — 색인으로 센 결과와 견준다
function scanRanking(map, sub, limit) {
    const all = [];
    for (const k of [...map.keys()].filter(k => k.startsWith('u:')).sort()) {
        const u = map.get(k);
        if (!u.staff) all.push({ sub: u.sub, nick: u.nick || null, createdAt: u.createdAt || 0, s: score(u) });
    }
    all.sort((a, b) => (b.s.total - a.s.total) || (a.createdAt - b.createdAt));
    const named = all.filter(x => x.nick);
    const rankOf = (list, x) => list.findIndex(y => y.s.total === x.s.total) + 1;
    const top = named.slice(0, limit).map(x => ({ rank: rankOf(named, x), nick: x.nick, points: x.s.total, days: x.s.days }));
    let me = null;
    const mine = sub && all.find(x => x.sub === sub);
    if (mine) {
        const pool = mine.nick ? named : named.concat([mine]);
        const pub = Object.assign({}, mine.s);
        delete pub.chats; delete pub.comments;
        me = Object.assign({ rank: rankOf(pool.sort((a, b) => (b.s.total - a.s.total) || (a.createdAt - b.createdAt)), mine), of: pool.length, nick: mine.nick }, pub);
    }
    return { top, me, total: named.length };
}

test('랭킹 색인: 무작위로 점수 · 별명 · 운영자 · 탈퇴를 바꿔도(다시 뜨기 · 색인 없던 때 포함) 다 훑어 센 것과 같다', async () => {
    const ns = memoryDO();
    const op = async (name, args) => (await ns.get().fetch('https://community/', { method: 'POST', body: JSON.stringify(Object.assign({ op: name }, args)) })).json();
    let seed = 20261013;
    const rnd = n => {   // mulberry32 — 늘 같은 순서의 난수
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const subs = Array.from({ length: 40 }, (_, i) => 'S' + String(i).padStart(2, '0'));
    let now = Date.UTC(2026, 9, 1);
    const comments = [];
    let tied = 0;   // 별명 있는 회원이 여럿이고 같은 점수가 있는 순간을 몇 번 견줬는지
    const did = {};
    for (let i = 1; i <= 1200; i++) {
        const sub = subs[rnd(subs.length)];
        const k = rnd(12);
        if (k <= 1) { now += rnd(3) * 12 * 3600 * 1000; await op('login', { sub, email: sub + '@gmail.com', subHash: 'h' + sub, ref: 'ref-' + sub, now, trial: false }); }
        else if (k <= 3) await op('react', { sub, item: 'card-' + rnd(6), type: ['h', 'd', 'w'][rnd(3)] });
        else if (k === 4 || k === 11) { const nick = 'n' + rnd(50); await op('setNick', { sub, nick, key: nick, now }); }
        else if (k === 5) await op('credit', { ref: 'ref-' + sub, amount: rnd(2) ? 1500 : -1500 });
        else if (k === 6) await op('chatPoint', { sub, now: now += 1000, h: 'h' + rnd(4) });
        else if (k === 7) {
            const got = await op('commentAdd', { sub, post: 'p' + rnd(2), text: '댓글 열 글자를 넘게 써 봅니다 ' + rnd(100), now: now += 20000 });
            if (got.comment) comments.push(got.comment);
        } else if (k === 8 && comments.length) {
            const c = comments.splice(rnd(comments.length), 1)[0];
            await op('commentDelete', { post: 'p0', id: c.id, admin: true });
            await op('commentDelete', { post: 'p1', id: c.id, admin: true });
        } else if (k === 9) await op('setStaff', { sub, on: rnd(4) === 0 });
        else if (k === 10 && rnd(3) === 0) { const name = rnd(2) ? 'clearNick' : 'userDelete'; if ((await op(name, { sub })).ok) did[name] = (did[name] || 0) + 1; }
        if (i % 150 === 0) ns.restart();
        if (i === 600) {   // 색인이 없던 때로
            for (const key of [...ns._m.keys()]) if (key.startsWith('b:') || key === 'board') ns._m.delete(key);
            ns.restart();
        }
        if (i % 20 === 0) {
            for (const who of [null, subs[rnd(subs.length)]]) {
                const want = scanRanking(ns._m, who, 10);
                assert.deepEqual(await op('ranking', { sub: who, limit: 10 }), want, `${i}번째 바꾼 뒤 (${who})`);
                if (want.total >= 5 && want.top.some((x, j) => j && x.rank === want.top[j - 1].rank)) tied++;
            }
        }
    }
    assert.ok(tied >= 10, '같은 점수가 섞인 랭킹을 충분히 견줘야 시험이 된다: ' + tied);
    assert.ok(did.clearNick >= 3 && did.userDelete >= 3, '별명 지우기 · 탈퇴도 여러 번: ' + JSON.stringify(did));
});

test('공유 · 출력 집계: 우리 사이트에서 보낸 종류만 한국 날짜별로 세고, 관리자만 본다', async () => {
    const env = await fresh();
    // 브라우저 sendBeacon 처럼 text/plain 으로 보낸다(미리 묻기 없음)
    const tap = (body, origin = ORIGIN) => worker.fetch(new Request('https://api.lottodraw.kr/api/tap', {
        method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain;charset=UTF-8' }, origin ? { Origin: origin } : {}), body: JSON.stringify(body),
    }), env, ctx);
    for (const k of ['gen-share', 'gen-print', 'gen-print', 'post-share', 'post-sns', 'post-sns', 'post-sns']) assert.equal((await tap({ k })).status, 204);
    assert.equal((await tap({ k: 'gen-copy' })).status, 400, '복사 · 모르는 종류는 세지 않는다');
    assert.equal((await tap({ k: 'gen-share' }, 'https://evil.example')).status, 403, '다른 사이트');
    assert.equal((await tap({ k: 'gen-share' }, null)).status, 403, 'Origin 없음');

    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    assert.equal((await call(env, 'GET', '/api/admin/taps')).status, 401);
    const r = await call(env, 'GET', '/api/admin/taps', { headers: asAdmin });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.days, [{ day: today, 'gen-share': 1, 'gen-print': 2, 'post-share': 1, 'post-sns': 3 }]);
    assert.ok(![...env.COMMUNITY._m.values()].some(v => JSON.stringify(v).includes('evil')), '누가 보냈는지는 남기지 않는다');

    // 날짜가 바뀌면 줄이 새로 생기고, 최근 날짜가 먼저
    env.COMMUNITY._m.set('e:2026-01-02', { 'gen-print': 5 });
    env.COMMUNITY._m.set('e:2026-01-01', { 'gen-share': 1 });
    const days = (await call(env, 'GET', '/api/admin/taps', { headers: asAdmin })).data.days.map(d => d.day);
    assert.deepEqual(days, [today, '2026-01-02', '2026-01-01']);

    // 같은 IP 가 너무 자주 보내면 막는다
    env.TAP_LIMIT = { limit: async () => ({ success: false }) };
    assert.equal((await tap({ k: 'gen-share' })).status, 429);
});
