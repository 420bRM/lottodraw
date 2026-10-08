// 회원(구글 로그인) · 로그인 세션 · 좋아요(하트 ♥ / 달러 $) 저장소. Durable Object 하나에 모은다.
//
// 결제 저장소(KV)와 나눈 이유: KV 무료 한도는 하루 쓰기 1,000회다. 좋아요를 누가 도배해 그 한도를
// 다 쓰면 그날 주문·입금 확인이 멈춘다. Durable Object 는 한도가 따로(하루 10만 행)이고,
// 한 곳에서 차례로 처리해 좋아요 수가 어긋나지 않는다.
//
// 저장하는 것 (개인정보 처리방침과 맞출 것)
//   u:<구글 계정 번호>   { sub, ref, email, nick, createdAt, lastAt, trial, rx, sess, att, buy, spent, staff }
//                        spent: 쓴 포인트(별명 바꾸기 등) — 랭킹은 모은 점수(total)로, 쓸 수 있는 포인트는 total - spent
//                        staff: 운영자 계정 — 랭킹에서 빠지고, 채팅에 "운영자" 표시, 운영자다운 별명 허용, 별명 바꾸기 무료
//                        att: { days, last } — 출석한 날 수와 마지막 출석일(한국 날짜)
//                        chat: { n, day, today, h } — (공지하지 않는 규칙) 점수를 받은 채팅 수(전체), 오늘(한국 날짜)의 수, 마지막 메시지 해시(같은 말 반복 거르기)
//                        buy: 로그인한 채 산 이용권 금액 합계(원) — 랭킹 점수용
//                        trial: { orderId, keyId, key, expiresAt } — 가입 때 한 번 주는 무료 체험 키
//                        rx:    { 항목: 'h' | 'd' | 'hd' } — 내가 누른 좋아요
//                        sess:  로그인 세션 해시 (최근 5개)
//                        cm:    내가 쓴 블로그 댓글 키, cmAt: 마지막으로 쓴 시각, cmDay: { day, n } 오늘 쓴 수
//   s:<세션 해시>        { sub, exp }  — 30일
//   t:<계정 번호 해시>   { at }        — 무료 체험을 받은 계정. 탈퇴해도 1년 남겨 다시 가입해 또 받는 것을 막는다
//   r:<항목>             { h, d }      — 좋아요 수 (누구나 본다. 관리자 페이지에는 카드별 합계 표)
//   n:<별명 소문자>      계정 번호      — 별명이 겹치지 않게
//   m:<회원 참조값>      계정 번호      — 주문에 남기는 되돌릴 수 없는 참조값(sha256) → 계정. 탈퇴하면 지운다
//   c:<글>:<시각 16자리>-<무작위>  { id, at, sub, nick, text, staff } — 블로그 댓글. 계정은 cm(이 키들의 목록)으로 찾아 탈퇴 때 지운다
//   meta                 { users, trials }
//
// 이름·사진은 받지 않는다. 이메일은 "로그인한 계정" 표시와 문의 응대에만 쓴다.

export const TRIAL_DAYS = 3;
export const SESSION_DAYS = 30;
const TRIAL_MEMORY_DAYS = 365;
const MAX_SESSIONS = 5;
const DAY = 86400 * 1000;

export const REACT_TYPES = ['h', 'd', 'w'];   // ♥ 좋아요, $ 대박 기원, ₩ 원화

// 랭킹 점수. 바꾸려면 여기만 고친다(이용약관 7조 문구도 같이).
export const POINTS = { attend: 10, react: 2, buyPer100: 10, nickChange: 500 };   // buyPer100: 이용권 100원마다 몇 점, nickChange: 별명 바꾸기에 쓰는 포인트
// 채팅 점수 — 공지하지 않는 규칙이라 POINTS(회원에게 내려 보내는 값)와 따로 둔다.
// per: 메시지 하나에 몇 점, daily: 하루에 점수를 받는 메시지 수 상한(50개 = 5점)
export const CHAT_POINTS = { per: 0.1, daily: 50 };
const tenth = x => Math.round(x * 10) / 10;   // 채팅 점수(0.1)가 섞여 소수 첫째 자리까지 쓴다
const kstDay = ms => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function score(user) {
    const days = (user.att && user.att.days) || 0;
    const reacts = Object.values(user.rx || {}).reduce((n, m) => n + m.length, 0);
    const buy = Math.floor((user.buy || 0) * POINTS.buyPer100 / 100);
    const chats = (user.chat && user.chat.n) || 0;
    const total = tenth(days * POINTS.attend + reacts * POINTS.react + buy + chats * CHAT_POINTS.per);
    const spent = user.spent || 0;
    return { total, days, reacts, buy, chats, spent, avail: tenth(total - spent) };
}

// 회원에게 보이는 점수: 채팅 점수는 공지하지 않는 규칙이라 항목(chats)을 빼고 합계에만 넣는다. 관리자 명부는 score() 그대로.
const pubScore = user => { const s = score(user); delete s.chats; return s; };

// 오늘(한국 날짜) 처음이면 출석을 하나 올린다. 올렸으면 true.
function attend(user, now) {
    const today = kstDay(now);
    user.att = user.att || { days: 0, last: '' };
    if (user.att.last === today) return false;
    user.att.days += 1;
    user.att.last = today;
    return true;
}
export const ITEM_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// 블로그 댓글
export const COMMENT = { max: 500, gapMs: 15000, daily: 30, list: 200 };   // 글자 수, 다음 댓글까지, 하루 최대, 한 글에 보여 주는 수
const pubComment = (c, sub) => Object.assign({ id: c.id, at: c.at, nick: c.nick, text: c.text }, c.staff ? { staff: true } : {}, sub && c.sub === sub ? { mine: true } : {});

// 내가 쓴 댓글의 별명을 한꺼번에 바꾼다(별명을 바꾸거나 관리자가 지웠을 때)
async function renameComments(storage, user) {
    for (const k of user.cm || []) {
        const c = await storage.get(k);
        if (c) { c.nick = user.nick || null; await storage.put(k, c); }
    }
}

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
    async login({ sub, email, subHash, ref, now }) {
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
        if (ref && user.ref !== ref) { user.ref = ref; await this.storage.put('m:' + ref, sub); }
        const attended = attend(user, now);
        await this.storage.put('u:' + sub, user);
        // 발급은 처음 로그인한 요청이 한다. 단추를 두 번 눌러 겹친 요청은 건너뛰고(키가 두 개 생기지 않게),
        // 발급 도중 실패해 pending 이 1분 넘게 남았으면 다음 로그인 때 다시 발급한다.
        const pending = !!(user.trial && user.trial.pending);
        const needTrial = pending && (isNew || now - (user.trial.at || 0) > 60 * 1000);
        if (needTrial && !isNew) { user.trial.at = now; await this.storage.put('u:' + sub, user); }
        return { isNew, needTrial, attended, user: view(user) };
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
    // 처음 정할 때(관리자가 지운 뒤 다시 정할 때 포함)는 무료, 바꿀 때는 포인트를 쓴다(운영자는 무료).
    async setNick({ sub, nick, key, now }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        if (user.nick === nick) return { ok: true, user: view(user), cost: 0 };
        const owner = await this.storage.get('n:' + key);
        if (owner && owner !== sub) return { error: 'taken' };
        const cost = user.nick && !user.staff ? POINTS.nickChange : 0;
        const avail = score(user).avail;
        if (cost && avail < cost) return { error: 'need_points', cost, avail };
        if (user.nick && user.nick.toLowerCase() !== key) await this.storage.delete('n:' + user.nick.toLowerCase());
        await this.storage.put('n:' + key, sub);
        user.nick = nick;
        user.nickAt = now;
        user.spent = (user.spent || 0) + cost;
        await this.storage.put('u:' + sub, user);
        await renameComments(this.storage, user);
        return { ok: true, user: view(user), cost };
    },

    // 관리자가 운영자 계정을 지정하거나 푼다
    async setStaff({ sub, on }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        user.staff = !!on;
        await this.storage.put('u:' + sub, user);
        return { ok: true };
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

    // markAttend: 내 정보 조회(/api/me)일 때만 오늘 출석을 올린다
    async sessionGet({ hash, now, markAttend }) {
        const s = await this.storage.get('s:' + hash);
        if (!s) return { user: null };
        const user = await this.storage.get('u:' + s.sub);
        if (!user || s.exp < now) {
            await this.storage.delete('s:' + hash);
            return { user: null };
        }
        let attended = false;
        if (markAttend) {
            attended = attend(user, now);
            if (attended) { user.lastAt = now; await this.storage.put('u:' + s.sub, user); }
        }
        return { sub: s.sub, user: view(user), rx: user.rx || {}, attended };
    },

    // 채팅 한 마디에 점수. 운영자 제외, 하루 상한, 바로 앞과 같은 말(h: 정규화한 글의 해시)은 세지 않는다.
    async chatPoint({ sub, now, h }) {
        const user = await this.storage.get('u:' + sub);
        if (!user || user.staff) return { counted: false };
        const today = kstDay(now);
        const c = user.chat || { n: 0, day: '', today: 0, h: '' };
        if (c.day !== today) { c.day = today; c.today = 0; }
        if (c.today >= CHAT_POINTS.daily || (h && c.h === h)) return { counted: false };
        c.n += 1;
        c.today += 1;
        c.h = h || '';
        user.chat = c;
        await this.storage.put('u:' + sub, user);
        return { counted: true, today: c.today };
    },

    // 로그인한 채 산 이용권: 결제되면 +금액, 환불되면 -금액 (랭킹 점수용)
    async credit({ ref, amount }) {
        const sub = await this.storage.get('m:' + ref);
        const user = sub && await this.storage.get('u:' + sub);
        if (!user) return { ok: false };
        user.buy = Math.max(0, (user.buy || 0) + amount);
        await this.storage.put('u:' + sub, user);
        return { ok: true };
    },

    // 랭킹: 별명을 정한 회원만 공개 목록에 오른다(상위 50명). 내 순위는 별명이 없어도 알려 준다.
    async ranking({ sub, limit }) {
        const users = await this.storage.list({ prefix: 'u:', limit: 5000 });
        const all = [];
        for (const u of users.values()) if (!u.staff) all.push({ sub: u.sub, nick: u.nick || null, createdAt: u.createdAt || 0, s: score(u) });   // 운영자는 순위에서 뺀다
        all.sort((a, b) => (b.s.total - a.s.total) || (a.createdAt - b.createdAt));
        const named = all.filter(x => x.nick);
        const rankOf = (list, x) => list.findIndex(y => y.s.total === x.s.total) + 1;   // 같은 점수는 같은 순위
        const top = named.slice(0, limit || 50).map(x => ({ rank: rankOf(named, x), nick: x.nick, points: x.s.total, days: x.s.days }));
        let me = null;
        const mine = sub && all.find(x => x.sub === sub);
        if (mine) {
            const pool = mine.nick ? named : named.concat([mine]).sort((a, b) => (b.s.total - a.s.total) || (a.createdAt - b.createdAt));
            const s = Object.assign({}, mine.s); delete s.chats;
            me = Object.assign({ rank: rankOf(pool, mine), of: pool.length, nick: mine.nick }, s);
        }
        return { top, me, total: named.length };
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

    // 탈퇴: 계정·세션·내가 누른 좋아요·내가 쓴 댓글을 지운다. 무료 체험 기록(계정 번호 해시)만 1년 남는다.
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
        for (let i = 0; i < (user.cm || []).length; i += 128) await this.storage.delete(user.cm.slice(i, i + 128));   // 내가 쓴 블로그 댓글
        if (user.nick) await this.storage.delete('n:' + user.nick.toLowerCase());
        if (user.ref) await this.storage.delete('m:' + user.ref);
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
        const c = (await this.storage.get('r:' + item)) || { h: 0, d: 0, w: 0 };
        c[type] = Math.max(0, (c[type] || 0) + (on ? 1 : -1));
        await this.storage.put('r:' + item, c);
        await this.storage.put('u:' + sub, user);
        return { counts: { h: c.h || 0, d: c.d || 0, w: c.w || 0 }, mine: next };
    },

    async counts({ items }) {
        const keys = items.map(i => 'r:' + i);
        const got = keys.length ? await this.storage.get(keys) : new Map();
        const out = {};
        items.forEach(i => {
            const c = got.get('r:' + i);
            out[i] = { h: (c && c.h) || 0, d: (c && c.d) || 0, w: (c && c.w) || 0 };
        });
        return { counts: out };
    },

    async stats() {
        return this.meta();
    },

    // 관리자 페이지: 회원 명부와 카드별 좋아요 합계
    async adminList() {
        const users = await this.storage.list({ prefix: 'u:', limit: 2000 });
        const members = [];
        for (const u of users.values()) {
            const rx = Object.values(u.rx || {});
            members.push({
                sub: u.sub, email: u.email, nick: u.nick || null, createdAt: u.createdAt, lastAt: u.lastAt,
                trial: u.trial && u.trial.keyId ? { keyId: u.trial.keyId, expiresAt: u.trial.expiresAt } : null,
                hearts: rx.filter(m => m.includes('h')).length, dollars: rx.filter(m => m.includes('d')).length,
                wons: rx.filter(m => m.includes('w')).length, score: score(u), buy: u.buy || 0, staff: !!u.staff,
            });
        }
        members.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const rows = await this.storage.list({ prefix: 'r:', limit: 2000 });
        const reactions = [];
        for (const [k, c] of rows.entries()) if ((c.h || 0) + (c.d || 0) + (c.w || 0) > 0) reactions.push({ id: k.slice(2), h: c.h || 0, d: c.d || 0, w: c.w || 0 });
        reactions.sort((a, b) => (b.h + b.d + b.w) - (a.h + a.d + a.w));
        return { members, reactions, meta: await this.meta() };
    },

    // 관리자가 부적절한 별명을 지운다 (이용약관 7조)
    async clearNick({ sub }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        if (user.nick) await this.storage.delete('n:' + user.nick.toLowerCase());
        user.nick = null;
        await this.storage.put('u:' + sub, user);
        await renameComments(this.storage, user);
        return { ok: true };
    },

    /* ───── 블로그 댓글 ───── */

    // 쓰기: 별명이 있어야 하고, 15초에 한 번·하루 30개까지. 글 검사(링크·연락처·홍보)는 Worker 가 먼저 한다.
    async commentAdd({ sub, post, text, now }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        if (!user.nick) return { error: 'need_nick' };
        if (now - (user.cmAt || 0) < COMMENT.gapMs) return { error: 'slow' };
        const day = kstDay(now);
        const d = user.cmDay && user.cmDay.day === day ? user.cmDay : { day, n: 0 };
        if (d.n >= COMMENT.daily) return { error: 'daily' };
        const id = String(now).padStart(16, '0') + '-' + Math.random().toString(36).slice(2, 8);
        const c = { id, at: now, sub, nick: user.nick, text };
        if (user.staff) c.staff = true;
        const key = 'c:' + post + ':' + id;
        await this.storage.put(key, c);
        user.cm = (user.cm || []).concat(key);
        user.cmAt = now;
        user.cmDay = { day, n: d.n + 1 };
        await this.storage.put('u:' + sub, user);
        return { comment: pubComment(c, sub) };
    },

    // 한 글의 댓글(오래된 것부터, 최근 200개). sub 가 있으면 내 댓글에 mine 표시
    async commentList({ post, sub }) {
        const rows = await this.storage.list({ prefix: 'c:' + post + ':', reverse: true, limit: COMMENT.list });
        return { comments: [...rows.values()].reverse().map(c => pubComment(c, sub)) };
    },

    // 지우기: 쓴 사람 또는 관리자(admin)
    async commentDelete({ sub, post, id, admin }) {
        const key = 'c:' + post + ':' + id;
        const c = await this.storage.get(key);
        if (!c) return { error: 'not_found' };
        if (!admin && c.sub !== sub) return { error: 'not_mine' };
        await this.storage.delete(key);
        const user = await this.storage.get('u:' + c.sub);
        if (user && user.cm) { user.cm = user.cm.filter(k => k !== key); await this.storage.put('u:' + c.sub, user); }
        return { ok: true };
    },

    // 관리자: 모든 글의 최근 댓글(누가 썼는지 포함)
    async adminComments({ limit }) {
        const rows = await this.storage.list({ prefix: 'c:', limit: 5000 });
        const all = [];
        for (const [k, c] of rows.entries()) all.push(Object.assign({ post: k.slice(2, k.lastIndexOf(':')) }, c));
        all.sort((a, b) => b.at - a.at);
        return { comments: all.slice(0, limit || 200), total: all.length };
    },
};

function view(user) {
    const trial = user.trial && user.trial.key ? { key: user.trial.key, keyId: user.trial.keyId, expiresAt: user.trial.expiresAt } : null;
    return { email: user.email, nick: user.nick || null, createdAt: user.createdAt, trial, score: pubScore(user), staff: !!user.staff };
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
