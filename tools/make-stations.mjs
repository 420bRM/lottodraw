#!/usr/bin/env node
// 판매점 지도의 역(2026-11-10 사장님 — "역 이름 검색도, 지도에 역 표시도") 목록을 만든다 → store-map-stations.json
//
// 원자료: OpenStreetMap(© OpenStreetMap 기여자, ODbL 1.0) — 한국 안의 철도역 · 도시철도역(railway=station|halt).
// 이 파일(store-map-stations.json)은 OSM 에서 뽑은 자료라 ODbL 1.0 을 따른다(출처 표시는 지도 "시도별 · 안내" 칸).
// 역마다 이름("역"은 뗌) · 위치 · 종류(0 도시철도 · 1 철도) · 지역(가장 가까운 읍·면·동의 시·도 · 시 · 구 — store-map-places.json) · 영어 이름.
// 같은 이름이 500m 안에 여럿이면(노선마다 따로 찍힌 점) 하나로 합친다. 역이 생기거나 바뀌었을 때만 다시 돌린다(매주 X):
//   node tools/make-stations.mjs                 (Overpass API 에서 받는다 — 이 저장소의 GitHub 워크플로에서 돌렸다)
//   node tools/make-stations.mjs overpass.json   (받아 둔 Overpass 결과로)
import fs from 'fs';

const QUERY = '[out:json][timeout:300];area["ISO3166-1"="KR"]["admin_level"="2"]->.kr;nwr["railway"~"^(station|halt)$"]["name"](area.kr);out center tags;';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
async function fetchOverpass() {
    for (const url of MIRRORS) {
        try {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'lottodraw.kr station list (one-off build)' }, body: 'data=' + encodeURIComponent(QUERY), signal: AbortSignal.timeout(320000) });
            if (r.ok) return await r.json();
            console.log(url, r.status);
        } catch (e) { console.log(url, e.message); }
    }
    throw new Error('Overpass 를 받지 못했습니다');
}
const raw = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : await fetchOverpass();

// 지역: 가장 가까운 읍·면·동
const P = JSON.parse(fs.readFileSync(new URL('../store-map-places.json', import.meta.url), 'utf8'));
const S = P.s.map(x => x[0]);
function regionOf(lng, lat) {
    let best = null, bd = Infinity;
    const k = Math.cos(lat * Math.PI / 180);
    for (const d of P.d) { const dx = (d[2] - lng) * k, dy = d[3] - lat, v = dx * dx + dy * dy; if (v < bd) { bd = v; best = d; } }
    const [s, si, gu] = P.g[best[0]];
    return [S[s], si, gu];
}
const base = n => String(n || '').replace(/\s*\(.*?\)\s*/g, '').replace(/역$/, '').trim();
const baseEn = n => String(n || '').replace(/\s*\(.*?\)\s*/g, '').replace(/\s+(Station|Stn\.?)$/i, '').trim();
const pts = [];
for (const e of raw.elements || []) {
    const t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lng == null) continue;
    if (/^(disused|abandoned|construction|proposed)/.test(t.railway || '') || t['disused:railway'] || t.disused === 'yes') continue;
    const name = base(t['name:ko'] || t.name);
    if (!name || !/[가-힣]/.test(name)) continue;
    const metro = /^(subway|light_rail|monorail)$/.test(t.station || '') || t.subway === 'yes' || t.light_rail === 'yes';
    pts.push({ name, en: baseEn(t['name:en']), lat, lng, kind: metro ? 0 : 1 });
}
// 같은 이름 500m 안 → 하나로
const km = (a, b) => Math.hypot((a.lng - b.lng) * 88.2, (a.lat - b.lat) * 111);
const out = [];
for (const p of pts) {
    const m = out.find(o => o.name === p.name && km(o, p) < 0.5);
    if (m) { m.n++; m.lat += (p.lat - m.lat) / m.n; m.lng += (p.lng - m.lng) / m.n; m.kind = Math.min(m.kind, p.kind); if (!m.en && p.en) m.en = p.en; }
    else out.push(Object.assign({ n: 1 }, p));
}
const r5 = v => Math.round(v * 1e5) / 1e5;
const rows = out.sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(o => [o.name, r5(o.lng), r5(o.lat), o.kind].concat(regionOf(o.lng, o.lat), o.en || ''));
const res = {
    note: '판매점 지도의 역(tools/make-stations.mjs). s: [이름("역" 뗌), 경도, 위도, 0 도시철도 · 1 철도, 시·도, 시, 구, 영어 이름]',
    src: 'Station names and positions © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0, https://www.openstreetmap.org/copyright). This file is a derived database under ODbL.',
    s: rows,
};
fs.writeFileSync(new URL('../store-map-stations.json', import.meta.url), JSON.stringify(res) + '\n');
console.log(`역 ${rows.length}곳(도시철도 ${rows.filter(r => r[3] === 0).length} · 철도 ${rows.filter(r => r[3] === 1).length}), 원자료 점 ${pts.length}`);
