// 실시간 채팅방(과 블로그 댓글): 글자 검사, 로그인·별명·금지·속도 제한, 24시간 휘발, 관리자 지우기·금지.
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
    // 실제 연결처럼 들어온다: v = 화면이 주소에 붙여 오는 브라우저 번호
    const enter = async v => { const ws = fakeSocket(); sockets.push(ws); await room.welcome(ws, v); return ws; };
    return { env, room, join, enter, cStore: cInst.storage };
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

test('채팅 접속 수는 사람 수: 같은 브라우저의 여러 탭 · 같은 계정은 한 명, 번호 없는 옛 화면은 탭마다 한 명', async () => {
    const { env, room, enter } = setup();
    const PC = 'pc-browser-0123456789', PHONE = 'phone-browser-0123456789';
    const sA = await member(env, 'A', '행운의곰');
    const close = async ws => { ws.close(); await room.webSocketClose(ws); };

    // 로그인 전: 같은 브라우저의 탭 셋은 한 명
    const t1 = await enter(PC), t2 = await enter(PC), t3 = await enter(PC);
    assert.equal(room.online(), 1);
    assert.equal(t3.last('hello').online, 1);
    assert.equal(t1.last('count').online, 1, '새 탭이 들어와도 모두에게 1명');
    const phone = await enter(PHONE);
    assert.equal(room.online(), 2, '다른 브라우저는 따로');
    // 번호가 없거나 이상하면 소켓마다 한 명 (옛 화면)
    const old1 = await enter(null), old2 = await enter('<b>짧음</b>');
    assert.equal(room.online(), 4);
    assert.equal(old2.deserializeAttachment().v, undefined, '이상한 번호는 버린다');

    // PC 탭 하나만 로그인해도 같은 브라우저의 나머지 탭은 그 계정으로 친다
    await send(room, t1, { t: 'auth', session: sA });
    assert.equal(t1.last('auth').ok, true);
    assert.equal(room.online(), 4);
    assert.equal(t1.deserializeAttachment().v, PC, '로그인해도 브라우저 번호는 남는다');
    // 휴대폰에서 같은 계정으로 로그인하면 PC 와 합쳐져 한 명 줄고, 모두에게 알린다
    phone.sent.length = 0;
    await send(room, phone, { t: 'auth', session: sA });
    assert.equal(room.online(), 3);
    assert.equal(phone.last('count').online, 3);
    assert.equal((await call(env, 'GET', '/api/chat/info')).data.online, 3, '접힌 단추의 수도 같다');
    // 다시 확인해도(별명 변경 등) 수가 그대로면 알리지 않는다
    phone.sent.length = 0;
    await send(room, phone, { t: 'auth', session: sA });
    assert.equal(phone.last('count'), undefined);

    // 탭을 닫으면: 같은 계정이 남아 있는 동안은 그대로, 다 닫아야 준다
    await close(phone);
    assert.equal(room.online(), 3);
    await close(t1);
    assert.equal(room.online(), 3, 'PC 의 로그인 탭이 닫혀도 남은 탭이 같은 브라우저');
    await close(t2); await close(t3);
    assert.equal(room.online(), 2);
    await close(old1); await close(old2);
    assert.equal(room.online(), 0);
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

test('채팅: 운영자 계정의 메시지에는 운영자 표시가 붙는다', async () => {
    const { env, room, join } = setup();
    const ws = join(), viewer = join();
    const s = await member(env, 'OP');
    await call(env, 'POST', '/api/admin/members/OP/staff', { headers: asAdmin });
    await call(env, 'POST', '/api/me/nickname', { body: { nickname: '운영자' }, headers: { Authorization: 'Bearer ' + s } });
    await send(room, ws, { t: 'auth', session: s });
    await send(room, ws, { t: 'say', text: '공지: 토요일 밤에 만나요' });
    assert.deepEqual([viewer.last('msg').m.nick, viewer.last('msg').m.staff], ['운영자', true]);
});

test('채팅 점수(공지하지 않는 규칙): 한 마디 0.1점, 같은 말 반복·한 글자·운영자 제외, 하루 50개까지, 회원에게는 항목 없이 합계만', async () => {
    const { env, room, join } = setup();
    const ws = join();
    const s = await member(env, 'C', '수다곰');
    await send(room, ws, { t: 'auth', session: s });
    const say = async text => {   // 3초 제한을 건너뛰고 말한다
        room.last.clear();
        ws.serializeAttachment(Object.assign(ws.deserializeAttachment(), { lastAt: 0 }));
        await send(room, ws, { t: 'say', text });
    };
    const me = async () => (await call(env, 'GET', '/api/me', { headers: { Authorization: 'Bearer ' + s } })).data.user.score;
    const before = (await me()).total;

    await say('토요일 기대됩니다');
    await say('토요일  기대됩니다!');   // 공백·기호만 다른 같은 말
    await say('ㅋ');                    // 한 글자
    await say('34번 또 나올까요');
    let sc = await me();
    assert.equal(sc.total, Math.round((before + 0.2) * 10) / 10);
    assert.equal(sc.chats, undefined, '회원에게는 채팅 항목을 보이지 않는다');
    const rk = (await call(env, 'GET', '/api/ranking', { headers: { Authorization: 'Bearer ' + s } })).data;
    assert.equal(rk.me.chats, undefined);

    for (let i = 0; i < 60; i++) await say('메시지 ' + i);
    sc = await me();
    assert.equal(sc.total, Math.round((before + 5) * 10) / 10, '하루 최대 5점');
    const list = (await call(env, 'GET', '/api/admin/members', { headers: asAdmin })).data.members;
    assert.equal(list.find(m => m.nick === '수다곰').score.chats, 50, '관리자는 채팅 수를 본다');

    // 운영자는 점수를 받지 않는다
    const opWs = join();
    const so = await member(env, 'OP2');
    await call(env, 'POST', '/api/admin/members/OP2/staff', { headers: asAdmin });
    await send(room, opWs, { t: 'auth', session: so });
    const ob = (await call(env, 'GET', '/api/me', { headers: { Authorization: 'Bearer ' + so } })).data.user.score.total;
    await call(env, 'POST', '/api/me/nickname', { body: { nickname: '관리팀' }, headers: { Authorization: 'Bearer ' + so } });
    await send(room, opWs, { t: 'auth', session: so });
    await send(room, opWs, { t: 'say', text: '안내 말씀 드립니다' });
    assert.equal((await call(env, 'GET', '/api/me', { headers: { Authorization: 'Bearer ' + so } })).data.user.score.total, ob);
});

/* ───── 블로그 댓글 ───── */

const auth = s => ({ Authorization: 'Bearer ' + s });
// 15초 제한을 건너뛴다
const unwait = async (cStore, sub) => { const u = await cStore.get('u:' + sub); u.cmAt = 0; await cStore.put('u:' + sub, u); };

test('댓글 글자 검사: 줄바꿈은 남기고(빈 줄 하나까지) 500자, 링크·연락처·홍보는 막는다', () => {
    assert.deepEqual(checkText('  첫 줄  \r\n\n\n\n  둘째   줄 ', { max: 500, multiline: true }), { text: '첫 줄\n\n둘째 줄' });
    assert.equal(checkText('가'.repeat(501), { max: 500, multiline: true }).error, 'too_long');
    assert.equal(checkText('가'.repeat(500), { max: 500, multiline: true }).error, undefined);
    assert.equal(checkText('여기로\n오픈 카톡 오세요', { max: 500, multiline: true }).error, 'contact');
    assert.equal(checkText('\n \n', { max: 500, multiline: true }).error, 'empty');
});

test('댓글: 읽기는 누구나, 쓰기는 로그인+별명, 15초·하루 30개, 내 것만 지우고, 별명을 바꾸면 따라 바뀐다', async () => {
    const { env, cStore } = setup();
    const post = 'lotto-odds-explained';
    const sA = await member(env, 'A', '행운의곰');
    const sB = await member(env, 'B');   // 별명 없음

    assert.equal((await call(env, 'POST', '/api/comments', { body: { post, text: '좋은 글' } })).status, 401);
    const noNick = await call(env, 'POST', '/api/comments', { body: { post, text: '좋은 글' }, headers: auth(sB) });
    assert.deepEqual([noNick.status, noNick.data.error], [403, 'need_nick']);
    assert.equal((await call(env, 'POST', '/api/comments', { body: { post: '../x', text: '좋은 글' }, headers: auth(sA) })).data.error, 'bad_post');
    assert.equal((await call(env, 'POST', '/api/comments', { body: { post, text: 'www.abc 오세요' }, headers: auth(sA) })).data.error, 'link');

    const ok = await call(env, 'POST', '/api/comments', { body: { post, text: '815만분의 1\n실감 나네요' }, headers: auth(sA) });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.data.comment.nick, ok.data.comment.text, ok.data.comment.mine], ['행운의곰', '815만분의 1\n실감 나네요', true]);
    const slow = await call(env, 'POST', '/api/comments', { body: { post, text: '하나 더' }, headers: auth(sA) });
    assert.deepEqual([slow.status, slow.data.error], [429, 'slow']);

    // 누구나 읽는다(계정 번호는 내보내지 않는다). 내 것에만 mine
    const pub = await call(env, 'GET', '/api/comments?post=' + post);
    assert.equal(pub.data.comments.length, 1);
    assert.equal(pub.data.comments[0].sub, undefined);
    assert.equal(pub.data.comments[0].mine, undefined);
    assert.equal((await call(env, 'GET', '/api/comments?post=' + post, { headers: auth(sA) })).data.comments[0].mine, true);
    assert.equal((await call(env, 'GET', '/api/comments?post=other-post')).data.comments.length, 0, '글마다 따로');

    // 남의 댓글은 못 지운다
    await call(env, 'POST', '/api/me/nickname', { body: { nickname: '구경꾼' }, headers: auth(sB) });
    const id = ok.data.comment.id;
    assert.equal((await call(env, 'POST', '/api/comments/delete', { body: { post, id }, headers: auth(sB) })).data.error, 'not_mine');

    // 별명을 바꾸면(500P 필요 — 점수를 채워 준다) 예전 댓글도 새 별명으로
    const u = await cStore.get('u:A'); u.buy = 10000; await cStore.put('u:A', u);
    assert.equal((await call(env, 'POST', '/api/me/nickname', { body: { nickname: '대박곰' }, headers: auth(sA) })).status, 200);
    assert.equal((await call(env, 'GET', '/api/comments?post=' + post)).data.comments[0].nick, '대박곰');

    assert.equal((await call(env, 'POST', '/api/comments/delete', { body: { post, id }, headers: auth(sA) })).status, 200);
    assert.equal((await call(env, 'GET', '/api/comments?post=' + post)).data.comments.length, 0);

    // 하루 30개까지
    for (let i = 0; i < 30; i++) {
        await unwait(cStore, 'B');
        assert.equal((await call(env, 'POST', '/api/comments', { body: { post, text: '댓글 ' + i }, headers: auth(sB) })).status, 200, 'n=' + i);
    }
    await unwait(cStore, 'B');
    assert.equal((await call(env, 'POST', '/api/comments', { body: { post, text: '31번째' }, headers: auth(sB) })).data.error, 'daily');
});

test('판매점 댓글: 글 이름 shop-판매점번호 로 같은 댓글 길을 쓴다(판매점마다 따로)', async () => {
    const { env } = setup();
    const sA = await member(env, 'A', '행운의곰');
    const r = await call(env, 'POST', '/api/comments', { body: { post: 'shop-11100004', text: '사장님 친절해요' }, headers: auth(sA) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await call(env, 'GET', '/api/comments?post=shop-11100004')).data.comments[0].text, '사장님 친절해요');
    assert.equal((await call(env, 'GET', '/api/comments?post=shop-11100016')).data.comments.length, 0);
    // 그 판매점을 "다녀온 곳"으로 표시한 사람의 댓글에는 visited(다른 판매점 표시는 상관없다)
    assert.equal((await call(env, 'GET', '/api/comments?post=shop-11100004')).data.comments[0].visited, undefined);
    await call(env, 'POST', '/api/me/visits', { body: { id: '11100016', color: '#e63946' }, headers: auth(sA) });
    assert.equal((await call(env, 'GET', '/api/comments?post=shop-11100004')).data.comments[0].visited, undefined);
    await call(env, 'POST', '/api/me/visits', { body: { id: '11100004', color: '#e63946' }, headers: auth(sA) });
    assert.equal((await call(env, 'GET', '/api/comments?post=shop-11100004')).data.comments[0].visited, true);
});

test('댓글 관리: 관리자는 누가 썼는지 보고 지우며, 채팅 금지한 계정은 댓글도 막히고, 탈퇴하면 댓글이 지워진다', async () => {
    const { env } = setup();
    const post = 'why-jackpots-split';
    const s = await member(env, 'X', '말썽꾼');
    const s2 = await member(env, 'Y', '착한곰');
    await call(env, 'POST', '/api/comments', { body: { post, text: '첫 댓글' }, headers: auth(s) });
    await call(env, 'POST', '/api/comments', { body: { post, text: '좋은 글이네요' }, headers: auth(s2) });

    assert.equal((await call(env, 'GET', '/api/admin/comments')).status, 401);
    const list = (await call(env, 'GET', '/api/admin/comments', { headers: asAdmin })).data;
    assert.equal(list.total, 2);
    const mine = list.comments.find(c => c.sub === 'X');
    assert.deepEqual([mine.post, mine.nick, mine.text], [post, '말썽꾼', '첫 댓글']);

    assert.equal((await call(env, 'POST', '/api/admin/comments/delete', { body: { post, id: mine.id }, headers: asAdmin })).status, 200);
    assert.equal((await call(env, 'GET', '/api/comments?post=' + post)).data.comments.length, 1);

    await call(env, 'POST', '/api/admin/chat/ban', { body: { sub: 'X', nick: '말썽꾼' }, headers: asAdmin });
    const banned = await call(env, 'POST', '/api/comments', { body: { post, text: '다시 왔다' }, headers: auth(s) });
    assert.deepEqual([banned.status, banned.data.error], [403, 'banned']);

    // 관리자가 별명을 지우면 댓글에도 별명이 빠진다
    await call(env, 'POST', '/api/admin/members/Y/clear-nick', { headers: asAdmin });
    assert.equal((await call(env, 'GET', '/api/comments?post=' + post)).data.comments[0].nick, null);

    // 탈퇴하면 그 사람 댓글이 지워진다
    assert.equal((await call(env, 'POST', '/api/me/delete', { body: { confirm: true }, headers: auth(s2) })).status, 200);
    assert.equal((await call(env, 'GET', '/api/comments?post=' + post)).data.comments.length, 0);
    assert.equal((await call(env, 'GET', '/api/admin/comments', { headers: asAdmin })).data.total, 0);
});

test('댓글 점수(공지하지 않는 규칙): 하나에 1점·하루 5개, 짧은 글·같은 말·운영자 제외, 지우면 빠지고, 회원에게는 항목 없이 합계만', async () => {
    const { env, cStore } = setup();
    const post = 'lotto-tax-guide';
    const s = await member(env, 'P', '글쟁이');
    const total = async () => (await call(env, 'GET', '/api/me', { headers: auth(s) })).data.user.score;
    const write = async text => { await unwait(cStore, 'P'); return (await call(env, 'POST', '/api/comments', { body: { post, text }, headers: auth(s) })).data; };
    const before = (await total()).total;

    const first = await write('세금 계산이 이렇게 되는 줄 몰랐습니다');
    assert.equal(first.comment.pt, undefined, '점수 표시는 내보내지 않는다');
    await write('세금 계산이 이렇게 되는 줄 몰랐습니다!!');   // 같은 말
    await write('좋아요 ㅎㅎ');                              // 10자 미만
    let sc = await total();
    assert.equal(sc.total, before + 1);
    assert.equal(sc.comments, undefined, '회원에게는 댓글 항목을 보이지 않는다');
    assert.equal((await call(env, 'GET', '/api/ranking', { headers: auth(s) })).data.me.comments, undefined);

    for (let i = 0; i < 6; i++) await write(`실수령액 계산기로 확인해 봤어요 ${i}번째`);
    assert.equal((await total()).total, before + 5, '하루 5점까지');
    assert.equal((await call(env, 'GET', '/api/admin/members', { headers: asAdmin })).data.members.find(m => m.nick === '글쟁이').score.comments, 5);

    // 점수를 받은 댓글을 지우면 빠진다(본인), 관리자가 지워도 빠진다
    await call(env, 'POST', '/api/comments/delete', { body: { post, id: first.comment.id }, headers: auth(s) });
    assert.equal((await total()).total, before + 4);
    const all = (await call(env, 'GET', '/api/admin/comments', { headers: asAdmin })).data.comments;
    const scored = all.find(c => c.pt);
    await call(env, 'POST', '/api/admin/comments/delete', { body: { post, id: scored.id }, headers: asAdmin });
    assert.equal((await total()).total, before + 3);
    // 점수 없는 댓글은 지워도 그대로
    await call(env, 'POST', '/api/admin/comments/delete', { body: { post, id: all.find(c => !c.pt).id }, headers: asAdmin });
    assert.equal((await total()).total, before + 3);
});

test('관리자 주문 목록: 로그인한 채 산 주문에 회원 참조값(앞 12자)이 붙고, 회원 명부에도 같은 값이 있다', async () => {
    const { env } = setup();
    const s = await member(env, 'Q', '구매곰');
    env.BANK_NAME = '우리은행'; env.BANK_ACCOUNT = '1'; env.BANK_HOLDER = '홍길동';
    const o = await call(env, 'POST', '/api/orders', { body: { plan: 'day', method: 'bank', name: '홍길동', agree: true }, headers: auth(s) });
    assert.equal(o.status, 201, JSON.stringify(o.data));
    const list = (await call(env, 'GET', '/api/admin/orders?status=all', { headers: asAdmin })).data.orders;
    const row = list.find(x => x.id === o.data.order.id);
    const m = (await call(env, 'GET', '/api/admin/members', { headers: asAdmin })).data.members.find(x => x.nick === '구매곰');
    assert.ok(row.r && m.ref);
    assert.equal(row.r, m.ref.slice(0, 12));
    // 무료 체험 주문은 회원 명부의 체험 키 번호로 찾는다(가입 체험은 2026-10-11부터 꺼져 있어 체험을 켠 서버로 따로 본다)
    const { env: env2 } = setup();
    env2.SIGNUP_TRIAL_DAYS = '3';
    await member(env2, 'T', '체험곰');
    const list2 = (await call(env2, 'GET', '/api/admin/orders?status=all', { headers: asAdmin })).data.orders;
    const m2 = (await call(env2, 'GET', '/api/admin/members', { headers: asAdmin })).data.members.find(x => x.nick === '체험곰');
    const trial = list2.find(x => x.m === 'trial');
    assert.equal(trial.k.toLowerCase(), m2.trial.keyId.toLowerCase());
    assert.ok(!list.some(x => x.m === 'trial'), '체험을 끈 서버(기본)에는 체험 주문이 없다');
});

test('답글: 한 단계로 붙고, 답한 댓글 · 맨 위 댓글 쓴 사람에게 알림(나는 빼고), 읽으면 0, 내 댓글 목록', async () => {
    const { env, cStore } = setup();
    const post = 'shop-11100004';
    const sA = await member(env, 'A', '행운의곰');
    const sB = await member(env, 'B', '구경꾼');
    const sC = await member(env, 'C', '지나가던');
    const root = (await call(env, 'POST', '/api/comments', { body: { post, text: '사장님 친절해요' }, headers: auth(sA) })).data.comment;
    const r1 = await call(env, 'POST', '/api/comments', { body: { post, text: '맞아요', to: root.id }, headers: auth(sB) });
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    assert.equal(r1.data.comment.to, root.id);
    // 답글에 답하면 맨 위 댓글 아래로, 알림은 B(답한 댓글)와 A(맨 위)에게
    const r2 = await call(env, 'POST', '/api/comments', { body: { post, text: '저도요', to: r1.data.comment.id }, headers: auth(sC) });
    assert.equal(r2.data.comment.to, root.id);
    const nA = (await call(env, 'GET', '/api/me/notes', { headers: auth(sA) })).data;
    assert.deepEqual([nA.unread, nA.notes.length, nA.notes[0].nick, nA.notes[0].post, nA.notes[1].text], [2, 2, '지나가던', post, '맞아요']);
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(sA) })).data.user.notes, 2);
    assert.equal((await call(env, 'GET', '/api/me/notes', { headers: auth(sB) })).data.unread, 1);
    assert.equal((await call(env, 'GET', '/api/me/notes', { headers: auth(sC) })).data.unread, 0, '내 답글은 나에게 알리지 않는다');
    assert.equal((await call(env, 'POST', '/api/me/notes/read', { headers: auth(sA) })).data.unread, 0);
    assert.equal((await call(env, 'GET', '/api/me', { headers: auth(sA) })).data.user.notes, 0);
    assert.equal((await call(env, 'GET', '/api/me/notes', { headers: auth(sA) })).data.notes.length, 2, '읽어도 목록은 남는다');
    // 없는 댓글 · 이상한 번호에는 못 단다
    await unwait(cStore, 'B');
    assert.equal((await call(env, 'POST', '/api/comments', { body: { post, text: '어디?', to: '0000000000000001-abc' }, headers: auth(sB) })).data.error, 'not_found');
    assert.equal((await call(env, 'POST', '/api/comments', { body: { post, text: '어디?', to: '../x' }, headers: auth(sB) })).data.error, 'bad_reply');
    // 내 댓글: 최근 것부터, 글 이름과 함께
    await unwait(cStore, 'B');
    await call(env, 'POST', '/api/comments', { body: { post: 'lotto-odds-explained', text: '블로그 댓글' }, headers: auth(sB) });
    const mine = (await call(env, 'GET', '/api/me/comments', { headers: auth(sB) })).data.comments;
    assert.deepEqual(mine.map(c => [c.post, c.text, c.to || null]), [['lotto-odds-explained', '블로그 댓글', null], [post, '맞아요', root.id]]);
    assert.equal((await call(env, 'GET', '/api/me/comments')).status, 401);
    // 탈퇴하면 알림도 지운다
    await call(env, 'POST', '/api/me/delete', { body: { confirm: true }, headers: auth(sA) });
    assert.equal(await cStore.get('nt:A'), undefined);
});
