/* 판매점 지도 (store-map.html, 2026-10-26).
 *
 * 자료: store-map-data.json (tools/build-static-stats.js 가 stores-data.json 으로 매주 만든다)
 *   rows: [위도, 경도, 1등, 2등, 상호, 시도 번호, 시군구, 폐점, 자동, 수동, 반자동]
 * 화면 전체가 지도다(머리글 · 메뉴 없음, 왼쪽 위 "생성기로" 단추 하나). 지도: MapLibre(js/vendor/) + OpenFreeMap "liberty" 바탕(키 없음, © OpenStreetMap). 3D 단추는 기울여 건물을 세우고, 다시 누르면 2D(위에서 봄).
 * 점 크기 = 2등 + 1등 × 6 (1등은 2등보다 6배 드물다 — 팔린 양을 짐작하는 값). 1등이 나온 곳은 주황, 2등만 나온 곳은 파랑.
 * 문구 규칙: "명당"으로 읽히지 않게, 카드마다 "어디서 사든 확률은 같다"를 붙인다.
 */
(function () {
    'use strict';

    const root = document.getElementById('sm');
    if (!root) return;
    const mapBox = document.getElementById('sm-map');
    const card = document.getElementById('sm-card');
    const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

    const en = () => !!(window.I18N && window.I18N.lang === 'en');
    const T = (ko, eng) => (en() ? eng : ko);
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => Number(n).toLocaleString(en() ? 'en-US' : 'ko-KR');
    const fail = msg => { mapBox.innerHTML = '<p class="sm-loading">' + esc(msg) + '</p>'; };

    if (!window.maplibregl) { fail(T('지도 스크립트를 불러오지 못했습니다. 아래 시도별 표를 봐 주세요.', 'Could not load the map. See the table below.')); return; }
    if (maplibregl.supported && !maplibregl.supported()) { fail(T('이 브라우저에서는 지도를 그릴 수 없습니다(WebGL). 아래 시도별 표를 봐 주세요.', 'This browser cannot draw the map (WebGL). See the table below.')); return; }

    let data = null;      // { sido, rows }
    let map = null;
    const shown = { w1: true, w2: true, closed: false };

    function filterFor(kind) {
        const tier = kind === 'w1' ? ['>', ['get', 'w1'], 0] : ['==', ['get', 'w1'], 0];
        return shown.closed ? tier : ['all', tier, ['==', ['get', 'closed'], 0]];
    }
    function applyLayers() {
        if (!map || !map.getLayer('st-w1')) return;
        ['w1', 'w2'].forEach(k => {
            map.setLayoutProperty('st-' + k, 'visibility', shown[k] ? 'visible' : 'none');
            map.setFilter('st-' + k, filterFor(k));
        });
    }

    // 바탕 지도의 글자를 한글 이름으로(없으면 원래 이름)
    function koreanLabels() {
        for (const l of map.getStyle().layers) {
            if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
            try { map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', en() ? 'name:en' : 'name:ko'], ['get', 'name']]); } catch (e) { /* 이름이 아닌 글자 */ }
        }
    }
    // 바탕에 3D 건물 층이 없으면 더한다(OpenMapTiles 의 building)
    function buildings() {
        const has = map.getStyle().layers.some(l => l.type === 'fill-extrusion');
        if (has) return;
        const src = Object.keys(map.getStyle().sources).find(k => map.getStyle().sources[k].type === 'vector');
        if (!src) return;
        map.addLayer({
            id: 'sm-buildings', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 14,
            paint: { 'fill-extrusion-color': '#d9dde4', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.75 },
        });
    }

    function geojson() {
        return {
            type: 'FeatureCollection',
            features: data.rows.map((r, i) => ({
                type: 'Feature', id: i,
                geometry: { type: 'Point', coordinates: [r[1], r[0]] },
                properties: { i, w1: r[2], w2: r[3], closed: r[7] ? 1 : 0, wt: r[3] + r[2] * 6 },
            })),
        };
    }

    function addStores() {
        map.addSource('stores', { type: 'geojson', data: geojson() });
        const radius = ['interpolate', ['linear'], ['zoom'],
            5, ['+', 1.6, ['*', 0.45, ['sqrt', ['get', 'wt']]]],
            10, ['+', 3, ['*', 0.9, ['sqrt', ['get', 'wt']]]],
            15, ['+', 6, ['*', 1.6, ['sqrt', ['get', 'wt']]]]];
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
        ['st-w1', 'st-w2'].forEach(id => {
            map.on('click', id, e => { if (e.features && e.features[0]) open(e.features[0].properties.i, false); });
            map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
        });
        applyLayers();
    }

    // 판매점 카드
    function open(i, fly) {
        const r = data.rows[i];
        const [lat, lng, w1, w2, name, si, gu, closed, a, m, s] = r;
        const place = [data.sido[si] || '', gu].filter(Boolean).join(' ');
        const how = [a ? T('자동 ', 'auto ') + a : '', m ? T('수동 ', 'manual ') + m : '', s ? T('반자동 ', 'semi-auto ') + s : ''].filter(Boolean).join(' · ');
        const kakao = 'https://map.kakao.com/link/map/' + encodeURIComponent(name) + ',' + lat + ',' + lng;
        const naver = 'https://map.naver.com/p/search/' + encodeURIComponent(name + ' ' + place);
        card.innerHTML =
            '<button type="button" class="sm-close" aria-label="' + T('닫기', 'Close') + '">×</button>' +
            '<h3>' + esc(name) + (closed ? ' <span class="sm-closed">' + T('폐점', 'closed') + '</span>' : '') + '</h3>' +
            '<p class="sm-place">' + esc(place) + '</p>' +
            '<p class="sm-counts"><span><b>' + fmt(w1) + '</b>' + T('번 1등', ' × 1st') + (how ? ' <small>(' + esc(how) + ')</small>' : '') + '</span>' +
            '<span><b>' + fmt(w2) + '</b>' + T('번 2등', ' × 2nd') + '</span></p>' +
            '<p class="sm-why">' + T('1등 · 2등이 많을수록 많이 팔린 곳일 가능성이 큽니다. 어느 판매점에서 사든 1등 확률은 1/8,145,060으로 같습니다.',
                'More 1st and 2nd prizes most likely means more tickets sold. Your chance of 1st prize is 1 in 8,145,060 wherever you buy.') + '</p>' +
            '<p class="sm-links"><a href="' + kakao + '" target="_blank" rel="noopener">' + T('카카오맵', 'Kakao Map') + '</a>' +
            '<a href="' + naver + '" target="_blank" rel="noopener">' + T('네이버 지도', 'Naver Map') + '</a></p>';
        card.hidden = false;
        card.querySelector('.sm-close').addEventListener('click', () => { card.hidden = true; });
        if (fly) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), essential: true });
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
            list.hidden = false;
            if (!hits.length) { list.innerHTML = '<li class="sm-none">' + T('찾는 판매점이 없습니다.', 'No match.') + '</li>'; return; }
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
        });
    }

    // 위쪽 도구 · 아래쪽 단추에 가리지 않게 지도를 맞출 때의 여백
    const pad = () => ({ top: (document.querySelector('.sm-top').offsetHeight || 150) + 16, bottom: 60, left: 24, right: 56 });
    function initControls() {
        root.querySelectorAll('.sm-chip').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.layer;
            shown[k] = !shown[k];
            b.setAttribute('aria-pressed', String(shown[k]));
            applyLayers();
        }));
        const d3 = document.getElementById('sm-3d');
        d3.addEventListener('click', () => {
            const on = d3.getAttribute('aria-pressed') !== 'true';
            d3.setAttribute('aria-pressed', String(on));
            d3.textContent = on ? '2D' : '3D';
            map.easeTo({ pitch: on ? 60 : 0, bearing: on ? -17 : 0, zoom: on ? Math.max(map.getZoom(), 14.5) : map.getZoom(), duration: 900 });
        });
        // 시도별 표의 지역 이름 → 그 지역의 판매점이 다 보이게
        document.querySelectorAll('.sm-goto').forEach(b => b.addEventListener('click', () => {
            const si = data.sido.indexOf(b.dataset.sido);
            const pts = data.rows.filter(r => r[5] === si);
            if (!pts.length) return;
            const lats = pts.map(r => r[0]).sort((x, y) => x - y), lngs = pts.map(r => r[1]).sort((x, y) => x - y);
            const q = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];   // 끝의 1%는 빼고(주소가 잘못 찍힌 점에 끌려가지 않게)
            document.getElementById('sm-info').open = false;
            map.fitBounds([[q(lngs, 0.01), q(lats, 0.01)], [q(lngs, 0.99), q(lats, 0.99)]], { padding: pad(), pitch: 0, bearing: 0 });
            document.getElementById('sm-3d').setAttribute('aria-pressed', 'false');
            document.getElementById('sm-3d').textContent = '3D';
        }));
    }

    async function start() {
        try {
            const res = await fetch(root.dataset.src);
            data = await res.json();
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
        map.on('load', () => { koreanLabels(); buildings(); addStores(); map.fitBounds([[125.8, 33.1], [129.7, 38.6]], { padding: pad(), duration: 0 }); });
        map.on('error', e => { if (e && e.error && /style|tiles/i.test(String(e.error.message))) console.warn('map', e.error); });
        initControls();
        initSearch();
    }
    start();
})();
