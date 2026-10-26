#!/usr/bin/env node
// 판매점 지도 랜드마크 모형 자료 → store-map-landmarks.json (2026-10-26)
//
// OpenStreetMap 의 건물 · 건물 부분(building:part) 외곽선과 높이를 받아(Overpass, tools/probe-landmarks.js 가 받은 원자료),
// 랜드마크마다 쓸 부분을 골라 유리(glass) · 돌(solid) · 강조(accent)로 나눠 적는다. 지도(js/store-map.js)가 이것으로
// 반투명 유리 몸통 + 세로 기둥 + 층 띠를 세운다. 자료 © OpenStreetMap 기여자(ODbL) — 지도 아래 표기와 같다.
//
//   node tools/build-landmarks.js <overpass.json> [<overpass2.json> …]
//
// 건물이 바뀌는 일은 드물어 매주 돌리지 않는다. 새 랜드마크를 더할 때 LANDMARKS 에 적고 다시 받는다.
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'store-map-landmarks.json');
const LV = 4.3;   // 층수만 있는 부분의 층 높이(m)

// 랜드마크마다: 쓸 OSM 길(way) 번호와 모양. kind: glass(반투명 유리) · solid(돌 · 콘크리트) · accent(강조색)
//  base/top 을 적으면 OSM 높이 대신 쓴다. dome: 반구로 쌓기, taper: 위로 갈수록 좁게(k = 꼭대기 크기 비율)
const LANDMARKS = [
    { name: '롯데월드타워', glass: '#cfe0f5', frame: '#4f74a8', ribs: 12, ribW: 2.2, floor: 18, parts: [
        { id: 879571752, kind: 'glass' },
        { id: 888605472, kind: 'glass', base: 199.7 },
        { id: 888605473, kind: 'glass' }, { id: 879571750, kind: 'glass' },
        { id: 879798717, kind: 'glass' }, { id: 888605471, kind: 'glass' }, { id: 879798716, kind: 'glass' }, { id: 888605470, kind: 'glass' },
        { id: 635073462, kind: 'glass', base: 507, top: 520 },
        { id: 635073469, kind: 'accent', color: '#a9c8ec', base: 520, top: 554.5 },
        { id: 635073470, kind: 'accent', color: '#a9c8ec', base: 520, top: 554.5 },
    ] },
    { name: '63빌딩', glass: '#e8b53a', frame: '#8a6410', ribs: 9, ribW: 1.8, floor: 12, parts: [
        { id: 463188395, kind: 'glass' }, { id: 463384207, kind: 'glass' }, { id: 463384208, kind: 'glass' },
        { id: 463188396, kind: 'glass', taper: 0.25 }, { id: 463188397, kind: 'glass', taper: 0.25 },
        { id: 463384209, kind: 'solid', color: '#ffffff' },
    ] },
    { name: 'N서울타워', glass: '#f7c6b5', frame: '#d9583c', ribs: 0, ribW: 0.9, floor: 0, parts: [
        { id: 1214950316, kind: 'solid', color: '#ffffff', base: 0, top: 10 },
        { id: 370286010, kind: 'solid', color: '#ffffff', base: 0, top: 88, scale: 0.75 },
        { id: 1214950323, kind: 'glass', ribs: 20, floor: 3 },
        { id: 1214950322, kind: 'accent', color: '#ee7b5f' },
        { id: 370286010, kind: 'solid', color: '#ffffff', base: 112, top: 150, scale: 0.6, taper: 0.55 },
        { id: 370286010, kind: 'accent', color: '#ee7b5f', base: 150, top: 236.7, scale: 0.3, taper: 0.25 },
    ] },
    { name: 'IFC 서울', glass: '#cddcf1', frame: '#5c7fb0', ribs: 0, ribEvery: 5, ribW: 1.4, floor: 16, parts: [
        { id: 621752528, kind: 'glass' }, { id: 621752527, kind: 'glass' },
        { id: 639943642, kind: 'glass' }, { id: 639943641, kind: 'glass', top: 160 }, { id: 639943643, kind: 'glass', top: 90 },
        { id: 621752531, kind: 'glass' },
        { id: 621752532, kind: 'solid', color: '#e9ecf0' },
    ] },
    { name: '파크원', glass: '#e3e8ef', frame: '#e8483a', ribs: 4, ribW: 4, floor: 24, parts: [
        { id: 874639189, kind: 'glass', top: 333 },
    ] },
    { name: '국회의사당', glass: '#dfe6ee', frame: '#9aa6b4', ribs: 8, ribW: 1, floor: 8, parts: [
        { id: 608162297, kind: 'solid', color: '#f1f0ec' },
        { id: 270596342, kind: 'solid', color: '#ecebe6', base: 0, top: 10 },
        { id: 608162749, kind: 'glass', base: 10, top: 40 },
        { id: 639632935, kind: 'solid', color: '#e9ebee' },
        { id: 270594679, kind: 'accent', color: '#95b5ae', dome: true },
        ...[608164568, 608164569, 608164570, 608164571, 608164572, 608164573, 608164574, 608164575, 608164576, 608164577, 608164578, 608164579,
            608164580, 608164581, 608164582, 608164583, 608164584, 608164585, 608164586, 608164587, 608164588, 608164589, 608164590, 608164591]
            .map(id => ({ id, kind: 'solid', color: '#ffffff', base: 10 })),
    ] },
];

const num = v => (v === undefined || v === '' ? null : parseFloat(v));
function heights(t) {
    let top = num(t.height), base = num(t.min_height);
    if (top === null && t['building:levels']) top = num(t['building:levels']) * LV;
    if (base === null && t['building:min_level']) base = num(t['building:min_level']) * LV;
    return { base: base || 0, top: top || 0 };
}

const ways = new Map();
for (const f of process.argv.slice(2)) for (const e of JSON.parse(fs.readFileSync(f, 'utf8')).elements) if (e.type === 'way' && e.geometry) ways.set(e.id, e);

const out = [];
for (const lm of LANDMARKS) {
    const parts = [];
    for (const p of lm.parts) {
        const w = ways.get(p.id);
        if (!w) { console.error(`${lm.name}: ${p.id} 없음`); continue; }
        const h = heights(w.tags);
        const ring = w.geometry.map(g => [Math.round(g.lon * 1e7) / 1e7, Math.round(g.lat * 1e7) / 1e7]);
        const part = { kind: p.kind, base: p.base !== undefined ? p.base : h.base, top: p.top !== undefined ? p.top : h.top, ring };
        ['color', 'dome', 'taper', 'scale', 'ribs', 'floor'].forEach(k => { if (p[k] !== undefined) part[k] = p[k]; });
        if (!(part.top > part.base)) { console.error(`${lm.name}: ${p.id} 높이 없음`, h); continue; }
        parts.push(part);
    }
    out.push({ name: lm.name, glass: lm.glass, frame: lm.frame, ribs: lm.ribs, ribW: lm.ribW, ribEvery: lm.ribEvery || 0, floor: lm.floor, parts });
    console.log(lm.name, parts.length + '부분', Math.max(...parts.map(p => p.top)) + 'm');
}
// 바탕 지도(OpenMapTiles)에도 같은 건물이 있어 모형과 겹친다 — 랜드마크 자리(외곽 네모)에 있는 높이 150m 넘는 OSM 건물의 높이를 모아 두면
// 지도가 그 높이(render_height)의 바탕 건물을 감춘다. 이렇게 높고 딱 떨어지는 높이는 다른 건물과 거의 겹치지 않는다
const hide = new Set();
for (const lm of out) {
    const xs = lm.parts.flatMap(p => p.ring.map(q => q[0])), ys = lm.parts.flatMap(p => p.ring.map(q => q[1]));
    const [x0, x1, y0, y1] = [Math.min(...xs) - 3e-4, Math.max(...xs) + 3e-4, Math.min(...ys) - 3e-4, Math.max(...ys) + 3e-4];
    for (const w of ways.values()) {
        const n = w.geometry.length, cx = w.geometry.reduce((a, g) => a + g.lon, 0) / n, cy = w.geometry.reduce((a, g) => a + g.lat, 0) / n;
        const h = heights(w.tags).top;
        if (cx > x0 && cx < x1 && cy > y0 && cy < y1 && h >= 150) hide.add(Math.round(h * 10) / 10);
    }
}
console.log('감출 바탕 건물 높이', [...hide].sort((a, b) => a - b).join(' '));
fs.writeFileSync(OUT, JSON.stringify({ source: '© OpenStreetMap contributors (ODbL) — tools/build-landmarks.js', hide: [...hide].sort((a, b) => a - b), landmarks: out }) + '\n');
