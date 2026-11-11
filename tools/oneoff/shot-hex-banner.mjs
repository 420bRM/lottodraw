// 한 번만 쓰는 찍기(2026-11-09) — 바닥글 아래 "LottoHex" 띠(js/theme.js)의 배경: img/hex-banner.jpg(PC 1800×360) · img/hex-banner-m.jpg(휴대폰 900×480).
// 지도는 실제(OpenFreeMap 밤 지도 + 판매점 빛), 칸 주인은 꾸밈용 예시(서울 도심 칸에 색 · 무늬만 — 별명 글씨는 감춘다).
// 실행: BASE=http://localhost:8765 node tools/oneoff/shot-hex-banner.mjs   (MOCK_TILES=1 이면 지도 바탕 없이 — 이 환경 시험용)
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HX = require('../../js/hexgrid.js');

const BASE = process.env.BASE || 'http://localhost:8765';
const OUT = process.env.OUT || 'img';
const CENTER = [126.985, 37.566];   // 서울 도심
const all = JSON.parse(fs.readFileSync(new URL('../../store-map-cells.json', import.meta.url))).cells;
const SKINS = ['e63946,f4a261,3', '4cc9f0,1d3557,1', '8338ec,e9c46a,2', '2a9d8f,b5e48c,0', 'ff9f1c,ffe8a3,1', 'ff6fae,ffd76a,2', '3a86ff,c77dff,3', '52b788,1f2937,1'];
const h = s => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
const km = ([lng1, lat1], [lng2, lat2]) => Math.hypot((lng2 - lng1) * 88.2, (lat2 - lat1) * 111);
const cells = {};
for (const [k, ids] of Object.entries(all)) {
    if (km(HX.centerOf(k), CENTER) > 9) continue;
    if (h(k) % 10 < 3) continue;   // 회색지대
    // 이웃한 칸이 같은 주인이 되기 쉽게(덩어리) — 칸 좌표를 성기게 묶어 고른다
    const [q, r] = k.split(',').map(Number);
    const who = h(Math.floor(q / 3) + ':' + Math.floor(r / 2)) % SKINS.length;
    cells[k] = ['', Math.min(ids.length, 2), 0, 1, SKINS[who]];
}
console.log('칸', Object.keys(cells).length);

const HIDE = 'header,footer,.sm-side,#sm-side,.sm-near-btn,.maplibregl-control-container,#theme-btn,#map-fab,#chat-fab,#chat-panel,#sm-terr,#sm-card,.sm-hexfx,.sm-consent-pop,.sm-geo-pop,.sm-toast,.sm-info,.sm-bl,.map-band,.hex-band{display:none!important}' +
    '#sm-map{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;margin:0!important;border-radius:0!important}';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function shot(w, hgt, dpr, view, out) {
    const ctx = await b.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: dpr, locale: 'ko-KR' });
    await ctx.addInitScript(() => {
        let ml; Object.defineProperty(window, 'maplibregl', { configurable: true, get: () => ml, set: v => { const M = v.Map; v.Map = class extends M { constructor(o) { super(o); window.__map = this; } }; ml = v; } });
        localStorage.setItem('lottodraw.lang', 'ko');
    });
    await ctx.route(/googlesyndication|cloudflareinsights/, r => r.abort());
    if (process.env.MOCK_TILES) await ctx.route('https://tiles.openfreemap.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#1b2030' } }] }) }));
    await ctx.route('https://api.lottodraw.kr/**', async r => {
        const path = new URL(r.request().url()).pathname;
        const j = o => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
        if (path === '/api/config') return j({ login: { google: 'x', trialDays: 0, gps: true, geoV: 1, terrV: 2 }, chat: false });
        if (path === '/api/territory') return j({ season: { id: '2026Q4', from: 0, to: 0 }, players: 8, cells, rank: [], last: null });
        return j({});
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.goto(BASE + '/lottohex.html');
    await p.addStyleTag({ content: HIDE });
    await p.waitForTimeout(9000);
    await p.evaluate(v => {
        const m = window.__map;
        m.resize();
        ['terr-name', 'hx-name'].forEach(id => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none'); });
        m.jumpTo(v);
    }, view);
    console.log(out, 'after jump', await p.evaluate(() => window.__map.getZoom()));
    await p.waitForTimeout(7000);
    console.log(out, 'before shot', await p.evaluate(() => [window.__map.getZoom(), window.__map.getCenter(), window.__map.getMaxZoom(), window.__map.getMinZoom()]));
    await p.screenshot({ path: OUT + '/' + out, type: 'jpeg', quality: 84 });
    await ctx.close();
}
// PC 띠: 글은 왼쪽, 칸은 오른쪽(왼쪽을 비워 둔다)
await shot(1800, 360, 1, { center: CENTER, zoom: 12.1, padding: { left: 900, top: 0, right: 0, bottom: 0 } }, 'hex-banner.jpg');
// 휴대폰 띠: 글은 위, 칸은 아래
await shot(450, 240, 2, { center: CENTER, zoom: 11.7, padding: { top: 140, left: 0, right: 0, bottom: 0 } }, 'hex-banner-m.jpg');
await b.close();
