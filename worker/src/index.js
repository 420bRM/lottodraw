// lottodraw.kr 결제·이용권 서버 (Cloudflare Worker)
//
// 하는 일
//   1) 주문 받기 — 계좌이체(기본) 또는 페이앱 카드결제(설정했을 때만).
//      계좌이체 주문은 금액 끝자리를 주문마다 다르게(1~99원 할인) 매겨, 금액만 보고도 주문을 찾는다.
//   2) 입금이 확인되면 서명된 이용권 키 자동 발급 — 판매자 휴대폰이 은행 입금 알림을 이 서버로
//      넘겨주면(입금 알림 연결) 사람 손 없이 바로 발급한다. 새벽에도. 페이앱은 페이앱 통보로.
//   3) 환불 — 키 발급 뒤 단순 변심 환불은 없다(이용약관 4조). 키가 작동하지 않거나 중복 입금한 경우
//      구매자가 문의하면 판매자가 관리자 페이지에서 "환불 처리"를 누른다: 키 정지, 카드는 결제 취소까지.
//   4) 지킴이 — 한 시간마다 입금 알림 연결이 살아 있는지 보고, 끊기면 판매자에게 알린다.
//   5) 회원 — 구글 로그인, 좋아요(하트·달러). 가입 무료 체험 키(1회)는 SIGNUP_TRIAL_DAYS 를 넣을 때만 — 2026-10-11부터 끔. 저장은 community.js.
//   6) 내 번호 — 회원이 산 번호를 회차별로 저장(마이페이지가 당첨번호와 맞춰 등수를 보여 준다). 저장은 community.js 의 k:
//   7) 추첨 결과 메일 — 구독한 회원에게 일요일 오전부터 그 회차 당첨번호와 내 번호에 저장한 번호의 등수를 보낸다(resultMail).
//      그 회차 번호를 저장하지 않은 회원에게는 보내지 않는다.
//      결제와 따로 돈다: 실패해도 주문 · 발급 · 지킴이에 영향이 없다. KV 를 쓰지 않는다.
//   8) 공유 · 출력 집계 — 홈 생성기 공유 · 출력, 블로그 글 공유 단추의 하루 횟수(/api/tap). 관리자 페이지에서 본다.
//
// 키 확인은 브라우저가 공개키로 혼자 한다(js/license.js). 이 서버가 멈춰도
// 이미 산 사람의 잠금은 풀린다. 서버가 필요한 건 "팔 때"뿐이다.
//
// 저장소: KV 하나(DB). order:<주문번호>, keyidx:<키번호>, amt:<금액>, hook:<알림해시>,
//         meta:signing-key, meta:revoked, meta:hook, meta:hook-secret.
//         회원·세션·좋아요·공유 집계는 Durable Object(COMMUNITY, community.js) — KV 쓰기 한도를 결제에 남겨 둔다.
// 비밀값과 설정은 README "4. 유료화" 와 worker/wrangler.toml 참고.

import { generateKeyPair, importPrivate, importPublic, signKey, verifyKey, parseKey, hex32, publicOnly, keyId, b64urlEncode } from './keys.js';
import { plansFor } from './plans.js';
import { community, SESSION_DAYS, REACT_TYPES, ITEM_RE, POINTS, COMMENT, TAP_KINDS } from './community.js';
import { verifyGoogleToken } from './google.js';
import { saleRound, cleanGame, rankOf, kstParts, drawDay } from './lotto.js';

import { chatStub, checkText } from './chat.js';

export { Community } from './community.js';
export { ChatRoom } from './chat.js';

const PAYAPP_API = 'https://api.payapp.kr/oapi/apiLoad.html';
const DEPOSIT_HOURS = 72;              // 입금 기한 안내용. 지나도 관리자는 확인할 수 있다
const PENDING_TTL = 14 * 86400;        // 입금 안 된 주문은 14일 뒤 KV 에서 저절로 지워진다
const MAX_PENDING = 50;                // 기한 안의 입금 대기 주문이 이만큼 쌓이면 새 주문을 잠시 막는다 (도배 방지)
const MAX_PENDING_PER_IP = 3;          // 한 곳(IP)에서 기한 안에 걸어 둘 수 있는 입금 대기 주문 수
const HOOK_DEDUPE_TTL = 30 * 86400;    // 같은 입금 알림을 두 번 처리하지 않도록 기억하는 기간
const MAX_DISCOUNT = 99;               // 계좌이체 주문 확인용 끝자리 할인 (1~99원)
const AMT_PREFIX = 'amt:';             // 입금 대기 중인 계좌이체 주문의 금액 색인 (amt:5866 → 주문번호)
const HOOK_SILENCE_HOURS = 13;         // 입금 알림 연결(휴대폰)이 이만큼 조용하면 끊긴 것으로 본다 (6시간마다 신호)
const MAX_BODY = 4096;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

class HttpError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export default {
    // 한 시간마다: 입금 알림 연결이 살아 있는지 확인 (wrangler.toml [triggers])
    // 추첨 결과 메일도 같은 한 시간 예약에서 돈다 — 따로 waitUntil 에 넣어 한쪽이 실패해도 다른 쪽은 그대로 간다
    async scheduled(event, env, ctx) {
        ctx.waitUntil(watchdog(env));
        ctx.waitUntil(resultMail(env, Date.now()).catch(err => console.error('result mail', err)));
    },
    async fetch(request, env, ctx) {
        try {
            return await route(request, env, ctx || { waitUntil() {} });
        } catch (err) {
            if (err instanceof HttpError) {
                return json(request, env, { error: err.code, message: err.message }, err.status);
            }
            console.error(err);
            return json(request, env, { error: 'server', message: '서버 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.' }, 500);
        }
    },
};

/* ───── 라우팅 ───── */

async function route(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env, true) });

    if (path === '/' || path === '/api') return json(request, env, { ok: true, service: 'lottodraw-api' });
    if (path === '/api/config' && method === 'GET') return getConfig(request, env);
    if (path === '/api/pubkey' && method === 'GET') return getPubkey(request, env);
    if (path === '/api/revoked' && method === 'GET') return getRevoked(request, env);
    if (path === '/api/orders' && method === 'POST') return createOrder(request, env, ctx, url);

    let m = path.match(/^\/api\/orders\/([0-9A-Z]{8})$/);
    if (m && method === 'GET') return getOrder(request, env, m[1], url.searchParams.get('token'));
    m = path.match(/^\/api\/orders\/([0-9A-Z]{8})\/cancel$/);
    if (m && method === 'POST') return buyerCancel(request, env, m[1]);

    if (path === '/api/refunds' && method === 'POST') return requestRefund(request);
    if (path === '/api/payapp/feedback' && method === 'POST') return payappFeedback(request, env, ctx);
    if (path === '/api/hooks/deposit' && method === 'POST') return depositHook(request, env, ctx, url);

    if (path === '/api/auth/google' && method === 'POST') return googleLogin(request, env, ctx);
    if (path === '/api/auth/logout' && method === 'POST') return logout(request, env);
    if (path === '/api/me' && method === 'GET') return me(request, env);
    if (path === '/api/me/delete' && method === 'POST') return deleteMe(request, env, ctx);
    if (path === '/api/me/nickname' && method === 'POST') return setNickname(request, env);
    if (path === '/api/me/generator' && method === 'POST') return saveGenerator(request, env);
    if (path === '/api/me/numbers' && method === 'GET') return getNumbers(request, env);
    if (path === '/api/me/numbers' && method === 'POST') return addNumbers(request, env);
    if (path === '/api/me/numbers/delete' && method === 'POST') return deleteNumbers(request, env);
    if (path === '/api/me/mail' && method === 'POST') return setMail(request, env);
    if (path === '/api/mail/unsubscribe' && (method === 'GET' || method === 'POST')) return unsubscribe(request, env, url);
    if (path === '/api/reactions' && method === 'GET') return getReactions(request, env, url);
    if (path === '/api/ranking' && method === 'GET') return getRanking(request, env);
    if (path === '/api/chat' && method === 'GET') return chatConnect(request, env);
    if (path === '/api/chat/info' && method === 'GET') return chatInfo(request, env);
    if (path === '/api/reactions' && method === 'POST') return react(request, env);
    if (path === '/api/comments' && method === 'GET') return getComments(request, env, url);
    if (path === '/api/comments' && method === 'POST') return addComment(request, env, ctx);
    if (path === '/api/comments/delete' && method === 'POST') return deleteComment(request, env);
    if (path === '/api/tap' && method === 'POST') return tap(request, env);

    if (path.startsWith('/api/admin/')) {
        if (!adminOk(request, env)) throw new HttpError(401, 'unauthorized', '관리자 토큰이 맞지 않습니다.');
        return admin(request, env, path.slice('/api/admin'.length), method, url);
    }
    throw new HttpError(404, 'not_found', '없는 주소입니다.');
}

/* ───── 공개 ───── */

function methodsOf(env) {
    return {
        bank: !!(env.BANK_NAME && env.BANK_ACCOUNT && env.BANK_HOLDER),
        payapp: !!(env.PAYAPP_USERID && env.PAYAPP_LINKKEY && env.PAYAPP_LINKVAL),
    };
}

function bankInfo(env) {
    const name = String(env.BANK_NAME || '');
    return {
        bank: name,
        account: String(env.BANK_ACCOUNT || ''),
        holder: String(env.BANK_HOLDER || ''),
        // 토스 송금 딥링크(supertoss://send)에 쓰는 은행 이름. "우리은행" → "우리"
        tossBank: String(env.BANK_TOSS_NAME || name.replace(/은행$/, '')),
    };
}

function publicPlans(env) {
    const plans = plansFor(env);
    const out = {};
    Object.keys(plans).forEach(id => { out[id] = { amount: plans[id].amount, days: plans[id].days }; });
    return out;
}

async function getConfig(request, env) {
    return json(request, env, {
        methods: methodsOf(env),
        plans: publicPlans(env),
        depositHours: DEPOSIT_HOURS,
        // 입금 알림 연결이 살아 있으면 계좌이체도 몇 분 안에 저절로 열린다. 화면 안내 문구가 이걸 따른다.
        autoConfirm: await hookAlive(env),
        // 구글 로그인(가입하면 무료 체험 + 좋아요). 클라이언트 ID 를 넣기 전에는 화면에 로그인 단추가 없다.
        login: loginReady(env) ? { google: env.GOOGLE_CLIENT_ID, trialDays: signupTrialDays(env) } : null,
        chat: chatReady(env),
    }, 200, { 'Cache-Control': 'public, max-age=60' }, true);
}

async function getPubkey(request, env) {
    const s = await signer(env);
    if (!s) throw new HttpError(404, 'no_key', '아직 서명 키가 없습니다.');
    return json(request, env, { kid: s.kid, jwk: s.publicJwk }, 200, { 'Cache-Control': 'public, max-age=3600' }, true);
}

async function getRevoked(request, env) {
    const r = await revokedList(env);
    return json(request, env, { ids: r.ids, updatedAt: r.updatedAt }, 200, { 'Cache-Control': 'public, max-age=30' }, true);
}

async function createOrder(request, env, ctx, url) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (env.ORDER_LIMIT && typeof env.ORDER_LIMIT.limit === 'function') {
        const { success } = await env.ORDER_LIMIT.limit({ key: ip });
        if (!success) throw new HttpError(429, 'too_many', '주문이 너무 잦습니다. 1분 뒤 다시 시도해 주세요.');
    }
    const body = await readJson(request);
    const plans = plansFor(env);
    if (!has(plans, body.plan)) throw new HttpError(400, 'bad_plan', '이용권 종류가 올바르지 않습니다.');
    const plan = plans[body.plan];
    const method = body.method;
    const methods = methodsOf(env);
    if ((method !== 'bank' && method !== 'payapp') || !methods[method]) {
        throw new HttpError(400, 'bad_method', '지금은 이 결제 방법을 쓸 수 없습니다.');
    }
    if (body.agree !== true) throw new HttpError(400, 'need_agree', '환불 기준에 동의해 주세요.');

    const name = cleanText(body.name, 20);
    const contact = cleanText(body.contact, 100);
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (method === 'bank' && name.length < 2) throw new HttpError(400, 'need_name', '입금자명을 2자 이상 적어 주세요.');
    if (method === 'payapp' && !/^01\d{8,9}$/.test(phone)) throw new HttpError(400, 'need_phone', '휴대폰 번호를 확인해 주세요.');
    // 연락은 이메일로만 받는다 (키 재발송·문의 기록이 남게). 비워 두는 것은 괜찮다.
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) throw new HttpError(400, 'bad_contact', '이메일 주소를 적어 주세요. 키를 다시 보내 드릴 때만 씁니다.');

    // 기한(72시간)이 지난 대기 주문은 세지 않는다. 버려진 주문이 쌓여 가게가 닫히는 일을 막는다.
    const ipTag = (await sha256('ip:' + ip)).slice(0, 12);
    const allPending = await listOrders(env, 'pending');
    const fresh = allPending.filter(o => (o.c || 0) > Date.now() - DEPOSIT_HOURS * 3600 * 1000);
    if (fresh.filter(o => o.i === ipTag).length >= MAX_PENDING_PER_IP) {
        throw new HttpError(429, 'too_many_pending', '입금을 기다리는 주문이 이미 있습니다. 먼저 입금하거나 이전 주문을 취소해 주세요.');
    }
    if (fresh.length >= MAX_PENDING) throw new HttpError(503, 'busy', '주문이 밀려 있습니다. 잠시 뒤 다시 시도해 주세요.');

    // 계좌이체는 입금 대기 중인 다른 주문과 겹치지 않는 금액을 매긴다 (정가에서 1~99원 할인)
    const amount = method === 'bank' ? await pickAmount(env, plan.amount, allPending) : plan.amount;
    const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const now = Date.now();
    const order = {
        id: await freshId(env),
        tokenHash: await sha256(token),
        plan: body.plan,
        planName: plan.name,
        listPrice: plan.amount,
        amount,
        method,
        name: name || '',
        contact: contact || '',
        phoneTail: phone ? phone.slice(-4) : '',
        ipTag,
        status: 'pending',
        createdAt: now,
        deadline: now + DEPOSIT_HOURS * 3600 * 1000,
        agreedAt: now,
        log: [{ at: now, what: 'created' }],
    };
    const ref = await orderMember(request, env);
    if (ref) order.memberRef = ref;

    let payurl = null;
    if (method === 'payapp') {
        const r = await payappRequest(env, order, phone, apiOrigin(env, url));
        if (!r.ok) {
            throw new HttpError(502, 'payapp_failed', '카드 결제창을 열지 못했습니다: ' + r.message);
        }
        order.payapp = { mulNo: r.mulNo };
        payurl = r.payurl;
    }
    await save(env, order);
    ctx.waitUntil(notify(env, [
        `새 주문 ${order.id} (입금되면 자동 발급)`,
        `${order.planName} ${won(order.amount)} · ${method === 'bank' ? '계좌이체' : '카드(페이앱)'}`,
        method === 'bank' ? `입금자명: ${order.name}` : `휴대폰 끝자리: ${order.phoneTail}`,
        `${siteUrl(env)}/admin.html#${order.id}`,
    ].join('\n')));

    return json(request, env, { order: publicView(order, env), token, payurl }, 201);
}

// KV 목록(list)은 방금 저장한 주문을 곧바로 보여 주지 않는다(최대 1분쯤 늦다). 그래서 목록에 더해
// 금액 색인(amt:금액 → 주문번호)도 직접 확인한다. 연달아 들어온 주문끼리도 금액이 겹치지 않게.
async function pickAmount(env, base, pending) {
    const taken = new Set(pending.filter(o => o.m === 'bank').map(o => o.a));
    const free = async amount => !taken.has(amount) && !(await env.DB.get(AMT_PREFIX + amount));
    for (let i = 0; i < 60; i++) {
        const off = 1 + (crypto.getRandomValues(new Uint8Array(1))[0] % MAX_DISCOUNT);
        if (await free(base - off)) return base - off;
    }
    for (let off = 1; off <= MAX_DISCOUNT; off++) if (await free(base - off)) return base - off;
    throw new HttpError(503, 'busy', '주문이 밀려 있습니다. 잠시 뒤 다시 시도해 주세요.');
}

async function getOrder(request, env, id, token) {
    const order = await load(env, id);
    if (!order || !(await tokenOk(order, token))) throw new HttpError(404, 'no_order', '주문을 찾을 수 없습니다.');
    return json(request, env, { order: publicView(order, env) });
}

async function buyerCancel(request, env, id) {
    const body = await readJson(request);
    const order = await load(env, id);
    if (!order || !(await tokenOk(order, body.token))) throw new HttpError(404, 'no_order', '주문을 찾을 수 없습니다.');
    if (order.status === 'pending') {
        order.status = 'cancelled';
        order.cancelledAt = Date.now();
        order.log.push({ at: order.cancelledAt, what: 'cancelled', by: 'buyer' });
        await save(env, order);
    }
    return json(request, env, { order: publicView(order, env) });
}

function publicView(order, env) {
    const v = {
        id: order.id,
        plan: order.plan,
        planName: order.planName,
        amount: order.amount,
        listPrice: order.listPrice || order.amount,
        method: order.method,
        status: order.status,
        name: order.name,
        createdAt: order.createdAt,
        deadline: order.deadline,
        paidAt: order.paidAt || null,
        expiresAt: order.expiresAt || null,
    };
    if (order.status === 'paid') { v.key = order.key; v.mailed = !!order.mailedAt; }
    if (order.method === 'bank' && order.status === 'pending' && methodsOf(env).bank) v.bank = bankInfo(env);
    return v;
}

/* ───── 페이앱 ───── */

async function payappRequest(env, order, phone, origin) {
    const form = new URLSearchParams({
        cmd: 'payrequest',
        userid: env.PAYAPP_USERID,
        goodname: `lottodraw.kr ${order.planName}`,
        price: String(order.amount),
        recvphone: phone,
        feedbackurl: `${origin}/api/payapp/feedback`,
        var1: order.id,
        smsuse: 'n',
        redirectpay: '1',
        skip_cstpage: 'y',
        checkretry: 'y',
        returnurl: `${siteUrl(env)}/statistics.html?order=${order.id}`,
    });
    if (env.PAYAPP_OPENPAYTYPE) form.set('openpaytype', env.PAYAPP_OPENPAYTYPE);
    let res;
    try {
        res = await fetch(PAYAPP_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });
    } catch (e) {
        return { ok: false, message: '페이앱 연결 실패' };
    }
    const r = new URLSearchParams(await res.text());
    if (r.get('state') !== '1' || !r.get('payurl')) return { ok: false, message: r.get('errorMessage') || `HTTP ${res.status}` };
    return { ok: true, mulNo: r.get('mul_no'), payurl: r.get('payurl') };
}

// 페이앱이 결제 결과를 서버끼리 알려 주는 곳. 'SUCCESS' 로 답하지 않으면 다시 보낸다.
async function payappFeedback(request, env, ctx) {
    const f = new URLSearchParams(await request.text());
    const methods = methodsOf(env);
    if (!methods.payapp
        || f.get('userid') !== env.PAYAPP_USERID
        || !safeEqual(f.get('linkkey') || '', env.PAYAPP_LINKKEY)
        || !safeEqual(f.get('linkval') || '', env.PAYAPP_LINKVAL)) {
        return text('FAIL', 403);
    }
    const order = await load(env, f.get('var1') || '');
    const state = f.get('pay_state');
    if (!order || order.method !== 'payapp') {
        ctx.waitUntil(notify(env, `페이앱 통보: 모르는 주문 ${f.get('var1')} (상태 ${state}, ${f.get('price')}원)`));
        return text('SUCCESS');
    }
    if (order.payapp && order.payapp.mulNo && f.get('mul_no') && String(order.payapp.mulNo) !== f.get('mul_no')) {
        ctx.waitUntil(notify(env, `페이앱 통보: 주문 ${order.id} 의 결제요청번호가 다릅니다 (${f.get('mul_no')})`));
        return text('SUCCESS');
    }
    if (state === '4') {
        if (order.status === 'refunded' || order.status === 'refund_requested') {
            ctx.waitUntil(notify(env, `페이앱 통보: 이미 환불된 주문 ${order.id} 에 결제 완료가 왔습니다 — 페이앱 판매자 화면에서 확인 필요`));
            return text('SUCCESS');
        }
        if (Number(f.get('price')) !== order.amount) {
            ctx.waitUntil(notify(env, `페이앱 통보: 주문 ${order.id} 금액 불일치 (${f.get('price')}원, 주문 ${order.amount}원) — 확인 필요`));
            return text('SUCCESS');
        }
        const wasPaid = order.status === 'paid';
        await confirm(env, order, 'payapp');
        if (!wasPaid) ctx.waitUntil(notify(env, `카드 결제 완료 ${order.id}\n${order.planName} ${won(order.amount)} · 키 ${order.keyId}`));
    } else if (['9', '64', '70', '71'].indexOf(state) !== -1) {
        if (order.status === 'paid' || order.status === 'refund_requested') {
            await refund(env, order, 'payapp');
            ctx.waitUntil(notify(env, `카드 결제 취소 ${order.id} → 키 ${order.keyId} 정지`));
        }
    } else if (state === '8' || state === '32') {
        if (order.status === 'pending') {
            order.status = 'cancelled';
            order.cancelledAt = Date.now();
            order.log.push({ at: order.cancelledAt, what: 'cancelled', by: 'payapp' });
            await save(env, order);
        }
    }
    return text('SUCCESS');
}

/* ───── 입금 알림 연결 (자동 입금 확인) ─────
 * 판매자 휴대폰이 은행 입금 알림(앱 푸시나 문자)을 이 주소로 넘긴다.
 *   안드로이드: MacroDroid "알림 수신" → HTTP 요청,  아이폰: 단축어 "메시지 수신" 자동화 → URL 콘텐츠 가져오기
 * 계좌이체 주문은 금액 끝자리가 주문마다 달라서, 알림 속 금액과 같은 입금 대기 주문이
 * 하나뿐이면 그 주문으로 보고 바로 키를 발급한다. 금액이 같은 주문이 여럿이면(오래된 대기 주문)
 * 입금자명으로 한 번 더 좁히고, 그래도 애매하면 발급하지 않고 판매자에게 알린다.
 * 휴대폰은 6시간마다 "ping" 을 보내 연결이 살아 있음을 알린다 (끊기면 지킴이가 경보).
 */
async function hookSecrets(env) {
    const out = [];
    if ((env.DEPOSIT_HOOK_SECRET || '').length >= 16) out.push(env.DEPOSIT_HOOK_SECRET);
    const kv = await env.DB.get('meta:hook-secret');
    if (kv && kv.length >= 16) out.push(kv);
    return out;
}

async function hookAlive(env) {
    if (!(await hookSecrets(env)).length) return false;
    const h = await env.DB.get('meta:hook', 'json');
    return !!(h && h.lastAt && Date.now() - h.lastAt < HOOK_SILENCE_HOURS * 3600 * 1000);
}

async function touchHook(env, kind) {
    const h = (await env.DB.get('meta:hook', 'json')) || {};
    const now = Date.now();
    h.lastAt = now;
    h[kind + 'At'] = now;
    await env.DB.put('meta:hook', JSON.stringify(h));
}

async function depositHook(request, env, ctx, url) {
    const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '') || url.searchParams.get('key') || '';
    const secrets = await hookSecrets(env);
    if (!secrets.length || !secrets.some(sec => safeEqual(given, sec))) throw new HttpError(401, 'unauthorized', '열쇠가 맞지 않습니다.');

    const raw = await readBody(request);
    let data = {};
    const type = request.headers.get('Content-Type') || '';
    if (type.indexOf('json') !== -1) { try { data = JSON.parse(raw); } catch (e) { data = {}; } }
    else if (type.indexOf('form') !== -1) { data = Object.fromEntries(new URLSearchParams(raw)); }
    else data = { text: raw };
    const textBody = String(data.text || '').trim();

    // 살아 있다는 신호
    if (data.ping || /^ping$/i.test(textBody)) {
        await touchHook(env, 'ping');
        return json(request, env, { ok: true, pong: true });
    }
    if (/출금/.test(textBody) && !/입금/.test(textBody)) {
        await touchHook(env, 'other');
        return json(request, env, { matched: null, reason: 'withdrawal' });
    }
    // 입금 알림만 다룬다. 카드 승인·광고처럼 금액이 든 다른 알림을 주문과 맞추지 않게.
    // (은행 앱 알림 전체를 넘겨도 된다: 우리WON "입금 5,866원 …", 카카오뱅크 "입금 5,866원 홍길동 → 통장")
    if (!data.amount && !/입금/.test(textBody)) {
        await touchHook(env, 'other');
        return json(request, env, { matched: null, reason: 'not_deposit' });
    }
    const amounts = data.amount ? [Number(String(data.amount).replace(/\D/g, ''))] : amountsIn(textBody);
    if (!amounts.length) {
        await touchHook(env, 'other');
        return json(request, env, { matched: null, reason: 'no_amount' });
    }

    // 같은 알림이 두 번 오면(재전송, 재생) 두 번째는 무시한다
    const seenKey = 'hook:' + await sha256(raw);
    if (await env.DB.get(seenKey)) return json(request, env, { matched: null, reason: 'duplicate' });
    await env.DB.put(seenKey, '1', { expirationTtl: HOOK_DEDUPE_TTL });

    const words = wordsOf(textBody);
    const givenName = squash(data.name || '');
    const nameOk = n => {
        const k = squash(n);
        if (!usableName(k)) return false;
        return givenName ? givenName === k : words.has(k);
    };
    const pendingBank = (await listOrders(env, 'pending')).filter(o => o.m === 'bank');

    let hit = null;
    let candidates = 0;
    for (const amount of amounts) {
        const same = pendingBank.filter(o => o.a === amount);
        // 목록에 아직 안 보이는 새 주문은 금액 색인으로 찾는다
        const idx = await env.DB.get(AMT_PREFIX + amount);
        if (idx && !same.some(o => o.id === idx)) {
            const o = await load(env, idx);
            if (o && o.status === 'pending' && o.method === 'bank' && o.amount === amount) same.push({ id: o.id, a: o.amount, m: o.method, n: o.name || '' });
        }
        candidates += same.length;
        if (same.length === 1) { hit = same[0]; break; }
        if (same.length > 1) {
            const byName = same.filter(o => o.n && nameOk(o.n));
            if (byName.length === 1) { hit = byName[0]; break; }
        }
    }

    // 안내 금액과 다르게 보낸 경우(끝자리 할인을 무시하고 정가로 보내는 등): 안내 금액 이상 정가 이하이고
    // 입금자명이 맞는 대기 주문이 딱 하나면 그 주문으로 본다. 덜 보냈거나 정가보다 많이 보냈으면 판매자가 확인한다.
    if (!hit) {
        const plans = plansFor(env);
        const listPrice = o => (Object.prototype.hasOwnProperty.call(plans, o.p) ? plans[o.p].amount : o.a);
        const byName = pendingBank.filter(o => o.n && nameOk(o.n) && amounts.some(a => a >= o.a && a <= listPrice(o)));
        if (byName.length === 1) hit = byName[0];
    }

    if (hit) {
        const order = await load(env, hit.id);
        if (order && order.status === 'pending') {
            try {
                await confirm(env, order, 'deposit-hook');
            } catch (err) {
                await env.DB.delete(seenKey);   // 발급이 실패했으면 같은 알림을 다시 받을 수 있게
                throw err;
            }
            if (!order.test) {
                await touchHook(env, 'match');
                ctx.waitUntil(notify(env, `입금 자동 확인 ${order.id}\n${order.name} ${won(order.amount)} → ${order.planName} 키 ${order.keyId}`));
            }
            return json(request, env, { matched: order.id });
        }
    }
    // 자동 점검이 보낸 흉내 알림은 휴대폰 연결 신호로 치지 않는다 (진짜 휴대폰이 없는데 "자동 확인 중"이 되지 않게)
    if (textBody.indexOf('[자동점검') !== -1) return json(request, env, { matched: null, candidates });
    await touchHook(env, 'deposit');
    // 이용권 가격대의 입금만 알린다. 월급 같은 다른 입금까지 알리면 시끄럽다.
    const prices = Object.values(plansFor(env)).map(p => p.amount);
    const plausible = amounts.some(a => a >= Math.min(...prices) - MAX_DISCOUNT && a <= Math.max(...prices));
    if (plausible) {
        ctx.waitUntil(notify(env, `입금 알림을 주문과 맞추지 못했습니다 (${amounts.map(won).join(', ')}, 후보 ${candidates}건).\n금액이 주문과 다르게 입금됐을 수 있습니다. 관리자 페이지에서 확인하세요.\n${textBody.slice(0, 120)}`));
    }
    return json(request, env, { matched: null, candidates });
}

// 알림 속 금액들. "잔액 10,000원" 같은 잔고 금액은 뺀다.
function amountsIn(s) {
    const out = [];
    const re = /(잔액|잔고)?\s*[:：]?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,})\s*원/g;
    for (const m of String(s).matchAll(re)) {
        if (!m[1]) out.push(Number(m[2].replace(/,/g, '')));
    }
    return out;
}

/* ───── 지킴이 (한 시간마다) ───── */
async function watchdog(env) {
    if (!(await hookSecrets(env)).length) return;
    const h = await env.DB.get('meta:hook', 'json');
    if (!h || !h.lastAt) return;   // 아직 한 번도 연결된 적이 없으면 조용히 있는다
    const silentMs = Date.now() - h.lastAt;
    if (silentMs < HOOK_SILENCE_HOURS * 3600 * 1000) return;
    if (h.alertedAt && h.alertedAt > h.lastAt) return;   // 이번 끊김은 이미 알렸다
    await notify(env, `입금 알림 연결이 ${Math.floor(silentMs / 3600000)}시간째 조용합니다.\n휴대폰 전원·데이터·알림 앱(MacroDroid/단축어)을 확인해 주세요.\n그동안 계좌이체 주문은 자동으로 열리지 않고, 결제 화면은 "판매자 확인 뒤 발급"으로 안내됩니다.`);
    h.alertedAt = Date.now();
    await env.DB.put('meta:hook', JSON.stringify(h));
}

/* ───── 환불 요청 (구매자) ─────
 * 이용약관 4조: 키가 발급된 뒤에는 단순 변심 환불을 하지 않는다. 키가 작동하지 않거나 중복 입금한 경우는
 * 문의로 받아 판매자가 관리자 페이지에서 "환불 처리"한다. 예전 화면이 이 주소를 부르면 문의로 안내한다.
 */
async function requestRefund(request) {
    throw new HttpError(410, 'refund_contact', '환불은 문의로 신청해 주세요 (이용약관 4조).');
}

async function payappCancel(env, order) {
    if (!order.payapp || !order.payapp.mulNo || !methodsOf(env).payapp) return { ok: false, message: '결제요청번호 없음' };
    const form = new URLSearchParams({
        cmd: 'paycancel', userid: env.PAYAPP_USERID, linkkey: env.PAYAPP_LINKKEY,
        mul_no: String(order.payapp.mulNo), cancelmemo: '환불 (lottodraw.kr)',
    });
    try {
        const res = await fetch(PAYAPP_API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
        const r = new URLSearchParams(await res.text());
        return r.get('state') === '1' ? { ok: true } : { ok: false, message: r.get('errorMessage') || `HTTP ${res.status}` };
    } catch (e) {
        return { ok: false, message: '페이앱 연결 실패' };
    }
}

// 은행 알림에 늘 나오는 말과 은행 이름. 이런 입금자명은 자동 매칭하지 않는다(사람이 확인).
const COMMON_WORDS = new Set(['입금', '출금', '잔액', '원', '이체', '송금', '알림', '계좌', 'web발신', '우리', '우리은행',
    '국민', '국민은행', '신한', '신한은행', '하나', '하나은행', '농협', '기업', '카카오뱅크', '카카오', '토스', '토스뱅크',
    '케이뱅크', '새마을', '우체국', 'won', 'krw']);

function usableName(k) {
    return k.length >= 2 && !COMMON_WORDS.has(k) && !/^\d+$/.test(k);
}

// 알림 문장을 낱말로 자른다. "최 지은" 처럼 띄어 쓴 이름도 잡히게 붙어 있는 두 낱말을 이어 붙인 것도 넣는다.
function wordsOf(s) {
    const parts = String(s).split(/[\s\[\]()<>{}:;,.·|/\\'"!?~*_\-]+/).map(squash).filter(Boolean);
    const set = new Set(parts);
    for (let i = 0; i + 1 < parts.length; i++) set.add(parts[i] + parts[i + 1]);
    return set;
}

/* ───── 회원 (구글 로그인 · 무료 체험 · 좋아요) ───── */

// 가입 무료 체험(계정당 한 번) 일수. 비밀값/변수 SIGNUP_TRIAL_DAYS 를 넣을 때만 준다 — 2026-10-11부터 넣지 않는다(끔).
// 무료로 볼 수 있는 것이 이미 많아 체험으로 이용권 기능을 열어 주지 않기로 했다. 이미 준 체험 키는 기간까지 그대로 쓴다
function signupTrialDays(env) {
    const n = Math.floor(Number(env.SIGNUP_TRIAL_DAYS));
    return n > 0 ? Math.min(n, 30) : 0;
}
function loginReady(env) {
    return !!(env.GOOGLE_CLIENT_ID && env.COMMUNITY);
}

function needLogin(env) {
    if (!loginReady(env)) throw new HttpError(503, 'no_login', '로그인 기능이 아직 꺼져 있습니다.');
}

async function limited(binding, key) {
    if (!binding || typeof binding.limit !== 'function') return;
    const { success } = await binding.limit({ key });
    if (!success) throw new HttpError(429, 'too_many', '요청이 너무 잦습니다. 1분 뒤 다시 시도해 주세요.');
}

function bearer(request) {
    const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{20,100})$/);
    return m ? m[1] : null;
}

// 로그인 세션 → 계정. 없거나 만료면 401.
async function sessionUser(request, env, markAttend) {
    needLogin(env);
    const token = bearer(request);
    if (!token) throw new HttpError(401, 'need_login', '로그인이 필요합니다.');
    const hash = await sha256('sess:' + token);
    const got = await community(env, 'sessionGet', { hash, now: Date.now(), markAttend: !!markAttend });
    if (!got.user) throw new HttpError(401, 'need_login', '로그인이 끝났습니다. 다시 로그인해 주세요.');
    return { user: got.user, rx: got.rx || {}, sub: got.sub, hash, attended: !!got.attended };
}

async function googleLogin(request, env, ctx) {
    needLogin(env);
    await limited(env.LOGIN_LIMIT, request.headers.get('CF-Connecting-IP') || 'local');
    const body = await readJson(request);
    const g = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID);
    if (!g) throw new HttpError(401, 'bad_credential', '구글 로그인을 확인하지 못했습니다. 다시 시도해 주세요.');

    const now = Date.now();
    const days = signupTrialDays(env);
    const r = await community(env, 'login', { sub: g.sub, email: g.email, subHash: await sha256('trial:' + g.sub), ref: await memberRef(g.sub), now, trial: days > 0 });
    let user = r.user;
    let trialNew = false;
    if (r.needTrial) {
        user = await issueTrial(env, g.sub, days);
        trialNew = true;
        const stats = await community(env, 'stats').catch(() => null);
        ctx.waitUntil(notify(env, `새 가입 · ${days}일 무료 체험 키 ${user.trial.keyId}` + (stats ? `\n가입 ${stats.users}명 · 체험 ${stats.trials}건` : '')));
    } else if (r.isNew) {
        const stats = await community(env, 'stats').catch(() => null);
        ctx.waitUntil(notify(env, '새 가입' + (stats ? ` · 가입 ${stats.users}명` : '')));
    }

    const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    await community(env, 'sessionCreate', { sub: g.sub, hash: await sha256('sess:' + token), exp: now + SESSION_DAYS * 86400 * 1000 });
    return json(request, env, { session: token, user, isNew: r.isNew, trialNew, attended: !!r.attended, points: POINTS }, 200);
}

// 무료 체험 키는 주문처럼 남긴다(관리자 페이지에서 보이고, 정지·조회가 같은 길로 된다). 0원, 메일은 보내지 않는다.
// 이메일은 주문에 적지 않는다 — 계정에만 있고 탈퇴하면 지워진다.
async function issueTrial(env, sub, days) {
    const now = Date.now();
    const order = {
        id: await freshId(env), tokenHash: '', plan: 'trial', planName: `${days}일 무료 체험`,
        listPrice: 0, amount: 0, method: 'trial', name: '무료 체험', contact: '', days: days,
        status: 'pending', createdAt: now, deadline: now, log: [{ at: now, what: 'created', by: 'google' }],
    };
    await confirm(env, order, 'google');
    const r = await community(env, 'setTrial', { sub, trial: { orderId: order.id, keyId: order.keyId, key: order.key, expiresAt: order.expiresAt } });
    return r.user;
}

// 내 정보. 오늘(한국 날짜) 처음 불리면 출석을 하나 올린다.
async function me(request, env) {
    const s = await sessionUser(request, env, true);
    return json(request, env, { user: s.user, reactions: s.rx, attended: s.attended, points: POINTS });
}

// 주문·계정을 잇는 되돌릴 수 없는 참조값. 주문 기록(5년 보관)에 구글 계정 번호를 그대로 남기지 않는다.
const memberRef = sub => sha256('member:' + sub);

// 로그인한 채 주문하면 그 주문을 계정과 잇는다(랭킹 점수). 로그인이 없거나 끝났으면 그냥 넘어간다.
async function orderMember(request, env) {
    if (!loginReady(env) || !bearer(request)) return null;
    try {
        const got = await community(env, 'sessionGet', { hash: await sha256('sess:' + bearer(request)), now: Date.now() });
        return got.sub ? await memberRef(got.sub) : null;
    } catch (e) { return null; }
}

// 결제되면 +금액, 환불되면 -금액. 실패해도 발급·환불은 그대로 간다.
async function creditMember(env, order, sign) {
    if (!order.memberRef || !(order.amount > 0) || !loginReady(env)) return;
    if (sign > 0 ? order.credited : !order.credited) return;
    try {
        const r = await community(env, 'credit', { ref: order.memberRef, amount: sign * order.amount });
        if (r.ok) order.credited = sign > 0;
    } catch (e) { console.error('credit', e); }
}

/* ───── 실시간 채팅 (chat.js) ───── */

function chatReady(env) {
    return loginReady(env) && !!env.CHAT;
}

// WebSocket 연결. 우리 사이트에서 연 것만 받는다(다른 사이트가 몰래 붙는 것을 막는다).
async function chatConnect(request, env) {
    if (!chatReady(env)) throw new HttpError(503, 'no_chat', '채팅이 아직 꺼져 있습니다.');
    if (request.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'need_websocket', 'WebSocket 으로 연결해 주세요.');
    if (!allowedOrigin(request, env)) throw new HttpError(403, 'bad_origin', '허용되지 않은 곳에서 연결했습니다.');
    await limited(env.CHAT_LIMIT || env.LOGIN_LIMIT, 'chat:' + (request.headers.get('CF-Connecting-IP') || 'local'));
    return chatStub(env).fetch(request);
}

async function chatInfo(request, env) {
    if (!chatReady(env)) throw new HttpError(503, 'no_chat', '채팅이 아직 꺼져 있습니다.');
    const r = await chatStub(env).fetch('https://chat/info');
    return json(request, env, await r.json(), 200, { 'Cache-Control': 'public, max-age=15' }, true);
}

// 회원 랭킹. 로그인했으면 내 순위도 같이.
async function getRanking(request, env) {
    needLogin(env);
    let sub = null;
    if (bearer(request)) {
        const got = await community(env, 'sessionGet', { hash: await sha256('sess:' + bearer(request)), now: Date.now() }).catch(() => ({}));
        sub = got.sub || null;
    }
    const r = await community(env, 'ranking', { sub, limit: 50 });
    return json(request, env, Object.assign(r, { points: POINTS }), 200, sub ? {} : { 'Cache-Control': 'public, max-age=60' }, !sub);
}

async function logout(request, env) {
    needLogin(env);
    const token = bearer(request);
    if (token) await community(env, 'sessionDelete', { hash: await sha256('sess:' + token) });
    return json(request, env, { ok: true });
}

// 탈퇴. 계정·세션·좋아요를 지운다. 받은 무료 체험 키는 기간까지 그대로 쓸 수 있다.
async function deleteMe(request, env, ctx) {
    const s = await sessionUser(request, env);
    const body = await readJson(request);
    if (body.confirm !== true) throw new HttpError(400, 'need_confirm', '탈퇴를 확인해 주세요.');
    await community(env, 'userDelete', { sub: s.sub });
    ctx.waitUntil(notify(env, '회원 탈퇴 1건'));
    return json(request, env, { ok: true });
}

// 별명: 한글·영문·숫자·밑줄 2~12자. 운영자로 오해할 만한 이름은 막는다.
const NICK_RE = /^[가-힣a-zA-Z0-9_]{2,12}$/;
const NICK_RESERVED = /(admin|관리자|운영자|lottodraw|로또드로우|동행복권|official|공식)/i;

async function setNickname(request, env) {
    const s = await sessionUser(request, env);
    await limited(env.REACT_LIMIT, s.hash);
    const body = await readJson(request);
    const nick = String(body.nickname || '').normalize('NFC').trim();
    if (!NICK_RE.test(nick)) throw new HttpError(400, 'bad_nick', '별명은 한글·영문·숫자·밑줄(_)로 2~12자입니다.');
    // 운영자 계정은 "운영자" 같은 별명을 쓸 수 있다
    if (NICK_RESERVED.test(nick) && !s.user.staff) throw new HttpError(400, 'reserved_nick', '쓸 수 없는 별명입니다. 다른 별명을 골라 주세요.');
    const r = await community(env, 'setNick', { sub: s.sub, nick, key: nick.toLowerCase(), now: Date.now() });
    if (r.error === 'taken') throw new HttpError(409, 'taken_nick', '이미 쓰고 있는 별명입니다.');
    if (r.error === 'need_points') throw new HttpError(402, 'need_points', `별명을 바꾸려면 ${r.cost}포인트가 필요합니다. (지금 ${r.avail}포인트)`);
    if (r.error) throw new HttpError(401, 'need_login', '다시 로그인해 주세요.');
    return json(request, env, { user: r.user, cost: r.cost || 0 });
}

// 번호 생성기 설정(로그인 회원). 고정수 6개까지 · 제외수 · 켠 패턴 번호(1~16) · 직전 당첨 조합 제외 칸(0~10, 화면의 끌기 막대 위치).
// 받은 값을 그대로 믿지 않고 다듬어 저장한다. { gen: null } 이면 지운다
const GEN_RECENT_MAX = 10;
function cleanGen(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const nums = (a, max) => (Array.isArray(a) ? [...new Set(a.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 45))].sort((x, y) => x - y).slice(0, max) : []);
    const inc = nums(raw.inc, 6);
    const exc = nums(raw.exc, 45).filter(n => !inc.includes(n));
    const pat = Array.isArray(raw.pat) ? [...new Set(raw.pat.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 16))].sort((x, y) => x - y) : [];
    const recent = Math.max(0, Math.min(GEN_RECENT_MAX, Math.floor(Number(raw.recent) || 0)));
    const ac = Math.max(0, Math.min(10, Math.floor(Number(raw.ac) || 0)));   // AC값 조건: 이 값 이상(0 = 끔)
    const acExact = raw.acExact === true && ac > 0;                          // true 면 "이 값만": AC값이 딱 ac 인 조합만(2026-10-18)
    return { inc, exc, pat, recent, ac, acExact, at: Date.now() };
}
async function saveGenerator(request, env) {
    const s = await sessionUser(request, env);
    await limited(env.REACT_LIMIT, s.hash);
    const body = await readJson(request);
    const gen = body.gen === null ? null : cleanGen(body.gen);
    if (body.gen !== null && !gen) throw new HttpError(400, 'bad_gen', '설정을 읽지 못했습니다.');
    const r = await community(env, 'setGen', { sub: s.sub, gen });
    if (r.error) throw new HttpError(401, 'need_login', '다시 로그인해 주세요.');
    return json(request, env, { user: r.user });
}

/* ───── 내 번호 (마이페이지 · 홈 생성기 "내 번호에 저장") ───── */

// 저장한 번호 + 지금 판매 중인 회차 + 메일 구독 여부. 등수는 화면이 lotto-data.json 으로 맞춘다(서버는 저장만)
async function getNumbers(request, env) {
    const s = await sessionUser(request, env);
    const [k, m] = await Promise.all([community(env, 'numbersGet', { sub: s.sub }), community(env, 'mailGet', { sub: s.sub })]);
    return json(request, env, { games: k.games, saleRound: saleRound(Date.now()), mail: m.mail, mailReady: mailReady(env) });
}

// { round, games: [[6개], …], src: 'm' | 'g' }. 회차는 1회 ~ 지금 판매 중인 회차, 빼면 지금 판매 중인 회차(홈 생성기 — 기기 시계를 믿지 않는다)
async function addNumbers(request, env) {
    const s = await sessionUser(request, env);
    await limited(env.REACT_LIMIT, s.hash);
    const body = await readJson(request);
    const now = Date.now();
    const top = saleRound(now);
    const round = body.round === undefined || body.round === null ? top : Number(body.round);
    if (!Number.isInteger(round) || round < 1 || round > top) throw new HttpError(400, 'bad_round', `회차는 1~${top}회 사이로 골라 주세요.`);
    const raw = Array.isArray(body.games) ? body.games : [];
    if (!raw.length || raw.length > 20) throw new HttpError(400, 'bad_games', '한 번에 1~20게임까지 저장할 수 있습니다.');
    const games = raw.map(cleanGame);
    const bad = games.findIndex(g => !g);
    if (bad !== -1) throw new HttpError(400, 'bad_games', `${bad + 1}번째 게임을 확인해 주세요. 1~45 사이의 서로 다른 번호 6개여야 합니다.`);
    const r = await community(env, 'numbersAdd', { sub: s.sub, round, games, src: body.src === 'g' ? 'g' : 'm', now });
    if (r.error) throw new HttpError(401, 'need_login', '다시 로그인해 주세요.');
    return json(request, env, { games: r.games, added: r.added, dup: r.dup, full: r.full, saleRound: top });
}

// { id } 한 게임, 또는 { round } 그 회차 전부
async function deleteNumbers(request, env) {
    const s = await sessionUser(request, env);
    await limited(env.REACT_LIMIT, s.hash);
    const body = await readJson(request);
    const id = typeof body.id === 'string' && /^[a-z0-9]{1,12}$/.test(body.id) ? body.id : null;
    const round = Number.isInteger(body.round) && body.round > 0 ? body.round : null;
    if (!id && !round) throw new HttpError(400, 'bad_id', '지울 번호를 고르지 못했습니다.');
    const r = await community(env, 'numbersDelete', { sub: s.sub, id, round: id ? null : round });
    return json(request, env, { games: r.games, removed: r.removed });
}

/* ───── 추첨 결과 메일 (2026-10-18 — 예전 "이번 주 생성 번호 메일"을 바꿨다) ─────
 * 구독은 회원이 마이페이지에서 직접 켜고 끈다. 메일마다 수신 거부 링크(로그인 없이 한 번에 끔)를 넣는다.
 * 보내는 것: 그 회차 당첨번호, 회원이 내 번호에 저장한 그 회차 번호의 등수 · 맞은 번호, 회차 페이지 링크. 생성 번호는 보내지 않는다.
 * 그 회차 번호를 저장하지 않은 구독자에게는 보내지 않는다.
 * 보내는 때: 사이트의 lotto-data.json 에 그 회차가 올라온 뒤 일요일 · 월요일 09~21시(한국)에 한 시간 예약(:17)마다 한 묶음씩.
 * 밤 9시 ~ 아침 9시는 쉰다. 월요일 21시까지 당첨번호가 올라오지 않으면 그 회차는 보내지 않는다.
 * Resend 무료 한도(하루 100통 · 한 달 3,000통)를 키 메일과 나눠 쓴다 — 하루에 WEEKLY_MAIL_DAILY(기본 80)통까지만
 * 보내고, 남은 구독자는 다음 날(월요일 09시 — UTC 날짜가 바뀐 뒤) 이어서 보낸다. 자세한 셈은 README.
 */
const WEEKLY = { days: [0, 1], startHour: 9, nightHour: 21, lastDow: 1, batch: 100, daily: 80, rounds: 4 };

async function setMail(request, env) {
    const s = await sessionUser(request, env);
    await limited(env.REACT_LIMIT, s.hash);
    const body = await readJson(request);
    if (typeof body.on !== 'boolean') throw new HttpError(400, 'bad_mail', '켜기 · 끄기를 골라 주세요.');
    if (body.on && !mailReady(env)) throw new HttpError(503, 'no_mail', '메일 발송이 아직 꺼져 있습니다.');
    const r = await community(env, 'mailSet', { sub: s.sub, on: body.on, ref: await memberRef(s.sub), now: Date.now() });
    if (r.error) throw new HttpError(401, 'need_login', '다시 로그인해 주세요.');
    return json(request, env, { mail: r.mail });
}

// 메일의 수신 거부 링크. GET 은 확인 단추가 있는 쪽(메일 보안 검사기가 링크를 미리 열어도 꺼지지 않게),
// POST(단추 · 메일 앱의 "구독 취소" — List-Unsubscribe-Post)는 바로 끈다
async function unsubscribe(request, env, url) {
    const ref = String(url.searchParams.get('r') || '').slice(0, 64);
    const token = String(url.searchParams.get('t') || '').slice(0, 64);
    const page = (title, msg, form) => new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | lottodraw.kr</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 16px;color:#1f2a44;background:#fff}h1{font-size:1.3rem}button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:6px;background:#1f2a44;color:#fff;cursor:pointer}a{color:#2456c8}</style></head>
<body><h1>${title}</h1><p>${msg}</p>${form || ''}<p><a href="${siteUrl(env)}/mypage.html">마이페이지</a>에서 언제든 다시 켤 수 있습니다.</p></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    if (!loginReady(env) || !/^[A-Za-z0-9_-]{20,64}$/.test(ref) || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
        return page('링크를 확인해 주세요', '수신 거부 링크가 올바르지 않습니다. 마이페이지에서 메일을 끌 수 있습니다.');
    }
    if (request.method === 'GET') {
        return page('추첨 결과 메일 수신 거부', '아래 단추를 누르면 이 메일을 더 보내지 않습니다.',
            `<form method="post" action="?r=${encodeURIComponent(ref)}&amp;t=${encodeURIComponent(token)}"><button type="submit">수신 거부</button></form>`);
    }
    const r = await community(env, 'mailUnsub', { ref, token });
    if (r.error) return page('링크를 확인해 주세요', '수신 거부 링크가 올바르지 않습니다. 마이페이지에서 메일을 끌 수 있습니다.');
    return page('수신 거부되었습니다', '추첨 결과 메일을 더 보내지 않습니다.');
}

const weeklyDaily = env => { const n = Math.floor(Number(env.WEEKLY_MAIL_DAILY)); return n > 0 ? Math.min(n, 5000) : WEEKLY.daily; };
const utcDay = now => new Date(now).toISOString().slice(0, 10);

// 보내는 때인가: 일 · 월요일 09:00 ~ 21:00 (한국 시각). 밤 9시 ~ 아침 9시는 보내지 않는다
function inWindow(now) {
    const { dow, hour } = kstParts(now);
    return WEEKLY.days.includes(dow) && hour >= WEEKLY.startHour && hour < WEEKLY.nightHour;
}

// 직전 회차 당첨번호. lotto-data.json 은 최신 회차가 맨 앞이라 앞부분만 읽는다(무료 요금제 CPU 10ms 를 아끼려고 전체를 풀지 않는다)
async function latestDraw(env) {
    try {
        const res = await fetch(siteUrl(env) + '/lotto-data.json', { headers: { Range: 'bytes=0-1023' }, cf: { cacheTtl: 300 } });
        if (!res.ok && res.status !== 206) return null;
        const head = (await res.text()).slice(0, 2048);
        const m = head.match(/"round":\s*(\d+),\s*"date":\s*"[^"]*",\s*"numbers":\s*\[([\d,\s]+)\],\s*"bonus":\s*(\d+)/);
        if (!m) return null;
        return { round: Number(m[1]), numbers: m[2].split(',').map(Number), bonus: Number(m[3]) };
    } catch (e) { return null; }
}

const RANK_TXT = ['낙첨', '1등', '2등', '3등', '4등', '5등'];
// 저장한 게임들의 결과: 요약 한 줄("3게임 중 1게임 당첨 — 5등 1게임")과 게임마다 한 줄("1)  3 · 12 · 19 · 20 · 21 · 22  →  5등 (맞은 번호 3 · 12 · 19)")
function resultLines(games, draw) {
    const res = games.map(g => rankOf(g, draw));
    const wins = [1, 2, 3, 4, 5].map(r => [r, res.filter(x => x.rank === r).length]).filter(([, n]) => n);
    const won = wins.reduce((a, [, n]) => a + n, 0);
    const head = won
        ? `${games.length}게임 중 ${won}게임 당첨 — ${wins.map(([r, n]) => `${RANK_TXT[r]} ${n}게임`).join(' · ')}`
        : `${games.length}게임 모두 낙첨`;
    const rows = games.map((g, i) => {
        const r = res[i];
        const hit = r.hit.length ? `맞은 번호 ${r.hit.join(' · ')}${r.bonus ? ` + 보너스 ${draw.bonus}` : ''}` : '맞은 번호 없음';
        return `${i + 1})  ${g.join(' · ')}  →  ${RANK_TXT[r.rank]} (${hit})`;
    });
    return { head, rows };
}

function resultText(env, round, games, draw, unsubUrl) {
    const site = siteUrl(env);
    const { head, rows } = resultLines(games, draw);
    return [
        `${drawDay(round)} ${round}회 추첨 결과입니다.`,
        '',
        `당첨번호: ${draw.numbers.join(' · ')} + 보너스 ${draw.bonus}`,
        '',
        `내 번호에 저장한 ${round}회 번호 ${head}`,
        ...rows,
        '',
        '당첨 여부는 복권 실물과 동행복권에서 한 번 더 확인해 주세요. 저장할 때 번호를 잘못 적었으면 결과도 다릅니다.',
        '',
        `${round}회 등수별 당첨금 · 당첨 게임 수: ${site}/round/${round}.html`,
        `내 번호 전체 결과: ${site}/mypage.html`,
        '',
        '이 메일은 lottodraw.kr 마이페이지에서 "추첨 결과 메일"을 켜고 그 회차 번호를 내 번호에 저장한 회원에게 보냅니다.',
        `수신 거부: ${unsubUrl}`,
        '문의: contact@lottodraw.kr',
    ].join('\n');
}

// 한 시간 예약에서 부른다. 보내는 때가 아니거나, 이번 회차를 다 보냈거나, 오늘 몫을 다 썼거나, 당첨번호가 아직 사이트에 없으면 아무것도 하지 않는다
async function resultMail(env, now) {
    if (!mailReady(env) || !loginReady(env) || !inWindow(now)) return { skipped: 'window' };
    const round = saleRound(now) - 1;   // 일 · 월요일에는 지난 토요일에 추첨한 회차
    const day = utcDay(now);
    const status = await community(env, 'mailStatus', { round, day });
    if (status.state && status.state.done) return { skipped: 'done' };
    let budget = weeklyDaily(env) - status.today;
    if (budget <= 0) return { skipped: 'budget' };
    const draw = await latestDraw(env);
    if (!draw || draw.round !== round) return { skipped: 'no_draw' };   // 아직 사이트에 올라오지 않았다 — 다음 시간에 다시
    const api = String(env.API_ORIGIN || 'https://api.lottodraw.kr').replace(/\/+$/, '');
    const from = env.WEEKLY_MAIL_FROM || env.MAIL_FROM;
    let total = 0;
    const finish = async () => {
        const st = await community(env, 'mailStatus', { round, day });
        const sent = st.state ? st.state.sent : total;
        if (sent) await notify(env, `추첨 결과 메일 ${round}회 발송 끝: ${sent}통 (구독 ${st.subs}명 중 그 회차 번호를 저장한 회원)`);
        return { sent: total, done: true };
    };
    for (let loop = 0; loop < WEEKLY.rounds && budget > 0; loop++) {
        const prep = await community(env, 'mailPrepare', { round, limit: Math.min(WEEKLY.batch, budget) });
        if (!prep.items.length) {
            await community(env, 'mailCommit', { round, cursor: prep.cursor, sent: 0, done: !prep.more, now, day });
            if (prep.more) continue;   // 이 묶음에는 보낼 사람(그 회차 번호를 저장한 구독자)이 없었다 — 다음 묶음으로
            return finish();
        }
        const emails = prep.items.map(it => {
            const unsubUrl = `${api}/api/mail/unsubscribe?r=${encodeURIComponent(it.ref)}&t=${encodeURIComponent(it.token)}`;
            return {
                from, to: [it.email], reply_to: 'contact@lottodraw.kr',
                subject: `[lottodraw.kr] ${round}회 당첨번호와 내 번호 결과`,
                text: resultText(env, round, it.games, draw, unsubUrl),
                headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
            };
        });
        let ok = false, why = '';
        try {
            // 같은 묶음을 다시 보내게 되면(기록 실패 등) Resend 가 한 번만 보낸다(24시간)
            const res = await fetch('https://api.resend.com/emails/batch', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': `result-${round}-${prep.cursor}` },
                body: JSON.stringify(emails),
            });
            ok = res.ok;
            if (!ok) { try { why = String(JSON.parse(await res.text()).message || '').slice(0, 120); } catch (e) { why = ''; } why = `HTTP ${res.status}` + (why ? ': ' + why : ''); }
        } catch (e) { why = '메일 서버 연결 실패'; }
        if (!ok) {
            const f = await community(env, 'mailFail', { round, now, max: 3 });
            if (f.state.gaveUp) await notify(env, `추첨 결과 메일 ${round}회: 세 번 연달아 보내지 못해 이번 회차는 멈춥니다 (${why}). 지금까지 ${f.state.sent}통.`);
            return { failed: why };
        }
        await community(env, 'mailCommit', { round, cursor: prep.cursor, sent: emails.length, done: !prep.more, now, day });
        total += emails.length;
        budget -= emails.length;
        if (!prep.more) return finish();
    }
    // 오늘 몫을 다 썼는데 아직 남았다 — 마지막 날(월요일)이면 이번 회차에 못 받는 회원이 생긴다
    if (budget <= 0 && kstParts(now).dow === WEEKLY.lastDow) {
        await notify(env, `추첨 결과 메일 ${round}회: 하루 한도(${weeklyDaily(env)}통)를 다 써서 일부 회원에게 보내지 못할 수 있습니다. 구독자가 늘었으면 Resend 요금제 · WEEKLY_MAIL_DAILY 를 확인하세요.`);
    }
    return { sent: total, done: false };
}

function reactionIds(raw) {
    const ids = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length || ids.length > 30 || !ids.every(i => ITEM_RE.test(i))) throw new HttpError(400, 'bad_ids', '항목 이름이 올바르지 않습니다.');
    return [...new Set(ids)];
}

// 카드별 누른 수. 누구나 본다.
async function getReactions(request, env, url) {
    needLogin(env);
    const got = await community(env, 'counts', { items: reactionIds(url.searchParams.get('ids')) });
    return json(request, env, got, 200, { 'Cache-Control': 'public, max-age=15' }, true);
}

async function react(request, env) {
    const s = await sessionUser(request, env);
    const body = await readJson(request);
    const item = String(body.id || '');
    if (!ITEM_RE.test(item)) throw new HttpError(400, 'bad_ids', '항목 이름이 올바르지 않습니다.');
    if (REACT_TYPES.indexOf(body.type) === -1) throw new HttpError(400, 'bad_type', '좋아요 종류가 올바르지 않습니다.');
    await limited(env.REACT_LIMIT, s.hash);
    const r = await community(env, 'react', { sub: s.sub, item, type: body.type });
    if (r.error) throw new HttpError(401, 'need_login', '다시 로그인해 주세요.');
    return json(request, env, r);
}

/* ───── 공유 · 출력 집계 (index.html 생성기, js/share.js) ───── */

// 브라우저는 sendBeacon(text/plain, 미리 묻기 없음)으로 {"k": 종류} 만 보내고 답을 보지 않는다.
// 번호 · 기기 · 회원 정보는 받지 않는다. 우리 사이트(Origin)에서 온 것만 세고, 같은 IP 는 1분에 30번까지(TAP_LIMIT) — 부풀리기 · 저장소 한도 막기
async function tap(request, env) {
    if (!allowedOrigin(request, env)) throw new HttpError(403, 'bad_origin', '허용되지 않은 사이트입니다.');
    const kind = String((await readJson(request)).k || '');
    if (TAP_KINDS.indexOf(kind) === -1) throw new HttpError(400, 'bad_kind', '집계 종류가 올바르지 않습니다.');
    if (!env.COMMUNITY) return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    await limited(env.TAP_LIMIT, 'tap:' + (request.headers.get('CF-Connecting-IP') || 'local'));
    await community(env, 'tap', { kind, now: Date.now() });
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

/* ───── 블로그 댓글 (js/comments.js) ───── */

const POST_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;   // 블로그 글 파일 이름(.html 뺀 것)
const COMMENT_ERR = {
    empty: [400, '내용을 적어 주세요.'], too_long: [400, `${COMMENT.max}자까지 쓸 수 있습니다.`],
    link: [400, '링크·사이트 주소는 올릴 수 없습니다.'], contact: [400, '연락처·메신저 아이디는 올릴 수 없습니다.'],
    promo: [400, '홍보성 문구는 올릴 수 없습니다.'], need_nick: [403, '별명을 정하면 댓글을 쓸 수 있습니다.'],
    banned: [403, '운영 원칙 위반으로 댓글·채팅이 막혀 있습니다.'],
    slow: [429, '조금 천천히 써 주세요 (15초에 한 번).'], daily: [429, `댓글은 하루 ${COMMENT.daily}개까지 쓸 수 있습니다.`],
    not_found: [404, '이미 지워진 댓글입니다.'], not_mine: [403, '내가 쓴 댓글만 지울 수 있습니다.'],
};
function commentError(code) {
    const e = COMMENT_ERR[code] || [400, '처리하지 못했습니다.'];
    return new HttpError(e[0], code, e[1]);
}
function postId(v) {
    const p = String(v || '');
    if (!POST_RE.test(p)) throw new HttpError(400, 'bad_post', '글 이름이 올바르지 않습니다.');
    return p;
}

// 누구나 읽는다. 로그인했으면 내 댓글에 표시(지우기 단추)
async function getComments(request, env, url) {
    needLogin(env);
    const post = postId(url.searchParams.get('post'));
    let sub = null;
    if (bearer(request)) {
        const got = await community(env, 'sessionGet', { hash: await sha256('sess:' + bearer(request)), now: Date.now() }).catch(() => ({}));
        sub = got.sub || null;
    }
    const r = await community(env, 'commentList', { post, sub });
    return json(request, env, r, 200, sub ? {} : { 'Cache-Control': 'public, max-age=15' }, !sub);
}

async function addComment(request, env, ctx) {
    const s = await sessionUser(request, env);
    await limited(env.REACT_LIMIT, s.hash);
    const body = await readJson(request);
    const post = postId(body.post);
    const c = checkText(body.text, { max: COMMENT.max, multiline: true });
    if (c.error) throw commentError(c.error);
    if (env.CHAT) {   // 채팅 금지된 계정은 댓글도 막는다
        const b = await (await chatStub(env).fetch('https://chat/banned', { method: 'POST', body: JSON.stringify({ sub: s.sub }) })).json().catch(() => ({}));
        if (b.banned) throw commentError('banned');
    }
    const r = await community(env, 'commentAdd', { sub: s.sub, post, text: c.text, now: Date.now() });
    if (r.error === 'no_user') throw new HttpError(401, 'need_login', '다시 로그인해 주세요.');
    if (r.error) throw commentError(r.error);
    ctx.waitUntil(notify(env, `블로그 댓글 · ${post}\n${r.comment.nick}: ${c.text.slice(0, 80)}`));
    return json(request, env, r);
}

async function deleteComment(request, env) {
    const s = await sessionUser(request, env);
    const body = await readJson(request);
    const r = await community(env, 'commentDelete', { sub: s.sub, post: postId(body.post), id: String(body.id || '').slice(0, 40) });
    if (r.error) throw commentError(r.error);
    return json(request, env, { ok: true });
}

/* ───── 관리자 ───── */

function adminOk(request, env) {
    const token = env.ADMIN_TOKEN || '';
    if (token.length < 16) return false;
    const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/);
    return !!m && safeEqual(m[1], token);
}

async function admin(request, env, sub, method, url) {
    if (sub === '/status' && method === 'GET') {
        const s = await signer(env);
        const all = await listOrders(env, 'all');
        const counts = {};
        all.forEach(o => { counts[o.s] = (counts[o.s] || 0) + 1; });
        return json(request, env, {
            kid: s ? s.kid : null, publicJwk: s ? s.publicJwk : null, keySource: s ? s.source : null, keyBackup: s ? s.backup : null,
            methods: methodsOf(env), plans: publicPlans(env),
            counts,
            hooks: {
                deposit: (await hookSecrets(env)).length > 0,
                alive: await hookAlive(env),
                state: (await env.DB.get('meta:hook', 'json')) || null,
                url: apiOrigin(env, url) + '/api/hooks/deposit',
            },
            notify: { telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), url: !!env.NOTIFY_URL },
            mail: mailReady(env),
            // 추첨 결과 메일: 마지막으로 추첨한 회차의 발송 상태
            weekly: loginReady(env) ? await community(env, 'mailStatus', { round: saleRound(Date.now()) - 1, day: utcDay(Date.now()) }).then(x => Object.assign(x, { round: saleRound(Date.now()) - 1, daily: weeklyDaily(env) })).catch(() => null) : null,
            login: loginReady(env) ? Object.assign(await community(env, 'stats').catch(() => ({ error: true })), { trialDays: signupTrialDays(env) }) : null,
        });
    }
    // 서명 키는 사람이 한 번 눌러서 만든다. 저절로 만들면 동시에 두 개가 생겨 한쪽 키가 무효가 될 수 있다.
    if (sub === '/setup-key' && method === 'POST') {
        if (await signer(env)) throw new HttpError(409, 'key_exists', '서명 키가 이미 있습니다. 바꾸면 판매한 키가 모두 무효가 되므로 덮어쓰지 않습니다.');
        const rec = await generateKeyPair();
        await env.DB.put('meta:signing-key', JSON.stringify(rec));
        const s = await signer(env, rec);
        return json(request, env, { kid: s.kid, publicJwk: s.publicJwk }, 201);
    }
    // 서명 키 백업. KV 를 잃어도 판매한 키를 살릴 수 있게, 비밀번호 관리자나 GitHub Secret
    // LICENSE_PRIVATE_JWK 에 보관하라고 내준다. 이 값이 새면 누구나 키를 만들 수 있다.
    if (sub === '/key-backup' && method === 'POST') {
        const rec = await env.DB.get('meta:signing-key', 'json');
        if (!rec) throw new HttpError(404, 'no_key', '서명 키가 아직 없습니다.');
        return json(request, env, { privateJwk: rec.privateJwk });
    }
    // 입금 알림 연결용 열쇠. 비밀값 DEPOSIT_HOOK_SECRET 을 따로 넣지 않아도 여기서 한 번 만들면 된다.
    if (sub === '/hook-secret' && (method === 'GET' || method === 'POST')) {
        if ((env.DEPOSIT_HOOK_SECRET || '').length >= 16) return json(request, env, { secret: env.DEPOSIT_HOOK_SECRET, source: 'secret' });
        let sec = await env.DB.get('meta:hook-secret');
        if (!sec && method === 'POST') {
            sec = b64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
            await env.DB.put('meta:hook-secret', sec);
        }
        return json(request, env, { secret: sec || null, source: sec ? 'kv' : null });
    }
    // 자동 점검용 주문. 판매자 알림을 보내지 않고, 점검이 끝나면 지운다.
    if (sub === '/selftest/order' && method === 'POST') {
        const plans = plansFor(env);
        const allPending = await listOrders(env, 'pending');
        const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
        const now = Date.now();
        const order = {
            id: await freshId(env), tokenHash: await sha256(token), plan: 'week', planName: plans.week.name,
            listPrice: plans.week.amount, amount: await pickAmount(env, plans.week.amount, allPending), method: 'bank',
            name: '자동점검', contact: '', status: 'pending', createdAt: now, deadline: now + 3600 * 1000,
            agreedAt: now, test: true, log: [{ at: now, what: 'created', by: 'selftest' }],
        };
        await save(env, order);
        return json(request, env, { order: publicView(order, env), token }, 201);
    }
    if (sub === '/selftest/cleanup' && method === 'POST') {
        const body = await readJson(request);
        const order = await load(env, String(body.id || ''));
        if (!order) return json(request, env, { cleaned: false });
        if (!order.test) throw new HttpError(409, 'not_test', '자동 점검 주문이 아닙니다.');
        await env.DB.delete('order:' + order.id);
        await dropAmount(env, order);
        if (order.keyId) {
            await env.DB.delete('keyidx:' + order.keyId);
            const r = await revokedList(env);
            if (r.ids.indexOf(order.keyId) !== -1) {
                r.ids = r.ids.filter(x => x !== order.keyId);
                r.updatedAt = Date.now();
                await env.DB.put('meta:revoked', JSON.stringify(r));
            }
        }
        return json(request, env, { cleaned: true });
    }
    // 공유 · 출력 집계 (날짜별)
    if (sub === '/taps' && method === 'GET') {
        if (!env.COMMUNITY) throw new HttpError(503, 'no_store', '집계 저장소가 없습니다.');
        return json(request, env, await community(env, 'taps'));
    }
    // 회원 명부 · 카드별 좋아요 합계 (구글 로그인을 켰을 때)
    if (sub === '/members' && method === 'GET') {
        needLogin(env);
        return json(request, env, await community(env, 'adminList'));
    }
    const mm = sub.match(/^\/members\/([0-9A-Za-z_-]{1,64})\/(clear-nick|delete|staff|unstaff)$/);
    if (mm && method === 'POST') {
        needLogin(env);
        const op = { delete: 'userDelete', 'clear-nick': 'clearNick', staff: 'setStaff', unstaff: 'setStaff' }[mm[2]];
        const r = await community(env, op, { sub: mm[1], on: mm[2] === 'staff' });
        if (r.error) throw new HttpError(404, 'no_member', '회원을 찾을 수 없습니다.');
        return json(request, env, { ok: true });
    }
    // 채팅 관리: 최근 메시지(누가 썼는지 포함)·채팅 금지 목록, 메시지 지우기, 채팅 금지/해제
    if (sub === '/chat' && method === 'GET') {
        if (!chatReady(env)) throw new HttpError(503, 'no_chat', '채팅이 아직 꺼져 있습니다.');
        return json(request, env, await (await chatStub(env).fetch('https://chat/admin/list')).json());
    }
    const cm = sub.match(/^\/chat\/(delete|ban|unban)$/);
    if (cm && method === 'POST') {
        if (!chatReady(env)) throw new HttpError(503, 'no_chat', '채팅이 아직 꺼져 있습니다.');
        const body = await readJson(request);
        const payload = cm[1] === 'delete' ? { id: String(body.id || '').slice(0, 40) } : { sub: String(body.sub || '').slice(0, 64), nick: cleanText(body.nick, 20) };
        const r = await chatStub(env).fetch('https://chat/admin/' + cm[1], { method: 'POST', body: JSON.stringify(payload) });
        return json(request, env, await r.json());
    }
    // 블로그 댓글 관리: 최근 댓글(누가 썼는지 포함), 지우기. 막기는 채팅 금지와 같다
    if (sub === '/comments' && method === 'GET') {
        needLogin(env);
        return json(request, env, await community(env, 'adminComments', { limit: 300 }));
    }
    if (sub === '/comments/delete' && method === 'POST') {
        needLogin(env);
        const body = await readJson(request);
        const r = await community(env, 'commentDelete', { post: postId(body.post), id: String(body.id || '').slice(0, 40), admin: true });
        if (r.error) throw commentError(r.error);
        return json(request, env, { ok: true });
    }
    if (sub === '/orders' && method === 'GET') {
        const status = url.searchParams.get('status') || 'pending';
        return json(request, env, { orders: (await listOrders(env, status)).slice(0, 300) });
    }
    if (sub === '/issue' && method === 'POST') {
        const body = await readJson(request);
        const plans = plansFor(env);
        const days = body.days === undefined || body.days === null || body.days === '' ? null : Number(body.days);
        const plan = body.plan === 'custom' ? 'custom' : body.plan;
        if (plan !== 'custom' && !has(plans, plan)) throw new HttpError(400, 'bad_plan', '이용권 종류가 올바르지 않습니다.');
        if (plan === 'custom' && !(Number.isInteger(days) && days >= 0 && days <= 3650)) throw new HttpError(400, 'bad_days', '기간(일)을 0~3650 사이로 적어 주세요. 0은 기간 제한 없음.');
        const now = Date.now();
        const order = {
            id: await freshId(env), tokenHash: '', plan,
            planName: plan === 'custom' ? (days ? `${days}일 이용권` : '기간 제한 없는 이용권') : plans[plan].name,
            amount: 0, method: 'manual', name: cleanText(body.name, 20) || '', contact: '',
            note: cleanText(body.note, 200) || '', days: plan === 'custom' ? days : null,
            status: 'pending', createdAt: now, deadline: now, log: [{ at: now, what: 'created', by: 'admin' }],
        };
        await confirm(env, order, 'admin');
        return json(request, env, { order: adminView(order) }, 201);
    }
    if (sub === '/revoke' && method === 'POST') {
        const body = await readJson(request);
        const id = keyIdFrom(body.key || body.keyId);
        if (!id) throw new HttpError(400, 'bad_key', '키나 키 번호(8자리)를 확인해 주세요.');
        const r = await revoke(env, id);
        return json(request, env, { revoked: id, count: r.ids.length });
    }
    if (sub === '/unrevoke' && method === 'POST') {
        const body = await readJson(request);
        const id = keyIdFrom(body.key || body.keyId);
        if (!id) throw new HttpError(400, 'bad_key', '키나 키 번호(8자리)를 확인해 주세요.');
        const r = await revokedList(env);
        r.ids = r.ids.filter(x => x !== id);
        r.updatedAt = Date.now();
        await env.DB.put('meta:revoked', JSON.stringify(r));
        return json(request, env, { unrevoked: id, count: r.ids.length });
    }

    const m = sub.match(/^\/orders\/([0-9A-Z]{8})(?:\/(confirm|cancel|refund|refund-done|mail))?$/);
    if (m) {
        const order = await load(env, m[1]);
        if (!order) throw new HttpError(404, 'no_order', '주문을 찾을 수 없습니다.');
        const action = m[2];
        if (!action && method === 'GET') return json(request, env, { order: adminView(order) });
        if (method !== 'POST') throw new HttpError(405, 'method', '허용되지 않는 요청입니다.');
        if (action === 'confirm') {
            if (order.status === 'refunded' || order.status === 'refund_requested') throw new HttpError(409, 'refunded', '이미 환불된 주문입니다.');
            await confirm(env, order, 'admin');
        } else if (action === 'cancel') {
            if (order.status !== 'pending') throw new HttpError(409, 'not_pending', '입금 대기 중인 주문만 취소할 수 있습니다.');
            order.status = 'cancelled';
            order.cancelledAt = Date.now();
            order.log.push({ at: order.cancelledAt, what: 'cancelled', by: 'admin' });
            await save(env, order);
        } else if (action === 'refund') {
            if (order.status !== 'paid' && order.status !== 'refund_requested') throw new HttpError(409, 'not_paid', '키가 발급된 주문만 환불 처리할 수 있습니다.');
            // 카드 결제는 결제 취소까지. 실패하면 페이앱 판매자 화면에서 취소하면 된다(취소 통보가 오면 키가 저절로 정지된다).
            if (order.method === 'payapp' && order.status === 'paid') {
                const r = await payappCancel(env, order);
                if (!r.ok) throw new HttpError(502, 'payapp_cancel_failed', `페이앱 자동 취소 실패(${r.message}). 페이앱 판매자 화면에서 취소하면 키가 저절로 정지됩니다.`);
            }
            await refund(env, order, 'admin');
        } else if (action === 'mail') {
            if (order.status !== 'paid' || !order.key) throw new HttpError(409, 'not_paid', '키가 발급된 주문만 메일로 보낼 수 있습니다.');
            if (!order.contact) throw new HttpError(409, 'no_contact', '구매자가 이메일을 적지 않은 주문입니다.');
            if (!mailReady(env)) throw new HttpError(503, 'no_mail', '메일 발송 설정(RESEND_API_KEY · MAIL_FROM)이 없습니다.');
            const r = await mailKey(env, order);
            await save(env, order);
            if (!r.ok) throw new HttpError(502, 'mail_failed', '메일을 보내지 못했습니다: ' + r.message);
        } else if (action === 'refund-done') {
            if (order.status !== 'refund_requested') throw new HttpError(409, 'not_requested', '환불 요청 상태인 주문이 아닙니다.');
            await refund(env, order, 'admin-sent');
        }
        return json(request, env, { order: adminView(order) });
    }
    throw new HttpError(404, 'not_found', '없는 주소입니다.');
}

function adminView(order) {
    const v = Object.assign({}, order);
    delete v.tokenHash;
    delete v.ipTag;
    return v;
}

function keyIdFrom(v) {
    const s = String(v || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return s.toLowerCase();
    const p = parseKey(s);
    return p ? p.id : null;
}

/* ───── 발급 · 환불 ───── */

async function confirm(env, order, by) {
    if (order.status === 'paid' && order.key) return order;
    if (order.status === 'refunded' || order.status === 'refund_requested') throw new HttpError(409, 'refunded', '이미 환불된 주문입니다.');
    const s = await signer(env);
    if (!s) throw new HttpError(503, 'no_signing_key', '서명 키가 아직 없습니다. 관리자 페이지에서 "서명 키 만들기"를 먼저 눌러 주세요.');
    const plans = plansFor(env);
    const now = Math.floor(Date.now() / 1000);
    const days = order.plan === 'custom' || order.plan === 'trial' ? (order.days || 0) : plans[order.plan].days;
    const expiresAt = days ? now + days * 86400 : 0;
    // 키 번호는 주문번호에서 정해진다. 확인 버튼과 자동 확인이 겹쳐 키가 두 번 만들어져도
    // 번호가 같아서, 환불하면 둘 다 정지된다.
    const id = new DataView(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('key:' + order.id))).getUint32(0);
    order.key = await signKey(s.privateKey, { plan: order.plan, id, issuedAt: now, expiresAt });
    order.keyId = hex32(id);
    order.expiresAt = expiresAt ? expiresAt * 1000 : null;
    order.paidAt = Date.now();
    order.status = 'paid';
    order.log.push({ at: order.paidAt, what: 'paid', by });
    await creditMember(env, order, 1);
    await save(env, order);
    await env.DB.put('keyidx:' + order.keyId, order.id);   // 환불 요청 때 키 → 주문 찾기
    if (mailReady(env) && order.contact && !order.test) {
        const r = await mailKey(env, order);   // 실패해도 발급은 그대로다 (관리자 페이지에서 다시 보낼 수 있다)
        await save(env, order);
        if (!r.ok) await notify(env, `키 메일을 보내지 못했습니다 ${order.id} (${r.message}).\n키는 발급됐습니다. 관리자 페이지 → 주문 → 자세히 → "키 메일 다시 보내기"`);
    }
    return order;
}

/* ───── 키 메일 (Resend) ─────
 * 비밀값 RESEND_API_KEY 와 MAIL_FROM(예: "lottodraw.kr <key@lottodraw.kr>")이 있으면, 구매자가 이메일을 적은
 * 주문은 키가 발급되는 즉시 키를 메일로도 보낸다. 다른 기기에서 열거나 브라우저를 지웠을 때 다시 쓰라고.
 */
function mailReady(env) {
    return !!(env.RESEND_API_KEY && env.MAIL_FROM);
}

const kst = ms => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' (한국 시간)';

async function mailKey(env, order) {
    const link = `${siteUrl(env)}/statistics.html#key=${order.key}`;
    const text = [
        `lottodraw.kr ${order.planName}을 구매해 주셔서 감사합니다.`,
        '',
        `주문번호: ${order.id}`,
        `이용 기간: ${order.expiresAt ? kst(order.expiresAt) + '까지' : '기간 제한 없음'}`,
        '',
        '이용권 키 (5개월 통계 페이지의 "키 입력"에 붙여 넣으세요):',
        order.key,
        '',
        '아래 링크를 열면 이 기기에서 바로 열립니다:',
        link,
        '',
        '키는 본인만 쓰고 공유하지 마세요. 공유된 키는 정지될 수 있습니다.',
        `문의: ${siteUrl(env)}/contact.html (이 메일에 답장하지 말고 contact@lottodraw.kr 로 보내 주세요)`,
    ].join('\n');
    let result;
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: env.MAIL_FROM,
                to: [order.contact],
                reply_to: 'contact@lottodraw.kr',
                subject: `[lottodraw.kr] ${order.planName} 키 (주문 ${order.id})`,
                text,
            }),
        });
        if (res.ok) result = { ok: true };
        else {
            let why = '';
            try { why = String(JSON.parse(await res.text()).message || '').slice(0, 120); } catch (e) { /* 본문 없음 */ }
            result = { ok: false, message: `메일 서버 응답 ${res.status}` + (why ? ': ' + why : '') };
        }
    } catch (e) {
        result = { ok: false, message: '메일 서버 연결 실패' };
    }
    const now = Date.now();
    if (result.ok) order.mailedAt = now;
    order.log.push({ at: now, what: result.ok ? 'mailed' : 'mail_failed', by: result.ok ? '' : result.message });
    return result;
}

async function refund(env, order, by) {
    order.status = 'refunded';
    order.refundedAt = Date.now();
    order.log.push({ at: order.refundedAt, what: 'refunded', by });
    if (order.keyId) await revoke(env, order.keyId);
    await creditMember(env, order, -1);
    await save(env, order);
    return order;
}

async function revokedList(env) {
    return (await env.DB.get('meta:revoked', 'json')) || { ids: [], updatedAt: 0 };
}

async function revoke(env, id) {
    const r = await revokedList(env);
    if (r.ids.indexOf(id) === -1) {
        r.ids.push(id);
        r.updatedAt = Date.now();
        await env.DB.put('meta:revoked', JSON.stringify(r));
    }
    return r;
}

/* ───── 서명 키 ─────
 * KV 에 저장된 키가 원본이다. 비밀값 LICENSE_PRIVATE_JWK 는 KV 를 잃었을 때 되살리는 백업으로만 쓴다
 * — 잘못 넣은 비밀값(다른 값을 붙여 넣는 등) 때문에 발급이 멈추거나 이미 판 키가 무효가 되지 않게.
 * 둘 다 없으면 발급하지 않는다. 관리자 페이지의 "서명 키 만들기"로 한 번 만든다.
 * 키를 바꾸면 이전에 판 키는 전부 무효가 된다.
 */
let cachedSigner = null;

export function _resetForTests() { cachedSigner = null; }
export const _resultMailForTests = resultMail;

async function signer(env, fresh) {
    if (cachedSigner) return cachedSigner;
    let rec = fresh || await env.DB.get('meta:signing-key', 'json');
    let source = 'kv';
    let backup = null;
    if (env.LICENSE_PRIVATE_JWK) {
        try {
            const priv = JSON.parse(env.LICENSE_PRIVATE_JWK);
            if (priv && priv.kty === 'EC' && priv.d && priv.x && priv.y) backup = priv;
        } catch (e) { backup = null; }
    }
    if (!rec && backup) {
        rec = { privateJwk: backup, publicJwk: publicOnly(backup) };
        source = 'secret';
    }
    if (!rec) return null;   // 없다는 결과는 기억하지 않는다 — 만든 직후 다른 곳에서도 보이게
    const kid = rec.kid || await keyId(rec.publicJwk);
    let backupState = 'none';   // 관리자 페이지에 보여 줄 백업 상태
    if (env.LICENSE_PRIVATE_JWK) backupState = !backup ? 'invalid' : (await keyId(publicOnly(backup))) === kid ? 'ok' : 'mismatch';
    cachedSigner = {
        source,
        kid,
        backup: backupState,
        publicJwk: publicOnly(rec.publicJwk),
        privateKey: await importPrivate(rec.privateJwk),
    };
    return cachedSigner;
}

/* ───── 저장 ───── */

function meta(order) {
    const md = { s: order.status, p: order.plan, a: order.amount, m: order.method, n: order.name || '', c: order.createdAt, k: order.keyId || '', i: order.ipTag || '' };
    if (order.test) md.t = 1;
    if (order.memberRef) md.r = order.memberRef.slice(0, 12);   // 관리자 주문 목록에 회원 별명을 붙이는 데 쓴다
    return md;
}

async function save(env, order) {
    const opts = { metadata: meta(order) };
    if (order.status === 'pending' || order.status === 'cancelled') opts.expirationTtl = PENDING_TTL;
    await env.DB.put('order:' + order.id, JSON.stringify(order), opts);
    if (order.method !== 'bank') return;
    if (order.status === 'pending') await env.DB.put(AMT_PREFIX + order.amount, order.id, { expirationTtl: PENDING_TTL });
    else await dropAmount(env, order);
}

// 입금 대기에서 벗어난 주문의 금액 색인을 지운다 (다른 주문이 그 금액을 쓰고 있으면 그대로 둔다)
async function dropAmount(env, order) {
    if (await env.DB.get(AMT_PREFIX + order.amount) === order.id) await env.DB.delete(AMT_PREFIX + order.amount);
}

async function load(env, id) {
    if (!/^[0-9A-Z]{8}$/.test(id || '')) return null;
    return env.DB.get('order:' + id, 'json');
}

async function listOrders(env, status) {
    const out = [];
    let cursor;
    for (let i = 0; i < 20; i++) {
        const page = await env.DB.list({ prefix: 'order:', cursor });
        page.keys.forEach(k => {
            const md = k.metadata || {};
            if (status === 'all' || md.s === status) out.push(Object.assign({ id: k.name.slice(6) }, md));
        });
        if (page.list_complete || !page.cursor) break;
        cursor = page.cursor;
    }
    return out.sort((a, b) => (b.c || 0) - (a.c || 0));
}

async function freshId(env) {
    for (let i = 0; i < 5; i++) {
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        const id = Array.from(bytes, b => CROCKFORD[b & 31]).join('');
        if (!(await env.DB.get('order:' + id))) return id;
    }
    throw new HttpError(500, 'id', '주문번호를 만들지 못했습니다.');
}

/* ───── 알림 ───── */

async function notify(env, message) {
    const jobs = [];
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        jobs.push(fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: true }),
        }));
    }
    if (env.NOTIFY_URL) {
        jobs.push(fetch(env.NOTIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Title': 'lottodraw.kr' },
            body: message,
        }));
    }
    const results = await Promise.allSettled(jobs);
    results.forEach(r => { if (r.status === 'rejected') console.error('notify failed', r.reason); });
}

/* ───── 도우미 ───── */

const siteUrl = env => String(env.SITE_URL || 'https://www.lottodraw.kr').replace(/\/+$/, '');
const apiOrigin = (env, url) => String(env.API_ORIGIN || url.origin).replace(/\/+$/, '');
const won = n => Number(n).toLocaleString('ko-KR') + '원';
const squash = s => String(s).replace(/[\s()·.\-_*]/g, '').toLowerCase();
const has = (obj, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);

function cleanText(v, max) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function readBody(request) {
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BODY) throw new HttpError(413, 'too_large', '요청이 너무 큽니다.');
    const t = await request.text();
    if (t.length > MAX_BODY) throw new HttpError(413, 'too_large', '요청이 너무 큽니다.');
    return t;
}

async function readJson(request) {
    const t = await readBody(request);
    if (!t) return {};
    try {
        const v = JSON.parse(t);
        return v && typeof v === 'object' ? v : {};
    } catch (e) {
        throw new HttpError(400, 'bad_json', '요청 형식이 올바르지 않습니다.');
    }
}

async function sha256(s) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
    return b64urlEncode(new Uint8Array(d));
}

async function tokenOk(order, token) {
    if (!token || !order.tokenHash) return false;
    return safeEqual(await sha256(token), order.tokenHash);
}

function safeEqual(a, b) {
    a = String(a || ''); b = String(b || '');
    if (!a || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function allowedOrigin(request, env) {
    const origin = request.headers.get('Origin');
    if (!origin) return null;
    const list = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (list.indexOf(origin) !== -1) return origin;
    if (env.ALLOW_LOCALHOST === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    return null;
}

function corsHeaders(request, env, preflight, open) {
    const h = { 'Vary': 'Origin' };
    const origin = open ? '*' : allowedOrigin(request, env);
    if (origin) {
        h['Access-Control-Allow-Origin'] = origin;
        if (preflight) {
            h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
            h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
            h['Access-Control-Max-Age'] = '86400';
        }
    }
    return h;
}

function json(request, env, data, status, extra, open) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: Object.assign(
            { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
            corsHeaders(request, env, false, open),
            extra || {}),
    });
}

function text(body, status) {
    return new Response(body, { status: status || 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
