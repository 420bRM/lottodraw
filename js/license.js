// 이용권 키 확인. 결제 페이지와 홈의 잠금 카드가 같이 쓴다.
//
// 키는 서버(worker/)가 서명해서 주고, 확인은 이 파일이 공개키로 브라우저 안에서 한다.
// 그래서 키 확인 때문에 어디로 요청을 보내지 않고, 서버가 멈춰도 이미 산 사람은 열린다.
// 키 형식은 worker/src/keys.js 첫머리에 적혀 있다 — 두 파일은 같은 규칙을 따라야 한다.
//
// 서버에 묻는 것은 두 가지뿐이고 둘 다 키를 보내지 않는다.
//   · 공개키 (처음 한 번. premium-config.js 에 박아 두면 그것도 안 묻는다)
//   · 환불된 키 번호 목록 (revalidateMinutes 마다, 기본 5분 — 환불하면 다음 확인 때 바로 잠긴다)
//
// 이 잠금은 편의 잠금이다. 원본 데이터와 계산 코드가 공개돼 있어 마음먹은 사람이
// 직접 계산하는 것까지 막지는 못한다.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LottoLicense = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PREFIX = 'LD1-';
    const BODY_LEN = 14;
    const SIG_LEN = 64;
    const PLAN_BY_CODE = { 1: 'week', 2: 'month', 3: 'lifetime', 4: 'day', 9: 'custom' };
    const KEY_STORE = 'lottodraw.premium.key';
    const CHECK_STORE = 'lottodraw.premium.check';
    const PUB_STORE = 'lottodraw.premium.pubkey';
    const REVOKED_STORE = 'lottodraw.premium.revoked';
    const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
    const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };

    const g = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
    const cfg = () => g.PREMIUM_CONFIG || {};
    const apiBase = () => String(cfg().apiBase || '').replace(/\/+$/, '');

    // 이 파일은 Node 에서 require 될 수도 있어 I18N 이 없을 수 있다. 없으면 한국어 그대로.
    const msg = (key, ko, vars) => {
        if (!g.I18N) return vars ? ko.replace(/\{(\w+)\}/g, (_, k) => vars[k]) : ko;
        return vars ? g.I18N.f(key, vars) : g.I18N.t(key);
    };

    const store = {
        get(k) { try { return g.localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { g.localStorage.setItem(k, v); } catch (e) { /* 프라이빗 모드 */ } },
        del(k) { try { g.localStorage.removeItem(k); } catch (e) { /* 프라이빗 모드 */ } },
    };
    const readJson = k => { try { return JSON.parse(store.get(k) || 'null'); } catch (e) { return null; } };

    const fmtDate = v => {
        const d = new Date(v);
        return isNaN(d) ? String(v) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const configured = () => !!(apiBase() || cfg().publicKeyJwk);
    const savedKey = () => store.get(KEY_STORE);
    const planName = id => msg('plan.' + id, ({ day: '1일 이용권', week: '1주 이용권', month: '1개월 이용권', lifetime: '평생 이용권', custom: '이용권' })[id] || '이용권');

    function b64urlDecode(str) {
        const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    // 형식만 본다. 진짜인지는 verify 가 서명으로 판단한다.
    function parse(key) {
        if (typeof key !== 'string') return null;
        const clean = key.replace(/\s+/g, '');
        if (clean.indexOf(PREFIX) !== 0) return null;
        let raw;
        try { raw = b64urlDecode(clean.slice(PREFIX.length)); } catch (e) { return null; }
        if (raw.length !== BODY_LEN + SIG_LEN || raw[0] !== 1) return null;
        const body = raw.slice(0, BODY_LEN);
        const v = new DataView(body.buffer);
        const exp = v.getUint32(10);
        return {
            key: clean,
            plan: PLAN_BY_CODE[body[1]] || 'custom',
            id: v.getUint32(2).toString(16).padStart(8, '0'),
            issuedAt: v.getUint32(6) * 1000,
            expiresAt: exp ? exp * 1000 : null,
            body: body,
            sig: raw.slice(BODY_LEN),
        };
    }

    function signedBytes(body) {
        const ctx = [0x4c, 0x44, 0x31]; // 'LD1'
        const m = new Uint8Array(ctx.length + body.length);
        m.set(ctx, 0);
        m.set(body, ctx.length);
        return m;
    }

    function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    }

    async function fetchJson(path, fresh) {
        const opts = { headers: { Accept: 'application/json' } };
        if (fresh) opts.cache = 'no-cache';   // 브라우저에 남은 사본 대신 서버에 다시 묻는다
        const res = await withTimeout(fetch(apiBase() + path, opts), 6000);
        if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
        return res.json();
    }

    // 공개키: 설정에 박힌 것 > 이 브라우저에 기억한 것 > 서버에서 받기
    async function publicJwk(refresh) {
        if (cfg().publicKeyJwk) return { jwk: cfg().publicKeyJwk, pinned: true };
        const saved = readJson(PUB_STORE);
        if (saved && saved.jwk && !refresh) return { jwk: saved.jwk, pinned: false };
        if (!apiBase()) throw new Error('no api');
        const got = await fetchJson('/api/pubkey');
        store.set(PUB_STORE, JSON.stringify({ kid: got.kid, jwk: got.jwk, at: Date.now() }));
        return { jwk: got.jwk, pinned: false };
    }

    async function signatureOk(p, jwk) {
        const pub = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, ALG, false, ['verify']);
        return crypto.subtle.verify(SIGN_ALG, pub, p.sig, signedBytes(p.body));
    }

    // 환불된 키 번호 목록. 몇 분마다 새로 받아 환불한 키가 바로 잠기게 한다.
    // 못 받으면(오프라인) 마지막으로 받은 목록을 쓴다.
    async function revokedIds() {
        const saved = readJson(REVOKED_STORE);
        const minutes = cfg().revalidateMinutes || 5;
        if (saved && Date.now() - saved.at < minutes * 60 * 1000) return saved.ids || [];
        if (!apiBase()) return (saved && saved.ids) || [];
        try {
            const got = await fetchJson('/api/revoked', true);
            const ids = Array.isArray(got.ids) ? got.ids : [];
            store.set(REVOKED_STORE, JSON.stringify({ ids: ids, at: Date.now() }));
            return ids;
        } catch (e) {
            return (saved && saved.ids) || [];
        }
    }

    // 결과: { ok, final(다시 해도 같은 결과라 키를 지워도 되는가), reason, ... }
    // 공개키를 한 번도 받지 못했고 받을 수도 없으면 예외를 던진다(오프라인).
    async function validate(key) {
        const p = parse(key);
        if (!p) return { ok: false, final: true, reason: msg('lic.badFormat', '키 형식이 올바르지 않습니다. LD1- 로 시작하는 키 전체를 붙여 넣어 주세요.') };

        let pk = await publicJwk(false);
        let good = await signatureOk(p, pk.jwk);
        if (!good && !pk.pinned) {
            // 서버가 서명 키를 바꿨을 수 있다. 한 번만 새로 받아 다시 본다.
            try { pk = await publicJwk(true); good = await signatureOk(p, pk.jwk); } catch (e) { /* 기존 판단 유지 */ }
        }
        if (!good) return { ok: false, final: true, reason: msg('lic.wrongSite', '이 사이트에서 발급한 키가 아닙니다.') };

        if (p.expiresAt && p.expiresAt <= Date.now()) {
            return { ok: false, final: true, reason: msg('lic.expired', '{date}에 기간이 끝난 이용권입니다.', { date: fmtDate(p.expiresAt) }) };
        }
        const revoked = await revokedIds();
        if (revoked.indexOf(p.id) !== -1) return { ok: false, final: true, reason: msg('lic.revoked', '환불 또는 취소된 이용권입니다.') };

        return {
            ok: true,
            planId: p.plan,
            plan: planName(p.plan),
            keyId: p.id,
            issuedAt: new Date(p.issuedAt).toISOString(),
            expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
        };
    }

    const cached = () => readJson(CHECK_STORE);
    const stillValid = c => !!c && c.ok === true && (!c.expiresAt || Date.parse(c.expiresAt) > Date.now());

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

    // 키 하나를 판정해 열지 말지 정한다. 네트워크가 막혀 공개키를 못 받는 경우에만
    // 마지막으로 확인한 결과(기간 안)를 믿는다.
    async function check(key) {
        try {
            const result = await validate(key);
            if (result.ok) return { unlocked: true, record: remember(key, result) };
            return { unlocked: false, reason: result.reason, final: !!result.final };
        } catch (e) {
            const c = cached();
            if (stillValid(c) && c.key === key) return { unlocked: true, record: c, offline: true };
            return { unlocked: false, offline: true, reason: msg('pay.offline', '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.') };
        }
    }

    // 홈처럼 입력칸 없이 "열려 있나"만 알면 되는 화면용
    async function unlockState() {
        const key = savedKey();
        if (!key) return { unlocked: false, record: null };
        const state = await check(key);
        if (!state.unlocked && state.final) forget(true);
        return state;
    }

    // 이용권 이름과 남은 기간을 한 줄로
    function summary(record) {
        if (!record) return '';
        const until = record.expiresAt
            ? msg('lic.until', '{date}까지 이용 가능', { date: fmtDate(record.expiresAt) })
            : msg('lic.noLimit', '기간 제한 없음');
        const id = record.keyId ? ' · ' + msg('lic.keyNo', '키 번호 {id}', { id: record.keyId.toUpperCase() }) : '';
        return `${record.plan} · ${until}${id}`;
    }

    return {
        PREFIX: PREFIX,
        KEY_STORE: KEY_STORE,
        CHECK_STORE: CHECK_STORE,
        configured: configured,
        savedKey: savedKey,
        parse: parse,
        validate: validate,
        check: check,
        cached: cached,
        stillValid: stillValid,
        remember: remember,
        forget: forget,
        unlockState: unlockState,
        summary: summary,
        planName: planName,
        fmtDate: fmtDate,
    };
}));
