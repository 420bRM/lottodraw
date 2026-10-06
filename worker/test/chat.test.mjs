// 실시간 채팅방: 글자 검사, 로그인·별명·금지·속도 제한, 24시간 휘발, 관리자 지우기·금지.
// WebSocket 은 흉내 낸 소켓으로 방의 webSocketMessage 를 바로 부른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { _resetForTests, Community, ChatRoom } from '../src/index.js';
import { _resetGoogleForTests } from '../src/google.js';
import { checkText, KEEP_MS } from '../src/chat.js';
import { b64urlEncode } from '../src/keys.js';

const ADMIN = 'admin-token-0123456789abcdef';
const ORIGIN = 'https://www.lottodraw.kr';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function memoryStorage() {
    const map = new Map();
    const clone = v => (v === undefined ? undefined : structuredClone(v));
    return {
        _m: map,
        async get(k) {
            if (Array.isArray(k)) { const o = new Map(); k.forEach(x => map.has(x) && o.set(x, clone(map.get(x)))); return o; }
            return clone(map.get(k));
        },
        async put(k, v) { map.set(k, clone(v)); },
        async delete(k) { if (Array.isArray(k)) { k.forEach(x => map.delete(x)); return k.length; } return map.delete(k); },
        async list({ prefix, reverse, limit } = {}) {
            let keys = [...map.keys()].filter(k => k.startsWith(prefix || '')).sort();
            if (reverse) keys.reverse();
            if (limit) keys = keys.slice(0, limit);
            return new Map(keys.map(k => [k, clone(map.get(k))]));
        },
    };
}

function fakeSocket() {
    let att = null;
    return {
        readyState: 1, sent: [],
        send(d) { this.sent.push(JSON.parse(d)); },
        serializeAttachment(v) { att = structuredClone(v); },
        deserializeAttachment() { return structuredClone(att); },
        close() { this.readyState = 3; },
        last(t) { return [...this.sent].reverse().find(m => !t || m.t === t); },
    };
}

function setup() {
    _resetForTests();
    _resetGoogleForTests();
    const env = { DB: null, GOOGLE_CLIENT_ID: CLIENT_ID, SITE_URL: ORIGIN, ALLOWED_ORIGINS: ORIGIN, ADMIN_TOKEN: ADMIN };
    const kv = new Map();
    env.DB = {
        async get(k, t) { const e = kv.get(k); if (!e) return null; return t === 'json' ? JSON.parse(e.value) : e.value; },
        async put(k, v, o) { kv.set(k, { value: String(v), metadata: o && o.metadata }); },
        async delete(k) { kv.delete(k); },
        async list({ prefix }) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).sort().map(name => ({ name, metadata: kv.get(name).metadata })), list_complete: true }; },
    };
    const cInst = new Community({ storage: memoryStorage() });
    env.COMMUNITY = { idFromName: n => n, get: () => ({ fetch: (u, i) => cInst.fetch(new Request(u, i)) }) };
    const sockets = [];
    const room = new ChatRoom({ storage: memoryStorage(), getWebSockets: () => sockets.filter(s => s.readyState === 1), acceptWebSocket: ws => sockets.push(ws) }, env);
    env.CHAT = { idFromName: n => n, get: () => ({ fetch: (u, i) => room.fetch(new Request(u, i)) }) };
    const join = () => { const ws = fakeSocket(); sockets.push(ws); ws.serializeAttachment({}); return ws; };
    return { env, room, join };
}

const call = async (env, method, path, { body, headers } = {}) => {
    const h = Object.assign({ Origin: ORIGIN }, headers || {});
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await worker.fetch(new Request('https://api.lottodraw.kr' + path, { method, headers: h, body: payload }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json().catch(() => null) };
};
const asAdmin = { Authorization: 'Bearer ' + ADMIN };

// 가짜 구글로 로그인해 세션을 얻는다
const enc = o => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => String(u).startsWith('https://www.googleapis.com/oauth2/v3/certs')
    ? new Response(JSON.stringify({ keys: [{ kty: 'RSA', n: pubJwk.n, e: pubJwk.e, kid: 'k1', alg: 'RS256' }] }))
    : String(u).startsWith('https://api.telegram.org/') ? new Response('{}') : realFetch(u, i);
test.after(() => { globalThis.fetch = realFetch; });
async function member(env, sub, nick) {
    const now = Math.floor(Date.now() / 1000);
    const h = enc({ alg: 'RS256', kid: 'k1' }), b = enc({ iss: 'accounts.google.com', aud: CLIENT_ID, sub, email: sub + '@gmail.com', email_verified: true, iat: now, exp: now + 600 });
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(h + '.' + b)));
    await call(env, 'POST', '/api/admin/setup-key', { headers: asAdmin });
    const s = (await call(env, 'POST', '/api/auth/google', { body: { credential: h + '.' + b + '.' + b64urlEncode(sig) } })).data.session;
    if (nick) await call(env, 'POST', '/api/me/nickname', { body: { nickname: nick }, headers: { Authorization: 'Bearer ' + s } });
    return s;
}
const send = (room, ws, obj) => room.webSocketMessage(ws, JSON.stringify(obj));

test('글자 검사: 링크·도메인·연락처·메신저·홍보 문구는 막고, 보통 말은 통과', () => {
    assert.deepEqual(checkText('  이번 주 1등 몇 명일까요  '), { text: '이번 주 1등 몇 명일까요' });
    assert.equal(checkText('').error, 'empty');
    assert.equal(checkText('a'.repeat(201)).error, 'too_long');
    for (const bad of ['https://x.io', 'www.abc', '번호방 lotto123.com 오세요', 'open.kakao.com/o/abc', '오픈카톡 오세요', '텔레그램 @abc', '010-1234-5678', '01012345678', '리딩방 무료', '적중률 90%', '토토 사이트']) {
        assert.ok(checkText(bad).error, bad);
    }
    assert.equal(checkText('34번 또 나왔네요 ㅋㅋ').error, undefined);
});

test('채팅: 읽기는 누구나, 쓰기는 로그인+별명, 3초에 한 번, 모두에게 전달', async () => {
    const { env, room, join } = setup();
    const guest = join();
    const a = join();
    const sA = await member(env, 'A', '행운의곰');
    const sB = await member(env, 'B');   // 별명 없음
    const b = join();

    await send(room, guest, { t: 'say', text: '안녕' });
    assert.equal(guest.last('err').code, 'need_login');

    await send(room, b, { t: 'auth', session: sB });
    assert.deepEqual(b.last('auth'), { t: 'auth', ok: true, nick: null, banned: false });
    await send(room, b, { t: 'say', text: '안녕' });
    assert.equal(b.last('err').code, 'need_nick');

    await send(room, a, { t: 'auth', session: 'x'.repeat(30) });
    assert.equal(a.last('auth').ok, false);
    await send(room, a, { t: 'auth', session: sA });
    assert.equal(a.last('auth').nick, '행운의곰');
    await send(room, a, { t: 'say', text: '토요일 추첨 기다리는 중' });
    const got = guest.last('msg');
    assert.equal(got.m.nick, '행운의곰');
    assert.equal(got.m.text, '토요일 추첨 기다리는 중');
    assert.equal(got.m.sub, undefined, '계정 번호는 내보내지 않는다');
    assert.ok(b.last('msg'), '모두에게 간다');

    await send(room, a, { t: 'say', text: '또' });
    assert.equal(a.last('err').code, 'slow');
    await send(room, a, { t: 'say', text: 'open.kakao.com/o/x' });
    assert.equal(a.last('err').code, 'slow', '속도 제한이 먼저');

    // 새로 들어온 사람은 최근 메시지를 받는다 (info 로 접속 수도)
    const info = await call(env, 'GET', '/api/chat/info');
    assert.equal(info.status, 200);
    assert.equal(info.data.online, 3);
    assert.ok(info.data.last);
    assert.equal((await room.recent()).length, 1);
});

test('채팅: 24시간 지난 메시지는 보이지 않고 지워진다', async () => {
    const { env, room, join } = setup();
    const a = join();
    await send(room, a, { t: 'auth', session: await member(env, 'A', '첫째') });
    const old = Date.now() - KEEP_MS - 1000;
    await room.storage.put('msg:' + String(old).padStart(16, '0') + '-old', { id: String(old).padStart(16, '0') + '-old', at: old, nick: '옛날', text: '어제 말', sub: 'Z' });
    await send(room, a, { t: 'say', text: '오늘 말' });
    const left = [...room.storage._m.keys()].filter(k => k.startsWith('msg:'));
    assert.equal(left.length, 1, '지난 것은 지운다');
    assert.deepEqual((await room.recent()).map(m => m.text), ['오늘 말']);
});

test('채팅 관리: 관리자가 메시지를 지우고, 회원을 채팅 금지하면 그 사람 글도 걷히며, 해제할 수 있다', async () => {
    const { env, room, join } = setup();
    const a = join(), viewer = join();
    const sA = await member(env, 'A', '말썽꾼');
    await send(room, a, { t: 'auth', session: sA });
    await send(room, a, { t: 'say', text: '첫 마디' });

    let list = (await call(env, 'GET', '/api/admin/chat', { headers: asAdmin })).data;
    assert.equal(list.messages.length, 1);
    assert.equal(list.messages[0].sub, 'A', '관리자에게는 누가 썼는지 보인다');
    assert.equal((await call(env, 'GET', '/api/admin/chat')).status, 401);

    await call(env, 'POST', '/api/admin/chat/delete', { body: { id: list.messages[0].id }, headers: asAdmin });
    assert.equal(viewer.last('del').id, list.messages[0].id);
    assert.equal((await room.recent()).length, 0);

    room.last.clear();
    await send(room, a, { t: 'say', text: '두 번째' });
    await call(env, 'POST', '/api/admin/chat/ban', { body: { sub: 'A', nick: '말썽꾼' }, headers: asAdmin });
    assert.equal((await room.recent()).length, 0, '금지하면 그 사람 글도 걷힌다');
    list = (await call(env, 'GET', '/api/admin/chat', { headers: asAdmin })).data;
    assert.deepEqual(list.bans.map(b => [b.sub, b.nick]), [['A', '말썽꾼']]);

    room.last.clear();
    a.serializeAttachment(Object.assign(a.deserializeAttachment(), { lastAt: 0 }));
    await send(room, a, { t: 'say', text: '세 번째' });
    assert.equal(a.last('err').code, 'banned');

    await call(env, 'POST', '/api/admin/chat/unban', { body: { sub: 'A' }, headers: asAdmin });
    await send(room, a, { t: 'say', text: '네 번째' });
    assert.equal(viewer.last('msg').m.text, '네 번째');
});

test('채팅 연결: 설정·WebSocket 아님·다른 사이트는 거절', async () => {
    const { env } = setup();
    assert.equal((await call(env, 'GET', '/api/config')).data.chat, true);
    assert.equal((await call(env, 'GET', '/api/chat')).status, 426);
    assert.equal((await call(env, 'GET', '/api/chat', { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } })).status, 403);
    const off = setup().env;
    delete off.CHAT;
    assert.equal((await call(off, 'GET', '/api/config')).data.chat, false);
    assert.equal((await call(off, 'GET', '/api/chat/info')).status, 503);
});
