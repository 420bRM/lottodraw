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
        async list({ prefix }) {
            const out = new Map();
            [...map.keys()].filter(k => k.startsWith(prefix || '')).sort().forEach(k => out.set(k, clone(map.get(k))));
            return out;
        },
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
