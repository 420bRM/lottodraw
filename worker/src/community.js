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
//                        gen:   { inc, exc, pat, recent, ac, acExact, at } — 저장한 번호 생성기 설정(고정수 · 제외수 · 켠 패턴 번호 · 직전 당첨 조합 제외 칸 · AC값 조건과 "이 값만"). 본인에게만 보인다
//                        rx:    { 항목: 'h' | 'd' | 'hd' } — 내가 누른 좋아요
//                        sess:  로그인 세션 해시 (최근 5개)
//                        cm:    내가 쓴 블로그 댓글 키, cmAt: 마지막으로 쓴 시각, cmDay: { day, n } 오늘 쓴 수
//                        cmPt:  { n, day, today, h } — (공지하지 않는 규칙) 점수를 받은 댓글 수, 오늘 받은 수, 마지막으로 받은 댓글 해시
//   s:<세션 해시>        { sub, exp }  — 30일
//   t:<계정 번호 해시>   { at }        — 무료 체험을 받은 계정. 탈퇴해도 1년 남겨 다시 가입해 또 받는 것을 막는다.
//                        가입 체험을 끈 동안(SIGNUP_TRIAL_DAYS 없음 — 2026-10-11부터 기본)은 쓸모가 없어 로그인 때 지운다
//   r:<항목>             { h, d }      — 좋아요 수 (누구나 본다. 관리자 페이지에는 카드별 합계 표)
//   n:<별명 소문자>      계정 번호      — 별명이 겹치지 않게
//   m:<회원 참조값>      계정 번호      — 주문에 남기는 되돌릴 수 없는 참조값(sha256) → 계정. 탈퇴하면 지운다
//   c:<글>:<시각 16자리>-<무작위>  { id, at, sub, nick, text, staff } — 블로그 댓글. 계정은 cm(이 키들의 목록)으로 찾아 탈퇴 때 지운다
//   b:<구글 계정 번호>   { nick, total, days, created } — 랭킹 색인. 별명이 있고 운영자가 아닌 회원만. u: 를 저장할 때 같이 맞춘다(saveUser)
//   board                랭킹 색인 판(BOARD_VERSION) — 없으면 처음 랭킹을 볼 때 u: 를 한 번 훑어 b: 를 채운다
//   k:<구글 계정 번호>   { g: [{ id, r, n, s, at }] } — 내 번호(산 번호). r 회차, n 번호 6개, s 'm' 직접 입력 · 'g' 생성기에서 저장.
//                        본인에게만 보인다. 등수는 저장하지 않는다 — 보는 쪽(마이페이지)이 lotto-data.json 으로 그때그때 맞춘다
//   ms:<구글 계정 번호>  { ref, at } — 추첨 결과 메일 구독 (2026-10-17 의 이번 주 생성 번호 메일 구독이 그대로 이어진다. 그때 쓰던 last 칸은 쓰지 않는다)
//   mr:<회차>            { cursor, sent, tries, done, at } — 그 회차 결과 메일을 어디까지 보냈나. 2주 지나면 지운다
//                        (mw:<회차> 는 예전 생성 번호 메일의 같은 기록 — 남은 것은 같은 회차 결과 메일을 보낼 때 치운다)
//   mday                 { day, n } — 오늘(UTC 날짜, Resend 하루 한도 기준) 보낸 결과 메일 수
//   mailkey              수신 거부 링크 서명용 비밀값(처음 쓸 때 만든다)
//   e:<한국 날짜>        { gen-share, gen-print, post-share, post-sns } — 공유 · 출력 단추 하루 횟수(TAP_KINDS). 누가 눌렀는지는 없다
//   v:<글>               조회수(숫자) — 블로그 글마다 한 줄(누구나 본다). 같은 브라우저의 같은 글은 하루 한 번만 온다(js/views.js). 누가 읽었는지는 없다
//   vbase                { n: { 글: 수 }, until, at } — 조회수 시작값: 직접 세기 전(until 까지)의 Cloudflare Web Analytics 페이지뷰(tools/seed-views.js).
//                        보이는 조회수 = v:<글> + 이 값. 관리자가 통째로 갈아 끼운다
//   meta                 { users, trials, subs }
//
// 이름·사진은 받지 않는다. 이메일은 "로그인한 계정" 표시, 문의 응대, 회원이 켠 "추첨 결과 메일"에만 쓴다.

export const SESSION_DAYS = 30;
const TRIAL_MEMORY_DAYS = 365;
const MAX_SESSIONS = 5;
const DAY = 86400 * 1000;

// 내 번호: 한 회차에 20게임(용지 4장), 모두 600게임, 최근 104회차(2년)까지. 넘치면 오래된 회차부터 지운다
export const MYNUM = { perRound: 20, total: 600, rounds: 104 };
const gameKey = n => n.join(',');

export const REACT_TYPES = ['h', 'd', 'w'];   // ♥ 좋아요, $ 대박 기원, ₩ 원화

// 랭킹 점수. 바꾸려면 여기만 고친다(이용약관 7조 문구도 같이).
export const POINTS = { attend: 10, react: 2, buyPer100: 10, nickChange: 500 };   // buyPer100: 이용권 100원마다 몇 점, nickChange: 별명 바꾸기에 쓰는 포인트
// 채팅 점수 — 공지하지 않는 규칙이라 POINTS(회원에게 내려 보내는 값)와 따로 둔다.
// per: 메시지 하나에 몇 점, daily: 하루에 점수를 받는 메시지 수 상한(50개 = 5점)
export const CHAT_POINTS = { per: 0.1, daily: 50 };
// 블로그 댓글 점수 — 역시 공지하지 않는다. 댓글 하나에 1점, 하루 5개(5점)까지, 공백·기호 빼고 10자 이상, 바로 앞 댓글과 같은 말은 빼고.
// 댓글이 지워지면(본인·관리자) 그 점수도 뺀다.
export const COMMENT_POINTS = { per: 1, daily: 5, minLen: 10 };
const tenth = x => Math.round(x * 10) / 10;   // 채팅 점수(0.1)가 섞여 소수 첫째 자리까지 쓴다
const kstDay = ms => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function score(user) {
    const days = (user.att && user.att.days) || 0;
    const reacts = Object.values(user.rx || {}).reduce((n, m) => n + m.length, 0);
    const buy = Math.floor((user.buy || 0) * POINTS.buyPer100 / 100);
    const chats = (user.chat && user.chat.n) || 0;
    const comments = (user.cmPt && user.cmPt.n) || 0;
    const total = tenth(days * POINTS.attend + reacts * POINTS.react + buy + chats * CHAT_POINTS.per + comments * COMMENT_POINTS.per);
    const spent = user.spent || 0;
    return { total, days, reacts, buy, chats, comments, spent, avail: tenth(total - spent) };
}

// 회원에게 보이는 점수: 채팅·댓글 점수는 공지하지 않는 규칙이라 항목(chats·comments)을 빼고 합계에만 넣는다. 관리자 명부는 score() 그대로.
const pubScore = user => hideSecret(score(user));
function hideSecret(sc) { const s = Object.assign({}, sc); delete s.chats; delete s.comments; return s; }

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

// 공유 · 출력 집계 종류. 복사는 세지 않는다
//   gen-share: 홈 생성기 "공유"로 공유 창에서 보낼 곳을 고른 것(닫으면 세지 않는다), gen-print: 생성기 "출력"으로 인쇄 창을 연 것
//   post-share: 블로그 글 "공유하기"로 보낼 곳을 고른 것, post-sns: 블로그 글의 X · 페이스북 · 네이버 · 밴드 공유 창을 연 것
export const TAP_KINDS = ['gen-share', 'gen-print', 'post-share', 'post-sns'];

// 블로그 댓글
export const COMMENT = { max: 500, gapMs: 15000, daily: 30, list: 200 };   // 글자 수, 다음 댓글까지, 하루 최대, 한 글에 보여 주는 수
const pubComment = (c, sub) => Object.assign({ id: c.id, at: c.at, nick: c.nick, text: c.text }, c.staff ? { staff: true } : {}, sub && c.sub === sub ? { mine: true } : {});

// 댓글 점수(공지하지 않는 규칙, COMMENT_POINTS). 받았으면 true
async function commentPoint(user, text, day) {
    const plain = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    if (plain.length < COMMENT_POINTS.minLen) return false;
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cm:' + plain)));
    const h = btoa(String.fromCharCode(...d.slice(0, 12)));
    const p = user.cmPt || { n: 0, day: '', today: 0, h: '' };
    if (p.day !== day) { p.day = day; p.today = 0; }
    if (p.today >= COMMENT_POINTS.daily || p.h === h) return false;
    p.n += 1;
    p.today += 1;
    p.h = h;
    user.cmPt = p;
    return true;
}

// 내가 쓴 댓글의 별명을 한꺼번에 바꾼다(별명을 바꾸거나 관리자가 지웠을 때)
async function renameComments(storage, user) {
    for (const k of user.cm || []) {
        const c = await storage.get(k);
        if (c) { c.nick = user.nick || null; await storage.put(k, c); }
    }
}

// 랭킹 색인. 예전에는 랭킹을 볼 때마다 회원 기록(u:)을 다 읽었다 — 회원 n명이면 한 번에 n행이라 하루 읽기 한도를
// 금방 쓰고, 5,000명이 넘으면 나머지는 순위에서 빠졌다. 이제 회원 기록을 저장할 때 b: 한 줄을 같이 맞추고,
// 메모리에 점수 순으로 줄 세운 목록을 들고 있다가(처음 한 번 b: 를 읽어 만든다) 바뀐 회원만 빼고 다시 끼운다.
const BOARD_VERSION = 1;
const PAGE = 1000;

function boardEntry(user) {
    if (!user.nick || user.staff) return null;
    const s = score(user);
    return { nick: user.nick, total: s.total, days: s.days, created: user.createdAt || 0 };
}
const sameEntry = (a, b) => (!a && !b) || !!(a && b && a.nick === b.nick && a.total === b.total && a.days === b.days && a.created === b.created);
// 점수 높은 순, 같으면 먼저 가입한 순. 계정 번호는 자리를 하나로 정하려고만 쓴다
const order = (a, b) => (b.total - a.total) || (a.created - b.created) || (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0);
function seat(list, x) {   // 줄에서 x 의 자리(이진 탐색)
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (order(list[mid], x) < 0) lo = mid + 1; else hi = mid; }
    return lo;
}
function above(list, total) {   // total 보다 점수가 높은 회원 수. 같은 점수는 같은 순위라 순위 = above + 1
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].total > total) lo = mid + 1; else hi = mid; }
    return lo;
}

export class Community {
    constructor(state) {
        this.storage = state.storage;
        this.board = null;          // { bySub, list } — 랭킹 줄(메모리). 처음 랭킹을 볼 때 만든다
        this.boardLoading = null;
        this.viewBase = null;       // vbase(조회수 시작값) — 조회수를 읽을 때마다 꺼내지 않게 들고 있는다
    }

    async baseViews() {
        if (!this.viewBase) this.viewBase = (await this.storage.get('vbase')) || { n: {} };
        return this.viewBase.n;
    }

    // 회원 기록은 늘 이걸로 저장한다 — 랭킹 색인이 함께 맞춰진다
    async saveUser(user) {
        await this.storage.put('u:' + user.sub, user);
        await this.syncBoard(user.sub, boardEntry(user));
    }

    async syncBoard(sub, entry) {
        const old = this.board ? this.board.bySub.get(sub) : await this.storage.get('b:' + sub);
        if (sameEntry(old, entry)) return;
        if (entry) await this.storage.put('b:' + sub, entry); else await this.storage.delete('b:' + sub);
        if (this.boardLoading) await this.boardLoading.catch(() => {});   // 줄을 만드는 중이었으면 다 만든 뒤에 고친다
        if (!this.board) return;
        const { bySub, list } = this.board;
        const prev = bySub.get(sub);
        if (prev) list.splice(seat(list, prev), 1);
        if (entry) { const x = Object.assign({ sub }, entry); list.splice(seat(list, x), 0, x); bySub.set(sub, x); }
        else bySub.delete(sub);
    }

    async boardList() {
        if (!this.board) {
            if (!this.boardLoading) this.boardLoading = this.loadBoard().finally(() => { this.boardLoading = null; });
            await this.boardLoading;
        }
        return this.board.list;
    }

    async loadBoard() {
        if ((await this.storage.get('board')) !== BOARD_VERSION) {
            // 색인이 생기기 전에 가입한 회원: u: 를 한 번만 훑어 b: 를 채운다
            await this.each('u:', async u => { const e = boardEntry(u); if (e) await this.storage.put('b:' + u.sub, e); });
            await this.storage.put('board', BOARD_VERSION);
        }
        const bySub = new Map();
        await this.each('b:', (e, k) => { bySub.set(k.slice(2), Object.assign({ sub: k.slice(2) }, e)); });
        this.board = { bySub, list: [...bySub.values()].sort(order) };
    }

    // prefix 로 시작하는 줄을 PAGE 개씩 끊어 읽는다(한 번에 다 올리지 않게)
    async each(prefix, fn) {
        let after = null;
        for (;;) {
            const page = await this.storage.list(Object.assign({ prefix, limit: PAGE }, after ? { startAfter: after } : {}));
            for (const [k, v] of page) { await fn(v, k); after = k; }
            if (page.size < PAGE) return;
        }
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

    // 메일 비밀값(HMAC). 처음 쓸 때 만들어 저장한다
    async mailKey() {
        if (this.mailHmac) return this.mailHmac;
        let raw = await this.storage.get('mailkey');
        if (!raw) {
            raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
            await this.storage.put('mailkey', raw);
        }
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        this.mailHmac = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return this.mailHmac;
    }
    async mac(text) {
        return new Uint8Array(await crypto.subtle.sign('HMAC', await this.mailKey(), new TextEncoder().encode(text)));
    }
    async unsubToken(ref) {
        return b64url((await this.mac('unsub:' + ref)).slice(0, 16));
    }
    async bump(field, by) {
        const m = await this.meta();
        m[field] = Math.max(0, (m[field] || 0) + by);
        await this.storage.put('meta', m);
    }
}

const OPS = {
    // 구글 로그인 뒤. 처음이면 계정을 만들고, 무료 체험을 줄 수 있는지 알려 준다(trial: 가입 체험이 켜져 있을 때만).
    async login({ sub, email, subHash, ref, now, trial }) {
        let user = await this.storage.get('u:' + sub);
        const isNew = !user;
        if (!user) {
            user = { sub, email, createdAt: now, lastAt: now, trial: null, rx: {}, sess: [] };
            if (trial) {
                const used = await this.storage.get('t:' + subHash);
                if (!used || now - used.at > TRIAL_MEMORY_DAYS * DAY) {
                    user.trial = { pending: true, at: now };
                    await this.storage.put('t:' + subHash, { at: now });
                }
            }
            await this.bump('users', 1);
        }
        if (!trial) {
            // 체험을 끈 동안: 발급 도중 멈춘 체험은 버리고(받은 키는 그대로), "체험을 받은 계정" 기록은 쓸모가 없어 지운다
            if (user.trial && user.trial.pending) user.trial = null;
            const marks = await this.storage.list({ prefix: 't:', limit: 128 });
            for (const k of marks.keys()) await this.storage.delete(k);
        }
        user.email = email;
        user.lastAt = now;
        if (ref && user.ref !== ref) { user.ref = ref; await this.storage.put('m:' + ref, sub); }
        const attended = attend(user, now);
        await this.saveUser(user);
        // 발급은 처음 로그인한 요청이 한다. 단추를 두 번 눌러 겹친 요청은 건너뛰고(키가 두 개 생기지 않게),
        // 발급 도중 실패해 pending 이 1분 넘게 남았으면 다음 로그인 때 다시 발급한다.
        const pending = !!(user.trial && user.trial.pending);
        const needTrial = pending && (isNew || now - (user.trial.at || 0) > 60 * 1000);
        if (needTrial && !isNew) { user.trial.at = now; await this.saveUser(user); }
        return { isNew, needTrial, attended, user: view(user) };
    },

    // 번호 생성기 설정 저장(gen 은 index.js 가 다듬어 넘긴다). null 이면 지운다
    async setGen({ sub, gen }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        if (gen) user.gen = gen; else delete user.gen;
        await this.saveUser(user);
        return { ok: true, user: view(user) };
    },

    async setTrial({ sub, trial }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { ok: false };
        const first = !(user.trial && user.trial.key);
        user.trial = trial;
        await this.saveUser(user);
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
        await this.saveUser(user);
        await renameComments(this.storage, user);
        return { ok: true, user: view(user), cost };
    },

    // 관리자가 운영자 계정을 지정하거나 푼다
    async setStaff({ sub, on }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        user.staff = !!on;
        await this.saveUser(user);
        return { ok: true };
    },

    async sessionCreate({ sub, hash, exp }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { ok: false };
        user.sess = (user.sess || []).concat(hash);
        while (user.sess.length > MAX_SESSIONS) await this.storage.delete('s:' + user.sess.shift());
        await this.storage.put('s:' + hash, { sub, exp });
        await this.saveUser(user);
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
            if (attended) { user.lastAt = now; await this.saveUser(user); }
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
        await this.saveUser(user);
        return { counted: true, today: c.today };
    },

    // 로그인한 채 산 이용권: 결제되면 +금액, 환불되면 -금액 (랭킹 점수용)
    async credit({ ref, amount }) {
        const sub = await this.storage.get('m:' + ref);
        const user = sub && await this.storage.get('u:' + sub);
        if (!user) return { ok: false };
        user.buy = Math.max(0, (user.buy || 0) + amount);
        await this.saveUser(user);
        return { ok: true };
    },

    // 랭킹: 별명을 정한 회원만 공개 목록에 오른다(상위 50명). 내 순위는 별명이 없어도 알려 준다(별명 없는 나를 끼워 센다).
    // 메모리의 랭킹 줄로 센다 — 회원이 몇 명이든 읽는 것은 내 기록 한 줄뿐이다.
    async ranking({ sub, limit }) {
        const list = await this.boardList();
        const top = list.slice(0, limit || 50).map(x => ({ rank: above(list, x.total) + 1, nick: x.nick, points: x.total, days: x.days }));
        let me = null;
        const user = sub && await this.storage.get('u:' + sub);
        if (user && !user.staff) {   // 운영자는 순위에서 뺀다
            const s = score(user);
            me = Object.assign({ rank: above(list, s.total) + 1, of: list.length + (user.nick ? 0 : 1), nick: user.nick || null }, hideSecret(s));
        }
        return { top, me, total: list.length };
    },

    async sessionDelete({ hash }) {
        const s = await this.storage.get('s:' + hash);
        await this.storage.delete('s:' + hash);
        if (s) {
            const user = await this.storage.get('u:' + s.sub);
            if (user) {
                user.sess = (user.sess || []).filter(h => h !== hash);
                await this.saveUser(user);
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
        await this.storage.delete('k:' + sub);   // 내 번호
        if (await this.storage.delete('ms:' + sub)) await this.bump('subs', -1);   // 추첨 결과 메일 구독
        await this.storage.delete('u:' + sub);
        await this.syncBoard(sub, null);
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
        await this.saveUser(user);
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

    // 공유 · 출력 집계(index.js 의 /api/tap). 한국 날짜 하루에 한 줄, 종류별 횟수만
    async tap({ kind, now }) {
        const k = 'e:' + kstDay(now);
        const day = (await this.storage.get(k)) || {};
        day[kind] = (day[kind] || 0) + 1;
        await this.storage.put(k, day);
        return { ok: true };
    },

    // 블로그 조회수(index.js 의 /api/view · /api/views). 글마다 한 줄, 횟수만
    // 돌려주는 수에는 시작값(vbase)을 더한다
    async view({ post }) {
        const n = ((await this.storage.get('v:' + post)) || 0) + 1;
        await this.storage.put('v:' + post, n);
        return { views: { [post]: n + ((await this.baseViews())[post] || 0) } };
    },
    async views({ posts }) {
        const got = await this.storage.get(posts.map(p => 'v:' + p));
        const base = await this.baseViews();
        const out = {};
        posts.forEach(p => { out[p] = (got.get('v:' + p) || 0) + (base[p] || 0); });
        return { views: out };
    },

    // 관리자: 시작값을 통째로 갈아 끼운다(같은 값으로 다시 넣어도 두 번 더해지지 않는다). n 은 index.js 가 다듬어 넘긴다
    async setViewBase({ n, until, now }) {
        const rec = { n, until, at: now };
        await this.storage.put('vbase', rec);
        this.viewBase = rec;
        return { ok: true, posts: Object.keys(n).length };
    },
    // 관리자: 글별 직접 센 수와 시작값
    async viewStats() {
        const counted = {};
        await this.each('v:', (n, k) => { counted[k.slice(2)] = n; });
        const rec = (await this.storage.get('vbase')) || { n: {} };
        return { counted, base: rec.n, until: rec.until || null, at: rec.at || null };
    },

    // 관리자 페이지: 날짜별 집계, 최근 날짜가 먼저
    async taps() {
        const days = [];
        await this.each('e:', (v, k) => { days.push(Object.assign({ day: k.slice(2) }, v)); });
        return { days: days.reverse() };
    },

    // 관리자 페이지: 회원 명부와 카드별 좋아요 합계
    async adminList() {
        const users = await this.storage.list({ prefix: 'u:', limit: 2000 });
        const members = [];
        for (const u of users.values()) {
            const rx = Object.values(u.rx || {});
            members.push({
                sub: u.sub, ref: u.ref || null, email: u.email, nick: u.nick || null, createdAt: u.createdAt, lastAt: u.lastAt,
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
        await this.saveUser(user);
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
        else if (await commentPoint(user, text, day)) c.pt = 1;   // 지울 때 점수를 되돌리려고 표시해 둔다
        const key = 'c:' + post + ':' + id;
        await this.storage.put(key, c);
        user.cm = (user.cm || []).concat(key);
        user.cmAt = now;
        user.cmDay = { day, n: d.n + 1 };
        await this.saveUser(user);
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
        if (user) {
            user.cm = (user.cm || []).filter(k => k !== key);
            if (c.pt && user.cmPt) user.cmPt.n = Math.max(0, user.cmPt.n - 1);
            await this.saveUser(user);
        }
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

/* ───── 내 번호 · 추첨 결과 메일 ───── */
// OPS 에 합친다(아래 Object.assign). 번호는 index.js 가 다듬어(cleanGame) 넘긴다
const NUM_OPS = {
    async numbersGet({ sub }) {
        const k = (await this.storage.get('k:' + sub)) || { g: [] };
        return { games: k.g };
    },

    // games: [[6개], …] 같은 회차. 같은 회차에 이미 있는 조합은 건너뛴다
    async numbersAdd({ sub, round, games, src, now }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        const k = (await this.storage.get('k:' + sub)) || { g: [] };
        const have = new Set(k.g.filter(x => x.r === round).map(x => gameKey(x.n)));
        let room = MYNUM.perRound - have.size;
        let added = 0, dup = 0, full = 0;
        for (const n of games) {
            if (have.has(gameKey(n))) { dup++; continue; }
            if (room <= 0) { full++; continue; }
            have.add(gameKey(n));
            k.g.push({ id: Math.random().toString(36).slice(2, 10), r: round, n, s: src === 'g' ? 'g' : 'm', at: now });
            room--;
            added++;
        }
        // 최근 회차가 앞으로, 같은 회차는 넣은 차례대로
        k.g.sort((a, b) => (b.r - a.r) || (a.at - b.at));
        const rounds = [...new Set(k.g.map(x => x.r))];
        if (rounds.length > MYNUM.rounds) { const keep = new Set(rounds.slice(0, MYNUM.rounds)); k.g = k.g.filter(x => keep.has(x.r)); }
        if (k.g.length > MYNUM.total) k.g = k.g.slice(0, MYNUM.total);
        if (added) await this.storage.put('k:' + sub, k);
        return { games: k.g, added, dup, full };
    },

    // 한 게임(id) 또는 한 회차(round) 지우기
    async numbersDelete({ sub, id, round }) {
        const k = await this.storage.get('k:' + sub);
        if (!k) return { games: [] };
        const before = k.g.length;
        k.g = k.g.filter(x => (id ? x.id !== id : x.r !== round));
        if (k.g.length !== before) {
            if (k.g.length) await this.storage.put('k:' + sub, k); else await this.storage.delete('k:' + sub);
        }
        return { games: k.g, removed: before - k.g.length };
    },

    // 메일 켜기 · 끄기 (회원이 직접)
    async mailSet({ sub, on, ref, now }) {
        const user = await this.storage.get('u:' + sub);
        if (!user) return { error: 'no_user' };
        const cur = await this.storage.get('ms:' + sub);
        if (on && !cur) { await this.storage.put('ms:' + sub, { ref, at: now }); await this.bump('subs', 1); }
        if (!on && cur) { await this.storage.delete('ms:' + sub); await this.bump('subs', -1); }
        return { mail: !!on };
    },
    async mailGet({ sub }) {
        return { mail: !!(await this.storage.get('ms:' + sub)) };
    },

    // 수신 거부 링크(로그인 없이). 참조값 + 서명이 맞으면 끈다. 이미 꺼져 있어도 ok
    async mailUnsub({ ref, token }) {
        if (!ref || !token || token !== await this.unsubToken(ref)) return { error: 'bad_token' };
        const sub = await this.storage.get('m:' + ref);
        if (sub && await this.storage.delete('ms:' + sub)) await this.bump('subs', -1);
        return { ok: true };
    },

    // 그 회차 결과 메일을 보낼 다음 묶음(구독자 최대 limit 명을 훑는다). 그 회차 번호를 내 번호에 저장한 구독자만 —
    // 저장한 번호가 없으면 건너뛴다(보낼 것이 당첨번호뿐이다). 등수는 index.js 가 당첨번호와 맞춘다
    async mailPrepare({ round, limit }) {
        const st = (await this.storage.get('mr:' + round)) || { cursor: '', sent: 0, tries: 0, done: false };
        if (st.done) return { items: [], state: st };
        const page = await this.storage.list(Object.assign({ prefix: 'ms:', limit }, st.cursor ? { startAfter: st.cursor } : {}));
        const subs = [...page.keys()].map(k => k.slice(3));
        const users = subs.length ? await this.storage.get(subs.map(s => 'u:' + s)) : new Map();
        const nums = subs.length ? await this.storage.get(subs.map(s => 'k:' + s)) : new Map();
        const items = [];
        let cursor = st.cursor;
        for (const sub of subs) {
            cursor = 'ms:' + sub;
            const m = page.get('ms:' + sub);
            const u = users.get('u:' + sub);
            const k = nums.get('k:' + sub);
            const games = k ? k.g.filter(x => x.r === round).map(x => x.n) : [];
            if (!u || !u.email || !games.length) continue;
            items.push({ sub, ref: m.ref, email: u.email, token: await this.unsubToken(m.ref), games });
        }
        return { items, cursor, more: page.size === limit, state: st };
    },

    // 보낸 묶음 기록: 어디까지 보냈는지 · 오늘 몇 통인지 올린다
    async mailCommit({ round, cursor, sent, done, now, day }) {
        const st = (await this.storage.get('mr:' + round)) || { cursor: '', sent: 0, tries: 0, done: false };
        st.cursor = cursor || st.cursor;
        st.sent += sent || 0;
        st.tries = 0;
        st.at = now;
        if (done) st.done = true;
        await this.storage.put('mr:' + round, st);
        if (sent) {
            const d = (await this.storage.get('mday')) || { day: '', n: 0 };
            if (d.day !== day) { d.day = day; d.n = 0; }
            d.n += sent;
            await this.storage.put('mday', d);
        }
        // 지난 회차 기록은 2주 뒤 지운다. 예전 생성 번호 메일의 같은 회차 기록(mw:, 1246회 하나뿐)도 함께
        await this.storage.delete(['mr:' + (round - 2), 'mr:' + (round - 3), 'mw:' + round]);
        return { state: st };
    },

    // 보내기 실패: 세 번 연달아 실패하면 그 회차는 그만둔다(index.js 가 알린다)
    async mailFail({ round, now, max }) {
        const st = (await this.storage.get('mr:' + round)) || { cursor: '', sent: 0, tries: 0, done: false };
        st.tries += 1;
        st.at = now;
        if (st.tries >= (max || 3)) { st.done = true; st.gaveUp = true; }
        await this.storage.put('mr:' + round, st);
        return { state: st };
    },

    async mailStatus({ round, day }) {
        const st = (await this.storage.get('mr:' + round)) || null;
        const d = (await this.storage.get('mday')) || { day: '', n: 0 };
        return { state: st, today: d.day === day ? d.n : 0, subs: (await this.meta()).subs || 0 };
    },
};
Object.assign(OPS, NUM_OPS);

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function view(user) {
    const trial = user.trial && user.trial.key ? { key: user.trial.key, keyId: user.trial.keyId, expiresAt: user.trial.expiresAt } : null;
    return { email: user.email, nick: user.nick || null, createdAt: user.createdAt, trial, score: pubScore(user), staff: !!user.staff, gen: user.gen || null };
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
