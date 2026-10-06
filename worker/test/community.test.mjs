// 회원(구글 로그인) · 무료 체험 · 좋아요 · 탈퇴. 구글 서버 대신 시험용 RSA 키로 ID 토큰을 만들어 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { _resetForTests, Community } from '../src/index.js';
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

// Durable Object 흉내: 저장소는 Map, 요청은 클래스의 fetch 로 바로 넘긴다
function memoryDO() {
    const map = new Map();
    const clone = v => (v === undefined ? undefined : structuredClone(v));
    const storage = {
        async get(k) {
            if (Array.isArray(k)) { const out = new Map(); k.forEach(x => { if (map.has(x)) out.set(x, clone(map.get(x))); }); return out; }
            return clone(map.get(k));
        },
        async put(k, v) { map.set(k, clone(v)); },
        async delete(k) { return map.delete(k); },
    };
    const inst = new Community({ storage });
    return { _m: map, idFromName: n => n, get: () => ({ fetch: (url, init) => inst.fetch(new Request(url, init)) }) };
}

function makeEnv(extra) {
    return Object.assign({
        DB: memoryKV(), COMMUNITY: memoryDO(), GOOGLE_CLIENT_ID: CLIENT_ID,
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
    assert.deepEqual(st.login, { users: 1, trials: 1 });
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

test('좋아요: 하트·달러를 따로 켜고 끄고, 수는 누구나 보며, 누르려면 로그인', async () => {
    const env = await fresh();
    const a = (await login(env, { sub: 'A', email: 'a@gmail.com' })).data.session;
    const b = (await login(env, { sub: 'B', email: 'b@gmail.com' })).data.session;
    const counts = async () => (await call(env, 'GET', '/api/reactions?ids=statistics-sum,blog-ac-value-explained')).data.counts;
    assert.deepEqual((await counts())['statistics-sum'], { h: 0, d: 0 });

    assert.equal((await call(env, 'POST', '/api/reactions', { body: { id: 'statistics-sum', type: 'h' } })).status, 401);
    const press = (s, id, type) => call(env, 'POST', '/api/reactions', { body: { id, type }, headers: auth(s) });
    assert.deepEqual((await press(a, 'statistics-sum', 'h')).data, { counts: { h: 1, d: 0 }, mine: 'h' });
    assert.deepEqual((await press(a, 'statistics-sum', 'd')).data, { counts: { h: 1, d: 1 }, mine: 'hd' });
    assert.deepEqual((await press(b, 'statistics-sum', 'h')).data, { counts: { h: 2, d: 1 }, mine: 'h' });
    assert.deepEqual((await press(a, 'statistics-sum', 'h')).data, { counts: { h: 1, d: 1 }, mine: 'd' }, '다시 누르면 취소');
    assert.deepEqual((await counts())['statistics-sum'], { h: 1, d: 1 });
    assert.deepEqual((await call(env, 'GET', '/api/me', { headers: auth(a) })).data.reactions, { 'statistics-sum': 'd' });

    assert.equal((await press(a, 'Bad Id!', 'h')).data.error, 'bad_ids');
    assert.equal((await press(a, 'statistics-sum', 'x')).data.error, 'bad_type');
    assert.equal((await call(env, 'GET', '/api/reactions?ids=')).data.error, 'bad_ids');
    const many = Array.from({ length: 31 }, (_, i) => 'p' + i).join(',');
    assert.equal((await call(env, 'GET', '/api/reactions?ids=' + many)).data.error, 'bad_ids');
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
    assert.deepEqual((await call(env, 'GET', '/api/reactions?ids=index')).data.counts.index, { h: 0, d: 0 }, '내 좋아요도 빠진다');
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
