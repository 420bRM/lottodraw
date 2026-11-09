// 한 번만 쓰는 찍기(2026-11-09) — 블로그 "LottoHex 하는 법"의 화면 예시 3장(img/blog/lottohex-*.jpg).
// 지도는 실제(OpenFreeMap), LottoHex 자료는 예시(별명 · 칸 · 랭킹 모두 가짜 — 그림 설명에 "예시"라고 적는다).
// 실행: BASE=http://localhost:8765 node tools/oneoff/shot-lottohex.mjs   (MOCK_TILES=1 이면 지도 바탕 없이 — 이 환경 시험용)
import fs from 'fs';
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');   // 전역 설치(NODE_PATH)도 찾게

const BASE = process.env.BASE || 'http://localhost:8765';
const OUT = process.env.OUT || 'img/blog';
const CELLS = JSON.parse(fs.readFileSync(new URL('./lottohex-demo-cells.json', import.meta.url)));
fs.mkdirSync(OUT, { recursive: true });

// 예시 자료: 서울 시청 · 종로 둘레 칸 47개 중 3분의 2쯤을 여섯 명이 나눠 가진다(나머지는 회색지대)
const ME = '종로산책';
const NICKS = [ME, '광화문펭귄', '을지로러', '북촌고양이', '명동다람쥐', '행운의수달4821'];
const SKIN = { [ME]: 'e63946,f4a261,3', 광화문펭귄: '4cc9f0,1d3557,1', 을지로러: '8338ec,e9c46a,2', 북촌고양이: '2a9d8f,b5e48c,0', 명동다람쥐: 'ff9f1c,ffe8a3,1', 행운의수달4821: 'ff6fae,ffd76a,2' };
const h = s => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
const cells = {}, stat = {};
for (const [k, ids] of Object.entries(CELLS)) {
    const [q, r] = k.split(',').map(Number);
    if (h(k) % 10 < 3 && k !== '-142,193') continue;   // 회색지대
    const nick = NICKS[((q * 3 + r * 5) % NICKS.length + NICKS.length) % NICKS.length];
    const n = Math.min(ids.length, 1 + h(k + 'n') % 3), next = Math.max(0, n - 1 - h(k + 'x') % 2);
    cells[k] = [nick, n, next, next ? 2 : 1, SKIN[nick]];
    const s = stat[nick] || (stat[nick] = { cells: 0, stores: 0, keys: [] });
    s.cells++; s.stores += n; s.keys.push(k);
}
const rank = Object.entries(stat).sort((a, b) => b[1].cells - a[1].cells || b[1].stores - a[1].stores).map(([nick, s]) => ({ nick, cells: s.cells, stores: s.stores, skin: SKIN[nick] }));
const mine = stat[ME];
const now = Date.now();
const season = { id: '2026Q4', from: Date.UTC(2026, 9, 1) - 9 * 3600e3, to: Date.UTC(2027, 0, 1) - 9 * 3600e3 };
const terr = () => ({ season, players: rank.length, cells, rank, last: null,
    me: { joined: true, cells: mine.keys, counts: Object.fromEntries(mine.keys.map(k => [k, cells[k][1]])), stores: mine.stores, rank: rank.findIndex(r => r.nick === ME) + 1, lastRank: null, skin: SKIN[ME], skinSet: true } });
const V = {}, VA = {};
mine.keys.slice(0, 4).forEach((k, i) => { V[CELLS[k][0]] = '#e63946'; VA[CELLS[k][0]] = now - (i + 1) * 86400e3; });
let verified = 4;
const user = () => ({ email: 'demo@example.com', nick: ME, createdAt: now - 20 * 86400e3, staff: false,
    score: { total: 120 + verified * 10, avail: 120 + verified * 10, days: 12, reacts: 0, buy: 0, verified, hex: 0, spent: 0 },
    visits: V, visitAt: VA, visitColor: '#e63946', visitColors: ['#e63946'], visitBadge: false, terr: { at: now - 5 * 86400e3, v: 2 }, terrSkin: SKIN[ME],
    geo: { at: now - 5 * 86400e3, v: 1 }, notes: 0 });

// 카드 사진: 시청 북쪽 판매점(칸 -143,194) 앞 20m
const SHOP = { id: '11100311', lat: 37.5774, lng: 126.9724 };

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function page(url, geo) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR', isMobile: true, hasTouch: true,
        permissions: geo ? ['geolocation'] : [], geolocation: geo || undefined });
    await ctx.addInitScript(() => {
        let ml; Object.defineProperty(window, 'maplibregl', { configurable: true, get: () => ml, set: v => { const M = v.Map; v.Map = class extends M { constructor(o) { super(o); window.__map = this; } }; ml = v; } });
        localStorage.setItem('lottodraw.account', JSON.stringify({ session: 'demo', email: 'demo@example.com' }));
        localStorage.setItem('lottodraw.lang', 'ko');
    });
    await ctx.route(/googlesyndication|cloudflareinsights/, r => r.abort());
    if (process.env.MOCK_TILES) await ctx.route('https://tiles.openfreemap.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#1b2030' } }] }) }));
    await ctx.route('https://api.lottodraw.kr/**', async r => {
        const path = new URL(r.request().url()).pathname;
        const j = o => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
        if (path === '/api/config') return j({ login: { google: 'x', trialDays: 0, gps: true, geoV: 1, terrV: 2 }, chat: false });
        if (path === '/api/me') return j({ user: user(), reactions: {} });
        if (path === '/api/territory') return j(terr());
        if (path === '/api/me/visits') { const q = JSON.parse(r.request().postData() || '{}'); V[q.id] = '#e63946'; VA[q.id] = Date.now(); verified++; return j({ visits: V, visitAt: VA, visitColor: '#e63946', earned: 10, score: user().score }); }
        if (path.startsWith('/api/comments')) return j({ comments: [] });
        return j({});
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.goto(BASE + url);
    return { p, ctx };
}
const clipOf = async (p, sel, pad = 8) => {
    const r = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }, sel);
    if (!r) return undefined;
    const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
    return { x, y, width: Math.min(390 - x, r.width + pad * 2), height: Math.min(844 - y, r.height + pad * 2) };
};

// 1) 지도: LottoHex 밤 지도 · 칸 · 아래 판(접힘)
{
    const { p, ctx } = await page('/lottohex.html#map=13.8/37.5762/126.9832/0/0');
    await p.waitForTimeout(11000);
    await p.screenshot({ path: OUT + '/lottohex-map.jpg', type: 'jpeg', quality: 82 });
    // 3) 랭킹: 아래 판 "랭킹" 탭
    await p.click('.sm-sheet-tabs [data-ttab="rank"]'); await p.waitForTimeout(1200);
    const rc = await clipOf(p, '#sm-terr', 0);
    const lastY = await p.evaluate(() => { const li = [...document.querySelectorAll('#sm-terr .sm-terr-rank li')].pop(); return li ? li.getBoundingClientRect().bottom : null; });
    if (rc && lastY) rc.height = Math.min(rc.height, lastY - rc.y + 18);
    await p.screenshot({ path: OUT + '/lottohex-rank.jpg', type: 'jpeg', quality: 82, clip: rc });
    await ctx.close();
}
// 2) 카드: 판매점 점을 눌러 카드 → "다녀왔어요" → 위치로 확인 · +10포인트
{
    const { p, ctx } = await page('/lottohex.html#map=15.6/37.5770/126.9728/0/0', { latitude: SHOP.lat + 0.00015, longitude: SHOP.lng + 0.0001, accuracy: 12 });
    await p.waitForTimeout(11000);
    const pt = await p.evaluate(s => { const m = window.__map; const q = m.project([s.lng, s.lat]); return { x: q.x, y: q.y }; }, SHOP);
    await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(2500);
    const btn = await p.$('#sm-card .sm-visit-btn');
    console.log('card open:', !!btn, await p.evaluate(() => (document.querySelector('#sm-card h3, #sm-card h2') || {}).textContent));
    if (btn) { await btn.click(); await p.waitForTimeout(2500); }
    console.log('note:', await p.evaluate(() => (document.querySelector('#sm-card .sm-visit-note') || {}).textContent));
    await p.evaluate(() => { const v = document.getElementById('sm-visit'); if (v) v.scrollIntoView({ block: 'center' }); });
    await p.waitForTimeout(500);
    await p.screenshot({ path: OUT + '/lottohex-card.jpg', type: 'jpeg', quality: 82, clip: await clipOf(p, '#sm-visit', 6) });
    await ctx.close();
}
await b.close();
console.log('rank:', rank.map(r => r.nick + ' ' + r.cells).join(' · '));
