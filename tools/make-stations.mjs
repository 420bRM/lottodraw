#!/usr/bin/env node
// 판매점 지도의 역(2026-11-10 사장님 — "역 이름 검색도, 지도에 역 표시도" · "지하철은 노선마다 고유 색이 있다") 목록을 만든다 → store-map-stations.json
//
// 원자료: OpenStreetMap(© OpenStreetMap 기여자, ODbL 1.0) — 한국 안의 철도역 · 도시철도역(railway=station|halt)과 노선(route=subway|light_rail|monorail|train 관계).
// 이 파일(store-map-stations.json)은 OSM 에서 뽑은 자료라 ODbL 1.0 을 따른다(출처 표시는 지도 "시도별 · 안내" 칸).
// 역마다 이름("역"은 뗌) · 위치 · 종류(0 도시철도 · 1 철도 · 2 둘 다) · 지역(가장 가까운 읍·면·동의 시·도 · 시 · 구 — store-map-places.json) · 영어 이름 · 괄호 속 이름("김천(구미)"의 구미) · 지나는 전철 노선.
// 같은 이름이 500m 안에 여럿이면(노선마다 따로 찍힌 점) 하나로 합친다. 관광 열차 · 레일바이크 · 차량기지 · 승강장(케이블카 · 모노레일)은 뺀다.
// 노선 이름 · 색은 아래 LINES(각 운영사 노선도 색)로 정하고, 표에 없는 노선은 OSM 의 colour 를 쓴다. 역이 생기거나 바뀌었을 때만 다시 돌린다(매주 X):
//   node tools/make-stations.mjs                          (Overpass API 에서 받는다 — 이 저장소의 GitHub 워크플로에서 돌렸다)
//   node tools/make-stations.mjs --save DIR               (받은 원자료를 DIR/stations.json · routes.json · tracks.json 으로도 남긴다)
//   node tools/make-stations.mjs stations.json routes.json tracks.json (받아 둔 원자료로)
import fs from 'fs';

// 남한을 덮는 네모(북한 · 일본 쪽은 아래에서 가장 가까운 읍·면·동이 멀면 뺀다) — 나라 전체 area 질의는 서버가 자주 504 를 냈다
const BBOX = '33.0,124.5,38.65,131.0';
const Q_STATIONS = '[out:json][timeout:180];(node["railway"~"^(station|halt)$"]["name"](' + BBOX + ');way["railway"~"^(station|halt)$"]["name"](' + BBOX + '););out center tags;';
// 노선: 관계(멤버 목록)와 그 멤버 점(정차 위치 · 승강장 · 역)
const Q_ROUTES = '[out:json][timeout:300];rel["type"="route"]["route"~"^(subway|light_rail|monorail|train|tram)$"](' + BBOX + ')->.r;.r out body;node(r.r);out body;';
// 선로 모양: 전철 노선(지하철 · 경전철 · 모노레일, 그리고 색이 있거나 전철 노선망인 기차 노선)의 선로(way) — 노선 색 선을 그린다
const Q_TRACKS = '[out:json][timeout:300];(rel["type"="route"]["route"~"^(subway|light_rail|monorail|tram)$"](' + BBOX + ');rel["type"="route"]["route"="train"]["colour"](' + BBOX + ');rel["type"="route"]["route"="train"]["network"~"전철|광역"](' + BBOX + '););way(r)["railway"];out geom qt;';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function fetchOverpass(query) {
    for (let round = 0; round < 3; round++) {
        for (const url of MIRRORS) {
            try {
                const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'lottodraw.kr station list (one-off build)' }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(320000) });
                if (r.ok) return await r.json();
                console.log(url, r.status);
            } catch (e) { console.log(url, e.message); }
        }
        await new Promise(r => setTimeout(r, 20000));
    }
    throw new Error('Overpass 를 받지 못했습니다');
}
// 노선 원자료는 필요한 것만 남긴다(관계: 태그 · 점 멤버, 점: 위치 · 이름) — 선로(way) 멤버가 수만 개라 그대로 두면 너무 크다
function trimRoutes(j) {
    const rels = [], nodes = {};
    for (const e of j.elements || []) {
        if (e.type === 'relation') rels.push({ id: e.id, tags: e.tags || {}, m: (e.members || []).filter(m => m.type === 'node').map(m => [m.ref, m.role || '']), w: (e.members || []).filter(m => m.type === 'way' && !/platform/.test(m.role || '')).map(m => m.ref) });
        else if (e.type === 'node') nodes[e.id] = [e.lat, e.lon, (e.tags && (e.tags['name:ko'] || e.tags.name)) || ''];
    }
    return { rels, nodes };
}
// 선로: 길 번호 → [[경도, 위도] …](소수 5자리)
function trimTracks(j) {
    const ways = {};
    for (const e of j.elements || []) if (e.type === 'way' && e.geometry) ways[e.id] = e.geometry.map(g => [Math.round(g.lon * 1e5) / 1e5, Math.round(g.lat * 1e5) / 1e5]);
    return ways;
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
const args = process.argv.slice(2), saveAt = args.indexOf('--save'), saveDir = saveAt >= 0 ? args.splice(saveAt, 2)[1] : null;
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
let raw, routes, tracks;
if (args[0]) {
    const f = readJson(args[0]);
    raw = f.features ? fromGeojson(f) : f;
    routes = args[1] ? readJson(args[1]) : { rels: [], nodes: {} };
    if (routes.elements) routes = trimRoutes(routes);
    tracks = args[2] ? readJson(args[2]) : {};
    if (tracks.elements) tracks = trimTracks(tracks);
} else {
    raw = await fetchOverpass(Q_STATIONS);
    try { routes = trimRoutes(await fetchOverpass(Q_ROUTES)); } catch (e) { console.log('노선은 받지 못했습니다 — 색 없이', e.message); routes = { rels: [], nodes: {} }; }
    try { tracks = trimTracks(await fetchOverpass(Q_TRACKS)); } catch (e) { console.log('선로는 받지 못했습니다 — 선 없이', e.message); tracks = {}; }
}
if (saveDir) {
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(saveDir + '/stations.json', JSON.stringify(raw));
    fs.writeFileSync(saveDir + '/routes.json', JSON.stringify(routes));
    fs.writeFileSync(saveDir + '/tracks.json', JSON.stringify(tracks));
}

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
const base = n => String(n || '').replace(/역$/, '').replace(/\s*\(.*?\)\s*/g, '').replace(/역$/, '').trim();
const paren = n => { const x = ((String(n || '').match(/\(([^)]+)\)/) || [])[1] || '').replace(/역$/, '').trim(); return /[가-힣]/.test(x) && !/(선|line)$/i.test(x) ? x : ''; };   // "김천(구미)역" → 구미, "총신대입구(이수)역" → 이수
const baseEn = n => String(n || '').replace(/\s*\(.*?\)\s*/g, '').replace(/\s+(Station|Stn\.?)$/i, '').trim();
const pts = [];
for (const e of raw.elements || []) {
    const t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lng == null) continue;
    if (/^(disused|abandoned|construction|proposed)/.test(t.railway || '') || t['disused:railway'] || t.disused === 'yes') continue;
    if (t.usage === 'tourism' || t['railway:preserved'] === 'yes' || t.tourism) continue;   // 관광 열차(바다열차 · 스카이캡슐 …)
    const full = t['name:ko'] || t.name, name = base(full);
    if (!name || !/[가-힣]/.test(name) || /(승강장|기지|신호장|조차장|종점|레일바이크|케이블카)$/.test(name)) continue;
    // 도시철도: 지하철 · 경전철 · 모노레일, 또는 수도권 전철처럼 전철 노선망. 철도: 기차(train) — 서울역 · 수원역처럼 둘 다인 곳은 2
    const metro = /^(subway|light_rail|monorail)$/.test(t.station || '') || t.subway === 'yes' || t.light_rail === 'yes' || t.monorail === 'yes' || /전철|지하철|도시철도|경전철|metro|subway/i.test(t.network || '');
    const rail = t.station === 'train' || t.train === 'yes' || !metro;
    pts.push({ name, alt: paren(full), en: baseEn(t['name:en']), lat, lng, m: metro, r: rail });
}
// 같은 이름 500m 안 → 하나로
const km = (a, b) => Math.hypot((a.lng - b.lng) * 88.2, (a.lat - b.lat) * 111);
const out = [];
for (const p of pts) {
    const m = out.find(o => o.name === p.name && km(o, p) < 0.5);
    if (m) { m.n++; m.lat += (p.lat - m.lat) / m.n; m.lng += (p.lng - m.lng) / m.n; m.m = m.m || p.m; m.r = m.r || p.r; if (!m.en && p.en) m.en = p.en; if (!m.alt && p.alt) m.alt = p.alt; }
    else out.push(Object.assign({ n: 1 }, p));
}
const r5 = v => Math.round(v * 1e5) / 1e5;

// ───── 전철 노선(2026-11-10 사장님 — "지하철은 노선마다 고유 색" · "노선마다 역끼리 선으로") ─────
// [이름, 영어, 색(각 운영사 노선도의 노선 색), 역 표시에 쓰는 짧은 이름, 영어 짧은 이름, OSM 노선 관계 맞추기(network · ref · name)]
// 표에 없는 노선(관광 열차 · 공항 셔틀 · 운행 중단 · 공사 중 · KTX 같은 간선 열차)은 넣지 않는다
const cap = t => /수도권 전철/.test(t.network || '');
const net = (re, ref) => t => re.test(t.network || '') && t.ref === ref;
const LINES = [
    ['1호선', 'Line 1', '#0052A4', '1', '1', t => cap(t) && t.ref === '1'],
    ['2호선', 'Line 2', '#00A84D', '2', '2', t => cap(t) && t.ref === '2'],
    ['3호선', 'Line 3', '#EF7C1C', '3', '3', t => cap(t) && t.ref === '3'],
    ['4호선', 'Line 4', '#00A5DE', '4', '4', t => cap(t) && t.ref === '4'],
    ['5호선', 'Line 5', '#996CAC', '5', '5', t => cap(t) && t.ref === '5'],
    ['6호선', 'Line 6', '#CD7C2F', '6', '6', t => cap(t) && t.ref === '6'],
    ['7호선', 'Line 7', '#747F00', '7', '7', t => cap(t) && t.ref === '7'],
    ['8호선', 'Line 8', '#E6186C', '8', '8', t => cap(t) && t.ref === '8'],
    ['9호선', 'Line 9', '#BDB092', '9', '9', t => cap(t) && t.ref === '9'],
    ['수인분당선', 'Suin-Bundang', '#F5A200', '수인분당', 'Suin', t => t.ref === '수인·분당'],
    ['신분당선', 'Shinbundang', '#D4003B', '신분당', 'Shinbundang', t => t.ref === '신분당'],
    ['경의중앙선', 'Gyeongui-Jungang', '#77C4A3', '경의중앙', 'Gyeongui', t => t.ref === '경의·중앙'],
    ['경춘선', 'Gyeongchun', '#0C8E72', '경춘', 'Gyeongchun', t => cap(t) && t.ref === '경춘'],
    ['공항철도', 'AREX', '#0090D2', '공항', 'AREX', t => t.ref === '공항철도' || t.ref === 'AREX'],
    ['경강선', 'Gyeonggang', '#003DA5', '경강', 'Gyeonggang', t => cap(t) && t.ref === '경강'],
    ['서해선', 'Seohae', '#8FC31F', '서해', 'Seohae', t => (cap(t) && t.ref === '서해') || /^서해선/.test(t.name || '')],
    ['GTX-A', 'GTX-A', '#9A6292', 'GTX-A', 'GTX-A', t => t.ref === 'GTX-A'],
    ['인천 1호선', 'Incheon Line 1', '#7CA8D5', '인천1', 'I1', t => t.ref === '인천1'],
    ['인천 2호선', 'Incheon Line 2', '#ED8B00', '인천2', 'I2', t => t.ref === 'I2'],
    ['에버라인', 'Everline', '#509F22', '에버라인', 'Ever', t => t.ref === '용인' || /^용인 ?경전철/.test(t.name || '')],
    ['의정부경전철', 'U Line', '#FDA600', '의정부', 'U', t => t.ref === 'U' || /^의정부 ?경전철/.test(t.name || '')],
    ['우이신설선', 'Ui LRT', '#B0CE18', '우이신설', 'Ui', t => /^우이신설/.test(t.name || '')],
    ['신림선', 'Sillim', '#6789CA', '신림', 'Sillim', t => t.ref === 'Silim' || /신림선/.test(t.name || '')],
    ['김포골드라인', 'Gimpo Goldline', '#AD8605', '김포골드', 'Gimpo', t => /김포 ?골드라인/.test((t.ref || '') + (t.name || ''))],
    ['부산 1호선', 'Busan Line 1', '#F06A00', '1', '1', net(/부산 도시철도/, '1')],
    ['부산 2호선', 'Busan Line 2', '#81BF48', '2', '2', net(/부산 도시철도/, '2')],
    ['부산 3호선', 'Busan Line 3', '#BB8C00', '3', '3', net(/부산 도시철도/, '3')],
    ['부산 4호선', 'Busan Line 4', '#217DCB', '4', '4', net(/부산 도시철도/, '4')],
    ['부산김해경전철', 'Busan-Gimhae LRT', '#8652A1', '부산김해', 'BGL', t => t.ref === 'BGL'],
    ['동해선', 'Donghae', '#0054A6', '동해', 'Donghae', t => t.ref === '동해'],
    ['대구 1호선', 'Daegu Line 1', '#D93F5C', '1', '1', net(/대구 ?도시철도/, '1')],
    ['대구 2호선', 'Daegu Line 2', '#00AA80', '2', '2', net(/대구 ?도시철도/, '2')],
    ['대구 3호선', 'Daegu Line 3', '#FFB100', '3', '3', net(/대구 ?도시철도/, '3')],
    ['대경선', 'Daegyeong', '#0054A6', '대경', 'Daegyeong', t => t.ref === '대경'],
    ['대전 1호선', 'Daejeon Line 1', '#007448', '1', '1', t => net(/대전 도시철도/, '1')(t) && t.route === 'subway'],
    ['광주 1호선', 'Gwangju Line 1', '#009088', '1', '1', net(/광주 도시철도/, '1')],
];
const lineOf = t => LINES.findIndex(L => L[5](t));
const lineRels = LINES.map(() => []);
const skipped = new Map();
for (const r of routes.rels) {
    const li = lineOf(r.tags);
    if (li >= 0) lineRels[li].push(r);
    else if (/[가-힣]/.test(r.tags.name || '') && !/^(train)$/.test(r.tags.route)) skipped.set(r.tags.name, (skipped.get(r.tags.name) || 0) + 1);
}
if (skipped.size) console.log('노선 표에 없어 뺀 것:', [...skipped.keys()].join(', '));
// 역마다 지나는 노선: 노선 관계의 정차 점(정차 위치 · 승강장 · 역)이 같은 이름으로 450m 안에 있으면(이름 없는 점은 150m 안 가장 가까운 역)
const stLines = out.map(() => new Set());
const stStops = out.map(() => new Map());   // 역 → 노선 → { 정차 위치(stop) 점들, 그 밖의 점들 } — 노선마다 실제 타는 곳에 표시를 두려고
LINES.forEach((L, li) => {
    const seen = new Set();
    for (const r of lineRels[li]) for (const [ref, role] of r.m) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        const nd = routes.nodes[ref];
        if (!nd) continue;
        const p = { lat: nd[0], lng: nd[1] }, nb = base(nd[2]);
        let bi = -1, bd = Infinity;
        out.forEach((o, i) => { const d = km(o, p); if (d < bd && (nb ? o.name === nb && d < 0.45 : d < 0.15)) { bd = d; bi = i; } });
        if (bi < 0) continue;
        stLines[bi].add(li);
        if (!stStops[bi].has(li)) stStops[bi].set(li, { stop: [], other: [] });
        stStops[bi].get(li)[/^stop/.test(role) ? 'stop' : 'other'].push(p);
    }
});
// 역마다 노선별 표시 자리(2026-11-10 사장님 — "홍대입구역은 3개 노선이니 네이버 지도처럼 노선마다 나눠서"): 그 노선의 정차 위치(없으면 승강장 · 역 점) 가운데.
// 60m 안에 붙은 노선끼리는 한 표시로 묶는다(같은 승강장을 쓰는 노선 — 상봉 경의중앙 · 경춘 등) → [[경도, 위도, [노선 …]], …]
function stopGroups(i) {
    const pts = [...stStops[i].entries()].sort((a, b) => a[0] - b[0]).map(([li, g]) => {
        const use = g.stop.length ? g.stop : g.other;
        return { li: [li], lat: use.reduce((a, q) => a + q.lat, 0) / use.length, lng: use.reduce((a, q) => a + q.lng, 0) / use.length };
    });
    const groups = [];
    for (const p of pts) {
        const g = groups.find(q => km(q, p) < 0.06);
        if (g) { const n = g.li.length; g.lat = (g.lat * n + p.lat) / (n + 1); g.lng = (g.lng * n + p.lng) / (n + 1); g.li.push(p.li[0]); }
        else groups.push({ li: p.li.slice(), lat: p.lat, lng: p.lng });
    }
    return groups.map(g => [r5(g.lng), r5(g.lat), g.li]);
}
// 선로: 노선마다 선로(way)를 모아 잇고(끝점이 같으면 한 줄로) 줄인다(더글라스-포커 6m) → store-map-lines.json
function simplify(pts, tolM) {
    if (pts.length < 3) return pts;
    const k = Math.cos(pts[0][1] * Math.PI / 180) * 111320, ky = 110540;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
        const [a, b] = st.pop();
        const ax = pts[a][0] * k, ay = pts[a][1] * ky, bx = pts[b][0] * k, by = pts[b][1] * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        let mi = -1, md = tolM;
        for (let i = a + 1; i < b; i++) {
            const px = pts[i][0] * k, py = pts[i][1] * ky;
            let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
            if (d > md) { md = d; mi = i; }
        }
        if (mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
}
function chain(ways) {
    const key = p => p[0] + ',' + p[1];
    const lines = ways.map(w => w.slice());
    const ends = new Map();
    const add = (i) => { for (const e of [key(lines[i][0]), key(lines[i][lines[i].length - 1])]) { if (!ends.has(e)) ends.set(e, new Set()); ends.get(e).add(i); } };
    const del = (i) => { for (const e of [key(lines[i][0]), key(lines[i][lines[i].length - 1])]) { const s = ends.get(e); if (s) { s.delete(i); if (!s.size) ends.delete(e); } } };
    lines.forEach((_, i) => add(i));
    const alive = new Set(lines.map((_, i) => i));
    for (const i of [...alive]) {
        if (!alive.has(i)) continue;
        for (let grow = true; grow;) {
            grow = false;
            for (const atEnd of [true, false]) {
                const e = key(atEnd ? lines[i][lines[i].length - 1] : lines[i][0]);
                const s = ends.get(e);
                if (!s || s.size !== 2) continue;   // 갈림길(3갈래 이상) · 끝은 잇지 않는다
                const j = [...s].find(x => x !== i);
                if (j == null || !alive.has(j)) continue;
                del(i); del(j);
                let w = lines[j];
                if (atEnd) { if (key(w[0]) !== e) w = w.slice().reverse(); lines[i] = lines[i].concat(w.slice(1)); }
                else { if (key(w[w.length - 1]) !== e) w = w.slice().reverse(); lines[i] = w.concat(lines[i].slice(1)); }
                alive.delete(j); add(i); grow = true;
            }
        }
    }
    return [...alive].map(i => lines[i]);
}
const geo = [];
let nPts = 0;
LINES.forEach((L, li) => {
    const ids = new Set();
    for (const r of lineRels[li]) for (const w of r.w || []) ids.add(w);
    const ways = [...ids].map(id => tracks[id]).filter(w => w && w.length > 1);
    for (const pl of chain(ways)) {
        const sp = simplify(pl, 6);
        if (sp.length < 2) continue;
        // 정수(1e-5도) · 앞 점과의 차로 적는다: [노선, x0, y0, dx1, dy1, …]
        const row = [li];
        let px = 0, py = 0;
        for (const [x, y] of sp) { const ix = Math.round(x * 1e5), iy = Math.round(y * 1e5); row.push(ix - px, iy - py); px = ix; py = iy; }
        geo.push(row); nPts += sp.length;
    }
});
const LT = LINES.map(([ko, en, c, sko, sen]) => [ko, en, c, sko, sen]);
const SRC = 'Station names, positions and railway lines © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0, https://www.openstreetmap.org/copyright). This file is a derived database under ODbL.';
if (geo.length) {
    fs.writeFileSync(new URL('../store-map-lines.json', import.meta.url), JSON.stringify({
        note: '판매점 지도의 전철 노선 선(tools/make-stations.mjs). l: 노선 [이름, 영어, 색, 짧은 이름, 영어 짧은 이름], g: [노선, x0, y0, dx1, dy1, …] — 경도 · 위도 × 100000, 둘째 점부터는 앞 점과의 차',
        src: SRC, l: LT, g: geo }) + '\n');
    console.log(`노선 선: ${geo.length}줄 · ${nPts}점`);
}

const kindOf = (o, ls) => (ls.size ? (o.r ? 2 : 0) : o.m && o.r ? 2 : o.m ? 0 : 1);   // 전철 노선이 지나면 도시철도(기차도 서면 둘 다)
const order = out.map((o, i) => i).sort((a, b) => out[a].name.localeCompare(out[b].name, 'ko'));
const rows = order.map(i => {
    const o = out[i], ls = stLines[i], rg = regionOf(o.lng, o.lat);
    if (!rg) return null;
    const row = [o.name, r5(o.lng), r5(o.lat), kindOf(o, ls)].concat(rg, o.en || '');
    if (o.alt || ls.size) row.push(o.alt || '');
    if (ls.size) row.push(stopGroups(i));
    return row;
}).filter(Boolean);
const res = {
    note: '판매점 지도의 역(tools/make-stations.mjs). l: 전철 노선 [이름, 영어, 색, 짧은 이름, 영어 짧은 이름], s: [이름("역" 뗌), 경도, 위도, 0 도시철도 · 1 철도 · 2 둘 다, 시·도, 시, 구, 영어 이름, 괄호 속 이름(있을 때만, 노선이 있으면 빈 칸이라도), 노선별 표시 자리(있을 때만) [[경도, 위도, [l 의 번호 …]], …] — 같은 승강장을 쓰는 노선은 한 자리]',
    src: SRC,
    l: LT,
    s: rows,
};
fs.writeFileSync(new URL('../store-map-stations.json', import.meta.url), JSON.stringify(res) + '\n');
console.log(`역 ${rows.length}곳(도시철도 ${rows.filter(r => r[3] === 0).length} · 철도 ${rows.filter(r => r[3] === 1).length} · 둘 다 ${rows.filter(r => r[3] === 2).length}, 노선 있는 역 ${rows.filter(r => r[9]).length}), 원자료 점 ${pts.length}`);
LINES.forEach((L, li) => { const n = rows.filter(r => r[9] && r[9].some(g => g[2].includes(li))).length; if (!n) console.log('역이 없는 노선:', L[0]); });
