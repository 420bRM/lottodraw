// 회원(구글 로그인) · 로그인 세션 · 좋아요(하트 ♥ / 달러 $) 저장소. Durable Object 하나에 모은다.
//
// 결제 저장소(KV)와 나눈 이유: KV 무료 한도는 하루 쓰기 1,000회다. 좋아요를 누가 도배해 그 한도를
// 다 쓰면 그날 주문·입금 확인이 멈춘다. Durable Object 는 한도가 따로(하루 10만 행)이고,
// 한 곳에서 차례로 처리해 좋아요 수가 어긋나지 않는다.
//
// 저장하는 것 (개인정보 처리방침과 맞출 것)
//   u:<구글 계정 번호>   { sub, email, nick, createdAt, lastAt, trial, rx, sess }
//                        trial: { orderId, keyId, key, expiresAt } — 가입 때 한 번 주는 무료 체험 키
//                        rx:    { 항목: 'h' | 'd' | 'hd' } — 내가 누른 좋아요
//                        sess:  로그인 세션 해시 (최근 5개)
//   s:<세션 해시>        { sub, exp }  — 30일
//   t:<계정 번호 해시>   { at }        — 무료 체험을 받은 계정. 탈퇴해도 1년 남겨 다시 가입해 또 받는 것을 막는다
//   r:<항목>             { h, d }      — 좋아요 수
//   n:<별명 소문자>      계정 번호      — 별명이 겹치지 않게
//   meta                 { users, trials }
//
// 이름·사진은 받지 않는다. 이메일은 "로그인한 계정" 표시와 문의 응대에만 쓴다.

export const TRIAL_DAYS = 3;
export const SESSION_DAYS = 30;
const TRIAL_MEMORY_DAYS = 365;
const MAX_SESSIONS = 5;
const DAY = 86400 * 1000;

export const REACT_TYPES = ['h', 'd'];
export const ITEM_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class Community {
    constructor(state) {
        this.storage = state.storage;
    }

    async fetch(request) {
        let body;
        try { body = await request.json(); } catch (e) { return reply({ error: 'bad_json' }, 400); }
        const op = OPS[body && body.op];
        if (!op) return reply({ error: 'bad_op' }, 400);
        try {
            return reply(await op.call(this, body));
        } catch (err) {
            console.error('community', body.op, err);
            return reply({ error: 'server' }, 500);
        }
    }

    async meta() { return (await this.storage.get('meta')) || { users: 0, trials: 0 }; }
    async bump(field, by) {
        const m = await this.meta();
        m[field] = Math.max(0, (m[field] || 0) + by);
        await this.storage.put('meta', m);
    }
}

const OPS = {
    // 구글 로그인 뒤. 처음이면 계정을 만들고, 무료 체험을 줄 수 있는지 알려 준다.
    async login({ sub, email, subHash, now }) {
        let user = await this.storage.get('u:' + sub);
        const isNew = !user;
        if (!user) {
            user = { sub, email, createdAt: now, lastAt: now, trial: null, rx: {}, sess: [] };
            const used = await this.storage.get('t:' + subHash);
            if (!used || now - used.at > TRIAL_MEMORY_DAYS * DAY) {
                user.trial = { pending: true, at: now };
                await this.storage.put('t:' + subHash, { at: now });
            }
            await this.bump('users', 1);
        }
        user.email = email;
        user.lastAt = now;
        await this.storage.put('u:' + sub, user);
        // 발급은 처음 로그인한 요청이 한다. 단추를 두 번 눌러 겹친 요청은 건너뛰고(키가 두 개 생기지 않게),
        // 발급 도중 실패해 pending 이 1분 넘게 남았으면 다음 로그인 때 다시 발급한다.
        const pending = !!(user.trial && user.trial.pending);
        const needTrial = pending && (isNew || now - (user.trial.at || 0) > 60 * 1000);
        if (needTrial && !isNew) { user.trial.at = now; await this.storage.put('u:' + sub, user); }
        return { isNew, needTrial, user: view(user) };
    },

    async setTrial({ sub, trial }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { ok: false };
        const first = !(user.trial && user.trial.key);
        user.trial = trial;
        await this.storage.put('u:' + sub, user);
        if (first) await this.bump('trials', 1);
        return { ok: true, user: view(user) };
    },

    // 별명 정하기·바꾸기. 다른 사람이 쓰는 별명이면 거절한다(대소문자 무시).
    async setNick({ sub, nick, key, now }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        const owner = await this.storage.get('n:' + key);
        if (owner && owner !== sub) return { error: 'taken' };
        if (user.nick && user.nick.toLowerCase() !== key) await this.storage.delete('n:' + user.nick.toLowerCase());
        await this.storage.put('n:' + key, sub);
        user.nick = nick;
        user.nickAt = now;
        await this.storage.put('u:' + sub, user);
        return { ok: true, user: view(user) };
    },

    async sessionCreate({ sub, hash, exp }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { ok: false };
        user.sess = (user.sess || []).concat(hash);
        while (user.sess.length > MAX_SESSIONS) await this.storage.delete('s:' + user.sess.shift());
        await this.storage.put('s:' + hash, { sub, exp });
        await this.storage.put('u:' + sub, user);
        return { ok: true };
    },

    async sessionGet({ hash, now }) {
        const s = await this.storage.get('s:' + hash);
        if (!s) return { user: null };
        const user = await this.storage.get('u:' + s.sub);
        if (!user || s.exp < now) {
            await this.storage.delete('s:' + hash);
            return { user: null };
        }
        return { sub: s.sub, user: view(user), rx: user.rx || {} };
    },

    async sessionDelete({ hash }) {
        const s = await this.storage.get('s:' + hash);
        await this.storage.delete('s:' + hash);
        if (s) {
            const user = await this.storage.get('u:' + s.sub);
            if (user) {
                user.sess = (user.sess || []).filter(h => h !== hash);
                await this.storage.put('u:' + s.sub, user);
            }
        }
        return { ok: true };
    },

    // 탈퇴: 계정·세션·내가 누른 좋아요를 지운다. 무료 체험 기록(계정 번호 해시)만 1년 남는다.
    async userDelete({ sub }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { ok: true };
        for (const [item, mine] of Object.entries(user.rx || {})) {
            const c = await this.storage.get('r:' + item);
            if (!c) continue;
            for (const t of REACT_TYPES) if (mine.includes(t)) c[t] = Math.max(0, (c[t] || 0) - 1);
            await this.storage.put('r:' + item, c);
        }
        for (const h of user.sess || []) await this.storage.delete('s:' + h);
        if (user.nick) await this.storage.delete('n:' + user.nick.toLowerCase());
        await this.storage.delete('u:' + sub);
        await this.bump('users', -1);
        return { ok: true, trial: user.trial || null };
    },

    // 좋아요 누르기/취소. 하트와 달러는 따로 켜고 끈다.
    async react({ sub, item, type }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        const rx = user.rx || {};
        const mine = rx[item] || '';
        const on = !mine.includes(type);
        const next = REACT_TYPES.filter(t => (t === type ? on : mine.includes(t))).join('');
        if (next) rx[item] = next; else delete rx[item];
        user.rx = rx;
        const c = (await this.storage.get('r:' + item)) || { h: 0, d: 0 };
        c[type] = Math.max(0, (c[type] || 0) + (on ? 1 : -1));
        await this.storage.put('r:' + item, c);
        await this.storage.put('u:' + sub, user);
        return { counts: { h: c.h || 0, d: c.d || 0 }, mine: next };
    },

    async counts({ items }) {
        const keys = items.map(i => 'r:' + i);
        const got = keys.length ? await this.storage.get(keys) : new Map();
        const out = {};
        items.forEach(i => {
            const c = got.get('r:' + i);
            out[i] = { h: (c && c.h) || 0, d: (c && c.d) || 0 };
        });
        return { counts: out };
    },

    async stats() {
        return this.meta();
    },
};

function view(user) {
    const trial = user.trial && user.trial.key ? { key: user.trial.key, keyId: user.trial.keyId, expiresAt: user.trial.expiresAt } : null;
    return { email: user.email, nick: user.nick || null, createdAt: user.createdAt, trial };
}

function reply(data, status) {
    return new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}

// Worker 쪽에서 부르는 길. 저장소는 하나(이름 'main')뿐이다.
export async function community(env, op, args) {
    const ns = env.COMMUNITY;
    const stub = ns.get(ns.idFromName('main'));
    const res = await stub.fetch('https://community/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ op }, args || {})),
    });
    const data = await res.json();
    if (!res.ok || data.error === 'server') throw new Error('community ' + op + ' failed: ' + res.status);
    return data;
}
