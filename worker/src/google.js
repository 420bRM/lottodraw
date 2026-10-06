// "구글로 로그인" 확인. 브라우저가 구글에서 받은 신원 증명(ID 토큰, RS256 서명 JWT)을
// 구글 공개키로 확인하고, 우리 사이트(GOOGLE_CLIENT_ID)에 발급된 것인지, 만료되지 않았는지,
// 이메일이 확인된 계정인지 본다. 비밀값은 필요 없다 — 클라이언트 ID 는 공개값이다.

import { b64urlDecode } from './keys.js';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const SKEW = 60;   // 시계 오차 허용(초)

let certs = null;   // { keys: { kid: CryptoKey }, until }

export function _resetGoogleForTests() { certs = null; }

async function loadCerts(force) {
    if (!force && certs && certs.until > Date.now()) return certs.keys;
    const res = await fetch(CERTS_URL);
    if (!res.ok) throw new Error('google certs ' + res.status);
    const body = await res.json();
    const keys = {};
    for (const jwk of body.keys || []) {
        if (jwk.kty !== 'RSA' || !jwk.kid) continue;
        keys[jwk.kid] = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    }
    const age = Number(((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/) || [])[1]) || 3600;
    certs = { keys, until: Date.now() + Math.min(age, 6 * 3600) * 1000 };
    return keys;
}

const decodeJson = part => JSON.parse(new TextDecoder().decode(b64urlDecode(part)));

// 맞으면 { sub, email } 을, 아니면 null 을 돌려준다.
export async function verifyGoogleToken(token, clientId, nowSec) {
    if (typeof token !== 'string' || token.length > 4096 || !clientId) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let header, payload, sig;
    try {
        header = decodeJson(parts[0]);
        payload = decodeJson(parts[1]);
        sig = b64urlDecode(parts[2]);
    } catch (e) { return null; }
    if (header.alg !== 'RS256' || !header.kid) return null;

    let keys = await loadCerts(false);
    if (!keys[header.kid]) keys = await loadCerts(true);   // 구글이 키를 바꾼 직후
    const key = keys[header.kid];
    if (!key) return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;

    const now = nowSec || Math.floor(Date.now() / 1000);
    if (ISSUERS.indexOf(payload.iss) === -1) return null;
    if (payload.aud !== clientId) return null;
    if (!(payload.exp > now - SKEW) || (payload.iat && payload.iat > now + SKEW)) return null;
    if (!payload.sub || !payload.email || !(payload.email_verified === true || payload.email_verified === 'true')) return null;
    return { sub: String(payload.sub), email: String(payload.email).toLowerCase().slice(0, 200) };
}
