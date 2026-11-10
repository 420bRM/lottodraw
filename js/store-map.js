/* 판매점 지도 (store-map.html, 2026-10-26).
 *
 * 자료: store-map-data.json (tools/build-static-stats.js 가 stores-data.json 으로 매주 만든다)
 *   rows: [위도, 경도, 1등, 2등, 상호, 시도 번호, 시군구, 폐점, 자동, 수동, 반자동]
 * 화면 전체가 지도다(머리글 · 메뉴 없음, 왼쪽 위 "생성기로" 단추 하나). 지도: MapLibre(js/vendor/) + OpenFreeMap "positron" 바탕(키 없음, © OpenStreetMap).
 * 모양(2026-10-26 사장님 결정 — 제안 ② "화이트 모형"): 하얀 땅에 반투명 흰 건물, 색은 판매점 점에만. 줌 15쯤부터 건물이 솟아오르고(높이를 줌에 따라 0 → 실제 높이)
 * 지도도 저절로 기울어진다(13 아래로 나가면 다시 평평하게). 3D 단추는 손으로 기울이기/펴기.
 * 막대 지도는 2026-10-26 뺐다(임팩트가 약하고 보기 불편 — 사장님).
 * 밤 모드: 사이트 낮/밤(data-theme)을 따라 바탕 지도 색을 어둡게 바꾼다(nightModel). 왼쪽 도구의 🌙 단추로도 바꾼다.
 * 점 크기 = 2등 + 1등 × 6 (1등은 2등보다 6배 드물다 — 팔린 양을 짐작하는 값). 1등이 나온 곳은 주황, 2등만 나온 곳은 파랑. TOP 50 은 점 안에 1등 횟수. "TOP 50" 칩을 켜면 TOP 50 만 노란 반짝이 별 + 숨 쉬듯 빛나는 별 테두리로 남는다. 낮/밤은 사이트 값을 따르고, TOP 50 을 켜면 이 화면만 밤으로(끄면 원래대로). 바탕 지도의 도로 번호판은 감춘다.
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
    // 다른 페이지(생성기 · 바닥글 띠 · 메뉴 · 블로그)에서 들어왔으면 첫 화면부터 전환 화면이 덮여 있다(생성기가 <head> 에서 html.sm-enter-hex|store 를 단다 —
    // 2026-11-09 사장님 "생성기에서 맵으로 갈 때도 전환 효과"). 지도가 뜨면 걷는다: 페이지를 연 지 1.1초는 보이고, 늦어도 4초에
    const enterFx = (() => {
        const html = document.documentElement;
        const id = html.classList.contains('sm-enter-hex') ? 'sm-hexfx' : html.classList.contains('sm-enter-store') ? 'sm-storefx' : null;
        if (!id) return () => {};
        let done = false;
        const leave = () => {
            if (done) return;
            done = true;
            const fx = document.getElementById(id);
            setTimeout(() => {
                if (fx) fx.classList.add('is-leave');
                setTimeout(() => { html.classList.remove('sm-enter-hex', 'sm-enter-store'); if (fx) { fx.classList.remove('is-leave'); fx.hidden = true; } }, 450);
            }, Math.max(0, 1100 - performance.now()));
        };
        setTimeout(leave, 4000);
        return leave;
    })();
    const fail = msg => { enterFx(); mapBox.innerHTML = '<p class="sm-loading">' + esc(msg) + '</p>'; };

    if (!window.maplibregl) { fail(T('지도 스크립트를 불러오지 못했습니다. 아래 시도별 표를 봐 주세요.', 'Could not load the map. See the table below.')); return; }
    if (maplibregl.supported && !maplibregl.supported()) { fail(T('이 브라우저에서는 지도를 그릴 수 없습니다(WebGL). 아래 시도별 표를 봐 주세요.', 'This browser cannot draw the map (WebGL). See the table below.')); return; }

    let data = null;      // { sido, rows }
    let all = null;       // 일반 판매점 { sido, rows } — 칩을 켤 때 받는다
    let map = null;
    const shown = { top: false, w1: true, w2: true, closed: false, all: false, mine: false, terr: false };   // terr: 영역(육각 칸, 2026-11-07 시험판)   // mine: 내 기록(다녀온 곳만, 2026-10-27)   // top: TOP 50 만 별로 보기(2026-10-27)
    let terrOnly = false;                          // 영역만 보기(2026-11-08) — 영역을 켰을 때만 뜻이 있다
    // 휴대폰 지도 모드(2026-11-08 사장님 — "LottoHex 랑 지도 기능이 한곳에 모여 불편"): 'store' 판매점 · 'hex' LottoHex(아래 판 + 탭)
    let hexMode = false, terrTab = 'now', sheetSnap = 'peek', sheetNoClick = 0, sheetBefore = null;   // 아래 판은 접힌 채로 시작(2026-11-09 사장님)
    const hexMobile = () => hexMode && !isWide();
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
        if (map.getLayer('st-net')) {
            map.setLayoutProperty('st-net', 'visibility', vis(shown.w1 && !shown.top));
            ['st-net-top', 'st-net-glow'].forEach(id => map.setLayoutProperty(id, 'visibility', vis(shown.top)));
            map.setLayoutProperty('st-net-num', 'visibility', vis(shown.w1 || shown.top));
        }
        names();
        if (map.getLayer('st-all')) map.setLayoutProperty('st-all', 'visibility', shown.all && !shown.top ? 'visible' : 'none');
        else if (shown.all) loadAll();
        mineOnly();
    }
    // 내 기록을 켜면 다른 점 · 별 · 이름은 다 감추고 다녀온 곳만(끄면 applyLayers 가 원래대로 되돌린다).
    // "영역만 보기"(2026-11-08 사장님)를 켜면 다녀온 곳까지 판매점은 다 감추고 영역 칸만
    const OTHER_LAYERS = ['st-w1', 'st-w2', 'st-num', 'st-top', 'st-top-glow', 'st-name', 'st-all', 'st-all-name', 'st-net', 'st-net-top', 'st-net-glow', 'st-net-num', 'st-net-name'];
    function mineOnly() {
        if (!map) return;
        const only = shown.terr && terrOnly, hx = hexMode && shown.terr;   // hx: LottoHex 모드는 원래 판매점 층 대신 hx-* 층(같은 크기 · 필터 없음 · 빛남)
        if (shown.mine || only || hx) OTHER_LAYERS.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });
        ['st-mine', 'st-mine-name'].forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', shown.mine && !only && !hx ? 'visible' : 'none'); });
        HX_LAYERS.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', hx && !only ? 'visible' : 'none'); });
        root.classList.toggle('is-terr-only', only);   // 이색 판매점 별(마커)도 감춘다(CSS)
    }

    // 일반 판매점 층: 처음 켤 때 한 번 받아 1등 · 2등 점 아래에 깐다
    let loadingAll = false;
    async function loadAll() {
        if (loadingAll || !root.dataset.all) return;
        loadingAll = true;
        try { all = await (await fetch(root.dataset.all)).json(); } catch (e) { loadingAll = false; return; }
        map.addSource('all', { type: 'geojson', data: { type: 'FeatureCollection', features: all.rows.map((r, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [r[1], r[0]] }, properties: { i, nm: r[2] } })) } });
        map.addLayer({
            id: 'st-all', type: 'circle', source: 'all',
            layout: { visibility: shown.all ? 'visible' : 'none' },
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['case', vis, 3, 1.2], 10, ['case', vis, 5, 2.6], 15, ['case', vis, 8, 6]],
                'circle-color': ['coalesce', ['feature-state', 'visit'], '#7d8799'], 'circle-opacity': 0.7 * Math.max(0, 1 - fadeT),
                'circle-stroke-color': rim('#7d8799'), 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', vis, 1, 0], 13, ['case', vis, 2, 1]],
            },
        }, 'st-w2');
        map.addLayer({ id: 'st-all-name', type: 'symbol', source: 'all', layout: nameLayout(0.6), paint: namePaint() });
        names();
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
    function nightModel() {
        if (!map || !map.getLayer('st-w1')) return;
        const on = isNight();
        document.getElementById('sm-night').setAttribute('aria-pressed', String(on));
        const N = k => (on ? NIGHT[k] : null);
        for (const l of map.getStyle().layers) {
            const sl = l['source-layer'], id = l.id;
            if (/^(st|terr|rail)-/.test(id)) continue;   // 판매점 점 · 영역 칸 · 역은 제 색 그대로(영역 칸이 땅 색으로 칠해져 밤에 안 보였다 — 2026-11-07). 역은 railPaint
            if (id === 'sm-bld') setP(id, 'fill-extrusion-color', N('extr'));
            else if (id === 'sm-bld-line') setP(id, 'line-color', N('edge'));
            else if (l.type === 'background') setP(id, 'background-color', N('bg'));
            else if (l.type === 'fill') {
                const k = sl === 'water' ? 'water' : sl === 'park' || sl === 'landcover' ? 'park' : sl === 'building' ? 'bld' : 'land';
                setP(id, 'fill-color', N(k));
                // 테두리도 — 바탕 지도(positron)의 건물 층은 테두리 색(밝은 회색)이 따로 있어 밤에 건물이 흰 선으로 떴다(2026-11-10 사장님)
                setP(id, 'fill-outline-color', N(sl === 'building' ? 'edge' : k));
            }
            else if (l.type === 'line') setP(id, 'line-color', N(sl === 'water' || sl === 'waterway' ? 'water' : sl === 'boundary' ? 'border' : /casing/.test(id) ? 'casing' : /rail|transit/.test(id) ? 'rail' : 'road'));
            else if (l.type === 'symbol' && l.layout && l.layout['text-field'] && !isShield(l)) { setP(id, 'text-color', N('text')); setP(id, 'text-halo-color', N('halo')); }
        }
        names();
        railPaint();
        if (map.getLayer('st-top-glow')) map.setLayoutProperty('st-top-glow', 'icon-image', on ? 'sm-star-glow-n' : 'sm-star-glow');
        if (map.getLayer('st-net-glow')) map.setLayoutProperty('st-net-glow', 'icon-image', on ? 'sm-star-glow-red-n' : 'sm-star-glow-red');
        if (map.getLayer('st-net')) map.setPaintProperty('st-net', 'circle-stroke-color', on ? NIGHT.bg : '#fff');
        map.setPaintProperty('st-w1', 'circle-stroke-color', rim('#f07a1a'));
        map.setPaintProperty('st-w2', 'circle-stroke-color', rim('#3b6fd8'));
        if (map.getLayer('st-all')) map.setPaintProperty('st-all', 'circle-stroke-color', rim('#7d8799'));
        if (map.getLayer('terr-name')) map.setPaintProperty('terr-name', 'text-halo-color', on ? 'rgba(10, 14, 22, .9)' : 'rgba(255, 255, 255, .95)');
        if (map.getLayer('terr-sel')) map.setPaintProperty('terr-sel', 'line-color', on ? '#f3f4f6' : '#111827');
        hxColors();
        if (map.getLayer('terr-fill')) { map.setPaintProperty('terr-fill', 'fill-color', greyColor()); map.setPaintProperty('terr-fill', 'fill-opacity', greyFill()); map.setPaintProperty('terr-line', 'line-color', greyColor()); }
        NIGHT_FX.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', terrVis(id) ? 'visible' : 'none'); });
    }
    // 낮/밤은 사이트 값을 따른다(생성기와 같다, 2026-10-27 사장님). 🌙 단추는 사이트 낮/밤 단추(js/theme.js — 지도에서는 감춤)를 대신 누른다 — 저장 · 다른 탭 따라가기는 theme.js 가 한다
    function toggleNight() {
        const tb = document.getElementById('theme-btn');
        if (tb) { tb.click(); return; }
        const dark = !isNight();
        if (dark) document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('lottodraw.theme', dark ? 'dark' : 'light'); } catch (e) { /* 이 페이지에서만 */ }
    }
    // TOP 50 을 켜면 이 화면만 밤으로(2026-10-27 사장님 — 별이 돋보이게). 사이트에 저장된 낮/밤은 건드리지 않고, 끄면 원래대로.
    // 이미 밤이었으면 그대로 두고, 그 사이 🌙 을 손으로 누르면 그 선택을 따른다
    let nightByTop = false;
    function topNight(on) {
        const html = document.documentElement;
        if (on && !isNight()) { nightByTop = true; html.setAttribute('data-theme', 'dark'); }
        else if (!on && nightByTop) { nightByTop = false; html.removeAttribute('data-theme'); }
    }
    new MutationObserver(() => nightModel()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // 북쪽 보기 단추 — "내 위치" 단추 위, 같은 크기. 지도가 돌아간 만큼 바늘도 돈다
    // 전체화면(2026-11-09 사장님 — 휴대폰은 주소창 · 브라우저 도구가 지도를 많이 가린다). 페이지 전체(아래 판 · 카드 · 창 포함)를 전체화면으로.
    // 휴대폰 크기에서만 보이고(css), 브라우저가 지원할 때만 단다 — 아이폰 Safari 는 페이지 전체화면을 지원하지 않아 단추가 없다
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const FS_IN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const FS_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    class FullControl {
        onAdd() {
            this.box = document.createElement('div');
            this.box.className = 'maplibregl-ctrl maplibregl-ctrl-group sm-full-ctrl';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'sm-full-btn';
            const paint = () => {
                const on = !!fsEl();
                b.innerHTML = on ? FS_OUT : FS_IN;
                b.title = on ? T('전체화면 끄기', 'Exit full screen') : T('전체화면으로 보기', 'Full screen');
                b.setAttribute('aria-label', b.title);
                b.setAttribute('aria-pressed', String(on));
            };
            b.addEventListener('click', () => {
                const d = document, el = d.documentElement;
                try {
                    if (fsEl()) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
                    else { const r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {}); }
                } catch (e) { /* 막혀 있으면 그대로 */ }
            });
            ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, paint));
            paint();
            this.box.appendChild(b);
            return this.box;
        }
        onRemove() { this.box.remove(); }
    }
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

    // 축척 막대(2026-10-30 사장님): 2 · 5 · 10 · 20 · 50 · 100 · 200 · 500m · 1 · 2 · 5 · 10 · 20 · 50 · 100km 중
    // 막대가 SCALE_MAX px 를 넘지 않는 가장 큰 값. 화면 가운데 위도로 잰다(기울인 3D 화면에서는 가운데 기준 어림)
    const SCALE_STEPS = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    const SCALE_MAX = 90;
    class ScaleBar {
        onAdd(m) {
            this.m = m;
            this.box = document.createElement('div');
            this.box.className = 'maplibregl-ctrl sm-scale';
            this.box.innerHTML = '<span class="sm-scale-bar"></span><span class="sm-scale-txt"></span>';
            this.up = () => this.draw();
            m.on('move', this.up);
            m.on('resize', this.up);
            this.draw();
            return this.box;
        }
        draw() {
            const m = this.m, lat = m.getCenter().lat;
            const mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, m.getZoom()));   // 1px 이 몇 m
            let step = SCALE_STEPS[0];
            for (const v of SCALE_STEPS) if (v / mpp <= SCALE_MAX) step = v;
            this.box.firstChild.style.width = Math.max(8, Math.round(step / mpp)) + 'px';
            this.box.lastChild.textContent = step >= 1000 ? step / 1000 + 'km' : step + 'm';
        }
        onRemove() { this.m.off('move', this.up); this.m.off('resize', this.up); this.box.remove(); }
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
        props = data.rows.map((r, i) => ({ i, w1: e[i], o1: r[2], w2: r[3], closed: r[7] ? 1 : 0, wt: r[3] + e[i] * 6, top: rank.get(i) || 0, nm: r[4] }));   // nm: 상호(점 · 별 아래 이름표)
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
    function starImage(glow, red) {   // red: "0등" 동행복권 인터넷 판매용 붉은 별
        const c = document.createElement('canvas');
        c.width = c.height = STAR;
        const g = c.getContext('2d'), m = STAR / 2;
        starPath(g, m);
        if (glow) {
            // 테두리 빛: 밝은 선을 흐린 그림자와 함께 여러 번 겹쳐 그린다(겹칠수록 진하다)
            g.lineJoin = 'round';
            // 낮은 금빛(흰 빛은 밝은 바탕에서 별을 흐리게 만들었다), 밤은 흰빛이 도는 노랑
            g.shadowColor = red ? (glow === 'night' ? '#ff7a85' : '#ff2d3f') : glow === 'night' ? '#ffe680' : '#ffae00';
            g.strokeStyle = red ? (glow === 'night' ? '#ffe3e6' : '#ff8a94') : glow === 'night' ? '#fffbe6' : '#ffe14d';
            [[14, 3], [8, 2.4], [3, 1.6]].forEach(([blur, w]) => { g.shadowBlur = blur; g.lineWidth = w; g.stroke(); });
            return g.getImageData(0, 0, STAR, STAR);
        }
        const fill = g.createRadialGradient(m, m, 0, m, m, SR);
        (red ? [[0, '#ffe3e5'], [0.18, '#ff5a68'], [0.6, '#e0283a'], [1, '#a8101f']] : [[0, '#fffbe0'], [0.18, '#ffe45c'], [0.6, '#ffc21a'], [1, '#f0a400']])
            .forEach(([at, c]) => fill.addColorStop(at, c));
        g.fillStyle = fill;
        g.fill();
        g.lineWidth = 2.2;
        g.strokeStyle = red ? '#7a0a14' : '#b97c00';
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
        // 점 · 별 아래 상호 — 화면 안 판매점이 몇 곳 안 될 만큼 줌인했을 때만(names)
        map.addLayer({ id: 'st-name', type: 'symbol', source: 'stores', filter: nameFilter(), layout: nameLayout(1), paint: namePaint() });
        // TOP 50: 원 · 별 가운데에 1등 횟수(겹치면 순위 높은 곳만)
        map.addLayer({
            id: 'st-num', type: 'symbol', source: 'stores', filter: ['all', isTop, filterFor('w1')],
            layout: { 'text-field': ['to-string', ['get', 'w1']], 'text-font': ['Noto Sans Bold'], 'symbol-sort-key': ['get', 'top'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 5, 8, 9, 11, 14, 13], 'text-padding': 0, 'text-allow-overlap': false },
            paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(150, 60, 0, .55)', 'text-halo-width': 0.7, 'text-opacity': fadeF() },
        });
        addNet(radius, starSize);
        ['st-w1', 'st-w2', 'st-top'].forEach(id => {
            map.on('click', id, e => { if (e.features && e.features[0]) open(e.features[0].properties.i, false); });
            map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
        });
        applyLayers();
        glowLoop();
    }
    // ───── 상호 이름표: 화면 안에 보이는 판매점이 몇 곳 이하일 때만(휴대폰 화면 기준 7곳 — 2026-10-27 사장님) ─────
    // TOP 50 별 · 1등 · 2등 원 · 일반 판매점 모두 같은 규칙. 화면이 넓으면 그만큼 늘린다(PC 는 15곳까지). 자료로 센다(그려지기를 기다리지 않는다)
    const nameLimit = () => { const c = map.getContainer(); return Math.min(15, Math.round(7 * Math.max(1, c.clientWidth * c.clientHeight / (390 * 750)))); };
    function nameFilter() {
        if (shown.top) return ['all', isTop, filterFor('w1')];
        const f = [];
        if (shown.w1) f.push(filterFor('w1'));
        if (shown.w2) f.push(filterFor('w2'));
        return f.length ? ['any'].concat(f) : ['==', 1, 0];
    }
    // 이름표는 점(별) 바로 아래 — 점 반지름만큼 내린다(k: 별은 끝이 길어 조금 더)
    const offsetBy = k => ['interpolate', ['linear'], ['zoom'],
        5, ['+', 0.3, ['/', ['*', k, ['+', 1.6, ['*', 0.45, ['sqrt', ['coalesce', ['get', 'wt'], 0]]]]], 12]],
        10, ['+', 0.3, ['/', ['*', k, ['+', 3, ['*', 0.9, ['sqrt', ['coalesce', ['get', 'wt'], 0]]]]], 12]],
        15, ['+', 0.3, ['/', ['*', k, ['+', 5, ['*', 1.0, ['sqrt', ['coalesce', ['get', 'wt'], 0]]]]], 12]]];
    const nameLayout = k => ({ visibility: 'none', 'text-field': ['get', 'nm'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-variable-anchor': ['top'],
        'text-radial-offset': offsetBy(k), 'text-max-width': 9, 'text-padding': 2 });
    const namePaint = () => ({ 'text-color': shown.top ? '#ffe9a8' : isNight() ? '#dfe5ee' : '#2a2f38',
        'text-halo-color': isNight() || shown.top ? 'rgba(10, 14, 22, .9)' : 'rgba(255, 255, 255, .95)', 'text-halo-width': 1.4, 'text-opacity': fadeF() });
    // 지금 화면에 보이는 판매점(근처 찾기도 쓴다). limit 를 넘으면 거기서 멈춘다
    function visibleStores(limit) {
        const b = map.getBounds(), out = [];
        const n = data.net;   // "0등"도 같은 규칙으로 센다(이름표). 근처 판매점 목록 · 지역 이름에서는 뺀다
        if (n && (shown.w1 || shown.top) && b.contains([n.lng, n.lat])) out.push({ t: 'n', lat: n.lat, lng: n.lng });
        for (const p of props) {
            if (shown.top ? !p.top : !((shown.w1 && p.w1 > 0) || (shown.w2 && p.o1 === 0))) continue;
            if ((p.closed && !shown.closed) || p.w1 + 1 - fadeT <= 0) continue;
            const r = data.rows[p.i];
            if (!b.contains([r[1], r[0]])) continue;
            out.push({ t: 'w', i: p.i, lat: r[0], lng: r[1] });
            if (out.length > limit) return out;
        }
        if (all && shown.all && !shown.top && fadeT < 1) {
            for (let i = 0; i < all.rows.length; i++) {
                const r = all.rows[i];
                if (!b.contains([r[1], r[0]])) continue;
                out.push({ t: 'a', i, lat: r[0], lng: r[1] });
                if (out.length > limit) return out;
            }
        }
        return out;
    }
    function names() {
        if (!map || !map.getLayer('st-name')) return;
        const n = visibleStores(nameLimit()).length, on = n > 0 && n <= nameLimit();
        const vis = v => (v ? 'visible' : 'none');
        map.setFilter('st-name', nameFilter());
        map.setLayoutProperty('st-name', 'text-radial-offset', offsetBy(shown.top ? 1.3 : 1));
        map.setLayoutProperty('st-name', 'visibility', vis(on));
        const pt = namePaint();
        ['st-name', 'st-all-name'].forEach(id => { if (map.getLayer(id)) Object.keys(pt).forEach(k => map.setPaintProperty(id, k, pt[k])); });
        if (map.getLayer('st-all-name')) map.setLayoutProperty('st-all-name', 'visibility', vis(on && shown.all && !shown.top));
        if (map.getLayer('st-net-name')) {
            map.setLayoutProperty('st-net-name', 'visibility', vis(on && (shown.w1 || shown.top)));
            map.setLayoutProperty('st-net-name', 'text-radial-offset', offsetBy(shown.top ? 1.3 : 1));
            Object.keys(pt).forEach(k => map.setPaintProperty('st-net-name', k, k === 'text-opacity' ? 1 : pt[k]));
        }
        mineOnly();
    }

    // 테두리 빛 밝기: 0.35 ~ 1 을 2.8초에 한 번 오간다. 1초에 15번만 바꾸고, 탭이 뒤에 있으면 쉰다(배터리)
    function glowOpacity(a) { return ['*', netGlow(a), fadeF()]; }
    // 0등은 1등이 늘 끌기 막대 끝보다 많아 흐려질 일이 없다 — 상수로 둬야 매 프레임 바꿔도 소스를 다시 읽지 않는다
    function netGlow(a) { return Math.min(1, a * (isNight() ? 1.15 : 1)); }
    function glowLoop() {
        let last = 0;
        const tick = now => {
            requestAnimationFrame(tick);
            if (document.hidden || now - last < 66 || !map.getLayer('st-top-glow')) return;
            last = now;
            const v = 0.675 + 0.325 * Math.sin(now / 2800 * 2 * Math.PI);
            map.setPaintProperty('st-top-glow', 'icon-opacity', glowOpacity(v));
            if (shown.top && map.getLayer('st-net-glow')) map.setPaintProperty('st-net-glow', 'icon-opacity', netGlow(v));
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

    // ───── 이 근처 판매점(2026-10-27 사장님 — 당근 "○○동 업체 검색"처럼) ─────
    // 지도 위 가운데 "⟳ ○○구 근처 판매점" 단추 → 지금 화면 안 판매점 목록(보이는 칩 · 1등 방식 · 흐리게 막대를 따른다).
    // "내 위치 기준"을 누르면 브라우저 위치로 옮겨 가까운 순 + 거리. 위치는 이 기기 안에서만 쓰고 서버로 보내지 않는다(위치정보법 — README 4-9)
    let myLoc = null, geo = null, nearAfterMove = false;
    const geoActive = () => !!(geo && geo._watchState && geo._watchState !== 'OFF');   // 내 위치를 받고 있는가(기기 안, 지도를 옮겨도 계속)
    const nearPanel = document.getElementById('sm-near'), nearBtn = document.getElementById('sm-near-btn');
    const NEAR_MAX = 30;
    function distM([lng1, lat1], [lng2, lat2]) {
        const R = 6371000, d = Math.PI / 180, x = Math.sin((lat2 - lat1) * d / 2), y = Math.sin((lng2 - lng1) * d / 2);
        return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(lat1 * d) * Math.cos(lat2 * d) * y * y));
    }
    const fmtDist = m => (m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km');
    // 화면 안 판매점이 가장 많이 있는 시군구(예: "용산구") — 단추 이름
    // 목록에서 가장 많은 지역 "시도 시군구"(예: '서울 노원구'). 화면 글자는 시군구만(guOf)
    function areaKeyOf(list) {
        const cnt = new Map();
        list.forEach(x => {
            const r = x.t === 'w' ? data.rows[x.i] : all.rows[x.i];
            const si = x.t === 'w' ? data.sido[r[5]] : all.sido[r[3]], gu = x.t === 'w' ? r[6] : r[4];
            if (si && gu) { const k = si + ' ' + gu; cnt.set(k, (cnt.get(k) || 0) + 1); }
        });
        let best = '', n = 0;
        cnt.forEach((v, k) => { if (v > n) { best = k; n = v; } });
        return best;
    }
    const guOf = key => key.slice(key.indexOf(' ') + 1);
    const areaOf = list => guOf(areaKeyOf(list));

    // ───── 우리 동네 판매점 지도 공유(2026-10-28 사장님) ─────
    // 주소는 지역 이름만(store-map.html?area=서울+노원구) — 지도 위치(#map=)나 내 위치는 넣지 않는다(위치정보를 보내지 않는다).
    // 받은 사람이 열면 그 시군구의 1 · 2등 판매점이 한 화면에 들어오게 맞추고 근처 판매점 목록을 연다
    const areaUrl = key => location.origin + location.pathname.replace(/store-map-top50\.html$/, 'store-map.html') + '?area=' + encodeURIComponent(key).replace(/%20/g, '+');
    async function shareArea(key, btn) {
        const gu = guOf(key), url = areaUrl(key);
        const title = T(gu + ' 로또 판매점 지도', 'Lotto retailers in ' + gu);
        const text = T(gu + ' 1등 · 2등 나온 판매점을 지도로 봅니다. 어디서 사든 1등 확률은 1/8,145,060으로 같습니다.', '1st- and 2nd-prize retailers in ' + gu + ' on a map. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.');
        if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
        try { await navigator.clipboard.writeText(url); btn.textContent = T('✓ 주소를 복사했습니다', '✓ Link copied'); }
        catch (e) { window.prompt(T('이 주소를 복사해 보내 주세요', 'Copy this link'), url); }
    }
    let areaWant = '';
    function openArea(key) {
        const [si, ...rest] = key.split(' '), gu = rest.join(' ');
        const sIdx = data.sido.indexOf(si);
        const pts = data.rows.filter(r => r[5] === sIdx && r[6] === gu && !r[7]);
        if (!pts.length) return false;
        const b = new maplibregl.LngLatBounds();
        pts.forEach(r => b.extend([r[1], r[0]]));
        nearAfterMove = true;
        areaWant = key;
        // 휴대폰은 아래쪽 목록 칸(화면 38%)에 가리지 않게
        map.fitBounds(b, { padding: isWide() ? pad() : Object.assign(pad(), { bottom: Math.round(window.innerHeight * 0.4) + 16 }), maxZoom: 15, animate: false });
        if (nearAfterMove && !map.isMoving()) { nearAfterMove = false; openNear(); }
        return true;
    }
    function nearLabel() {
        if (!nearBtn) return;
        const gu = map.getZoom() >= 10 ? areaOf(visibleStores(3000).filter(x => x.t !== 'n')) : '';
        nearBtn.querySelector('span').textContent = gu ? T(gu + ' 근처 판매점', 'Retailers around ' + gu) : T('이 근처 판매점', 'Retailers around here');
    }
    function openNear() {
        let list = visibleStores(Infinity).filter(x => x.t !== 'n');
        // 지역 공유 링크로 왔으면 그 지역 판매점만(줌아웃하면 옆 구가 더 많이 잡힌다)
        const key = areaWant || areaKeyOf(list), gu = guOf(key);
        if (areaWant) { list = list.filter(x => areaKeyOf([x]) === areaWant); areaWant = ''; }
        const info = x => {
            if (x.t === 'w') { const r = data.rows[x.i]; return { name: r[4], place: [data.sido[r[5]], r[6]].filter(Boolean).join(' '), w1: props[x.i].w1, w2: r[3] }; }
            const r = all.rows[x.i];
            return { name: r[2], place: [all.sido[r[3]], r[4]].filter(Boolean).join(' '), w1: 0, w2: 0 };
        };
        const ctr = nearFrom ? nearFrom.c : myLoc;   // 지역 찾기로 왔으면 그 지역 중심, 아니면 내 위치에서 가까운 순
        list.forEach(x => { Object.assign(x, info(x)); x.d = ctr ? distM(ctr, [x.lng, x.lat]) : 0; });
        list.sort(ctr ? (a, b) => a.d - b.d : (a, b) => (b.w1 - a.w1) || (b.w2 - a.w2));
        const head = nearFrom ? nearFrom.name : gu;
        nearPanel.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' +
            '<h3>' + esc(head ? T(head + ' 근처 판매점', 'Retailers around ' + head) : T('이 근처 판매점', 'Retailers around here')) + ' <small>' + fmt(list.length) + T('곳', '') + '</small></h3>' +
            (key ? '<p class="sm-near-share"><button type="button" class="sm-share-area">🔗 ' + esc(T(gu + ' 판매점 지도 공유', 'Share the ' + gu + ' map')) + '</button></p>' : '') +
            '<p class="sm-near-sort">' + (nearFrom ? T(nearFrom.name + ' 중심에서 가까운 순', 'Nearest to the centre of ' + nearFrom.name + ' first') : myLoc ? T('내 위치에서 가까운 순', 'Nearest to you first') : T('1등 많은 순', 'Most 1st prizes first')) +
            ' <button type="button" class="sm-near-me">📍 ' + T('내 위치 기준', 'Use my location') + '</button></p>' +
            (list.length ? '<ol class="sm-near-list">' + list.slice(0, NEAR_MAX).map(x => '<li><button type="button" data-t="' + x.t + '" data-i="' + x.i + '"><span class="sm-tname">' + esc(x.name) +
                '<small>' + esc(x.place) + '</small></span><span class="sm-tcnt">' + (x.t === 'w' ? '<b>' + x.w1 + '</b>' + T('번 1등', ' × 1st') + '<small>2' + T('등 ', 'nd ') + x.w2 + '</small>' : '<small>' + T('일반 판매점', 'retailer') + '</small>') +
                (ctr ? '<small class="sm-dist">' + fmtDist(x.d) + '</small>' : '') + '</span></button></li>').join('') + '</ol>' +
                (list.length > NEAR_MAX ? '<p class="sm-small">' + T('외 ' + fmt(list.length - NEAR_MAX) + '곳 — 지도를 더 확대하면 좁혀집니다.', fmt(list.length - NEAR_MAX) + ' more — zoom in to narrow down.') + '</p>' : '')
                : '<p class="sm-small">' + T('이 화면에는 판매점이 없습니다. 지도를 옮기거나 줌아웃해 보세요.', 'No retailers on screen. Move or zoom out.') + '</p>') +
            '<p class="sm-small sm-near-note">' + T('위치는 이 기기 안에서만 쓰고 저장하거나 보내지 않습니다.', 'Your location stays on this device.') + '</p>';
        nearPanel.hidden = false;
        const sb = nearPanel.querySelector('.sm-share-area');
        if (sb) sb.addEventListener('click', () => shareArea(key, sb));
        if (isWide()) setTab('near'); else { card.hidden = true; minePanel.hidden = true; terrPanel.hidden = true; }
        nearPanel.scrollTop = 0;
        nearPanel.querySelector('.sm-close').addEventListener('click', () => { nearPanel.hidden = true; nearFrom = null; if (isWide()) setTab('top'); });
        nearPanel.querySelector('.sm-near-me').addEventListener('click', () => { nearFrom = null; if (!geo) return; if (myLoc && geoActive()) { openNear(); return; } nearAfterMove = true; geo.trigger(); });   // 이미 받고 있으면 끄지 말고 다시 정렬
        nearPanel.querySelectorAll('.sm-near-list button').forEach(b => b.addEventListener('click', () => {
            const i = Number(b.dataset.i);
            if (b.dataset.t === 'w') open(i, true); else openAll(i, true);
        }));
    }
    function placeNearBtn() {
        if (nearBtn) nearBtn.style.top = isWide() ? '' : (document.querySelector('.sm-top').offsetHeight + 14) + 'px';
    }

    const links = (name, place, lat, lng) => '<p class="sm-links"><a href="https://map.kakao.com/link/map/' + encodeURIComponent(name) + ',' + lat + ',' + lng + '" target="_blank" rel="noopener">' + T('카카오맵', 'Kakao Map') + '</a>' +
        '<a href="https://map.naver.com/p/search/' + encodeURIComponent(name + ' ' + place) + '" target="_blank" rel="noopener">' + T('네이버 지도', 'Naver Map') + '</a></p>';
    function showCard(html, lat, lng, fly) {
        card.dataset.i = '';
        markTop(null);
        card.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' + html;
        card.hidden = false;
        if (hexMobile()) { if (sheetSnap !== 'peek') { sheetBefore = sheetSnap; setSheet('peek'); } }   // LottoHex 모드: 판은 접고 카드는 그 위에
        else if (!isWide()) { nearPanel.hidden = true; minePanel.hidden = true; terrPanel.hidden = true; }   // 휴대폰은 카드 하나만
        card.querySelector('.sm-close').addEventListener('click', () => {
            card.hidden = true; markTop(null);
            if (shown.terr && terrOpen && !isWide()) drawTerr();
            if (hexMobile() && sheetBefore) { setSheet(sheetBefore); sheetBefore = null; }
        });
        if (isWide()) setTab('card');
        if (fly) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), padding: pad(), essential: true });
        card.scrollTop = 0;
    }
    // 링크 · 목록 · 검색으로 판매점을 열 때(fly) 그 점이 지금 설정에 가려져 있으면 보이게 푼다(2026-10-30 사장님 — 블로그 '지도에서 보기'로 왔는데
    // 휴대폰 첫 설정 "1등 10회 이상" · 일반 판매점 꺼짐 때문에 그 판매점이 안 보였다). 흐리게 막대는 0, 꺼진 칩은 켜고, TOP 50 만 보기는 끈다
    function reveal(kind, i) {
        const chip = k => root.querySelector('.sm-chip[data-layer="' + k + '"]');
        const on = k => { if (!shown[k]) { shown[k] = true; const c = chip(k); if (c) c.setAttribute('aria-pressed', 'true'); } };
        let changed = false;
        if (shown.top && !(kind === 'w' && props[i] && props[i].top)) { const c = chip('top'); if (c) c.click(); }
        if (kind === 'w') {
            const r = data.rows[i];
            if (fadeT > 0 && props[i].w1 + 1 - fadeT <= 0) { document.getElementById('sm-fade').value = 0; setFade(0); }
            if (r[2] > 0 && !shown.w1) { on('w1'); changed = true; }
            if (r[2] === 0 && !shown.w2) { on('w2'); changed = true; }
            if (r[7] && !shown.closed) { on('closed'); changed = true; }
        } else {
            if (fadeT >= 1) { document.getElementById('sm-fade').value = 0; setFade(0); }
            if (!shown.all) { on('all'); changed = true; }
        }
        if (changed) applyLayers();
    }
    // 일반 판매점 카드
    function openAll(i, fly) {
        if (fly) reveal('a', i);
        const [lat, lng, name, si, gu] = all.rows[i];
        const place = [all.sido[si] || '', gu].filter(Boolean).join(' ');
        showCard('<h3>' + esc(name) + '</h3><p class="sm-place">' + esc(place) + '</p>' +
            '<p class="sm-why">' + T(data.first + '회부터 1등 · 2등 기록이 없는 판매점입니다.', 'No 1st or 2nd prize here since draw ' + data.first + '.') + '</p>' + links(name, place, lat, lng) + '<div class="sm-share-shop" id="sm-share-shop"><button type="button" class="sm-share-btn">🔗 ' + T('해당 판매점 공유하기', 'Share this retailer') + '</button></div>' +
            '<div class="sm-visit" id="sm-visit"></div><div class="sm-cmt" id="sm-cmt"></div>', lat, lng, fly);
        shareUi('a', i, { name, place, w1: 0, w2: 0, sido: all.sido[si] || '' });
        visitUi('a', i);
        commentsUi('a', i);
    }

    // ───── 해당 판매점 공유하기(2026-10-28 사장님) ─────
    // 누르면 이 자리에서 공유 그림(1200×630)을 그려 보여 주고 공유 · 링크 복사 · 그림 저장. 그림은 서버에 올리지 않는다.
    // 링크는 서버의 공유 주소(api…/s/판매점번호) — 카카오톡 · 커뮤니티 미리보기에 판매점 이름 · 횟수가 나오고, 열면 이 카드로 온다(worker/src/share.js).
    // 위치정보가 아니다(판매점은 사업장, 내 위치는 쓰지 않는다)
    const apiBase = () => String((window.PREMIUM_CONFIG && window.PREMIUM_CONFIG.apiBase) || 'https://api.lottodraw.kr').replace(/\/+$/, '');
    const shareTap = () => { try { navigator.sendBeacon(apiBase() + '/api/tap', JSON.stringify({ k: 'shop-share' })); } catch (e) { /* 못 세도 그만 */ } };
    // 배경은 그 판매점 시도의 그림(img/share/sido-*.jpg — 링크 미리보기와 같은 그림, 10-28 사장님: 스파면 서울).
    // 그 그림 왼쪽의 "○○ 로또 판매점" 글자는 아래 하얀 덮개(왼쪽 절반)에 가려진다. 시도를 모르면 남한 전체(img/share-shop-bg.jpg)
    const SIDO_SLUG = { 강원: 'gangwon', 경기: 'gyeonggi', 경남: 'gyeongnam', 경북: 'gyeongbuk', 광주: 'gwangju', 대구: 'daegu', 대전: 'daejeon', 부산: 'busan', 서울: 'seoul',
        세종: 'sejong', 울산: 'ulsan', 인천: 'incheon', 전남: 'jeonnam', 전북: 'jeonbuk', 제주: 'jeju', 충남: 'chungnam', 충북: 'chungbuk' };   // worker/src/share.js 와 같게
    const shareBgs = {};
    const loadShareBg = sido => {
        const src = SIDO_SLUG[sido] ? 'img/share/sido-' + SIDO_SLUG[sido] + '.jpg' : 'img/share-shop-bg.jpg';
        return (shareBgs[src] = shareBgs[src] || new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => { delete shareBgs[src]; no(); }; im.src = src; }));
    };
    // 그림 규칙: 오른쪽 절반에 그 시도 낮 지도(1등 5회 이상 + 2등만 나온 곳 — 지도 공유 이미지 느낌), 왼쪽은 하얗게 덮고 LOTTODRAW.KR · 상호 · 지역 · 1등 · 2등 횟수 · 확률 문구
    async function shareImage(x) {
        const W = 1200, H = 630, c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        const FONT = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
        g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
        try { g.drawImage(await loadShareBg(x.sido), 0, 0, W, H); } catch (e) { /* 배경 없이도 그린다 */ }
        const fade = g.createLinearGradient(0, 0, W, 0);
        fade.addColorStop(0, '#fff'); fade.addColorStop(0.5, '#fff'); fade.addColorStop(0.6, 'rgba(255,255,255,.88)'); fade.addColorStop(0.72, 'rgba(255,255,255,.35)'); fade.addColorStop(0.84, 'rgba(255,255,255,0)');
        g.fillStyle = fade; g.fillRect(0, 0, W, H);
        g.textBaseline = 'alphabetic';
        const L = 84;
        if ('letterSpacing' in g) g.letterSpacing = '6px';
        g.fillStyle = '#3a64a8'; g.font = '700 30px ' + FONT; g.fillText('LOTTODRAW.KR', L, 126);
        if ('letterSpacing' in g) g.letterSpacing = '0px';
        // 상호: 600px 안에 들게 줄이고(최소 52px), 그래도 길면 말줄임
        let size = 96, name = x.name;
        g.font = '900 ' + size + 'px ' + FONT;
        while (size > 52 && g.measureText(name).width > 600) { size -= 4; g.font = '900 ' + size + 'px ' + FONT; }
        while (name.length > 1 && g.measureText(name).width > 600) name = name.slice(0, -2) + '…';
        g.fillStyle = '#003087'; g.fillText(name, L, 258);
        g.fillStyle = '#1d3b70'; g.font = '700 34px ' + FONT; g.fillText(x.place + T(' · 로또 판매점', ' · lotto retailer'), L, 322);
        const chip = (txt, xx, bg, fg) => {
            g.font = '900 38px ' + FONT;
            const w = g.measureText(txt).width + 44;
            g.fillStyle = bg; g.beginPath();
            if (g.roundRect) g.roundRect(xx, 360, w, 66, 16); else g.rect(xx, 360, w, 66);
            g.fill(); g.fillStyle = fg; g.fillText(txt, xx + 22, 407);
            return xx + w + 16;
        };
        if (x.w1 || x.w2) {
            const nx = chip(T('1등 ' + fmt(x.w1) + '번', '1st × ' + fmt(x.w1)), L, '#fff1e4', '#c45a00');
            chip(T('2등 ' + fmt(x.w2) + '번', '2nd × ' + fmt(x.w2)), nx, '#e8f0ff', '#2a5bd7');
        } else chip(T('1등 · 2등 기록 없음', 'No 1st/2nd prize yet'), L, '#eef0f3', '#5d6573');
        g.fillStyle = '#5d6573'; g.font = '500 22px ' + FONT;
        g.fillText(T(data.first + '~' + data.last + '회 기록', 'Draws ' + data.first + '–' + data.last), L, 484);
        g.fillText(T('어디서 사든 1등 확률은 1/8,145,060으로 같습니다', 'Your chance of 1st prize is 1 in 8,145,060 wherever you buy'), L, 518);
        return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
    }
    function shareUi(k, i, x) {
        const box = document.getElementById('sm-share-shop');
        if (!box) return;
        const myCard = card.dataset.s = k + i;
        box.querySelector('.sm-share-btn').addEventListener('click', async () => {
            const old = box.querySelector('.sm-share-panel');
            if (old) { old.remove(); return; }
            const j = await loadIds();
            const id = j && j[k] && j[k][i];
            if (!id || card.dataset.s !== myCard) return;
            const url = apiBase() + '/s/' + id;
            const text = x.name + ' · ' + x.place + '\n' + (x.w1 || x.w2 ? T('1등 ' + fmt(x.w1) + '번 · 2등 ' + fmt(x.w2) + '번', '1st × ' + fmt(x.w1) + ' · 2nd × ' + fmt(x.w2)) + '\n' : '') +
                T('어디서 사든 1등 확률은 1/8,145,060으로 같습니다.', 'Same 1-in-8,145,060 chance wherever you buy.');
            const blob = await shareImage(x);
            if (card.dataset.s !== myCard) return;
            const file = blob && new File([blob], 'lottodraw-' + id + '.jpg', { type: 'image/jpeg' });
            const imgUrl = blob ? URL.createObjectURL(blob) : '';
            const panel = document.createElement('div');
            panel.className = 'sm-share-panel';
            panel.innerHTML = (imgUrl ? '<img alt="" src="' + imgUrl + '">' : '') + '<div class="sm-share-acts">' +
                (navigator.share ? '<button type="button" data-a="share">' + T('공유하기', 'Share') + '</button>' : '') +
                '<button type="button" data-a="copy">' + T('링크 복사', 'Copy link') + '</button>' +
                (imgUrl ? '<a data-a="save" href="' + imgUrl + '" download="lottodraw-' + id + '.jpg">' + T('그림 저장', 'Save image') + '</a>' : '') + '</div>' +
                '<p class="sm-share-msg" role="status"></p>';
            box.appendChild(panel);
            const msg = panel.querySelector('.sm-share-msg');
            panel.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', async () => {
                const a = b.dataset.a;
                if (a === 'save') { shareTap(); return; }
                if (a === 'copy') {
                    try { await navigator.clipboard.writeText(url); msg.textContent = T('링크를 복사했습니다. 붙여 넣으면 이 판매점 미리보기가 나옵니다.', 'Link copied.'); shareTap(); }
                    catch (e) { window.prompt(T('이 주소를 복사해 주세요', 'Copy this link'), url); }
                    return;
                }
                const withFile = file && navigator.canShare && navigator.canShare({ files: [file] });
                try { await navigator.share(withFile ? { files: [file], title: x.name, text: text + '\n' + url } : { title: x.name, text, url }); shareTap(); }
                catch (e) { if (!e || e.name !== 'AbortError') msg.textContent = T('공유하지 못했습니다. 링크 복사를 써 주세요.', 'Could not share. Use Copy link.'); }
            }));
        });
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
    // 내 색 하나(2026-11-08 사장님 — "방문한 곳 색은 고른 하나만"): 다녀온 곳은 모두 이 색. 서버의 user.vc(내 정보 visitColor),
    // 아직 없으면(예전 기록) 가장 최근에 표시한 곳의 색, 그것도 없으면 첫 색. 예전에 곳마다 다른 색으로 표시했어도 화면에서는 이 색 하나로 보인다
    function myVisitColor() {
        const A = account(), u = A && A.me() && A.me().user;
        if (u && u.visitColor) return u.visitColor;
        let best = null, t = -1;
        for (const id of Object.keys(visits)) { const at = visitAt[id] || 0; if (at >= t) { t = at; best = visits[id]; } }
        return best || PALETTE[0];
    }
    const account = () => window.LottoAccount;
    const loadIds = () => (ids ? Promise.resolve(ids) : fetch(root.dataset.ids).then(r => r.json()).then(j => (ids = j)).catch(() => null));
    // 지도 점에 색 입히기(feature-state). 일반 판매점 층은 켤 때 다시 부른다
    const painted = { stores: new Set(), all: new Set(), hexstores: new Set() };
    function paintVisits() {
        if (!ids || !map) return;
        const mc = myVisitColor();   // 다녀온 곳은 모두 내 색 하나
        [['stores', 'w'], ['all', 'a']].forEach(([src, k]) => {
            if (!map.getSource(src)) return;
            painted[src].forEach(i => map.setFeatureState({ source: src, id: i }, { visit: null }));
            painted[src].clear();
            (ids[k] || []).forEach((id, i) => { if (visits[id]) { map.setFeatureState({ source: src, id: i }, { visit: mc }); painted[src].add(i); } });
        });
        if (map.getSource('hexstores')) {   // LottoHex 판매점 층: 1 · 2등 판매점은 그 자리 번호, 일반 판매점은 HX_A + 자리
            const H = painted.hexstores;
            H.forEach(i => map.setFeatureState({ source: 'hexstores', id: i }, { visit: null }));
            H.clear();
            [['w', 0], ['a', HX_A]].forEach(([k, base]) => (ids[k] || []).forEach((id, i) => { if (visits[id]) { map.setFeatureState({ source: 'hexstores', id: base + i }, { visit: mc }); H.add(base + i); } }));
        }
    }
    // 다녀온 곳을 서버에서 새로 받는다(2026-11-07 — 내 기록에 방금 · 다른 기기에서 표시한 곳이 빠져 보였다: 이 탭에 10분 저장해 둔 내 정보를 썼다)
    async function syncVisits() {
        const A = account();
        if (!A || !A.session()) return;
        const m = await A.refresh().catch(() => null);
        if (!m || !m.user) return;
        visits = m.user.visits || {};
        visitAt = m.user.visitAt || {};
        if (ids) paintVisits();
    }
    async function initVisits() {
        const A = account();
        if (!A || !A.ready) return;
        await A.ready;
        if (!A.loginOn() || !A.session()) return;
        const me = A.me();
        visits = (me && me.user && me.user.visits) || {};
        visitAt = (me && me.user && me.user.visitAt) || {};
        if (Object.keys(visits).length && await loadIds()) paintVisits();
    }
    // ───── 내 기록(로그인 회원, 2026-10-27 사장님): 다녀온 곳만 지도에 + 목록, 내가 쓴 댓글, 새 답글 수 ─────
    // 칩 "📍 내 기록"을 켜면 다른 점은 감추고 다녀온 곳만 내 색으로 보인다. 목록은 PC 는 "내 기록" 탭, 휴대폰은 왼쪽 아래 칸
    const minePanel = document.getElementById('sm-mine'), mineChip = document.getElementById('sm-mine-chip');
    let mineTab = 'v', myCmts = null;
    // 판매점 번호 → 지도 자료의 자리 · 이름 · 지역
    function shopOf(id) {
        if (!ids) return null;
        let i = ids.w.indexOf(id);
        if (i >= 0) { const r = data.rows[i]; return { t: 'w', i, name: r[4], place: [data.sido[r[5]], r[6]].filter(Boolean).join(' '), lat: r[0], lng: r[1] }; }
        i = (ids.a || []).indexOf(id);
        if (i >= 0 && all) { const r = all.rows[i]; return { t: 'a', i, name: r[2], place: [all.sido[r[3]], r[4]].filter(Boolean).join(' '), lat: r[0], lng: r[1] }; }
        return null;
    }
    // 다녀온 곳이 일반 판매점이면 그 자료(store-map-all.json)도 있어야 이름 · 자리를 안다
    async function ensureAll() {
        if (all || !ids || !Object.keys(visits).some(id => (ids.a || []).includes(id))) return;
        loadAll();
        for (let k = 0; k < 50 && !all; k++) await new Promise(r => setTimeout(r, 100));
    }
    const mineList = () => { const mc = myVisitColor(); return Object.keys(visits).reverse().map(id => Object.assign({ id, c: mc }, shopOf(id) || {})).filter(x => x.t); };
    function mineSource() {
        const fc = { type: 'FeatureCollection', features: mineList().map(x => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lng, x.lat] }, properties: { t: x.t, i: x.i, c: x.c, nm: x.name } })) };
        if (map.getSource('mine')) { map.getSource('mine').setData(fc); return; }
        map.addSource('mine', { type: 'geojson', data: fc });
        map.addLayer({ id: 'st-mine', type: 'circle', source: 'mine', layout: { visibility: 'none' }, paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 10, 8, 15, 12], 'circle-color': ['get', 'c'],
            'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        map.addLayer({ id: 'st-mine-name', type: 'symbol', source: 'mine', layout: Object.assign(nameLayout(1), { 'text-radial-offset': 1.1 }), paint: Object.assign(namePaint(), { 'text-opacity': 1 }) });
        map.on('click', 'st-mine', e => { const f = e.features && e.features[0]; if (f) (f.properties.t === 'w' ? open : openAll)(f.properties.i, false); });
        map.on('mouseenter', 'st-mine', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'st-mine', () => { map.getCanvas().style.cursor = ''; });
    }
    async function setMine(on) {
        if (on && !(await member(T('내 기록은 로그인 회원 기능입니다.', 'My places is for signed-in members.')))) return;
        shown.mine = on;
        mineChip.setAttribute('aria-pressed', String(on));
        if (!on) { minePanel.hidden = true; if (isWide() && side.dataset.tab === 'mine') setTab('top'); applyLayers(); return; }
        await loadIds();
        await syncVisits();
        await ensureAll();
        mineSource();
        applyLayers();
        const pts = mineList();
        if (pts.length) {
            const b = new maplibregl.LngLatBounds();
            pts.forEach(x => b.extend([x.lng, x.lat]));
            map.fitBounds(b, { padding: pad(), maxZoom: 15, duration: 800 });
        }
        drawMine();
        loadMyComments();
    }
    async function loadMyComments() {
        try { myCmts = (await account().call('/api/me/comments')).comments || []; } catch (e) { myCmts = null; }
        if (shown.mine) drawMine();
    }
    function drawMine() {
        const vs = mineList(), cs = myCmts;
        const me = account() && account().me();
        const unread = (me && me.user && me.user.notes) || 0;
        const tabBtn = (k, label, n) => '<button type="button" data-k="' + k + '" aria-pressed="' + (mineTab === k) + '">' + label + (n != null ? ' <b>' + fmt(n) + '</b>' : '') + '</button>';
        let body;
        if (mineTab === 'v') {
            body = vs.length ? '<ol class="sm-near-list">' + vs.map(x => '<li><button type="button" data-t="' + x.t + '" data-i="' + x.i + '"><span class="sm-tname"><span class="sm-swatch" style="background:' + esc(x.c) + '"></span>' + esc(x.name) +
                '<small>' + esc(x.place) + '</small></span><span class="sm-tcnt">' + (x.t === 'w' ? (data.rows[x.i][2] ? '<b>' + data.rows[x.i][2] + '</b>' + T('번 1등', ' × 1st') : '<small>' + T('2등 ' + data.rows[x.i][3] + '번', data.rows[x.i][3] + ' × 2nd') + '</small>') : '<small>' + T('일반 판매점', 'retailer') + '</small>') + '</span></button></li>').join('') + '</ol>'
                : '<p class="sm-small">' + T('아직 다녀온 곳이 없습니다. 판매점 카드에서 "＋ 다녀왔어요"를 누르면 여기에 모입니다.', 'No places yet. Tap "＋ I\'ve been here" on a retailer card.') + '</p>';
        } else if (!cs) {
            body = '<p class="sm-small">' + T('불러오는 중…', 'Loading…') + '</p>';
        } else {
            body = cs.length ? '<ol class="sm-my-cmts">' + cs.map((c, k) => {
                const shop = /^shop-(\d{8})$/.exec(c.post);
                const where = shop ? (shopOf(shop[1]) || { name: T('판매점', 'Retailer') }).name : T('블로그 · ', 'Blog · ') + c.post;
                return '<li><button type="button" data-k="' + k + '"><span class="sm-tname">' + esc(where) + (c.to ? ' <small class="sm-reply-tag">' + T('답글', 'reply') + '</small>' : '') +
                    '<small>' + cmtTime(c.at) + '</small></span><span class="sm-my-text">' + esc(c.text) + '</span></button></li>';
            }).join('') + '</ol>' : '<p class="sm-small">' + T('아직 쓴 댓글이 없습니다.', 'No comments yet.') + '</p>';
        }
        minePanel.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' +
            '<h3>' + T('내 기록', 'My places') + '</h3>' +
            '<div class="sm-rk sm-mine-tabs" role="group">' + tabBtn('v', T('다녀온 곳', 'Visited'), vs.length) + tabBtn('c', T('내 댓글', 'My comments'), cs ? cs.length : null) + '</div>' +
            (unread ? '<p class="sm-mine-new"><a href="mypage.html#my-notes">' + T('새 답글 ' + fmt(unread) + '개 · 마이페이지에서 보기 →', fmt(unread) + ' new repl' + (unread > 1 ? 'ies' : 'y') + ' · see My page →') + '</a></p>' : '') +
            body + '<p class="sm-small sm-near-note">' + (gpsCfg() ? T('나만 보입니다. 다녀온 곳은 판매점 50m 안에서 위치로 인증한 곳입니다.', 'Only you can see this. Visits are verified by location (within 50 m).') : T('나만 보입니다. 위치는 쓰지 않습니다.', 'Only you can see this. No location used.')) + '</p>' +
            (gpsCfg() && geoAgreed() ? '<p class="sm-small"><button type="button" class="sm-geo-withdraw">' + T('위치 이용 동의 철회', 'Withdraw location consent') + '</button></p>' : '');
        minePanel.hidden = false;
        if (isWide()) setTab('mine'); else { card.hidden = true; nearPanel.hidden = true; terrPanel.hidden = true; }
        minePanel.querySelector('.sm-close').addEventListener('click', () => setMine(false));
        const gw = minePanel.querySelector('.sm-geo-withdraw');
        if (gw) gw.addEventListener('click', geoWithdraw);
        minePanel.querySelectorAll('.sm-mine-tabs button').forEach(b => b.addEventListener('click', () => { mineTab = b.dataset.k; drawMine(); }));
        minePanel.querySelectorAll('.sm-near-list button').forEach(b => b.addEventListener('click', () => (b.dataset.t === 'w' ? open : openAll)(Number(b.dataset.i), true)));
        minePanel.querySelectorAll('.sm-my-cmts button').forEach(b => b.addEventListener('click', () => {
            const c = cs[Number(b.dataset.k)];
            const shop = /^shop-(\d{8})$/.exec(c.post);
            if (!shop) { location.href = 'blog/' + c.post + '.html#comments'; return; }
            const x = shopOf(shop[1]);
            if (x) (x.t === 'w' ? open : openAll)(x.i, true);
        }));
    }
    function initMine() {
        const A = account();
        if (!mineChip || !A || !A.ready) return;
        A.ready.then(() => {
            if (!A.loginOn()) return;
            mineChip.hidden = false;
            const tab = side.querySelector('.sm-tab[data-tab="mine"]');
            if (tab) tab.hidden = false;
            const me = A.me();
            if (me && me.user && me.user.notes) mineChip.classList.add('has-new');
        });
        mineChip.addEventListener('click', () => setMine(!shown.mine));
    }

    // ───── 영역(육각 칸 땅따먹기, 2026-11-07 사장님 — 시험판) ─────
    // 땅을 육각 칸(js/hexgrid.js, 중심에서 꼭짓점까지 0.6km)으로 나누고, 칸마다 "다녀온 곳"이 가장 많은 참여자가 그 칸을 차지한다
    // (같으면 그 칸에 더 최근에 다녀온 사람 — 카드의 "오늘 또 다녀왔어요"로 되찾는다, 같은 곳은 하루 한 번). 칸은 비우지 않고, 분기마다 Map 랭킹만 확정한다(2026-11-07 사장님).
    // 규칙 · 서버는 worker/src/territory.js — /api/territory(누구나, 지난 분기 확정 순위 last 포함), /join · /leave(로그인).
    // 참여는 동의(TERR_V) 뒤에만: 내가 차지한 칸 · Map 랭킹에 별명이 나온다. 어느 판매점을 다녀왔는지는 서버가 내보내지 않는다.
    // 시험판: "다녀왔어요"를 누른 기록만 센다. 위치(GPS)는 쓰지 않는다(위치기반서비스사업 신고 뒤 50m 인증으로 바꾼다)
    // LottoHex 동의 판: 서버가 /api/config 로 알려 준다(위치 인증을 켜면 2 — "위치로 인증한 다녀온 곳을 센다", 2026-11-09)
    const terrV = () => { const A = account(); return (A && A.terrV && A.terrV()) || 1; };
    const gpsCfg = () => { const A = account(); return (A && A.gps && A.gps()) || null; };   // 위치 인증이 켜져 있으면 { geoV, terrV }
    const HX = window.LottoHex;
    const terrPanel = document.getElementById('sm-terr'), terrChip = document.getElementById('sm-terr-chip'), terrOnlyBtn = document.getElementById('sm-terr-only');
    // lottohex.html(2026-11-09 — 검색용 전용 주소)의 정적 안내(무엇 · 하는 법 · 규칙 · 포인트 · 이번 주): 창을 새로 그려도 맨 아래에 다시 붙인다(접은 채)
    const hexAbout = document.getElementById('sm-hexabout');
    let terr = null, terrCells = null, terrSel = null, terrView = 'main', terrLoading = null, visitAt = {};
    let terrOpen = false;   // 영역 창이 열려 있는가 — 창을 닫아도 칸은 지도에 남는다(2026-11-07 사장님)
    // 칸 모양(스킨, 2026-11-07 사장님 — 지렁이 게임처럼 참여자마다 색 · 무늬가 다르게): 서버가 주는 "주색,보조색,무늬"(worker/src/territory.js SKIN_RE).
    // 무늬 0 단색 · 1 줄무늬 · 2 물방울 · 3 체크. 기본은 계정마다 무작위, 바꾸면 SKIN_COST 포인트(무작위로 돌리기는 무료). 모두에게 같게 보인다
    const SKIN_COST = 30;   // worker POINTS.terrSkin 과 같게
    const HEX6 = /^[0-9a-f]{6}$/i;
    function parseSkin(str) {
        const p = String(str || '').split(',');
        const c = HEX6.test(p[0]) ? '#' + p[0].toLowerCase() : '#8a94a6';
        return { c, d: HEX6.test(p[1]) ? '#' + p[1].toLowerCase() : c, p: Math.max(0, Math.min(3, Number(p[2]) || 0)) };
    }
    const skinStr = k => k.c.slice(1) + ',' + k.d.slice(1) + ',' + k.p;
    // 랭킹 · 고르기 화면의 작은 견본(CSS 배경)
    function skinCss(str) {
        const k = parseSkin(str);
        if (k.p === 1) return 'repeating-linear-gradient(45deg,' + k.d + ' 0 3px,' + k.c + ' 3px 6px)';
        if (k.p === 2) return 'radial-gradient(circle,' + k.d + ' 0 34%,transparent 38%) 0 0/7px 7px,' + k.c;
        if (k.p === 3) return 'conic-gradient(' + k.c + ' 0 25%,' + k.d + ' 0 50%,' + k.c + ' 0 75%,' + k.d + ' 0) 0 0/8px 8px';
        return k.c;
    }
    const swatch = (str, cls) => '<span class="sm-skin' + (cls ? ' ' + cls : '') + '" style="background:' + skinCss(str) + '" aria-hidden="true"></span>';
    // 지도 칸을 채우는 무늬 그림(32px, 화면에서는 16px 타일). 모양마다 한 번 만든다
    function skinImage(str) {
        const k = parseSkin(str), id = 'tsk-' + skinStr(k).replace(/,/g, '-');
        if (map.hasImage(id)) return id;
        const S = 32, px = new Uint8Array(S * S * 4);
        const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        const A = rgb(k.c), B = rgb(k.d);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const two = k.p === 1 ? ((x + y) % 16) < 8
                : k.p === 2 ? Math.min(Math.hypot(x - 8, y - 8), Math.hypot(x - 24, y - 24)) < 5.2
                : k.p === 3 ? ((x >> 4) + (y >> 4)) % 2 === 1 : false;
            const c = two ? B : A, o = (y * S + x) * 4;
            px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
        }
        map.addImage(id, { width: S, height: S, data: px }, { pixelRatio: 2 });
        return id;
    }
    // 지금 분기(한국 시간) — 서버 답이 오기 전 랭킹 제목용. 서버의 seasonOf 와 같은 셈
    function seasonNow() {
        const k = new Date(Date.now() + 9 * 3600e3), y = k.getUTCFullYear(), q = Math.floor(k.getUTCMonth() / 3);
        return { from: Date.UTC(y, q * 3, 1) - 9 * 3600e3, to: Date.UTC(y, q * 3 + 3, 1) - 9 * 3600e3, y, q: q + 1 };
    }
    const seasonLabel = s => { const k = new Date(s.to - 1 + 9 * 3600e3); const q = Math.floor(k.getUTCMonth() / 3) + 1; return T(k.getUTCFullYear() + '년 ' + q + '분기', 'Q' + q + ' ' + k.getUTCFullYear()); };
    const seasonEnd = s => { const k = new Date(s.to - 1 + 9 * 3600e3); return (k.getUTCMonth() + 1) + '/' + k.getUTCDate(); };
    const kstDayOf = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
    const MEDAL = ['🥇', '🥈', '🥉'];
    const joinedNow = () => { const A = account(); const u = A && A.me() && A.me().user; return !!(u && u.terr); };
    async function needAll() {
        if (all || !root.dataset.all) return;
        loadAll();
        for (let k = 0; k < 80 && !all; k++) await new Promise(r => setTimeout(r, 100));
    }
    // 칸 → 그 칸의 판매점([종류, 자리]). 서버가 쓰는 store-map-cells.json 과 같은 규칙: 폐점 빼고 1 · 2등 판매점 + 일반 판매점
    function buildCells() {
        if (terrCells || !HX) return;
        terrCells = new Map();
        const put = (lat, lng, x) => { const k = HX.cellOf(lat, lng); if (!terrCells.has(k)) terrCells.set(k, []); terrCells.get(k).push(x); };
        data.rows.forEach((r, i) => { if (!r[7]) put(r[0], r[1], { t: 'w', i }); });
        if (all) all.rows.forEach((r, i) => put(r[0], r[1], { t: 'a', i }));
    }
    async function loadTerr() {
        const A = account();
        const p = (A && A.session() ? A.call('/api/territory') : fetch(apiBase() + '/api/territory').then(r => (r.ok ? r.json() : Promise.reject(new Error('territory')))));
        terrLoading = p;
        try { const r = await p; if (terrLoading === p) terr = r; } catch (e) { if (terrLoading === p) terr = terr || null; }
        if (terrLoading === p) terrLoading = null;
        if (terr && terr.me && terr.me.fresh) { const f = terr.me.fresh; delete terr.me.fresh; afterFresh(f); }
        hexNews();
        turfStatus();
    }
    function terrFeatures() {
        const cells = (terr && terr.cells) || {}, mine = new Set((terr && terr.me && terr.me.cells) || []);
        const polys = [], pts = [], rings = [];
        glintCells = [];
        terrCells.forEach((list, k) => {
            const own = cells[k], me = mine.has(k);
            const sk = own ? parseSkin(own[4]) : null;
            const c = sk ? sk.c : '#8a94a6';
            polys.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [HX.ringOf(k)] }, properties: { k, o: own ? 1 : 0, me: me ? 1 : 0, c, pat: own ? skinImage(own[4]) : '' } });
            if (own) {
                pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: HX.centerOf(k) }, properties: { k, nm: (own[0] || T('(별명 없음)', '(no name)')) + ' · ' + own[1], c } });
                rings.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: HX.ringOf(k).slice().reverse() }, properties: { k } });   // 시계 방향(빛이 도는 차례)
                glintCells.push(glintCell(k));
            }
        });
        return { polys: { type: 'FeatureCollection', features: polys }, pts: { type: 'FeatureCollection', features: pts }, rings: { type: 'FeatureCollection', features: rings } };
    }
    const TERR_LAYERS = ['terr-fill', 'terr-pat', 'terr-glint', 'terr-line', 'terr-sel', 'terr-glow', 'terr-name'];
    // 회색지대(2026-11-08 사장님): 주인 없는 칸은 옅은 회색. 낮은 밝은 지도라 조금 진하게, 밤은 어두운 지도에서 밝은 회색이 옅게 비치게. 멀리서는 더 옅게
    const GREY = () => (isNight() ? '#b4bcc9' : '#8a93a2');
    const greyFill = () => { const g = isNight() ? 0.13 : 0.17; return ['interpolate', ['linear'], ['zoom'], 6, ['case', ['==', ['get', 'o'], 1], 0, g * 0.5], 10, ['case', ['==', ['get', 'o'], 1], 0, g]]; };
    const greyColor = () => ['case', ['==', ['get', 'o'], 1], ['get', 'c'], GREY()];
    // 밤 지도에서 차지한 칸 테두리를 은은한 빛이 시계 방향으로 돈다(2026-11-07 사장님 — 줌 12 이상, 움직임 줄이기 설정이면 끔)
    const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const NIGHT_FX = ['terr-glow', 'terr-glint'];
    const terrVis = id => shown.terr && (!NIGHT_FX.includes(id) || (isNight() && !REDUCED));
    // 밤 지도에서 차지한 칸 면에 유리 반짝임(2026-11-07 사장님 — "유리가 각이 바뀌면서 빛에 비치듯, 45도 방향으로"):
    // 45° 빛줄기(/)가 칸을 왼쪽 위에서 오른쪽 아래로 번쩍 훑고 지나간다. 가운데가 밝고 가장자리는 옅게(겹친 띠 셋) + 뒤따르는 가는 줄 하나.
    // GLINT_CYCLE 마다 한 번, 훑는 데는 GLINT_MS 만(같은 날 사장님 — "좀 빠르게": 처음 4.2초마다 1.4초 → 2.8초마다 0.38초, 더 밝고 가늘게).
    // 칸마다 시작을 대각선 자리만큼 늦춰 빛이 이웃 칸으로 비스듬히 건너간다(이웃 칸까지 0.3초쯤).
    // 띠는 칸 육각형을 두 평행선으로 잘라 그린다(볼록 다각형 자르기) — 화면에 보이는 내 · 남의 차지한 칸만, 1초 30번(테두리 빛은 15번)
    const GLINT_CYCLE = 2800, GLINT_MS = 380, GLINT_SWEEP = GLINT_MS / GLINT_CYCLE;
    const COS0 = Math.cos(36 * Math.PI / 180);   // 경도를 위도와 같은 길이로(북위 36°) — 45° 가 화면에서도 45°
    let glintCells = [];
    function glintCell(k) {
        const ring = HX.ringOf(k).slice(0, 6).map(([lng, lat]) => [lng * COS0, lat]);
        const v = ring.map(p => p[1] - p[0]), c = HX.centerOf(k);
        const d = c[1] - c[0] * COS0;
        return { ring, lo: Math.min(...v), hi: Math.max(...v), c, ph: (((d * 12) % 1) + 1) % 1 };
    }
    // ring 에서 lo ≤ (y - x) ≤ hi 인 부분(볼록 다각형을 두 반평면으로 자른다)
    function clipBand(ring, lo, hi) {
        const cut = (pts, f) => {
            const out = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length], fa = f(a), fb = f(b);
                if (fa >= 0) out.push(a);
                if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
            }
            return out;
        };
        let pts = cut(ring, p => hi - (p[1] - p[0]));
        if (pts.length < 3) return null;
        pts = cut(pts, p => (p[1] - p[0]) - lo);
        if (pts.length < 3) return null;
        const geo = pts.map(([x, y]) => [x / COS0, y]);
        geo.push(geo[0]);
        return geo;
    }
    function glintData(now) {
        const out = [], b = map.getBounds(), m = 0.02;
        const W = b.getWest() - m, E = b.getEast() + m, S = b.getSouth() - m, N = b.getNorth() + m;
        for (const g of glintCells) {
            if (g.c[0] < W || g.c[0] > E || g.c[1] < S || g.c[1] > N) continue;
            const t = ((now / GLINT_CYCLE) + g.ph) % 1;
            if (t > GLINT_SWEEP) continue;
            const u = t / GLINT_SWEEP, span = g.hi - g.lo, w = span * 0.16;
            const mid = g.hi + w - u * (span + 2 * w);   // 띠 가운데: 왼쪽 위(큰 값) → 오른쪽 아래
            const fade = Math.sin(Math.PI * u);           // 들어오고 나갈 때 옅게
            const add = (center, width, a) => { const poly = clipBand(g.ring, center - width / 2, center + width / 2); if (poly) out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [poly] }, properties: { a: +(a * fade).toFixed(3) } }); };
            add(mid, w, 0.12);
            add(mid, w * 0.5, 0.2);
            add(mid, w * 0.18, 0.38);
            add(mid + w * 1.3, w * 0.12, 0.22);          // 뒤따르는 가는 줄(유리 모서리 반사)
        }
        return { type: 'FeatureCollection', features: out };
    }
    function glowGradient(p) {
        const out = ['interpolate', ['linear'], ['line-progress']];
        for (let i = 0; i <= 24; i++) {
            const x = i / 24, d = Math.min(Math.abs(x - p), 1 - Math.abs(x - p)), a = Math.max(0, 1 - d / 0.16);
            out.push(x, 'rgba(255, 244, 214, ' + Math.min(1, 1.1 * a * a).toFixed(3) + ')');   // 빛 한 덩이(둘레의 1/3쯤에 걸쳐 옅어진다)
        }
        return out;
    }
    let glowing = false;
    function terrGlowLoop() {
        if (glowing || REDUCED) return;
        glowing = true;
        let lastGlow = 0, lastGlint = 0, glintEmpty = true;
        const tick = now => {
            requestAnimationFrame(tick);
            if (document.hidden || !map.getLayer('terr-glow') || !terrVis('terr-glow')) return;
            const z = map.getZoom();
            if (z >= 12.5 && now - lastGlow >= 66) { lastGlow = now; map.setPaintProperty('terr-glow', 'line-gradient', glowGradient((now % 6000) / 6000)); }
            if (z >= 11 && now - lastGlint >= 33 && map.getSource('terr-glint')) {
                lastGlint = now;
                const d = glintData(now);
                if (d.features.length || !glintEmpty) map.getSource('terr-glint').setData(d);   // 빛이 없는 동안은 다시 넣지 않는다
                glintEmpty = !d.features.length;
            }
        };
        requestAnimationFrame(tick);
    }
    function drawTerrLayers() {
        if (!map || !terrCells) return;
        const f = terrFeatures();
        if (map.getSource('terr')) {
            map.getSource('terr').setData(f.polys);
            map.getSource('terr-pt').setData(f.pts);
            map.getSource('terr-ring').setData(f.rings);
        } else {
            map.addSource('terr', { type: 'geojson', data: f.polys });
            map.addSource('terr-pt', { type: 'geojson', data: f.pts });
            map.addSource('terr-ring', { type: 'geojson', data: f.rings, lineMetrics: true });
            map.addSource('terr-glint', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            const below = map.getLayer('st-all') ? 'st-all' : 'st-w2';
            // 주인 없는 칸 = 회색지대(옅은 회색), 차지한 칸은 그 사람의 무늬(terr-pat). terr-fill 은 칸 누르기도 받는다
            map.addLayer({ id: 'terr-fill', type: 'fill', source: 'terr', paint: { 'fill-color': greyColor(), 'fill-opacity': greyFill() } }, below);
            map.addLayer({ id: 'terr-pat', type: 'fill', source: 'terr', filter: ['==', ['get', 'o'], 1], paint: {
                'fill-pattern': ['get', 'pat'], 'fill-opacity': ['case', ['==', ['get', 'me'], 1], 0.55, 0.42] } }, below);
            map.addLayer({ id: 'terr-glint', type: 'fill', source: 'terr-glint', minzoom: 11, paint: { 'fill-color': '#fff6dc', 'fill-opacity': ['get', 'a'] } }, below);
            map.addLayer({ id: 'terr-line', type: 'line', source: 'terr', paint: {
                'line-color': greyColor(), 'line-width': ['case', ['==', ['get', 'me'], 1], 1.76, ['==', ['get', 'o'], 1], 1.12, 0.64],   // 2026-11-07 사장님 — 처음보다 0.8배
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, ['case', ['==', ['get', 'o'], 1], 0.8, 0], 10, ['case', ['==', ['get', 'o'], 1], 0.9, 0], 12, ['case', ['==', ['get', 'o'], 1], 0.9, 0.55]] } }, below);   // 회색지대 테두리는 줌 10 부터(칸이 작아 멀리서는 촘촘하다)
            map.addLayer({ id: 'terr-sel', type: 'line', source: 'terr', filter: ['==', ['get', 'k'], ''], paint: { 'line-color': isNight() ? '#f3f4f6' : '#111827', 'line-width': 2.4, 'line-dasharray': [2, 1] } }, below);
            map.addLayer({ id: 'terr-glow', type: 'line', source: 'terr-ring', minzoom: 12.5, layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-width': 5, 'line-blur': 3, 'line-gradient': glowGradient(0) } }, below);
            terrGlowLoop();
            map.addLayer({ id: 'terr-name', type: 'symbol', source: 'terr-pt', minzoom: 11, layout: { 'text-field': ['get', 'nm'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-max-width': 8, 'text-padding': 4 },
                paint: { 'text-color': ['get', 'c'], 'text-halo-color': isNight() ? 'rgba(10, 14, 22, .9)' : 'rgba(255, 255, 255, .95)', 'text-halo-width': 1.6 } });
            map.on('click', 'terr-fill', e => {
                const hits = ['st-w1', 'st-w2', 'st-top', 'st-all', 'st-net', 'st-net-top', 'st-mine', 'hx-dot'].filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
                if (hits.length && map.queryRenderedFeatures(e.point, { layers: hits }).length) return;   // 판매점 점을 누른 것 — 판매점 카드가 열린다
                const ft = e.features && e.features[0];
                if (ft) pickCell(ft.properties.k);
            });
        }
        TERR_LAYERS.forEach(id => map.setLayoutProperty(id, 'visibility', terrVis(id) ? 'visible' : 'none'));
        map.setFilter('terr-sel', ['==', ['get', 'k'], terrSel || '']);
    }
    function pickCell(k) {
        terrSel = k;
        terrView = 'main';
        if (hexMobile()) { terrTab = 'now'; if (sheetSnap === 'peek') setSheet('half'); }
        if (map.getLayer('terr-sel')) map.setFilter('terr-sel', ['==', ['get', 'k'], k]);
        openTerrPanel();
        terrPanel.scrollTop = 0;
        const sb = terrPanel.querySelector('.sm-sheet-body');
        if (sb) sb.scrollTop = 0;
    }
    // 영역 창 열기(칸을 누르거나 칩을 켤 때 · PC 의 "영역" 탭). 휴대폰은 창 하나만
    function openTerrPanel() {
        terrOpen = true;
        if (isWide()) setTab('terr'); else { card.hidden = true; nearPanel.hidden = true; minePanel.hidden = true; }
        drawTerr();
    }
    // 창만 닫기 — 칸은 지도에 그대로(끄려면 칩을 다시 누른다)
    function closeTerrPanel() {
        terrOpen = false;
        terrPanel.hidden = true;
        if (isWide() && side.dataset.tab === 'terr') setTab('top');
    }
    async function setTerr(on) {
        shown.terr = on;
        if (terrChip) terrChip.setAttribute('aria-pressed', String(on));
        if (!on) {
            closeTerrPanel();
            TERR_LAYERS.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });
            if (terrOnly) setTerrOnly(false);
            return;
        }
        terrOpen = true;
        terrPanel.hidden = false;
        const loading = '<p class="sm-small">' + T('LottoHex를 불러오는 중…', 'Loading LottoHex…') + '</p>';
        terrPanel.innerHTML = hexMobile() ? '<div class="sm-sheet-head"><span class="sm-sheet-grip" aria-hidden="true"></span></div><div class="sm-sheet-body">' + loading + '</div>' : loading;
        if (isWide()) setTab('terr'); else { card.hidden = true; nearPanel.hidden = true; minePanel.hidden = true; }
        const A = account();
        await Promise.all([needAll(), loadTerr(), A && A.session() ? loadIds().then(syncVisits) : null, loadTitleCat()]);   // 판매점 번호: 칸 목록의 ✓(다녀온 곳) · 칭호 목록
        if (!shown.terr) return;
        buildCells();
        drawTerrLayers();
        if (hexMode) { ensureHexLayers(); applyLayers(); }
        drawTerr();
        if (hexMobile()) setSheet(sheetSnap);
        if (!flyMine() && map.getZoom() < 10) map.flyTo({ center: map.getCenter(), zoom: 11.5, essential: true });   // 전국을 보고 있으면 칸이 보이는 크기로
        askJoin();
    }
    // LottoHex 에 들어왔을 때 아직 참여 전이면 참여 창을 바로 띄운다(2026-11-09 사장님 — 휴대폰에서 아래 판을 올려야 "참여하기"가 보였다).
    // 이 페이지에서 한 번, "나중에" · ×를 누르면 하루 동안은 저절로 띄우지 않는다(아래 판 "참여하기"는 그대로). 별명이 없으면 띄우지 않는다(참여하기가 별명 창으로)
    const HEX_LATER = 'lottodraw.hex.later';
    let joinAsked = false;
    function askJoin() {
        if (joinAsked || !hexMode || !terr || (terr.me && terr.me.joined)) return;
        const A = account(), u = A && A.session() && A.me() && A.me().user;
        if (!u || !u.nick) return;
        let later = 0;
        try { later = Number(localStorage.getItem(HEX_LATER)) || 0; } catch (e) { /* 이 기기에서만 */ }
        if (Date.now() - later < 86400000) return;
        joinAsked = true;
        const gp = document.getElementById('sm-geo-pop');
        if (gp) gp.hidden = true;   // 위치 동의는 참여 창에 한 줄로 함께
        if (hexMobile()) drawConsent(); else { terrView = 'consent'; drawTerr(); }
    }
    // ───── LottoHex 판매점 층(2026-11-08 사장님 — "당첨 수에 따른 버블 크기를 없애고 일반 판매점과 같은 크기, 필터는 다 풀어 모든 판매점이 보이게, 판매점이 빛나게") ─────
    // LottoHex 에서는 원래 판매점 층(st-*: 1등 횟수 크기 · 칩 · 흐리게 막대 · TOP 50 · 1등 방식)을 감추고, 문을 연 모든 판매점(1 · 2등 + 일반, 폐점 빼고 — 칸이 세는 판매점과 같다)을
    // 일반 판매점 크기의 같은 점으로. 점 밑의 번짐은 세 무리(g)로 나눠 2.4초에 한 번씩 번갈아 밝아진다(움직임 줄이기면 멈춤). 다녀온 곳은 점이 내 색, 테두리 · 번짐은 판매점 색
    const HX_A = 1e6;   // 일반 판매점 점 번호(1 · 2등 판매점 자리 번호와 겹치지 않게)
    const HX_LAYERS = ['hx-glow-0', 'hx-glow-1', 'hx-glow-2', 'hx-dot', 'hx-name'];
    // 색은 원래 지도와 같게(2026-11-08 사장님 — "빛나는 건 좋은데 1등 · 2등 · 일반 색은 유지, 일반은 하얀 계열로 빛나게"): k 1 = 1등 나온 곳(원래 1등 기록, 1등 방식과 무관) · 2 = 2등만 · 0 = 일반.
    // 일반 판매점 빛은 밤엔 흰빛, 낮엔 밝은 바탕에 묻히지 않게 은빛. 판매점이 가장 많아 조금 옅게(색의 투명도)
    const hxDot = () => ['match', ['get', 'k'], 1, '#f07a1a', 2, '#3b6fd8', isNight() ? '#cfd6e0' : '#8a94a6'];
    const hxGlow = () => ['match', ['get', 'k'], 1, isNight() ? '#ff9a3c' : '#ff8a1f', 2, isNight() ? '#6f9dff' : '#4f86ff', isNight() ? 'rgba(255, 255, 255, .72)' : 'rgba(176, 188, 206, .85)'];
    function hexStoreData() {
        const f = [];
        const add = (id, k, lat, lng, nm, t, i) => f.push({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { t, i, nm, k, g: (id + (id >= HX_A ? 1 : 0)) % 3 } });
        data.rows.forEach((r, i) => { if (!r[7]) add(i, r[2] > 0 ? 1 : 2, r[0], r[1], r[4], 'w', i); });
        if (all) all.rows.forEach((r, i) => add(HX_A + i, 0, r[0], r[1], r[2], 'a', i));
        return { type: 'FeatureCollection', features: f };
    }
    let hxAll = false;   // 일반 판매점까지 넣었는가
    function ensureHexLayers() {
        if (!map || !map.getLayer('terr-name')) return;
        if (map.getSource('hexstores')) { if (all && !hxAll) { hxAll = true; map.getSource('hexstores').setData(hexStoreData()); paintVisits(); } return; }
        hxAll = !!all;
        map.addSource('hexstores', { type: 'geojson', data: hexStoreData() });
        const v = ['to-boolean', ['feature-state', 'visit']];
        for (let g = 0; g < 3; g++) map.addLayer({ id: 'hx-glow-' + g, type: 'circle', source: 'hexstores', filter: ['==', ['get', 'g'], g], minzoom: 8, layout: { visibility: 'none' }, paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 11, 10, 15, 20], 'circle-color': hxGlow(), 'circle-blur': 1, 'circle-opacity': 0.5 } }, 'terr-name');
        map.addLayer({ id: 'hx-dot', type: 'circle', source: 'hexstores', layout: { visibility: 'none' }, paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['case', v, 3, 1.2], 10, ['case', v, 5, 2.6], 15, ['case', v, 8, 6]],   // 일반 판매점(st-all)과 같은 크기
            'circle-color': ['coalesce', ['feature-state', 'visit'], hxDot()], 'circle-stroke-color': rim(hxDot()),
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', v, 1, 0], 13, ['case', v, 2, 1]] } }, 'terr-name');
        map.addLayer({ id: 'hx-name', type: 'symbol', source: 'hexstores', minzoom: 15, layout: Object.assign(nameLayout(0.6), { visibility: 'none' }), paint: Object.assign(namePaint(), { 'text-opacity': 1 }) }, 'terr-name');
        map.on('click', 'hx-dot', e => { const p = e.features && e.features[0] && e.features[0].properties; if (p) (p.t === 'w' ? open : openAll)(Number(p.i), false); });
        map.on('mouseenter', 'hx-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'hx-dot', () => { map.getCanvas().style.cursor = ''; });
        paintVisits();
        hxGlowLoop();
    }
    function hxColors() {
        if (!map || !map.getLayer('hx-dot')) return;
        map.setPaintProperty('hx-dot', 'circle-color', ['coalesce', ['feature-state', 'visit'], hxDot()]);
        map.setPaintProperty('hx-dot', 'circle-stroke-color', rim(hxDot()));
        for (let g = 0; g < 3; g++) map.setPaintProperty('hx-glow-' + g, 'circle-color', hxGlow());
        const pt = namePaint();
        ['text-color', 'text-halo-color'].forEach(k => map.setPaintProperty('hx-name', k, pt[k]));
    }
    let hxGlowing = false;
    function hxGlowLoop() {
        if (hxGlowing || REDUCED) return;
        hxGlowing = true;
        let last = 0;
        const tick = now => {
            requestAnimationFrame(tick);
            if (document.hidden || now - last < 66 || !hexMode || !shown.terr || terrOnly || !map.getLayer('hx-glow-0')) return;
            last = now;
            const base = isNight() ? 0.75 : 0.55;
            for (let g = 0; g < 3; g++) map.setPaintProperty('hx-glow-' + g, 'circle-opacity', +(base * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now / 2400 * 2 * Math.PI + g * 2.094)))).toFixed(3));
        };
        requestAnimationFrame(tick);
    }
    // 모드가 바뀔 때 화면 전환(2026-11-08 사장님 — 페이드인으로 "LottoHex" 글자가 나오고 LottoHex 화면으로, "판매점"을 눌러도 전환 효과).
    // LottoHex 는 남색 바탕 · 판매점은 밝은 바탕(뒤집힌 느낌). 전환 화면이 다 덮였을 때 실제로 바꾼다
    const introT = {};
    function modeIntro(kind, then) {
        const fx = document.getElementById(kind === 'hex' ? 'sm-hexfx' : 'sm-storefx');
        document.documentElement.classList.remove('sm-enter-hex', 'sm-enter-store');   // 들어올 때의 전환 화면이 아직 덮여 있으면 바로 걷고 이것만
        if (!fx || REDUCED) { then(); return; }
        ['sm-hexfx', 'sm-storefx'].forEach(x => { const el = document.getElementById(x); if (el && el !== fx) { clearTimeout(introT[x]); el.classList.remove('is-play'); el.hidden = true; } });
        clearTimeout(introT[fx.id]);
        fx.hidden = false;
        fx.classList.remove('is-play'); void fx.offsetWidth; fx.classList.add('is-play');
        setTimeout(then, 280);
        introT[fx.id] = setTimeout(() => { fx.classList.remove('is-play'); fx.hidden = true; }, 1500);
    }
    // LottoHex 는 밤 지도로 시작한다(2026-11-08 사장님 — "반전 효과"). 저장하지 않고 이 화면에서만(TOP 50 의 밤처럼),
    // 판매점으로 돌아오면 되돌린다. LottoHex 중에 🌙 을 직접 누르면 그 뜻을 따른다(되돌리지 않음)
    let nightByHex = false;
    function hexNight(on) {
        const html = document.documentElement;
        if (on && !isNight()) { nightByHex = true; html.setAttribute('data-theme', 'dark'); }
        else if (!on && nightByHex) { nightByHex = false; html.removeAttribute('data-theme'); }
    }
    // ───── 휴대폰 LottoHex 모드: 아래 판(peek 탭만 · half 반 · full 거의 다) ─────
    function sheetPx(snap) {
        const head = terrPanel.querySelector('.sm-sheet-head'), peek = head ? head.offsetHeight : 62;
        const top = (document.querySelector('.sm-top').offsetHeight || 80) + 14;
        return snap === 'peek' ? peek : snap === 'full' ? Math.max(peek, window.innerHeight - top) : Math.round(window.innerHeight * 0.46);
    }
    function applySheet(px) { root.style.setProperty('--sheet-h', Math.round(px) + 'px'); }
    function setSheet(snap) { sheetSnap = snap; if (hexMobile()) applySheet(sheetPx(snap)); }
    const sheetNow = () => { const v = parseFloat(getComputedStyle(root).getPropertyValue('--sheet-h')); return isNaN(v) ? sheetPx(sheetSnap) : v; };
    // 손잡이 · 탭 줄을 위아래로 끌면 판 높이가 따라오고, 놓으면 가까운 높이(빠르게 튕기면 그 방향)로. 판 위의 누르기는 지도로 가지 않는다
    function initSheetDrag() {
        let d = null;
        const move = e => {
            if (!d || e.pointerId !== d.id) return;
            const dy = e.clientY - d.y;
            if (!d.moved) { if (Math.abs(dy) < 6) return; d.moved = true; terrPanel.classList.add('is-drag'); }
            if (e.cancelable) e.preventDefault();
            const now = performance.now();
            d.v = (e.clientY - d.lastY) / Math.max(1, now - d.lastT); d.lastY = e.clientY; d.lastT = now;
            applySheet(Math.min(sheetPx('full'), Math.max(sheetPx('peek'), d.h - dy)));
        };
        const end = e => {
            if (!d || e.pointerId !== d.id) return;
            const m = d; d = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            terrPanel.classList.remove('is-drag');
            if (!m.moved) {   // 손잡이만 톡: 접혀 있으면 펴고, 펴져 있으면 접는다
                if (e.target && e.target.closest && e.target.closest('.sm-sheet-grip')) setSheet(sheetSnap === 'peek' ? 'half' : 'peek');
                return;
            }
            sheetNoClick = Date.now() + 350;
            const h = sheetNow(), snaps = ['peek', 'half', 'full'];
            let pick = snaps.reduce((a, b) => (Math.abs(sheetPx(b) - h) < Math.abs(sheetPx(a) - h) ? b : a));   // 가장 가까운 높이
            if (m.v < -0.5) pick = snaps.find(k => sheetPx(k) > h + 4) || 'full';                       // 위로 튕기면 바로 위 높이
            else if (m.v > 0.5) pick = snaps.slice().reverse().find(k => sheetPx(k) < h - 4) || 'peek';   // 아래로 튕기면 바로 아래 높이
            setSheet(pick);
        };
        // 끄는 동안은 창 전체에서 듣는다(손가락 · 마우스가 판 밖 지도 위로 나가도 따라온다)
        terrPanel.addEventListener('pointerdown', e => {
            if (!hexMobile() || !e.target.closest('.sm-sheet-head')) return;
            d = { y: e.clientY, h: sheetNow(), id: e.pointerId, moved: false, lastY: e.clientY, lastT: performance.now(), v: 0 };
            window.addEventListener('pointermove', move, { passive: false });
            window.addEventListener('pointerup', end);
            window.addEventListener('pointercancel', end);
        });
        window.addEventListener('resize', () => { if (hexMobile()) setSheet(sheetSnap); });
    }
    // 모드 바꾸기. LottoHex 로 가면 판매점 도구(칩 · 검색 · 이 근처 · 이색 · 1등 방식 · 흐리게 · 시도별)는 CSS 가 감추고 칸을 켠다. 판매점으로 오면 칸을 끈다
    // 주소 · 제목도 모드를 따른다(2026-11-09): LottoHex 는 lottohex.html, 판매점은 store-map.html(TOP 50 공유 주소는 그대로) — 새로 고쳐도 같은 화면, 링크로 나눌 수 있다
    function syncModeUrl(on) {
        try {
            const p = location.pathname, file = p.slice(p.lastIndexOf('/') + 1);
            const to = on ? 'lottohex.html' : (file === 'lottohex.html' ? 'store-map.html' : file);
            const q = new URLSearchParams(location.search);
            q.delete('mode');
            const qs = q.toString();
            if (to !== file || /[?&]mode=/.test(location.search)) history.replaceState(history.state, '', p.slice(0, p.lastIndexOf('/') + 1) + to + (qs ? '?' + qs : '') + location.hash);
        } catch (e) { /* 구형 · file:// */ }
        const h1 = root.querySelector('.sm-title');
        if (h1) {   // 화면에는 "LottoHex"만(PC 칸이 좁다), 설명은 글 속에(검색 · 화면 읽기 프로그램)
            const sub = t => 'LottoHex<span class="sr-only"> · ' + t + '</span>';
            h1.innerHTML = on ? T(sub('판매점 땅따먹기'), sub('retailer turf game')) : T('로또 판매점 지도', 'Lotto retailer map');
            h1.setAttribute('data-i18n-en', on ? sub('retailer turf game') : 'Lotto retailer map');
            h1.dataset.i18nKoEn = on ? sub('판매점 땅따먹기') : '로또 판매점 지도';   // i18n.js 가 기억한 한국어 원문도 바꾼다(언어를 바꿔도 이 모드 제목)
        }
        document.title = on ? T('LottoHex · 로또 판매점 땅따먹기 | lottodraw.kr', 'LottoHex · lotto retailer turf game | lottodraw.kr') : T('로또 판매점 지도 | lottodraw.kr', 'Lotto retailer map | lottodraw.kr');
    }
    function setMapMode(m, instant) {
        const on = m === 'hex';
        root.querySelectorAll('[data-mode-to]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modeTo === m)));
        if (on === hexMode) return;
        if (!instant) syncModeUrl(on);   // 처음 열 때(lottohex.html)는 주소 · 제목이 이미 맞다
        const intro = instant ? (k, then) => then() : modeIntro;
        if (!on) {
            intro('store', () => {
                const cp = document.getElementById('sm-consent-pop');
                if (cp) cp.hidden = true;
                terrView = 'main';
                hexMode = false;
                root.classList.remove('is-hex');
                setTerr(false);
                applyLayers();   // 원래 판매점 층(칩 · 흐리게 · TOP 50 · 1등 방식)을 그대로 되돌린다
                hexNight(false);
                placeNearBtn();
            });
            return;
        }
        intro('hex', () => {
            hexMode = true;
            root.classList.add('is-hex');
            hexNight(true);
            if (shown.mine) setMine(false);
            if (root.querySelector('.sm-fun-toggle[aria-pressed="true"]')) setFun(false);
            card.hidden = true; nearPanel.hidden = true;
            terrTab = 'now';
            sheetSnap = 'peek';   // LottoHex 에 들어오면 아래 판은 접힌 채(탭만) — 탭 · 칸 · 위 한 줄을 누르면 반쯤 올라온다(2026-11-09 사장님)
            if (!shown.terr) setTerr(true); else { openTerrPanel(); ensureHexLayers(); applyLayers(); }
            requestAnimationFrame(() => setSheet(sheetSnap));
            placeNearBtn();
        });
    }
    // 영역만 보기: 판매점 점 · 별 · 이름 · 다녀온 곳을 다 감추고 칸만. 영역이 꺼져 있으면 함께 켠다
    function setTerrOnly(on) {
        terrOnly = on;
        root.querySelectorAll('[data-terr-only]').forEach(b => b.setAttribute('aria-pressed', String(on)));   // PC 카드 · 휴대폰 한 줄
        if (on && !shown.terr) setMapMode('hex');
        applyLayers();
    }
    // LottoHex 카드(PC)의 둘째 줄: 불러온 뒤에만 내 칸 · 순위(참여 전이면 참여자 수). 부제는 두지 않는다(2026-11-08 사장님)
    function turfStatus() {
        const el = document.getElementById('sm-turf-stat');
        if (!el || !terr) return;   // 휴대폰 한 줄(.sm-hexbar-txt)도 같은 글
        const me = terr.me;
        const n = newsState === 'pending' && terrNews;
        const txt = (me && me.joined
            ? T('내 칸 ' + fmt(me.cells.length) + ' · ' + (me.rank ? me.rank + '위' : '순위 밖'), 'My cells ' + fmt(me.cells.length) + ' · ' + (me.rank ? '#' + me.rank : 'unranked'))
            : T('참여 ' + fmt(terr.players || 0) + '명 · 칸을 차지해 보세요', fmt(terr.players || 0) + ' players · grab a cell')) +
            (n ? (n.lost.length ? T(' · 칸 ' + n.lost.length + '개 잃음', ' · lost ' + n.lost.length) : '') + (n.won.length ? T(' · ' + n.won.length + '개 얻음', ' · gained ' + n.won.length) : '') : '');
        el.textContent = txt;
        const hb = root.querySelector('.sm-hexbar-txt');
        if (hb) hb.textContent = txt;
    }
    // 내 칸이 있으면 그 칸들이 한 화면에 들어오게
    function flyMine() {
        const mine = (terr && terr.me && terr.me.cells) || [];
        if (!mine.length) return false;
        fitCells(mine);
        return true;
    }
    // 동의 · 참여 뒤 · 다녀온 곳을 바꾼 뒤: 서버 답을 다시 받아 칸 색과 목록을 새로
    let terrTimer = null;
    function refreshTerr() {
        if (!shown.terr) return;
        clearTimeout(terrTimer);
        terrTimer = setTimeout(async () => { await loadTerr(); drawTerrLayers(); drawTerr(); }, 300);
    }
    function terrStoreInfo(x) {
        if (x.t === 'w') { const r = data.rows[x.i]; return { name: r[4], w1: props[x.i].w1, id: ids && ids.w[x.i] }; }
        const r = all.rows[x.i];
        return { name: r[2], w1: 0, id: ids && ids.a && ids.a[x.i] };
    }
    function cellBlock() {
        if (!terrSel || !terrCells) return '';
        const list = (terrCells.get(terrSel) || []).map(x => Object.assign({}, x, terrStoreInfo(x)));
        const own = terr && terr.cells && terr.cells[terrSel];
        const me = terr && terr.me, myN = me && me.counts ? me.counts[terrSel] || 0 : 0, mineCell = me && (me.cells || []).includes(terrSel);
        const been = id => !!(id && visits[id]);
        list.sort((a, b) => (been(b.id) ? 1 : 0) - (been(a.id) ? 1 : 0) || (b.w1 - a.w1));
        // 주인과 같은 수를 채우면 내가 더 최근이라 가져온다. 이미 같은 수면 그 칸 판매점 하나를 "오늘 또 다녀왔어요"
        const need = own && !mineCell ? own[1] - myN : 0;
        const myLine = mineCell ? T(' · 내 칸', ' · mine') : !own ? '' : need > 0 ? T(' · ' + need + '곳 더 다녀오면 차지', ' · ' + need + ' more to take it')
            : T(' · 같은 수 — 이 칸 판매점에 오늘 또 다녀오면 되찾습니다', ' · tied — visit one again today to take it back');
        const where = list.length ? areaOf(list) : '';
        return '<div class="sm-terr-cell"><h4>' + T('고른 칸', 'This cell') + (where ? ' · ' + esc(where) : '') + ' <small>' + T('판매점 ' + fmt(list.length) + '곳', fmt(list.length) + ' retailers') + '</small></h4>' +
            '<p>' + (own ? T('주인 ', 'Held by ') + swatch(own[4]) + ttBadge(own[5]) + '<b>' + esc(own[0] || T('(별명 없음)', '(no name)')) + '</b>' +
                T(' · ' + own[1] + '곳', ' · ' + own[1]) + (own[2] ? T(' (2위 ' + own[2] + '곳)', ' (runner-up ' + own[2] + ')') : '')
                : '<span class="sm-skin sm-skin-grey" aria-hidden="true"></span><b>' + T('회색지대', 'Grey zone') + '</b>' + T(' — 아직 주인이 없는 칸입니다. 이 칸 판매점 한 곳만 다녀와도 차지합니다.', ' — no one holds it yet; one visit takes it.')) + '</p>' +
            (me && me.joined ? '<p class="sm-terr-mine">' + T('나: ' + myN + '곳', 'Me: ' + myN) + myLine + '</p>' : '') +
            (list.length ? '<ol class="sm-near-list sm-terr-stores">' + list.slice(0, 40).map(x => '<li><button type="button" data-t="' + x.t + '" data-i="' + x.i + '"><span class="sm-tname">' +
                (been(x.id) ? '<span class="sm-terr-v" title="' + T('다녀온 곳', 'Visited') + '">✓</span>' : '') + esc(x.name) + '</span><span class="sm-tcnt">' +
                (x.t === 'w' && x.w1 ? '<small>' + x.w1 + T('번 1등', ' × 1st') + '</small>' : '') + '</span></button></li>').join('') + '</ol>' : '') +
            '</div>';
    }
    // ───── LottoHex 할 거리(2026-11-08 사장님 — 다른 세션의 발전안 1 · 2 · 6번) ─────
    // 칸 하나 짚기: 고르고 그 칸이 한 화면에(휴대폰은 아래 창을 비켜서)
    function fitCells(keys) {
        const b = new maplibregl.LngLatBounds();
        keys.forEach(k => HX.ringOf(k).forEach(p => b.extend(p)));
        const bottom = hexMobile() ? sheetNow() + 16 : Math.round(window.innerHeight * 0.4) + 16;
        map.fitBounds(b, { padding: isWide() ? pad() : Object.assign(pad(), { bottom }), maxZoom: 14, duration: 800 });
    }
    function goCell(k) { pickCell(k); fitCells([k]); }
    const cellStores = k => (terrCells && terrCells.get(k)) || [];
    // 칸 이름: 시군구 + 그 칸에서 1등이 가장 많은(없으면 첫) 판매점 — "노원구 · 스파 외 2곳"
    function cellLabel(k) {
        const list = cellStores(k);
        if (!list.length) return { gu: '', shop: '' };
        let best = list[0], bw = -1;
        list.forEach(x => { const w = x.t === 'w' ? props[x.i].w1 : 0; if (w > bw) { best = x; bw = w; } });
        const name = best.t === 'w' ? data.rows[best.i][4] : all.rows[best.i][2];
        return { gu: areaOf(list), shop: list.length > 1 ? T(name + ' 외 ' + (list.length - 1) + '곳', name + ' +' + (list.length - 1)) : name };
    }
    // 한 줄: [칸 모양] 구 · 판매점 / 아랫줄 설명(note). tag 는 오른쪽 짧은 표시(잃음 · 얻음)
    const cellRow = (k, note, cls, sk, tag) => {
        const l = cellLabel(k);
        return '<li' + (cls ? ' class="' + cls + '"' : '') + '><button type="button" data-k="' + esc(k) + '">' + (sk ? swatch(sk) : '<span class="sm-skin sm-skin-grey" aria-hidden="true"></span>') +
            '<span class="sm-tname"><span class="sm-todo-where"><b>' + esc(l.gu || T('(이름 없는 칸)', '(cell)')) + '</b> <small>' + esc(l.shop) + '</small></span>' +
            (note ? '<span class="sm-todo-note">' + note + '</span>' : '') + '</span>' + (tag ? '<span class="sm-todo-tag">' + tag + '</span>' : '') + '</button></li>';
    };
    const HEX_NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
    const nbOf = k => { const [q, r] = k.split(',').map(Number); return HEX_NB.map(([a, b]) => (q + a) + ',' + (r + b)); };
    // 1. 지킬 칸: 2위가 같은 수(또 다녀오기만 해도 넘어감) · 1곳 차이. 노릴 칸: 같은 수(내가 또 다녀오면) · 1곳 더 · 내 칸 옆 회색지대(주인 없는 칸)
    function todoLists(me) {
        const cells = terr.cells || {}, mine = new Set(me.cells), cnt = me.counts || {};
        const keep = me.cells.map(k => ({ k, c: cells[k] })).filter(x => x.c && x.c[2] >= x.c[1] - 1)
            .sort((a, b) => (a.c[1] - a.c[2]) - (b.c[1] - b.c[2]) || a.c[1] - b.c[1]);
        const seen = new Set(), aim = [];
        const consider = k => {
            if (seen.has(k) || mine.has(k)) return;
            seen.add(k);
            const total = cellStores(k).length, my = cnt[k] || 0, c = cells[k];
            if (!total) return;
            if (!c) { if (my === 0) aim.push({ k, need: 1, empty: true }); return; }
            const need = c[1] - my;
            if (need === 0 && my > 0) aim.push({ k, need: 0, c });
            else if (need === 1 && total > my) aim.push({ k, need: 1, c });
        };
        Object.keys(cnt).forEach(consider);
        me.cells.concat(Object.keys(cnt)).forEach(k => nbOf(k).forEach(consider));
        aim.sort((a, b) => a.need - b.need || (a.empty ? 1 : 0) - (b.empty ? 1 : 0));
        lastTodo = { keep: keep.length, hot: keep.filter(x => x.c[2] >= x.c[1]).length, aim: aim.length };
        const MAX = 4, more = (n, key) => (n > MAX ? '<button type="button" class="sm-todo-more" data-more="' + key + '">' + T('+ ' + (n - MAX) + '칸 더 보기', '+ ' + (n - MAX) + ' more') + '</button>' : '');
        const cut = (arr, key) => (todoOpen[key] ? arr : arr.slice(0, MAX));
        const keepNote = x => (x.c[2] >= x.c[1] ? '<b class="is-hot">' + T('같은 수', 'tied') + '</b>' + T(' · 상대가 또 다녀오면 넘어감', ' · a revisit takes it')
            : '<b>' + T('1곳 차이', '1 ahead') + '</b>') + (cellStores(x.k).length > x.c[1] ? T(' — 한 곳 더 다녀오면 지킴', ' — one more visit secures it') : T(' — 오늘 또 다녀오면 지킴', ' — revisit today to hold'));
        const aimNote = x => (x.empty ? T('회색지대 · 한 곳만 다녀오면 차지', 'grey zone · one visit takes it')
            : x.need === 0 ? '<b class="is-hot">' + T('같은 수', 'tied') + '</b>' + T(' · 오늘 또 다녀오면 차지', ' · revisit today to take it')
            : '<b>' + T('1곳 더', '1 more') + '</b>' + T(' 다녀오면 차지', ' visit takes it'));
        return '<div class="sm-terr-todo">' +
            '<h4 class="sm-terr-h">🛡 ' + T('지킬 칸', 'Cells to defend') + ' <small>' + fmt(keep.length) + '</small></h4>' +
            (keep.length ? '<ol class="sm-todo-list">' + cut(keep, 'keep').map(x => cellRow(x.k, keepNote(x), x.c[2] >= x.c[1] ? 'is-hot' : '', x.c[4])).join('') + '</ol>' + more(keep.length, 'keep')
                : '<p class="sm-small">' + T(me.cells.length ? '모든 내 칸이 2곳 이상 앞서 있습니다.' : '아직 내 칸이 없습니다.', me.cells.length ? 'All your cells lead by 2 or more.' : 'You hold no cells yet.') + '</p>') +
            '<h4 class="sm-terr-h">🎯 ' + T('노릴 칸', 'Cells within reach') + ' <small>' + fmt(aim.length) + '</small></h4>' +
            (aim.length ? '<ol class="sm-todo-list">' + cut(aim, 'aim').map(x => cellRow(x.k, aimNote(x), x.need === 0 ? 'is-hot' : '', x.c && x.c[4])).join('') + '</ol>' + more(aim.length, 'aim')
                : '<p class="sm-small">' + T('다녀온 칸과 그 옆에서 한 번에 차지할 칸이 없습니다.', 'Nothing within one visit around your cells.') + '</p>') +
            '</div>';
    }
    const todoOpen = { keep: false, aim: false };
    let lastTodo = { keep: 0, hot: 0, aim: 0 };   // 휴대폰 "할 일" 탭의 빨간 점(같은 수로 쫓기는 내 칸이 있으면)
    // 2. 잃은 칸 · 얻은 칸: 이 기기에 "마지막으로 본 내 칸"(칸 크기 R · 계정과 함께)을 두고 들어올 때 견준다. 서버는 그대로.
    // 누가 · 언제 가져갔는지는 보이지 않는다(생활 반경 · 시간대). 처음이거나 칸 크기가 바뀌었으면 조용히 새로 적는다
    const SEEN_KEY = 'lottodraw.hex.seen';
    let terrNews = null, newsState = null;   // newsState: null(아직 안 견줌) · 'pending'(안 봄) · 'seen'
    const whoKey = () => { const A = account(), u = A && A.me() && A.me().user; let h = 0x811c9dc5; const str = String((u && (u.email || u.nick)) || ''); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
    function readSeen() { try { const j = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); return j && j.who === whoKey() && j.r === HX.R && Array.isArray(j.cells) ? j : null; } catch (e) { return null; } }
    function writeSeen(cells) { try { localStorage.setItem(SEEN_KEY, JSON.stringify({ who: whoKey(), r: HX.R, at: Date.now(), cells })); } catch (e) { /* 저장 못 해도 지도는 된다 */ } }
    function hexNews() {
        const me = terr && terr.me, A = account();
        if (!me || !me.joined || !A || !A.session()) return;
        if (newsState === null) {
            const prev = readSeen(), cur = new Set(me.cells);
            if (prev) {
                const was = new Set(prev.cells), lost = prev.cells.filter(k => !cur.has(k)), won = me.cells.filter(k => !was.has(k));
                if (lost.length || won.length) terrNews = { lost, won, since: prev.at };
            }
            newsState = terrNews ? 'pending' : 'seen';
        }
        if (newsState === 'seen') writeSeen(me.cells);
        newsDots();
    }
    // 새 소식(잃은 칸 · 얻은 칸) 빨간 점: PC 카드 · 휴대폰 모드 단추 · 휴대폰 한 줄
    function newsDots() {
        const on = newsState === 'pending';
        [terrChip, root.querySelector('[data-mode-to="hex"]'), document.getElementById('sm-hexbar-stat')].forEach(b => { if (b) b.classList.toggle('has-new', on); });
    }
    function newsBlock() {
        if (!terrNews) return '';
        const n = terrNews, d = new Date(n.since + 9 * 3600e3);
        const when = (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
        const head = T('지난번(' + when + ') 뒤로 ' + [n.lost.length ? '칸 ' + n.lost.length + '개를 잃었' : '', n.won.length ? (n.lost.length ? '고 ' : '칸 ') + n.won.length + '개를 얻었' : ''].join('') + '습니다.',
            'Since ' + when + ': ' + [n.lost.length ? 'lost ' + n.lost.length : '', n.won.length ? 'gained ' + n.won.length : ''].filter(Boolean).join(', ') + ' cell(s).');
        if (newsState === 'pending') { newsState = 'seen'; writeSeen(terr.me.cells); newsDots(); turfStatus(); }
        return '<div class="sm-terr-news" role="status"><p><b>' + head + '</b> <button type="button" class="sm-news-ok">' + T('확인', 'OK') + '</button></p>' +
            '<ol class="sm-todo-list">' + n.lost.map(k => cellRow(k, '', 'is-lost', null, '<b class="is-hot">' + T('잃음', 'lost') + '</b>')).join('') + n.won.map(k => cellRow(k, '', 'is-won', (terr.cells[k] || [])[4], '<b class="is-won">' + T('얻음', 'gained') + '</b>')).join('') + '</ol>' +
            '<p class="sm-small">' + T('폐점 · 칸 목록이 바뀌어 빠진 칸도 잃은 칸으로 나옵니다.', 'Cells dropped because a retailer closed also show as lost.') + '</p></div>';
    }
    // ───── 마일스톤 · 칭호(2026-11-09 사장님 — worker/src/titles.js) ─────
    // 마일스톤 = "얼마나"(쌓이는 숫자의 단계, 단계마다 포인트, 나만 봄 — "할 일" 탭), 칭호 = "어떻게"(이름 붙은 업적, 칭호 도감에 모으고 하나를 골라 별명 앞에 단다 — "도감" 탭).
    // 목록은 서버(/api/titles, 숨은 칭호는 얻기 전까지 이름 · 조건 없이)에서, 얻은 것은 내 정보(user.titles · user.ach)에서. 셈은 서버가 한다 — 여기 진행률은 보여 주기만
    let titleCat = null, titleCatP = null;
    function loadTitleCat() {
        if (!titleCatP) titleCatP = fetch(apiBase() + '/api/titles').then(r => (r.ok ? r.json() : null)).catch(() => null)
            .then(j => { titleCat = j && Array.isArray(j.titles) && Array.isArray(j.milestones) ? j : null; return titleCat; });   // 모양이 다르면 칭호 · 마일스톤 칸을 그리지 않는다
        return titleCatP;
    }
    const ttName = tt => (tt ? T(tt[0], tt[1]) : '');
    const ttBadge = tt => (tt ? '<span class="sm-ttl">' + esc(ttName(tt)) + '</span>' : '');
    const TTL_GROUPS = () => [['visit', '🧭 ' + T('방문', 'Visits')], ['terr', '🚩 ' + T('영토', 'Territory')], ['shape', '⬡ ' + T('칸 모양', 'Shapes')], ['area', '📍 ' + T('지역', 'Regions')], ['hidden', '❔ ' + T('숨은 칭호', 'Hidden')]];
    // 내 다녀온 곳의 셈(진행률용): 판매점 수 · 칸 · 시·도 · 지역(시·군·구 — 서버의 store-map-geo.json 과 같은 규칙: 주소 첫 낱말, 여러 시·도에 있는 이름은 시·도를 붙임)
    let regionOf = null;
    function myCounts() {
        const out = { v: Object.keys(visits).length, c: 0, s: 0, regions: new Map() };
        if (!ids) return out;
        const guOf = (si, gu) => String(gu || '').trim().split(/\s+/)[0] || si;
        if (!regionOf) {
            const rows = [];
            data.rows.forEach((r, i) => { if (!r[7] && ids.w[i]) rows.push([ids.w[i], data.sido[r[5]] || '', r[6]]); });
            if (all && ids.a) all.rows.forEach((r, i) => { if (ids.a[i]) rows.push([ids.a[i], all.sido[r[3]] || '', r[4]]); });
            const sidoOf = new Map();
            rows.forEach(([, si, gu]) => { const g = guOf(si, gu); if (!sidoOf.has(g)) sidoOf.set(g, new Set()); sidoOf.get(g).add(si); });
            regionOf = new Map(rows.map(([id, si, gu]) => { const g = guOf(si, gu); return [id, [si, g === si ? si : sidoOf.get(g).size > 1 ? si + ' ' + g : g]]; }));
            if (!all) regionOf.partial = true;   // 일반 판매점을 아직 안 받았으면 다시 만든다
        }
        const sido = new Set(), cells = new Set(), idCell = new Map();
        if (terrCells) terrCells.forEach((list, k) => list.forEach(x => { const id = x.t === 'w' ? ids.w[x.i] : ids.a && ids.a[x.i]; if (id) idCell.set(id, k); }));
        for (const id of Object.keys(visits)) {
            const rg = regionOf.get(id);
            if (rg) { sido.add(rg[0]); out.regions.set(rg[1], (out.regions.get(rg[1]) || 0) + 1); }
            if (idCell.has(id)) cells.add(idCell.get(id));
        }
        if (regionOf.partial && all) regionOf = null;
        out.c = cells.size; out.s = sido.size;
        return out;
    }
    function milestoneBlock() {
        const A = account(), u = A && A.me() && A.me().user;
        if (!titleCat || !u || !gpsCfg()) return '';
        const ach = u.ach || {}, cnt = myCounts(), held = (terr && terr.me && terr.me.cells) ? terr.me.cells.length : 0;
        const val = { v: cnt.v, c: cnt.c, s: cnt.s, t: held };
        const unit = m => T(m.u[0], m.u[1]);
        const rows = titleCat.milestones.map(m => {
            const done = Math.max(ach[m.k] || 0, m.steps.filter(x => val[m.k] >= x).length);
            const fin = done >= m.steps.length, next = fin ? m.steps[m.steps.length - 1] : m.steps[done];
            const pct = Math.min(100, Math.round(val[m.k] / next * 100));
            return '<li><p><b>' + T(m.ko, m.en) + '</b> <span class="sm-ms-step">' + T(done + ' / ' + m.steps.length + '단계', 'step ' + done + ' / ' + m.steps.length) + '</span></p>' +
                '<span class="sm-dex-bar"><i style="width:' + (fin ? 100 : Math.max(val[m.k] ? 3 : 0, pct)) + '%"></i></span>' +
                '<p class="sm-small">' + (fin ? T('모든 단계를 이뤘습니다 🎉', 'All steps done 🎉')
                    : T('다음 ' + fmt(next) + unit(m) + ' · 지금 ' + fmt(val[m.k]) + unit(m) + ' · <b>+' + m.pts[done] + 'P</b>', 'Next ' + fmt(next) + ' · now ' + fmt(val[m.k]) + ' · <b>+' + m.pts[done] + 'P</b>')) +
                (m.k === 't' ? T(' (지금 차지한 칸)', ' (cells held now)') : '') + '</p></li>';
        }).join('');
        return '<div class="sm-ms"><h4 class="sm-terr-h">🏁 ' + T('마일스톤', 'Milestones') + ' <small>' + T('단계마다 포인트', 'points at each step') + '</small></h4><ul class="sm-ms-list">' + rows + '</ul>' +
            '<p class="sm-small">' + T('위치로 인증한 다녀온 곳으로 셉니다. 이룬 단계와 받은 포인트는 다녀온 곳을 지워도 그대로입니다.', 'Counted from places verified by location. Steps reached and points earned stay even if you remove a place.') + '</p></div>';
    }
    function titleDex() {
        const A = account(), u = A && A.me() && A.me().user;
        if (!titleCat || !u || !gpsCfg()) return '';
        const my = u.titles || { e: [], sel: null }, got = new Map(my.e.map(t => [t.id, t]));
        const fixed = titleCat.titles, nGot = fixed.filter(t => got.has(t.id)).length;
        const areaGot = my.e.filter(t => /^[rs]:/.test(t.id));
        const item = (id, name, cond, cls) => (got.has(id)
            ? '<button type="button" class="sm-ttl-item is-on' + (my.sel === id ? ' is-sel' : '') + '" data-ttl="' + esc(id) + '" aria-pressed="' + (my.sel === id) + '"><b>' + esc(name) + '</b><small>' + esc(cond) + '</small></button>'
            : '<div class="sm-ttl-item' + (cls ? ' ' + cls : '') + '"><b>' + esc(name) + '</b><small>' + esc(cond) + '</small></div>');
        const cond = d => (d ? T(d[0], d[1]) : '');
        const groups = TTL_GROUPS().map(([g, label]) => {
            let items = fixed.filter(t => t.g === g).map(t => {
                const mine = got.get(t.id);
                if (t.g === 'hidden') return mine ? item(t.id, T(mine.ko, mine.en), cond(mine.d)) : item(t.id, '???', T('조건을 찾아보세요', 'Find the condition'), 'is-hidden');
                return item(t.id, T(t.ko, t.en), cond(t.d));
            }).join('');
            if (g === 'area') {
                items += areaGot.map(t => item(t.id, T(t.ko, t.en), /^s:/.test(t.id) ? T('그 시·도의 모든 시·군·구에서 인증', 'Every district of the province') : T('같은 시·군·구에서 인증', 'Verified in one district'))).join('');
                // 다음 지역 칭호까지(가장 가까운 세 곳)
                const st = titleCat.area.steps, nm = titleCat.area.names;
                const near = [...myCounts().regions.entries()].map(([r, n]) => { const k = st.findIndex(x => n < x); return k < 0 ? null : { r, n, k, need: st[k] }; }).filter(Boolean)
                    .sort((a, b) => (a.need - a.n) - (b.need - b.n)).slice(0, 3);
                if (near.length) items += '<p class="sm-small sm-ttl-next">' + near.map(x => T(esc(x.r) + ' ' + x.n + '/' + x.need + '곳 → ' + esc(x.r) + ' ' + nm[x.k][0], esc(x.r) + ' ' + x.n + '/' + x.need + ' → ' + nm[x.k][1])).join('<br>') + '</p>';
            }
            return '<h5 class="sm-ttl-g">' + label + '</h5><div class="sm-ttl-grid">' + items + '</div>';
        }).join('');
        const sel = my.sel && got.get(my.sel);
        return '<div class="sm-ttldex"><h4 class="sm-terr-h">🏅 ' + T('칭호 도감', 'Titles') + ' <small>' + T(nGot + ' / ' + fixed.length + (areaGot.length ? ' · 지역 칭호 ' + areaGot.length : ''), nGot + ' / ' + fixed.length + (areaGot.length ? ' · regional ' + areaGot.length : '')) + '</small></h4>' +
            '<p class="sm-ttl-cur">' + (sel ? T('단 칭호 ', 'Wearing ') + '<span class="sm-ttl">' + esc(T(sel.ko, sel.en)) + '</span> <button type="button" class="sm-ttl-off">' + T('떼기', 'Remove') + '</button>'
                : T('얻은 칭호를 누르면 별명 앞에 달립니다(LottoHex 랭킹 · 칸 · 랭킹 페이지).', 'Tap a title you have earned to show it before your nickname.')) + '</p>' +
            groups + '<p class="sm-terr-msg sm-ttl-msg" role="status"></p></div>';
    }
    async function pickTitle(id) {
        const A = account();
        try {
            const r = await A.call('/api/me/title', { method: 'POST', body: { id } });
            if (A.patchUser && r.user) A.patchUser({ titles: r.user.titles });
            await loadTerr(); drawTerrLayers(); drawTerr();
        } catch (e) { const m = terrPanel.querySelector('.sm-ttl-msg'); if (m) m.textContent = (e && e.message) || T('바꾸지 못했습니다.', 'Could not change.'); }
    }
    // 새로 얻은 칭호 · 마일스톤 알림(인증 · LottoHex 를 열 때 서버가 알려 준다)
    function freshText(f) {
        if (!f || (!f.titles.length && !f.pts)) return '';
        return [f.titles.length ? T('🏅 새 칭호: ', '🏅 New title: ') + f.titles.map(t => T(t.ko, t.en)).join(', ') : '', f.pts ? T('🏁 마일스톤 +' + f.pts + 'P', '🏁 Milestone +' + f.pts + 'P') : ''].filter(Boolean).join(' · ');
    }
    // 새로 얻은 것: 화면 위 알림(6초, 누르면 닫힘) + 내 정보(칭호 · 포인트)를 새로
    function toast(msg) {
        if (!msg) return;
        let t = document.getElementById('sm-toast');
        if (!t) {
            t = document.createElement('div'); t.id = 'sm-toast'; t.className = 'sm-toast'; t.setAttribute('role', 'status'); root.appendChild(t);
            t.addEventListener('click', () => { t.classList.remove('is-on'); });
        }
        t.textContent = msg;
        t.classList.add('is-on');
        clearTimeout(t.tm);
        t.tm = setTimeout(() => t.classList.remove('is-on'), 6000);
    }
    async function afterFresh(f) {
        const A = account();
        if (!f || !A) return;
        toast(freshText(f));
        await A.refresh().catch(() => null);
        if (shown.terr && terrOpen) drawTerr();
    }

    // 6. 칸 도감: 다녀온 곳이 있는 칸 / 전국 칸(폐점 빼고 판매점이 있는 칸). 시 · 도는 칸 안 판매점의 다수결. 참여하지 않은 회원도 본다
    let cellSido = null;
    const DEX_BADGES = [10, 50, 100];   // 칭호 목록을 받으면 마일스톤 "다녀온 칸" 단계로(dexSteps)
    const dexSteps = () => { const m = titleCat && titleCat.milestones.find(x => x.k === 'c'); return m ? m.steps : DEX_BADGES; };
    function dexBlock() {
        if (!terrCells || !ids || !Object.keys(visits).length) return '';
        if (!cellSido) { cellSido = new Map(); terrCells.forEach((list, k) => cellSido.set(k, (areaKeyOf(list).split(' ')[0]) || '')); }
        const idOf = x => (x.t === 'w' ? ids.w[x.i] : ids.a && ids.a[x.i]);
        const tot = new Map(), got = new Map();
        let n = 0;
        terrCells.forEach((list, k) => {
            const si = cellSido.get(k);
            tot.set(si, (tot.get(si) || 0) + 1);
            if (list.some(x => { const id = idOf(x); return id && visits[id]; })) { n++; got.set(si, (got.get(si) || 0) + 1); }
        });
        const all_ = terrCells.size, pct = v => (v * 100).toFixed(v < 0.01 ? 2 : v < 0.1 ? 1 : 0) + '%';
        const bar = (a, b) => '<span class="sm-dex-bar"><i style="width:' + Math.max(a ? 3 : 0, Math.round(a / b * 100)) + '%"></i></span>';
        const sido = [...tot.keys()].filter(Boolean).sort((a, b) => (got.get(b) || 0) - (got.get(a) || 0) || tot.get(b) - tot.get(a));
        const row = si => '<li><span>' + esc(si) + '</span>' + bar(got.get(si) || 0, tot.get(si)) + '<b>' + fmt(got.get(si) || 0) + '</b><small>/' + fmt(tot.get(si)) + '</small></li>';
        const on = sido.filter(si => got.get(si)), off = sido.filter(si => !got.get(si));
        return '<div class="sm-hexdex"><h4 class="sm-terr-h">📖 ' + T('칸 도감', 'Cell collection') + ' <small>' + T('다녀온 곳이 있는 칸', 'cells with a place you visited') + '</small></h4>' +
            '<p class="sm-dex-total"><b>' + fmt(n) + '</b> / ' + T(fmt(all_) + '칸', fmt(all_) + ' cells') + ' <small>' + pct(n / all_) + '</small></p>' + bar(n, all_) +
            '<p class="sm-dex-badges">' + dexSteps().map(b => '<span class="sm-dex-badge' + (n >= b ? ' is-on' : '') + '" title="' + T(b + '칸 다녀오기', 'Visit ' + b + ' cells') + '">⬡ ' + b +
                (n >= b ? '' : '<small>' + T((b - n) + '칸 남음', (b - n) + ' to go') + '</small>') + '</span>').join('') + '</p>' +
            (on.length ? '<ul class="sm-dex-sido">' + on.map(row).join('') + '</ul>' : '') +
            (off.length ? '<details class="sm-dex-more"><summary>' + T('나머지 시 · 도 ' + off.length + '곳', off.length + ' more regions') + '</summary><ul class="sm-dex-sido">' + off.map(row).join('') + '</ul></details>' : '') +
            '</div>';
    }
    // 내 칸 모양 바꾸기(2026-11-07 사장님 — 기본은 무작위, 바꾸려면 포인트). 주색 · 보조색 16가지(+ 아무 색) × 무늬 4가지
    const SKIN_COLORS = ['#e63946', '#ff7f50', '#f4a261', '#e9c46a', '#b5e48c', '#52b788', '#2a9d8f', '#48cae4', '#3a86ff', '#4361ee', '#8338ec', '#c77dff', '#ff66b3', '#ff006e', '#8d6e63', '#1f2937'];
    const SKIN_PATS = () => [T('단색', 'Solid'), T('줄무늬', 'Stripes'), T('물방울', 'Dots'), T('체크', 'Checks')];
    let skinDraft = null;   // 고르는 중인 { c, d, p } — null 이면 닫힘
    function skinRow(me) {
        const A = account(), u = A && A.me() && A.me().user, avail = u && u.score ? Math.floor(u.score.avail) : null;
        let h = '<div class="sm-terr-skin">' + swatch(me.skin, 'sm-skin-lg') + '<span>' + T('내 칸 모양', 'My cell skin') + (me.skinSet ? '' : T(' <small>(무작위)</small>', ' <small>(random)</small>')) + '</span>' +
            (skinDraft ? '' : '<button type="button" class="sm-terr-skin-edit">' + T('바꾸기', 'Change') + '</button>') + '</div>';
        if (!skinDraft) return h;
        const k = skinDraft, row = (key, cur) => '<div class="sm-skin-row" data-key="' + key + '">' + SKIN_COLORS.map(c => '<button type="button" class="sm-skin-pick' + (c === cur ? ' is-on' : '') + '" data-v="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') +
            '<label class="sm-skin-pick sm-terr-any" title="' + T('다른 색', 'Any colour') + '"><input type="color" value="' + cur + '" aria-label="' + T('다른 색', 'Any colour') + '"></label></div>';
        const same = skinStr(k) === parseSkin(me.skin) && me.skinSet;
        h += '<div class="sm-skin-edit">' +
            '<p class="sm-skin-h">' + T('주색', 'Main colour') + '</p>' + row('c', k.c) +
            '<p class="sm-skin-h">' + T('보조색', 'Second colour') + '</p>' + row('d', k.d) +
            '<p class="sm-skin-h">' + T('무늬', 'Pattern') + '</p><div class="sm-skin-pats">' + SKIN_PATS().map((n, i) => '<button type="button" class="sm-skin-pat' + (i === k.p ? ' is-on' : '') + '" data-p="' + i + '">' + swatch(skinStr(Object.assign({}, k, { p: i }))) + n + '</button>').join('') + '</div>' +
            '<p class="sm-skin-prev">' + swatch(skinStr(k), 'sm-skin-xl') + '</p>' +
            '<p class="sm-skin-btns"><button type="button" class="sm-terr-ok sm-skin-apply"' + (same ? ' disabled' : '') + '>' + T('적용 · ' + SKIN_COST + '포인트', 'Apply · ' + SKIN_COST + ' points') + '</button> ' +
            '<button type="button" class="sm-terr-cancel sm-skin-cancel">' + T('취소', 'Cancel') + '</button>' +
            (me.skinSet ? ' <button type="button" class="sm-terr-cancel sm-skin-reset">' + T('무작위로 돌리기(무료)', 'Back to random (free)') + '</button>' : '') + '</p>' +
            '<p class="sm-small">' + T('바꾼 모양은 모두에게 보입니다.', 'Everyone sees your skin.') + (avail != null ? T(' 지금 ' + fmt(avail) + '포인트', ' You have ' + fmt(avail) + ' points') : '') + '</p></div>';
        return h;
    }
    function bindSkin() {
        const me = terr && terr.me;
        const ed = terrPanel.querySelector('.sm-terr-skin-edit');
        if (ed) ed.addEventListener('click', () => { skinDraft = parseSkin(me.skin); drawTerr(); });
        if (!skinDraft || !terrPanel.querySelector('.sm-skin-edit')) return;
        terrPanel.querySelectorAll('.sm-skin-row').forEach(rw => {
            const key = rw.dataset.key;
            rw.querySelectorAll('button.sm-skin-pick').forEach(b => b.addEventListener('click', () => { skinDraft[key] = b.dataset.v; drawTerr(); }));
            const inp = rw.querySelector('input[type="color"]');
            if (inp) inp.addEventListener('change', () => { skinDraft[key] = inp.value.toLowerCase(); drawTerr(); });
        });
        terrPanel.querySelectorAll('.sm-skin-pat').forEach(b => b.addEventListener('click', () => { skinDraft.p = Number(b.dataset.p); drawTerr(); }));
        terrPanel.querySelector('.sm-skin-cancel').addEventListener('click', () => { skinDraft = null; drawTerr(); });
        terrPanel.querySelector('.sm-skin-apply').addEventListener('click', () => saveSkin(skinStr(skinDraft)));
        const rs = terrPanel.querySelector('.sm-skin-reset');
        if (rs) rs.addEventListener('click', () => saveSkin(null));
    }
    async function saveSkin(skin) {
        const A = account();
        try { await A.call('/api/territory/skin', { method: 'POST', body: { skin } }); }
        catch (e) { const msg = terrPanel.querySelector('.sm-terr-msg'); if (msg) msg.textContent = (e && e.message) || T('저장하지 못했습니다.', 'Could not save.'); return; }
        skinDraft = null;
        await A.refresh().catch(() => null);
        await loadTerr();
        drawTerrLayers();
        drawTerr();
    }
    // 랭킹 목록(지금 · 지난 분기 확정). medal: 1~3위에 메달
    function rankList(rows, mine, medal) {
        return '<ol class="sm-terr-rank">' + rows.map((r, k) => '<li' + (mine === k + 1 ? ' class="is-me"' : '') + '><span class="sm-rank">' + (medal && MEDAL[k] ? MEDAL[k] : k + 1) + '</span><span class="sm-tname">' +
            (r.skin ? swatch(r.skin) : '') + ttBadge(r.tt) + esc(r.nick || T('(탈퇴했거나 별명 없음)', '(no name)')) + '</span><span class="sm-tcnt"><b>' + fmt(r.cells) + '</b>' + T('칸', '') + '<small>' + T(fmt(r.stores) + '곳', fmt(r.stores) + ' visits') + '</small></span></li>').join('') + '</ol>';
    }
    function drawTerr() {
        if (!shown.terr || !terrOpen) return;   // 창을 닫았으면 칸만 새로 그린다(drawTerrLayers)
        const A = account();
        const s = terr ? terr.season : seasonNow();
        if (terrView === 'consent') { drawConsent(); return; }
        const me = terr && terr.me;
        let status;
        if (!A || !A.session()) status = '<button type="button" class="sm-terr-join">' + T('로그인하고 참여하기', 'Sign in to join') + '</button>';
        else if (!(me && me.joined)) status = '<button type="button" class="sm-terr-join">' + T('참여하기', 'Join') + '</button> <span class="sm-small">' + T('동의한 뒤에만 셉니다', 'Counts only after you agree') + '</span>';
        else status = '<p class="sm-terr-me">' + T('내 칸 <b>' + fmt(me.cells.length) + '</b>' + (me.rank ? ' · <b>' + me.rank + '</b>위' : '') + ' · 다녀온 곳 ' + fmt(me.stores) + '곳',
            'My cells <b>' + fmt(me.cells.length) + '</b>' + (me.rank ? ' · rank <b>' + me.rank + '</b>' : '') + ' · ' + fmt(me.stores) + ' visited') + '</p>' +
            (me.lastRank ? '<p class="sm-terr-me">' + (MEDAL[me.lastRank - 1] || '🏅') + ' ' + T(seasonLabel(terr.last) + ' 확정 ' + me.lastRank + '위', seasonLabel(terr.last) + ' final: #' + me.lastRank) + '</p>' : '') +
            skinRow(me);
        const rank = (terr && terr.rank) || [];
        const last = terr && terr.last;
        const joined = !!(A && A.session() && me && me.joined), sheet = hexMobile();
        const title = '<h3><span class="sm-turf-ico" aria-hidden="true"></span> LottoHex</h3>' +   // 시험판 표시는 없앴다(2026-11-09 사장님)
            '<p class="sm-terr-season">' + (terr ? T('참여 ' + fmt(terr.players) + '명 · ', fmt(terr.players) + ' players · ') : '') + T('칸은 계속 이어지고, 분기마다 랭킹만 확정합니다', 'Cells carry on; the ranking is finalised each quarter') + '</p>' +
            (terr ? '' : '<p class="sm-small is-warn">' + T('LottoHex를 불러오지 못했습니다. 잠시 뒤 다시 켜 주세요.', 'Could not load LottoHex. Try again later.') + '</p>');
        const statusPart = '<div class="sm-terr-status">' + status + '</div>';
        const cellPart = terrSel ? cellBlock() : '', hint = terrSel ? '' : '<p class="sm-small">' + T('칸을 누르면 그 칸의 주인과 판매점이 나옵니다.', 'Tap a cell to see who holds it and its retailers.') + '</p>';
        const tab = sheet ? terrTab : null;
        const news = joined && (!sheet || tab === 'now') ? newsBlock() : '';   // newsBlock 은 보이면 "봄"으로 적는다 — 보일 때만 부른다
        const todo = joined && terrCells ? todoLists(me) : '';
        const dex = A && A.session() ? titleDex() + dexBlock() : '';
        const ms = A && A.session() ? milestoneBlock() : '';
        const rankPart = '<h4 class="sm-terr-h">' + T('Map 랭킹', 'Map ranking') + ' <small>' + T(seasonLabel(s) + ' · ' + seasonEnd(s) + ' 24시에 확정', seasonLabel(s) + ' · final at the end of ' + seasonEnd(s)) + '</small></h4>' +
            (rank.length ? rankList(rank, me && me.rank) : '<p class="sm-small">' + T('아직 칸을 차지한 사람이 없습니다.', 'No one holds a cell yet.') + '</p>') +
            (last && last.rank.length ? '<h4 class="sm-terr-h">🏆 ' + T(seasonLabel(last) + ' 확정 순위', seasonLabel(last) + ' final ranking') + '</h4>' + rankList(last.rank, me && me.lastRank, true) : '');
        const rules = '<details class="sm-terr-rules"><summary>' + T('규칙', 'Rules') + '</summary><ul>' +
            '<li>' + T('칸(육각형, 가운데서 꼭짓점까지 0.6km · 걸어서 15분쯤) 안에서 다녀온 판매점이 가장 많은 사람이 그 칸을 차지합니다.', 'Whoever has visited the most retailers in a hexagon cell (0.6 km centre to corner, about a 15-minute walk across) holds it.') + '</li>' +
            '<li>' + T('주인이 없는 칸은 <b>회색지대</b>로, 지도에 옅은 회색으로 보입니다. 판매점 한 곳만 다녀와도 차지합니다.', 'Cells no one holds are the <b>grey zone</b>, shown in light grey. One visit takes one.') + '</li>' +
            '<li>' + T('같은 수면 그 칸에 더 최근에 다녀온 사람이 차지합니다. 빼앗기면 그 칸 판매점 카드의 "오늘 또 다녀왔어요"로 되찾을 수 있습니다(같은 곳은 하루 한 번).', 'On a tie, whoever visited the cell most recently holds it. Lost it? Use "Visited again today" on a retailer card in that cell (once a day per retailer).') + '</li>' +
            '<li>' + T('칸 모양: 참여자마다 색 두 가지와 무늬(단색 · 줄무늬 · 물방울 · 체크)가 무작위로 정해지고 모두에게 같게 보입니다. 내 칸 모양은 ' + SKIN_COST + '포인트로 바꿀 수 있습니다. 내 칸은 테두리가 조금 굵습니다.', 'Skins: each player gets two colours and a pattern (solid, stripes, dots or checks) at random, and everyone sees the same. You can change yours for ' + SKIN_COST + ' points. Your cells have a slightly thicker edge.') + '</li>' +
            '<li>' + T('밤 지도에서 크게 보면 차지한 칸 테두리를 빛이 시계 방향으로 돌고, 칸 면에는 유리에 비친 듯한 45° 빛이 번쩍 지나갑니다.', 'On the night map, zoomed in, a light runs clockwise round held cells and a quick glassy 45° glint flashes across them.') + '</li>' +
            '<li>' + T('칸은 비우지 않습니다. 분기(1 · 4 · 7 · 10월 1일 0시)마다 그때의 Map 랭킹을 확정해 남깁니다.', 'Cells are never cleared. At the start of each quarter the Map ranking at that moment is finalised and kept.') + '</li>' +
            '<li>' + T('확정 순위 보상: 1위 1,000 · 2위 500 · 3위 300 · 4~10위 100포인트(운영자 제외).', 'Quarterly rewards: 1st 1,000 · 2nd 500 · 3rd 300 · 4th–10th 100 points (operators excluded).') + '</li>' +
            '<li>' + T('마일스톤 · 칭호: 다녀온 판매점 · 칸 · 시·도 · 영토가 단계에 이르면 포인트를, 방문 · 영토 · 칸 모양(왕지렁이 · 벌집 …) · 지역(마포구 전문가 …)으로 칭호를 얻습니다. 칭호는 "도감"에서 골라 별명 앞에 답니다.', 'Milestones and titles: reach steps in retailers, cells, provinces and territory for points, and earn titles for visits, territory, cell shapes (Giant Worm, Honeycomb …) and regions. Pick a title in "Collection" to show it before your nickname.') + '</li>' +
            '<li>' + (gpsCfg() ? T('다녀온 곳은 판매점 50m 안에서 위치로 인증한 곳만 셉니다. 폐점한 곳은 세지 않습니다.', 'Only retailers verified by location (within 50 m) count. Closed retailers do not count.')
                : T('지금은 "다녀왔어요"를 누른 기록만 셉니다. 위치 인증(판매점 50m 안)은 준비 중입니다. 폐점한 곳은 세지 않습니다.', 'For now a tap on "I\'ve been here" counts. Location check (within 50 m) is coming. Closed retailers do not count.')) + '</li>' +
            '<li>' + T('복권을 살 필요는 없습니다. 어디서 사든 1등 확률은 1/8,145,060으로 같습니다.', 'No purchase needed. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.') + '</li>' +
            '</ul></details>';
        const leave = me && me.joined ? '<p class="sm-terr-leave-p"><button type="button" class="sm-terr-leave">' + T('LottoHex 그만두기', 'Leave LottoHex') + '</button></p>' : '';
        const msg = '<p class="sm-terr-msg" role="status"></p>';
        if (sheet) {
            // 휴대폰 LottoHex 모드: 아래 판 — 손잡이 + 탭(현황 · 할 일 · 도감 · 랭킹), 고른 탭만
            const join = '<p class="sm-small">' + T('참여하면 여기에 나옵니다. "현황"에서 참여할 수 있습니다.', 'Join LottoHex (in Status) to see this.') + '</p>';
            const body = tab === 'todo' ? ms + (todo || join)
                : tab === 'dex' ? (dex || '<p class="sm-small">' + T('로그인하고 "다녀왔어요"를 표시하면 다녀온 칸을 모아 볼 수 있습니다.', 'Sign in and mark places you have been to collect cells.') + '</p>')
                : tab === 'rank' ? rankPart
                : title + cellPart + statusPart + news + hint + rules + leave;
            const dot = on => (on ? '<i class="sm-tab-dot" aria-hidden="true"></i>' : '');
            const tabs = [['now', T('현황', 'Status'), newsState === 'pending'], ['todo', T('할 일', 'To do'), joined && lastTodo.hot > 0], ['dex', T('도감', 'Collection')], ['rank', T('랭킹', 'Ranking')]];
            terrPanel.innerHTML = '<div class="sm-sheet-head"><span class="sm-sheet-grip" aria-hidden="true"></span><div class="sm-sheet-tabs" role="tablist">' +
                tabs.map(([k, n, d]) => '<button type="button" role="tab" data-ttab="' + k + '" aria-selected="' + (k === tab) + '">' + n + dot(d) + '</button>').join('') + '</div></div>' +
                '<div class="sm-sheet-body">' + body + msg + '</div>';
        } else {
            terrPanel.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' +
                title + statusPart + cellPart + hint + news + ms + todo + dex + rankPart + rules + leave + msg;
        }
        terrPanel.hidden = false;
        if (hexAbout && (!sheet || tab === 'now')) { hexAbout.open = false; (terrPanel.querySelector('.sm-sheet-body') || terrPanel).appendChild(hexAbout); }
        const cb = terrPanel.querySelector('.sm-close');
        if (cb) cb.addEventListener('click', closeTerrPanel);
        terrPanel.querySelectorAll('[data-ttab]').forEach(b => b.addEventListener('click', () => {
            if (Date.now() < sheetNoClick) return;   // 판을 끈 뒤 바로 오는 누르기는 무시
            terrTab = b.dataset.ttab;
            if (sheetSnap === 'peek') setSheet('half');
            drawTerr();
        }));
        bindSkin();
        terrPanel.querySelectorAll('.sm-ttl-item[data-ttl]').forEach(b => b.addEventListener('click', () => pickTitle(b.classList.contains('is-sel') ? null : b.dataset.ttl)));
        const tOff = terrPanel.querySelector('.sm-ttl-off');
        if (tOff) tOff.addEventListener('click', () => pickTitle(null));
        const jb = terrPanel.querySelector('.sm-terr-join');
        if (jb) jb.addEventListener('click', async () => {
            if (!(await member(T('LottoHex는 로그인한 회원이 참여합니다.', 'Sign in to join LottoHex.')))) return;
            const u = A.me() && A.me().user;
            if (!u || !u.nick) { terrPanel.querySelector('.sm-terr-msg').textContent = T('LottoHex에는 별명으로 나옵니다. 별명을 먼저 정해 주세요.', 'You appear by nickname. Choose one first.'); if (A.openNick) A.openNick(false); return; }
            if (hexMobile()) { drawConsent(); return; }   // 휴대폰: 가운데 창만 띄우고 아래 판은 그대로
            terrView = 'consent';
            drawTerr();
        });
        const lb = terrPanel.querySelector('.sm-terr-leave');
        if (lb) lb.addEventListener('click', async () => {
            if (!window.confirm(T('LottoHex를 그만둡니까? 차지한 칸과 랭킹에서 바로 빠집니다. 다녀온 곳 기록은 그대로입니다.', 'Leave LottoHex? Your cells and ranking go at once. Your visited list stays.'))) return;
            try { await A.call('/api/territory/leave', { method: 'POST', body: {} }); await A.refresh().catch(() => null); await loadTerr(); drawTerrLayers(); drawTerr(); }
            catch (e) { terrPanel.querySelector('.sm-terr-msg').textContent = e.message || T('그만두지 못했습니다.', 'Could not leave.'); }
        });
        terrPanel.querySelectorAll('.sm-terr-stores button').forEach(b => b.addEventListener('click', () => (b.dataset.t === 'w' ? open : openAll)(Number(b.dataset.i), true)));
        terrPanel.querySelectorAll('.sm-todo-list button[data-k]').forEach(b => b.addEventListener('click', () => goCell(b.dataset.k)));
        terrPanel.querySelectorAll('.sm-todo-more').forEach(b => b.addEventListener('click', () => { todoOpen[b.dataset.more] = true; drawTerr(); }));
        const nk = terrPanel.querySelector('.sm-news-ok');
        if (nk) nk.addEventListener('click', () => { terrNews = null; drawTerr(); });
    }
    // 참여 동의(2026-11-07 사장님 — "이 기능을 쓰려면 먼저 동의"). 서버는 동의 문구 판(TERR_V)과 동의한 때를 적는다.
    // 2026-11-09 사장님 — 안내 문단 없이 동의 한 줄 + 이용약관 링크(칸 · 별명 공개 같은 내용은 이용약관 8번 · 처리방침 4번에). 위치 동의가 아직이면
    // 위치 줄을 따로 한 줄 더(두 동의는 따로 받는다), 둘 다 체크해야 참여 — 위치로 인증한 곳만 세니 위치 동의 없이는 칸을 가질 수 없다
    function drawConsent() {
        const A = account(), g = gpsCfg(), needGeo = !!g && !geoAgreed();
        const html = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' +
            '<h3>' + T('LottoHex 참여', 'Join LottoHex') + '</h3>' +   // 시험판 표시 없이(2026-11-09 사장님)
            '<label class="sm-terr-agree"><input type="checkbox"> ' + T('LottoHex 참여에 동의합니다. (만 19세 이상)', 'I agree to join LottoHex. (19 or older)') + '</label>' +
            (needGeo ? geoAgreeLine(false) : '') +
            '<p class="sm-terr-btns"><button type="button" class="sm-terr-ok" disabled>' + T('참여', 'Join') + '</button> <button type="button" class="sm-terr-cancel">' + T('나중에', 'Later') + '</button></p>' +
            termsLine() +
            '<p class="sm-terr-msg" role="status"></p>';
        // 휴대폰 LottoHex 모드는 화면 가운데 중간 크기 창(2026-11-08 사장님 — "대문짝만하다, 지도가 보이게"). PC 는 왼쪽 칸 그대로
        let pop = null, el = terrPanel;
        if (hexMobile()) {
            pop = document.getElementById('sm-consent-pop');
            if (!pop) { pop = document.createElement('div'); pop.id = 'sm-consent-pop'; pop.className = 'sm-consent-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); root.appendChild(pop); }
            pop.setAttribute('aria-label', T('LottoHex 참여', 'Join LottoHex'));
            el = pop;
        }
        el.innerHTML = html;
        el.hidden = false;
        el.scrollTop = 0;
        const ok = el.querySelector('.sm-terr-ok');
        agreeBoxes(el, ok);
        const back = () => { terrView = 'main'; if (pop) pop.hidden = true; else drawTerr(); try { localStorage.setItem(HEX_LATER, String(Date.now())); } catch (e) { /* 이 기기에서만 */ } };
        el.querySelector('.sm-close').addEventListener('click', back);
        el.querySelector('.sm-terr-cancel').addEventListener('click', back);
        ok.addEventListener('click', async () => {
            ok.disabled = true;
            try {
                if (needGeo) {
                    const r = await A.call('/api/me/geo', { method: 'POST', body: { agree: true, v: g.geoV } });
                    if (A.patchUser) A.patchUser({ geo: r.user.geo });
                }
                await A.call('/api/territory/join', { method: 'POST', body: { agree: true, v: terrV() } });
                await A.refresh().catch(() => null);
                terrView = 'main';
                if (pop) pop.hidden = true;
                await loadTerr();
                drawTerrLayers();
                drawTerr();
                terrPanel.scrollTop = 0;
                if (!flyMine() && needGeo) geoStart();   // 칸이 아직 없으면 내 위치로(위치를 막 켰을 때)
            } catch (e) {
                ok.disabled = false;
                el.querySelector('.sm-terr-msg').textContent = (e && e.message) || T('참여하지 못했습니다.', 'Could not join.');
            }
        });
    }
    function initTerr() {
        const A = account();
        if (!terrChip || !terrPanel || !HX || !A || !A.ready) return;
        A.ready.then(() => {
            if (!A.loginOn()) return;   // 서버에 로그인이 꺼져 있으면 영역도 없다
            document.getElementById('sm-turf').hidden = false;
            const sw = document.getElementById('sm-mode-sw');
            if (sw) { sw.hidden = false; root.classList.add('has-modes'); }   // 휴대폰: 제목 자리에 [판매점 | LottoHex]
            const tab = side.querySelector('.sm-tab[data-tab="terr"]');
            if (tab) tab.hidden = false;
            let q = null;
            try { q = new URLSearchParams(location.search).get('mode'); } catch (e) { /* 구형 */ }
            if (root.dataset.hex) setMapMode('hex', true);   // lottohex.html — 전환 화면 없이 LottoHex 로 시작
            else if (q === 'hex') setMapMode('hex');   // 옛 주소 store-map.html?mode=hex — LottoHex 로 바로(주소는 lottohex.html 로 바뀐다)
            else if (joinedNow() && !terr) loadTerr();   // 참여자는 들어올 때 한 번 받아 잃은 칸 · 얻은 칸을 견준다(빨간 점)
        });
        terrChip.addEventListener('click', () => setMapMode(shown.terr ? 'store' : 'hex'));   // PC 카드도 모드를 바꾼다(LottoHex 판매점 층 · 전환 화면)
        root.querySelectorAll('[data-terr-only]').forEach(b => b.addEventListener('click', () => setTerrOnly(!terrOnly)));
        root.querySelectorAll('[data-mode-to]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); setMapMode(b.dataset.modeTo); }));   // 링크(검색 로봇용)지만 페이지는 그대로 두고 화면만 바꾼다
        const hs = document.getElementById('sm-hexbar-stat');
        if (hs) hs.addEventListener('click', () => { terrTab = 'now'; setSheet(sheetSnap === 'peek' ? 'half' : sheetSnap); if (shown.terr) openTerrPanel(); });
        initSheetDrag();
        window.addEventListener('lottodraw:account', () => { if (shown.terr) refreshTerr(); });
    }

    // ───── 판매점 댓글(로그인 회원, 2026-10-27 사장님 — "다녀왔어요" 아래) ─────
    // 블로그 댓글과 같은 서버 길(/api/comments, 글 이름 'shop-' + 판매점 번호)과 규칙(별명 필요 · 링크 · 연락처 · 홍보 금지 · 15초에 한 번 · 하루 30개 · 500자).
    // 읽기는 누구나. 글은 textContent 로만 그린다. 위치 인증은 붙이지 않는다(위치정보를 받지 않는다 — README 4-9)
    let cmtRefresh = null;
    const cmtTime = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()); };
    async function commentsUi(k, i) {
        const box = document.getElementById('sm-cmt');
        const A = account();
        cmtRefresh = null;
        if (!box || !A || !A.ready) return;
        const token = card.dataset.c = k + i;
        await A.ready;
        if (!A.loginOn() || !(await loadIds()) || card.dataset.c !== token) { if (card.dataset.c === token) box.remove(); return; }
        const id = ids[k] && ids[k][i];
        if (!id) { box.remove(); return; }
        const post = 'shop-' + id;
        box.innerHTML = '<h4>' + T('댓글', 'Comments') + ' <span class="sm-cmt-n"></span></h4><ol class="sm-cmt-list"></ol><div class="sm-cmt-foot"></div>' +
            '<p class="sm-cmt-msg" role="status"></p><p class="sm-cmt-rule">' + T('링크 · 연락처 · 홍보 글과 비방은 지웁니다.', 'Links, contacts, ads and abuse are removed.') + '</p>';
        const list = box.querySelector('.sm-cmt-list'), foot = box.querySelector('.sm-cmt-foot'), msg = box.querySelector('.sm-cmt-msg');
        // 답글(2026-10-27 사장님): 한 단계만 — 맨 위 댓글 아래에 모은다. 맨 위 댓글이 지워졌으면 "지운 댓글" 아래에.
        // 답글이 달리면 답한 댓글 · 맨 위 댓글 쓴 사람의 마이페이지에 알림(서버)
        let replyTo = null;
        const one = (c, holder) => {
                const li = document.createElement('li');
                const head = document.createElement('div');
                const nick = document.createElement('b');
                nick.textContent = c.nick || T('(별명 없음)', '(no nickname)');
                const at = document.createElement('small');
                at.textContent = cmtTime(c.at);
                head.append(nick, ' ');
                // 쓴 사람이 이 판매점을 "다녀온 곳"으로 표시해 두었으면(서버가 알려 준다) 구분 표시(2026-10-27 사장님)
                if (c.visited) { const v = document.createElement('span'); v.className = 'sm-cmt-been'; v.textContent = T('✓ 실방문자', '✓ Visitor'); v.title = T('이 판매점을 "다녀온 곳"으로 표시한 회원', 'Marked this retailer as visited'); head.append(v, ' '); }
                head.append(at);
                if (c.mine) {
                    const del = document.createElement('button');
                    del.type = 'button';
                    del.className = 'sm-cmt-del';
                    del.textContent = T('지우기', 'Delete');
                    del.addEventListener('click', async () => {
                        if (!window.confirm(T('이 댓글을 지웁니까?', 'Delete this comment?'))) return;
                        try { await A.call('/api/comments/delete', { method: 'POST', body: { post, id: c.id } }); load(); } catch (e) { msg.textContent = e.message; }
                    });
                    head.append(' ', del);
                }
                const text = document.createElement('p');
                text.textContent = c.text;
                const re = document.createElement('button');
                re.type = 'button';
                re.className = 'sm-cmt-re';
                re.textContent = T('답글', 'Reply');
                re.addEventListener('click', () => { replyTo = replyTo && replyTo.id === c.id ? null : c; gate(); });
                li.append(head, text, re);
                holder.appendChild(li);
                return li;
        };
        const draw = rows => {
            list.textContent = '';
            box.querySelector('.sm-cmt-n').textContent = rows.length ? String(rows.length) : '';
            if (!rows.length) { const li = document.createElement('li'); li.className = 'sm-cmt-empty'; li.textContent = T('아직 댓글이 없습니다.', 'No comments yet.'); list.appendChild(li); return; }
            const kids = new Map();
            rows.filter(c => c.to).forEach(c => { if (!kids.has(c.to)) kids.set(c.to, []); kids.get(c.to).push(c); });
            const tops = rows.filter(c => !c.to);
            const nest = (li, id) => {
                const k = kids.get(id);
                if (!k) return;
                const ol = document.createElement('ol');
                ol.className = 'sm-cmt-replies';
                k.forEach(c => one(c, ol));
                li.appendChild(ol);
            };
            tops.forEach(c => nest(one(c, list), c.id));
            kids.forEach((k, id) => {
                if (tops.some(c => c.id === id)) return;
                const li = document.createElement('li');
                li.className = 'sm-cmt-gone';
                li.textContent = T('(지운 댓글입니다)', '(deleted comment)');
                list.appendChild(li);
                nest(li, id);
            });
        };
        const load = async () => {
            try { const r = await A.call('/api/comments?post=' + post); if (card.dataset.c === token) draw(r.comments || []); }
            catch (e) { msg.textContent = T('댓글을 불러오지 못했습니다.', 'Could not load comments.'); }
        };
        // 쓰기 자격: 로그인 → 별명 → 입력칸
        const gate = () => {
            foot.textContent = '';
            const me = A.me && A.me();
            const btn = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sm-cmt-gate'; b.textContent = label; b.addEventListener('click', fn); foot.appendChild(b); };
            if (!A.session() || !me) { btn(T('로그인하고 댓글 쓰기', 'Sign in to comment'), () => A.openLogin(T('판매점 댓글은 로그인한 회원이 쓸 수 있습니다.', 'Sign in to comment on retailers.'))); return; }
            if (!me.user || !me.user.nick) { btn(T('별명을 정하면 댓글을 쓸 수 있습니다', 'Choose a nickname to comment'), () => A.openNick && A.openNick(false)); return; }
            if (replyTo) {
                const to = document.createElement('p');
                to.className = 'sm-cmt-to';
                to.textContent = T('↳ ' + (replyTo.nick || '') + '님에게 답글', '↳ Replying to ' + (replyTo.nick || ''));
                const x = document.createElement('button');
                x.type = 'button';
                x.textContent = T('취소', 'Cancel');
                x.addEventListener('click', () => { replyTo = null; gate(); });
                to.append(' ', x);
                foot.appendChild(to);
            }
            const form = document.createElement('form');
            form.className = 'sm-cmt-form';
            form.innerHTML = '<textarea rows="2" maxlength="500"></textarea><button type="submit">' + T('남기기', 'Post') + '</button>';
            const ta = form.querySelector('textarea');
            ta.placeholder = replyTo ? T('답글 (500자)', 'Reply (500 chars)') : T('이 판매점 이야기를 남겨 주세요 (500자)', 'Say something about this retailer (500 chars)');
            ta.setAttribute('aria-label', ta.placeholder);
            form.addEventListener('submit', async e => {
                e.preventDefault();
                const text = ta.value.trim();
                if (!text) return;
                const b = form.querySelector('button');
                b.disabled = true;
                msg.textContent = '';
                try { await A.call('/api/comments', { method: 'POST', body: replyTo ? { post, text, to: replyTo.id } : { post, text } }); ta.value = ''; replyTo = null; gate(); await load(); }
                catch (err) { msg.textContent = err.message || T('남기지 못했습니다.', 'Could not post.'); }
                finally { b.disabled = false; }
            });
            foot.appendChild(form);
            if (replyTo) ta.focus();
        };
        cmtRefresh = () => { if (card.dataset.c === token && document.getElementById('sm-cmt') === box) { gate(); load(); } };
        gate();
        load();
    }
    window.addEventListener('lottodraw:account', () => { if (cmtRefresh) cmtRefresh(); });

    // ───── 위치 인증(2026-11-09 사장님 — 위치기반서비스사업 신고) ─────
    // 서버 스위치(GPS_VERIFY)가 켜져 있으면: 로그인 회원에게 지도를 열 때 위치 이용 동의를 묻고(나중에를 누르면 3일 뒤 다시), 동의했으면 내 위치를 켠 채로 시작.
    // "다녀왔어요" · "또 다녀왔어요"를 누르면 그 순간 위치를 한 번 받아 서버로 보내고, 서버가 판매점 50m 안인지 판정한다(좌표는 서버가 저장하지 않는다)
    const GEO_LATER = 'lottodraw.geo.later';
    const geoAgreed = () => { const A = account(), u = A && A.me() && A.me().user, g = gpsCfg(); return !!(g && u && u.geo && u.geo.v === g.geoV); };
    // 동의 창의 줄 · 약관 링크(위치 동의 창과 LottoHex 참여 창이 같이 쓴다)
    const geoAgreeLine = age => '<label class="sm-terr-agree"><input type="checkbox"> ' + T('위치정보 서비스 이용에 동의합니다.' + (age ? ' (만 14세 이상)' : ''), 'I agree to the location-based service.' + (age ? ' (14 or older)' : '')) + '</label>';   // LottoHex 창에서는 위 줄이 19세
    const termsLine = () => '<p class="sm-small"><a href="terms.html#location">' + T('이용약관', 'Terms of Use') + '</a></p>';   // 링크만(2026-11-09 사장님)
    // 체크가 모두 되어야 단추가 눌린다
    function agreeBoxes(el, ok) {
        const boxes = [...el.querySelectorAll('.sm-terr-agree input')];
        boxes.forEach(b => b.addEventListener('change', () => { ok.disabled = !boxes.every(x => x.checked); }));
    }
    function geoStart() {
        if (!geo || geoActive()) return;
        try { geo.trigger(); } catch (e) { /* 지도 준비 전 */ }
    }
    function geoPop(then) {
        const A = account(), g = gpsCfg();
        if (!g) return;
        let pop = document.getElementById('sm-geo-pop');
        if (!pop) { pop = document.createElement('div'); pop.id = 'sm-geo-pop'; pop.className = 'sm-consent-pop sm-geo-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); root.appendChild(pop); }
        // 동의 창은 한 줄만(2026-11-09 사장님 — "이런저런 얘기 없이 '위치정보 서비스 이용에 동의합니다' 정도만, 자세한 건 이용약관 링크"). 받는 정보 · 보관 · 철회는 이용약관 8번 · 처리방침 5번
        pop.setAttribute('aria-label', T('위치 이용 동의', 'Location consent'));
        pop.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' +
            '<h3>📍 ' + T('위치 이용 동의', 'Location consent') + '</h3>' +
            geoAgreeLine(true) +
            '<p class="sm-terr-btns"><button type="button" class="sm-terr-ok" disabled>' + T('동의하고 위치 켜기', 'Agree and turn on') + '</button> <button type="button" class="sm-terr-cancel">' + T('나중에', 'Later') + '</button></p>' +
            termsLine() +
            '<p class="sm-terr-msg" role="status"></p>';
        pop.hidden = false;
        const ok = pop.querySelector('.sm-terr-ok');
        agreeBoxes(pop, ok);
        const later = () => { pop.hidden = true; try { localStorage.setItem(GEO_LATER, String(Date.now())); } catch (e) { /* 이 기기에서만 */ } };
        pop.querySelector('.sm-close').addEventListener('click', later);
        pop.querySelector('.sm-terr-cancel').addEventListener('click', later);
        ok.addEventListener('click', async () => {
            ok.disabled = true;
            try {
                const r = await A.call('/api/me/geo', { method: 'POST', body: { agree: true, v: g.geoV } });
                if (A.patchUser) A.patchUser({ geo: r.user.geo });
                pop.hidden = true;
                geoStart();
                if (then) then();
            } catch (e) {
                ok.disabled = false;
                pop.querySelector('.sm-terr-msg').textContent = (e && e.message) || T('저장하지 못했습니다.', 'Could not save.');
            }
        });
    }
    // 지도를 열 때: 동의했으면 내 위치를 켠 채로, 아직이면 묻는다(공유 링크로 판매점 · 지역을 열었으면 지도를 옮기지 않게 위치는 켜지 않는다)
    async function initGeo() {
        const A = account();
        if (!A || !A.ready) return;
        await A.ready;
        if (!gpsCfg() || !A.session() || !A.me()) return;
        let deep = false;
        try { const q = new URLSearchParams(location.search); deep = !!(q.get('shop') || q.get('area')) || /map=/.test(location.hash); } catch (e) { /* 구형 */ }
        if (geoAgreed()) { if (!deep) geoStart(); return; }
        if (hexMode && !joinedNow()) return;   // LottoHex 참여 창이 위치 동의 줄을 함께 묻는다
        let later = 0;
        try { later = Number(localStorage.getItem(GEO_LATER)) || 0; } catch (e) { /* 이 기기에서만 */ }
        if (Date.now() - later < 3 * 86400000) return;   // "나중에"를 누르면 3일 동안 묻지 않는다
        geoPop(() => { if (!deep) geoStart(); });
    }
    // "다녀왔어요"를 누른 순간 위치 한 번(오차 · 실패를 사람이 읽을 말로)
    function geoOnce() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) { reject(new Error(T('이 브라우저는 위치를 지원하지 않습니다.', 'This browser cannot share location.'))); return; }
            navigator.geolocation.getCurrentPosition(
                p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
                e => reject(new Error(e && e.code === 1 ? T('브라우저의 위치 권한을 허용해 주세요(주소창 옆 설정).', 'Allow location for this site in your browser settings.')
                    : T('위치를 받지 못했습니다. 잠시 뒤 다시 눌러 주세요.', 'Could not get your location. Try again.'))),
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });   // 누른 순간의 새 위치(직전 위치를 다시 쓰지 않는다)
        });
    }
    // 철회: 앞으로 위치를 받지 않고, 위치로 인증한 다녀온 곳 · LottoHex 집계를 지운다
    async function geoWithdraw() {
        const A = account();
        if (!window.confirm(T('위치 이용 동의를 철회합니까? 위치로 인증한 다녀온 곳이 모두 지워지고 LottoHex 집계에서도 빠집니다.', 'Withdraw consent? All verified visits are deleted and removed from LottoHex.'))) return;
        try {
            const r = await A.call('/api/me/geo', { method: 'POST', body: { agree: false } });
            visits = {}; visitAt = {};
            if (A.patchUser) A.patchUser({ geo: null, visits, visitAt });
            paintVisits();
            for (let n = 0; n < 2 && geoActive(); n++) { try { geo.trigger(); } catch (e) { break; } }   // 내 위치도 끈다(지도를 옮긴 상태면 두 번)
            if (shown.mine) { mineSource(); drawMine(); }
            refreshTerr();
            return r;
        } catch (e) { window.alert((e && e.message) || T('철회하지 못했습니다.', 'Could not withdraw.')); }
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
            const cur = id && visits[id] ? myVisitColor() : null;   // 다녀온 곳이면 내 색(곳마다 색을 따로 두지 않는다)
            // 영역 참여자: "오늘 또 다녀왔어요"(때만 새로 — 색은 그대로, 같은 곳은 하루 한 번). 같은 수 칸에서 최근에 다녀온 사람이 이긴다
            const inTerr = joinedNow();
            const today = !!(cur && visitAt[id] && kstDayOf(visitAt[id]) === kstDayOf(Date.now()));
            box.innerHTML = '<div class="sm-visit-row"><button type="button" class="sm-visit-btn' + (cur ? ' is-on' : '') + '" aria-pressed="' + !!cur + '">' +
                (cur ? '<span class="sm-swatch" style="background:' + cur + '"></span>' + T('다녀온 곳', 'Visited') : T('＋ 다녀왔어요', '＋ I\'ve been here')) + '</button>' +
                (cur ? '<span class="sm-colors">' + PALETTE.map(c => '<button type="button" class="sm-color' + (c === cur ? ' is-on' : '') + (opened(c) ? '' : ' is-locked') + '" data-c="' + c + '" style="background:' + c + '" aria-label="' + c + (opened(c) ? '' : T(' (잠김)', ' (locked)')) + '"></button>').join('') +
                    (canPick ? '<label class="sm-color sm-color-any" title="' + T('다른 색', 'Any colour') + '"><input type="color" value="' + cur + '" aria-label="' + T('다른 색', 'Any colour') + '"></label>' : '') + '</span>' : '') + '</div>' +
                '<p class="sm-visit-note">' + (cur ? (canPick ? T('다시 누르면 지웁니다. 고른 색은 다녀온 곳 모두에 씁니다.', 'Tap again to remove. The colour applies to all your places.')
                    : T('다시 누르면 지웁니다. 고른 색은 다녀온 곳 모두에 씁니다. 🔒 색은 하나에 ' + COLOR_COST + '포인트로 열거나 <a href="statistics.html">이용권</a>으로 모두 엽니다.', 'Tap again to remove. Unlock a 🔒 colour for ' + COLOR_COST + ' points, or all of them with a <a href="statistics.html">pass</a>.'))
                    : gpsCfg() ? T('판매점 50m 안에서 누르면 위치로 확인하고 10포인트를 드립니다(하루 50포인트까지). 나만 보입니다.', 'Tap within 50 m of the retailer to verify by location and earn 10 points (up to 50 a day). Only you can see it.') : T('나만 보입니다.', 'Only you can see it.')) + '</p>' +
                (cur && inTerr ? '<p class="sm-visit-again-p">' + (today ? '<span class="sm-visit-today">✓ ' + T('오늘 다녀옴', 'Visited today') + '</span>'
                    : '<button type="button" class="sm-visit-again">↻ ' + T('오늘 또 다녀왔어요', 'Visited again today') + '</button>') + '</p>' : '') +
                '';   // LottoHex 안내 문구는 뺐다(2026-11-08 사장님 — 말이 많다)
            box.querySelector('.sm-visit-btn').addEventListener('click', () => save(cur ? null : myVisitColor()));
            const ag = box.querySelector('.sm-visit-again');
            if (ag) ag.addEventListener('click', () => save(cur, true));
            box.querySelectorAll('button.sm-color').forEach(b => b.addEventListener('click', () => {
                const c = b.dataset.c;
                if (opened(c)) { saveAll(c); return; }
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
                        saveAll(c);
                    } catch (err) {
                        note.textContent = (err && err.message) || T('열지 못했습니다.', 'Could not unlock.');
                    }
                });
            }));
            const pick = box.querySelector('input[type="color"]');
            if (pick) pick.addEventListener('change', () => saveAll(pick.value));
        };
        const save = async (color, again) => {
            if (!(await member(T('다녀온 곳 표시는 로그인 회원 기능입니다.', 'Marking visited retailers is for signed-in members.')))) return;
            if (!(await loadIds())) return;
            const id = ids[k] && ids[k][i];
            if (!id) return;
            const verify = !!gpsCfg() && (again || color);   // 위치 인증: 새로 표시 · 또 다녀왔어요(지우기는 그대로)
            if (verify && !geoAgreed()) { geoPop(() => save(color, again)); return; }
            const note = box.querySelector('.sm-visit-note');
            try {
                let at = {};
                if (verify) {
                    if (note) { note.classList.remove('is-warn'); note.textContent = T('위치 확인 중…', 'Checking your location…'); }
                    at = await geoOnce();
                }
                const r = await account().call('/api/me/visits', { method: 'POST', body: Object.assign(again ? { id, again: true } : { id, color }, at) });
                at = null;   // 좌표는 보낸 뒤 버린다
                visits = r.visits || {};
                visitAt = r.visitAt || visitAt;
                if (A.patchUser) A.patchUser(Object.assign({ visits, visitAt }, r.visitColor ? { visitColor: r.visitColor } : {}, r.score ? { score: r.score } : {}));   // 이 탭에 저장해 둔 내 정보도 — 다시 열어도 빠지지 않게
                paintVisits();
                draw();
                if (verify) {   // 위치로 확인했다는 것과 받은 포인트(같은 곳은 하루 한 번 · 하루 50포인트까지)
                    const n2 = box.querySelector('.sm-visit-note');
                    if (n2) n2.textContent = (r.earned ? T('✓ 위치로 확인했습니다 · +' + r.earned + '포인트', '✓ Verified by location · +' + r.earned + ' points')
                        : T('✓ 위치로 확인했습니다. 이 판매점은 오늘 포인트를 이미 받았거나, 오늘 받을 수 있는 50포인트를 다 받았습니다.', '✓ Verified by location. No points this time: already earned here today, or the daily 50 is reached.')) +
                        (r.fresh ? ' ' + freshText(r.fresh) : '');   // 새 칭호 · 마일스톤(2026-11-09)
                    if (r.fresh) afterFresh(r.fresh);
                }
                refreshTerr();
                if (shown.mine) { await ensureAll(); mineSource(); drawMine(); }
                if (cmtRefresh) cmtRefresh();   // 내 댓글의 "다녀옴" 표시를 바로 바꾼다
            } catch (e) {
                const n = box.querySelector('.sm-visit-note');
                if (n) { n.classList.add('is-warn'); n.textContent = (e && e.message) || T('저장하지 못했습니다.', 'Could not save.'); }
            }
        };
        // 내 색 바꾸기: 이미 표시한 곳도 모두 그 색(서버가 한 번에 바꾼다)
        // 누르면 바로 그 색으로 바꿔 보이고(서버 답을 기다리지 않는다 — 2026-11-10 사장님 "한 번에 안 되는 줄 알고 계속 눌렀다"), 서버가 저장하면 그 답으로 맞춘다.
        // 저장하는 동안 또 누르면 마지막에 누른 색 하나만 이어서 보낸다. 실패하면 원래 색으로 돌린다
        let colorBusy = false, colorNext = null;
        const saveAll = async color => {
            if (!(await member(T('다녀온 곳 표시는 로그인 회원 기능입니다.', 'Marking visited retailers is for signed-in members.')))) return;
            const before = { visits: Object.assign({}, visits), color: myVisitColor() };
            for (const id of Object.keys(visits)) visits[id] = color;
            if (A.patchUser) A.patchUser({ visits, visitColor: color });
            paintVisits();
            draw();
            if (shown.mine) { mineSource(); drawMine(); }
            const note = box.querySelector('.sm-visit-note');
            if (note) { note.classList.remove('is-warn'); note.textContent = T('✓ 색을 바꿨습니다. 저장하는 중…', '✓ Colour changed. Saving…'); }
            if (colorBusy) { colorNext = color; return; }
            colorBusy = true;
            try {
                let send = color;
                for (;;) {
                    const r = await account().call('/api/me/visits', { method: 'POST', body: { all: true, color: send } });
                    if (colorNext && colorNext !== send) { send = colorNext; colorNext = null; continue; }   // 그 사이 다른 색을 눌렀다
                    colorNext = null;
                    visits = r.visits || visits;
                    visitAt = r.visitAt || visitAt;
                    if (A.patchUser) A.patchUser({ visits, visitAt, visitColor: r.visitColor || send });
                    break;
                }
                paintVisits();
                draw();
                if (shown.mine) { mineSource(); drawMine(); }
                const n2 = box.querySelector('.sm-visit-note');
                if (n2) n2.textContent = T('✓ 다녀온 곳 모두 이 색으로 저장했습니다.', '✓ Saved: all your places use this colour.');
            } catch (e) {
                visits = before.visits; colorNext = null;
                if (A.patchUser) A.patchUser({ visits, visitColor: before.color });
                paintVisits();
                draw();
                if (shown.mine) { mineSource(); drawMine(); }
                const n2 = box.querySelector('.sm-visit-note');
                if (n2) { n2.classList.add('is-warn'); n2.textContent = (e && e.message) || T('저장하지 못했습니다.', 'Could not save.'); }
            } finally { colorBusy = false; }
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
        if (fly) reveal('w', i);
        const r = data.rows[i];
        const [lat, lng, w1, w2, name, si, gu, closed, a, m, s] = r;
        const place = [data.sido[si] || '', gu].filter(Boolean).join(' ');
        const how = [a ? T('자동 ', 'auto ') + a : '', m ? T('수동 ', 'manual ') + m : '', s ? T('반자동 ', 'semi-auto ') + s : ''].filter(Boolean).join(' · ');
        showCard('<h3>' + esc(name) + (closed ? ' <span class="sm-closed">' + T('폐점', 'closed') + '</span>' : '') + '</h3>' +
            '<p class="sm-place">' + esc(place) + '</p>' +
            '<p class="sm-counts"><span><b>' + fmt(w1) + '</b>' + T('번 1등', ' × 1st') + (how ? ' <small>(' + esc(how) + ')</small>' : '') + '</span>' +
            '<span><b>' + fmt(w2) + '</b>' + T('번 2등', ' × 2nd') + '</span></p>' +
            '<div class="sm-rounds" id="sm-rounds"><p class="sm-small">' + T('당첨 회차 불러오는 중…', 'Loading draws…') + '</p></div>' +
            '<p class="sm-why">' + T('1등 · 2등이 많을수록 많이 팔린 곳일 가능성이 큽니다.', 'More 1st and 2nd prizes most likely means more tickets sold.') + '</p>' +   // 확률 문장은 카드에서 뺐다(2026-11-08 사장님 — 말이 많다). 공유 · LottoHex 규칙 · 안내에는 남는다
            links(name, place, lat, lng) + '<div class="sm-share-shop" id="sm-share-shop"><button type="button" class="sm-share-btn">🔗 ' + T('해당 판매점 공유하기', 'Share this retailer') + '</button></div>' + '<div class="sm-visit" id="sm-visit"></div><div class="sm-cmt" id="sm-cmt"></div>', lat, lng, fly);
        card.dataset.i = String(i);
        shareUi('w', i, { name, place, w1, w2, sido: data.sido[si] || '' });
        visitUi('w', i);
        commentsUi('w', i);
        markTop(i);
        loadRounds().then(rd => {
            const box = document.getElementById('sm-rounds');
            if (!box || card.dataset.i !== String(i)) return;   // 그 사이 다른 카드를 열었다
            if (!rd || !rd.rows[i]) { box.remove(); return; }
            fillRounds(box, rd.rows[i], rd.draws || {});
        });
    }

    // ───── 지역 찾기(2026-11-10 사장님 — "판매점 이름보다 사는 곳을 찾고 그 근처 판매점을 지도에서 본다. 검색창은 하나로") ─────
    // 목록(store-map-places.json, tools/make-places.mjs — 통계청 SGIS 행정동 경계를 가공한 vuski/admdongkor, CC BY 4.0)은 검색창을 처음 쓸 때 받는다.
    // "청주 사창동" · "사창동" · "청주" · "서원구" · "역삼"(역삼1 · 2동) · "청주사창동"(띄어쓰기 없이)처럼 낱말마다 시·도 · 시 · 구 · 동 중 하나에 맞으면 찾는다
    let places = null, placesP = null;
    const SIDO_ALIAS = { 서울: ['서울특별시', '서울시'], 부산: ['부산광역시', '부산시'], 대구: ['대구광역시', '대구시'], 인천: ['인천광역시', '인천시'], 광주: ['광주광역시', '광주시'],
        대전: ['대전광역시', '대전시'], 울산: ['울산광역시', '울산시'], 세종: ['세종특별자치시', '세종시'], 경기: ['경기도'], 강원: ['강원도', '강원특별자치도'], 충북: ['충청북도'], 충남: ['충청남도'],
        전북: ['전라북도', '전북특별자치도'], 전남: ['전라남도'], 경북: ['경상북도'], 경남: ['경상남도'], 제주: ['제주도', '제주특별자치도'] };
    function loadPlaces() {
        if (!placesP) placesP = (root.dataset.places ? fetch(root.dataset.places).then(r => (r.ok ? r.json() : null)) : Promise.resolve(null)).catch(() => null).then(j => { places = j ? buildPlaces(j) : []; return places; });
        return placesP;
    }
    // 자리: { c: [시·도, 시, 구, 동], leaf: 가장 작은 단위의 자리, name, sub, lng, lat, z }
    function buildPlaces(j) {
        const S = j.s.map(x => x[0]), out = [];
        j.s.forEach(([n, lng, lat, z]) => out.push({ c: [n, '', '', ''], leaf: 0, name: n, sub: '', lng, lat, z }));
        j.c.forEach(([s, si, lng, lat, z]) => out.push({ c: [S[s], si, '', ''], leaf: 1, name: si, sub: S[s], lng, lat, z }));
        j.g.forEach(([s, si, gu, lng, lat, z]) => out.push({ c: [S[s], si, gu, ''], leaf: gu ? 2 : 1, name: gu || si, sub: [S[s], gu ? si : ''].filter(Boolean).join(' '), lng, lat, z }));
        j.d.forEach(([g, name, lng, lat, z]) => { const [s, si, gu] = j.g[g]; out.push({ c: [S[s], si, gu, name], leaf: 3, name, sub: [S[s], si, gu].filter(Boolean).join(' '), lng, lat, z }); });
        return out;
    }
    // 끝말(시 · 군 · 구 · 동 · 읍 · 면 · 도, 동 앞 숫자)을 뗀 이름: "청주시" → "청주", "역삼1동" → "역삼", "여의도동" → "여의"
    const stripPlace = x => x.replace(/\d*(동|읍|면|가|리)$/, '').replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구|도)$/, '');
    // 끝말을 뗀 이름이 같아도, 찾는 말에 끝말이 있으면 같은 종류끼리만("중구"는 중구, "중1동"은 아니다 · "역삼동"은 역삼1동)
    const SUFFIX = /(동|읍|면|가|리|시|군|구|도)$/;
    const sameKind = (t, x) => { const a = t.match(SUFFIX); if (!a) return true; const b = x.replace(/\d+(?=동$)/, '').match(SUFFIX); return !!b && b[1] === a[1]; };
    function placeTok(t, c, sido) {
        if (!c) return 0;
        let best = 0;
        for (const x of sido ? [c].concat(SIDO_ALIAS[c] || []) : [c]) {
            if (x === t) best = Math.max(best, 3);
            else if (/역$/.test(x) && x.slice(0, -1) === t) best = Math.max(best, 2.5);   // 역: "강남"도 강남역(지역 이름이 같으면 지역이 먼저)
            else if (stripPlace(x) && stripPlace(x) === stripPlace(t) && sameKind(t, x)) best = Math.max(best, 2.5);
            else if (t.length >= 2 && x.startsWith(t)) best = Math.max(best, 1);
        }
        return best;
    }
    // 낱말마다 다른 자리에 맞아야 한다. 가장 작은 단위까지 맞으면 더 위로(“청주” → 청주시, “사창동” → 사창동)
    function placeScore(p, toks) {
        if (!p.syn) return placeScoreC(p.c, p.leaf, toks);
        let best = 0;   // 역 이름이 여럿(괄호 속 이름)이면 가장 잘 맞는 것으로
        for (const n of p.syn) best = Math.max(best, placeScoreC([p.c[0], p.c[1], p.c[2], n], p.leaf, toks));
        return best;
    }
    function placeScoreC(c, leafAt, toks) {
        const used = [false, false, false, false];
        let sc = 0, leaf = false;
        for (const t of toks) {
            let bi = -1, bs = 0;
            for (let k = 0; k < 4; k++) { if (used[k]) continue; const v = placeTok(t, c[k], k === 0); if (v > bs) { bs = v; bi = k; } }
            if (bi < 0) return 0;
            used[bi] = true; sc += bs; if (bi === leafAt) leaf = true;
        }
        return leaf ? sc + 2 : sc;
    }
    function findPlaces(q, max) {
        if (!places || !places.length) return [];
        const pool = stationRecs ? places.concat(stationRecs) : places;
        const run = toks => pool.map(p => ({ p, s: placeScore(p, toks) })).filter(x => x.s > 0).sort((a, b) => (b.s - a.s) || (a.p.leaf - b.p.leaf) || ((a.p.rail ? 1 : 0) - (b.p.rail ? 1 : 0)));
        const toks = q.split(/\s+/).filter(Boolean);
        let hits = run(toks);
        // 띄어 쓰지 않았으면("청주사창동") 두 낱말로 나눠 본다
        if (!hits.length && toks.length === 1 && toks[0].length >= 4) {
            const t = toks[0];
            for (let k = 2; k <= t.length - 2 && !hits.length; k++) hits = run([t.slice(0, k), t.slice(k)]).filter(x => x.s >= 5);
        }
        const seen = new Set();
        return hits.filter(x => { const k = x.p.sub + ' ' + x.p.name; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max).map(x => x.p);
    }
    // ───── 역(2026-11-10 사장님 — "역 이름 검색도, 역은 지도에 표시돼도 괜찮을 듯" · "지하철은 노선마다 고유 색" · "노선마다 역끼리 선으로") ─────
    // store-map-stations.json(tools/make-stations.mjs — OpenStreetMap, ODbL): l: 전철 노선 [이름, 영어, 색], s: [이름("역" 뗌), 경도, 위도, 0 도시철도 · 1 철도 · 2 둘 다, 시·도, 시, 구, 영어 이름, 괄호 속 이름?, 노선 번호들?].
    // 괄호 속 이름이 있으면 "김천(구미)역"으로 보이고 "김천구미" · "구미역"(이수역 → 총신대입구(이수)역)으로도 찾는다
    // 지도를 그린 뒤 받아 줌 12.5부터 점(한 노선은 그 노선 색 테, 갈아타는 역은 조금 크게 진한 테), 13.5부터 이름. 검색창에는 🚉 + 노선 색 점으로(지역 · 판매점과 함께)
    // 노선 선(store-map-lines.json — 실제 선로 모양, 노선 색)은 줌 11.5부터(줌아웃하면 감춤) 판매점 · 칸 · 역 밑에, 밤에는 옅은 흰 테두리를 깐다
    let stationRecs = null, stationsP = null, railLines = [];
    const stName = (n, alt) => n + (alt ? '(' + alt + ')' : '') + '역';
    const RAIL_DEF = { day: '#2b4a9b', night: '#9ec1ff' };   // 노선 없는 기차역 점 테
    const groupsOf = ls => (Array.isArray(ls) ? ls.filter(g => Array.isArray(g) && Array.isArray(g[2])).map(g => [g[0], g[1], g[2].filter(i => railLines[i])]).filter(g => g[2].length) : []);
    function loadStations() {
        if (!stationsP) stationsP = (root.dataset.stations ? fetch(root.dataset.stations).then(r => (r.ok ? r.json() : null)) : Promise.resolve(null)).catch(() => null).then(j => {
            const rows = j && Array.isArray(j.s) ? j.s : [];
            railLines = j && Array.isArray(j.l) ? j.l : [];
            stationRecs = rows.map(([n, lng, lat, kind, si0, si, gu, en, alt, ls]) => ({ c: [si0, si, gu, n + '역'], leaf: 3, rail: true, kind, name: stName(n, alt), en: en ? en + ' Stn' : '',
                lines: [...new Set(groupsOf(ls).flatMap(g => g[2]))].sort((x, y) => x - y), syn: alt ? [n + '역', alt + '역', n + alt + '역'] : null, sub: [si0, si, gu].filter(Boolean).join(' '), lng, lat, z: 15 }));
            railLayer(rows);
            loadRailLines();
            return stationRecs;
        });
        return stationsP;
    }
    // 검색 결과의 노선 표시: 색 점 + 이름(넷까지, 넘으면 +n)
    function lineChips(ls) {
        if (!ls || !ls.length) return '';
        const shown4 = ls.slice(0, 4).map(i => '<i class="sm-ln" style="background:' + esc(railLines[i][2]) + '"></i>' + esc(T(railLines[i][0], railLines[i][1])));
        return shown4.join(' ') + (ls.length > 4 ? ' +' + (ls.length - 4) : '');
    }
    // 노선 표시(2026-11-10 사장님 — "홍대입구역은 3개 노선이니 네이버 지도처럼 노선마다"): 노선마다 실제 타는 곳(정차 위치)에 노선 색 표시("2" · "공항" · "경의중앙"),
    // 같은 승강장을 쓰는 노선은 한 표시에 나란히. 그림은 처음 쓸 때 그린다(styleimagemissing — 'rb:노선-노선', 밤 · 낮 같음)
    function badgeImage(ids) {
        const k = 2, H = 16, PAD = 4, GAP = 2, O = 1.5;
        const label = i => (en() ? railLines[i][4] : railLines[i][3]) || railLines[i][0];
        const cv = document.createElement('canvas'), cx = cv.getContext('2d');
        const font = '700 ' + (10.5 * k) + 'px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
        cx.font = font;
        const ws = ids.map(i => Math.max(H, Math.ceil(cx.measureText(label(i)).width / k) + PAD * 2));
        const W = ws.reduce((a, w) => a + w, 0) + GAP * (ids.length - 1) + O * 2, HH = H + O * 2;
        cv.width = Math.ceil(W * k); cv.height = Math.ceil(HH * k);
        cx.scale(k, k);
        let x = O;
        ids.forEach((i, j) => {
            const w = ws[j], c = railLines[i][2] || '#666', r = H / 2;
            const pill = () => { cx.beginPath(); cx.moveTo(x + r, O); cx.lineTo(x + w - r, O); cx.arc(x + w - r, O + r, r, -Math.PI / 2, Math.PI / 2); cx.lineTo(x + r, O + H); cx.arc(x + r, O + r, r, Math.PI / 2, Math.PI * 1.5); cx.closePath(); };
            pill(); cx.lineWidth = O * 2; cx.strokeStyle = '#ffffff'; cx.stroke();
            pill(); cx.fillStyle = c; cx.fill();
            const rgb = [1, 3, 5].map(q => parseInt(c.slice(q, q + 2), 16)), lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
            cx.fillStyle = lum > 0.68 ? '#1f2937' : '#ffffff';   // 밝은 노선 색(9호선 · 의정부 · 우이신설 …)은 진한 글자
            cx.font = '700 10.5px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
            cx.textAlign = 'center'; cx.textBaseline = 'middle';
            cx.fillText(label(i), x + w / 2, O + H / 2 + 0.5);
            x += w + GAP;
        });
        return cx.getImageData(0, 0, cv.width, cv.height);
    }
    function railLayer(rows) {
        if (!map || !rows.length || map.getSource('rail')) return;
        const plain = [], badges = [];
        rows.forEach(([n, lng, lat, kind, , , , en0, alt, ls]) => {
            const nm = { name: stName(n, alt), 'name:ko': stName(n, alt), 'name:en': en0 ? en0 + ' Stn' : stName(n, alt) };
            const gs = groupsOf(ls);
            if (!gs.length) plain.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: Object.assign({ k: kind }, nm) });
            else gs.forEach(([x, y, ids]) => badges.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: Object.assign({ b: 'rb:' + ids.join('-') }, nm) }));
        });
        map.on('styleimagemissing', e => { if (/^rb:/.test(e.id) && !map.hasImage(e.id)) { try { map.addImage(e.id, badgeImage(e.id.slice(3).split('-').map(Number)), { pixelRatio: 2 }); } catch (er) { /* 그림 실패 — 표시 없이 */ } } });
        map.addSource('rail', { type: 'geojson', data: { type: 'FeatureCollection', features: plain } });
        map.addSource('rail-st', { type: 'geojson', data: { type: 'FeatureCollection', features: badges } });
        const before = map.getStyle().layers.map(l => l.id).find(id => /^(st|terr|hx)-/.test(id));   // 판매점 · 칸 밑에
        const nameF = ['coalesce', ['get', en() ? 'name:en' : 'name:ko'], ['get', 'name']];
        // 노선 없는 기차역(KTX · 일반 열차만): 예전처럼 흰 점 + 남색 테
        map.addLayer({ id: 'rail-dot', type: 'circle', source: 'rail', minzoom: 12.5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, 3, 16, 5.5], 'circle-stroke-width': 2 } }, before);
        map.addLayer({ id: 'rail-name', type: 'symbol', source: 'rail', minzoom: 13.5, layout: { 'text-field': nameF, 'text-font': ['Noto Sans Bold'],
            'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true, 'text-padding': 4 } }, before);
        // 전철역: 노선 표시 + 이름(13.5부터). 표시는 늘 보이고(겹쳐도), 이름은 겹치면 하나만
        map.addLayer({ id: 'rail-badge', type: 'symbol', source: 'rail-st', minzoom: 12.5, layout: { 'icon-image': ['get', 'b'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.72, 15, 1],
            'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 13.5, nameF], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 1],
            'text-optional': true, 'text-padding': 4 } }, before);
        railPaint();
    }
    // 노선 선: [노선, x0, y0, dx1, dy1, …](경도 · 위도 × 100000, 둘째 점부터 앞 점과의 차)
    let railLinesP = null;
    function loadRailLines() {
        if (railLinesP || !root.dataset.lines) return;
        railLinesP = fetch(root.dataset.lines).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => {
            if (!j || !Array.isArray(j.g) || !Array.isArray(j.l) || !map || map.getSource('rail-lines')) return;
            const features = [];
            for (const g of j.g) {
                const L = j.l[g[0]];
                if (!L) continue;
                const co = [];
                let x = 0, y = 0;
                for (let k = 1; k + 1 < g.length; k += 2) { x += g[k]; y += g[k + 1]; co.push([x / 1e5, y / 1e5]); }
                if (co.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: co }, properties: { cd: paleOf(L[2], false), cn: paleOf(L[2], true) } });
            }
            map.addSource('rail-lines', { type: 'geojson', data: { type: 'FeatureCollection', features } });
            const before = map.getLayer('rail-dot') ? 'rail-dot' : map.getStyle().layers.map(l => l.id).find(id => /^(st|terr|hx)-/.test(id));
            // 줌아웃하면 역처럼 감춘다(2026-11-10 사장님 — 축소하면 판매점 점과 겹쳐 복잡) — 11.5부터 서서히, 역 점(12.5)보다 조금 먼저
            const W = ['interpolate', ['linear'], ['zoom'], 11.5, 1.6, 13, 2.6, 15, 3.5, 18, 6];
            // 밤에는 밑에 옅은 흰 테두리(사장님이 고른 B안) — 1호선 · 7호선 · 9호선처럼 어두운 노선 색이 밤 바탕에 묻혔다. 선이 연해진 만큼 테두리도 옅게
            map.addLayer({ id: 'rail-line-case', type: 'line', source: 'rail-lines', minzoom: 11.5, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
                paint: { 'line-color': '#ebf0f8', 'line-width': ['interpolate', ['linear'], ['zoom'], 11.5, 3.4, 13, 4.8, 15, 5.9, 18, 8.6],
                    'line-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0, 12.3, 0.14, 14, 0.2] } }, before);
            map.addLayer({ id: 'rail-line', type: 'line', source: 'rail-lines', minzoom: 11.5, layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': ['get', 'cd'], 'line-width': W } }, before);
            railPaint();
        });
    }
    // 노선 선은 역 점 색보다 절반 넘게 연하게(2026-11-10 사장님): 바탕색과 섞어 노선 색을 38%(밤 45%)만 남긴다.
    // 투명도로 줄이면 겹친 선로(복선 · 같은 길을 여러 노선이 지남)가 겹친 만큼 진해져서, 미리 섞은 불투명한 색으로 그린다
    function paleOf(hex, night) {
        const k = night ? 0.45 : 0.38, bg = night ? [20, 26, 35] : [246, 246, 243];
        const c = [1, 3, 5].map(i => parseInt(String(hex).slice(i, i + 2), 16));
        if (c.some(v => isNaN(v))) return hex;
        return '#' + c.map((v, i) => Math.round(v * k + bg[i] * (1 - k)).toString(16).padStart(2, '0')).join('');
    }
    function railPaint() {
        if (!map || !map.getLayer('rail-dot')) return;
        const n = isNight(), m = n ? 'night' : 'day';
        map.setPaintProperty('rail-dot', 'circle-color', n ? '#1b2030' : '#ffffff');
        map.setPaintProperty('rail-dot', 'circle-stroke-color', RAIL_DEF[m]);
        for (const id of ['rail-name', 'rail-badge']) {
            if (!map.getLayer(id)) continue;
            map.setPaintProperty(id, 'text-color', n ? '#cfd6e2' : '#2f3746');
            map.setPaintProperty(id, 'text-halo-color', n ? '#141a23' : '#ffffff');
            map.setPaintProperty(id, 'text-halo-width', 1.4);
        }
        if (map.getLayer('rail-line')) {
            map.setLayoutProperty('rail-line-case', 'visibility', n ? 'visible' : 'none');
            map.setPaintProperty('rail-line', 'line-color', ['get', n ? 'cn' : 'cd']);
            map.setPaintProperty('rail-line', 'line-opacity', ['interpolate', ['linear'], ['zoom'], 11.5, 0, 12.3, 1]);
        }
    }
    // 지역으로 옮기면 그 지역의 판매점이 다 보이게(1 · 2등 · 일반 판매점 켜고 흐리게 · TOP 50 만 보기는 끈다) 하고, 다 옮기면 그 근처 판매점 목록(지역 중심에서 가까운 순)
    async function revealAllStores() {
        const chip = k => root.querySelector('.sm-chip[data-layer="' + k + '"]');
        if (shown.top) { const c = chip('top'); if (c) c.click(); }
        if (fadeT > 0) { const f = document.getElementById('sm-fade'); if (f) f.value = 0; setFade(0); }
        ['w1', 'w2', 'all'].forEach(k => { if (!shown[k] && (k !== 'all' || root.dataset.all)) { shown[k] = true; const c = chip(k); if (c) c.setAttribute('aria-pressed', 'true'); } });
        applyLayers();
        await needAll();
        applyLayers();
    }
    let nearFrom = null;   // 지역 찾기로 옮겼으면 { c: [경도, 위도], name } — 근처 목록을 그 중심에서 가까운 순으로
    async function goPlace(p) {
        if (!hexMode) await revealAllStores();
        nearFrom = hexMode ? null : { c: [p.lng, p.lat], name: p.name };
        nearAfterMove = !hexMode;   // LottoHex 에서는 칸을 보러 가는 것이라 목록은 열지 않는다
        areaWant = '';
        if (!isWide()) { card.hidden = true; nearPanel.hidden = true; }
        map.flyTo({ center: [p.lng, p.lat], zoom: p.z, pitch: 0, bearing: 0, essential: true,
            padding: isWide() ? pad() : Object.assign(pad(), { bottom: hexMode ? pad().bottom : Math.round(window.innerHeight * 0.4) + 16 }) });
    }

    function initSearch() {
        const box = document.getElementById('sm-search');
        const list = document.getElementById('sm-found');
        const item = (html, go) => {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.innerHTML = html;
            b.addEventListener('click', () => { list.hidden = true; box.blur(); go(); });
            li.appendChild(b);
            list.appendChild(li);
            return li;
        };
        const render = () => {
            const raw = box.value.trim(), q = raw.toLowerCase();
            list.textContent = '';
            if (q.length < 2) { list.hidden = true; return; }
            if (!places || !stationRecs) Promise.all([loadPlaces(), loadStations()]).then(() => { if (box.value.trim() === raw) render(); });
            if (!all && root.dataset.all) needAll().then(() => { if (all && box.value.trim() === raw) render(); });   // 일반 판매점도 찾는다(층을 꺼 두었어도 — 2026-11-10 사장님 "박희도 로또LAB 이 안 나온다")
            const areas = findPlaces(raw, 5);
            const hits = [];
            for (let i = data.rows.length - 1; i >= 0 && hits.length < 20; i--) if (data.rows[i][4].toLowerCase().includes(q)) hits.push(i);   // 1등 많은 곳부터
            const more = [];   // 일반 판매점(층이 꺼져 있어도 찾는다 — 고르면 층을 켠다)
            if (all) for (let i = 0; i < all.rows.length && hits.length + more.length < 20; i++) if (all.rows[i][2].toLowerCase().includes(q)) more.push(i);
            list.hidden = false;
            if (!areas.length && !hits.length && !more.length) {
                list.innerHTML = '<li class="sm-none">' + (places && (all || !root.dataset.all) ? T('찾는 판매점 · 지역이 없습니다.', 'No retailer or area found.') : T('찾는 중…', 'Searching…')) + '</li>';
                return;
            }
            areas.forEach(p => item('<b>' + (p.rail ? '🚉 ' : '📍 ') + esc(p.rail && en() && p.en ? p.en : p.name) + '</b> <span>' + esc(p.sub ? p.sub + ' · ' : '') +
                (p.rail ? (p.lines && p.lines.length ? lineChips(p.lines) : p.kind === 0 ? T('지하철역', 'metro') : p.kind === 2 ? T('기차 · 지하철역', 'rail · metro') : T('기차역', 'rail')) : T('지역', 'area')) + '</span>', () => goPlace(p)).classList.add('sm-found-area'));
            hits.forEach(i => {
                const r = data.rows[i];
                item('<b>' + esc(r[4]) + '</b> <span>' + esc([data.sido[r[5]], r[6]].filter(Boolean).join(' ')) + ' · ' + T('1등 ', '1st ') + r[2] + ' · ' + T('2등 ', '2nd ') + r[3] + '</span>', () => open(i, true));
            });
            more.forEach(i => {
                const r = all.rows[i];
                item('<b>' + esc(r[2]) + '</b> <span>' + esc([all.sido[r[3]], r[4]].filter(Boolean).join(' ')) + ' · ' + T('일반 판매점', 'retailer') + '</span>', () => {
                    if (!shown.all) { shown.all = true; const c = root.querySelector('.sm-chip[data-layer="all"]'); if (c) c.setAttribute('aria-pressed', 'true'); applyLayers(); }   // 지도에 점이 보이게
                    openAll(i, true);
                });
            });
        };
        box.addEventListener('focus', () => { loadPlaces(); loadStations(); }, { once: true });
        box.addEventListener('input', render);
        // Enter: 맨 위 결과로(지역이 먼저)
        box.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            const first = list.querySelector('button');
            if (first && !list.hidden) { e.preventDefault(); first.click(); }
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
        const box = document.getElementById('sm-fun');
        root.querySelectorAll('.sm-fun-toggle').forEach(b => b.setAttribute('aria-pressed', String(on)));   // PC 는 "지도에 보기" 격자, 휴대폰은 왼쪽 아래 단추
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
        const btns = root.querySelectorAll('.sm-fun-toggle'), box = document.getElementById('sm-fun');
        if (!btns.length || !data.fun) return;
        btns.forEach(btn => btn.addEventListener('click', () => { const on = btn.getAttribute('aria-pressed') !== 'true'; setFun(on); if (on && isWide()) setTab('fun'); }));
        box.querySelectorAll('.sm-fun-item').forEach(b => b.addEventListener('click', () => openFun(Number(b.dataset.k))));
    }

    // TOP 50(PC 왼쪽 칸 첫 탭 — 고른 1등 방식 기준, 폐점 제외)
    function renderTop() {
        const ol = document.getElementById('sm-top50-list');
        if (!ol) return;
        const top = props.filter(p => p.top).sort((a, b) => a.top - b.top);
        const n = data.net;
        ol.innerHTML = (n ? '<li class="is-zero"><button type="button" data-net="1"><span class="sm-rank">0</span><span class="sm-tname">' + T('동행복권 인터넷 판매', 'Dong-haeng Lottery online') +
            '<small>' + T('인터넷 · 동행복권 본사(서초구)', 'Online · company office (Seocho)') + '</small></span><span class="sm-tcnt"><b>' + n.n1 + '</b>' + T('번', '') + '<small>2' + T('등 ', 'nd ') + fmt(n.n2) + '</small></span></button></li>' : '') +
            top.map(p => {
            const r = data.rows[p.i];
            return '<li><button type="button" data-i="' + p.i + '"><span class="sm-rank">' + p.top + '</span><span class="sm-tname">' + esc(r[4]) +
                '<small>' + esc([data.sido[r[5]], r[6]].filter(Boolean).join(' ')) + '</small></span><span class="sm-tcnt"><b>' + p.w1 + '</b>' + T('번', '') + '<small>2' + T('등 ', 'nd ') + r[3] + '</small></span></button></li>';
        }).join('');
        ol.querySelectorAll('button').forEach(b => b.addEventListener('click', () => (b.dataset.net ? openNet(true) : open(Number(b.dataset.i), true))));
    }

    // ───── "0등" 동행복권 인터넷 판매(2026-10-27 사장님) — 1등이 가장 많이 나온 "판매점". 본사 자리, TOP 50 목록 맨 위 0위 ─────
    // 실제 판매 창구가 아니라 자료 rows 에는 넣지 않고 따로 한 점(source 'net')으로 둔다. 다른 점 · 별과 같은 규칙이고 색만 붉다(사장님):
    // 크기(2등 + 1등 × 6) · 평소엔 버블(0.62), TOP 50 을 켜면 별(0.75) + 숨 쉬듯 빛나는 테두리 · 가운데 1등 횟수 · 이름표(화면 안 7곳 이하)
    function addNet(radius, starSize) {
        const n = data.net;
        if (!n) return;
        map.addSource('net', { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
            properties: { w1: n.n1, wt: n.n2 + n.n1 * 6, nm: T('0등 · 동행복권 인터넷', '#0 · Online sales') } }] } });
        if (!map.hasImage('sm-star-red')) map.addImage('sm-star-red', starImage(false, true), { pixelRatio: 1 });
        if (!map.hasImage('sm-star-glow-red')) map.addImage('sm-star-glow-red', starImage('day', true), { pixelRatio: 1 });
        if (!map.hasImage('sm-star-glow-red-n')) map.addImage('sm-star-glow-red-n', starImage('night', true), { pixelRatio: 1 });
        const RED = '#e0283a';
        map.addLayer({ id: 'st-net', type: 'circle', source: 'net', paint: { 'circle-radius': radius, 'circle-color': RED, 'circle-opacity': ALPHA,
            'circle-stroke-color': isNight() ? NIGHT.bg : '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 12, 1.2] } });
        map.addLayer({ id: 'st-net-top', type: 'symbol', source: 'net', layout: { 'icon-image': 'sm-star-red', 'icon-size': starSize, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
            paint: { 'icon-opacity': STAR_ALPHA } });
        map.addLayer({ id: 'st-net-glow', type: 'symbol', source: 'net', layout: { 'icon-image': isNight() ? 'sm-star-glow-red-n' : 'sm-star-glow-red', 'icon-size': starSize,
            'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': netGlow(0.7) } });
        map.addLayer({ id: 'st-net-name', type: 'symbol', source: 'net', layout: nameLayout(1), paint: Object.assign(namePaint(), { 'text-opacity': 1 }) });
        map.addLayer({ id: 'st-net-num', type: 'symbol', source: 'net',
            layout: { 'text-field': ['to-string', ['get', 'w1']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 8, 9, 11, 14, 13], 'text-allow-overlap': true },
            paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(120, 10, 20, .7)', 'text-halo-width': 0.8 } });
        ['st-net', 'st-net-top'].forEach(id => {
            map.on('click', id, e => { e.originalEvent && e.originalEvent.stopPropagation && e.originalEvent.stopPropagation(); openNet(false); });
            map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
        });
    }
    function openNet(fly) {
        const n = data.net;
        if (!n) return;
        const how = [n.auto ? T('자동 ', 'auto ') + n.auto : '', n.manual ? T('수동 ', 'manual ') + n.manual : '', n.semi ? T('반자동 ', 'semi-auto ') + n.semi : ''].filter(Boolean).join(' · ');
        showCard('<h3>' + T('동행복권 인터넷 판매', 'Dong-haeng Lottery online sales') + ' <span class="sm-zero-tag">' + T('0등', '#0') + '</span></h3>' +
            '<p class="sm-place">' + T('동행복권 본사 · 서울 서초구 남부순환로 2423', 'Company office · 2423 Nambusunhwan-ro, Seocho-gu, Seoul') + '</p>' +
            '<p class="sm-counts"><span><b>' + fmt(n.n1) + '</b>' + T('번 1등', ' × 1st') + (how ? ' <small>(' + how + ')</small>' : '') + '</span><span><b>' + fmt(n.n2) + '</b>' + T('번 2등', ' × 2nd') + '</span></p>' +
            '<div class="sm-rounds" id="sm-rounds"><p class="sm-small">' + T('당첨 회차 불러오는 중…', 'Loading draws…') + '</p></div>' +
            '<p class="sm-why">' + T('동행복권 누리집에서 인터넷으로 산 로또입니다(' + n.first + '회부터). 전국 어느 판매점보다 1등이 많이 나왔습니다 — 한 창구에서 가장 많이 팔리기 때문입니다. ' +
                '지도 위치는 회사 자리이며 이곳에서 복권을 팔지는 않습니다.',
                'Lotto bought online on the Dong-haeng Lottery website (from draw ' + n.first + '). More 1st prizes than any shop — simply because it sells the most. ' +
                'The pin marks the company office; tickets are not sold there.') + '</p>' +
            '<p class="sm-links"><a href="https://www.dhlottery.co.kr/" target="_blank" rel="noopener">' + T('동행복권 누리집', 'Dong-haeng Lottery') + '</a></p>', n.lat, n.lng, fly);
        card.dataset.i = 'n';
        loadRounds().then(rd => {
            const box = document.getElementById('sm-rounds');
            if (!box || card.dataset.i !== 'n') return;   // 그 사이 다른 카드를 열었다
            if (!rd || !rd.net) { box.remove(); return; }
            fillRounds(box, rd.net, rd.draws || {});
        });
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
        document.getElementById('sm-night').addEventListener('click', () => { nightByTop = false; nightByHex = false; toggleNight(); });
        side.querySelectorAll('.sm-tab').forEach(b => b.addEventListener('click', () => (b.dataset.tab === 'near' ? openNear() : b.dataset.tab === 'mine' && !shown.mine ? setMine(true) : b.dataset.tab === 'terr' ? (shown.terr ? openTerrPanel() : setMapMode('hex')) : setTab(b.dataset.tab))));
        nearBtn.addEventListener('click', () => { nearFrom = null; openNear(); });
        placeNearBtn();
        window.addEventListener('resize', placeNearBtn);
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
        // 오른쪽 아래는 나중에 단 것이 위로 쌓인다: 축척 막대 → 확대/축소 → 내 위치 → 북쪽 보기
        map.addControl(new ScaleBar(), 'bottom-right');
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
        // 내 위치: 브라우저 위치 기능(휴대폰 GPS, PC 는 와이파이 · IP 로 어림). 이 기기 안에서만 쓰고 서버로 보내지 않는다(위치정보법 — README 4-9)
        // 내 위치: 켜면 기기 안에서 계속 받아 지도에 표시(서버로 보내지 않는다). 위치 이용에 동의한 회원은 지도를 열 때 켜진 채로(2026-11-09 사장님)
        geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true });
        map.addControl(geo, 'bottom-right');
        geo.on('geolocate', e => { myLoc = [e.coords.longitude, e.coords.latitude]; if (!nearPanel.hidden) nearAfterMove = true; });
        geo.on('error', () => { if (!nearPanel.hidden) { const n = nearPanel.querySelector('.sm-near-note'); if (n) n.textContent = T('위치를 받지 못했습니다(브라우저 위치 권한을 확인해 주세요).', 'Could not get your location (check the browser permission).'); } });
        map.addControl(new NorthControl(), 'bottom-right');
        if (document.fullscreenEnabled || document.webkitFullscreenEnabled) map.addControl(new FullControl(), 'bottom-right');   // 맨 위(휴대폰만 보인다)
        // 처음 화면: 서울 전체(2026-10-26 사장님 — 전국은 시도별 표 · 줌아웃으로)
        map.on('load', () => {
            koreanLabels(); whiteModel(); addStores(); nightModel(); nearLabel();
            // 들어올 때의 전환 화면은 그려지면 걷는다 — 빛나는 점이 계속 움직여 'idle' 이 오지 않을 수 있어 잠깐 뒤에도(enterFx 는 한 번만, 최소 1.1초)
            map.once('idle', enterFx);
            setTimeout(enterFx, 500);
            loadStations();   // 역 표시(줌 12.5부터) · 검색
            // ?shop=판매점번호(관리자 페이지의 판매점 댓글 링크 등): 그 판매점 카드를 연다
            const shopQ = new URLSearchParams(location.search).get('shop');
            if (shopQ === '51100000' && data.net) openNet(true);   // 0등(동행복권 인터넷) — TOP 50 구조화 데이터의 주소
            else if (/^\d{8}$/.test(shopQ || '')) loadIds().then(j => {
                if (!j) return;
                let n = j.w.indexOf(shopQ);
                if (n >= 0) { open(n, true); return; }
                n = (j.a || []).indexOf(shopQ);
                if (n < 0) return;
                shown.all = true;
                const chip = root.querySelector('.sm-chip[data-layer="all"]');
                if (chip) chip.setAttribute('aria-pressed', 'true');
                applyLayers();
                const wait = () => (all && map.getSource('all') ? openAll(n, true) : setTimeout(wait, 200));
                wait();
            });
            // ?area=서울+노원구(우리 동네 판매점 지도 공유): 그 시군구로 맞추고 목록을 연다
            const areaQ = (new URLSearchParams(location.search).get('area') || '').trim().slice(0, 40);
            const byArea = !!areaQ && !shopQ && openArea(areaQ);
            // store-map-top50.html(공유용 주소): TOP 50 별로 연다
            if (root.dataset.top) { const c = root.querySelector('.sm-chip-top'); if (c && !shown.top) c.click(); } renderTop(); initVisits(); initMine(); initTerr(); initFun(); initGeo();
            // PC: 이태원로 · 서빙고로 같은 길 이름이 보이는 크기(2026-10-26 사장님) — 용산 둘레.
            // 휴대폰: 남한 전체가 한 화면에 + "적게 나온 곳 흐리게"를 "1등 10회 이상"으로(2026-10-27 사장님 — 많이 나온 곳만 한눈에)
            if (byArea) { /* 지역 공유 링크는 그 지역 화면 그대로, 흐리게 막대도 0 */ }
            else if (!fromLink && isWide()) map.jumpTo({ center: [126.985, 37.538], zoom: 12.9, padding: pad() });
            // 휴대폰: 사장님 캡처(10-30, 화면 폭 462px)대로 — 가운데 127.82 · 36.87, 줌 5.96(남한이 화면 가운데쯤, 위는 도구 줄 · 북녘 일부). 폭이 다르면 줌만 폭에 맞춘다
            else if (!fromLink) map.jumpTo({ center: [127.82, 36.87], zoom: 5.96 + Math.log2(Math.max(300, mapBox.clientWidth) / 462) });
            if (!isWide() && !byArea && !shopQ && !fromLink) { const f = document.getElementById('sm-fade'); f.value = 57; setFade(57); }   // 링크로 온 화면(#map= · ?shop= · ?area=)은 흐리게 없이   // 57 → 1등 10회 이상(setFade 의 셈)
            if (fromLink && map.getPitch() > 5) { const d3 = document.getElementById('sm-3d'); d3.setAttribute('aria-pressed', 'true'); d3.textContent = '2D'; }   // 기울어진 화면 링크
        });
        // 지도 출처(ⓘ)는 접힌 채로 시작(2026-10-27 사장님 — 휴대폰에서 펼쳐진 채 도착했다). MapLibre 는 좁은 화면에서 처음에 펼쳐 두고
        // 지도를 끌어야 접는다 — 출처 글이 들어와 접는 모양(maplibregl-compact)이 되는 순간(sourcedata 바로 뒤) 한 번 접는다.
        // (idle 은 안 된다 — TOP 50 별 빛이 계속 다시 그려 idle 이 다시 오지 않는다) ⓘ 를 누르면 언제든 펼쳐 볼 수 있다
        const foldAttrib = () => setTimeout(() => {
            const el = document.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
            if (!el) return;   // 아직 출처 글이 없다(또는 넓은 화면)
            el.classList.remove('maplibregl-compact-show');
            el.removeAttribute('open');
            map.off('sourcedata', foldAttrib);
        }, 0);
        map.on('sourcedata', foldAttrib);
        map.on('zoomend', autoTilt);
        map.on('moveend', () => { names(); nearLabel(); if (nearAfterMove) { nearAfterMove = false; openNear(); } });
        map.on('error', e => { if (e && e.error && /style|tiles/i.test(String(e.error.message))) console.warn('map', e.error); });
        initControls();
        initSearch();
    }
    start();
})();
