/* 판매점 지도 (store-map.html, 2026-10-26).
 *
 * 자료: store-map-data.json (tools/build-static-stats.js 가 stores-data.json 으로 매주 만든다)
 *   rows: [위도, 경도, 1등, 2등, 상호, 시도 번호, 시군구, 폐점, 자동, 수동, 반자동]
 * 화면 전체가 지도다(머리글 · 메뉴 없음, 왼쪽 위 "생성기로" 단추 하나). 지도: MapLibre(js/vendor/) + OpenFreeMap "positron" 바탕(키 없음, © OpenStreetMap).
 * 모양(2026-10-26 사장님 결정 — 제안 ② "화이트 모형"): 하얀 땅에 반투명 흰 건물, 색은 판매점 점에만. 줌 15쯤부터 건물이 솟아오르고(높이를 줌에 따라 0 → 실제 높이)
 * 지도도 저절로 기울어진다(13 아래로 나가면 다시 평평하게). 3D 단추는 손으로 기울이기/펴기.
 * 막대 지도(제안 ④): 1등 · 2등 판매점을 막대로 세운다(1등 많을수록 높게) — 로그인 회원 기능(서버에 로그인이 꺼져 있으면 누구나).
 *   줌하는 동안은 실제 물체처럼 그대로 커지고 작아지며(모양을 다시 만들지 않아 끊김 · 렉이 없다), 멈추면 그 줌에 맞는 크기 모양으로 0.3초 동안 서서히 바꾼다(settleBars).
 * 점 크기 = 2등 + 1등 × 6 (1등은 2등보다 6배 드물다 — 팔린 양을 짐작하는 값). 1등이 나온 곳은 주황, 2등만 나온 곳은 파랑. 1등 많은 50곳은 점 안에 1등 횟수.
 * 1등 방식(자동 · 수동 · 반자동) 체크 — 로그인 회원 기능. 끈 방식의 1등은 세지 않는다(점 크기 · 막대 · 숫자 · 상위 50).
 * 카드: 1등 · 2등이 나온 회차 · 날짜 · 당첨번호, 5개씩 쪽 넘김(store-map-rounds.json — 카드를 처음 열 때 받는다).
 * 왼쪽 아래 끌기 막대: 오른쪽으로 끌수록 1등 횟수가 적은 곳부터 서서히 흐려져 많이 나온 곳만 남는다(2등만 나온 곳이 먼저).
 * PC(폭 900px 이상): 오른쪽 위에 1등 많은 50곳 목록(휠로 넘김), 판매점 카드는 그 아래. 휴대폰은 위쪽에 작은 안내 한 줄.
 * 첫 화면은 서울(2026-10-26 사장님).
 * 다녀온 곳(로그인 회원): 카드에서 "다녀왔어요"를 누르고 색을 고르면 그 판매점 점을 그 색으로 칠한다(가장자리는 1등 주황 · 2등 파랑 그대로).
 *   서버에는 판매점 번호와 색만(/api/me/visits). 기기 위치는 쓰지 않는다. 판매점 번호는 store-map-ids.json(로그인했을 때만 받는다).
 * 문구 규칙: "명당"으로 읽히지 않게, 카드마다 "어디서 사든 확률은 같다"를 붙인다.
 * 일반 판매점(2단계): store-map-all.json — 1등 · 2등 기록이 없는 전국 판매점 rows: [위도, 경도, 상호, 시도 번호, 시군구].
 *   칩을 처음 켤 때 받는다(첫 화면을 가볍게). 회색 작은 점으로 1등 · 2등 점 아래에 깔린다.
 */
(function () {
    'use strict';

    const root = document.getElementById('sm');
    if (!root) return;
    const mapBox = document.getElementById('sm-map');
    const card = document.getElementById('sm-card');
    const STYLE = 'https://tiles.openfreemap.org/styles/positron';

    const en = () => !!(window.I18N && window.I18N.lang === 'en');
    const T = (ko, eng) => (en() ? eng : ko);
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => Number(n).toLocaleString(en() ? 'en-US' : 'ko-KR');
    const fail = msg => { mapBox.innerHTML = '<p class="sm-loading">' + esc(msg) + '</p>'; };

    if (!window.maplibregl) { fail(T('지도 스크립트를 불러오지 못했습니다. 아래 시도별 표를 봐 주세요.', 'Could not load the map. See the table below.')); return; }
    if (maplibregl.supported && !maplibregl.supported()) { fail(T('이 브라우저에서는 지도를 그릴 수 없습니다(WebGL). 아래 시도별 표를 봐 주세요.', 'This browser cannot draw the map (WebGL). See the table below.')); return; }

    let data = null;      // { sido, rows }
    let all = null;       // 일반 판매점 { sido, rows } — 칩을 켤 때 받는다
    let map = null;
    const shown = { w1: true, w2: true, closed: false, all: false };
    const modes = { A: true, M: true, S: true };   // 1등 방식 체크(로그인 회원)
    let bars = false;
    const bands = new Set();                       // 만들어 둔 막대 크기 단계(줌 × 2)
    let curBand = null, oldBand = null;            // 지금 보이는 단계 · 서서히 사라지는 단계
    let fadeT = 0;                                 // 끌기 막대: 1등 횟수 + 1 이 이 값보다 작으면 흐려진다(0 = 다 보임)
    const isWide = () => window.innerWidth >= 900;
    let visits = {};                               // 다녀온 곳 { 판매점 번호: 색 } — 로그인 회원
    let ids = null;                                // { w: [...], a: [...] } 판매점 번호
    const vis = ['to-boolean', ['feature-state', 'visit']];

    // w1 = 고른 방식의 1등 횟수, o1 = 원래 1등 횟수(2등만 나온 곳을 가르는 값)
    const fadeF = () => ['max', 0, ['min', 1, ['-', ['+', ['get', 'w1'], 1], fadeT]]];   // 1 = 그대로, 0 = 사라짐
    function filterFor(kind) {
        const f = [kind === 'w1' ? ['>', ['get', 'w1'], 0] : ['==', ['get', 'o1'], 0]];
        if (!shown.closed) f.push(['==', ['get', 'closed'], 0]);
        if (fadeT > 0) f.push(['>', ['-', ['+', ['get', 'w1'], 1], fadeT], 0]);   // 다 흐려진 곳은 누를 수도 없게
        return ['all'].concat(f);
    }
    function applyLayers() {
        if (!map || !map.getLayer('st-w1')) return;
        const vis = on => (on ? 'visible' : 'none');
        ['w1', 'w2'].forEach(k => {
            map.setLayoutProperty('st-' + k, 'visibility', vis(shown[k] && !bars));
            map.setFilter('st-' + k, filterFor(k));
            bands.forEach(b => {
                map.setLayoutProperty('bar-' + k + '-' + b, 'visibility', vis(shown[k] && bars && (b === curBand || b === oldBand)));
                map.setFilter('bar-' + k + '-' + b, filterFor(k));
            });
        });
        map.setLayoutProperty('st-num', 'visibility', vis(shown.w1 && !bars));
        map.setFilter('st-num', ['all', ['>', ['get', 'top'], 0], filterFor('w1')]);
        if (map.getLayer('st-all')) map.setLayoutProperty('st-all', 'visibility', shown.all ? 'visible' : 'none');
        else if (shown.all) loadAll();
    }

    // 일반 판매점 층: 처음 켤 때 한 번 받아 1등 · 2등 점 아래에 깐다
    let loadingAll = false;
    async function loadAll() {
        if (loadingAll || !root.dataset.all) return;
        loadingAll = true;
        try { all = await (await fetch(root.dataset.all)).json(); } catch (e) { loadingAll = false; return; }
        map.addSource('all', { type: 'geojson', data: { type: 'FeatureCollection', features: all.rows.map((r, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [r[1], r[0]] }, properties: { i } })) } });
        map.addLayer({
            id: 'st-all', type: 'circle', source: 'all',
            layout: { visibility: shown.all ? 'visible' : 'none' },
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['case', vis, 3, 1.2], 10, ['case', vis, 5, 2.6], 15, ['case', vis, 8, 6]],
                'circle-color': ['coalesce', ['feature-state', 'visit'], '#7d8799'], 'circle-opacity': 0.7 * Math.max(0, 1 - fadeT),
                'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', vis, 1, 0], 13, ['case', vis, 2, 1]],
            },
        }, 'st-w2');
        paintVisits();
        map.on('click', 'st-all', e => {
            // 1등 · 2등 점과 겹치면 그쪽 카드를 연다
            if (map.queryRenderedFeatures(e.point, { layers: ['st-w1', 'st-w2'] }).length) return;
            if (e.features && e.features[0]) openAll(e.features[0].properties.i, false);
        });
        map.on('mouseenter', 'st-all', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'st-all', () => { map.getCanvas().style.cursor = ''; });
    }

    // 바탕 지도의 글자를 한글 이름으로(없으면 원래 이름)
    function koreanLabels() {
        for (const l of map.getStyle().layers) {
            if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
            try { map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', en() ? 'name:en' : 'name:ko'], ['get', 'name']]); } catch (e) { /* 이름이 아닌 글자 */ }
        }
    }
    // 화이트 모형: 바탕색을 고르고, 건물을 반투명 흰 덩어리 + 가는 윤곽선으로 세운다(OpenMapTiles 의 building)
    const RISE = [14.6, 16];   // 이 줌 사이에서 건물이 0 → 실제 높이로 솟는다
    function whiteModel() {
        const st = map.getStyle();
        const src = Object.keys(st.sources).find(k => st.sources[k].type === 'vector');
        if (!src) return;
        const paint = (id, k, v) => { try { map.setPaintProperty(id, k, v); } catch (e) { /* 없는 속성 */ } };
        for (const l of st.layers) {
            const sl = l['source-layer'];
            if (l.type === 'background') paint(l.id, 'background-color', '#f6f6f3');
            else if (l.type === 'symbol' && /country|continent/.test(l.id)) map.setLayoutProperty(l.id, 'visibility', 'none');   // 큰 나라 이름은 위쪽 도구와 겹친다
            else if (l.type === 'fill-extrusion') map.removeLayer(l.id);
            else if (l.type === 'fill' && sl === 'water') paint(l.id, 'fill-color', '#dce3e9');
            else if (l.type === 'fill' && (sl === 'park' || sl === 'landcover')) paint(l.id, 'fill-color', '#edf0ea');
            else if (l.type === 'fill' && sl === 'building') { paint(l.id, 'fill-color', '#ecebe7'); paint(l.id, 'fill-opacity', ['interpolate', ['linear'], ['zoom'], RISE[0], 1, RISE[1], 0.3]); }
        }
        const firstLabel = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
        const h = k => ['interpolate', ['linear'], ['zoom'], RISE[0], 0, RISE[1], ['coalesce', ['get', k], k === 'render_height' ? 8 : 0]];
        map.addLayer({
            id: 'sm-bld-line', type: 'line', source: src, 'source-layer': 'building', minzoom: 14,
            paint: { 'line-color': '#c2c7cf', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.3, 17, 0.9], 'line-opacity': 0.9 },
        }, firstLabel);
        map.addLayer({
            id: 'sm-bld', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: RISE[0],
            paint: { 'fill-extrusion-color': '#f7f9fc', 'fill-extrusion-height': h('render_height'), 'fill-extrusion-base': h('render_min_height'),
                'fill-extrusion-opacity': 0.4, 'fill-extrusion-vertical-gradient': true },
        }, firstLabel);
        map.setLight({ anchor: 'map', color: '#ffffff', intensity: 0.25, position: [1.3, 210, 35] });   // 옆면이 너무 어두우면 회색 덩어리로 보인다
    }

    // ───── 랜드마크 모형(2026-10-26 사장님 — 레퍼런스 앱처럼 랜드마크만 정성 들여) ─────
    // store-map-landmarks.json(tools/build-landmarks.js — OpenStreetMap 의 실제 외곽선 · 높이)으로
    // 반투명 유리 몸통 + 꼭짓점의 세로 기둥 + 일정 간격 층 띠(와이어프레임 느낌)를 세운다. 돔은 반구로, taper 는 위로 좁게 쌓는다.
    // 지도에는 지형(산 높이)이 없어 N서울타워도 평지에 선다. 줌 12.5 → 14 사이에서 솟아오른다.
    const LM_RISE = [12.5, 14];
    const LM_M = 111320;
    function landmarks() {
        if (!root.dataset.landmarks) return;
        fetch(root.dataset.landmarks).then(r => r.json()).then(buildLandmarks).catch(() => {});
    }
    function buildLandmarks(d) {
        const glass = [], solid = [];
        const poly = (rings, color, base, top, list) => list.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties: { color, base, top } });
        // 랜드마크 자리의 바탕 건물(OpenMapTiles)은 감춘다 — 모형과 겹쳐 그려지지 않게(랜드마크마다 외곽 네모 + 8m)
        const boxes = d.landmarks.map(lm => {
            const xs = lm.parts.flatMap(p => p.ring.map(q => q[0])), ys = lm.parts.flatMap(p => p.ring.map(q => q[1]));
            const dx = 8 / (LM_M * Math.cos(ys[0] * Math.PI / 180)), dy = 8 / LM_M;
            const [x0, x1, y0, y1] = [Math.min(...xs) - dx, Math.max(...xs) + dx, Math.min(...ys) - dy, Math.max(...ys) + dy];
            return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
        });
        const outside = ['!', ['within', { type: 'MultiPolygon', coordinates: boxes }]];
        ['sm-bld', 'sm-bld-line'].forEach(id => { if (map.getLayer(id)) try { map.setFilter(id, outside); } catch (e) { /* within 을 못 쓰는 브라우저 */ } });
        for (const lm of d.landmarks) for (const p of lm.parts) {
            let ring = p.ring.slice();
            if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
            const c0 = ring.reduce((a, q) => [a[0] + q[0] / ring.length, a[1] + q[1] / ring.length], [0, 0]);
            const cos = Math.cos(c0[1] * Math.PI / 180);
            let pts = ring.map(q => [(q[0] - c0[0]) * LM_M * cos, (q[1] - c0[1]) * LM_M]);   // 미터(동 · 북)
            if (p.scale) pts = pts.map(([x, y]) => [x * p.scale, y * p.scale]);
            const toLL = xy => [c0[0] + xy[0] / (LM_M * cos), c0[1] + xy[1] / LM_M];
            const close = a => { const r = a.map(toLL); r.push(r[0]); return r; };
            const scaled = k => pts.map(([x, y]) => [x * k, y * k]);
            const rMean = pts.reduce((s0, [x, y]) => s0 + Math.hypot(x, y), 0) / pts.length || 1;
            const color = p.color || (p.kind === 'glass' ? lm.glass : '#ffffff');
            const list = p.kind === 'glass' ? glass : solid;
            const h = p.top - p.base;
            if (p.dome) {   // 반구: 높이 u 에서 반지름 √(1-u²)
                const N = 9;
                for (let k = 0; k < N; k++) poly([close(scaled(Math.sqrt(1 - Math.pow((k + 0.5) / N, 2))))], color, p.base + h * k / N, p.base + h * (k + 1) / N + 0.2, list);
                continue;
            }
            if (p.taper) {   // 위로 갈수록 좁게(꼭대기 크기 = taper)
                const N = 10;
                for (let k = 0; k < N; k++) poly([close(scaled(1 - (1 - p.taper) * (k + 0.5) / N))], color, p.base + h * k / N, p.base + h * (k + 1) / N + 0.2, list);
                continue;
            }
            poly([close(pts)], color, p.base, p.top, list);
            if (p.kind !== 'glass') continue;
            // 세로 기둥: 꼭짓점(많으면 고르게 골라서) + 긴 벽은 ribEvery 미터마다
            const ribW = (lm.ribW || 0.9) / 2, nRib = p.ribs !== undefined ? p.ribs : lm.ribs;
            const at = [];
            if (nRib) { const step = Math.max(1, pts.length / nRib); for (let k = 0; k < pts.length - 0.01; k += step) at.push(pts[Math.floor(k)]); }
            if (lm.ribEvery) pts.forEach((a, k) => {
                const b = pts[(k + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(len / lm.ribEvery);
                for (let m = 0; m < n; m++) at.push([a[0] + (b[0] - a[0]) * m / n, a[1] + (b[1] - a[1]) * m / n]);
            });
            at.forEach(([x, y]) => poly([close([[x - ribW, y - ribW], [x + ribW, y - ribW], [x + ribW, y + ribW], [x - ribW, y + ribW]])], lm.frame, p.base, p.top, solid));
            // 층 띠(벽에서 바깥 · 안쪽으로 0.6m 씩 — 고리 모양, 1.4m 두께) + 꼭대기 테두리. 흰 바탕에서도 선이 또렷하게 굵고 진하게
            const fl = p.floor !== undefined ? p.floor : lm.floor;
            const band = z => poly([close(scaled((rMean + 0.6) / rMean)), close(scaled((rMean - 0.6) / rMean)).reverse()], lm.frame, z, z + 1.4, solid);
            if (fl) for (let z = p.base + fl; z < p.top - 3; z += fl) band(z);
            band(p.top - 1.4);
        }
        const fc = f => ({ type: 'FeatureCollection', features: f });
        map.addSource('lm-solid', { type: 'geojson', data: fc(solid) });
        map.addSource('lm-glass', { type: 'geojson', data: fc(glass) });
        const rise = k => ['interpolate', ['linear'], ['zoom'], LM_RISE[0], 0, LM_RISE[1], ['get', k]];
        const paint = op => ({ 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': rise('top'), 'fill-extrusion-base': rise('base'), 'fill-extrusion-opacity': op, 'fill-extrusion-vertical-gradient': false });
        // 판매점 점 · 막대보다 아래에 깐다(점을 가리지 않게)
        const before = map.getLayer('st-w2') ? 'st-w2' : undefined;
        map.addLayer({ id: 'sm-lm-solid', type: 'fill-extrusion', source: 'lm-solid', minzoom: LM_RISE[0], paint: paint(0.95) }, before);
        map.addLayer({ id: 'sm-lm-glass', type: 'fill-extrusion', source: 'lm-glass', minzoom: LM_RISE[0], paint: paint(0.58) }, before);
    }

    // 북쪽 보기 단추 — "내 위치" 단추 위, 같은 크기. 지도가 돌아간 만큼 바늘도 돈다
    class NorthControl {
        onAdd(m) {
            this.box = document.createElement('div');
            this.box.className = 'maplibregl-ctrl maplibregl-ctrl-group';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'sm-north';
            b.title = T('북쪽이 위로', 'Face north');
            b.setAttribute('aria-label', b.title);
            b.innerHTML = '<span class="sm-north-ico" aria-hidden="true"></span>';
            const ico = b.firstChild;
            b.addEventListener('click', () => m.easeTo({ bearing: 0, duration: 500 }));
            m.on('rotate', () => { ico.style.transform = 'rotate(' + (-m.getBearing()) + 'deg)'; });
            this.box.appendChild(b);
            return this.box;
        }
        onRemove() { this.box.remove(); }
    }

    // 고른 방식만 센 1등 횟수(방식을 모르는 1등은 늘 센다)
    const eff1 = r => r[2] - (modes.A ? 0 : r[8] || 0) - (modes.M ? 0 : r[9] || 0) - (modes.S ? 0 : r[10] || 0);
    const TOP = 50;
    let props = [];
    function computeProps() {
        const e = data.rows.map(eff1);
        const rank = new Map();
        data.rows.map((r, i) => i).filter(i => e[i] > 0 && !data.rows[i][7])
            .sort((a, b) => (e[b] - e[a]) || (data.rows[b][3] - data.rows[a][3])).slice(0, TOP).forEach((i, k) => rank.set(i, k + 1));
        props = data.rows.map((r, i) => ({ i, w1: e[i], o1: r[2], w2: r[3], closed: r[7] ? 1 : 0, wt: r[3] + e[i] * 6, top: rank.get(i) || 0 }));
    }
    function geojson() {
        return {
            type: 'FeatureCollection',
            features: data.rows.map((r, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [r[1], r[0]] }, properties: props[i] })),
        };
    }

    function addStores() {
        map.addSource('stores', { type: 'geojson', data: geojson() });
        const radius = ['interpolate', ['linear'], ['zoom'],
            5, ['+', 1.6, ['*', 0.45, ['sqrt', ['get', 'wt']]]],
            10, ['+', 3, ['*', 0.9, ['sqrt', ['get', 'wt']]]],
            15, ['+', 5, ['*', 1.0, ['sqrt', ['get', 'wt']]]]];   // 거리 수준에서 큰 점이 건물을 가리지 않게(가장 큰 곳 약 29px)
        const layer = (id, color, kind) => ({
            id, type: 'circle', source: 'stores', filter: filterFor(kind),
            layout: { 'circle-sort-key': ['get', 'wt'] },
            paint: {
                'circle-radius': radius,
                // 다녀온 곳은 고른 색으로 칠하고 가장자리를 1등 · 2등 색으로
                'circle-color': ['coalesce', ['feature-state', 'visit'], color],
                'circle-opacity': ['*', ['case', ['==', ['get', 'closed'], 1], 0.35, 0.85], fadeF()],
                'circle-stroke-opacity': fadeF(),
                'circle-stroke-color': ['case', vis, color, '#fff'],
                'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', vis, 2, 0.3], 12, ['case', vis, 3.5, 1.2]],
            },
        });
        map.addLayer(layer('st-w2', '#3b6fd8', 'w2'));
        map.addLayer(layer('st-w1', '#f07a1a', 'w1'));
        // 1등 많은 50곳: 점 안에 1등 횟수(겹치면 순위 높은 곳만)
        map.addLayer({
            id: 'st-num', type: 'symbol', source: 'stores', filter: ['all', ['>', ['get', 'top'], 0], filterFor('w1')],
            layout: { 'text-field': ['to-string', ['get', 'w1']], 'text-font': ['Noto Sans Bold'], 'symbol-sort-key': ['get', 'top'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 5, 8, 9, 11, 14, 13], 'text-padding': 0, 'text-allow-overlap': false },
            paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(150, 60, 0, .55)', 'text-halo-width': 0.7, 'text-opacity': fadeF() },
        });
        ['st-w1', 'st-w2'].forEach(id => {
            map.on('click', id, e => { if (e.features && e.features[0]) open(e.features[0].properties.i, false); });
            map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
        });
        applyLayers();
    }

    const links = (name, place, lat, lng) => '<p class="sm-links"><a href="https://map.kakao.com/link/map/' + encodeURIComponent(name) + ',' + lat + ',' + lng + '" target="_blank" rel="noopener">' + T('카카오맵', 'Kakao Map') + '</a>' +
        '<a href="https://map.naver.com/p/search/' + encodeURIComponent(name + ' ' + place) + '" target="_blank" rel="noopener">' + T('네이버 지도', 'Naver Map') + '</a></p>';
    function showCard(html, lat, lng, fly) {
        card.dataset.i = '';
        markTop(null);
        card.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' + html;
        card.hidden = false;
        card.querySelector('.sm-close').addEventListener('click', () => { card.hidden = true; });
        if (fly) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), padding: pad(), essential: true });
        card.scrollTop = 0;
    }
    // 일반 판매점 카드
    function openAll(i, fly) {
        const [lat, lng, name, si, gu] = all.rows[i];
        const place = [all.sido[si] || '', gu].filter(Boolean).join(' ');
        showCard('<h3>' + esc(name) + '</h3><p class="sm-place">' + esc(place) + '</p>' +
            '<p class="sm-why">' + T(data.first + '회부터 1등 · 2등 기록이 없는 판매점입니다. 어느 판매점에서 사든 1등 확률은 1/8,145,060으로 같습니다.',
                'No 1st or 2nd prize here since draw ' + data.first + '. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.') + '</p>' + links(name, place, lat, lng) +
            '<div class="sm-visit" id="sm-visit"></div>', lat, lng, fly);
        visitUi('a', i);
    }

    // ───── 다녀온 곳(로그인 회원) ─────
    const PALETTE = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#3a86ff', '#8338ec', '#ff66b3', '#1f2937'];
    const account = () => window.LottoAccount;
    const loadIds = () => (ids ? Promise.resolve(ids) : fetch(root.dataset.ids).then(r => r.json()).then(j => (ids = j)).catch(() => null));
    // 지도 점에 색 입히기(feature-state). 일반 판매점 층은 켤 때 다시 부른다
    const painted = { stores: new Set(), all: new Set() };
    function paintVisits() {
        if (!ids || !map) return;
        [['stores', 'w'], ['all', 'a']].forEach(([src, k]) => {
            if (!map.getSource(src)) return;
            painted[src].forEach(i => map.setFeatureState({ source: src, id: i }, { visit: null }));
            painted[src].clear();
            (ids[k] || []).forEach((id, i) => { if (visits[id]) { map.setFeatureState({ source: src, id: i }, { visit: visits[id] }); painted[src].add(i); } });
        });
    }
    async function initVisits() {
        const A = account();
        if (!A || !A.ready) return;
        await A.ready;
        if (!A.loginOn() || !A.session()) return;
        const me = A.me();
        visits = (me && me.user && me.user.visits) || {};
        if (Object.keys(visits).length && await loadIds()) paintVisits();
    }
    async function visitUi(k, i) {
        const box = document.getElementById('sm-visit');
        const A = account();
        if (!box || !A || !A.ready) return;
        await A.ready;
        if (!A.loginOn()) { box.remove(); return; }   // 서버에 로그인이 꺼져 있으면 저장할 곳이 없다
        const myCard = card.dataset.k = k + i;
        const draw = () => {
            if (card.dataset.k !== myCard) return;
            const id = ids && ids[k] && ids[k][i];
            const cur = id ? visits[id] : null;
            box.innerHTML = '<div class="sm-visit-row"><button type="button" class="sm-visit-btn' + (cur ? ' is-on' : '') + '" aria-pressed="' + !!cur + '">' +
                (cur ? '<span class="sm-swatch" style="background:' + cur + '"></span>' + T('다녀온 곳', 'Visited') : T('＋ 다녀왔어요', '＋ I\'ve been here')) + '</button>' +
                (cur ? '<span class="sm-colors">' + PALETTE.map(c => '<button type="button" class="sm-color' + (c === cur ? ' is-on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') +
                    '<label class="sm-color sm-color-any" title="' + T('다른 색', 'Any colour') + '"><input type="color" value="' + cur + '" aria-label="' + T('다른 색', 'Any colour') + '"></label></span>' : '') + '</div>' +
                '<p class="sm-visit-note">' + (cur ? T('다시 누르면 지웁니다. 나만 보입니다.', 'Tap again to remove. Only you can see this.') : T('로그인 회원 기능 · 나만 보입니다(위치는 쓰지 않습니다).', 'Members only · only you can see it (no location used).')) + '</p>';
            box.querySelector('.sm-visit-btn').addEventListener('click', () => save(cur ? null : PALETTE[0]));
            box.querySelectorAll('button.sm-color').forEach(b => b.addEventListener('click', () => save(b.dataset.c)));
            const pick = box.querySelector('input[type="color"]');
            if (pick) pick.addEventListener('change', () => save(pick.value));
        };
        const save = async color => {
            if (!(await member(T('다녀온 곳 표시는 로그인 회원 기능입니다.', 'Marking visited retailers is for signed-in members.')))) return;
            if (!(await loadIds())) return;
            const id = ids[k] && ids[k][i];
            if (!id) return;
            try {
                const r = await account().call('/api/me/visits', { method: 'POST', body: { id, color } });
                visits = r.visits || {};
                paintVisits();
                draw();
            } catch (e) {
                box.querySelector('.sm-visit-note').textContent = (e && e.message) || T('저장하지 못했습니다.', 'Could not save.');
            }
        };
        if (A.session()) await loadIds();
        draw();
    }

    // 당첨 회차 — 카드를 처음 열 때 한 번 받는다
    let roundsP = null;
    const loadRounds = () => (roundsP = roundsP || fetch(root.dataset.rounds).then(r => r.json()).catch(() => { roundsP = null; return null; }));
    const HOW = { 1: ['자동', 'auto'], 2: ['수동', 'manual'], 3: ['반자동', 'semi'] };
    const PER = 5;   // 한 쪽에 5회차
    const band = n => (n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5);
    const ball = n => '<span class="mball" data-band="' + band(n) + '">' + n + '</span>';
    // 회차 줄: 회차(회차 페이지 링크) · 날짜 · (1등 방식 | 2등 장수) · 당첨번호 + 보너스
    function roundRow(r, tag, draws) {
        const d = draws[r];
        return '<li><a href="round/' + r + '.html"><b>' + r + T('회', '') + '</b>' + (d ? ' <span class="sm-date">' + d[0].replace(/-/g, '.') + '</span>' : '') +
            (tag ? ' <small>' + tag + '</small>' : '') + '</a>' +
            (d ? '<span class="sm-balls">' + d[1].map(ball).join('') + '<span class="sm-plus">+</span>' + ball(d[2]) + '</span>' : '') + '</li>';
    }
    // 목록 하나(제목 + 5개씩 쪽 넘김)
    function roundList(box, title, rows) {
        if (!rows.length) return;
        const sec = document.createElement('section');
        box.appendChild(sec);
        const pages = Math.ceil(rows.length / PER);
        let pg = 0;
        const draw = () => {
            sec.innerHTML = '<h4>' + title + '</h4><ul>' + rows.slice(pg * PER, pg * PER + PER).join('') + '</ul>' +
                (pages > 1 ? '<div class="sm-pager"><button type="button" class="sm-pg" data-d="-1" aria-label="' + T('이전', 'Previous') + '"' + (pg ? '' : ' disabled') + '>‹</button>' +
                    '<span>' + (pg + 1) + ' / ' + pages + '</span><button type="button" class="sm-pg" data-d="1" aria-label="' + T('다음', 'Next') + '"' + (pg < pages - 1 ? '' : ' disabled') + '>›</button></div>' : '');
            sec.querySelectorAll('.sm-pg').forEach(b => b.addEventListener('click', () => { pg = Math.max(0, Math.min(pages - 1, pg + Number(b.dataset.d))); draw(); }));
        };
        draw();
    }
    function fillRounds(box, rw, draws) {
        const [r1, r2] = rw;
        box.textContent = '';
        roundList(box, T('1등 나온 회차', '1st-prize draws') + ' (' + r1.length + ')',
            r1.map(c => { const how = HOW[c % 4]; return roundRow(Math.floor(c / 4), how ? T(how[0], how[1]) : '', draws); }));
        const cnt = new Map();
        r2.forEach(r => cnt.set(r, (cnt.get(r) || 0) + 1));
        roundList(box, T('2등 나온 회차', '2nd-prize draws') + ' (' + r2.length + ')',
            [...cnt].map(([r, n]) => roundRow(r, n > 1 ? '×' + n : '', draws)));
    }

    // 판매점 카드
    function open(i, fly) {
        const r = data.rows[i];
        const [lat, lng, w1, w2, name, si, gu, closed, a, m, s] = r;
        const place = [data.sido[si] || '', gu].filter(Boolean).join(' ');
        const how = [a ? T('자동 ', 'auto ') + a : '', m ? T('수동 ', 'manual ') + m : '', s ? T('반자동 ', 'semi-auto ') + s : ''].filter(Boolean).join(' · ');
        showCard('<h3>' + esc(name) + (closed ? ' <span class="sm-closed">' + T('폐점', 'closed') + '</span>' : '') + '</h3>' +
            '<p class="sm-place">' + esc(place) + '</p>' +
            '<p class="sm-counts"><span><b>' + fmt(w1) + '</b>' + T('번 1등', ' × 1st') + (how ? ' <small>(' + esc(how) + ')</small>' : '') + '</span>' +
            '<span><b>' + fmt(w2) + '</b>' + T('번 2등', ' × 2nd') + '</span></p>' +
            '<div class="sm-rounds" id="sm-rounds"><p class="sm-small">' + T('당첨 회차 불러오는 중…', 'Loading draws…') + '</p></div>' +
            '<p class="sm-why">' + T('1등 · 2등이 많을수록 많이 팔린 곳일 가능성이 큽니다. 어느 판매점에서 사든 1등 확률은 1/8,145,060으로 같습니다.',
                'More 1st and 2nd prizes most likely means more tickets sold. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.') + '</p>' +
            links(name, place, lat, lng) + '<div class="sm-visit" id="sm-visit"></div>', lat, lng, fly);
        card.dataset.i = String(i);
        visitUi('w', i);
        markTop(i);
        loadRounds().then(rd => {
            const box = document.getElementById('sm-rounds');
            if (!box || card.dataset.i !== String(i)) return;   // 그 사이 다른 카드를 열었다
            if (!rd || !rd.rows[i]) { box.remove(); return; }
            fillRounds(box, rd.rows[i], rd.draws || {});
        });
    }

    function initSearch() {
        const box = document.getElementById('sm-search');
        const list = document.getElementById('sm-found');
        box.addEventListener('input', () => {
            const q = box.value.trim().toLowerCase();
            list.textContent = '';
            if (q.length < 2) { list.hidden = true; return; }
            const hits = [];
            for (let i = data.rows.length - 1; i >= 0 && hits.length < 20; i--) if (data.rows[i][4].toLowerCase().includes(q)) hits.push(i);   // 1등 많은 곳부터
            const more = [];   // 일반 판매점(층을 켰을 때만)
            if (all && shown.all) for (let i = 0; i < all.rows.length && hits.length + more.length < 20; i++) if (all.rows[i][2].toLowerCase().includes(q)) more.push(i);
            list.hidden = false;
            if (!hits.length && !more.length) { list.innerHTML = '<li class="sm-none">' + T('찾는 판매점이 없습니다.', 'No match.') + '</li>'; return; }
            hits.forEach(i => {
                const r = data.rows[i];
                const li = document.createElement('li');
                const b = document.createElement('button');
                b.type = 'button';
                b.innerHTML = '<b>' + esc(r[4]) + '</b> <span>' + esc([data.sido[r[5]], r[6]].filter(Boolean).join(' ')) + ' · ' + T('1등 ', '1st ') + r[2] + ' · ' + T('2등 ', '2nd ') + r[3] + '</span>';
                b.addEventListener('click', () => { list.hidden = true; box.blur(); open(i, true); });
                li.appendChild(b);
                list.appendChild(li);
            });
            more.forEach(i => {
                const r = all.rows[i];
                const li = document.createElement('li');
                const b = document.createElement('button');
                b.type = 'button';
                b.innerHTML = '<b>' + esc(r[2]) + '</b> <span>' + esc([all.sido[r[3]], r[4]].filter(Boolean).join(' ')) + ' · ' + T('일반 판매점', 'retailer') + '</span>';
                b.addEventListener('click', () => { list.hidden = true; box.blur(); openAll(i, true); });
                li.appendChild(b);
                list.appendChild(li);
            });
        });
    }

    // 막대 지도: 점마다 작은 네모 기둥(1등 많을수록 높게).
    //  모양은 미터로 정해져 있어 줌하는 동안은 실제 물체처럼 그대로 커지고 작아진다 — 줌 중에는 아무것도 다시 만들지 않는다(예전에는 줌 0.25 단계마다
    //  모양을 새로 만들어 끼웠는데 PC 에서 줌할 때 렉이 걸렸다). 줌을 멈추면(moveend) 그 줌에서 화면 굵기 · 높이가 알맞은 모양을 만들고,
    //  그 타일이 다 그려지면 새 모양은 0.3초 동안 나타나고 옛 모양은 사라진다(opacity transition).
    const M0 = 40075016.686 / 512;   // 줌 0, 적도에서 화면 1px 의 미터
    const FADE = 300;
    const halfPx = z => Math.min(7, Math.max(2.5, 2.5 + (z - 8) * 0.6));   // 기둥 반 폭(px): 전국 2.5 → 거리 7
    const bandOf = z => Math.max(10, Math.min(36, Math.round(z * 2)));     // 줌 0.5 단계(5 ~ 18)
    const barIds = k => ['bar-w2-' + k, 'bar-w1-' + k];
    function barBand(k) {
        const mpp0 = M0 / Math.pow(2, k / 2), r0 = halfPx(k / 2) * mpp0;   // 그 줌 · 적도에서 1px · 반 폭(m)
        return {
            type: 'FeatureCollection',
            features: data.rows.map((x, i) => {
                const [lat, lng] = x, p = props[i], cos = Math.cos(lat * Math.PI / 180);
                const dy = r0 * cos / 111320, dx = r0 / 111320;   // 미터 → 도(위도 따라 화면 크기가 같게)
                const hpx = p.w1 ? 8 + 6 * p.w1 : 2 + 1.5 * p.w2;
                return {
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]] },
                    properties: { i, w1: p.w1, o1: p.o1, closed: p.closed, h: hpx * mpp0 * cos },
                };
            }),
        };
    }
    function addBand(k) {
        if (bands.has(k)) return;
        bands.add(k);
        map.addSource('bars-' + k, { type: 'geojson', data: barBand(k) });
        ['w2', 'w1'].forEach((t, n) => map.addLayer({ id: barIds(k)[n], type: 'fill-extrusion', source: 'bars-' + k, filter: filterFor(t),
            paint: { 'fill-extrusion-color': t === 'w1' ? '#f07a1a' : '#3b6fd8', 'fill-extrusion-height': ['get', 'h'],
                'fill-extrusion-opacity': 0, 'fill-extrusion-opacity-transition': { duration: FADE, delay: 0 } } }));
    }
    function dropBand(k) {
        barIds(k).forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource('bars-' + k)) map.removeSource('bars-' + k);
        bands.delete(k);
    }
    const bandOpacity = (k, v) => barIds(k).forEach(id => map.setPaintProperty(id, 'fill-extrusion-opacity', v));
    // 그 소스의 타일이 다 그려졌을 때(늦어도 1.5초) 부른다
    function whenLoaded(id, cb) {
        let done = false;
        const go = () => { if (done) return; done = true; map.off('sourcedata', on); clearTimeout(t); cb(); };
        const on = e => { if (e.sourceId === id && map.isSourceLoaded(id)) go(); };
        const t = setTimeout(go, 1500);
        map.on('sourcedata', on);
    }
    function settleBars() {
        if (!bars) return;
        const k = bandOf(map.getZoom());
        if (k === curBand) return;
        if (oldBand !== null) dropBand(oldBand);
        oldBand = curBand;
        curBand = k;
        addBand(k);
        applyLayers();
        whenLoaded('bars-' + k, () => {
            if (curBand !== k || !bars) return;
            bandOpacity(k, 0.9);
            const old = oldBand;
            if (old === null) return;
            bandOpacity(old, 0);
            setTimeout(() => { if (oldBand === old) { dropBand(old); oldBand = null; } }, FADE + 80);
        });
    }
    function setBars(on) {
        bars = on;
        document.getElementById('sm-bars').setAttribute('aria-pressed', String(on));
        if (on) settleBars();
        else { [...bands].forEach(dropBand); curBand = oldBand = null; }
        applyLayers();
        if (on && map.getPitch() < 30) set3d(true, true);
    }
    // 로그인 회원 기능. 서버에 로그인이 꺼져 있으면 잠그지 않는다(사이트 다른 회원 기능과 같게)
    async function member(reason) {
        const A = window.LottoAccount;
        if (A && A.ready) await A.ready;
        if (A && A.loginOn && A.loginOn() && !A.session()) { A.openLogin(reason); return false; }
        return true;
    }
    async function toggleBars() {
        if (bars) { setBars(false); return; }
        if (await member(T('막대 지도는 로그인 회원 기능입니다.', 'The bar map is for signed-in members.'))) setBars(true);
    }
    // 1등 방식을 바꾸면 점 · 숫자 · 막대를 다시 센다
    async function toggleMode(b) {
        const k = b.dataset.mode;
        if (!(await member(T('자동 · 수동 나눠 보기는 로그인 회원 기능입니다.', 'Filtering by auto/manual is for signed-in members.')))) return;
        modes[k] = !modes[k];
        b.setAttribute('aria-pressed', String(modes[k]));
        computeProps();
        map.getSource('stores').setData(geojson());
        bands.forEach(b => map.getSource('bars-' + b).setData(barBand(b)));
        renderTop();
    }

    // 끌기 막대: 0 → 100 을 1등 횟수 기준 0 → 30 으로(앞쪽을 촘촘하게). 흐리기는 칠 값만 바꾸고, 다 흐려진 곳은 거른다
    let fadeRaf = 0;
    function setFade(v) {
        fadeT = v <= 0 ? 0 : 0.05 + Math.pow(v / 100, 2) * 30;
        const out = document.getElementById('sm-fade-v');
        out.textContent = !fadeT ? T('모두', 'All') : fadeT < 1 ? T('2등만 나온 곳 흐리게', 'Fading 2nd-only') : T('1등 ' + Math.ceil(fadeT) + '회 이상', '1st × ' + Math.ceil(fadeT) + '+');
        if (fadeRaf) return;
        fadeRaf = requestAnimationFrame(() => {
            fadeRaf = 0;
            if (!map.getLayer('st-w1')) return;
            ['st-w1', 'st-w2'].forEach(id => {
                map.setPaintProperty(id, 'circle-opacity', ['*', ['case', ['==', ['get', 'closed'], 1], 0.35, 0.85], fadeF()]);
                map.setPaintProperty(id, 'circle-stroke-opacity', fadeF());
            });
            map.setPaintProperty('st-num', 'text-opacity', fadeF());
            if (map.getLayer('st-all')) map.setPaintProperty('st-all', 'circle-opacity', 0.7 * Math.max(0, 1 - fadeT));
            applyLayers();
        });
    }

    // ───── 이색 판매점(끝과 끝 · 외딴 곳 …) — 왼쪽 아래 목록 + 지도 위 별 표시. 자료는 store-map-data.json 의 fun(생성기가 계산) ─────
    function openFun(k) {
        const f = (data.fun || [])[k];
        if (!f) return;
        document.getElementById('sm-fun').hidden = true;
        document.getElementById('sm-fun-btn').setAttribute('aria-expanded', 'false');
        map.flyTo({ center: [f.lng, f.lat], zoom: f.zoom, pitch: 0, bearing: 0, padding: pad(), essential: true });
        const [t, i] = f.ref;
        if (t === 'w') open(i, false);
        else if (all) openAll(i, false);
        else { shown.all = true; root.querySelector('.sm-chip[data-layer="all"]').setAttribute('aria-pressed', 'true'); applyLayers(); const wait = () => (all ? openAll(i, false) : setTimeout(wait, 200)); wait(); }
    }
    function initFun() {
        const btn = document.getElementById('sm-fun-btn'), box = document.getElementById('sm-fun');
        if (!btn || !data.fun) return;
        btn.addEventListener('click', () => { box.hidden = !box.hidden; btn.setAttribute('aria-expanded', String(!box.hidden)); });
        box.querySelectorAll('.sm-fun-item').forEach(b => b.addEventListener('click', () => openFun(Number(b.dataset.k))));
        // 지도 위 별 표시 — 누르면 그 판매점으로
        data.fun.forEach((f, k) => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'sm-star';
            el.textContent = f.icon;
            el.title = T(f.title, f.titleEn) + ' — ' + f.name;
            el.setAttribute('aria-label', el.title);
            el.addEventListener('click', e => { e.stopPropagation(); openFun(k); });
            new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat([f.lng, f.lat]).addTo(map);
        });
    }

    // PC 오른쪽 위: 1등 많은 50곳(고른 1등 방식 기준, 폐점 제외)
    function renderTop() {
        const ol = document.getElementById('sm-top50-list');
        if (!ol) return;
        const top = props.filter(p => p.top).sort((a, b) => a.top - b.top);
        ol.innerHTML = top.map(p => {
            const r = data.rows[p.i];
            return '<li><button type="button" data-i="' + p.i + '"><span class="sm-rank">' + p.top + '</span><span class="sm-tname">' + esc(r[4]) +
                '<small>' + esc([data.sido[r[5]], r[6]].filter(Boolean).join(' ')) + '</small></span><span class="sm-tcnt"><b>' + p.w1 + '</b>' + T('번', '') + '<small>2' + T('등 ', 'nd ') + r[3] + '</small></span></button></li>';
        }).join('');
        ol.querySelectorAll('button').forEach(b => b.addEventListener('click', () => open(Number(b.dataset.i), true)));
    }
    function markTop(i) {
        document.querySelectorAll('#sm-top50-list button').forEach(b => b.classList.toggle('is-on', String(i) === b.dataset.i));
    }



    // 3D(기울임). 줌인하면 저절로 기울고(auto), 손으로 2D 를 고르면 13 밑으로 나갈 때까지 저절로 기울이지 않는다
    let auto3d = false, keep2d = false;
    function set3d(on, keepZoom) {
        const d3 = document.getElementById('sm-3d');
        d3.setAttribute('aria-pressed', String(on));
        d3.textContent = on ? '2D' : '3D';
        map.easeTo({ pitch: on ? 55 : 0, bearing: on ? -17 : 0, zoom: on && !keepZoom ? Math.max(map.getZoom(), 15.5) : map.getZoom(), duration: 900 });
    }
    function autoTilt() {
        const z = map.getZoom(), tilted = map.getPitch() > 5;
        if (z < 13) { keep2d = false; if (auto3d && tilted && !bars) { auto3d = false; set3d(false); } return; }
        if (z >= 15 && !tilted && !keep2d) { auto3d = true; set3d(true, true); }
    }

    // 위쪽 도구 · 아래쪽 단추에 가리지 않게 지도를 맞출 때의 여백
    const pad = () => ({ top: (document.querySelector('.sm-top').offsetHeight || 150) + 16, bottom: 60, left: 24, right: isWide() ? 360 : 56 });
    function initControls() {
        root.querySelectorAll('.sm-chip[data-layer]').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.layer;
            shown[k] = !shown[k];
            b.setAttribute('aria-pressed', String(shown[k]));
            applyLayers();
        }));
        const d3 = document.getElementById('sm-3d');
        d3.addEventListener('click', () => {
            const on = d3.getAttribute('aria-pressed') !== 'true';
            auto3d = false;
            keep2d = !on;
            set3d(on);
        });
        document.getElementById('sm-bars').addEventListener('click', toggleBars);
        root.querySelectorAll('.sm-mode').forEach(b => b.addEventListener('click', () => toggleMode(b)));
        const fade = document.getElementById('sm-fade');
        fade.addEventListener('input', () => setFade(Number(fade.value)));
        // 시도별 표의 지역 이름 → 그 지역의 판매점이 다 보이게
        document.querySelectorAll('.sm-goto').forEach(b => b.addEventListener('click', () => {
            const si = data.sido.indexOf(b.dataset.sido);
            const pts = data.rows.filter(r => r[5] === si);
            if (!pts.length) return;
            const lats = pts.map(r => r[0]).sort((x, y) => x - y), lngs = pts.map(r => r[1]).sort((x, y) => x - y);
            const q = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];   // 끝의 1%는 빼고(주소가 잘못 찍힌 점에 끌려가지 않게)
            document.getElementById('sm-info').open = false;
            const tilt = bars ? 45 : 0;
            map.fitBounds([[q(lngs, 0.01), q(lats, 0.01)], [q(lngs, 0.99), q(lats, 0.99)]], { padding: pad(), pitch: tilt, bearing: 0 });
            document.getElementById('sm-3d').setAttribute('aria-pressed', String(!!tilt));
            document.getElementById('sm-3d').textContent = tilt ? '2D' : '3D';
        }));
    }

    async function start() {
        try {
            const res = await fetch(root.dataset.src);
            data = await res.json();
            computeProps();
        } catch (e) { fail(T('판매점 자료를 불러오지 못했습니다. 새로 고쳐 주세요.', 'Could not load the retailer data. Please reload.')); return; }
        mapBox.textContent = '';
        map = new maplibregl.Map({
            container: mapBox, style: STYLE, center: [126.99, 37.55], zoom: 10.5,
            maxBounds: [[118, 30], [138, 42]], attributionControl: { compact: true }, dragRotate: true, pitchWithRotate: true,
            hash: 'map',   // 주소 끝 #map=줌/위도/경도/방향/기울기 — 보던 화면을 링크로 나눌 수 있다
        });
        // 오른쪽 아래는 나중에 단 것이 위로 쌓인다: 확대/축소 → 내 위치 → 북쪽 보기
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
        // 내 위치: 브라우저 위치 기능(휴대폰 GPS, PC 는 와이파이 · IP 로 어림). 이 기기 안에서만 쓰고 서버로 보내지 않는다(위치정보법 — README 4-9)
        map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false }, trackUserLocation: false }), 'bottom-right');
        map.addControl(new NorthControl(), 'bottom-right');
        // 처음 화면: 서울 전체(2026-10-26 사장님 — 전국은 시도별 표 · 줌아웃으로)
        const fromLink = /[#&]map=/.test(location.hash);   // 링크로 받은 화면이면 그대로
        map.on('load', () => {
            koreanLabels(); whiteModel(); addStores(); landmarks(); renderTop(); initVisits(); initFun();
            if (!fromLink) map.fitBounds([[126.8, 37.43], [127.18, 37.7]], { padding: pad(), duration: 0 });
            else if (map.getPitch() > 5) { const d3 = document.getElementById('sm-3d'); d3.setAttribute('aria-pressed', 'true'); d3.textContent = '2D'; }   // 기울어진 화면 링크
        });
        map.on('zoomend', autoTilt);
        map.on('moveend', settleBars);
        // 막대 누르기(단계마다 층이 바뀌어 지도 전체에서 받는다)
        map.on('click', e => {
            if (!bars) return;
            const f = map.queryRenderedFeatures(e.point, { layers: [...bands].flatMap(barIds).filter(id => map.getLayer(id)) });
            if (f[0]) open(f[0].properties.i, false);
        });
        map.on('error', e => { if (e && e.error && /style|tiles/i.test(String(e.error.message))) console.warn('map', e.error); });
        initControls();
        initSearch();
    }
    start();
})();
