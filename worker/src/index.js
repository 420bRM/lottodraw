// lottodraw.kr 결제·이용권 서버 (Cloudflare Worker)
//
// 하는 일은 세 가지뿐이다.
//   1) 주문 받기 — 계좌이체(기본) 또는 페이앱 카드결제(설정했을 때만)
//   2) 입금이 확인되면 서명된 이용권 키 발급 — 관리자 확인, 페이앱 통보, 입금 알림 자동 매칭 중 하나로
//   3) 환불된 키 번호 목록 공개 — 브라우저가 가끔 받아 가서 해당 키를 잠근다
//
// 키 확인은 브라우저가 공개키로 혼자 한다(js/license.js). 이 서버가 멈춰도
// 이미 산 사람의 잠금은 풀린다. 서버가 필요한 건 "팔 때"뿐이다.
//
// 저장소: KV 하나(DB). order:<주문번호> 와 meta:signing-key, meta:revoked.
// 비밀값과 설정은 README "4. 유료화" 와 worker/wrangler.toml 참고.

import { generateKeyPair, importPrivate, signKey, parseKey, hex32, publicOnly, keyId, b64urlEncode } from './keys.js';
import { plansFor } from './plans.js';

const PAYAPP_API = 'https://api.payapp.kr/oapi/apiLoad.html';
const DEPOSIT_HOURS = 72;              // 입금 기한 안내용. 지나도 관리자는 확인할 수 있다
const PENDING_TTL = 14 * 86400;        // 입금 안 된 주문은 14일 뒤 KV 에서 저절로 지워진다
const MAX_PENDING = 50;                // 입금 대기 주문이 이만큼 쌓이면 새 주문을 잠시 막는다 (도배 방지)
const MAX_BODY = 4096;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

class HttpError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export default {
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

    if (path === '/api/payapp/feedback' && method === 'POST') return payappFeedback(request, env, ctx);
    if (path === '/api/hooks/deposit' && method === 'POST') return depositHook(request, env, ctx, url);

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

function getConfig(request, env) {
    return json(request, env, {
        methods: methodsOf(env),
        plans: publicPlans(env),
        depositHours: DEPOSIT_HOURS,
    }, 200, { 'Cache-Control': 'public, max-age=60' }, true);
}

async function getPubkey(request, env) {
    const s = await signer(env, false);
    if (!s) throw new HttpError(404, 'no_key', '아직 서명 키가 없습니다.');
    return json(request, env, { kid: s.kid, jwk: s.publicJwk }, 200, { 'Cache-Control': 'public, max-age=3600' }, true);
}

async function getRevoked(request, env) {
    const r = await revokedList(env);
    return json(request, env, { ids: r.ids, updatedAt: r.updatedAt }, 200, { 'Cache-Control': 'public, max-age=300' }, true);
}

async function createOrder(request, env, ctx, url) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (env.ORDER_LIMIT && typeof env.ORDER_LIMIT.limit === 'function') {
        const { success } = await env.ORDER_LIMIT.limit({ key: ip });
        if (!success) throw new HttpError(429, 'too_many', '주문이 너무 잦습니다. 1분 뒤 다시 시도해 주세요.');
    }
    const body = await readJson(request);
    const plans = plansFor(env);
    const plan = plans[body.plan];
    if (!plan) throw new HttpError(400, 'bad_plan', '이용권 종류가 올바르지 않습니다.');
    const method = body.method;
    const methods = methodsOf(env);
    if (!methods[method]) throw new HttpError(400, 'bad_method', '지금은 이 결제 방법을 쓸 수 없습니다.');
    if (body.agree !== true) throw new HttpError(400, 'need_agree', '환불 기준에 동의해 주세요.');

    const name = cleanText(body.name, 20);
    const contact = cleanText(body.contact, 100);
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (method === 'bank' && !name) throw new HttpError(400, 'need_name', '입금자명을 적어 주세요.');
    if (method === 'payapp' && !/^01\d{8,9}$/.test(phone)) throw new HttpError(400, 'need_phone', '휴대폰 번호를 확인해 주세요.');

    const pending = await listOrders(env, 'pending');
    if (pending.length >= MAX_PENDING) throw new HttpError(503, 'busy', '주문이 밀려 있습니다. 잠시 뒤 다시 시도해 주세요.');

    const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const now = Date.now();
    const order = {
        id: await freshId(env),
        tokenHash: await sha256(token),
        plan: body.plan,
        planName: plan.name,
        amount: plan.amount,
        method,
        name: name || '',
        contact: contact || '',
        phoneTail: phone ? phone.slice(-4) : '',
        status: 'pending',
        createdAt: now,
        deadline: now + DEPOSIT_HOURS * 3600 * 1000,
        agreedAt: now,
        log: [{ at: now, what: 'created' }],
    };

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
        `새 주문 ${order.id}`,
        `${order.planName} ${won(order.amount)} · ${method === 'bank' ? '계좌이체' : '카드(페이앱)'}`,
        method === 'bank' ? `입금자명: ${order.name}` : `휴대폰 끝자리: ${order.phoneTail}`,
        `${siteUrl(env)}/admin.html#${order.id}`,
    ].join('\n')));

    return json(request, env, { order: publicView(order, env), token, payurl }, 201);
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
        method: order.method,
        status: order.status,
        name: order.name,
        createdAt: order.createdAt,
        deadline: order.deadline,
        paidAt: order.paidAt || null,
        expiresAt: order.expiresAt || null,
    };
    if (order.status === 'paid') v.key = order.key;
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
        if (Number(f.get('price')) !== order.amount) {
            ctx.waitUntil(notify(env, `페이앱 통보: 주문 ${order.id} 금액 불일치 (${f.get('price')}원, 주문 ${order.amount}원) — 확인 필요`));
            return text('SUCCESS');
        }
        const wasPaid = order.status === 'paid';
        await confirm(env, order, 'payapp');
        if (!wasPaid) ctx.waitUntil(notify(env, `카드 결제 완료 ${order.id}\n${order.planName} ${won(order.amount)} · 키 ${order.keyId}`));
    } else if (['9', '64', '70', '71'].indexOf(state) !== -1) {
        if (order.status === 'paid') {
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

/* ───── 입금 알림 자동 매칭 (선택) ─────
 * 은행 앱 입금 알림을 휴대폰 자동화 앱(안드로이드 MacroDroid 등)이나 입금확인 서비스가
 * 이 주소로 보내면, 금액과 입금자명이 하나의 대기 주문과 딱 맞을 때만 자동으로 키를 발급한다.
 * 애매하면 아무것도 하지 않고 알림만 보낸다. 비밀값 DEPOSIT_HOOK_SECRET 이 있어야 켜진다.
 */
async function depositHook(request, env, ctx, url) {
    const secret = env.DEPOSIT_HOOK_SECRET || '';
    const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '') || url.searchParams.get('key') || '';
    if (secret.length < 16 || !safeEqual(given, secret)) throw new HttpError(401, 'unauthorized', '열쇠가 맞지 않습니다.');

    const raw = await readBody(request);
    let data = {};
    const type = request.headers.get('Content-Type') || '';
    if (type.indexOf('json') !== -1) { try { data = JSON.parse(raw); } catch (e) { data = {}; } }
    else if (type.indexOf('form') !== -1) { data = Object.fromEntries(new URLSearchParams(raw)); }
    else data = { text: raw };

    const textBody = String(data.text || '');
    if (/출금/.test(textBody) && !/입금/.test(textBody)) return json(request, env, { matched: null, reason: 'withdrawal' });
    const amount = data.amount ? Number(String(data.amount).replace(/\D/g, '')) : amountIn(textBody);
    if (!amount) return json(request, env, { matched: null, reason: 'no_amount' });
    const haystack = squash(String(data.name || '') + ' ' + textBody);

    const pending = (await listOrders(env, 'pending')).filter(o => o.m === 'bank' && o.a === amount);
    const byName = pending.filter(o => o.n && haystack.indexOf(squash(o.n)) !== -1);
    if (byName.length === 1) {
        const order = await load(env, byName[0].id);
        if (order && order.status === 'pending') {
            await confirm(env, order, 'deposit-hook');
            ctx.waitUntil(notify(env, `입금 자동 확인 ${order.id}\n${order.name} ${won(amount)} → ${order.planName} 키 ${order.keyId}`));
            return json(request, env, { matched: order.id });
        }
    }
    ctx.waitUntil(notify(env, `입금 알림을 주문과 맞추지 못했습니다 (${won(amount)}, 후보 ${pending.length}건). 관리자 페이지에서 직접 확인하세요.\n${textBody.slice(0, 120)}`));
    return json(request, env, { matched: null, candidates: pending.length });
}

function amountIn(s) {
    const m = String(s).match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})\s*원/);
    return m ? Number(m[1].replace(/,/g, '')) : 0;
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
        const s = await signer(env, true);
        const all = await listOrders(env, 'all');
        const counts = {};
        all.forEach(o => { counts[o.s] = (counts[o.s] || 0) + 1; });
        return json(request, env, {
            kid: s.kid, publicJwk: s.publicJwk, methods: methodsOf(env), plans: publicPlans(env),
            counts, hooks: { deposit: (env.DEPOSIT_HOOK_SECRET || '').length >= 16 },
            notify: { telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), url: !!env.NOTIFY_URL },
        });
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
        if (plan !== 'custom' && !plans[plan]) throw new HttpError(400, 'bad_plan', '이용권 종류가 올바르지 않습니다.');
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

    const m = sub.match(/^\/orders\/([0-9A-Z]{8})(?:\/(confirm|cancel|refund))?$/);
    if (m) {
        const order = await load(env, m[1]);
        if (!order) throw new HttpError(404, 'no_order', '주문을 찾을 수 없습니다.');
        const action = m[2];
        if (!action && method === 'GET') return json(request, env, { order: adminView(order) });
        if (method !== 'POST') throw new HttpError(405, 'method', '허용되지 않는 요청입니다.');
        if (action === 'confirm') {
            if (order.status === 'refunded') throw new HttpError(409, 'refunded', '이미 환불된 주문입니다.');
            await confirm(env, order, 'admin');
        } else if (action === 'cancel') {
            if (order.status !== 'pending') throw new HttpError(409, 'not_pending', '입금 대기 중인 주문만 취소할 수 있습니다.');
            order.status = 'cancelled';
            order.cancelledAt = Date.now();
            order.log.push({ at: order.cancelledAt, what: 'cancelled', by: 'admin' });
            await save(env, order);
        } else if (action === 'refund') {
            if (order.status !== 'paid') throw new HttpError(409, 'not_paid', '키가 발급된 주문만 환불 처리할 수 있습니다.');
            await refund(env, order, 'admin');
        }
        return json(request, env, { order: adminView(order) });
    }
    throw new HttpError(404, 'not_found', '없는 주소입니다.');
}

function adminView(order) {
    const v = Object.assign({}, order);
    delete v.tokenHash;
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
    const s = await signer(env, true);
    const plans = plansFor(env);
    const now = Math.floor(Date.now() / 1000);
    const days = order.plan === 'custom' ? (order.days || 0) : plans[order.plan].days;
    const expiresAt = days ? now + days * 86400 : 0;
    const id = crypto.getRandomValues(new Uint32Array(1))[0];
    order.key = await signKey(s.privateKey, { plan: order.plan, id, issuedAt: now, expiresAt });
    order.keyId = hex32(id);
    order.expiresAt = expiresAt ? expiresAt * 1000 : null;
    order.paidAt = Date.now();
    order.status = 'paid';
    order.log.push({ at: order.paidAt, what: 'paid', by });
    await save(env, order);
    return order;
}

async function refund(env, order, by) {
    order.status = 'refunded';
    order.refundedAt = Date.now();
    order.log.push({ at: order.refundedAt, what: 'refunded', by });
    if (order.keyId) await revoke(env, order.keyId);
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
 * 비밀값 LICENSE_PRIVATE_JWK 가 있으면 그것을, 없으면 KV 에 저장된 키를 쓴다.
 * 둘 다 없으면 관리자 페이지를 처음 열 때(또는 첫 발급 때) 새로 만들어 KV 에 둔다.
 * 사람이 키를 옮겨 적을 일이 없도록 한 선택이다. 키를 바꾸면 이전 키는 전부 무효가 된다.
 */
let cachedSigner = null;

export function _resetForTests() { cachedSigner = null; }

async function signer(env, create) {
    if (cachedSigner) return cachedSigner;
    let rec = null;
    if (env.LICENSE_PRIVATE_JWK) {
        const priv = JSON.parse(env.LICENSE_PRIVATE_JWK);
        rec = { privateJwk: priv, publicJwk: publicOnly(priv) };
    } else {
        rec = await env.DB.get('meta:signing-key', 'json');
    }
    if (!rec) {
        if (!create) return null;
        rec = await generateKeyPair();
        await env.DB.put('meta:signing-key', JSON.stringify(rec));
    }
    cachedSigner = {
        kid: rec.kid || await keyId(rec.publicJwk),
        publicJwk: publicOnly(rec.publicJwk),
        privateKey: await importPrivate(rec.privateJwk),
    };
    return cachedSigner;
}

/* ───── 저장 ───── */

function meta(order) {
    return { s: order.status, p: order.plan, a: order.amount, m: order.method, n: order.name || '', c: order.createdAt, k: order.keyId || '' };
}

async function save(env, order) {
    const opts = { metadata: meta(order) };
    if (order.status === 'pending' || order.status === 'cancelled') opts.expirationTtl = PENDING_TTL;
    await env.DB.put('order:' + order.id, JSON.stringify(order), opts);
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
