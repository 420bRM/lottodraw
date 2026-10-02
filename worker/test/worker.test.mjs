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
// listLag: 실제 KV 처럼 방금 쓴 키가 목록(list)에 늦게 보인다 (settle() 하면 보인다)
function memoryKV({ listLag = false } = {}) {
    const m = new Map();
    const fresh = new Set();
    return {
        _m: m,
        settle() { fresh.clear(); },
        async get(k, type) {
            const e = m.get(k);
            if (!e) return null;
            return type === 'json' ? JSON.parse(e.value) : e.value;
        },
        async put(k, value, opts) {
            m.set(k, { value: String(value), metadata: opts && opts.metadata, ttl: opts && opts.expirationTtl });
            if (listLag) fresh.add(k);
        },
        async delete(k) { m.delete(k); },
        async list({ prefix }) {
            const keys = [...m.keys()].filter(k => k.startsWith(prefix || '') && !fresh.has(k)).sort()
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
    assert.equal(order.listPrice, 5900);
    assert.ok(order.amount >= 5801 && order.amount <= 5899, '계좌이체는 끝자리 1~99원 할인된 고유 금액: ' + order.amount);
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

test('입금 알림 자동 확인: 주문마다 금액 끝자리가 달라 금액만으로 찾는다 (새벽에도 사람 손 없이)', async () => {
    _resetForTests();
    const env = makeEnv({ DEPOSIT_HOOK_SECRET: 'hook-secret-0123456789' });
    await setupKey(env);
    const hook = (raw, extra) => call(env, 'POST', '/api/hooks/deposit', { raw, headers: Object.assign({ 'Content-Type': 'text/plain', Authorization: 'Bearer hook-secret-0123456789' }, extra || {}) });
    const won = n => n.toLocaleString('ko-KR') + '원';

    // 같은 이용권 주문 여러 건도 금액이 전부 다르다
    const orders = [];
    for (let i = 0; i < 6; i++) {
        orders.push((await call(env, 'POST', '/api/orders', { body: { plan: 'month', method: 'bank', name: '구매자' + i, agree: true }, headers: { 'CF-Connecting-IP': '10.0.0.' + i } })).data);
    }
    assert.equal(new Set(orders.map(o => o.order.amount)).size, 6, '대기 중인 주문끼리 금액이 겹치지 않는다');

    let r = await call(env, 'POST', '/api/hooks/deposit?key=wrong', { raw: 'x', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(r.status, 401);

    const target = orders[3];
    // 출금 알림은 무시
    r = await hook(`[우리은행] 출금 ${won(target.order.amount)} 구매자3`);
    assert.equal(r.data.matched, null);
    // 정가(할인 전 금액)로 보내면 맞추지 않는다
    r = await hook(`[우리은행] 입금 5,900원 구매자3`);
    assert.equal(r.data.matched, null);

    // 입금자명이 주문과 달라도(가족 계좌 등) 금액이 맞으면 바로 발급. 잔액 금액은 무시한다
    r = await hook(`[Web발신]\n우리 10/02 03:12\n*1234\n입금 ${won(target.order.amount)}\n홍엄마\n잔액 ${won(target.order.amount + 1000000)}`);
    assert.equal(r.data.matched, target.order.id);
    const got = await call(env, 'GET', `/api/orders/${target.order.id}?token=${target.token}`);
    assert.equal(got.data.order.status, 'paid');
    assert.ok(got.data.order.key.startsWith('LD1-'));

    // 같은 알림이 다시 오면 두 번 처리하지 않는다
    r = await hook(`[Web발신]\n우리 10/02 03:12\n*1234\n입금 ${won(target.order.amount)}\n홍엄마\n잔액 ${won(target.order.amount + 1000000)}`);
    assert.equal(r.data.reason, 'duplicate');

    // JSON 으로 금액·이름을 따로 보내도 된다
    r = await call(env, 'POST', '/api/hooks/deposit', { body: { amount: String(orders[0].order.amount), name: '아무개' }, headers: { Authorization: 'Bearer hook-secret-0123456789' } });
    assert.equal(r.data.matched, orders[0].order.id);

    // 금액이 같은 대기 주문이 둘이면(기한 지난 옛 주문과 겹침) 이름으로 좁히고, 그래도 애매하면 발급하지 않는다
    const twin = orders[1].order;
    const clone = JSON.parse(env.DB._m.get('order:' + twin.id).value);
    clone.id = 'ZZZZZZZ1'; clone.name = '다른사람'; clone.createdAt -= 80 * 3600 * 1000;
    await env.DB.put('order:' + clone.id, JSON.stringify(clone), { metadata: { s: 'pending', p: 'month', a: twin.amount, m: 'bank', n: clone.name, c: clone.createdAt } });
    r = await hook(`입금 ${won(twin.amount)} 제3자`);
    assert.equal(r.data.matched, null);
    assert.equal(r.data.candidates, 2);
    r = await hook(`입금 ${won(twin.amount)} 구매자1 10/02`);
    assert.equal(r.data.matched, twin.id);

    // 연결 상태가 기록되고, 공개 설정에 "자동 확인 중"으로 나온다
    const cfg = await call(env, 'GET', '/api/config');
    assert.equal(cfg.data.autoConfirm, true);
});

test('KV 목록이 늦어도: 방금 만든 주문에 바로 입금돼도 맞추고, 연달아 든 주문끼리 금액이 겹치지 않는다', async () => {
    _resetForTests();
    const env = makeEnv({ DB: memoryKV({ listLag: true }), DEPOSIT_HOOK_SECRET: 'hook-secret-0123456789' });
    await setupKey(env);
    const hook = raw => call(env, 'POST', '/api/hooks/deposit', { raw, headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer hook-secret-0123456789' } });

    // 목록에 아직 안 보이는 주문 10건도 금액이 전부 다르다
    const orders = [];
    for (let i = 0; i < 10; i++) {
        orders.push((await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'bank', name: '구매자' + i, agree: true }, headers: { 'CF-Connecting-IP': '10.1.0.' + i } })).data);
    }
    assert.equal(new Set(orders.map(o => o.order.amount)).size, 10);

    // 목록에 보이기 전에 입금 알림이 와도 금액 색인으로 찾는다
    const t = orders[7];
    let r = await hook(`입금 ${t.order.amount.toLocaleString('ko-KR')}원 아무개`);
    assert.equal(r.data.matched, t.order.id);
    assert.equal(env.DB._m.has('amt:' + t.order.amount), false, '입금된 주문의 금액 색인은 지운다');

    // 자동 점검 주문도 같다 (배포 직후 실서버 점검이 이 경우였다)
    const st = (await call(env, 'POST', '/api/admin/selftest/order', { headers: asAdmin })).data;
    r = await hook(`[자동점검 ${st.order.id}] 입금 ${st.order.amount.toLocaleString('ko-KR')}원 자동점검`);
    assert.equal(r.data.matched, st.order.id);
    r = await call(env, 'POST', '/api/admin/selftest/cleanup', { headers: asAdmin, body: { id: st.order.id } });
    assert.equal(r.data.cleaned, true);

    // 취소한 주문의 금액 색인도 지운다
    const c = orders[2];
    await call(env, 'POST', `/api/orders/${c.order.id}/cancel`, { body: { token: c.token } });
    env.DB.settle();
    assert.equal(env.DB._m.has('amt:' + c.order.amount), false);
});

test('입금 알림 연결: 6시간마다 ping, 13시간 조용하면 지킴이가 한 번만 알린다', async () => {
    _resetForTests();
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('https://api.telegram.org/')) { sent.push(JSON.parse(init.body).text); return new Response('{}'); }
        return realFetch(url, init);
    };
    try {
        const env = makeEnv({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
        // 연결 전: 자동 확인 아님, 지킴이 조용
        assert.equal((await call(env, 'GET', '/api/config')).data.autoConfirm, false);
        // 관리자 페이지에서 열쇠를 만든다 (비밀값을 따로 넣지 않아도 되게)
        let r = await call(env, 'POST', '/api/admin/hook-secret', { headers: asAdmin });
        const key = r.data.secret;
        assert.ok(key.length >= 16);
        assert.equal((await call(env, 'POST', '/api/admin/hook-secret', { headers: asAdmin })).data.secret, key, '두 번 눌러도 같은 열쇠');

        await worker.scheduled({}, env, ctx);
        await Promise.all(waits);
        assert.equal(sent.length, 0);

        r = await call(env, 'POST', '/api/hooks/deposit', { raw: 'ping', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + key } });
        assert.equal(r.data.pong, true);
        assert.equal((await call(env, 'GET', '/api/config')).data.autoConfirm, true);

        // 14시간 조용
        const h = JSON.parse(env.DB._m.get('meta:hook').value);
        h.lastAt -= 14 * 3600 * 1000;
        env.DB._m.get('meta:hook').value = JSON.stringify(h);
        assert.equal((await call(env, 'GET', '/api/config')).data.autoConfirm, false, '끊기면 화면 안내가 "판매자 확인 뒤"로 바뀐다');
        await worker.scheduled({}, env, ctx); await Promise.all(waits);
        await worker.scheduled({}, env, ctx); await Promise.all(waits);
        assert.equal(sent.length, 1, '같은 끊김은 한 번만 알린다');
        assert.match(sent[0], /입금 알림 연결이 14시간째/);

        // 다시 살아나면 다음 끊김 때 또 알린다
        await call(env, 'POST', '/api/hooks/deposit', { raw: 'ping', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + key } });
        const st = await call(env, 'GET', '/api/admin/status', { headers: asAdmin });
        assert.equal(st.data.hooks.alive, true);
        assert.ok(st.data.hooks.state.pingAt);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('환불 요청: 기간 안이면 키 즉시 정지, 계좌이체는 판매자에게 송금 요청, 기간 지나면 거절', async () => {
    _resetForTests();
    const env = makeEnv({ DEPOSIT_HOOK_SECRET: 'hook-secret-0123456789' });
    await setupKey(env);
    const make = async plan => {
        const { order, token } = (await call(env, 'POST', '/api/orders', { body: { plan, method: 'bank', name: '홍길동', agree: true }, headers: { 'CF-Connecting-IP': plan } })).data;
        await call(env, 'POST', '/api/hooks/deposit', { raw: `입금 ${order.amount.toLocaleString('ko-KR')}원`, headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer hook-secret-0123456789' } });
        return (await call(env, 'GET', `/api/orders/${order.id}?token=${token}`)).data.order;
    };
    const m = await make('month');
    assert.equal(m.status, 'paid');

    let r = await call(env, 'POST', '/api/refunds', { body: { key: m.key } });
    assert.equal(r.data.error, 'need_account', '계좌이체는 돌려받을 계좌가 필요');
    r = await call(env, 'POST', '/api/refunds', { body: { key: m.key.slice(0, -2) + 'AA', account: '우리 1002-111-222222 홍길동' } });
    assert.equal(r.status, 400, '가짜 키는 거절');
    r = await call(env, 'POST', '/api/refunds', { body: { key: m.key, account: '우리 1002-111-222222 홍길동' } });
    assert.equal(r.data.status, 'refund_requested');
    const rev = await call(env, 'GET', '/api/revoked');
    assert.ok(rev.data.ids.includes(parseKey(m.key).id), '키는 바로 정지');
    // 다시 눌러도 같은 결과
    assert.equal((await call(env, 'POST', '/api/refunds', { body: { key: m.key, account: 'x' } })).data.status, 'refund_requested');
    // 판매자: 송금 완료
    const list = await call(env, 'GET', '/api/admin/orders?status=refund_requested', { headers: asAdmin });
    assert.equal(list.data.orders.length, 1);
    r = await call(env, 'POST', `/api/admin/orders/${m.id}/refund-done`, { headers: asAdmin });
    assert.equal(r.data.order.status, 'refunded');
    assert.equal(r.data.order.refundAccount, '우리 1002-111-222222 홍길동');

    // 1주 이용권은 24시간이 지나면 거절
    const w = await make('week');
    const rec = JSON.parse(env.DB._m.get('order:' + w.id).value);
    rec.paidAt -= 25 * 3600 * 1000;
    env.DB._m.get('order:' + w.id).value = JSON.stringify(rec);
    r = await call(env, 'POST', '/api/refunds', { body: { key: w.key, account: '우리 1002-111-222222 홍길동' } });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'refund_window');
});

test('환불 요청: 카드(페이앱) 결제는 결제 취소까지 자동', async () => {
    _resetForTests();
    const env = makeEnv({ PAYAPP_USERID: 'seller1', PAYAPP_LINKKEY: 'lk-secret', PAYAPP_LINKVAL: 'lv-secret' });
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('https://api.payapp.kr/')) {
            const f = new URLSearchParams(init.body);
            calls.push(f);
            if (f.get('cmd') === 'payrequest') return new Response('state=1&mul_no=777&payurl=https%3A%2F%2Fpayapp.kr%2Fp%2F777');
            if (f.get('cmd') === 'paycancel') return new Response('state=1&errorMessage=');
        }
        return realFetch(url, init);
    };
    try {
        await setupKey(env);
        const { order } = (await call(env, 'POST', '/api/orders', { body: { plan: 'lifetime', method: 'payapp', phone: '01012345678', agree: true } })).data;
        assert.equal(order.amount, 12900, '카드는 정가');
        const form = new URLSearchParams({ userid: 'seller1', linkkey: 'lk-secret', linkval: 'lv-secret', mul_no: '777', var1: order.id, price: '12900', pay_state: '4' });
        await call(env, 'POST', '/api/payapp/feedback', { raw: form.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const key = (await call(env, 'GET', `/api/admin/orders/${order.id}`, { headers: asAdmin })).data.order.key;
        const r = await call(env, 'POST', '/api/refunds', { body: { key } });
        assert.equal(r.data.status, 'refunded');
        const cancel = calls.find(f => f.get('cmd') === 'paycancel');
        assert.equal(cancel.get('mul_no'), '777');
        assert.equal(cancel.get('linkkey'), 'lk-secret');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('자동 점검 주문: 알림 없이 돌고, 끝나면 흔적 없이 지워진다', async () => {
    _resetForTests();
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('https://api.telegram.org/')) { sent.push(init.body); return new Response('{}'); }
        return realFetch(url, init);
    };
    try {
        const env = makeEnv({ DEPOSIT_HOOK_SECRET: 'hook-secret-0123456789', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' });
        await setupKey(env);
        const { order, token } = (await call(env, 'POST', '/api/admin/selftest/order', { headers: asAdmin })).data;
        let r = await call(env, 'POST', '/api/hooks/deposit', { raw: `[자동점검 ${order.id}] 입금 ${order.amount.toLocaleString('ko-KR')}원 자동점검`, headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer hook-secret-0123456789' } });
        assert.equal(r.data.matched, order.id);
        assert.equal(env.DB._m.has('meta:hook'), false, '점검은 휴대폰 연결 신호로 치지 않는다');
        const paid = (await call(env, 'GET', `/api/orders/${order.id}?token=${token}`)).data.order;
        r = await call(env, 'POST', '/api/refunds', { body: { key: paid.key, account: '자동점검 계좌' } });
        assert.equal(r.data.status, 'refund_requested');
        await Promise.all(waits);
        assert.equal(sent.length, 0, '점검은 판매자에게 알리지 않는다');
        r = await call(env, 'POST', '/api/admin/selftest/cleanup', { headers: asAdmin, body: { id: order.id } });
        assert.equal(r.data.cleaned, true);
        assert.equal(env.DB._m.has('order:' + order.id), false);
        assert.deepEqual((await call(env, 'GET', '/api/revoked')).data.ids, []);
        // 진짜 주문은 지우지 않는다
        const real = (await call(env, 'POST', '/api/orders', { body: { plan: 'week', method: 'bank', name: '홍길동', agree: true } })).data.order;
        r = await call(env, 'POST', '/api/admin/selftest/cleanup', { headers: asAdmin, body: { id: real.id } });
        assert.equal(r.status, 409);
    } finally {
        globalThis.fetch = realFetch;
    }
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
