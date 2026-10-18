#!/usr/bin/env node
// 블로그 조회수 시작값: Cloudflare Web Analytics 의 글별 페이지뷰를 Worker 에 넣는다 (2026-10-18).
//
// 조회수는 js/views.js 가 UNTIL(2026-10-18 18:41 KST, 블로그 페이지에 views.js 가 올라간 때)부터 직접 센다.
// 그 전 방문은 Cloudflare Web Analytics 에만 있어서, UNTIL 까지의 페이지뷰를 글마다 시작값으로 넣는다.
// 보이는 조회수 = 시작값 + 직접 센 수. UNTIL 에서 잘라 같은 방문을 두 번 세지 않는다.
//
// - 페이지뷰(count)는 새로 고침도 하나씩 센다. 직접 세는 쪽은 같은 브라우저의 같은 글을 하루 한 번만 세므로 시작값 쪽이 조금 후하다.
//   표에는 방문(visits — 다른 사이트에서 들어와 처음 본 쪽)도 같이 보인다.
// - 시작값은 통째로 갈아 끼운다(/api/admin/views/base) — 다시 돌려도 두 번 더해지지 않는다.
// - 주소는 /blog/<글>.html · /blog/<글> 을 한 글로 친다. lottodraw.kr · www.lottodraw.kr 둘 다.
//
// 사용: GitHub Actions → seed-views → Run workflow. apply 를 끄면 표만 보이고, 켜면 Worker 에 넣는다.
//   CF_TOKEN     Cloudflare API 토큰. 권한 "Account Analytics: Read" 가 있어야 한다
//                (secrets.CF_ANALYTICS_TOKEN, 없으면 배포용 CLOUDFLARE_API_TOKEN 을 써 본다)
//   CF_ACCOUNT   Cloudflare 계정 ID (secrets.CLOUDFLARE_ACCOUNT_ID)
//   ADMIN_TOKEN  Worker 관리자 토큰 (apply 때만)
//   APPLY        'true' 면 넣는다
//   MANUAL       (선택) Cloudflare 대신 쓸 값 JSON — {"lotto-tax-guide": 120, …}. 대시보드에서 읽은 수를 넣을 때
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UNTIL = '2026-10-18T09:41:00Z';    // GitHub Pages 배포가 끝난 때(09:40:59Z). 이 뒤로는 직접 센다
const FROM = '2026-09-01T00:00:00Z';     // 블로그보다 앞. Cloudflare 보관 기간(notOlderThan)이 짧으면 거기서 자른다
const HOST = /(^|\.)lottodraw\.kr$/;
const PAGE = 10000;
const GQL = 'https://api.cloudflare.com/client/v4/graphql';
const API = String(process.env.API_BASE || 'https://api.lottodraw.kr').replace(/\/+$/, '');
const env = k => String(process.env[k] || '').trim();

const slugs = fs.readdirSync(path.join(ROOT, 'blog')).filter(f => f.endsWith('.html') && f !== 'index.html').map(f => f.slice(0, -5)).sort();
const slugOf = p => { const m = p.match(/^\/blog\/([a-z0-9][a-z0-9-]*?)(?:\.html)?\/?$/); return m && m[1] !== 'index' ? m[1] : null; };

async function gql(token, query) {
    const res = await fetch(GQL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errors) {
        const msg = (data.errors || []).map(e => e.message).join(' / ') || ('HTTP ' + res.status);
        throw new Error(msg);
    }
    return data.data;
}

// 계정의 모든 사이트 페이지뷰를 [from, to) 동안 주소별로. 한 번에 PAGE 줄을 다 채우면 기간을 반으로 나눠 다시 묻는다
async function rows(token, account, from, to) {
    const q = `{ viewer { accounts(filter: { accountTag: "${account}" }) {
        rumPageloadEventsAdaptiveGroups(limit: ${PAGE}, filter: { datetime_geq: "${from.toISOString()}", datetime_lt: "${to.toISOString()}" }) {
            count sum { visits } dimensions { requestHost requestPath }
        } } } }`;
    const got = (await gql(token, q)).viewer.accounts[0].rumPageloadEventsAdaptiveGroups;
    if (got.length < PAGE || to - from <= 3600 * 1000) return got;
    const mid = new Date(from.getTime() + Math.floor((to - from) / 2));
    return (await rows(token, account, from, mid)).concat(await rows(token, account, mid, to));
}

async function fromCloudflare() {
    const token = env('CF_TOKEN');
    const account = env('CF_ACCOUNT');
    if (!token || !/^[0-9a-f]{32}$/.test(account)) throw new Error('CF_TOKEN · CF_ACCOUNT(32자리 계정 ID)가 없다');

    // 보관 기간 · 한 번에 물을 수 있는 기간. 못 읽으면 하루씩 FROM 부터
    let step = 86400, keep = 0;
    try {
        const s = (await gql(token, `{ viewer { accounts(filter: { accountTag: "${account}" }) { settings { rumPageloadEventsAdaptiveGroups { maxDuration notOlderThan } } } } }`))
            .viewer.accounts[0].settings.rumPageloadEventsAdaptiveGroups;
        step = Math.min(step, s.maxDuration || step);
        keep = s.notOlderThan || 0;
        console.log(`Cloudflare 보관 기간 ${Math.round(keep / 86400)}일, 한 번에 ${Math.round(s.maxDuration / 3600)}시간까지 묻는다`);
    } catch (e) {
        console.log(`::warning::Cloudflare 설정을 읽지 못해 하루씩 묻는다: ${e.message}`);
    }
    const until = new Date(UNTIL);
    let from = new Date(FROM);
    if (keep) from = new Date(Math.max(from, Date.now() - keep * 1000 + 3600 * 1000));

    const pv = {}, visits = {}, other = {};
    for (let t = from; t < until; t = new Date(Math.min(t.getTime() + step * 1000, until))) {
        const to = new Date(Math.min(t.getTime() + step * 1000, until));
        for (const r of await rows(token, account, t, to)) {
            if (!HOST.test(r.dimensions.requestHost || '')) continue;
            const p = r.dimensions.requestPath || '';
            const slug = slugOf(p);
            if (slug && slugs.includes(slug)) {
                pv[slug] = (pv[slug] || 0) + r.count;
                visits[slug] = (visits[slug] || 0) + ((r.sum && r.sum.visits) || 0);
            } else if (p.startsWith('/blog/') && slug) {
                other[p] = (other[p] || 0) + r.count;
            }
        }
    }
    console.log(`읽은 기간: ${from.toISOString()} ~ ${UNTIL}`);
    if (Object.keys(other).length) console.log('지금 없는 글 주소(넣지 않는다):', JSON.stringify(other));
    return { pv, visits, from: from.toISOString() };
}

function manual(raw) {
    const v = JSON.parse(raw);
    const out = {};
    for (const [k, n] of Object.entries(v)) {
        if (!slugs.includes(k)) throw new Error(`MANUAL 의 "${k}" 는 blog/ 에 없는 글이다`);
        if (!Number.isInteger(n) || n < 0) throw new Error(`MANUAL 의 "${k}" 값이 0 이상의 정수가 아니다`);
        out[k] = n;
    }
    return { pv: out, visits: {}, from: null };
}

async function admin(method, sub, body) {
    const res = await fetch(API + '/api/admin' + sub, {
        method, headers: Object.assign({ Authorization: 'Bearer ' + env('ADMIN_TOKEN') }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Worker ${sub}: ${data.message || 'HTTP ' + res.status}`);
    return data;
}

function table(lines, head) {
    const md = ['| ' + head.join(' | ') + ' |', '|' + head.map((h, i) => (i ? '---:' : '---')).join('|') + '|'].concat(lines.map(l => '| ' + l.join(' | ') + ' |'));
    console.log(md.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n\n');
}

async function main() {
    const raw = env('MANUAL');
    const src = raw ? manual(raw) : await fromCloudflare();
    const n = x => (x || 0).toLocaleString('en-US');
    const order = slugs.slice().sort((a, b) => (src.pv[b] || 0) - (src.pv[a] || 0) || (a < b ? -1 : 1));
    const total = slugs.reduce((s, k) => s + (src.pv[k] || 0), 0);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 조회수 시작값 (${raw ? '직접 넣은 값' : `Cloudflare 페이지뷰, ${src.from} ~ ${UNTIL}`})\n\n`);
    }
    table(order.map(k => [k, n(src.pv[k])].concat(raw ? [] : [n(src.visits[k])]))
        .concat([['**합계**', n(total)].concat(raw ? [] : [n(slugs.reduce((s, k) => s + (src.visits[k] || 0), 0))])]),
    ['글', '시작값(페이지뷰)'].concat(raw ? [] : ['참고: 방문']));

    if (env('APPLY') !== 'true') {
        console.log('\n표만 보였다. Run workflow 에서 apply 를 켜고 다시 돌리면 Worker 에 넣는다.');
        return;
    }
    if (!env('ADMIN_TOKEN')) throw new Error('ADMIN_TOKEN 이 없다');
    if (!total) throw new Error('시작값이 모두 0 이다 — 넣지 않는다(Cloudflare 기간 · 주소를 확인)');
    const base = {};
    slugs.forEach(k => { if (src.pv[k]) base[k] = src.pv[k]; });
    const r = await admin('POST', '/views/base', { base, until: UNTIL });
    console.log(`\nWorker 에 넣었다: 글 ${r.posts}편`);
    const s = await admin('GET', '/views');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### 넣은 뒤 사이트에 보이는 수\n\n');
    table(order.map(k => [k, n(s.base[k]), n(s.counted[k]), n((s.base[k] || 0) + (s.counted[k] || 0))]), ['글', '시작값', '직접 센 수', '보이는 수']);
}

main().catch(e => {
    console.error('::error::' + e.message);
    if (/auth|permission|not authorized|access/i.test(e.message)) {
        console.error('Cloudflare 토큰에 "Account Analytics: Read" 권한이 없는 것 같다. Cloudflare → My Profile → API Tokens 에서 이 권한만 준 토큰을 만들어'
            + ' GitHub 저장소 Settings → Secrets and variables → Actions 에 CF_ANALYTICS_TOKEN 으로 넣고 다시 돌린다.');
    }
    process.exit(1);
});
