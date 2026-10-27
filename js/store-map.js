/* 판매점 지도 (store-map.html, 2026-10-26).
 *
 * 자료: store-map-data.json (tools/build-static-stats.js 가 stores-data.json 으로 매주 만든다)
 *   rows: [위도, 경도, 1등, 2등, 상호, 시도 번호, 시군구, 폐점, 자동, 수동, 반자동]
 * 화면 전체가 지도다(머리글 · 메뉴 없음, 왼쪽 위 "생성기로" 단추 하나). 지도: MapLibre(js/vendor/) + OpenFreeMap "positron" 바탕(키 없음, © OpenStreetMap).
 * 모양(2026-10-26 사장님 결정 — 제안 ② "화이트 모형"): 하얀 땅에 반투명 흰 건물, 색은 판매점 점에만. 줌 15쯤부터 건물이 솟아오르고(높이를 줌에 따라 0 → 실제 높이)
 * 지도도 저절로 기울어진다(13 아래로 나가면 다시 평평하게). 3D 단추는 손으로 기울이기/펴기.
 * 막대 지도는 2026-10-26 뺐다(임팩트가 약하고 보기 불편 — 사장님).
 * 밤 모드: 사이트 낮/밤(data-theme)을 따라 바탕 지도 색을 어둡게 바꾼다(nightModel). 왼쪽 도구의 🌙 단추로도 바꾼다.
 * 점 크기 = 2등 + 1등 × 6 (1등은 2등보다 6배 드물다 — 팔린 양을 짐작하는 값). 1등이 나온 곳은 주황, 2등만 나온 곳은 파랑. TOP 50 은 점 안에 1등 횟수. "TOP 50" 칩을 켜면 TOP 50 만 노란 반짝이 별 + 숨 쉬듯 빛나는 별 테두리로 남고 밤 지도로 바뀐다(끄면 원래 낮/밤으로). 바탕 지도의 도로 번호판은 감춘다.
 * 1등 방식(자동 · 수동 · 반자동) 체크 — 로그인 회원 기능. 끈 방식의 1등은 세지 않는다(점 크기 · 숫자 · TOP 50).
 * 카드: 1등 · 2등이 나온 회차 · 날짜 · 당첨번호, 5개씩 쪽 넘김(store-map-rounds.json — 카드를 처음 열 때 받는다).
 * 왼쪽 아래 끌기 막대: 오른쪽으로 끌수록 1등 횟수가 적은 곳부터 서서히 흐려져 많이 나온 곳만 남는다(2등만 나온 곳이 먼저).
 * PC(폭 900px 이상): 지도 단추(오른쪽 아래)를 빼고 모두 왼쪽 한 줄 기둥에 — 도구 · TOP 50(휠로 넘김) · 판매점 카드 · 이색 판매점 · 체크 · 끌기 막대 · 시도별.
 *   휴대폰은 위쪽에 작은 안내 한 줄.
 * 첫 화면은 서울(2026-10-26 사장님).
 * 다녀온 곳(로그인 회원): 카드에서 "다녀왔어요"를 누르고 색을 고르면 그 판매점 점을 그 색으로 칠한다(가장자리는 1등 주황 · 2등 파랑 그대로).
 *   서버에는 판매점 번호와 색만(/api/me/visits). 기기 위치는 쓰지 않는다. 판매점 번호는 store-map-ids.json(로그인했을 때만 받는다).
 *   색: 첫 색은 누구나, 나머지는 이용권이 있으면 다, 없으면 색 하나에 30포인트(/api/me/visit-color — 한 번 열면 계속).
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
    const shown = { top: false, w1: true, w2: true, closed: false, all: false };   // top: TOP 50 만 별로 보기(2026-10-27)
    const modes = { A: true, M: true, S: true };   // 1등 방식 체크(로그인 회원)
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
        // TOP 50 칩을 켜면 원은 다 감추고 TOP 50 별만 남긴다
        ['w1', 'w2'].forEach(k => {
            map.setLayoutProperty('st-' + k, 'visibility', vis(shown[k] && !shown.top));
            map.setFilter('st-' + k, filterFor(k));
        });
        map.setLayoutProperty('st-num', 'visibility', vis(shown.top || shown.w1));
        map.setFilter('st-num', ['all', isTop, filterFor('w1')]);
        numPaint(shown.top);
        ['st-top', 'st-top-glow'].forEach(id => {
            map.setLayoutProperty(id, 'visibility', vis(shown.top));
            map.setFilter(id, ['all', isTop, filterFor('w1')]);
        });
        if (map.getLayer('st-all')) map.setLayoutProperty('st-all', 'visibility', shown.all && !shown.top ? 'visible' : 'none');
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
                'circle-stroke-color': rim('#7d8799'), 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', vis, 1, 0], 13, ['case', vis, 2, 1]],
            },
        }, 'st-w2');
        paintVisits();
        map.on('click', 'st-all', e => {
            // 1등 · 2등 점과 겹치면 그쪽 카드를 연다
            if (map.queryRenderedFeatures(e.point, { layers: ['st-w1', 'st-w2', 'st-top'] }).length) return;
            if (e.features && e.features[0]) openAll(e.features[0].properties.i, false);
        });
        map.on('mouseenter', 'st-all', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'st-all', () => { map.getCanvas().style.cursor = ''; });
    }

    // 바탕 지도의 글자를 한글 이름으로(없으면 원래 이름).
    // 도로 번호판(흰 네모 아이콘이 붙은 층)은 감춘다 — 판매점 지도에는 필요 없다(2026-10-27 사장님). 처음엔 도로 이름이 네모 안에 겹쳐 보였다
    const isShield = l => !!(l.layout && l.layout['icon-image']);
    function koreanLabels() {
        for (const l of map.getStyle().layers) {
            if (l.type === 'symbol' && isShield(l)) { map.setLayoutProperty(l.id, 'visibility', 'none'); continue; }
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

    // ───── 밤 지도(2026-10-26 사장님) — 사이트 낮/밤(data-theme="dark")을 따른다. 🌙 단추는 사이트 낮/밤 단추(js/theme.js)를 대신 누른다 ─────
    // 바탕 지도 층의 색을 층 종류별로 바꾸고, 낮으로 돌아갈 때는 처음 값(화이트 모형)을 되돌린다
    const NIGHT = { bg: '#141a23', water: '#0c1520', park: '#18211d', land: '#19202a', bld: '#212935', road: '#2c3646', casing: '#1b222d',
        rail: '#394252', border: '#4a5466', text: '#a9b3c1', halo: '#141a23', extr: '#2a3443', edge: '#323c4c' };
    const isNight = () => document.documentElement.getAttribute('data-theme') === 'dark';
    const rim = color => ['case', vis, color, isNight() ? NIGHT.bg : '#fff'];   // 점 가장자리(다녀온 곳은 1등 · 2등 색)
    const orig = new Map();
    function setP(id, k, v) {
        const key = id + '|' + k;
        if (!orig.has(key)) orig.set(key, map.getPaintProperty(id, k));
        try { map.setPaintProperty(id, k, v === null ? orig.get(key) : v); } catch (e) { /* 없는 속성 */ }
    }
    function nightModel(on) {
        if (!map || !map.getLayer('st-w1')) return;
        document.getElementById('sm-night').setAttribute('aria-pressed', String(on));
        const N = k => (on ? NIGHT[k] : null);
        for (const l of map.getStyle().layers) {
            const sl = l['source-layer'], id = l.id;
            if (/^st-/.test(id)) continue;
            if (id === 'sm-bld') setP(id, 'fill-extrusion-color', N('extr'));
            else if (id === 'sm-bld-line') setP(id, 'line-color', N('edge'));
            else if (l.type === 'background') setP(id, 'background-color', N('bg'));
            else if (l.type === 'fill') setP(id, 'fill-color', N(sl === 'water' ? 'water' : sl === 'park' || sl === 'landcover' ? 'park' : sl === 'building' ? 'bld' : 'land'));
            else if (l.type === 'line') setP(id, 'line-color', N(sl === 'water' || sl === 'waterway' ? 'water' : sl === 'boundary' ? 'border' : /casing/.test(id) ? 'casing' : /rail|transit/.test(id) ? 'rail' : 'road'));
            else if (l.type === 'symbol' && l.layout && l.layout['text-field'] && !isShield(l)) { setP(id, 'text-color', N('text')); setP(id, 'text-halo-color', N('halo')); }
        }
        if (map.getLayer('st-top-glow')) map.setLayoutProperty('st-top-glow', 'icon-image', on ? 'sm-star-glow-n' : 'sm-star-glow');
        map.setPaintProperty('st-w1', 'circle-stroke-color', rim('#f07a1a'));
        map.setPaintProperty('st-w2', 'circle-stroke-color', rim('#3b6fd8'));
        if (map.getLayer('st-all')) map.setPaintProperty('st-all', 'circle-stroke-color', rim('#7d8799'));
    }
    function toggleNight() {
        const tb = document.getElementById('theme-btn');
        if (tb) { tb.click(); return; }   // 저장 · 다른 탭 따라가기는 theme.js 가 한다
        const dark = !isNight();
        if (dark) document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('lottodraw.theme', dark ? 'dark' : 'light'); } catch (e) { /* 이 페이지에서만 */ }
    }
    // TOP 50 칩을 켜면 곧바로 밤 지도로(2026-10-27 사장님). 그 때문에 밤이 됐으면 끌 때 낮으로 돌려 놓는다(그 사이 🌙 을 손으로 누르면 그대로 둔다)
    let nightByTop = false;
    function topNight(on) {
        if (on && !isNight()) { nightByTop = true; toggleNight(); }
        else if (!on && nightByTop) { nightByTop = false; if (isNight()) toggleNight(); }
    }
    new MutationObserver(() => nightModel(isNight())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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

    // 점 투명도: 0.62(폐점 0.3). TOP 50 별은 0.75(2026-10-27 사장님)
    const ALPHA = 0.62, STAR_ALPHA = 0.75;   // 별만 조금 진하게(밤 바탕에서 칙칙해 보였다)
    const isTop = ['>', ['get', 'top'], 0];
    const dotAlpha = () => ['*', ['case', ['==', ['get', 'closed'], 1], 0.3, ALPHA], fadeF()];
    const rimAlpha = () => fadeF();
    // 1등 횟수 글자: 원 위에서는 흰 글자, 별 위에서는 진한 갈색 글자
    function numPaint(star) {
        if (!map.getLayer('st-num')) return;
        map.setPaintProperty('st-num', 'text-color', star ? '#5a3c00' : '#fff');
        map.setPaintProperty('st-num', 'text-halo-color', star ? 'rgba(255, 250, 220, .85)' : 'rgba(150, 60, 0, .55)');
        map.setPaintProperty('st-num', 'text-halo-width', star ? 1 : 0.7);
    }

    // TOP 50 별: 네 갈래로 뾰족한 반짝이 모양(2026-10-27 사장님이 준 그림), 노랑. 그림 두 장을 한 번 그려 지도에 올린다 —
    //   'sm-star'(별) 과 'sm-star-glow'(별 테두리만 빛나는 그림, 숨 쉬듯 밝기를 바꾼다). 빛이 번질 자리만큼 그림을 별보다 크게(STAR) 잡는다
    const STAR = 160, SR = 61;   // 그림 한 변 · 별 끝까지의 반지름(px)
    function starPath(g, m) {
        // 끝은 가늘고 길게, 가운데 몸통은 작게 — 끝과 끝 사이를 가운데 쪽으로 깊게 휘는 3차 곡선으로(2026-10-27 사장님 — 곡률을 더 강하게)
        const a = SR * 0.03;   // 조절점이 축에서 떨어진 정도(작을수록 끝이 가늘다)
        const tips = [[0, -SR], [SR * 0.92, 0], [0, SR], [-SR * 0.92, 0]];
        g.beginPath();
        g.moveTo(m + tips[0][0], m + tips[0][1]);
        for (let n = 0; n < 4; n++) {
            const [x1, y1] = tips[n], [x2, y2] = tips[(n + 1) % 4];
            // 조절점 둘을 가운데 가까이(축에서 a 만큼, 가운데에서 0.2R) 두면 끝은 가늘고 몸통 모서리는 가운데 쪽으로 깊게 들어간다
            const sx = Math.sign(x1 + x2), sy = Math.sign(y1 + y2);
            g.bezierCurveTo(m + (x1 ? x1 * 0.2 : sx * a), m + (y1 ? y1 * 0.2 : sy * a),
                m + (x2 ? x2 * 0.2 : sx * a), m + (y2 ? y2 * 0.2 : sy * a),
                m + x2, m + y2);
        }
        g.closePath();
    }
    function starImage(glow) {
        const c = document.createElement('canvas');
        c.width = c.height = STAR;
        const g = c.getContext('2d'), m = STAR / 2;
        starPath(g, m);
        if (glow) {
            // 테두리 빛: 밝은 선을 흐린 그림자와 함께 여러 번 겹쳐 그린다(겹칠수록 진하다)
            g.lineJoin = 'round';
            // 낮은 금빛(흰 빛은 밝은 바탕에서 별을 흐리게 만들었다), 밤은 흰빛이 도는 노랑
            g.shadowColor = glow === 'night' ? '#ffe680' : '#ffae00';
            g.strokeStyle = glow === 'night' ? '#fffbe6' : '#ffe14d';
            [[14, 3], [8, 2.4], [3, 1.6]].forEach(([blur, w]) => { g.shadowBlur = blur; g.lineWidth = w; g.stroke(); });
            return g.getImageData(0, 0, STAR, STAR);
        }
        const fill = g.createRadialGradient(m, m, 0, m, m, SR);
        fill.addColorStop(0, '#fffbe0');
        fill.addColorStop(0.18, '#ffe45c');
        fill.addColorStop(0.6, '#ffc21a');
        fill.addColorStop(1, '#f0a400');
        g.fillStyle = fill;
        g.fill();
        g.lineWidth = 2.2;
        g.strokeStyle = '#b97c00';
        g.stroke();
        return g.getImageData(0, 0, STAR, STAR);
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
                'circle-opacity': dotAlpha(),
                'circle-stroke-opacity': rimAlpha(),
                'circle-stroke-color': rim(color),
                'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', vis, 2, 0.3], 12, ['case', vis, 3.5, 1.2]],
            },
        });
        map.addLayer(layer('st-w2', '#3b6fd8', 'w2'));
        map.addLayer(layer('st-w1', '#f07a1a', 'w1'));
        // 별 크기: 같은 판매점의 동그라미 반지름 × 1.8 이 별 끝까지(별만 보이니 작게 — 2026-10-27 사장님)
        const starSize = ['interpolate', ['linear'], ['zoom'],
            5, ['/', ['*', 1.8, ['+', 1.6, ['*', 0.45, ['sqrt', ['get', 'wt']]]]], SR],
            10, ['/', ['*', 1.8, ['+', 3, ['*', 0.9, ['sqrt', ['get', 'wt']]]]], SR],
            15, ['/', ['*', 1.8, ['+', 5, ['*', 1.0, ['sqrt', ['get', 'wt']]]]], SR]];
        if (!map.hasImage('sm-star')) map.addImage('sm-star', starImage(false), { pixelRatio: 1 });
        if (!map.hasImage('sm-star-glow')) map.addImage('sm-star-glow', starImage('day'), { pixelRatio: 1 });
        if (!map.hasImage('sm-star-glow-n')) map.addImage('sm-star-glow-n', starImage('night'), { pixelRatio: 1 });
        map.addLayer({
            id: 'st-top', type: 'symbol', source: 'stores', filter: ['all', isTop, filterFor('w1')],
            layout: { 'icon-image': 'sm-star', 'icon-size': starSize, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
                'symbol-sort-key': ['-', 0, ['get', 'top']] },   // 순위 높은 별이 위로
            paint: { 'icon-opacity': ['*', STAR_ALPHA, fadeF()] },
        });
        // 별 테두리가 숨 쉬듯 빛난다(2026-10-27 사장님 — 둥근 빛 대신 테두리). 밝기만 천천히 바꾼다(glowLoop)
        map.addLayer({
            id: 'st-top-glow', type: 'symbol', source: 'stores', filter: ['all', isTop, filterFor('w1')],
            layout: { 'icon-image': isNight() ? 'sm-star-glow-n' : 'sm-star-glow', 'icon-size': starSize, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
                'symbol-sort-key': ['-', 0, ['get', 'top']] },
            paint: { 'icon-opacity': glowOpacity(0.7) },
        });
        // TOP 50: 원 · 별 가운데에 1등 횟수(겹치면 순위 높은 곳만)
        map.addLayer({
            id: 'st-num', type: 'symbol', source: 'stores', filter: ['all', isTop, filterFor('w1')],
            layout: { 'text-field': ['to-string', ['get', 'w1']], 'text-font': ['Noto Sans Bold'], 'symbol-sort-key': ['get', 'top'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 5, 8, 9, 11, 14, 13], 'text-padding': 0, 'text-allow-overlap': false },
            paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(150, 60, 0, .55)', 'text-halo-width': 0.7, 'text-opacity': fadeF() },
        });
        ['st-w1', 'st-w2', 'st-top'].forEach(id => {
            map.on('click', id, e => { if (e.features && e.features[0]) open(e.features[0].properties.i, false); });
            map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
        });
        applyLayers();
        glowLoop();
    }
    // 테두리 빛 밝기: 0.35 ~ 1 을 2.8초에 한 번 오간다. 1초에 15번만 바꾸고, 탭이 뒤에 있으면 쉰다(배터리)
    function glowOpacity(a) { return ['*', Math.min(1, a * (isNight() ? 1.15 : 1)), fadeF()]; }
    function glowLoop() {
        let last = 0;
        const tick = now => {
            requestAnimationFrame(tick);
            if (document.hidden || now - last < 66 || !map.getLayer('st-top-glow')) return;
            last = now;
            map.setPaintProperty('st-top-glow', 'icon-opacity', glowOpacity(0.675 + 0.325 * Math.sin(now / 2800 * 2 * Math.PI)));
        };
        requestAnimationFrame(tick);
    }

    // PC 왼쪽 칸의 탭(당근 동네업체처럼 — 2026-10-26). 휴대폰은 탭이 안 보이고 data-tab 도 화면에 영향이 없다
    const side = document.getElementById('sm-side');
    function setTab(t) {
        if (!side.querySelector('.sm-tab[data-tab="' + t + '"]')) return;
        side.dataset.tab = t;
        side.querySelectorAll('.sm-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
        if (t === 'info') document.getElementById('sm-info').open = true;
        if (t === 'fun') document.getElementById('sm-fun').hidden = false;   // site.css 의 [hidden] 이 !important 라 CSS 만으로는 못 연다
    }

    const links = (name, place, lat, lng) => '<p class="sm-links"><a href="https://map.kakao.com/link/map/' + encodeURIComponent(name) + ',' + lat + ',' + lng + '" target="_blank" rel="noopener">' + T('카카오맵', 'Kakao Map') + '</a>' +
        '<a href="https://map.naver.com/p/search/' + encodeURIComponent(name + ' ' + place) + '" target="_blank" rel="noopener">' + T('네이버 지도', 'Naver Map') + '</a></p>';
    function showCard(html, lat, lng, fly) {
        card.dataset.i = '';
        markTop(null);
        card.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' + html;
        card.hidden = false;
        card.querySelector('.sm-close').addEventListener('click', () => { card.hidden = true; markTop(null); });
        if (isWide()) setTab('card');
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
    // 색 고르기(2026-10-26 사장님): 첫 색(빨강)은 누구나. 이용권이 있으면 모든 색 + 아무 색, 없으면 색 하나를 COLOR_COST 포인트로 연다
    //   (서버 /api/me/visit-color — 한 번 연 색은 계속 쓴다, 내 정보 user.visitColors). 이용권 확인은 js/license.js(LottoLicense)
    let paidP = null;
    const paid = () => (paidP = paidP || (() => {
        const L = window.LottoLicense;
        return L && L.savedKey && L.savedKey() ? L.unlockState().then(st => !!(st && st.unlocked)).catch(() => false) : Promise.resolve(false);
    })());
    const COLOR_COST = 30;   // worker POINTS.visitColor 와 같게
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
        const canPick = await paid();
        const meNow = () => (A.me() && A.me().user) || {};
        const opened = c => canPick || c === PALETTE[0] || (meNow().visitColors || []).includes(c);
        const draw = () => {
            if (card.dataset.k !== myCard) return;
            const id = ids && ids[k] && ids[k][i];
            const cur = id ? visits[id] : null;
            box.innerHTML = '<div class="sm-visit-row"><button type="button" class="sm-visit-btn' + (cur ? ' is-on' : '') + '" aria-pressed="' + !!cur + '">' +
                (cur ? '<span class="sm-swatch" style="background:' + cur + '"></span>' + T('다녀온 곳', 'Visited') : T('＋ 다녀왔어요', '＋ I\'ve been here')) + '</button>' +
                (cur ? '<span class="sm-colors">' + PALETTE.map(c => '<button type="button" class="sm-color' + (c === cur ? ' is-on' : '') + (opened(c) ? '' : ' is-locked') + '" data-c="' + c + '" style="background:' + c + '" aria-label="' + c + (opened(c) ? '' : T(' (잠김)', ' (locked)')) + '"></button>').join('') +
                    (canPick ? '<label class="sm-color sm-color-any" title="' + T('다른 색', 'Any colour') + '"><input type="color" value="' + cur + '" aria-label="' + T('다른 색', 'Any colour') + '"></label>' : '') + '</span>' : '') + '</div>' +
                '<p class="sm-visit-note">' + (cur ? (canPick ? T('다시 누르면 지웁니다. 나만 보입니다.', 'Tap again to remove. Only you can see this.')
                    : T('다시 누르면 지웁니다. 🔒 색은 하나에 ' + COLOR_COST + '포인트로 열거나 <a href="statistics.html">이용권</a>으로 모두 엽니다.', 'Tap again to remove. Unlock a 🔒 colour for ' + COLOR_COST + ' points, or all of them with a <a href="statistics.html">pass</a>.'))
                    : T('로그인 회원 기능 · 나만 보입니다(위치는 쓰지 않습니다).', 'Members only · only you can see it (no location used).')) + '</p>';
            box.querySelector('.sm-visit-btn').addEventListener('click', () => save(cur ? null : PALETTE[0]));
            box.querySelectorAll('button.sm-color').forEach(b => b.addEventListener('click', () => {
                const c = b.dataset.c;
                if (opened(c)) { save(c); return; }
                const avail = (meNow().score || {}).avail;
                const note = box.querySelector('.sm-visit-note');
                note.classList.add('is-warn');
                note.innerHTML = T('이 색은 ' + COLOR_COST + '포인트로 열 수 있습니다' + (avail != null ? '(지금 ' + fmt(Math.floor(avail)) + '포인트)' : '') + '. 한 번 열면 계속 씁니다.',
                    'Unlock this colour for ' + COLOR_COST + ' points' + (avail != null ? ' (you have ' + fmt(Math.floor(avail)) + ')' : '') + '. It stays unlocked.') +
                    ' <button type="button" class="sm-unlock"><span class="sm-swatch" style="background:' + c + '"></span>' + T(COLOR_COST + '포인트로 열기', 'Unlock for ' + COLOR_COST) + '</button>' +
                    ' <a href="statistics.html">' + T('이용권 보기', 'See passes') + '</a>';
                note.querySelector('.sm-unlock').addEventListener('click', async e => {
                    e.target.disabled = true;
                    try {
                        await account().call('/api/me/visit-color', { method: 'POST', body: { color: c } });
                        await A.refresh().catch(() => null);
                        if (!opened(c)) (meNow().visitColors = meNow().visitColors || []).push(c);   // 내 정보를 못 받았어도 이 화면에서는 열린 것으로
                        save(c);
                    } catch (err) {
                        note.textContent = (err && err.message) || T('열지 못했습니다.', 'Could not unlock.');
                    }
                });
            }));
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
    function roundList(box, rows) {
        const sec = document.createElement('section');
        box.appendChild(sec);
        if (!rows.length) { sec.innerHTML = '<p class="sm-small">' + T('기록이 없습니다.', 'None.') + '</p>'; return sec; }
        const pages = Math.ceil(rows.length / PER);
        let pg = 0;
        const draw = () => {
            sec.innerHTML = '<ul>' + rows.slice(pg * PER, pg * PER + PER).join('') + '</ul>' +
                (pages > 1 ? '<div class="sm-pager"><button type="button" class="sm-pg" data-d="-1" aria-label="' + T('이전', 'Previous') + '"' + (pg ? '' : ' disabled') + '>‹</button>' +
                    '<span>' + (pg + 1) + ' / ' + pages + '</span><button type="button" class="sm-pg" data-d="1" aria-label="' + T('다음', 'Next') + '"' + (pg < pages - 1 ? '' : ' disabled') + '>›</button></div>' : '');
            sec.querySelectorAll('.sm-pg').forEach(b => b.addEventListener('click', () => { pg = Math.max(0, Math.min(pages - 1, pg + Number(b.dataset.d))); draw(); }));
        };
        draw();
        return sec;
    }
    // 1등 · 2등 나온 회차는 토글로 하나씩만(2026-10-27 사장님 — 카드를 작게, 지도가 보이게). 고른 쪽은 다음 카드에도 이어 간다
    let rankPick = 1;
    function fillRounds(box, rw, draws) {
        const [r1, r2] = rw;
        box.textContent = '';
        const cnt = new Map();
        r2.forEach(r => cnt.set(r, (cnt.get(r) || 0) + 1));
        const bar = document.createElement('div');
        bar.className = 'sm-rk';
        bar.setAttribute('role', 'group');
        bar.innerHTML = [[1, T('1등 나온 회차', '1st-prize draws'), r1.length], [2, T('2등 나온 회차', '2nd-prize draws'), r2.length]]
            .map(([k, t, n]) => '<button type="button" data-k="' + k + '"' + (n ? '' : ' disabled') + '>' + t + ' <b>' + n + '</b></button>').join('');
        box.appendChild(bar);
        const secs = {
            1: roundList(box, r1.map(c => { const how = HOW[c % 4]; return roundRow(Math.floor(c / 4), how ? T(how[0], how[1]) : '', draws); })),
            2: roundList(box, [...cnt].map(([r, n]) => roundRow(r, n > 1 ? '×' + n : '', draws))),
        };
        const show = k => {
            bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.k) === k)));
            secs[1].hidden = k !== 1;
            secs[2].hidden = k !== 2;
        };
        bar.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { rankPick = Number(b.dataset.k); show(rankPick); }));
        show(rankPick === 1 ? (r1.length ? 1 : 2) : (r2.length ? 2 : 1));
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

    // 로그인 회원 기능. 서버에 로그인이 꺼져 있으면 잠그지 않는다(사이트 다른 회원 기능과 같게)
    async function member(reason) {
        const A = window.LottoAccount;
        if (A && A.ready) await A.ready;
        if (A && A.loginOn && A.loginOn() && !A.session()) { A.openLogin(reason); return false; }
        return true;
    }
    // 1등 방식을 바꾸면 점 · 숫자를 다시 센다
    async function toggleMode(b) {
        const k = b.dataset.mode;
        if (!(await member(T('자동 · 수동 나눠 보기는 로그인 회원 기능입니다.', 'Filtering by auto/manual is for signed-in members.')))) return;
        modes[k] = !modes[k];
        b.setAttribute('aria-pressed', String(modes[k]));
        computeProps();
        map.getSource('stores').setData(geojson());
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
                map.setPaintProperty(id, 'circle-opacity', dotAlpha());
                map.setPaintProperty(id, 'circle-stroke-opacity', rimAlpha());
            });
            map.setPaintProperty('st-num', 'text-opacity', fadeF());
            map.setPaintProperty('st-top', 'icon-opacity', ['*', STAR_ALPHA, fadeF()]);
            if (map.getLayer('st-all')) map.setPaintProperty('st-all', 'circle-opacity', 0.7 * Math.max(0, 1 - fadeT));
            applyLayers();
        });
    }

    // ───── 이색 판매점(끝과 끝 · 외딴 곳 …) — 왼쪽 아래 목록 + 지도 위 별 표시. 자료는 store-map-data.json 의 fun(생성기가 계산) ─────
    function openFun(k) {
        const f = (data.fun || [])[k];
        if (!f) return;
        document.getElementById('sm-fun').hidden = true;   // 목록은 접고 아이콘은 그대로 둔다
        map.flyTo({ center: [f.lng, f.lat], zoom: f.zoom, pitch: 0, bearing: 0, padding: pad(), essential: true });
        const [t, i] = f.ref;
        if (t === 'w') open(i, false);
        else if (all) openAll(i, false);
        else { shown.all = true; root.querySelector('.sm-chip[data-layer="all"]').setAttribute('aria-pressed', 'true'); applyLayers(); const wait = () => (all ? openAll(i, false) : setTimeout(wait, 200)); wait(); }
    }
    // 🏆 단추로 켜고 끈다(처음엔 꺼짐 — 2026-10-26 사장님). 켜면 지도 위 아이콘 + 목록, 끄면 둘 다 감춘다
    let funMarkers = null;
    function setFun(on) {
        const btn = document.getElementById('sm-fun-btn'), box = document.getElementById('sm-fun');
        btn.setAttribute('aria-pressed', String(on));
        box.hidden = !on;
        if (on && !funMarkers) {
            funMarkers = data.fun.map((f, k) => {
                const el = document.createElement('button');
                el.type = 'button';
                el.className = 'sm-star';
                el.textContent = f.icon;
                el.title = T(f.title, f.titleEn) + ' — ' + f.name;
                el.setAttribute('aria-label', el.title);
                el.addEventListener('click', e => { e.stopPropagation(); openFun(k); });
                return new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat([f.lng, f.lat]);
            });
        }
        (funMarkers || []).forEach(m => (on ? m.addTo(map) : m.remove()));
    }
    function initFun() {
        const btn = document.getElementById('sm-fun-btn'), box = document.getElementById('sm-fun');
        if (!btn || !data.fun) return;
        btn.addEventListener('click', () => { const on = btn.getAttribute('aria-pressed') !== 'true'; setFun(on); if (on && isWide()) setTab('fun'); });
        box.querySelectorAll('.sm-fun-item').forEach(b => b.addEventListener('click', () => openFun(Number(b.dataset.k))));
    }

    // TOP 50(PC 왼쪽 칸 첫 탭 — 고른 1등 방식 기준, 폐점 제외)
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
        if (z < 13) { keep2d = false; if (auto3d && tilted) { auto3d = false; set3d(false); } return; }
        if (z >= 15 && !tilted && !keep2d) { auto3d = true; set3d(true, true); }
    }

    // 위쪽 도구 · 아래쪽 단추에 가리지 않게 지도를 맞출 때의 여백
    const pad = () => (isWide() ? { top: 40, bottom: 60, left: 30, right: 70 } : { top: (document.querySelector('.sm-top').offsetHeight || 150) + 16, bottom: 60, left: 24, right: 56 });
    function initControls() {
        root.querySelectorAll('.sm-chip[data-layer]').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.layer;
            shown[k] = !shown[k];
            b.setAttribute('aria-pressed', String(shown[k]));
            applyLayers();
            if (k === 'top') topNight(shown.top);
        }));
        const d3 = document.getElementById('sm-3d');
        d3.addEventListener('click', () => {
            const on = d3.getAttribute('aria-pressed') !== 'true';
            auto3d = false;
            keep2d = !on;
            set3d(on);
        });
        document.getElementById('sm-night').addEventListener('click', () => { nightByTop = false; toggleNight(); });
        side.querySelectorAll('.sm-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
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
            if (!isWide()) document.getElementById('sm-info').open = false;
            map.fitBounds([[q(lngs, 0.01), q(lats, 0.01)], [q(lngs, 0.99), q(lats, 0.99)]], { padding: pad(), pitch: 0, bearing: 0 });
            document.getElementById('sm-3d').setAttribute('aria-pressed', 'false');
            document.getElementById('sm-3d').textContent = '3D';
        }));
    }

    async function start() {
        try {
            const res = await fetch(root.dataset.src);
            data = await res.json();
            computeProps();
        } catch (e) { fail(T('판매점 자료를 불러오지 못했습니다. 새로 고쳐 주세요.', 'Could not load the retailer data. Please reload.')); return; }
        mapBox.textContent = '';
        // 링크로 받은 화면이면 그대로 — 지도를 만들면 주소 끝(#map=)을 바로 써 버리므로 그 전에 본다
        const fromLink = /[#&]map=/.test(location.hash);
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
        map.on('load', () => {
            koreanLabels(); whiteModel(); addStores(); nightModel(isNight()); renderTop(); initVisits(); initFun();
            // 이태원로 · 서빙고로 같은 길 이름이 보이는 크기(2026-10-26 사장님) — 용산 둘레
            if (!fromLink) map.jumpTo({ center: [126.985, 37.538], zoom: 12.9, padding: pad() });
            else if (map.getPitch() > 5) { const d3 = document.getElementById('sm-3d'); d3.setAttribute('aria-pressed', 'true'); d3.textContent = '2D'; }   // 기울어진 화면 링크
        });
        map.on('zoomend', autoTilt);
        map.on('error', e => { if (e && e.error && /style|tiles/i.test(String(e.error.message))) console.warn('map', e.error); });
        initControls();
        initSearch();
    }
    start();
})();
