// 판매점 지도 "영역"(육각 칸 땅따먹기, 2026-11-07 시험판 — src/territory.js). 구글 서버 · 사이트 파일 대신 가짜를 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, { _resetForTests, Community } from '../src/index.js';
import { _resetGoogleForTests } from '../src/google.js';
import { b64urlEncode } from '../src/keys.js';
import { seasonOf, prevSeason, computeTerritory, defaultSkin, LEGACY_T, TERR_CONSENT, VISIT_DAILY, _resetCellsForTests } from '../src/territory.js';

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
// 칸 [별명, 수, 2위 수, 경쟁자 수, 칸 모양] — 비교는 앞 넷으로(cells), 칸 모양은 full 에
const terr = async (env, s) => {
    const r = await call(env, 'GET', '/api/territory', s ? { headers: auth(s) } : {});
    if (r.data && r.data.cells) { r.data.full = r.data.cells; r.data.cells = Object.fromEntries(Object.entries(r.data.cells).map(([k, v]) => [k, v.slice(0, 4)])); }
    return r;
};
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

test('칸 주인: 더 많이 다녀온 사람, 같으면 그 칸에 더 최근에 다녀온 사람 · 칸 없는 곳은 안 센다 · 칸은 비우지 않는다', () => {
    const t = d => kstTime(2026, 11, d);
    const players = [
        { sub: 'a', nick: '가', at: t(1), v: { 1: [t(2), '0,0'], 2: [t(3), '0,0'], 4: [t(2), '1,0'] } },
        { sub: 'b', nick: '나', at: t(2), v: { 1: [t(1), '0,0'], 3: [t(5), '0,0'], 5: [kstTime(2026, 9, 30), '2,0'], 6: [t(4), null] } },
        { sub: 'c', nick: '다', at: t(3), v: { 5: [0, '2,0'] } },   // 시각 없는 예전 기록(10/26로 본다)
    ];
    const r = computeTerritory(players);
    assert.equal(r.cells['0,0'].sub, 'b', '둘 다 2곳 — b 가 11/5 로 더 최근');
    assert.equal(r.cells['0,0'].next, 2);
    assert.equal(r.cells['1,0'].sub, 'a');
    assert.equal(r.cells['2,0'].sub, 'c', '1곳씩 — c(10/26)가 b(9/30)보다 최근. 기간이 지나도 칸은 그대로 센다');
    assert.equal(r.stat.get('b').stores, 3, '칸 없는 곳은 다녀온 곳 수에 안 든다');
    assert.deepEqual(r.rank.map(s => s.sub), ['a', 'b', 'c'], '칸 1개씩 — 다녀온 곳 3 > 3(먼저 참여) … a 가 먼저 참여');
    players[0].v[3] = [t(6), '0,0'];   // a 가 3곳째
    assert.equal(computeTerritory(players).cells['0,0'].sub, 'a', '더 많이 다녀오면 가져간다');
    // 분기 확정: 그 분기 끝(to) 전에 표시한 것만
    const q4 = seasonOf(t(7));
    const upTo = computeTerritory(players, kstTime(2026, 11, 4));
    assert.equal(upTo.cells['0,0'].sub, 'a', '11/4 까지는 a 2곳(11/3) · b 1곳');
    assert.equal(upTo.cells['0,0'].n, 2);
    assert.equal(prevSeason(seasonOf(kstTime(2027, 1, 1, 0, 30))).id, q4.id);
});

test('지도 칸 계산(js/hexgrid.js): 점은 가장 가까운 칸 중심에 · 꼭짓점은 중심에서 R(0.6km)', () => {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(new URL('../../js/hexgrid.js', import.meta.url), 'utf8'), ctx);
    const H = ctx.window.LottoHex;
    assert.equal(H.R, 0.6);
    const km = ([lng1, lat1], [lng2, lat2]) => { const R = 6371, r = Math.PI / 180, x = (lng2 - lng1) * r * Math.cos((lat1 + lat2) / 2 * r), y = (lat2 - lat1) * r; return Math.hypot(x, y) * R; };
    for (const [lat, lng] of [[37.5665, 126.978], [35.1796, 129.0756], [33.4996, 126.5312], [38.2, 128.6]]) {
        const k = H.cellOf(lat, lng);
        const c = H.centerOf(k);
        assert.equal(H.cellOf(c[1], c[0]), k);
        assert.ok(km(c, [lng, lat]) <= H.R * 1.05, '점은 칸 중심에서 R 안');
        const ring = H.ringOf(k);
        assert.equal(ring.length, 7);
        ring.slice(0, 6).forEach(p => { const d = km(c, p); assert.ok(d > H.R * 0.92 && d < H.R * 1.08, '꼭짓점 거리 ' + d); });
    }
    assert.equal(H.cellOf(36, 127.5), '0,0');
});

/* ───── 서버 ───── */

test('영역 참여: 동의 · 별명이 있어야 하고, 칸 주인 · 랭킹은 별명만 공개, 그만두면 바로 빠진다', async () => {
    let tick = realNow();
    Date.now = () => (tick = Math.max(realNow(), tick + 1));   // 같은 수면 나중 사람이 이기니 시각이 겹치지 않게
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
    _resetCellsForTests();   // 앞의 영역 보기가 칸 목록을 한 시간 들고 있으므로 비운다
    assert.equal((await join(env, a)).status, 503, '칸 자료를 못 받으면 참여하지 않는다');
    assert.equal((await terr(env)).status, 200, '칸 목록을 못 받아도 영역 보기는 적어 둔 칸으로');
    cellsUp = true;
    const j = await join(env, a);
    assert.equal(j.status, 200, JSON.stringify(j.data));
    assert.equal(j.data.user.terr.v, TERR_CONSENT);
    assert.ok(j.data.user.terr.at > 0, '동의한 때를 적는다');
    let t = await terr(env, a);
    assert.deepEqual(t.data.cells['0,0'], ['가나다', 2, 0, 1], '참여 전에 다녀온 곳도 센다');
    assert.deepEqual(t.data.me, { joined: true, cells: ['0,0'], counts: { '0,0': 2 }, stores: 2, rank: 1, lastRank: null, skin: defaultSkin('3001'), skinSet: false });
    assert.equal(t.data.last, null, '아직 확정한 분기가 없다');

    // 같은 칸에서 같은 수면 더 최근에 다녀온 사람, 더 많으면 더 많은 사람
    const b = await member(env, '3002', '라마바');
    assert.equal((await join(env, b)).status, 200);
    await visit(env, b, '11100003');
    t = await terr(env);
    assert.deepEqual(t.data.cells['0,0'], ['가나다', 2, 1, 2], '2:1');
    await visit(env, b, '11100001');
    t = await terr(env);
    assert.deepEqual(t.data.cells['0,0'], ['라마바', 2, 2, 2], '2:2 — 나중에 다녀온 라마바');
    await visit(env, b, '11100002');
    t = await terr(env);
    assert.deepEqual(t.data.cells['0,0'], ['라마바', 3, 2, 2]);
    // 다른 칸 · 칸에 없는 판매점(폐점 · 모르는 곳)
    await visit(env, a, '11100004');
    await visit(env, a, '11199999');
    t = await terr(env, a);
    assert.deepEqual(t.data.cells['1,0'], ['가나다', 1, 0, 1]);
    assert.equal(t.data.me.stores, 3, '칸에 없는 곳은 안 센다');
    assert.deepEqual(t.data.rank.map(r => [r.nick, r.cells, r.stores]), [['가나다', 1, 3], ['라마바', 1, 3]], '같으면 먼저 참여한 순');
    assert.ok(!/3001|3002|gmail/.test(JSON.stringify(t.data)), '계정 번호 · 이메일은 내보내지 않는다');
    assert.ok(!/1110000/.test(JSON.stringify(t.data)), '어느 판매점을 다녀왔는지는 내보내지 않는다');
    assert.equal((await terr(env)).headers.get('Cache-Control'), 'public, max-age=60');
    // 다녀온 곳을 지우면 칸에서도: 라마바 2곳(11100003 · 11100001)이 가나다 2곳보다 최근
    await visit(env, b, '11100002', { color: null });
    assert.deepEqual((await terr(env)).data.cells['0,0'], ['라마바', 2, 2, 2]);

    // 칸 모양(스킨): 기본은 계정마다 무작위(늘 같다) · 모두에게 보인다 · 바꾸면 30포인트(모자라면 402) · 무작위로 돌리기는 무료 · 운영자는 무료
    let tt = await terr(env, a);
    const def = tt.data.full['1,0'][4];
    assert.match(def, /^[0-9a-f]{6},[0-9a-f]{6},[0-3]$/);
    assert.equal(tt.data.me.skin, def);
    assert.equal(tt.data.me.skinSet, false);
    assert.equal((await terr(env)).data.rank[0].skin, def, '랭킹에도 같은 모양');
    assert.notEqual(defaultSkin('3001'), defaultSkin('3002'), '계정마다 다르다');
    assert.equal((await call(env, 'POST', '/api/territory/skin', { body: { skin: 'aabbcc,112233,1' } })).status, 401);
    assert.equal((await call(env, 'POST', '/api/territory/skin', { headers: auth(a), body: { skin: 'red,blue,1' } })).status, 400);
    assert.equal((await call(env, 'POST', '/api/territory/skin', { headers: auth(a), body: { skin: 'aabbcc,112233,4' } })).status, 400, '무늬는 0~3');
    const poor = await call(env, 'POST', '/api/territory/skin', { headers: auth(a), body: { skin: 'AABBCC,112233,2' } });
    assert.equal(poor.status, 402, '가입 첫날 10포인트 < 30');
    assert.equal(poor.data.error, 'need_points');
    assert.equal((await call(env, 'POST', '/api/admin/members/3001/staff', { headers: asAdmin })).status, 200);
    const sk = await call(env, 'POST', '/api/territory/skin', { headers: auth(a), body: { skin: 'AABBCC,112233,2' } });
    assert.equal(sk.status, 200, JSON.stringify(sk.data));
    assert.equal(sk.data.cost, 0, '운영자는 무료');
    assert.equal(sk.data.user.terrSkin, 'aabbcc,112233,2');
    tt = await terr(env, a);
    assert.equal(tt.data.full['1,0'][4], 'aabbcc,112233,2', '고른 모양이 칸에 나온다(모두에게)');
    assert.equal(tt.data.me.skinSet, true);
    assert.equal((await call(env, 'POST', '/api/territory/skin', { headers: auth(a), body: { skin: null } })).data.user.terrSkin, null);
    assert.equal((await terr(env)).data.full['1,0'][4], def, '무작위로 돌리면 처음 모양');
    assert.equal((await call(env, 'POST', '/api/admin/members/3001/unstaff', { headers: asAdmin })).status, 200);

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
    // 칸 크기를 바꿔 칸 목록이 달라지면(한 시간마다 다시 읽는다) 다시 표시하지 않아도 새 칸으로 센다 · 목록에서 빠진 곳(폐점)은 안 센다
    const before = CELLS.cells;
    CELLS.cells = { '9,9': ['11100006'], '8,8': ['11100005'] };
    _resetCellsForTests();
    assert.deepEqual((await terr(env)).data.cells, { '9,9': ['사아자', 1, 0, 1] });
    CELLS.cells = { '9,9': ['11100005'] };
    _resetCellsForTests();
    assert.deepEqual((await terr(env)).data.cells, {}, '11100006 이 목록에서 빠지면 안 센다');
    CELLS.cells = before;
    _resetCellsForTests();
    assert.deepEqual((await terr(env)).data.cells, { '2,0': ['사아자', 1, 0, 1] });
    Date.now = realNow;
});

test('분기가 끝나면 랭킹을 확정해 남기고 칸은 그대로 · 또 다녀왔어요는 하루 한 번 · 탈퇴하면 확정 기록에서 별명을 지운다', async () => {
    let now = kstTime(2026, 12, 31, 23, 0);
    Date.now = () => now;
    try {
        const env = await fresh();
        const a = await member(env, '4001', '겨울');
        const b = await member(env, '4002', '봄바람');
        await join(env, a);
        await join(env, b);
        await visit(env, a, '11100005');
        await visit(env, a, '11100006');
        await visit(env, b, '11100005');
        assert.deepEqual((await terr(env, a)).data.cells, { '2,0': ['겨울', 2, 1, 2] });
        // 또 다녀왔어요: 같은 날은 한 번만 — 오늘 표시한 곳은 바로 안 된다
        assert.equal((await visit(env, a, '11100005', { again: true })).data.error, 'again_today');
        assert.equal((await visit(env, a, '11100001', { again: true })).data.error, 'not_visited');

        // 1/1 0시 넘어 한 시간 예약이 돈다 → 2026Q4 확정. 그 사이(0:05)에 b 가 다녀온 것은 확정에 안 든다
        now = kstTime(2027, 1, 1, 0, 5);
        await visit(env, b, '11100006');
        now = kstTime(2027, 1, 1, 0, 17);
        await env.COMMUNITY.get().fetch('https://community/', { method: 'POST', body: JSON.stringify({ op: 'terrFinalize', now }) });
        const rec = env.COMMUNITY._m.get('ts:2026Q4');
        assert.ok(rec, '확정 기록');
        assert.deepEqual(rec.rank.map(r => [r.nick, r.cells, r.stores]), [['겨울', 1, 2]], '12/31 끝 때: 겨울 2곳 > 봄바람 1곳');
        let t = await terr(env, a);
        assert.equal(t.data.season.id, '2027Q1');
        assert.deepEqual(t.data.last.rank.map(r => [r.nick, r.cells, r.stores]), [['겨울', 1, 2]]);
        assert.match(t.data.last.rank[0].skin, /^[0-9a-f]{6},/, '확정 순위에도 칸 모양');
        assert.equal(t.data.last.id, '2026Q4');
        assert.equal(t.data.me.lastRank, 1);
        assert.ok(!/4001|4002/.test(JSON.stringify(t.data)), '확정 순위도 계정 번호는 안 나간다');
        // 칸은 비우지 않는다: 지금은 2:2 — 봄바람이 1/1 0:05 로 더 최근
        assert.deepEqual(t.data.cells, { '2,0': ['봄바람', 2, 2, 2] });
        // 다음 날 겨울이 또 다녀왔어요 → 되찾는다(색은 그대로, 때만 새로)
        now = kstTime(2027, 1, 2, 10, 0);
        const again = await visit(env, a, '11100005', { again: true });
        assert.equal(again.status, 200, JSON.stringify(again.data));
        assert.equal(again.data.visits['11100005'], '#e63946');
        assert.equal(again.data.visitAt['11100005'], now);
        assert.deepEqual((await terr(env)).data.cells, { '2,0': ['겨울', 2, 2, 2] });
        assert.equal((await visit(env, a, '11100005', { again: true })).data.error, 'again_today');
        // 한 번 더 돌아도 다시 확정하지 않는다
        await env.COMMUNITY.get().fetch('https://community/', { method: 'POST', body: JSON.stringify({ op: 'terrFinalize', now }) });
        assert.equal(env.COMMUNITY._m.get('ts:2026Q4').at, kstTime(2027, 1, 1, 0, 17));
        // 탈퇴하면 확정 기록의 그 줄은 별명 · 계정 번호 없이 자리만
        assert.equal((await call(env, 'POST', '/api/me/delete', { body: { confirm: true }, headers: auth(a) })).status, 200);
        assert.deepEqual(env.COMMUNITY._m.get('ts:2026Q4').rank, [{ nick: null, cells: 1, stores: 2 }], '탈퇴하면 별명 · 계정 번호 · 칸 모양 없이 자리만');
        assert.deepEqual((await terr(env, b)).data.last.rank, [{ nick: null, skin: null, cells: 1, stores: 2 }]);
    } finally { Date.now = realNow; }
});

test('다녀온 때를 새로 적는 것은 하루 VISIT_DAILY 번까지(색 바꾸기 · 지우기는 세지 않는다)', async () => {
    const env = await fresh();
    const a = await member(env, '5001', '부지런');
    for (let k = 0; k < VISIT_DAILY; k++) assert.equal((await visit(env, a, String(11200000 + k))).status, 200);
    const over = await visit(env, a, '11299999');
    assert.equal(over.status, 429);
    assert.equal(over.data.error, 'daily_limit');
    assert.equal((await visit(env, a, '11200000', { color: '#3a86ff' })).status, 200, '색 바꾸기는 된다');
    assert.equal((await visit(env, a, '11200000', { color: null })).status, 200, '지우기는 된다');
});
