// 이용권 키 형식. 브라우저 쪽 js/license.js 가 같은 규칙으로 읽는다 — 한쪽만 고치면 키가 안 열린다.
//
//   LD1-<base64url( 본문 14바이트 + 서명 64바이트 )>
//
//   본문  [0]      형식 버전 = 1
//         [1]      이용권 종류 (1 1주, 2 1개월, 3 평생, 4 1일, 5 무료 체험, 9 직접 발급)
//         [2..5]   키 번호 (무작위 32비트) — 환불하면 이 번호를 정지 목록에 올린다
//         [6..9]   발급 시각 (유닉스 초)
//         [10..13] 만료 시각 (유닉스 초, 0 이면 기간 제한 없음)
//   서명  ECDSA P-256 / SHA-256, 'LD1' + 본문 위에. r||s 64바이트.
//
// 서명은 서버만 할 수 있고, 확인은 공개키만 있으면 브라우저 혼자 한다.
// 그래서 서버가 멈춰도 이미 산 사람의 잠금은 그대로 풀린다.

export const PREFIX = 'LD1-';
export const PLAN_CODES = { week: 1, month: 2, lifetime: 3, day: 4, trial: 5, custom: 9 };
export const PLAN_BY_CODE = { 1: 'week', 2: 'month', 3: 'lifetime', 4: 'day', 5: 'trial', 9: 'custom' };

const CONTEXT = new TextEncoder().encode('LD1');
const BODY_LEN = 14;
const SIG_LEN = 64;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };

export function b64urlEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export const hex32 = n => (n >>> 0).toString(16).padStart(8, '0');

function signedBytes(body) {
    const m = new Uint8Array(CONTEXT.length + body.length);
    m.set(CONTEXT, 0);
    m.set(body, CONTEXT.length);
    return m;
}

export function encodeBody({ plan, id, issuedAt, expiresAt }) {
    const body = new Uint8Array(BODY_LEN);
    const v = new DataView(body.buffer);
    body[0] = 1;
    body[1] = PLAN_CODES[plan] || PLAN_CODES.custom;
    v.setUint32(2, id >>> 0);
    v.setUint32(6, issuedAt >>> 0);
    v.setUint32(10, (expiresAt || 0) >>> 0);
    return body;
}

// 형식만 본다. 서명 확인은 verifyKey.
export function parseKey(key) {
    if (typeof key !== 'string') return null;
    const clean = key.replace(/\s+/g, '');
    if (!clean.startsWith(PREFIX)) return null;
    let raw;
    try { raw = b64urlDecode(clean.slice(PREFIX.length)); } catch (e) { return null; }
    if (raw.length !== BODY_LEN + SIG_LEN || raw[0] !== 1) return null;
    const body = raw.slice(0, BODY_LEN);
    const v = new DataView(body.buffer);
    const expiresAt = v.getUint32(10);
    return {
        key: clean,
        plan: PLAN_BY_CODE[body[1]] || 'custom',
        id: hex32(v.getUint32(2)),
        issuedAt: v.getUint32(6),
        expiresAt: expiresAt || null,
        body,
        sig: raw.slice(BODY_LEN),
    };
}

export async function generateKeyPair() {
    const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return { privateJwk, publicJwk: publicOnly(publicJwk), kid: await keyId(publicJwk) };
}

export function publicOnly(jwk) {
    return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export async function keyId(jwk) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwk.x + '.' + jwk.y));
    return b64urlEncode(new Uint8Array(digest)).slice(0, 10);
}

export const importPrivate = jwk => crypto.subtle.importKey('jwk', jwk, ALG, false, ['sign']);
export const importPublic = jwk => crypto.subtle.importKey('jwk', publicOnly(jwk), ALG, false, ['verify']);

export async function signKey(privateKey, fields) {
    const body = encodeBody(fields);
    const sig = new Uint8Array(await crypto.subtle.sign(SIGN_ALG, privateKey, signedBytes(body)));
    const raw = new Uint8Array(BODY_LEN + SIG_LEN);
    raw.set(body, 0);
    raw.set(sig, BODY_LEN);
    return PREFIX + b64urlEncode(raw);
}

export async function verifyKey(publicKey, key) {
    const p = parseKey(key);
    if (!p) return null;
    const ok = await crypto.subtle.verify(SIGN_ALG, publicKey, p.sig, signedBytes(p.body));
    return ok ? p : null;
}
