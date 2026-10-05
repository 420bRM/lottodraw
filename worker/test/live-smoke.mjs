// 실서버 자동 점검: 주문 → 입금 알림 → 키 발급 → 브라우저 확인 → 관리자 환불 처리 → 키 정지 → 뒷정리
// 사람 대신 이 스크립트가 배포할 때마다, 그리고 매일 아침 한 번 돈다 (.github/workflows/deploy-worker.yml).
// 돈은 오가지 않는다. 점검용 주문은 판매자 알림을 보내지 않고, 끝나면 흔적 없이 지운다.
//
// 사용: API_BASE=https://api.lottodraw.kr ADMIN_TOKEN=… node worker/test/live-smoke.mjs
// 첫 배포 때는 서명 키와 입금 알림 연결 열쇠도 여기서 만든다(이미 있으면 그대로 둔다).
// 점검하지 못하는 것: 판매자 휴대폰이 실제 은행 알림을 넘겨주는 부분. 그건 휴대폰이 6시간마다
// 보내는 신호(ping)로 서버의 지킴이가 따로 지켜본다.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const API = String(process.env.API_BASE || 'https://api.lottodraw.kr').replace(/\/+$/, '');
const ADMIN = process.env.ADMIN_TOKEN || '';

let failed = false;
const step = (ok, msg) => {
    console.log(`${ok ? '✔' : '✘'} ${msg}`);
    if (!ok) failed = true;
    return ok;
};

async function call(method, path, { body, headers, raw } = {}) {
    const h = Object.assign({ Accept: 'application/json', Origin: 'https://www.lottodraw.kr' }, headers || {});
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(API + path, { method, headers: h, body: payload });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { status: res.status, data };
}
const asAdmin = { Authorization: 'Bearer ' + ADMIN };

// KV 는 방금 쓴 값을 다른 요청에 최대 1분쯤 늦게 보여 줄 수 있다. 구매자 화면도 10초마다 다시 묻듯이
// 점검도 결과가 보일 때까지 잠깐 기다린다.
async function waitFor(fn, ms = 120000, every = 5000) {
    const until = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v || Date.now() > until) return v;
        await new Promise(r => setTimeout(r, every));
    }
}

// 브라우저와 같은 코드(js/license.js)로 키를 확인한다
function browserLicense() {
    const ls = new Map();
    globalThis.localStorage = { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
    globalThis.PREMIUM_CONFIG = { apiBase: API, revalidateMinutes: 5 };
    const path = require.resolve('../../js/license.js');
    delete require.cache[path];
    return require(path);
}

async function main() {
    if (ADMIN.length < 16) {
        console.log('::warning::ADMIN_TOKEN 이 없어 자동 점검을 건너뜁니다');
        return;
    }
    const cfg = await call('GET', '/api/config');
    if (!step(cfg.status === 200, `서버 응답 (${API})`)) return;
    step(cfg.data.methods.bank, '계좌이체 주문 열림 (BANK_NAME·BANK_ACCOUNT·BANK_HOLDER)');

    let st = await call('GET', '/api/admin/status', { headers: asAdmin });
    if (!step(st.status === 200, '관리자 토큰 확인')) return;
    // 첫 배포: 서명 키와 입금 알림 연결 열쇠를 여기서 한 번 만든다 (사람이 누를 일 없게).
    // 서명 키는 이미 있으면 서버가 덮어쓰지 않는다.
    if (!st.data.kid) {
        const made = await call('POST', '/api/admin/setup-key', { headers: asAdmin });
        step(made.status === 201 || made.status === 409, '서명 키 처음 만들기');
        st = await call('GET', '/api/admin/status', { headers: asAdmin });
    }
    if (!step(!!st.data.kid, `서명 키 있음 (${st.data.kid})`)) return;
    const sec = await call('POST', '/api/admin/hook-secret', { headers: asAdmin });
    const hookKey = sec.data && sec.data.secret;
    step(!!hookKey, '입금 알림 연결 열쇠 있음');
    const hs = st.data.hooks && st.data.hooks.state;
    if (hs && hs.lastAt) {
        const h = Math.floor((Date.now() - hs.lastAt) / 3600000);
        console.log(`  ${st.data.hooks.alive ? '·' : '⚠'} 휴대폰 알림 연결: 마지막 신호 ${h}시간 전${st.data.hooks.alive ? '' : ' — 끊긴 것 같습니다 (지킴이가 따로 알립니다)'}`);
    } else {
        console.log('  ⚠ 휴대폰 알림 연결 신호가 아직 한 번도 없습니다 — 연결 전에는 계좌이체가 자동으로 열리지 않습니다');
    }

    let order = null;
    try {
        const made = await call('POST', '/api/admin/selftest/order', { headers: asAdmin });
        if (!step(made.status === 201, '점검 주문 만들기')) return;
        order = made.data.order;
        const token = made.data.token;
        step(order.amount < order.listPrice && order.amount >= order.listPrice - 99, `금액 끝자리 할인 (${order.listPrice} → ${order.amount})`);

        // 입금 알림 흉내 — 실제 은행 알림과 같은 모양
        if (hookKey) {
            const text = `[Web발신]\n[자동점검 ${order.id}]\n입금 ${order.amount.toLocaleString('ko-KR')}원\n자동점검\n잔액 0원`;
            const hook = await call('POST', '/api/hooks/deposit', { raw: text, headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + hookKey } });
            step(hook.data && hook.data.matched === order.id, '입금 알림 → 주문 자동 매칭');
        } else {
            await call('POST', `/api/admin/orders/${order.id}/confirm`, { headers: asAdmin });
            console.log('  · 입금 알림 연결이 없어 관리자 확인으로 대신했습니다');
        }

        const t0 = Date.now();
        const key = await waitFor(async () => {
            const r = await call('GET', `/api/orders/${order.id}?token=${encodeURIComponent(token)}`);
            const o = r.data && r.data.order;
            return o && o.status === 'paid' && /^LD1-/.test(o.key || '') ? o.key : null;
        });
        if (!step(!!key, `구매자 화면에 키 전달 (${Math.round((Date.now() - t0) / 1000)}초)`)) return;

        let L = browserLicense();
        let v = await L.validate(key);
        step(v.ok === true, `브라우저에서 키 확인 → 잠금 해제 (${v.plan || v.reason})`);

        // 셀프 환불은 없다(이용약관 4조): 구매자 요청은 키를 건드리지 않고 문의로 안내한다
        const self = await call('POST', '/api/refunds', { body: { key, account: '자동점검' } });
        step(self.status === 410, '구매자 셀프 환불 막힘 (문의로 안내)');
        const ref = await waitFor(async () => {
            const r = await call('POST', `/api/admin/orders/${order.id}/refund`, { headers: asAdmin });
            return r.data && r.data.order && r.data.order.status === 'refunded' ? r : null;
        });
        step(!!ref, '관리자 환불 처리');

        const t1 = Date.now();
        v = await waitFor(async () => {
            const w = await browserLicense().validate(key);   // 정지 목록을 새로 받는 새 브라우저
            return w.ok === false ? w : null;
        });
        step(!!v, `환불한 키는 다시 잠김 (${v ? v.reason : '아직 열림'}, ${Math.round((Date.now() - t1) / 1000)}초)`);
    } finally {
        if (order) {
            const c = await call('POST', '/api/admin/selftest/cleanup', { headers: asAdmin, body: { id: order.id } });
            step(c.data && c.data.cleaned, '점검 주문 뒷정리');
        }
    }
}

main().then(() => {
    if (failed) {
        console.log('\n자동 점검 실패 — 위 ✘ 항목을 확인하세요.');
        process.exit(1);
    }
    console.log('\n자동 점검 통과');
}).catch(err => {
    console.error(err);
    process.exit(1);
});
