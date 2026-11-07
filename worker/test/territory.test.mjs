// 판매점 지도 "영역"(육각 칸 땅따먹기, 2026-11-07 시험판 — src/territory.js). 구글 서버 · 사이트 파일 대신 가짜를 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, { _resetForTests, Community } from '../src/index.js';
import { _resetGoogleForTests } from '../src/google.js';
import { b64urlEncode } from '../src/keys.js';
import { seasonOf, computeTerritory, LEGACY_T, TERR_CONSENT } from '../src/territory.js';

const ADMIN = 'admin-token-0123456789abcdef';
const ORIGIN = 'https://www.lottodraw.kr';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const KST = 9 * 3600e3;
const kstTime = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h || 0, mi || 0) - KST;

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



// 가짜 칸 자료: 칸 0,0 에 세 곳, 1,0 에 한 곳, 2,0 에 두 곳(사이트의 store-map-cells.json 모양)
const CELLS = { r: 1.2, cells: { '0,0': ['11100001', '11100002', '11100003'], '1,0': ['11100004'], '2,0': ['11100005', '11100006'] } };
const realFetch = globalThis.fetch;
let cellsUp = true;
function fakeInternet() {
    cellsUp = true;
    globalThis.fetch = async url => {
        const u = String(url);
        if (u === CERTS_URL) return new Response(JSON.stringify({ keys: [GOOD.jwk] }), { headers: { 'Cache-Control': 'public, max-age=20000' } });
        if (u === 'https://www.lottodraw.kr/store-map-cells.json') return cellsUp ? new Response(JSON.stringify(CELLS)) : new Response('', { status: 500 });
        if (u.startsWith('https://api.telegram.org/')) return new Response('{}');
        throw new Error('바깥 요청: ' + u);
    };
}
async function fresh() {
    _resetForTests();
    _resetGoogleForTests();
    fakeInternet();
    const env = makeEnv({ SIGNUP_TRIAL_DAYS: undefined });
    await call(env, 'POST', '/api/admin/setup-key', { headers: asAdmin });
    return env;
}
const login = async (env, claims) => (await call(env, 'POST', '/api/auth/google', { body: { credential: await idToken(claims) } })).data.session;
async function member(env, sub, nick) {
    const s = await login(env, { sub, email: sub + '@gmail.com' });
    if (nick) assert.equal((await call(env, 'POST', '/api/me/nickname', { headers: auth(s), body: { nickname: nick } })).status, 200);
    return s;
}
const visit = (env, s, id, extra) => call(env, 'POST', '/api/me/visits', { headers: auth(s), body: Object.assign({ id, color: '#e63946' }, extra || {}) });
const join = (env, s, body) => call(env, 'POST', '/api/territory/join', { headers: auth(s), body: body || { agree: true, v: TERR_CONSENT } });
const terr = (env, s) => call(env, 'GET', '/api/territory', s ? { headers: auth(s) } : {});
const realNow = Date.now;
test.after(() => { globalThis.fetch = realFetch; Date.now = realNow; });

/* ───── 규칙 ───── */

test('시즌은 한국 시간 분기: 10/1 · 1/1 0시에 바뀐다', () => {
    assert.equal(seasonOf(kstTime(2026, 10, 1, 0, 0)).id, '2026Q4');
    assert.equal(seasonOf(kstTime(2026, 9, 30, 23, 59)).id, '2026Q3');
    assert.equal(seasonOf(kstTime(2026, 12, 31, 23, 59)).id, '2026Q4');
    const q1 = seasonOf(kstTime(2027, 1, 1, 0, 0));
    assert.equal(q1.id, '2027Q1');
    assert.equal(q1.from, kstTime(2027, 1, 1, 0, 0));
    assert.equal(q1.to, kstTime(2027, 4, 1, 0, 0));
    assert.ok(LEGACY_T >= seasonOf(kstTime(2026, 11, 1)).from, '시각 없는 예전 기록은 2026년 4분기 안');
});

test('칸 주인: 이번 시즌에 더 많이 다녀온 사람, 같으면 그 수를 먼저 채운 사람 · 지난 시즌 · 모르는 칸은 안 센다', () => {
    const season = seasonOf(kstTime(2026, 11, 7));
    const t = d => kstTime(2026, 11, d);
    const players = [
        { sub: 'a', nick: '가', at: t(1), v: { 1: [t(2), '0,0'], 2: [t(3), '0,0'], 4: [t(2), '1,0'] } },
        { sub: 'b', nick: '나', at: t(2), v: { 1: [t(1), '0,0'], 3: [t(2), '0,0'], 5: [kstTime(2026, 9, 30), '2,0'], 6: [t(4), null] } },
        { sub: 'c', nick: '다', at: t(3), v: { 5: [0, '2,0'] } },   // 시각 없는 예전 기록 — 이번 시즌(2026Q4)에는 센다
    ];
    const r = computeTerritory(players, season);
    assert.equal(r.cells['0,0'].sub, 'b', '둘 다 2곳 — b 는 11/2, a 는 11/3 에 2곳을 채웠다');
    assert.equal(r.cells['0,0'].next, 2);
    assert.equal(r.cells['1,0'].sub, 'a');
    assert.equal(r.cells['2,0'].sub, 'c', 'b 의 9/30 표시는 지난 시즌');
    assert.equal(r.stat.get('b').stores, 2, '지난 시즌 · 칸 없는 곳은 다녀온 곳 수에도 안 든다');
    assert.deepEqual(r.rank.map(s => s.sub), ['a', 'b', 'c'], '칸 1개씩 — 다녀온 곳 3 > 2 > 1');
    const q1 = computeTerritory(players, seasonOf(kstTime(2027, 1, 2)));
    assert.deepEqual(q1.cells, {}, '다음 시즌에는 모두 빈다');
    assert.equal(q1.rank.length, 0);
});

test('지도 칸 계산(js/hexgrid.js): 점은 가장 가까운 칸 중심에 · 꼭짓점은 중심에서 1.2km', () => {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(new URL('../../js/hexgrid.js', import.meta.url), 'utf8'), ctx);
    const H = ctx.window.LottoHex;
    const km = ([lng1, lat1], [lng2, lat2]) => { const R = 6371, r = Math.PI / 180, x = (lng2 - lng1) * r * Math.cos((lat1 + lat2) / 2 * r), y = (lat2 - lat1) * r; return Math.hypot(x, y) * R; };
    for (const [lat, lng] of [[37.5665, 126.978], [35.1796, 129.0756], [33.4996, 126.5312], [38.2, 128.6]]) {
        const k = H.cellOf(lat, lng);
        const c = H.centerOf(k);
        assert.equal(H.cellOf(c[1], c[0]), k);
        assert.ok(km(c, [lng, lat]) <= 1.25, '점은 칸 중심에서 R 안');
        const ring = H.ringOf(k);
        assert.equal(ring.length, 7);
        ring.slice(0, 6).forEach(p => { const d = km(c, p); assert.ok(d > 1.1 && d < 1.3, '꼭짓점 거리 ' + d); });
    }
    assert.equal(H.cellOf(36, 127.5), '0,0');
});

/* ───── 서버 ───── */

test('영역 참여: 동의 · 별명이 있어야 하고, 칸 주인 · 랭킹은 별명만 공개, 그만두면 바로 빠진다', async () => {
    const env = await fresh();
    const empty = await terr(env);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.data.cells, {});
    assert.equal(empty.data.players, 0);
    assert.equal(empty.data.season.id, seasonOf(Date.now()).id);

    const a = await member(env, '3001', '가나다');
    await visit(env, a, '11100001');
    await visit(env, a, '11100002');
    assert.equal((await terr(env)).data.players, 0, '참여 전 다녀온 곳은 세지 않는다');
    assert.equal((await call(env, 'POST', '/api/territory/join', { body: { agree: true, v: TERR_CONSENT } })).status, 401);
    assert.equal((await join(env, a, { agree: false, v: TERR_CONSENT })).data.error, 'need_consent');
    assert.equal((await join(env, a, { agree: true, v: TERR_CONSENT + 1 })).data.error, 'need_consent', '다른 판 동의는 받지 않는다');
    const noNick = await member(env, '3009');
    assert.equal((await join(env, noNick)).data.error, 'need_nick');
    cellsUp = false;
    assert.equal((await join(env, a)).status, 503, '칸 자료를 못 받으면 참여하지 않는다');
    cellsUp = true;
    const j = await join(env, a);
    assert.equal(j.status, 200, JSON.stringify(j.data));
    assert.equal(j.data.user.terr.v, TERR_CONSENT);
    assert.ok(j.data.user.terr.at > 0, '동의한 때를 적는다');
    let t = await terr(env, a);
    assert.deepEqual(t.data.cells['0,0'], ['가나다', 2, 0, 1], '참여 전에 다녀온 곳도 이번 시즌이면 센다');
    assert.deepEqual(t.data.me, { joined: true, cells: ['0,0'], counts: { '0,0': 2 }, stores: 2, rank: 1 });

    // 나 = 같은 칸에서 같은 수면 먼저 채운 사람이 지킨다, 더 많으면 가져간다
    const b = await member(env, '3002', '라마바');
    assert.equal((await join(env, b)).status, 200);
    await visit(env, b, '11100003');
    await visit(env, b, '11100001');
    t = await terr(env);
    assert.deepEqual(t.data.cells['0,0'], ['가나다', 2, 2, 2], '2:2 — 먼저 채운 가나다');
    await visit(env, b, '11100002');
    t = await terr(env);
    assert.deepEqual(t.data.cells['0,0'], ['라마바', 3, 2, 2]);
    // 다른 칸 · 칸에 없는 판매점(폐점 · 모르는 곳)
    await visit(env, a, '11100004');
    await visit(env, a, '11199999');
    t = await terr(env, a);
    assert.deepEqual(t.data.cells['1,0'], ['가나다', 1, 0, 1]);
    assert.equal(t.data.me.stores, 3, '칸에 없는 곳은 안 센다');
    assert.deepEqual(t.data.rank, [{ nick: '가나다', cells: 1, stores: 3 }, { nick: '라마바', cells: 1, stores: 3 }], '같으면 먼저 참여한 순');
    assert.ok(!/3001|3002|gmail/.test(JSON.stringify(t.data)), '계정 번호 · 이메일은 내보내지 않는다');
    assert.ok(!/1110000/.test(JSON.stringify(t.data)), '어느 판매점을 다녀왔는지는 내보내지 않는다');
    assert.equal((await terr(env)).headers.get('Cache-Control'), 'public, max-age=60');
    // 다녀온 곳을 지우면 칸에서도
    await visit(env, b, '11100002', { color: null });
    assert.deepEqual((await terr(env)).data.cells['0,0'], ['가나다', 2, 2, 2]);

    // 관리자가 별명을 지우면 칸에도 별명 없이
    assert.equal((await call(env, 'POST', '/api/admin/members/3001/clear-nick', { headers: asAdmin })).status, 200);
    assert.equal((await terr(env)).data.cells['1,0'][0], null);

    // 그만두기: 칸 · 랭킹에서 바로 빠지고, 다녀온 곳은 그대로
    const left = await call(env, 'POST', '/api/territory/leave', { headers: auth(a) });
    assert.equal(left.status, 200);
    assert.equal(left.data.user.terr, null);
    assert.equal(Object.keys(left.data.user.visits).length, 4);
    t = await terr(env, a);
    assert.equal(t.data.cells['1,0'], undefined);
    assert.deepEqual(t.data.cells['0,0'], ['라마바', 2, 0, 1]);
    assert.equal(t.data.me.joined, false);
    assert.ok(!env.COMMUNITY._m.has('tp:3001'));
    // 참여하지 않은 사람의 다녀온 곳은 칸에 안 들어간다
    await visit(env, a, '11100005');
    assert.equal((await terr(env)).data.cells['2,0'], undefined);

    // 탈퇴하면 참여자 색인도 지운다
    assert.equal((await call(env, 'POST', '/api/me/delete', { body: { confirm: true }, headers: auth(b) })).status, 200);
    assert.ok(!env.COMMUNITY._m.has('tp:3002'));
    assert.deepEqual((await terr(env)).data.cells, {});

    // 저장소를 다시 띄워도(메모리 비움) 같은 결과
    const c = await member(env, '3003', '사아자');
    await join(env, c);
    await visit(env, c, '11100006');
    env.COMMUNITY.restart();
    assert.deepEqual((await terr(env)).data.cells, { '2,0': ['사아자', 1, 0, 1] });
});

test('시즌이 바뀌면 칸이 비고, "이번 시즌에 또 다녀왔어요"로 다시 센다', async () => {
    let now = kstTime(2026, 12, 31, 23, 0);
    Date.now = () => now;
    try {
        const env = await fresh();
        const a = await member(env, '4001', '겨울');
        await join(env, a);
        await visit(env, a, '11100005');
        await visit(env, a, '11100006');
        assert.deepEqual((await terr(env, a)).data.cells, { '2,0': ['겨울', 2, 0, 1] });
        now = kstTime(2027, 1, 1, 0, 10);
        let t = await terr(env, a);
        assert.equal(t.data.season.id, '2027Q1');
        assert.deepEqual(t.data.cells, {});
        assert.deepEqual(t.data.me.counts, {});
        const me = await call(env, 'GET', '/api/me', { headers: auth(a) });
        assert.equal(me.data.user.visitAt['11100005'], kstTime(2026, 12, 31, 23, 0), '표시한 때가 내 정보에 나온다(화면이 지난 시즌 것을 안다)');
        const again = await visit(env, a, '11100005', { again: true, color: undefined });
        assert.equal(again.status, 200, JSON.stringify(again.data));
        assert.equal(again.data.visits['11100005'], '#e63946', '색은 그대로');
        assert.equal(again.data.visitAt['11100005'], now);
        t = await terr(env, a);
        assert.deepEqual(t.data.cells, { '2,0': ['겨울', 1, 0, 1] });
        assert.equal((await visit(env, a, '11100001', { again: true })).data.error, 'not_visited');
    } finally { Date.now = realNow; }
});
