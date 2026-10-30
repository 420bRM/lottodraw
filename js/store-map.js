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
    const fail = msg => { mapBox.innerHTML = '<p class="sm-loading">' + esc(msg) + '</p>'; };

    if (!window.maplibregl) { fail(T('지도 스크립트를 불러오지 못했습니다. 아래 시도별 표를 봐 주세요.', 'Could not load the map. See the table below.')); return; }
    if (maplibregl.supported && !maplibregl.supported()) { fail(T('이 브라우저에서는 지도를 그릴 수 없습니다(WebGL). 아래 시도별 표를 봐 주세요.', 'This browser cannot draw the map (WebGL). See the table below.')); return; }

    let data = null;      // { sido, rows }
    let all = null;       // 일반 판매점 { sido, rows } — 칩을 켤 때 받는다
    let map = null;
    const shown = { top: false, w1: true, w2: true, closed: false, all: false, mine: false };   // mine: 내 기록(다녀온 곳만, 2026-10-27)   // top: TOP 50 만 별로 보기(2026-10-27)
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
    // 내 기록을 켜면 다른 점 · 별 · 이름은 다 감추고 다녀온 곳만(끄면 applyLayers 가 원래대로 되돌린다)
    const OTHER_LAYERS = ['st-w1', 'st-w2', 'st-num', 'st-top', 'st-top-glow', 'st-name', 'st-all', 'st-all-name', 'st-net', 'st-net-top', 'st-net-glow', 'st-net-num', 'st-net-name'];
    function mineOnly() {
        if (!map) return;
        if (shown.mine) OTHER_LAYERS.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });
        ['st-mine', 'st-mine-name'].forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', shown.mine ? 'visible' : 'none'); });
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
            if (/^st-/.test(id)) continue;
            if (id === 'sm-bld') setP(id, 'fill-extrusion-color', N('extr'));
            else if (id === 'sm-bld-line') setP(id, 'line-color', N('edge'));
            else if (l.type === 'background') setP(id, 'background-color', N('bg'));
            else if (l.type === 'fill') setP(id, 'fill-color', N(sl === 'water' ? 'water' : sl === 'park' || sl === 'landcover' ? 'park' : sl === 'building' ? 'bld' : 'land'));
            else if (l.type === 'line') setP(id, 'line-color', N(sl === 'water' || sl === 'waterway' ? 'water' : sl === 'boundary' ? 'border' : /casing/.test(id) ? 'casing' : /rail|transit/.test(id) ? 'rail' : 'road'));
            else if (l.type === 'symbol' && l.layout && l.layout['text-field'] && !isShield(l)) { setP(id, 'text-color', N('text')); setP(id, 'text-halo-color', N('halo')); }
        }
        names();
        if (map.getLayer('st-top-glow')) map.setLayoutProperty('st-top-glow', 'icon-image', on ? 'sm-star-glow-n' : 'sm-star-glow');
        if (map.getLayer('st-net-glow')) map.setLayoutProperty('st-net-glow', 'icon-image', on ? 'sm-star-glow-red-n' : 'sm-star-glow-red');
        if (map.getLayer('st-net')) map.setPaintProperty('st-net', 'circle-stroke-color', on ? NIGHT.bg : '#fff');
        map.setPaintProperty('st-w1', 'circle-stroke-color', rim('#f07a1a'));
        map.setPaintProperty('st-w2', 'circle-stroke-color', rim('#3b6fd8'));
        if (map.getLayer('st-all')) map.setPaintProperty('st-all', 'circle-stroke-color', rim('#7d8799'));
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
        list.forEach(x => { Object.assign(x, info(x)); x.d = myLoc ? distM(myLoc, [x.lng, x.lat]) : 0; });
        list.sort(myLoc ? (a, b) => a.d - b.d : (a, b) => (b.w1 - a.w1) || (b.w2 - a.w2));
        nearPanel.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' +
            '<h3>' + esc(gu ? T(gu + ' 근처 판매점', 'Retailers around ' + gu) : T('이 근처 판매점', 'Retailers around here')) + ' <small>' + fmt(list.length) + T('곳', '') + '</small></h3>' +
            (key ? '<p class="sm-near-share"><button type="button" class="sm-share-area">🔗 ' + esc(T(gu + ' 판매점 지도 공유', 'Share the ' + gu + ' map')) + '</button></p>' : '') +
            '<p class="sm-near-sort">' + (myLoc ? T('내 위치에서 가까운 순', 'Nearest to you first') : T('1등 많은 순', 'Most 1st prizes first')) +
            ' <button type="button" class="sm-near-me">📍 ' + T('내 위치 기준', 'Use my location') + '</button></p>' +
            (list.length ? '<ol class="sm-near-list">' + list.slice(0, NEAR_MAX).map(x => '<li><button type="button" data-t="' + x.t + '" data-i="' + x.i + '"><span class="sm-tname">' + esc(x.name) +
                '<small>' + esc(x.place) + '</small></span><span class="sm-tcnt">' + (x.t === 'w' ? '<b>' + x.w1 + '</b>' + T('번 1등', ' × 1st') + '<small>2' + T('등 ', 'nd ') + x.w2 + '</small>' : '<small>' + T('일반 판매점', 'retailer') + '</small>') +
                (myLoc ? '<small class="sm-dist">' + fmtDist(x.d) + '</small>' : '') + '</span></button></li>').join('') + '</ol>' +
                (list.length > NEAR_MAX ? '<p class="sm-small">' + T('외 ' + fmt(list.length - NEAR_MAX) + '곳 — 지도를 더 확대하면 좁혀집니다.', fmt(list.length - NEAR_MAX) + ' more — zoom in to narrow down.') + '</p>' : '')
                : '<p class="sm-small">' + T('이 화면에는 판매점이 없습니다. 지도를 옮기거나 줌아웃해 보세요.', 'No retailers on screen. Move or zoom out.') + '</p>') +
            '<p class="sm-small sm-near-note">' + T('위치는 이 기기 안에서만 쓰고 저장하거나 보내지 않습니다.', 'Your location stays on this device.') + '</p>';
        nearPanel.hidden = false;
        const sb = nearPanel.querySelector('.sm-share-area');
        if (sb) sb.addEventListener('click', () => shareArea(key, sb));
        if (isWide()) setTab('near'); else { card.hidden = true; minePanel.hidden = true; }
        nearPanel.scrollTop = 0;
        nearPanel.querySelector('.sm-close').addEventListener('click', () => { nearPanel.hidden = true; if (isWide()) setTab('top'); });
        nearPanel.querySelector('.sm-near-me').addEventListener('click', () => { if (geo) { nearAfterMove = true; geo.trigger(); } });
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
        if (!isWide()) { nearPanel.hidden = true; minePanel.hidden = true; }   // 휴대폰은 카드 하나만
        card.querySelector('.sm-close').addEventListener('click', () => { card.hidden = true; markTop(null); });
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
            '<p class="sm-why">' + T(data.first + '회부터 1등 · 2등 기록이 없는 판매점입니다. 어느 판매점에서 사든 1등 확률은 1/8,145,060으로 같습니다.',
                'No 1st or 2nd prize here since draw ' + data.first + '. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.') + '</p>' + links(name, place, lat, lng) + '<div class="sm-share-shop" id="sm-share-shop"><button type="button" class="sm-share-btn">🔗 ' + T('해당 판매점 공유하기', 'Share this retailer') + '</button></div>' +
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
    const mineList = () => Object.keys(visits).reverse().map(id => Object.assign({ id, c: visits[id] }, shopOf(id) || {})).filter(x => x.t);
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
                '<small>' + esc(x.place) + '</small></span><span class="sm-tcnt">' + (x.t === 'w' ? '<b>' + data.rows[x.i][2] + '</b>' + T('번 1등', ' × 1st') : '<small>' + T('일반 판매점', 'retailer') + '</small>') + '</span></button></li>').join('') + '</ol>'
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
            body + '<p class="sm-small sm-near-note">' + T('나만 보입니다. 위치는 쓰지 않습니다.', 'Only you can see this. No location used.') + '</p>';
        minePanel.hidden = false;
        if (isWide()) setTab('mine'); else { card.hidden = true; nearPanel.hidden = true; }
        minePanel.querySelector('.sm-close').addEventListener('click', () => setMine(false));
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
                if (shown.mine) { await ensureAll(); mineSource(); drawMine(); }
                if (cmtRefresh) cmtRefresh();   // 내 댓글의 "다녀옴" 표시를 바로 바꾼다
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
            '<p class="sm-why">' + T('1등 · 2등이 많을수록 많이 팔린 곳일 가능성이 큽니다. 어느 판매점에서 사든 1등 확률은 1/8,145,060으로 같습니다.',
                'More 1st and 2nd prizes most likely means more tickets sold. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.') + '</p>' +
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
                '지도 위치는 회사 자리이며 이곳에서 복권을 팔지는 않습니다. 어디서 사든 1등 확률은 1/8,145,060으로 같습니다.',
                'Lotto bought online on the Dong-haeng Lottery website (from draw ' + n.first + '). More 1st prizes than any shop — simply because it sells the most. ' +
                'The pin marks the company office; tickets are not sold there. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.') + '</p>' +
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
        document.getElementById('sm-night').addEventListener('click', () => { nightByTop = false; toggleNight(); });
        side.querySelectorAll('.sm-tab').forEach(b => b.addEventListener('click', () => (b.dataset.tab === 'near' ? openNear() : b.dataset.tab === 'mine' && !shown.mine ? setMine(true) : setTab(b.dataset.tab))));
        nearBtn.addEventListener('click', openNear);
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
        // 오른쪽 아래는 나중에 단 것이 위로 쌓인다: 확대/축소 → 내 위치 → 북쪽 보기
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
        // 내 위치: 브라우저 위치 기능(휴대폰 GPS, PC 는 와이파이 · IP 로 어림). 이 기기 안에서만 쓰고 서버로 보내지 않는다(위치정보법 — README 4-9)
        geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false }, trackUserLocation: false });
        map.addControl(geo, 'bottom-right');
        geo.on('geolocate', e => { myLoc = [e.coords.longitude, e.coords.latitude]; if (!nearPanel.hidden) nearAfterMove = true; });
        geo.on('error', () => { if (!nearPanel.hidden) { const n = nearPanel.querySelector('.sm-near-note'); if (n) n.textContent = T('위치를 받지 못했습니다(브라우저 위치 권한을 확인해 주세요).', 'Could not get your location (check the browser permission).'); } });
        map.addControl(new NorthControl(), 'bottom-right');
        // 처음 화면: 서울 전체(2026-10-26 사장님 — 전국은 시도별 표 · 줌아웃으로)
        map.on('load', () => {
            koreanLabels(); whiteModel(); addStores(); nightModel(); nearLabel();
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
            if (root.dataset.top) { const c = root.querySelector('.sm-chip-top'); if (c && !shown.top) c.click(); } renderTop(); initVisits(); initMine(); initFun();
            // PC: 이태원로 · 서빙고로 같은 길 이름이 보이는 크기(2026-10-26 사장님) — 용산 둘레.
            // 휴대폰: 남한 전체가 한 화면에 + "적게 나온 곳 흐리게"를 "1등 10회 이상"으로(2026-10-27 사장님 — 많이 나온 곳만 한눈에)
            if (byArea) { /* 지역 공유 링크는 그 지역 화면 그대로, 흐리게 막대도 0 */ }
            else if (!fromLink && isWide()) map.jumpTo({ center: [126.985, 37.538], zoom: 12.9, padding: pad() });
            else if (!fromLink) map.fitBounds([[125.9, 33.9], [129.6, 38.4]], { padding: Object.assign(pad(), { bottom: 150, left: 10 }), animate: false });   // 아래는 왼쪽 아래 도구 몫
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
