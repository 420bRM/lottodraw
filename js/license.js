// 이용권 키 확인. 결제 페이지와 홈의 잠금 카드가 같이 쓴다.
//
// 규칙을 한 곳에 둔 이유: 재확인 주기와 결제대행사 장애 유예를 페이지마다 따로 쓰면
// 한쪽에서만 키가 풀리는 일이 생긴다. 열고 닫는 판단은 전부 여기서 한다.
//
// 이 잠금은 편의 잠금이다. 원본 데이터와 계산 코드가 공개돼 있어 마음먹은 사람이
// 직접 계산하는 것까지 막지는 못한다. 키 외의 입력은 어디로도 보내지 않는다.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LottoLicense = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const KEY_STORE = 'lottodraw.premium.key';
    const CHECK_STORE = 'lottodraw.premium.check';
    const HOUR = 60 * 60 * 1000;

    const cfg = () => (typeof window !== 'undefined' && window.PREMIUM_CONFIG) || {};

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 프라이빗 모드 */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* 프라이빗 모드 */ } },
    };

    const plans = () => cfg().plans || {};
    const benefitIds = () => Object.keys(plans()).map(p => plans()[p].benefitId).filter(Boolean);
    const planOf = id => {
        const all = plans();
        const hit = Object.keys(all).filter(p => all[p].benefitId && all[p].benefitId === id)[0];
        return hit ? all[hit] : null;
    };

    const fmtDate = iso => {
        const d = new Date(iso);
        return isNaN(d) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const configured = () => !!cfg().organizationId;
    const savedKey = () => store.get(KEY_STORE);

    // Polar 응답을 이용 가능 여부로 판정
    function judge(lk) {
        if (lk.status !== 'granted') {
            return { ok: false, reason: lk.status === 'revoked' ? '환불 또는 취소된 이용권입니다.' : '사용이 중지된 이용권입니다.' };
        }
        const allowed = benefitIds();
        if (allowed.length && allowed.indexOf(lk.benefit_id) === -1) {
            return { ok: false, reason: '이 사이트의 이용권 키가 아닙니다.' };
        }
        if (lk.expires_at && Date.parse(lk.expires_at) <= Date.now()) {
            return { ok: false, reason: `${fmtDate(lk.expires_at)}에 기간이 끝난 이용권입니다.` };
        }
        const plan = planOf(lk.benefit_id);
        return {
            ok: true,
            expiresAt: lk.expires_at || null,
            plan: plan ? plan.name : '이용권',
            recurring: !!(plan && plan.recurring),
        };
    }

    async function validate(key) {
        const res = await fetch(`${cfg().apiBase}/v1/customer-portal/license-keys/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ key: key, organization_id: cfg().organizationId }),
        });
        if (res.status === 404) return { ok: false, reason: '찾을 수 없는 키입니다. 앞뒤 공백 없이 그대로 붙여 넣었는지 확인해 주세요.' };
        if (res.status === 422) return { ok: false, reason: '키 형식이 올바르지 않습니다.' };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return judge(await res.json());
    }

    function cached() {
        try { return JSON.parse(store.get(CHECK_STORE) || 'null'); } catch (e) { return null; }
    }
    const stillValid = c => !!c && c.ok === true && (!c.expiresAt || Date.parse(c.expiresAt) > Date.now());
    const within = (c, key, hours) => stillValid(c) && c.key === key && Date.now() - c.checkedAt < hours * HOUR;

    // 최근에 확인한 키는 다시 묻지 않는다
    const fresh = (c, key) => within(c, key, cfg().revalidateHours || 12);
    // 결제대행사에 연결하지 못할 때, 이미 결제한 사람이 곧바로 막히지 않도록 두는 유예
    const graceOk = (c, key) => within(c, key, cfg().graceHours || 72);

    function remember(key, result) {
        const record = Object.assign({ key: key, checkedAt: Date.now() }, result);
        store.set(KEY_STORE, key);
        store.set(CHECK_STORE, JSON.stringify(record));
        return record;
    }

    function forget(alsoKey) {
        store.del(CHECK_STORE);
        if (alsoKey) store.del(KEY_STORE);
    }

    // 홈처럼 입력칸 없이 "열려 있나"만 알면 되는 화면용.
    // 네트워크가 막히면 유예 안에서는 열어 두고, 그 밖에는 잠근다.
    async function unlockState() {
        const key = savedKey();
        if (!configured() || !key) return { unlocked: false, record: null };
        const c = cached();
        if (fresh(c, key)) return { unlocked: true, record: c };
        try {
            const result = await validate(key);
            if (result.ok) return { unlocked: true, record: remember(key, result) };
            forget(true);
            return { unlocked: false, record: null, reason: result.reason };
        } catch (e) {
            if (graceOk(c, key)) return { unlocked: true, record: c };
            return { unlocked: false, record: null, offline: true };
        }
    }

    // 이용권 이름과 남은 기간을 한 줄로
    function summary(record) {
        if (!record) return '';
        const until = record.expiresAt ? `${fmtDate(record.expiresAt)}까지 이용 가능`
            : record.recurring ? '해지 전까지 이용 가능'
            : '기간 제한 없음';
        return `${record.plan} · ${until}`;
    }

    return {
        KEY_STORE: KEY_STORE,
        CHECK_STORE: CHECK_STORE,
        configured: configured,
        savedKey: savedKey,
        plans: plans,
        planOf: planOf,
        judge: judge,
        validate: validate,
        cached: cached,
        stillValid: stillValid,
        fresh: fresh,
        graceOk: graceOk,
        remember: remember,
        forget: forget,
        unlockState: unlockState,
        summary: summary,
        fmtDate: fmtDate,
    };
}));
