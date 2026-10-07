// 실시간 채팅방 하나(로비). Durable Object + WebSocket(잠들기 API — 말이 없을 때는 비용이 거의 없다).
//
// 원칙 (README "실시간 채팅", 예전 검토 문서 「임베드형 휘발성 채팅 위젯」의 권고)
//   · 휘발성: 메시지는 24시간 뒤 사라진다. 최근 것만 보여 준다.
//   · 읽기는 누구나, 쓰기는 로그인하고 별명을 정한 회원만.
//   · 리딩방·도박 홍보가 몰리는 분야라 링크·전화번호·메신저 주소는 막는다. 한 사람이 3초에 한 번까지.
//   · 운영자는 관리자 페이지에서 메시지를 지우고 회원의 채팅을 막는다.
//
// 저장 (이 방의 저장소)
//   msg:<시각 16자리>-<무작위>  { id, at, nick, text, sub }   — 24시간 뒤 지운다. sub 는 관리자에게만 보인다
//   ban:<구글 계정 번호>        { at, nick }

import { community } from './community.js';

export const KEEP_MS = 24 * 3600 * 1000;
const HISTORY = 50;           // 들어올 때 보여 주는 최근 메시지 수
const MAX_KEEP = 300;         // 저장해 두는 최대 개수
const GAP_MS = 3000;          // 한 사람이 다음 메시지를 쓰기까지
const MAX_LEN = 200;
const MIN_POINT_LEN = 2;      // 점수를 받는 최소 글자 수(공백·기호 빼고)

// 홍보·연락처로 보이는 것. 걸리면 보내지 않고 이유를 알려 준다.
const BLOCKS = [
    [/(https?:\/\/|www\.)/i, 'link'],
    [/[a-z0-9-]+\.(com|net|org|kr|co|io|me|ly|gg|xyz|top|site|shop|info|biz|app|link|kim)\b/i, 'link'],
    [/(open\.kakao|오픈\s*카톡|오픈\s*채팅|카톡\s*아이디|텔레\s*그램|텔그|라인\s*아이디|t\.me)/i, 'contact'],
    [/0\s*1\s*[016789][\s.-]*\d{3,4}[\s.-]*\d{4}/, 'contact'],
    [/(리딩\s*방|무료\s*번호\s*방|당첨\s*보장|적중률|토토|카지노|바카라|먹튀)/i, 'promo'],
];

export function checkText(raw) {
    const text = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return { error: 'empty' };
    if (text.length > MAX_LEN) return { error: 'too_long' };
    for (const [re, why] of BLOCKS) if (re.test(text)) return { error: why };
    return { text };
}

const sha256 = async s => {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const pub = m => Object.assign({ id: m.id, at: m.at, nick: m.nick, text: m.text }, m.staff ? { staff: true } : {});

export class ChatRoom {
    constructor(state, env) {
        this.state = state;
        this.storage = state.storage;
        this.env = env;
        this.last = new Map();   // 계정 → 마지막으로 쓴 시각 (잠들면 비지만, 붙어 있는 소켓에도 같이 적는다)
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (request.headers.get('Upgrade') === 'websocket') {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            this.state.acceptWebSocket(server);
            await this.welcome(server);
            return new Response(null, { status: 101, webSocket: client });
        }
        if (url.pathname === '/info') return reply({ online: this.online(), last: ((await this.recent()).slice(-1)[0] || {}).at || null });
        // 아래는 Worker 의 관리자 길로만 온다
        if (url.pathname === '/admin/list') return reply({ messages: await this.recent(MAX_KEEP), bans: await this.bans() });
        const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
        if (url.pathname === '/admin/delete') {
            await this.storage.delete('msg:' + body.id);
            this.broadcast({ t: 'del', id: body.id });
            return reply({ ok: true });
        }
        if (url.pathname === '/admin/ban') {
            await this.storage.put('ban:' + body.sub, { at: Date.now(), nick: body.nick || '' });
            // 그 사람이 쓴 메시지도 걷어 낸다
            for (const m of await this.recent(MAX_KEEP)) {
                if (m.sub === body.sub) { await this.storage.delete('msg:' + m.id); this.broadcast({ t: 'del', id: m.id }); }
            }
            return reply({ ok: true });
        }
        if (url.pathname === '/admin/unban') {
            await this.storage.delete('ban:' + body.sub);
            return reply({ ok: true });
        }
        return reply({ error: 'not_found' }, 404);
    }

    // 새로 들어온 소켓에 최근 메시지와 접속 수를 보내고, 모두에게 접속 수를 알린다
    async welcome(ws) {
        ws.serializeAttachment({});
        ws.send(JSON.stringify({ t: 'hello', history: (await this.recent()).map(pub), online: this.online() }));
        this.broadcastCount();
    }

    // 닫히는 중인 소켓은 세지 않는다 (readyState 1 = 열림)
    online() { return this.state.getWebSockets().filter(ws => ws.readyState === undefined || ws.readyState === 1).length; }

    async recent(limit) {
        const rows = await this.storage.list({ prefix: 'msg:', reverse: true, limit: limit || HISTORY });
        const cut = Date.now() - KEEP_MS;
        return [...rows.values()].filter(m => m.at > cut).reverse();
    }

    async bans() {
        const rows = await this.storage.list({ prefix: 'ban:' });
        return [...rows.entries()].map(([k, v]) => Object.assign({ sub: k.slice(4) }, v));
    }

    broadcast(obj) {
        const data = JSON.stringify(obj);
        for (const ws of this.state.getWebSockets()) { try { ws.send(data); } catch (e) { /* 이미 닫힘 */ } }
    }

    broadcastCount() { this.broadcast({ t: 'count', online: this.online() }); }

    async webSocketMessage(ws, raw) {
        let msg;
        try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch (e) { return; }
        const me = ws.deserializeAttachment() || {};
        const say = obj => ws.send(JSON.stringify(obj));

        if (msg.t === 'auth') {
            const token = String(msg.session || '');
            if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return say({ t: 'auth', ok: false });
            const got = await community(this.env, 'sessionGet', { hash: await sha256('sess:' + token), now: Date.now() }).catch(() => ({}));
            if (!got.user) return say({ t: 'auth', ok: false });
            const att = { sub: got.sub, nick: got.user.nick || null, staff: !!got.user.staff };
            ws.serializeAttachment(att);
            return say({ t: 'auth', ok: true, nick: att.nick, banned: !!(await this.storage.get('ban:' + att.sub)) });
        }

        if (msg.t === 'say') {
            if (!me.sub) return say({ t: 'err', code: 'need_login' });
            if (!me.nick) return say({ t: 'err', code: 'need_nick' });
            if (await this.storage.get('ban:' + me.sub)) return say({ t: 'err', code: 'banned' });
            const now = Date.now();
            const last = Math.max(this.last.get(me.sub) || 0, me.lastAt || 0);
            if (now - last < GAP_MS) return say({ t: 'err', code: 'slow' });
            const c = checkText(msg.text);
            if (c.error) return say({ t: 'err', code: c.error });
            this.last.set(me.sub, now);
            ws.serializeAttachment(Object.assign(me, { lastAt: now }));
            const id = String(now).padStart(16, '0') + '-' + Math.random().toString(36).slice(2, 8);
            const m = { id, at: now, nick: me.nick, text: c.text, sub: me.sub };
            if (me.staff) m.staff = true;   // 운영자 표시
            await this.storage.put('msg:' + id, m);
            this.broadcast({ t: 'msg', m: pub(m) });
            await this.trim();
            // 랭킹 점수(한 마디 0.1점). 한 글자짜리·같은 말 반복은 세지 않는다 — 판단은 Community 가(하루 상한 포함)
            const plain = c.text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
            if (!me.staff && plain.length >= MIN_POINT_LEN) {
                await community(this.env, 'chatPoint', { sub: me.sub, now, h: await sha256('chat:' + plain) }).catch(() => null);
            }
            return;
        }
    }

    async webSocketClose(ws) {
        try { ws.close(); } catch (e) { /* 이미 닫힘 */ }
        this.broadcastCount();
    }

    async webSocketError(ws) { this.broadcastCount(); }

    // 24시간 지난 것과 너무 많이 쌓인 것을 지운다
    async trim() {
        const rows = await this.storage.list({ prefix: 'msg:' });
        const keys = [...rows.keys()];
        const cut = Date.now() - KEEP_MS;
        const old = keys.filter((k, i) => rows.get(k).at <= cut || i < keys.length - MAX_KEEP);
        for (let i = 0; i < old.length; i += 128) await this.storage.delete(old.slice(i, i + 128));
    }
}

function reply(data, status) {
    return new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}

// Worker 쪽에서 부르는 길. 방은 하나(이름 'lobby').
export function chatStub(env) {
    return env.CHAT.get(env.CHAT.idFromName('lobby'));
}
