#!/usr/bin/env node
/* Cloudflare 로 올린 사이트가 GitHub Pages 와 같게 도는지 본다(2026-11-16).
 *   node tools/check-site.js https://lottodraw-site.<계정>.workers.dev
 *   node tools/check-site.js http://127.0.0.1:8790          # wrangler dev(site-worker)
 *
 * 1) 사이트맵의 모든 주소가 넘김(3xx) 없이 200 — .html 주소 그대로(html_handling "none")
 * 2) 폴더 주소 · 확장자 없는 주소 · 404 가 GitHub Pages 와 같은 규칙(site-worker/index.js)
 * 3) 사이트에 나가면 안 되는 파일(README · tools · worker · content · 설정)은 404
 * 4) 검색 확인용 파일 · ads.txt 등 뿌리 파일이 있고, 캐시 머리가 10분(site-worker/_headers)
 * 하나라도 틀리면 끝에 모아 보이고 1 로 끝난다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('쓰는 법: node tools/check-site.js <사이트 주소>'); process.exit(2); }

const bad = [];
const get = (p, method = 'GET') => fetch(base + p, { method, redirect: 'manual' });
async function expect(p, want, why) {
    let r;
    try { r = await get(p, want.method); } catch (e) { bad.push(`${p}: 연결 실패 ${e.message}`); return null; }
    if (r.status !== want.status) bad.push(`${p}: ${r.status} (기대 ${want.status}) ${why || ''}`);
    if (want.location && !(r.headers.get('location') || '').endsWith(want.location)) bad.push(`${p}: Location ${r.headers.get('location')} (기대 …${want.location})`);
    if (want.type && !(r.headers.get('content-type') || '').includes(want.type)) bad.push(`${p}: Content-Type ${r.headers.get('content-type')} (기대 ${want.type})`);
    if (want.cache && r.headers.get('cache-control') !== want.cache) bad.push(`${p}: Cache-Control ${r.headers.get('cache-control')} (기대 ${want.cache})`);
    if (want.body) { const t = await r.text(); if (!t.includes(want.body)) bad.push(`${p}: 본문에 "${want.body}" 없음`); }
    else await r.arrayBuffer().catch(() => {});
    return r;
}

async function sitemapAll() {
    const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    const paths = [...xml.matchAll(/<loc>https:\/\/www\.lottodraw\.kr(\/[^<]*)<\/loc>/g)].map(m => m[1]);
    let i = 0, ok = 0;
    const worker = async () => {
        while (i < paths.length) {
            const p = paths[i++];
            try {
                const r = await get(p);
                await r.arrayBuffer();
                if (r.status === 200) ok++; else bad.push(`사이트맵 ${p}: ${r.status}${r.headers.get('location') ? ' → ' + r.headers.get('location') : ''}`);
            } catch (e) { bad.push(`사이트맵 ${p}: ${e.message}`); }
        }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    console.log(`사이트맵 ${paths.length}개 중 200: ${ok}`);
}

(async () => {
    await sitemapAll();
    const html = 'text/html', ten = 'public, max-age=600';
    // 폴더 · 확장자 없는 주소 · 쿼리
    await expect('/', { status: 200, type: html, body: 'lottodraw' });
    await expect('/index.html', { status: 200, type: html, cache: ten });
    await expect('/index.html?utm_source=x', { status: 200, type: html });
    await expect('/about', { status: 200, type: html, body: '로또드로우' }, 'GitHub Pages 처럼 about.html');
    await expect('/about', { status: 200, method: 'HEAD' });
    await expect('/blog', { status: 301, location: '/blog/' });
    await expect('/blog/', { status: 200, type: html });
    await expect('/ads/google-lottohex-1/', { status: 200, type: html });
    await expect('/round/1249.html', { status: 200, type: html });
    // 없는 주소
    await expect('/no-such-page.html', { status: 404, type: html, body: '페이지를 찾을 수 없습니다' });
    await expect('/round/99999.html', { status: 404, body: '페이지를 찾을 수 없습니다' });
    await expect('/nothing-here', { status: 404 });
    // 나가면 안 되는 파일
    for (const p of ['/README.md', '/ads/README.md', '/CNAME', '/_config.yml', '/_headers', '/.gitignore', '/.github/workflows/deploy-worker.yml',
        '/tools/build-static-stats.js', '/tools/build-dist.js', '/worker/src/index.js', '/worker/wrangler.toml', '/content/round-notes.md',
        '/site-worker/index.js', '/site-worker/wrangler.jsonc', '/preview/']) {
        await expect(p, { status: 404 }, '내부 파일');
    }
    // 뿌리 파일 · 자료
    for (const p of ['/ads.txt', '/robots.txt', '/sitemap.xml', '/rss.xml', '/llms.txt', '/df151d56acb974ec33c521ed980fa1f2.txt',
        '/naverea08fac91d2376a8c481da4011d18793.html', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']) {
        await expect(p, { status: 200 });
    }
    await expect('/lotto-data.json', { status: 200, type: 'application/json', cache: ten });
    await expect('/css/site.css?v=abc', { status: 200, type: 'text/css', cache: ten });
    await expect('/js/store-map.js', { status: 200, type: 'javascript' });

    if (bad.length) { console.log(`틀린 곳 ${bad.length}개:\n- ` + bad.slice(0, 60).join('\n- ')); process.exit(1); }
    console.log('모두 맞음');
})();
