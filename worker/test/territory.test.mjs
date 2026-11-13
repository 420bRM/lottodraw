// 판매점 지도 "영역"(육각 칸 땅따먹기, 2026-11-07 시험판 — src/territory.js). 구글 서버 · 사이트 파일 대신 가짜를 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, { _resetForTests, _hexMailForTests as hexMail, Community } from '../src/index.js';
import { community } from '../src/community.js';
import { _resetGoogleForTests } from '../src/google.js';
import { b64urlEncode } from '../src/keys.js';
import { seasonOf, prevSeason, computeTerritory, defaultSkin, LEGACY_T, TERR_CONSENT, VISIT_DAILY, _resetCellsForTests } from '../src/territory.js';
import { shapeTitles, inducedPath, evaluate, milestonePoints, titleName, catalog, MILESTONES } from '../src/titles.js';

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
// 가짜 판매점 좌표(사이트의 store-map-geo.json 모양) — 위치 인증 시험용
const GEO = { stores: { '11100001': [37.5, 127.0], '11100002': [37.5003, 127.0], '11100003': [37.5006, 127.0], '11100004': [37.51, 127.0], '11100005': [37.52, 127.0], '11100006': [37.5203, 127.0] } };
const realFetch = globalThis.fetch;
let cellsUp = true;
let site = { cells: CELLS, geo: GEO };   // 칭호 시험은 칸 · 좌표를 바꿔 쓴다
function fakeInternet() {
    cellsUp = true;
    site = { cells: CELLS, geo: GEO };
    globalThis.fetch = async url => {
        const u = String(url);
        if (u === CERTS_URL) return new Response(JSON.stringify({ keys: [GOOD.jwk] }), { headers: { 'Cache-Control': 'public, max-age=20000' } });
        if (u === 'https://www.lottodraw.kr/store-map-cells.json') return cellsUp ? new Response(JSON.stringify(site.cells)) : new Response('', { status: 500 });
        if (u === 'https://www.lottodraw.kr/store-map-geo.json') return new Response(JSON.stringify(site.geo));
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

    // 영역 빛 벽(2026-11-10): 켤 때 안 샀으면 300포인트로 산다(모자라면 402) · 운영자 무료 · 산 뒤 켜고 끄기 무료 · 켜 두면 칸 7번째에 1(모두에게)
    assert.equal((await call(env, 'POST', '/api/territory/beam', { body: { on: true } })).status, 401);
    const bpoor = await call(env, 'POST', '/api/territory/beam', { headers: auth(a), body: { on: true } });
    assert.equal(bpoor.status, 402, '300포인트가 없다');
    assert.equal(bpoor.data.error, 'need_points');
    assert.equal((await call(env, 'POST', '/api/territory/beam', { headers: auth(a), body: { on: false } })).data.user.terrBeam, null, '안 산 채로 끄기는 그대로');
    assert.equal((await terr(env)).data.full['1,0'].length, 4 + 1, '빛 벽 없으면 칸 모양까지만');
    assert.equal((await call(env, 'POST', '/api/admin/members/3001/staff', { headers: asAdmin })).status, 200);
    const bm = await call(env, 'POST', '/api/territory/beam', { headers: auth(a), body: { on: true } });
    assert.equal(bm.status, 200, JSON.stringify(bm.data));
    assert.equal(bm.data.cost, 0, '운영자는 무료');
    assert.deepEqual(bm.data.user.terrBeam, { on: true });
    let full = (await terr(env)).data.full['1,0'];
    assert.equal(full[5], null, '단 칭호가 없으면 6번째는 null');
    assert.equal(full[6], 1, '빛 벽 켬 — 로그인 없이 보는 사람에게도');
    assert.equal((await call(env, 'POST', '/api/admin/members/3001/unstaff', { headers: asAdmin })).status, 200);
    const off = await call(env, 'POST', '/api/territory/beam', { headers: auth(a), body: { on: false } });
    assert.equal(off.data.cost, 0);
    assert.deepEqual(off.data.user.terrBeam, { on: false });
    assert.equal((await terr(env)).data.full['1,0'].length, 5, '끄면 칸에서 빠진다');
    const again = await call(env, 'POST', '/api/territory/beam', { headers: auth(a), body: { on: true } });
    assert.equal(again.status, 200, '산 뒤 다시 켜기는 포인트 없이');
    assert.equal(again.data.cost, 0);
    assert.equal((await terr(env)).data.full['1,0'][6], 1);
    await call(env, 'POST', '/api/territory/beam', { headers: auth(a), body: { on: false } });

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

/* ───── 위치 인증(2026-11-09 — 위치기반서비스사업 신고) ───── */
const near = (lat, lng, extra) => Object.assign({ lat, lng, acc: 15 }, extra || {});   // 판매점 좌표 근처
const geoAgree = (env, s) => call(env, 'POST', '/api/me/geo', { headers: auth(s), body: { agree: true, v: 1 } });
const glRows = env => [...env.COMMUNITY._m.entries()].filter(([k]) => k.startsWith('gl:')).map(([, v]) => v);

test('위치 인증 꺼짐(기본): 설정에 gps false · LottoHex 동의 1판, 다녀왔어요는 좌표 없이', async () => {
    const env = await fresh();
    const cfg = (await call(env, 'GET', '/api/config')).data.login;
    assert.equal(cfg.gps, false);
    assert.equal(cfg.terrV, 1);
    const a = await member(env, 'g0', '꺼짐');
    assert.equal((await visit(env, a, '11100001')).status, 200, '꺼져 있으면 누르기만');
});

test('위치 인증 켜짐: 동의해야 하고, 50m 안만 · 오차 100m 넘으면 판정 안 함 · 좌표는 어디에도 남지 않고 확인자료는 결과만 · 철회하면 지운다', async () => {
    const env = await fresh();
    env.GPS_VERIFY = 'on';
    const cfg = (await call(env, 'GET', '/api/config')).data.login;
    assert.deepEqual([cfg.gps, cfg.geoV, cfg.terrV], [true, 1, 2], 'LottoHex 는 2판으로 다시 동의');
    const a = await member(env, 'g1', '위치맨');
    // 동의 전에는 인증하지 않는다
    assert.equal((await visit(env, a, '11100001', near(37.5, 127.0))).data.error, 'need_geo');
    assert.equal((await call(env, 'POST', '/api/me/geo', { headers: auth(a), body: { agree: true, v: 9 } })).status, 400);
    const ok = await geoAgree(env, a);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.geo.v, 1);
    assert.ok(ok.data.user.geo.at > 0, '동의 시각을 남긴다');
    // 좌표가 없거나 이상하면 거절
    assert.equal((await visit(env, a, '11100001')).data.error, 'bad_location');
    assert.equal((await visit(env, a, '11100001', { lat: 'x', lng: 1, acc: 1 })).data.error, 'bad_location');
    // 오차가 크면 판정하지 않는다
    const inacc = await visit(env, a, '11100001', near(37.5, 127.0, { acc: 150 }));
    assert.equal(inacc.status, 422);
    assert.equal(inacc.data.error, 'gps_inaccurate');
    // 1km 떨어지면 안 된다(거리를 알려 준다)
    const far = await visit(env, a, '11100001', near(37.509, 127.0));
    assert.equal(far.data.error, 'too_far');
    assert.match(far.data.message, /약 1001m/);
    // 문 닫은 · 모르는 판매점
    assert.equal((await visit(env, a, '11199999', near(37.5, 127.0))).data.error, 'no_store');
    // 30m 안이면 통과
    const pass = await visit(env, a, '11100001', near(37.50027, 127.0));
    assert.equal(pass.status, 200, JSON.stringify(pass.data));
    assert.deepEqual(Object.keys(pass.data.visits), ['11100001']);
    // 좌표는 저장소 어디에도 없다(위도 37.50027 · 경도 · 오차 값이 어떤 기록에도 없다)
    const dump = JSON.stringify([...env.COMMUNITY._m.entries()]);
    assert.ok(!dump.includes('37.50027') && !dump.includes('37.509') && !/"lat"|"lng"|"acc"/.test(dump), '좌표 · 오차를 남기지 않는다');
    // 확인자료: 시도마다 한 줄 — 계정 해시 · 시각 · 판매점 · 결과만
    const logs = glRows(env);
    assert.equal(logs.length, 4, '오차 초과 · 거리 초과 · 없는 판매점 · 통과');
    logs.forEach(l => assert.deepEqual(Object.keys(l).sort(), ['id', 'ok', 't', 'u', 'why']));
    assert.deepEqual(logs.map(l => l.why).sort(), [null, 'inaccurate', 'no_store', 'too_far'].sort());
    assert.ok(logs.every(l => /^[A-Za-z0-9_-]{16}$/.test(l.u) && !l.u.includes('g1')), '계정은 해시로');
    // 지우기는 위치 없이
    assert.equal((await visit(env, a, '11100001', { color: null })).status, 200);
    // 또 다녀왔어요도 위치로
    await visit(env, a, '11100002', near(37.5003, 127.0001));
    assert.equal((await visit(env, a, '11100002', { again: true })).data.error, 'bad_location');
    // 철회: 동의 · 다녀온 곳을 지운다
    const w = await call(env, 'POST', '/api/me/geo', { headers: auth(a), body: { agree: false } });
    assert.equal(w.status, 200);
    assert.equal(w.data.user.geo, null);
    assert.deepEqual(w.data.user.visits, {});
    assert.equal((await visit(env, a, '11100002', near(37.5003, 127.0))).data.error, 'need_geo', '철회 뒤에는 다시 동의해야');
});

test('위치 인증 켠 날: 손 표시 · LottoHex 참여 · 칸 집계를 한 번만 지우고, 그 뒤 인증한 것은 남는다', async () => {
    const env = await fresh();
    const a = await member(env, 'g2', '손표시');
    await visit(env, a, '11100001');
    await visit(env, a, '11100002');
    assert.equal((await join(env, a)).status, 200);
    assert.ok((await terr(env)).data.cells['0,0'], '켜기 전에는 손 표시로 칸을 차지');
    env.GPS_VERIFY = 'on';
    const t = await terr(env, a);
    assert.equal(t.data.cells['0,0'], undefined, '켜면 칸이 모두 회색지대');
    assert.equal(t.data.me.joined, false, 'LottoHex 는 2판으로 다시 참여');
    const me = (await call(env, 'GET', '/api/me', { headers: auth(a) })).data.user;
    assert.deepEqual(me.visits, {}, '손 표시는 지운다');
    assert.equal(me.terr, null);
    assert.ok(env.COMMUNITY._m.get('gpsStart') > 0);
    // 그 뒤 인증한 것은 다시 지우지 않는다
    await geoAgree(env, a);
    assert.equal((await visit(env, a, '11100001', near(37.5, 127.0))).status, 200);
    assert.equal((await join(env, a, { agree: true, v: 1 })).status, 400, '1판 동의는 받지 않는다');
    assert.equal((await join(env, a, { agree: true, v: 2 })).status, 200);
    env.COMMUNITY.restart();
    const t2 = await terr(env, a);
    assert.ok(t2.data.cells['0,0'], '인증한 방문으로 칸을 차지');
    assert.deepEqual(Object.keys((await call(env, 'GET', '/api/me', { headers: auth(a) })).data.user.visits), ['11100001']);
});

test('위치 판정은 하루 100번까지 · 확인자료는 6개월 지난 것부터 지운다', async () => {
    const env = await fresh();
    env.GPS_VERIFY = 'on';
    const a = await member(env, 'g3', '많이눌러');
    await geoAgree(env, a);
    const key = [...env.COMMUNITY._m.keys()].find(k => k.startsWith('u:') && env.COMMUNITY._m.get(k).nick === '많이눌러');
    const u = env.COMMUNITY._m.get(key);
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    env.COMMUNITY._m.set(key, Object.assign(u, { gtry: { day: today, n: 100 } }));
    env.COMMUNITY.restart();
    const r = await visit(env, a, '11100001', near(37.5, 127.0));
    assert.equal(r.status, 429);
    assert.equal(r.data.error, 'too_many_tries');
    // 오래된 확인자료(200일 전)는 지우고 최근 것은 남긴다
    const now = Date.now();
    const day = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
    env.COMMUNITY._m.set('gl:' + day(now - 200 * 86400e3) + ':a:1', { u: 'x', t: now - 200 * 86400e3, id: '11100001', ok: true, why: null });
    env.COMMUNITY._m.set('gl:' + day(now - 10 * 86400e3) + ':b:1', { u: 'x', t: now - 10 * 86400e3, id: '11100001', ok: true, why: null });
    const h = await community(env, 'geoHousekeep', { now, gps: true });
    assert.equal(h.pruned, 1);
    assert.equal(glRows(env).length, 1);
});

test('위치 인증 포인트: 한 번에 10P · 같은 곳은 하루 한 번(지웠다 다시 해도) · 하루 50P까지 · 다음 날 또 다녀왔어요도 10P · 꺼져 있으면 없다', async () => {
    let now = kstTime(2026, 11, 20, 12, 0);
    Date.now = () => now;
    try {
        const env = await fresh();
        env.GPS_VERIFY = 'on';
        const a = await member(env, 'p1', '포인트맨');
        await geoAgree(env, a);
        const go = (id, extra) => visit(env, a, id, Object.assign(near(...GEO.stores[id]), extra || {}));
        let r = await go('11100001');
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(r.data.earned, 10);
        assert.equal(r.data.score.verified, 1);
        // 지웠다가 다시 표시해도 같은 날 같은 곳은 포인트 없음
        assert.equal((await visit(env, a, '11100001', { color: null })).status, 200);
        r = await go('11100001');
        assert.equal(r.status, 200);
        assert.equal(r.data.earned, 0, '같은 곳은 하루 한 번');
        for (const id of ['11100002', '11100003', '11100004', '11100005']) assert.equal((await go(id)).data.earned, 10, id);
        r = await go('11100006');
        assert.equal(r.status, 200, '포인트가 다 차도 다녀온 곳은 저장');
        assert.equal(r.data.earned, 0, '하루 50P 까지');
        assert.equal(r.data.score.verified, 5);
        // 다음 날: "또 다녀왔어요"도 위치로 인증하면 10P
        now = kstTime(2026, 11, 21, 12, 0);
        r = await go('11100002', { again: true });
        assert.equal(r.data.earned, 10);
        const sc = (await call(env, 'GET', '/api/me', { headers: auth(a) })).data.user.score;
        assert.equal(sc.verified, 6);
        assert.equal(sc.ms, 30, '마일스톤: 판매점 1곳 · 3곳(10 + 10) + 칸 3개(10)');
        assert.equal(sc.total, sc.days * 10 + 60 + 30, '인증 6번 = 60점 + 마일스톤 30점');
        // 위치 인증이 꺼져 있으면(손 표시) 포인트 없음
        const off = await fresh();
        const b = await member(off, 'p2', '손표시만');
        r = await visit(off, b, '11100001');
        assert.equal(r.status, 200);
        assert.equal(r.data.earned, 0);
        assert.equal(r.data.score.verified, 0);
    } finally { Date.now = realNow; }
});

test('LottoHex 분기 보상: 확정 순위 1위 1,000 · 2위 500 … 운영자는 빼고, 예약이 다시 돌아도 두 번 주지 않는다', async () => {
    let now = kstTime(2026, 12, 31, 22, 0);
    Date.now = () => now;
    try {
        const env = await fresh();
        const m = env.COMMUNITY._m;
        const a = await member(env, '5001', '일등');
        const b = await member(env, '5002', '이등');
        const c = await member(env, '5003', '운영');
        for (const s of [a, b, c]) assert.equal((await join(env, s)).status, 200);
        await visit(env, a, '11100001');
        await visit(env, a, '11100004');   // 일등: 칸 2개
        await visit(env, b, '11100005');   // 이등: 칸 1개(판매점 1)
        await visit(env, c, '11100002');
        await visit(env, c, '11100003');   // 운영: 0,0 칸에서 2곳 — 일등(1곳)에게서 빼앗는다
        const key = nick => [...m.keys()].find(k => k.startsWith('u:') && m.get(k).nick === nick);
        const st = m.get(key('운영')); st.staff = true; m.set(key('운영'), st);
        env.COMMUNITY.restart();
        now = kstTime(2027, 1, 1, 0, 17);
        const fin = () => env.COMMUNITY.get().fetch('https://community/', { method: 'POST', body: JSON.stringify({ op: 'terrFinalize', now }) }).then(r => r.json());
        const f1 = await fin();
        const rec = m.get('ts:2026Q4');
        assert.ok(rec.paid);
        const order = rec.rank.map(r => r.nick);
        const pts = nick => (m.get(key(nick)).trw || { pts: 0 }).pts;
        const want = { 일등: 0, 이등: 0, 운영: 0 };
        order.forEach((n, i) => { if (n !== '운영' && i < 10) want[n] = [1000, 500, 300, 100][Math.min(i, 3)]; });
        assert.deepEqual({ 일등: pts('일등'), 이등: pts('이등'), 운영: pts('운영') }, want, '순위대로 · 운영자 제외 (' + order.join(',') + ')');
        assert.equal(f1.paid, Object.values(want).filter(Boolean).length);
        assert.equal(m.get(key(order.find(n => n !== '운영'))).trw.s['2026Q4'], want[order.find(n => n !== '운영')]);
        // 다시 돌아도(끝까지 줬든 중간에 끊겼든) 두 번 주지 않는다
        await fin();
        rec.paid = false; m.set('ts:2026Q4', rec); env.COMMUNITY.restart();
        const f3 = await fin();
        assert.equal(f3.paid, 0);
        assert.deepEqual({ 일등: pts('일등'), 이등: pts('이등'), 운영: pts('운영') }, want);
        const sc = (await call(env, 'GET', '/api/me', { headers: auth(order[0] === '운영' ? b : (order[0] === '일등' ? a : b)) })).data.user.score;
        assert.ok(sc.hex > 0 && sc.total >= sc.hex, '점수 · 쓸 수 있는 포인트에 들어간다');
    } finally { Date.now = realNow; }
});

test('LottoHex 점령 점수(2026-11-12): 한국 날짜가 바뀐 뒤 처음 한 번, 차지한 칸 하나에 0.1점 · 운영자 빼고 · 같은 날 두 번 주지 않는다(중간에 끊겨도) · 점수 · 랭킹에 들어간다', async () => {
    let now = kstTime(2026, 12, 10, 22, 0);
    Date.now = () => now;
    try {
        const env = await fresh();
        const m = env.COMMUNITY._m;
        const a = await member(env, '5101', '칸부자');
        const b = await member(env, '5102', '칸하나');
        const c = await member(env, '5103', '운영');
        for (const s of [a, b, c]) assert.equal((await join(env, s)).status, 200);
        await visit(env, a, '11100001');
        await visit(env, a, '11100004');   // 칸부자: 0,0 · 1,0
        await visit(env, b, '11100005');   // 칸하나: 2,0
        now += 60 * 1000;
        await visit(env, c, '11100006');   // 운영: 2,0 에 1곳(같은 수, 1분 더 최근) — 칸하나에게서 빼앗는다
        const key = nick => [...m.keys()].find(k => k.startsWith('u:') && m.get(k).nick === nick);
        const st = m.get(key('운영')); st.staff = true; m.set(key('운영'), st);
        env.COMMUNITY.restart();
        const pay = () => env.COMMUNITY.get().fetch('https://community/', { method: 'POST', body: JSON.stringify({ op: 'terrHoldPay', now }) }).then(r => r.json());
        const hold = nick => (m.get(key(nick)).thp || { pts: 0 }).pts;
        now = kstTime(2026, 12, 11, 0, 17);
        const p1 = await pay();
        assert.deepEqual([p1.done, p1.day, p1.paid, p1.pts], [true, '2026-12-11', 1, 0.2]);
        assert.deepEqual([hold('칸부자'), hold('칸하나'), hold('운영')], [0.2, 0, 0], '칸 2개 = 0.2 · 칸을 빼앗긴 사람 0 · 운영자 0');
        assert.equal(m.get(key('칸부자')).thp.n, 2);
        // 같은 날 다시 돌아도(끝까지 줬든 중간에 끊겼든) 두 번 주지 않는다
        now = kstTime(2026, 12, 11, 1, 17);
        assert.equal((await pay()).done, false);
        m.delete('thd'); env.COMMUNITY.restart();
        assert.equal((await pay()).paid, 0);
        assert.equal(hold('칸부자'), 0.2);
        // 다음 날 · 그다음 날: 0.1 이 쌓여도 소수 첫째 자리로
        assert.equal((await visit(env, b, '11100005', { again: true })).status, 200);   // 칸하나가 다음 날 또 다녀와 2,0 을 되찾는다(1곳씩, 더 최근)
        now = kstTime(2026, 12, 12, 0, 17);
        await pay();
        now = kstTime(2026, 12, 13, 0, 17);
        await pay();
        assert.deepEqual([hold('칸부자'), hold('칸하나'), hold('운영')], [0.6, 0.2, 0]);
        const sc = (await call(env, 'GET', '/api/me', { headers: auth(a) })).data.user.score;
        assert.equal(sc.hold, 0.6);
        assert.ok(sc.total >= 0.6 && sc.avail >= 0.6, '점수 · 쓸 수 있는 포인트에 들어간다');
        const rk = (await call(env, 'GET', '/api/ranking', { headers: auth(a) })).data;
        assert.equal(rk.me.hold, 0.6);
        assert.equal(rk.points.terrHold, 0.1);
    } finally { Date.now = realNow; }
});

/* ───── 마일스톤 · 칭호(2026-11-09 — src/titles.js) ───── */

const line = (n, q0 = 0, r0 = 0) => Array.from({ length: n }, (_, i) => (q0 + i) + ',' + r0);
const hexRing = c => { const [q, r] = c.split(',').map(Number); return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(([a, b]) => (q + a) + ',' + (r + b)); };

test('칸 모양: 삼각지 · 한 줄 · 벌집 · 도넛 · 섬나라 · 지렁이(가지 없이 이어짐)', () => {
    assert.deepEqual(shapeTitles([]), []);
    assert.ok(shapeTitles(['0,0', '1,0', '0,1']).includes('tri'), '세 칸이 서로 맞닿음');
    assert.ok(!shapeTitles(line(3)).includes('tri'), '한 줄 세 칸은 삼각지가 아니다');
    const l5 = shapeTitles(line(5));
    assert.ok(l5.includes('line5') && !l5.includes('line8') && l5.includes('worm4'), '다섯 칸 한 줄 = 일자 진격 + 꼬마지렁이');
    assert.ok(shapeTitles(line(8)).includes('line8'));
    assert.ok(shapeTitles(['0,0', '0,1', '0,2', '0,3', '0,4']).includes('line5'), '다른 축도');
    const hive = ['0,0'].concat(hexRing('0,0'));
    const h = shapeTitles(hive);
    assert.ok(h.includes('hive') && !h.includes('donut'), '가운데 + 둘레 6칸 = 벌집');
    assert.ok(!h.includes('worm7'), '벌집 안에는 가지 없는 7칸 줄이 없다(가운데가 둘레 모두에 닿는다)');
    const d = shapeTitles(hexRing('0,0'));
    assert.ok(d.includes('donut') && !d.includes('hive'), '둘레만 = 도넛');
    // 섬나라: 떨어진 묶음 5개
    const isles = ['0,0', '3,0', '6,0', '9,0', '12,0'];
    assert.ok(shapeTitles(isles).includes('isles'));
    assert.ok(!shapeTitles(isles.slice(0, 4)).includes('isles'));
    // 왕지렁이: 꺾여도 가지 없이 7칸 — 지그재그
    const zig = ['0,0', '1,0', '1,1', '2,1', '2,2', '3,2', '3,3'];
    assert.ok(inducedPath(new Set(zig), 7), JSON.stringify(shapeTitles(zig)));
    assert.ok(shapeTitles(zig).includes('worm7'));
    // 자기 몸에 닿으면(고리 · 덩어리) 7칸 지렁이가 아니다
    assert.ok(!inducedPath(new Set(['0,0', '1,0', '2,0', '2,1', '1,2', '0,2', '0,1']), 7), '둘레를 도는 7칸은 처음과 끝이 닿는다');
    assert.ok(shapeTitles(line(12)).includes('worm12'));
    assert.ok(!shapeTitles(line(11)).includes('worm12'));
    // 이미 얻은 것은 건너뛴다
    assert.ok(!shapeTitles(line(5), new Set(['line5'])).includes('line5'));
});

test('마일스톤 · 칭호 셈: 단계 포인트는 한 번 · 지역(시·군·구 10 · 20 · 50곳) · 시·도 완주 · 팔도유람 · 골목대장 · 섬 · 휴게소', () => {
    const regions = [['서울', '마포구', '마포구'], ['서울', '중구', '서울 중구'], ['제주', '제주시', '제주시'], ['제주', '서귀포시', '서귀포시']];
    const geo = new Map(), cellOf = new Map(), user = { visits: {} };
    const add = (id, ri, cell, flag) => { geo.set(id, [37, 127, ri].concat(flag ? [flag] : [])); cellOf.set(id, cell); user.visits[id] = '#e63946'; };
    for (let i = 0; i < 20; i++) add('m' + i, 0, i < 10 ? '0,0' : '1,0');   // 마포구 20곳(한 칸에 10곳)
    let r = evaluate(user, { cellOf, geo, regions, held: null, now: 1 });
    assert.ok(['v3', 'v10', 'r:마포구:0', 'r:마포구:1', 'dense'].every(id => r.titles.includes(id)), JSON.stringify(r.titles));
    assert.ok(!r.titles.includes('r:마포구:2') && !r.titles.includes('t1'), '50곳 전 · LottoHex 참여 전에는 영토 칭호 없음');
    assert.deepEqual(user.ach, { v: 3 }, '판매점 1 · 3 · 10곳(20곳은 30 전), 칸 2개 · 시·도 1곳은 첫 단계 전');
    assert.equal(r.pts, 10 + 10 + 20);
    assert.equal(milestonePoints(user.ach), 40);
    // 같은 상태로 다시 세면 새것 없음(포인트 두 번 없음)
    r = evaluate(user, { cellOf, geo, regions, held: null, now: 2 });
    assert.deepEqual([r.titles, r.pts], [[], 0]);
    // 지운 뒤 다시 표시해도 단계는 그대로(포인트 다시 없음)
    const keep = user.visits; user.visits = {};
    assert.equal(evaluate(user, { cellOf, geo, regions, held: null }).pts, 0);
    user.visits = keep;
    // 제주 두 시를 다녀오면 제주 완주 · 시·도 2곳
    add('j1', 2, '9,9'); add('j2', 3, '9,8', 1); add('h1', 0, '5,5', 2);
    r = evaluate(user, { cellOf, geo, regions, held: ['0,0'], now: 3 });
    assert.ok(['s:제주', 'island', 'rest', 't1'].every(id => r.titles.includes(id)), JSON.stringify(r.titles));
    assert.ok(!r.titles.includes('s:서울'), '서울은 중구를 안 가 봄');
    assert.equal(user.ach.s, 1, '시·도 2곳');
    assert.equal(user.ach.t, 1, '영토 1칸');
    assert.deepEqual(titleName('r:서울 중구:1'), ['서울 중구 전문가', '서울 중구 Expert']);
    assert.deepEqual(titleName('s:제주'), ['제주 완주', '제주 Complete']);
    assert.deepEqual(titleName('worm7'), ['왕지렁이', 'Giant Worm']);
    assert.equal(titleName('nope'), null);
    // 화면 목록: 숨은 칭호는 이름 · 조건을 내보내지 않는다
    const cat = catalog();
    const hidden = cat.titles.filter(t => t.g === 'hidden');
    assert.ok(hidden.length >= 3 && hidden.every(t => !t.ko && !t.d));
    assert.equal(cat.milestones, MILESTONES);
});

test('칭호 API: 위치로 인증하면 바로 알림(마일스톤 · 칭호 · 개척자) · 얻은 칭호만 달고 칸 · 랭킹에 보인다 · 철회하면 칭호는 지우고 포인트는 남는다', async () => {
    const env = await fresh();
    env.GPS_VERIFY = 'on';
    // 한 줄로 놓인 칸 8개, 칸마다 판매점 하나 — 모두 마포구
    const ids = Array.from({ length: 8 }, (_, i) => '1110010' + i);
    site = {
        cells: { r: 0.6, cells: Object.fromEntries(ids.map((id, i) => [i + ',0', [id]])) },
        geo: { regions: [['서울', '마포구', '마포구']], stores: Object.fromEntries(ids.map((id, i) => [id, [37.5 + i * 0.01, 127.0, 0]])) },
    };
    const a = await member(env, 't1', '지렁이');
    const b = await member(env, 't2', '구경꾼');
    await terr(env);   // 위치 인증을 켠 날 한 번 지우기를 먼저 지나게
    await geoAgree(env, a);
    assert.equal((await join(env, a, { agree: true, v: 2 })).status, 200);
    const go = (s, i) => visit(env, s, ids[i], near(37.5 + i * 0.01, 127.0));
    let r = await go(a, 0);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const got = x => (x.data.fresh ? x.data.fresh.titles.map(t => t.id) : []);
    assert.deepEqual(got(r).sort(), ['pioneer', 't1'].sort(), '첫 칸 · 아무도 안 간 칸');
    assert.equal(r.data.fresh.pts, 10 + 10, '판매점 1곳 + 영토 1칸');
    assert.equal(r.data.score.ms, 20);
    assert.deepEqual(r.data.fresh.titles.find(t => t.id === 'pioneer'), { id: 'pioneer', ko: '개척자', en: 'Pioneer' });
    for (let i = 1; i < 7; i++) r = await go(a, i);
    const me = (await call(env, 'GET', '/api/me', { headers: auth(a) })).data.user;
    const mine = me.titles.e.map(t => t.id);
    assert.ok(['t1', 't5', 'v3', 'line5', 'worm4', 'worm7', 'pioneer'].every(id => mine.includes(id)), JSON.stringify(mine));
    assert.ok(!mine.includes('line8'), '7칸 한 줄은 고속도로 전');
    assert.equal(me.ach.v, 2, '판매점 7곳: 1 · 3곳 두 단계(10곳 전)');
    // 아직 못 얻은 칭호는 못 단다
    assert.equal((await call(env, 'POST', '/api/me/title', { headers: auth(a), body: { id: 'line8' } })).status, 409);
    const set = await call(env, 'POST', '/api/me/title', { headers: auth(a), body: { id: 'worm7' } });
    assert.equal(set.status, 200);
    assert.equal(set.data.user.titles.sel, 'worm7');
    // 칸 · Map 랭킹(누구나)에 단 칭호
    const t = await terr(env);
    assert.deepEqual(t.data.rank[0].tt, ['왕지렁이', 'Giant Worm']);
    assert.deepEqual(t.data.full['0,0'][5], ['왕지렁이', 'Giant Worm']);
    // 사이트 랭킹에도
    const rk = await call(env, 'GET', '/api/ranking', { headers: auth(b) });
    assert.deepEqual(rk.data.top.find(x => x.nick === '지렁이').tt, ['왕지렁이', 'Giant Worm']);
    // 떼기
    assert.equal((await call(env, 'POST', '/api/me/title', { headers: auth(a), body: { id: null } })).data.user.titles.sel, null);
    assert.equal((await terr(env)).data.rank[0].tt, null);
    // 8칸째: LottoHex 를 열 때도 셈한다(고속도로)
    await call(env, 'POST', '/api/me/title', { headers: auth(a), body: { id: 'worm7' } });
    r = await go(a, 7);
    assert.ok(got(r).includes('line8'));
    // 철회: 칭호는 지우고(단 칭호도 칸 · 랭킹에서 빠짐), 마일스톤 포인트는 남는다
    const before = (await call(env, 'GET', '/api/me', { headers: auth(a) })).data.user.score.ms;
    assert.ok(before >= 50);
    const w = await call(env, 'POST', '/api/me/geo', { headers: auth(a), body: { agree: false } });
    assert.deepEqual(w.data.user.titles, { e: [], sel: null });
    assert.equal(w.data.user.score.ms, before, '받은 포인트는 그대로');
    const rk2 = await call(env, 'GET', '/api/ranking', { headers: auth(b) });
    assert.equal(rk2.data.top.find(x => x.nick === '지렁이').tt, undefined);
    // 다시 동의하고 인증해도 같은 단계 포인트는 다시 없다
    await geoAgree(env, a);
    r = await go(a, 0);
    assert.equal(r.data.fresh.pts, 0, '단계 포인트는 한 번');
    assert.ok(got(r).includes('t1'), '칭호는 다시 얻을 수 있다');
});

test('LottoHex 소식: 위치로 인증해 칸 주인이 되면 띠 · 채팅에 "○○님이 N번째 블록을 점령" · 빼앗으면 "△△님의 블록을 빼앗았습니다"(어느 칸 · 지역 · 판매점은 없다) · 이미 내 칸이거나 못 빼앗으면 없다 · 공지는 관리자만', async () => {
    const env = await fresh();
    env.GPS_VERIFY = 'on';
    const posted = [];
    env.CHAT = { idFromName: n => n, get: () => ({ fetch: async (url, init) => { posted.push([String(url), JSON.parse(init.body)]); return new Response('{"ok":true}'); } }) };
    const ids = ['11100201', '11100202', '11100203'];
    site = {
        cells: { r: 0.6, cells: { '0,0': [ids[0]], '1,0': [ids[1], ids[2]] } },
        geo: { regions: [['서울', '마포구', '마포구']], stores: { [ids[0]]: [37.5, 127.0, 0], [ids[1]]: [37.51, 127.0, 0], [ids[2]]: [37.5103, 127.0, 0] } },
    };
    const a = await member(env, 'f1', '가나다');
    const b = await member(env, 'f2', '라마바');
    await terr(env);
    for (const s of [a, b]) { await geoAgree(env, s); assert.equal((await join(env, s, { agree: true, v: 2 })).status, 200); }
    const go = (s, i) => visit(env, s, ids[i], near(site.geo.stores[ids[i]][0], 127.0));
    let r = await go(a, 0);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.cap.nick, r.data.cap.n], ['가나다', 1], '첫 블록');
    r = await go(a, 1);
    assert.equal(r.data.cap.n, 2, '두 번째 블록');
    r = await go(a, 2);
    assert.equal(r.data.cap, null, '이미 내 칸');
    r = await go(b, 1);
    assert.equal(r.data.cap, null, '1 : 2 — 못 빼앗음');
    r = await go(b, 2);
    assert.deepEqual(r.data.cap, Object.assign({}, r.data.cap, { nick: '라마바', n: 1, st: 1, from: '가나다' }), '2 : 2 면 더 최근 — 가나다의 칸을 빼앗음');
    assert.equal(r.data.cap.from, '가나다');
    const f = await call(env, 'GET', '/api/territory/feed');
    assert.equal(f.status, 200);
    assert.equal(f.headers.get('Cache-Control'), 'public, max-age=30');
    assert.deepEqual(f.data.feed.map(e => [e.nick, e.n, e.st || 0, e.from || null]), [['라마바', 1, 1, '가나다'], ['가나다', 2, 0, null], ['가나다', 1, 0, null]], '최근 것부터 · 빼앗은 것은 st · from');
    assert.ok(!/0,0|1,0|1110020|마포|37\.5/.test(JSON.stringify(f.data)), '어느 칸 · 판매점 · 지역인지는 없다');
    assert.equal(f.data.notice, null);
    assert.deepEqual(posted.map(p => p[0]), Array(3).fill('https://chat/system'), '채팅에도 세 번');
    assert.deepEqual(posted.map(p => p[1].kind), ['cap', 'cap', 'cap']);
    assert.equal(posted[0][1].text, '🚩 가나다님이 1번째 블록을 점령했습니다');
    assert.equal(posted[2][1].text, '⚔️ 라마바님이 가나다님의 블록을 빼앗았습니다 (1번째 블록)');
    // 공지: 관리자만 · 80자 · 시간 지나면 내려감 · 빈 글이면 내림
    assert.equal((await call(env, 'POST', '/api/admin/hex-notice', { headers: auth(a), body: { text: '안녕' } })).status, 401);
    const n = await call(env, 'POST', '/api/admin/hex-notice', { headers: asAdmin, body: { text: '이번 주말 LottoHex 2배 이벤트!', hours: 2 } });
    assert.equal(n.status, 200, JSON.stringify(n.data));
    assert.equal((await call(env, 'GET', '/api/territory/feed')).data.notice.text, '이번 주말 LottoHex 2배 이벤트!');
    const realNow2 = Date.now;
    Date.now = () => realNow2() + 3 * 3600 * 1000;
    assert.equal((await call(env, 'GET', '/api/territory/feed')).data.notice, null, '2시간 지나면 내려감');
    Date.now = realNow2;
    await call(env, 'POST', '/api/admin/hex-notice', { headers: asAdmin, body: { text: '다시' } });
    assert.equal((await call(env, 'POST', '/api/admin/hex-notice', { headers: asAdmin, body: { text: '' } })).data.notice, null);
    assert.equal((await call(env, 'GET', '/api/territory/feed')).data.notice, null);
});

test('칭호: 위치 인증이 꺼져 있으면 셈하지 않는다 · 목록은 누구나', async () => {
    const env = await fresh();
    const a = await member(env, 't3', '손표시');
    const r = await visit(env, a, '11100001');
    assert.equal(r.status, 200);
    assert.equal(r.data.fresh, null);
    const me = (await call(env, 'GET', '/api/me', { headers: auth(a) })).data.user;
    assert.deepEqual([me.titles, me.ach], [{ e: [], sel: null }, {}]);
    const cat = await call(env, 'GET', '/api/titles');
    assert.equal(cat.status, 200);
    assert.ok(cat.data.titles.some(t => t.id === 'worm7' && t.ko === '왕지렁이'));
    assert.match(cat.headers.get('Cache-Control'), /max-age=3600/);
});

test('광고 유입(utm, 2026-11-11): 들어옴은 우리 사이트 · 이름 규칙 · 로봇 빼고 한국 날짜 줄에, 가입 · LottoHex 참여 · 첫 위치 인증은 그 캠페인으로 새로 가입한 회원만 한 번씩, 관리자만 본다', async () => {
    const env = await fresh();
    env.GPS_VERIFY = 'on';
    const ids = ['11100301', '11100302'];
    site = { cells: { r: 0.6, cells: { '0,0': [ids[0]], '1,0': [ids[1]] } }, geo: { regions: [['서울', '마포구', '마포구']], stores: { [ids[0]]: [37.5, 127.0, 0], [ids[1]]: [37.51, 127.0, 0] } } };
    const arrive = (body, origin = ORIGIN, ua) => worker.fetch(new Request('https://api.lottodraw.kr/api/arrive', {
        method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain;charset=UTF-8' }, origin ? { Origin: origin } : {}, ua ? { 'User-Agent': ua } : {}), body: JSON.stringify(body),
    }), env, ctx);
    const AD = { s: 'Google', m: 'display', c: 'lottohex_test1' };
    const KEY = 'google|display|lottohex_test1';
    assert.equal((await arrive(AD)).status, 204, '대문자는 소문자로');
    assert.equal((await arrive(AD)).status, 204);
    assert.equal((await arrive({ s: 'naver' })).status, 204, '종류 · 캠페인이 없으면 -');
    assert.equal((await arrive(AD, ORIGIN, 'Mozilla/5.0 (compatible; Googlebot/2.1)')).status, 204, '로봇은 받기만 하고 세지 않는다');
    assert.equal((await arrive({ s: '' })).status, 400);
    assert.equal((await arrive({ s: '<b>x</b>', c: 'a' })).status, 400, '이름 규칙');
    assert.equal((await arrive(AD, 'https://evil.example')).status, 403, '다른 사이트');
    assert.equal((await arrive(AD, null)).status, 403, 'Origin 없음');

    // 그 캠페인으로 새로 가입 → 가입(g). 같은 계정이 다시 로그인하며 보내도 다시 세지 않는다. 캠페인 없이 가입한 회원은 어디에도 안 센다
    const signup = (sub, ad) => call(env, 'POST', '/api/auth/google', { body: { credential: await0(sub), ad } });
    const await0 = sub => tokens[sub];
    const tokens = { ad1: await idToken({ sub: 'ad1', email: 'ad1@gmail.com' }), ad3: await idToken({ sub: 'ad3', email: 'ad3@gmail.com' }) };
    let r = await signup('ad1', AD);
    assert.equal(r.status, 200);
    assert.equal(r.data.isNew, true);
    const a = r.data.session;
    assert.equal((await signup('ad1', AD)).data.isNew, false);
    r = await signup('ad3', { s: 'google', c: '광고 시험' });
    assert.equal(r.status, 200, '캠페인 이름이 틀려도 가입은 된다');
    assert.deepEqual([env.COMMUNITY._m.get('u:ad3').ad && env.COMMUNITY._m.get('u:ad3').ad.c], ['-'], '틀린 이름은 - 로');
    const b = await member(env, 'ad2', '보통회원');
    assert.equal(env.COMMUNITY._m.get('u:ad2').ad, undefined);
    assert.deepEqual(Object.keys(env.COMMUNITY._m.get('u:ad1').ad).sort(), ['at', 'c', 'm', 's'], '회원 정보에는 캠페인 이름과 가입 시각만');

    // LottoHex 참여(h) · 첫 위치 인증(v): 광고로 가입한 회원만, 한 번씩(그만뒀다 다시 들어와도 · 두 번째 인증도 세지 않는다)
    assert.equal((await call(env, 'POST', '/api/me/nickname', { headers: auth(a), body: { nickname: '광고손님' } })).status, 200);
    for (const s of [a, b]) { await geoAgree(env, s); assert.equal((await join(env, s, { agree: true, v: 2 })).status, 200); }
    assert.equal((await call(env, 'POST', '/api/territory/leave', { headers: auth(a) })).status, 200);
    assert.equal((await join(env, a, { agree: true, v: 2 })).status, 200);
    for (const s of [a, b]) for (const id of ids) assert.equal((await visit(env, s, id, near(site.geo.stores[id][0], 127.0))).status, 200);

    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    assert.equal((await call(env, 'GET', '/api/admin/inflow')).status, 401);
    assert.equal((await call(env, 'GET', '/api/admin/inflow', { headers: auth(a) })).status, 401, '회원도 못 본다');
    const st = await call(env, 'GET', '/api/admin/inflow', { headers: asAdmin });
    assert.equal(st.status, 200);
    assert.deepEqual(st.data.days, [{ day: today, rows: { [KEY]: { l: 2, g: 1, h: 1, v: 1 }, 'naver|-|-': { l: 1 }, 'google|-|-': { g: 1 } } }]);
    assert.ok(!JSON.stringify(st.data).includes('ad1') && !JSON.stringify(env.COMMUNITY._m.get('ad:' + today)).includes('ad1'), '누가 했는지는 집계에 없다');

    // 탈퇴하면 회원 정보의 가입 경로도 같이 지워진다(집계 숫자는 남는다)
    assert.equal((await call(env, 'POST', '/api/me/delete', { headers: auth(a), body: { confirm: true } })).status, 200);
    assert.equal(env.COMMUNITY._m.get('u:ad1'), undefined);
    assert.equal(env.COMMUNITY._m.get('ad:' + today)[KEY].g, 1);

    // 하루 캠페인 줄 수 한도(아무 이름이나 보내 부풀리지 못하게)
    for (let i = 0; i < 120; i++) await arrive({ s: 'spam' + i });
    assert.ok(Object.keys(env.COMMUNITY._m.get('ad:' + today)).length <= 100);
    assert.equal(env.COMMUNITY._m.get('ad:' + today)[KEY].l, 2, '이미 있던 줄은 계속 센다');
});

test('LottoHex 칸 알림 메일(2026-11-12): 처음엔 지난번 칸만 적고, 다음 날 저녁 칸을 잃은 참여자에게 하루 한 번 — 처음부터 켜짐 · 알림 끄기 링크 · 스위치, 칸 위치는 안 넣음', async () => {
    const env = await fresh();
    env.GPS_VERIFY = 'on';
    env.RESEND_API_KEY = 're_test';
    env.MAIL_FROM = 'lottodraw.kr <key@lottodraw.kr>';
    const sent = [];
    const base = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (String(url) === 'https://api.resend.com/emails/batch') { sent.push(...JSON.parse(init.body)); return new Response('{"data":[]}'); }
        return base(url, init);
    };
    try {
        const ids = ['11100401', '11100402'];
        site = { cells: { r: 0.6, cells: { '0,0': [ids[0]], '1,0': [ids[1]] } }, geo: { regions: [['서울', '마포구', '마포구']], stores: { [ids[0]]: [37.5, 127.0, 0], [ids[1]]: [37.51, 127.0, 0] } } };
        const a = await member(env, 'm1', '가나다');
        const b = await member(env, 'm2', '라마바');
        await terr(env);   // 위치 인증을 켠 날 한 번 지우기(gpsStartOnce)를 참여 전에 끝낸다
        for (const s of [a, b]) { await geoAgree(env, s); assert.equal((await join(env, s, { agree: true, v: 2 })).status, 200); }
        const me = async s => (await call(env, 'GET', '/api/me', { headers: auth(s) })).data.user;
        assert.equal((await me(a)).hexMail, true, '처음부터 켜짐');
        assert.equal((await visit(env, a, ids[0], near(37.5, 127.0))).status, 200);
        assert.equal((await visit(env, a, ids[1], near(37.51, 127.0))).status, 200);
        const day1 = kstTime(2026, 11, 20, 20, 17), day2 = kstTime(2026, 11, 21, 20, 17);
        assert.equal((await hexMail(env, kstTime(2026, 11, 20, 19, 17))).skipped, 'window', '저녁 8시 전에는 안 보냄');
        let r = await hexMail(env, day1);
        assert.equal(r.sent, 0, '첫날은 지난번 칸이 없어 적기만');
        assert.deepEqual(env.COMMUNITY._m.get('hs:m1').cells.sort(), ['0,0', '1,0']);
        assert.equal((await hexMail(env, day1 + 3600e3)).skipped, 'done', '하루 한 번');

        // 라마바가 0,0 을 빼앗는다(같은 수 · 더 최근)
        assert.equal((await visit(env, b, ids[0], near(37.5, 127.0))).status, 200);
        r = await hexMail(env, day2);
        assert.equal(r.sent, 1);
        assert.equal(sent.length, 1);
        const m = sent[0];
        assert.deepEqual(m.to, ['m1@gmail.com']);
        assert.equal(m.subject, 'LottoHex: 오늘 칸 1개를 빼앗겼습니다');
        assert.match(m.text, /가나다님, 오늘 LottoHex 칸 1개를 빼앗겼습니다/);
        assert.match(m.text, /지금 그 칸 주인: 라마바님/);
        assert.match(m.text, /지금 내 칸 1개 · Map 랭킹 \d위/);
        assert.ok(!/0,0|1,0|1110040|마포|37\.5/.test(m.text), '어느 칸 · 판매점 · 지역은 없다');
        assert.match(m.headers['List-Unsubscribe'], /k=hex/);
        assert.equal(env.COMMUNITY._m.get('mday').n, 1, 'Resend 하루 한도에 함께 센다');

        // 알림 끄기 링크: GET 은 확인 단추, POST 로 끔. 결과 메일 서명으로는 못 끈다
        const link = new URL(m.headers['List-Unsubscribe'].slice(1, -1));
        const get = await worker.fetch(new Request(link.toString()), env, ctx);
        assert.match(await get.text(), /LottoHex 블록 알림 메일 수신 거부/);
        const wrong = new URL(link); wrong.searchParams.delete('k');
        await worker.fetch(new Request(wrong.toString(), { method: 'POST' }), env, ctx);
        assert.equal((await me(a)).hexMail, true, '다른 메일 서명으로는 안 꺼짐');
        await worker.fetch(new Request(link.toString(), { method: 'POST' }), env, ctx);
        assert.equal((await me(a)).hexMail, false, '알림 끄기');

        // 꺼 두면 잃어도 안 보냄 · 스위치로 다시 켬
        assert.equal((await visit(env, b, ids[1], near(37.51, 127.0))).status, 200);
        r = await hexMail(env, kstTime(2026, 11, 22, 20, 17));
        assert.equal(r.sent, 0);
        assert.equal((await call(env, 'POST', '/api/me/hex-mail', { headers: auth(a), body: { on: true } })).data.hexMail, true);
        assert.equal((await call(env, 'POST', '/api/me/hex-mail', { body: { on: false } })).status, 401);

        // 그만두거나 탈퇴하면 지난번 칸을 지운다
        assert.equal((await call(env, 'POST', '/api/territory/leave', { headers: auth(b) })).status, 200);
        assert.equal(env.COMMUNITY._m.get('hs:m2'), undefined);
    } finally { globalThis.fetch = base; }
});
