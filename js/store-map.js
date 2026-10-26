/* 판매점 지도 (store-map.html, 2026-10-26).
 *
 * 자료: store-map-data.json (tools/build-static-stats.js 가 stores-data.json 으로 매주 만든다)
 *   rows: [위도, 경도, 1등, 2등, 상호, 시도 번호, 시군구, 폐점, 자동, 수동, 반자동]
 * 화면 전체가 지도다(머리글 · 메뉴 없음, 왼쪽 위 "생성기로" 단추 하나). 지도: MapLibre(js/vendor/) + OpenFreeMap "positron" 바탕(키 없음, © OpenStreetMap).
 * 모양(2026-10-26 사장님 결정 — 제안 ② "화이트 모형"): 하얀 땅에 반투명 흰 건물, 색은 판매점 점에만. 줌 15쯤부터 건물이 솟아오르고(높이를 줌에 따라 0 → 실제 높이)
 * 지도도 저절로 기울어진다(13 아래로 나가면 다시 평평하게). 3D 단추는 손으로 기울이기/펴기.
 * 막대 지도(제안 ④): 1등 · 2등 판매점을 막대로 세운다(1등 많을수록 높게) — 로그인 회원 기능(서버에 로그인이 꺼져 있으면 누구나).
 *   줌을 바꿀 때 막대가 끊김 없이 커지고 작아지게: 높이는 줌 지수 보간(화면 px 이 일정), 굵기는 줌 1단계마다 미리 만든 모양을 겹쳐 서서히 바꾼다(barBand).
 * 점 크기 = 2등 + 1등 × 6 (1등은 2등보다 6배 드물다 — 팔린 양을 짐작하는 값). 1등이 나온 곳은 주황, 2등만 나온 곳은 파랑. 1등 많은 50곳은 점 안에 1등 횟수.
 * 1등 방식(자동 · 수동 · 반자동) 체크 — 로그인 회원 기능. 끈 방식의 1등은 세지 않는다(점 크기 · 막대 · 숫자 · 상위 50).
 * 카드: 1등 · 2등이 나온 회차(store-map-rounds.json — 카드를 처음 열 때 받는다).
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
    const bands = new Set();                       // 만들어 둔 막대 굵기 단계(줌 × 4)

    // w1 = 고른 방식의 1등 횟수, o1 = 원래 1등 횟수(2등만 나온 곳을 가르는 값)
    function filterFor(kind) {
        const tier = kind === 'w1' ? ['>', ['get', 'w1'], 0] : ['==', ['get', 'o1'], 0];
        return shown.closed ? tier : ['all', tier, ['==', ['get', 'closed'], 0]];
    }
    function applyLayers() {
        if (!map || !map.getLayer('st-w1')) return;
        const vis = on => (on ? 'visible' : 'none');
        ['w1', 'w2'].forEach(k => {
            map.setLayoutProperty('st-' + k, 'visibility', vis(shown[k] && !bars));
            map.setFilter('st-' + k, filterFor(k));
            bands.forEach(b => {
                map.setLayoutProperty('bar-' + k + '-' + b, 'visibility', vis(shown[k] && bars));
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
        map.addSource('all', { type: 'geojson', data: { type: 'FeatureCollection', features: all.rows.map((r, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r[1], r[0]] }, properties: { i } })) } });
        map.addLayer({
            id: 'st-all', type: 'circle', source: 'all',
            layout: { visibility: shown.all ? 'visible' : 'none' },
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 2.6, 15, 6],
                'circle-color': '#7d8799', 'circle-opacity': 0.7,
                'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 13, 1],
            },
        }, 'st-w2');
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
                'circle-color': color,
                'circle-opacity': ['case', ['==', ['get', 'closed'], 1], 0.35, 0.85],
                'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 12, 1.2],
            },
        });
        map.addLayer(layer('st-w2', '#3b6fd8', 'w2'));
        map.addLayer(layer('st-w1', '#f07a1a', 'w1'));
        // 1등 많은 50곳: 점 안에 1등 횟수(겹치면 순위 높은 곳만)
        map.addLayer({
            id: 'st-num', type: 'symbol', source: 'stores', filter: ['all', ['>', ['get', 'top'], 0], filterFor('w1')],
            layout: { 'text-field': ['to-string', ['get', 'w1']], 'text-font': ['Noto Sans Bold'], 'symbol-sort-key': ['get', 'top'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 5, 8, 9, 11, 14, 13], 'text-padding': 0, 'text-allow-overlap': false },
            paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(150, 60, 0, .55)', 'text-halo-width': 0.7 },
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
        card.innerHTML = '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' + html;
        card.hidden = false;
        card.querySelector('.sm-close').addEventListener('click', () => { card.hidden = true; });
        if (fly) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), essential: true });
    }
    // 일반 판매점 카드
    function openAll(i, fly) {
        const [lat, lng, name, si, gu] = all.rows[i];
        const place = [all.sido[si] || '', gu].filter(Boolean).join(' ');
        showCard('<h3>' + esc(name) + '</h3><p class="sm-place">' + esc(place) + '</p>' +
            '<p class="sm-why">' + T(data.first + '회부터 1등 · 2등 기록이 없는 판매점입니다. 어느 판매점에서 사든 1등 확률은 1/8,145,060으로 같습니다.',
                'No 1st or 2nd prize here since draw ' + data.first + '. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.') + '</p>' + links(name, place, lat, lng), lat, lng, fly);
    }

    // 당첨 회차 — 카드를 처음 열 때 한 번 받는다
    let roundsP = null;
    const loadRounds = () => (roundsP = roundsP || fetch(root.dataset.rounds).then(r => r.json()).catch(() => { roundsP = null; return null; }));
    const HOW = { 1: ['자동', 'auto'], 2: ['수동', 'manual'], 3: ['반자동', 'semi'] };
    function roundsHtml(rw) {
        const [r1, r2] = rw;
        const SHOW = 12;   // 처음엔 최근 12회씩 — 카드가 지도를 너무 가리지 않게
        const more = n => '<li><button type="button" class="sm-more">' + T('더 보기', 'More') + ' (' + n + ')</button></li>';
        const chip = (r, extra, cls) => '<li' + (cls ? ' class="' + cls + '"' : '') + '><a href="round/' + r + '.html">' + r + T('회', '') + (extra ? ' <small>' + extra + '</small>' : '') + '</a></li>';
        const list = items => '<ul>' + items.slice(0, SHOW).join('') + (items.length > SHOW ? more(items.length - SHOW) : '') + '</ul>';
        const rest = [];
        let h = '';
        if (r1.length) {
            const items = r1.map(c => { const how = HOW[c % 4]; return chip(Math.floor(c / 4), how ? T(how[0], how[1]) : '', 'r1'); });
            h += '<h4>' + T('1등 나온 회차', '1st-prize draws') + ' (' + r1.length + ')</h4>' + list(items);
            rest.push(items.slice(SHOW).join(''));
        }
        if (r2.length) {
            const cnt = new Map();
            r2.forEach(r => cnt.set(r, (cnt.get(r) || 0) + 1));
            const items = [...cnt].map(([r, n]) => chip(r, n > 1 ? '×' + n : ''));
            h += '<h4>' + T('2등 나온 회차', '2nd-prize draws') + ' (' + r2.length + ')</h4>' + list(items);
            rest.push(items.slice(SHOW).join(''));
        }
        return { h, rest };
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
            links(name, place, lat, lng), lat, lng, fly);
        card.dataset.i = String(i);
        loadRounds().then(rd => {
            const box = document.getElementById('sm-rounds');
            if (!box || card.dataset.i !== String(i)) return;   // 그 사이 다른 카드를 열었다
            if (!rd || !rd.rows[i]) { box.remove(); return; }
            const { h, rest } = roundsHtml(rd.rows[i]);
            box.innerHTML = h;
            // 목록마다 "더 보기" — 누르면 그 목록의 나머지를 붙인다
            box.querySelectorAll('ul').forEach((ul, k) => {
                const b = ul.querySelector('.sm-more');
                if (b) b.addEventListener('click', () => { b.parentNode.outerHTML = rest[k] || ''; });
            });
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

    // 막대 지도: 점마다 작은 네모 기둥. 화면에서 늘 비슷한 굵기 · 높이로 보이게 —
    //  높이: 줌 0 에서의 미터(h0)를 지수(밑 0.5) 보간 → 줌마다 정확히 반씩, 화면 높이(px)는 그대로(끊김 없음)
    //  굵기: 모양은 미터로 고정이라 줌 0.25 단계마다 그 줌에 맞춘 모양(band)을 두고 바꿔 낀다 — 한 단계 차이가 16%라 끊겨 보이지 않는다.
    //  (처음엔 1단계마다 두고 겹쳐 흐리게 바꿨는데, 바뀌는 동안 막대가 옅어져 깜빡였다.) 지금 줌 둘레만 만들고 먼 단계는 지운다
    const M0 = 40075016.686 / 512;   // 줌 0, 적도에서 화면 1px 의 미터
    const STEP = 4;                  // 줌 1 당 단계 수
    const BAND_MIN = 5 * STEP, BAND_MAX = 18 * STEP;
    const halfPx = z => Math.min(7, Math.max(2.5, 2.5 + (z - 8) * 0.6));   // 기둥 반 폭(px): 전국 2.5 → 거리 7
    const height = ['interpolate', ['exponential', 0.5], ['zoom'], 0, ['get', 'h0'], 24, ['*', ['get', 'h0'], Math.pow(0.5, 24)]];
    const barIds = k => ['bar-w2-' + k, 'bar-w1-' + k];
    function barBand(k) {
        const z = k / STEP, r0 = halfPx(z) * M0 / Math.pow(2, z);   // 적도 기준 반 폭(m)
        return {
            type: 'FeatureCollection',
            features: data.rows.map((x, i) => {
                const [lat, lng] = x, p = props[i], cos = Math.cos(lat * Math.PI / 180);
                const dy = r0 * cos / 111320, dx = r0 / 111320;   // 미터 → 도(위도 따라 화면 크기가 같게)
                const hpx = p.w1 ? 8 + 6 * p.w1 : 2 + 1.5 * p.w2;
                return {
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]] },
                    properties: { i, w1: p.w1, o1: p.o1, closed: p.closed, h0: hpx * M0 * cos },
                };
            }),
        };
    }
    function addBand(k) {
        if (bands.has(k) || k < BAND_MIN || k > BAND_MAX) return;
        bands.add(k);
        map.addSource('bars-' + k, { type: 'geojson', data: barBand(k) });
        const lo = k === BAND_MIN ? 0 : (k - 0.5) / STEP, hi = k === BAND_MAX ? 24 : (k + 0.5) / STEP;
        ['w2', 'w1'].forEach((t, n) => map.addLayer({ id: barIds(k)[n], type: 'fill-extrusion', source: 'bars-' + k, minzoom: lo, maxzoom: hi, filter: filterFor(t),
            layout: { visibility: shown[t] && bars ? 'visible' : 'none' },
            paint: { 'fill-extrusion-color': t === 'w1' ? '#f07a1a' : '#3b6fd8', 'fill-extrusion-height': height, 'fill-extrusion-opacity': 0.9 } }));
    }
    function dropBand(k) {
        barIds(k).forEach(id => map.removeLayer(id));
        map.removeSource('bars-' + k);
        bands.delete(k);
    }
    // 지금 줌과 앞뒤 두 단계를 미리 만들어 두고(넘어갈 때 비지 않게), 1.5 줌 넘게 떨어진 단계는 지운다(휴대폰 메모리)
    function ensureBands() {
        if (!bars) return;
        const k = Math.round(map.getZoom() * STEP);
        for (let d = -2; d <= 2; d++) addBand(k + d);
        [...bands].forEach(b => { if (Math.abs(b - k) > 6) dropBand(b); });
    }
    function setBars(on) {
        bars = on;
        document.getElementById('sm-bars').setAttribute('aria-pressed', String(on));
        ensureBands();
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
    const pad = () => ({ top: (document.querySelector('.sm-top').offsetHeight || 150) + 16, bottom: 60, left: 24, right: 56 });
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
        const narrow = window.innerWidth < 700;
        map = new maplibregl.Map({
            container: mapBox, style: STYLE, center: [127.8, narrow ? 35.6 : 36.0], zoom: narrow ? 5.6 : 6.3,
            maxBounds: [[118, 30], [138, 42]], attributionControl: { compact: true }, dragRotate: true, pitchWithRotate: true,
        });
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
        map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false }, trackUserLocation: false }), 'bottom-right');   // 내 위치는 이 기기 안에서만 쓴다(서버로 보내지 않는다)
        // 처음 화면: 위쪽 도구에 가리지 않게 우리나라 전체를 맞춘다
        map.on('load', () => { koreanLabels(); whiteModel(); addStores(); map.fitBounds([[125.8, 33.1], [129.7, 38.6]], { padding: pad(), duration: 0 }); });
        map.on('zoomend', autoTilt);
        map.on('zoom', ensureBands);
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
