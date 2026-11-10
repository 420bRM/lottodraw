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

// 남한을 덮는 네모(북한 · 일본 쪽은 아래에서 가장 가까운 읍·면·동이 멀면 뺀다) — 나라 전체 area 질의는 서버가 자주 504 를 냈다
const BBOX = '33.0,124.5,38.65,131.0';
const QUERY = '[out:json][timeout:180];(node["railway"~"^(station|halt)$"]["name"](' + BBOX + ');way["railway"~"^(station|halt)$"]["name"](' + BBOX + '););out center tags;';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function fetchOverpass() {
    for (let round = 0; round < 3; round++) {
        for (const url of MIRRORS) {
            try {
                const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'lottodraw.kr station list (one-off build)' }, body: 'data=' + encodeURIComponent(QUERY), signal: AbortSignal.timeout(200000) });
                if (r.ok) return await r.json();
                console.log(url, r.status);
            } catch (e) { console.log(url, e.message); }
        }
        await new Promise(r => setTimeout(r, 20000));
    }
    throw new Error('Overpass 를 받지 못했습니다');
}
// 받아 둔 파일: Overpass JSON({ elements }) 또는 osmium export GeoJSON({ features }) — Geofabrik 남한 자료를 osmium 으로 거른 것
function fromGeojson(j) {
    const centre = g => {
        if (g.type === 'Point') return g.coordinates;
        const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.type === 'LineString' ? g.coordinates : null;
        if (!ring) return null;
        const n = ring.length;
        return [ring.reduce((a, p) => a + p[0], 0) / n, ring.reduce((a, p) => a + p[1], 0) / n];
    };
    return { elements: j.features.map(f => { const c = f.geometry && centre(f.geometry); return c ? { lon: c[0], lat: c[1], tags: f.properties || {} } : null; }).filter(Boolean) };
}
const file = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : null;
const raw = file ? (file.features ? fromGeojson(file) : file) : await fetchOverpass();

// 지역: 가장 가까운 읍·면·동
const P = JSON.parse(fs.readFileSync(new URL('../store-map-places.json', import.meta.url), 'utf8'));
const S = P.s.map(x => x[0]);
function regionOf(lng, lat) {
    let best = null, bd = Infinity;
    const k = Math.cos(lat * Math.PI / 180);
    for (const d of P.d) { const dx = (d[2] - lng) * k, dy = d[3] - lat, v = dx * dx + dy * dy; if (v < bd) { bd = v; best = d; } }
    if (Math.sqrt(bd) * 111 > 12) return null;   // 가장 가까운 읍·면·동이 12km 넘게 멀면 남한 밖(북한 · 일본)
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
const rows = out.sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(o => { const rg = regionOf(o.lng, o.lat); return rg ? [o.name, r5(o.lng), r5(o.lat), o.kind].concat(rg, o.en || '') : null; }).filter(Boolean);
const res = {
    note: '판매점 지도의 역(tools/make-stations.mjs). s: [이름("역" 뗌), 경도, 위도, 0 도시철도 · 1 철도, 시·도, 시, 구, 영어 이름]',
    src: 'Station names and positions © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0, https://www.openstreetmap.org/copyright). This file is a derived database under ODbL.',
    s: rows,
};
fs.writeFileSync(new URL('../store-map-stations.json', import.meta.url), JSON.stringify(res) + '\n');
console.log(`역 ${rows.length}곳(도시철도 ${rows.filter(r => r[3] === 0).length} · 철도 ${rows.filter(r => r[3] === 1).length}), 원자료 점 ${pts.length}`);
