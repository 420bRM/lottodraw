// 사용: cd worker && npm test   (또는 node --test worker/test/)
// Worker 를 메모리 KV 로 돌려 보고, 발급된 키를 브라우저용 js/license.js 로 확인한다.
// 두 파일이 같은 키 형식을 따르는지 여기서 같이 지킨다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import worker, { _resetForTests } from '../src/index.js';
import { parseKey, signKey, importPrivate, generateKeyPair } from '../src/keys.js';
import { BASE_PLANS } from '../src/plans.js';

const require = createRequire(import.meta.url);

/* ───── 메모리 KV ───── */
function memoryKV() {
    const m = new Map();
    return {
        _m: m,
        async get(k, type) {
            const e = m.get(k);
            if (!e) return null;
            return type === 'json' ? JSON.parse(e.value) : e.value;
        },
        async put(k, value, opts) { m.set(k, { value: String(value), metadata: opts && opts.metadata, ttl: opts && opts.expirationTtl }); },
        async delete(k) { m.delete(k); },
        async list({ prefix }) {
            const keys = [...m.keys()].filter(k => k.startsWith(prefix || '')).sort()
                .map(name => ({ name, metadata: m.get(name).metadata }));
            return { keys, list_complete: true };
        },
    };
}

const ADMIN = 'admin-token-0123456789abcdef';
const ORIGIN = 'https://www.lottodraw.kr';

function makeEnv(extra) {
    return Object.assign({
        DB: memoryKV(),
        SITE_URL: 'https://www.lottodraw.kr',
        ALLOWED_ORIGINS: 'https://www.lottodraw.kr,https://lottodraw.kr',
        ADMIN_TOKEN: ADMIN,
        BANK_NAME: '우리은행',
        BANK_ACCOUNT: '1002-123-456789',
        BANK_HOLDER: '홍길동',
    }, extra || {});
}

const waits = [];
const ctx = { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); } };

async function call(env, method, path, { body, headers, raw } = {}) {
    const h = Object.assign({ Origin: ORIGIN }, headers || {});
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await worker.fetch(new Request('https://api.lottodraw.kr' + path, { method, headers: h, body: payload }), env, ctx);
    const type = res.headers.get('Content-Type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
}
const asAdmin = { Authorization: 'Bearer ' + ADMIN };
const setupKey = env => call(env, 'POST', '/api/admin/setup-key', { headers: asAdmin });

/* ───── 브라우저 쪽 license.js 를 Node 에서 ───── */
function browserLicense(apiFetch) {
    const ls = new Map();
    globalThis.localStorage = {
        getItem: k => (ls.has(k) ? ls.get(k) : null),
        setItem: (k, v) => ls.set(k, String(v)),
        removeItem: k => ls.delete(k),
    };
    globalThis.PREMIUM_CONFIG = { apiBase: 'https://api.lottodraw.kr', revalidateHours: 12 };
    globalThis.fetch = apiFetch;
    delete require.cache[require.resolve('../../js/license.js')];
    return { L: require('../../js/license.js'), ls };
}

test('공개 설정: 계좌 정보가 있으면 계좌이체가 켜지고, 페이앱은 꺼져 있다', async () => {
    _resetForTests();
    const env = makeEnv();
    const r = await call(env, 'GET', '/api/config');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.methods, { bank: true, payapp: false });
    assert.equal(r.data.plans.month.amount, BASE_PLANS.month.amount);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');

    const off = await call(makeEnv({ BANK_ACCOUNT: '' }), 'GET', '/api/config');
    assert.equal(off.data.methods.bank, false);
});

test('PRICES 환경변수로 가격만 바꿀 수 있다', async () => {
    _resetForTests();
    const r = await call(makeEnv({ PRICES: '{"week":3000,"month":500}' }), 'GET', '/api/config');
    assert.equal(r.data.plans.week.amount, 3000);
    assert.equal(r.data.plans.month.amount, BASE_PLANS.month.amount, '1,000원 미만은 무시');
});

test('계좌이체 전체 흐름: 주문 → 입금 대기 → 관리자 확인 → 키 → 브라우저 확인 → 환불 → 잠김', async () => {
    _resetForTests();
    const env = makeEnv();

    // 동의 없이는 주문 불가
    let r = await call(env, 'POST', '/api/orders', { body: { plan: 'month', method: 'bank', name: '김철수' } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'need_agree');

    // 입금자명 없이는 주문 불가
    r = await call(env, 'POST', '/api/orders', { body: { plan: 'month', method: 'bank', agree: true } });
    assert.equal(r.data.error, 'need_name');

    r = await call(env, 'POST', '/api/orders', { body: { plan: 'month', method: 'bank', name: ' 김철수 <b>', contact: 'a@b.c', agree: true } });
    assert.equal(r.status, 201);
    const { order, token } = r.data;
    assert.match(order.id, /^[0-9A-Z]{8}$/);
    assert.equal(order.amount, 5900);
    assert.equal(order.status, 'pending');
    assert.equal(order.name, '김철수 b', '태그 문자는 걸러진다');
    assert.equal(order.bank.account, '1002-123-456789');
    assert.equal(order.bank.tossBank, '우리');
    assert.equal(order.key, undefined);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);

    // 토큰이 틀리면 조회 불가
    r = await call(env, 'GET', `/api/orders/${order.id}?token=wrong`);
    assert.equal(r.status, 404);
    r = await call(env, 'GET', `/api/orders/${order.id}?token=${token}`);
    assert.equal(r.data.order.status, 'pending');

    // 관리자 인증
    r = await call(env, 'GET', '/api/admin/orders?status=pending');
    assert.equal(r.status, 401);
    r = await call(env, 'GET', '/api/admin/orders?status=pending', { headers: asAdmin });
    assert.equal(r.data.orders.length, 1);
    assert.equal(r.data.orders[0].n, '김철수 b');

    // 서명 키를 만들기 전에는 발급하지 않는다
    r = await call(env, 'POST', `/api/admin/orders/${order.id}/confirm`, { headers: asAdmin });
    assert.equal(r.status, 503);
    assert.equal(r.data.error, 'no_signing_key');
    let status = await call(env, 'GET', '/api/admin/status', { headers: asAdmin });
    assert.equal(status.data.kid, null);

    const made = await setupKey(env);
    assert.equal(made.status, 201);
    assert.equal((await setupKey(env)).status, 409, '서명 키는 덮어쓰지 않는다');
    status = await call(env, 'GET', '/api/admin/status', { headers: asAdmin });
    assert.equal(status.status, 200);
    assert.ok(status.data.publicJwk.x);
    assert.equal(status.data.publicJwk.d, undefined, '비밀 성분은 내보내지 않는다');
    assert.equal(status.data.kid, made.data.kid);

    r = await call(env, 'POST', `/api/admin/orders/${order.id}/confirm`, { headers: asAdmin });
    assert.equal(r.status, 200);
    assert.equal(r.data.order.status, 'paid');
    const key = r.data.order.key;
    assert.match(key, /^LD1-[A-Za-z0-9_-]{104}$/);

    // 두 번 눌러도 같은 키
    r = await call(env, 'POST', `/api/admin/orders/${order.id}/confirm`, { headers: asAdmin });
    assert.equal(r.data.order.key, key);

    // 구매자 화면은 폴링으로 키를 받는다
    r = await call(env, 'GET', `/api/orders/${order.id}?token=${token}`);
    assert.equal(r.data.order.status, 'paid');
    assert.equal(r.data.order.key, key);
    assert.equal(r.data.order.bank, undefined, '입금 뒤에는 계좌를 다시 보여주지 않는다');

    const p = parseKey(key);
    assert.equal(p.plan, 'month');
    assert.ok(p.expiresAt - p.issuedAt === 30 * 86400);

    // 브라우저 쪽 확인
    const apiFetch = async url => {
        const u = new URL(url);
        const res = await worker.fetch(new Request(url, { headers: { Origin: ORIGIN } }), env, ctx);
        assert.ok(u.pathname === '/api/pubkey' || u.pathname === '/api/revoked', '키 확인 때문에 키를 서버로 보내지 않는다: ' + u.pathname);
        return res;
    };
    let { L } = browserLicense(apiFetch);
    let v = await L.validate(key);
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.planId, 'month');
    assert.equal(v.keyId, p.id);

    // 한 글자만 바꿔도 거절
    const tampered = key.slice(0, 10) + (key[10] === 'A' ? 'B' : 'A') + key.slice(11);
    v = await L.validate(tampered);
    assert.equal(v.ok, false);
    assert.equal(v.final, true);

    // 다른 서명 키로 만든 키는 거절
    const other = await generateKeyPair();
    const fake = await signKey(await importPrivate(other.privateJwk), { plan: 'lifetime', id: 1, issuedAt: 1, expiresAt: 0 });
    v = await L.validate(fake);
    assert.equal(v.ok, false);

    // 저장 → unlockState
    L.remember(key, (await L.validate(key)));
    let st = await L.unlockState();
    assert.equal(st.unlocked, true);
    assert.match(L.summary(st.record), /1개월 이용권 · \d{4}-\d\d-\d\d까지 이용 가능 · 키 번호 [0-9A-F]{8}/);

    // 환불 → 정지 목록 → 새 브라우저(목록 캐시 없음)에서 잠김
    r = await call(env, 'POST', `/api/admin/orders/${order.id}/refund`, { headers: asAdmin });
    assert.equal(r.data.order.status, 'refunded');
    r = await call(env, 'GET', '/api/revoked');
    assert.deepEqual(r.data.ids, [p.id]);

    ({ L } = browserLicense(apiFetch));
    L.remember(key, { ok: true, plan: 'x', expiresAt: null });
    st = await L.unlockState();
    assert.equal(st.unlocked, false);
    assert.equal(L.savedKey(), null, '정지된 키는 브라우저에서도 지운다');

    // 환불된 주문은 다시 확인 불가
    r = await call(env, 'POST', `/api/admin/orders/${order.id}/confirm`, { headers: asAdmin });
    assert.equal(r.status, 409);
});

test('서버가 꺼져 있어도 한 번 확인한 키는 열린다 (공개키 기억)', async () => {
    _resetForTests();
    const env = makeEnv();
    await setupKey(env);
    const issued = await call(env, 'POST', '/api/admin/issue', { headers: asAdmin, body: { plan: 'lifetime', note: '테스트' } });
    assert.equal(issued.status, 201);
    const key = issued.data.order.key;
    assert.equal(parseKey(key).expiresAt, null);

    let online = true;
    const apiFetch = async url => {
        if (!online) throw new TypeError('Failed to fetch');
        return worker.fetch(new Request(url), env, ctx);
    };
    const { L } = browserLicense(apiFetch);
    assert.equal((await L.validate(key)).ok, true);
    online = false;
    globalThis.localStorage.removeItem('lottodraw.premium.revoked');
    assert.equal((await L.validate(key)).ok, true, '공개키는 기억, 정지 목록은 못 받아도 통과');
});

test('공개키를 설정에 박아 두면 서버에 묻지 않는다', async () => {
    _resetForTests();
    const env = makeEnv();
    await setupKey(env);
    const st = await call(env, 'GET', '/api/admin/status', { headers: asAdmin });
    const issued = await call(env, 'POST', '/api/admin/issue', { headers: asAdmin, body: { plan: 'custom', days: 3 } });
    const key = issued.data.order.key;
    const { L } = browserLicense(async () => { throw new Error('no network'); });
    globalThis.PREMIUM_CONFIG = { apiBase: '', publicKeyJwk: st.data.publicJwk };
    const v = await L.validate(key);
    assert.equal(v.ok, true);
    assert.equal(v.planId, 'custom');
    assert.ok(Date.parse(v.expiresAt) - Date.now() < 3 * 86400000 + 5000);
});

test('기간이 지난 키는 거절', async () => {
    _resetForTests();
    const env = makeEnv();
    await setupKey(env);
    const rec = JSON.parse(env.DB._m.get('meta:signing-key').value);
    const now = Math.floor(Date.now() / 1000);
    const old = await signKey(await importPrivate(rec.privateJwk), { plan: 'week', id: 7, issuedAt: now - 8 * 86400, expiresAt: now - 86400 });
    const { L } = browserLicense(async url => worker.fetch(new Request(url), env, ctx));
    const v = await L.validate(old);
    assert.equal(v.ok, false);
    assert.match(v.reason, /기간이 끝난/);
});

test('입금 대기 주문은 구매자가 취소할 수 있고, 관리자 목록에서 빠진다', async () => {
    _resetForTests();
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'bank', name: '이영희', agree: true } });
    const { order, token } = r.data;
    const c = await call(env, 'POST', `/api/orders/${order.id}/cancel`, { body: { token } });
    assert.equal(c.data.order.status, 'cancelled');
    const list = await call(env, 'GET', '/api/admin/orders?status=pending', { headers: asAdmin });
    assert.equal(list.data.orders.length, 0);
    assert.ok(env.DB._m.get('order:' + order.id).ttl > 0, '취소된 주문은 시간이 지나면 지워진다');
});

test('입금 알림 자동 매칭: 금액+이름이 하나에만 맞을 때만 발급', async () => {
    _resetForTests();
    const env = makeEnv({ DEPOSIT_HOOK_SECRET: 'hook-secret-0123456789' });
    await setupKey(env);
    const a = (await call(env, 'POST', '/api/orders', { body: { plan: 'month', method: 'bank', name: '박민수', agree: true } })).data.order;
    const b = (await call(env, 'POST', '/api/orders', { body: { plan: 'month', method: 'bank', name: '최지은', agree: true }, headers: { 'CF-Connecting-IP': '2.2.2.2' } })).data.order;
    // "입금" 이라는 이름으로 주문해 두고 남의 입금에 올라타려는 시도
    const sneaky = (await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'bank', name: '입금', agree: true }, headers: { 'CF-Connecting-IP': '3.3.3.3' } })).data.order;
    // "김" 한 글자는 아예 주문이 안 된다
    const short = await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'bank', name: '김', agree: true } });
    assert.equal(short.data.error, 'need_name');

    let r = await call(env, 'POST', '/api/hooks/deposit?key=wrong', { raw: 'x', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(r.status, 401);

    // 출금 알림은 무시
    r = await call(env, 'POST', '/api/hooks/deposit', { raw: '[우리은행] 출금 5,900원 박민수', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer hook-secret-0123456789' } });
    assert.equal(r.data.matched, null);

    // 금액만 맞고 이름이 없으면 발급하지 않는다 (후보 2건)
    r = await call(env, 'POST', '/api/hooks/deposit', { raw: '[우리은행] 입금 5,900원', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer hook-secret-0123456789' } });
    assert.equal(r.data.matched, null);
    assert.equal(r.data.candidates, 2);

    // "박민수" 가 "박민수진" 안에 들어 있어도 낱말이 다르면 맞추지 않는다
    r = await call(env, 'POST', '/api/hooks/deposit', { raw: '[우리은행] 입금 5,900원 박민수진', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer hook-secret-0123456789' } });
    assert.equal(r.data.matched, null);

    r = await call(env, 'POST', '/api/hooks/deposit?key=hook-secret-0123456789', { raw: '[WON] 입금 5,900원 최 지은 잔액 10,000원', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(r.data.matched, b.id);
    // 같은 알림이 다시 와도 두 번 처리하지 않는다
    r = await call(env, 'POST', '/api/hooks/deposit?key=hook-secret-0123456789', { raw: '[WON] 입금 5,900원 최 지은 잔액 10,000원', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(r.data.reason, 'duplicate');

    // 이름이 "입금" 인 주문은 알림 문장에 "입금" 이 있어도 자동 확인하지 않는다
    r = await call(env, 'POST', '/api/hooks/deposit?key=hook-secret-0123456789', { raw: '[우리은행] 입금 2,900원 김철수', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(r.data.matched, null);

    const pending = await call(env, 'GET', '/api/admin/orders?status=pending', { headers: asAdmin });
    assert.deepEqual(pending.data.orders.map(o => o.id).sort(), [a.id, sneaky.id].sort());
});

test('페이앱: 결제창 요청 → 통보 확인(키/금액 검증) → 키 발급 → 승인취소 시 정지', async () => {
    _resetForTests();
    const env = makeEnv({ PAYAPP_USERID: 'seller1', PAYAPP_LINKKEY: 'lk-secret', PAYAPP_LINKVAL: 'lv-secret' });
    const realFetch = globalThis.fetch;
    let sent = null;
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('https://api.payapp.kr/')) {
            sent = new URLSearchParams(init.body);
            return new Response('state=1&errorMessage=&mul_no=555&payurl=https%3A%2F%2Fpayapp.kr%2Fpay%2F555', { status: 200 });
        }
        return realFetch(url, init);
    };
    try {
        await setupKey(env);
        let r = await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'payapp', phone: '010-1234-5678', agree: true } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        assert.equal(r.data.payurl, 'https://payapp.kr/pay/555');
        const order = r.data.order;
        assert.equal(sent.get('price'), '2900');
        assert.equal(sent.get('var1'), order.id);
        assert.equal(sent.get('recvphone'), '01012345678');
        assert.equal(sent.get('feedbackurl'), 'https://api.lottodraw.kr/api/payapp/feedback');
        assert.equal(sent.get('returnurl'), `https://www.lottodraw.kr/statistics.html?order=${order.id}`);

        const form = s => ({ raw: new URLSearchParams(s).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const base = { userid: 'seller1', linkkey: 'lk-secret', linkval: 'lv-secret', mul_no: '555', var1: order.id, price: '2900' };

        r = await call(env, 'POST', '/api/payapp/feedback', form(Object.assign({}, base, { linkval: 'nope', pay_state: '4' })));
        assert.equal(r.status, 403);

        r = await call(env, 'POST', '/api/payapp/feedback', form(Object.assign({}, base, { price: '100', pay_state: '4' })));
        assert.equal(r.data, 'SUCCESS');
        let o = (await call(env, 'GET', `/api/admin/orders/${order.id}`, { headers: asAdmin })).data.order;
        assert.equal(o.status, 'pending', '금액이 다르면 발급하지 않는다');

        r = await call(env, 'POST', '/api/payapp/feedback', form(Object.assign({}, base, { pay_state: '4' })));
        assert.equal(r.data, 'SUCCESS');
        o = (await call(env, 'GET', `/api/admin/orders/${order.id}`, { headers: asAdmin })).data.order;
        assert.equal(o.status, 'paid');
        assert.ok(o.key.startsWith('LD1-'));

        r = await call(env, 'POST', '/api/payapp/feedback', form(Object.assign({}, base, { pay_state: '9' })));
        o = (await call(env, 'GET', `/api/admin/orders/${order.id}`, { headers: asAdmin })).data.order;
        assert.equal(o.status, 'refunded');
        const refundedKey = o.key;

        // 환불된 주문에 결제 완료 통보가 다시 와도 새 키를 만들지 않는다
        r = await call(env, 'POST', '/api/payapp/feedback', form(Object.assign({}, base, { pay_state: '4' })));
        assert.equal(r.data, 'SUCCESS');
        o = (await call(env, 'GET', `/api/admin/orders/${order.id}`, { headers: asAdmin })).data.order;
        assert.equal(o.status, 'refunded');
        assert.equal(o.key, refundedKey);
        const rev = await call(env, 'GET', '/api/revoked');
        assert.deepEqual(rev.data.ids, [o.keyId]);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('CORS: 허용한 출처만, 관리자 토큰이 짧으면 관리자 기능은 꺼진다', async () => {
    _resetForTests();
    let r = await call(makeEnv(), 'OPTIONS', '/api/orders', { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
    r = await call(makeEnv(), 'OPTIONS', '/api/orders');
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.match(r.headers.get('Access-Control-Allow-Headers'), /Authorization/);

    r = await call(makeEnv({ ADMIN_TOKEN: 'short' }), 'GET', '/api/admin/status', { headers: { Authorization: 'Bearer short' } });
    assert.equal(r.status, 401);
});

test('도배 방지: 주문 제한에 걸리면 429', async () => {
    _resetForTests();
    const env = makeEnv({ ORDER_LIMIT: { limit: async () => ({ success: false }) } });
    const r = await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'bank', name: 'x', agree: true } });
    assert.equal(r.status, 429);
});

test('화면 가격(js/premium-config.js)과 서버 가격(worker/src/plans.js)이 같다', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../js/premium-config.js', import.meta.url), 'utf8');
    const win = {};
    new Function('window', src)(win);
    Object.keys(BASE_PLANS).forEach(id => {
        assert.equal(win.PREMIUM_CONFIG.plans[id].amount, BASE_PLANS[id].amount, id);
        assert.equal(win.PREMIUM_CONFIG.plans[id].days, BASE_PLANS[id].days, id);
    });
});

test('내장 속성 이름(toString, __proto__ 등)으로는 주문할 수 없다', async () => {
    _resetForTests();
    const env = makeEnv();
    for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
        let r = await call(env, 'POST', '/api/orders', { body: { plan: bad, method: 'bank', name: '홍길동', agree: true } });
        assert.equal(r.data.error, 'bad_plan', bad);
        r = await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: bad, name: '홍길동', agree: true } });
        assert.equal(r.data.error, 'bad_method', bad);
        r = await call(env, 'POST', '/api/admin/issue', { headers: asAdmin, body: { plan: bad } });
        assert.equal(r.data.error, 'bad_plan', bad);
    }
});

test('한 곳에서 걸어 둘 수 있는 입금 대기 주문은 3건, 기한 지난 주문은 세지 않는다', async () => {
    _resetForTests();
    const env = makeEnv();
    const order = () => call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'bank', name: '홍길동', agree: true }, headers: { 'CF-Connecting-IP': '9.9.9.9' } });
    for (let i = 0; i < 3; i++) assert.equal((await order()).status, 201);
    const r = await order();
    assert.equal(r.status, 429);
    assert.equal(r.data.error, 'too_many_pending');
    // 기한(72시간)이 지난 것으로 만들면 다시 주문할 수 있다
    for (const [k, e] of env.DB._m) if (k.startsWith('order:')) e.metadata.c -= 73 * 3600 * 1000;
    assert.equal((await order()).status, 201);
});

test('같은 주문을 두 번 확인해도 키 번호는 하나 (환불하면 함께 정지)', async () => {
    _resetForTests();
    const env = makeEnv();
    await setupKey(env);
    const { order } = (await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'bank', name: '홍길동', agree: true } })).data;
    const [x, y] = await Promise.all([
        call(env, 'POST', `/api/admin/orders/${order.id}/confirm`, { headers: asAdmin }),
        call(env, 'POST', `/api/admin/orders/${order.id}/confirm`, { headers: asAdmin }),
    ]);
    assert.equal(x.data.order.keyId, y.data.order.keyId);
    assert.equal(parseKey(x.data.order.key).id, parseKey(y.data.order.key).id);
});

test('서명 키 백업은 관리자만, KV 에 있을 때만', async () => {
    _resetForTests();
    const env = makeEnv();
    let r = await call(env, 'POST', '/api/admin/key-backup', { headers: asAdmin });
    assert.equal(r.status, 404);
    await setupKey(env);
    r = await call(env, 'POST', '/api/admin/key-backup');
    assert.equal(r.status, 401);
    r = await call(env, 'POST', '/api/admin/key-backup', { headers: asAdmin });
    assert.ok(r.data.privateJwk.d);
    // 백업을 비밀값으로 넣으면 그 키로 서명한다 (KV 를 잃어도 이전 키가 산다)
    _resetForTests();
    const env2 = makeEnv({ LICENSE_PRIVATE_JWK: JSON.stringify(r.data.privateJwk) });
    const st = await call(env2, 'GET', '/api/admin/status', { headers: asAdmin });
    assert.equal(st.data.keySource, 'secret');
    assert.equal(st.data.publicJwk.x, r.data.privateJwk.x);
});

test.after(async () => { await Promise.all(waits); });
